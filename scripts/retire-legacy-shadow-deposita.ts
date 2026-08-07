#!/usr/bin/env -S npx tsx
// =============================================================================
// Retire the legacy shadow deposit rows out of the live `deposita` collection.
// =============================================================================
//
// WHAT THESE ROWS ARE
// -------------------
// A small set of rows sit at `status: 'confirmatum'` carrying NEITHER `token` NOR
// `usdFmv`. They were written by the deposit webhook while the chainengine rail ran
// in shadow alongside the legacy stack, BEFORE the receipt-time basis (`token` +
// `usdFmv`) was frozen onto every new Depositum. The legacy stack already credited
// each of those on-chain events at receipt, and the legacy archive still records
// them. Nothing is owed on any of them.
//
// WHY THEY MUST GO
// ----------------
// They are a live foot-gun, not a backlog. `sweepConfirmatumDeposita` re-warns about
// every one of them on every container start, and the advice it prints — heal via a
// fresh webhook re-delivery — is CORRECT for a genuinely unpriceable new deposit and
// WRONG for these: acting on it would credit a second time for an already-paid event.
// Once the rows leave the live collection the parked query returns nothing and the
// warning stops. No status is added, no schema changes, no `src/` change at all.
//
// HOW IT SELECTS
// --------------
// STRUCTURALLY, never by an identifier list. The selector mirrors `isLegacyShadow`
// exactly, and every fetched document is re-tested against the predicate in JS before
// anything happens to it — the predicate is the authority, the selector is only the
// fetch. Current webhook code ALWAYS writes `token`, so no new row can enter this set.
//
// SAFETY
// ------
//   * `--db <name>` is REQUIRED. There is no default: `.env` points MONGODB_URI at a
//     live cluster, so an unnamed target is an error, never a guess.
//   * Dry-run is the DEFAULT. Without `--apply` nothing is written, anywhere.
//   * `--apply` is archive → verify the copy field-for-field → and only then delete
//     the source row, by `_id`, ONE ROW AT A TIME. An unverified copy never falls
//     through to a delete; the row is reported and the run exits non-zero.
//   * There is no bulk-write path in this file. Every write touches exactly one row.
//   * Output carries no identifiers: no record ids, wallet addresses or tx hashes.
//     Rows are referred to by a stable per-run index.
//   * Idempotent. A second run matches nothing and exits 0.
//
// Run (dry-run, the default):
//   ./scripts/run-with-env.sh npx tsx scripts/retire-legacy-shadow-deposita.ts --db <name>
// Run (write):
//   ./scripts/run-with-env.sh npx tsx scripts/retire-legacy-shadow-deposita.ts --db <name> --apply

import { MongoClient, type Collection, type Document, type Filter } from 'mongodb'
import type { Depositum } from '../src/types/catena.js'

/** The live money collection. */
const LIVE = 'deposita'
/** Where a retired row is preserved verbatim, in the SAME database, before it is removed. */
const ARCHIVE = 'deposita_legacy_shadow'

/**
 * Raw-document view of the three fields the predicate reads. `MongoDepositum.toDoc`
 * serializes the bigint `usdFmv` to a decimal string on write, so a document read
 * straight off the driver carries a string where the domain type carries a bigint.
 * Only PRESENCE is ever read, so both shapes answer the same question.
 */
export interface RawDepositBasis {
  status: string
  token?: string
  usdFmv?: string
}

/**
 * A shadow row: parked `confirmatum` from before the receipt-time basis freeze, i.e. carrying
 * NEITHER `token` NOR `usdFmv`. Current webhook code always writes `token`, so nothing new can
 * enter this set. This is the same condition sweepConfirmatumDeposita already skips on
 * (`src/api/webhooks/alchemyWebhook.ts`).
 *
 * `true` ONLY for `confirmatum` with both basis fields absent. Any other status — including a
 * credited `processatum`, a quarantined `fractum` or an unconfirmed `detectum` — is `false`,
 * and so is a `confirmatum` row that carries either basis field. That last case is the
 * load-bearing one: a genuine deposit parked unpriceable still carries `token`, is still owed,
 * and must never be retired.
 */
export function isLegacyShadow(d: Pick<Depositum, 'status' | 'token' | 'usdFmv'> | RawDepositBasis): boolean {
  return d.status === 'confirmatum' && d.token === undefined && d.usdFmv === undefined
}

/** The fetch selector — the predicate, expressed to Mongo. The predicate remains the authority. */
const SELECTOR: Filter<Document> = {
  status: 'confirmatum',
  token: { $exists: false },
  usdFmv: { $exists: false },
}

/**
 * Field-for-field equality for a Mongo document value. Dates compare by instant, BSON values
 * (ObjectId, Binary, Decimal128, …) by their own `equals`, everything else by `Object.is` —
 * with nested documents and arrays compared recursively on an exact key set.
 */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date && a.getTime() === b.getTime()
  }
  if (isBson(a) || isBson(b)) {
    return isBson(a) && isBson(b) && a.equals(b)
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((x, i) => sameValue(x, b[i]))
  }
  if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a as Record<string, unknown>).sort()
    const kb = Object.keys(b as Record<string, unknown>).sort()
    if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return false
    return ka.every(k => sameValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
  }
  return Object.is(a, b)
}

function isBson(v: unknown): v is { equals(other: unknown): boolean } {
  return typeof v === 'object' && v !== null && typeof (v as { equals?: unknown }).equals === 'function'
}

/**
 * Compare an archived copy against its source, field for field. Returns the field names that
 * differ or are missing on either side — empty means the copy is byte-faithful and the source
 * may be removed. A non-empty result is a hard stop for that row.
 */
export function copyDefects(source: Record<string, unknown>, copy: Record<string, unknown>): string[] {
  const fields = new Set([...Object.keys(source), ...Object.keys(copy)])
  const defects: string[] = []
  for (const f of [...fields].sort()) {
    const inSource = Object.prototype.hasOwnProperty.call(source, f)
    const inCopy = Object.prototype.hasOwnProperty.call(copy, f)
    if (!inSource || !inCopy || !sameValue(source[f], copy[f])) defects.push(f)
  }
  return defects
}

/** Read `--db <name>`; no default — an unset target is an error, not a guess at a live cluster. */
function targetDb(argv: string[]): string {
  const i = argv.indexOf('--db')
  const name = i >= 0 ? argv[i + 1] : undefined
  if (!name || name.startsWith('--')) {
    console.error('[retire-legacy-shadow] refusing to run: pass --db <name>. No default — .env points at a live cluster.')
    process.exit(1)
  }
  return name
}

/** A disclosure-safe description of one row: no ids, no addresses, no tx hashes, no amounts. */
function describe(index: number, doc: Record<string, unknown>): string {
  const natum = doc.natum instanceof Date ? doc.natum.toISOString().slice(0, 10) : 'unknown-date'
  const missing = [
    doc.token === undefined ? 'token' : null,
    doc.usdFmv === undefined ? 'usdFmv' : null,
  ].filter((f): f is string => f !== null)
  return `  [${index}] natum=${natum} chain=${String(doc.chainId)} status=${String(doc.status)} missing=${missing.join('+') || 'none'}`
}

export interface RunResult {
  matched: number
  archived: number
  alreadyArchived: number
  retired: number
  refused: number
  before: number
  after: number
}

/**
 * Archive-then-verify-then-delete, one row at a time. In dry-run (the default) it reads and
 * reports only. Never issues a bulk write: every write in this function names a single `_id`.
 */
export async function retire(
  live: Collection<Document>,
  archive: Collection<Document>,
  opts: { apply: boolean },
): Promise<RunResult> {
  const before = await live.countDocuments(SELECTOR)
  const docs = await live.find(SELECTOR).toArray()

  const res: RunResult = { matched: 0, archived: 0, alreadyArchived: 0, retired: 0, refused: 0, before, after: before }

  let index = 0
  for (const raw of docs) {
    const doc = raw as unknown as Record<string, unknown>
    index++

    // The selector fetched it; the PREDICATE decides. A document that does not satisfy
    // isLegacyShadow is left untouched however it got here.
    const basis: RawDepositBasis = {
      status: String(doc.status),
      ...(doc.token === undefined ? {} : { token: String(doc.token) }),
      ...(doc.usdFmv === undefined ? {} : { usdFmv: String(doc.usdFmv) }),
    }
    if (!isLegacyShadow(basis)) {
      console.warn(`${describe(index, doc)}  -> SKIPPED: selector matched but the predicate does not`)
      res.refused++
      continue
    }

    res.matched++
    console.log(describe(index, doc))
    if (!opts.apply) continue

    const id = doc._id

    // 1. Archive verbatim. Idempotent: an already-archived row is not re-inserted, and that
    //    is not an error — it is a resumed run.
    const existing = await archive.findOne({ _id: id } as Filter<Document>)
    if (existing) {
      res.alreadyArchived++
    } else {
      await archive.insertOne(raw as Document)
      res.archived++
    }

    // 2. Verify the copy by reading it back and comparing field for field. This gate is the
    //    only thing standing between a row and an irreversible removal.
    const copy = await archive.findOne({ _id: id } as Filter<Document>)
    if (!copy) {
      console.error(`  [${index}] REFUSED: archived copy could not be read back — source left in place`)
      res.refused++
      continue
    }
    const defects = copyDefects(doc, copy as unknown as Record<string, unknown>)
    if (defects.length > 0) {
      console.error(`  [${index}] REFUSED: archived copy differs on ${defects.join(', ')} — source left in place`)
      res.refused++
      continue
    }

    // 3. Only now remove the source, by `_id`, one row. There is no bulk path here.
    const del = await live.deleteOne({ _id: id } as Filter<Document>)
    if (del.deletedCount !== 1) {
      console.error(`  [${index}] REFUSED: source row was not removed (deletedCount=${del.deletedCount}); the archived copy stands`)
      res.refused++
      continue
    }
    res.retired++
  }

  res.after = await live.countDocuments(SELECTOR)
  return res
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  const dbName = targetDb(process.argv)
  const uri = process.env.MONGO_PASS ?? process.env.MONGODB_URI ?? 'mongodb://localhost:27017'

  const client = await MongoClient.connect(uri)
  try {
    const db = client.db(dbName)
    console.log(`[retire-legacy-shadow] ${dbName}.${LIVE} -> ${dbName}.${ARCHIVE}${apply ? '' : '  [dry-run, no writes]'}`)
    const res = await retire(db.collection(LIVE), db.collection(ARCHIVE), { apply })

    console.log(
      `[retire-legacy-shadow] matched ${res.matched}` +
      (apply
        ? `, archived ${res.archived} (+${res.alreadyArchived} already archived), retired ${res.retired}, refused ${res.refused}`
        : ` — nothing written`) +
      `; selector count ${res.before} -> ${res.after}`,
    )

    if (res.refused > 0) {
      console.error(`[retire-legacy-shadow] ${res.refused} row(s) refused — re-run after investigating; nothing was lost.`)
      process.exit(1)
    }
    if (apply && res.after !== 0) {
      console.error(`[retire-legacy-shadow] selector still matches ${res.after} row(s) after the run — re-run and investigate.`)
      process.exit(1)
    }
  } finally {
    await client.close()
  }
}

// Only connect when invoked as a script. Importing this module (the predicate is unit-tested)
// must never open a connection or touch a database.
if (/retire-legacy-shadow-deposita\.[cm]?[tj]s$/.test(process.argv[1] ?? '')) {
  main().catch(err => { console.error('[retire-legacy-shadow] failed:', err); process.exit(1) })
}
