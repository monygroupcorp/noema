#!/usr/bin/env -S npx tsx
// =============================================================================
// Record, onto the deposits this plane parked, the settlement the PRE-CUTOVER plane already made.
// =============================================================================
//
// WHAT THESE ROWS ARE
// -------------------
// A set of vault deposits of a coin-listed asset (`COINGECKO_ASSETS`, `src/crystal/AssetPricer.ts`)
// sit at `status: 'confirmatum'` carrying their `token` but no `usdFmv`. They arrived BEFORE the
// cutover, and the earlier stack priced and credited every one of them at receipt: its credit
// ledger holds a CONFIRMED row for each, keyed by the deposit's transaction hash. This plane
// observed the same on-chain events in parallel and could not price them, because the per-address
// token feed does not resolve a bridged asset — so they parked, and parked is where they stayed.
//
// WHY THIS MUST RUN BEFORE OR WITH THE PRICING CHANGE
// ---------------------------------------------------
// Parking is what has been holding them. `sweepConfirmatumDeposita` skips a row with no receipt-
// time basis; the moment the asset becomes priceable, a re-delivery or a reconciler pass prices
// the row, the sweep sees a complete basis, and it credits — a second payment for a deposit the
// funder was already paid for. Completing the rows to a terminal `praesolutum` closes that: every
// processing path checks `isSettledDepositum` and leaves them alone.
//
// WHAT IT WRITES, AND WHAT IT DOES NOT
// ------------------------------------
// It completes the deposit row and NOTHING else. `status` moves to `praesolutum`, `usdFmv` takes
// the gross USD basis given at the time, and `praesolutio` records the earlier plane's own numbers
// (points credited, the pricing snapshot, a reference to its ledger row). The credit happened in
// the earlier accounts; these rows RECORD it, they do not repeat it.
//
//     NO BALANCE IS TOUCHED. NO SIGNUM IS ISSUED. NO REVENUE IS BOOKED.
//
// That is enforced, not merely intended: every writable handle in this file comes from `writable()`,
// which refuses any collection but `deposita`.
//
// HOW IT SELECTS
// --------------
// STRUCTURALLY, never from an identifier list. The fetch selector asks for parked rows of a
// coin-listed asset with no basis; the PREDICATE that decides is the earlier ledger itself — a row
// is completed only when that ledger holds a CONFIRMED settlement for its transaction hash, and
// that row carries both the price basis and the points credited. A candidate whose settlement
// cannot be found, or is not CONFIRMED, or is incomplete, is REPORTED AND SKIPPED — never guessed
// at. Nothing about the earlier plane's numbers is hardcoded here; they are read at run time.
//
// SAFETY
// ------
//   * `--db <name>` is REQUIRED and resolved by `_dbTarget.ts`: the live db needs `--prod`, and the
//     pre-cutover db is refused as a write target outright. The pre-cutover ledger is READ through
//     a separate, read-only handle on the same connection, and is never written.
//   * Dry-run is the DEFAULT. Without `--apply` nothing is written, anywhere.
//   * `--apply` additionally REQUIRES `--expect <n>`: the operator states how many rows this run
//     should complete, and a mismatch against what the predicate actually selected refuses the
//     whole run before the first write. A count nobody stated is a count nobody checked.
//   * Every write names a single `_id`. There is no bulk-write path in this file.
//   * Idempotent. A completed row is no longer `confirmatum` and no longer has an absent basis, so
//     a second run selects nothing and exits 0.
//   * Output carries no wallet addresses and no amounts. Rows are named by a stable per-run index.
//
// Run (READ, prod):
//   ./scripts/run-with-env.sh npx tsx scripts/migrations/2026_08_record_legacy_settled_deposita.ts --db noemaplane --prod --dry-run
// Run (WRITE, prod):
//   ./scripts/run-with-env.sh npx tsx scripts/migrations/2026_08_record_legacy_settled_deposita.ts --db noemaplane --prod --apply --expect <n>

import { MongoClient, type Collection, type Db, type Document } from 'mongodb'
import { COINGECKO_ASSETS } from '../../src/crystal/AssetPricer.js'
import { resolveDbTarget, LEGACY_DB } from './_dbTarget.js'

const TAG = '[record-legacy-settled-deposita]'

/** The live money collection this migration completes. */
const LIVE = 'deposita'
/** The pre-cutover credit ledger, read-only, in the pre-cutover database. */
const LEGACY_LEDGER = 'credit_ledger'

/**
 * The ONLY collection this migration may open for writing. A points balance lives in `signa`, and
 * a deposit's history is recorded on the deposit — so the write set is one collection, and asking
 * for any other one is a bug that stops the run rather than a comment that asks it not to happen.
 */
export const WRITABLE_COLLECTIONS = [LIVE]

/** Obtain a writable handle. Refuses every collection outside `WRITABLE_COLLECTIONS`. */
export function writable(db: Pick<Db, 'collection'>, name: string): Collection<Document> {
  if (!WRITABLE_COLLECTIONS.includes(name)) {
    throw new Error(`${TAG} refusing a writable handle on "${name}": this migration writes ${WRITABLE_COLLECTIONS.join(', ')} and nothing else. It records a settlement that already happened; it never moves a balance.`)
  }
  return db.collection(name)
}

// ---------------------------------------------------------------------------
// The candidate set
// ---------------------------------------------------------------------------

/** Every coin-listed token address, across every configured chain, lowercased. */
export function coinListedAddresses(): string[] {
  return Object.values(COINGECKO_ASSETS).flatMap(byAddress => Object.keys(byAddress).map(a => a.toLowerCase()))
}

/** Escape a literal for safe use inside a RegExp — addresses and hashes read out of our own db. */
function literal(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Case-insensitive exact match on a hex field: the same hash is stored in mixed case across planes. */
export function hexEquals(value: string): { $regex: string; $options: string } {
  return { $regex: `^${literal(value)}$`, $options: 'i' }
}

// ---------------------------------------------------------------------------
// The decision core (pure — no I/O, covered directly by the suite)
// ---------------------------------------------------------------------------

/** The deposit fields the decision reads, as a raw driver document carries them. */
export interface RawDeposit {
  transactioHash?: unknown
  status?: unknown
  token?: unknown
  usdFmv?: unknown
}

/** The pre-cutover credit-ledger fields the decision reads. Every one is optional and unvalidated. */
export interface LegacyCreditRow {
  _id?: unknown
  deposit_tx_hash?: unknown
  status?: unknown
  points_credited?: unknown
  gross_deposit_usd?: unknown
  adjusted_gross_deposit_usd?: unknown
  user_credited_usd?: unknown
  funding_rate_applied?: unknown
}

export type Decision =
  | { kind: 'skip'; reason: string }
  | { kind: 'record'; set: Record<string, unknown> }

/**
 * A USD amount as MICRO-USD, decimal-exact, as the decimal string the driver stores.
 * `undefined` for anything that is not a finite positive number — an absent field stays absent.
 */
export function usdToMicroString(value: unknown): string | undefined {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  if (!Number.isFinite(n) || !(n > 0)) return undefined
  const [whole, frac = ''] = n.toFixed(6).split('.')
  return BigInt(whole + frac.padEnd(6, '0')).toString()
}

/** A non-negative integer count, as a decimal string. `undefined` for anything else. */
export function countToString(value: unknown): string | undefined {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  if (!Number.isFinite(n) || n < 0) return undefined
  return String(Math.round(n))
}

/** A rate the earlier ledger recorded, carried across as-is. `undefined` for anything else. */
export function rateOrUndefined(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(n) ? n : undefined
}

/**
 * Decide what to do with ONE candidate deposit, given the pre-cutover settlement found for it
 * (`null` when none was found).
 *
 * Completing is the narrow case; every other branch skips and says why. Note the order: the
 * deposit's own state is checked before the settlement is consulted, so a row that is already
 * settled or already carries a basis is left alone whatever the earlier ledger says about it.
 */
export function decideRecord(deposit: RawDeposit, legacy: LegacyCreditRow | null, at: Date): Decision {
  if (deposit.status !== 'confirmatum') {
    return { kind: 'skip', reason: `deposit is '${String(deposit.status)}', not a parked 'confirmatum' row` }
  }
  if (deposit.usdFmv !== undefined) {
    return { kind: 'skip', reason: 'deposit already carries a receipt-time basis — not one of the parked rows' }
  }
  if (deposit.token === undefined) {
    return { kind: 'skip', reason: 'deposit carries no asset — a pre-freeze shadow row, not this set' }
  }
  if (!legacy) {
    return { kind: 'skip', reason: 'no settlement found in the pre-cutover ledger for this transaction' }
  }
  if (String(legacy.status ?? '').toUpperCase() !== 'CONFIRMED') {
    return { kind: 'skip', reason: `pre-cutover settlement is '${String(legacy.status)}', not CONFIRMED — not proof of payment` }
  }

  const grossUsdFmv = usdToMicroString(legacy.gross_deposit_usd)
  const punctaCredita = countToString(legacy.points_credited)
  if (grossUsdFmv === undefined || punctaCredita === undefined) {
    // Both are the record itself: the basis given at the time and the points given at the time.
    // Without either one there is no complete history to write, and half a record is not one.
    return {
      kind: 'skip',
      reason: `pre-cutover settlement is incomplete (${grossUsdFmv === undefined ? 'no usable gross basis' : 'gross basis ok'}, ${punctaCredita === undefined ? 'no usable points credited' : 'points ok'})`,
    }
  }

  const adjustedGrossUsdFmv = usdToMicroString(legacy.adjusted_gross_deposit_usd)
  const creditedUsd = usdToMicroString(legacy.user_credited_usd)
  const fundingRate = rateOrUndefined(legacy.funding_rate_applied)

  return {
    kind: 'record',
    set: {
      status: 'praesolutum',
      // The gross USD FMV given at the time, in micro-USD — stored as the decimal string
      // `MongoDepositum` serializes a bigint `usdFmv` to.
      usdFmv: grossUsdFmv,
      praesolutio: {
        ledgerRef: String(legacy._id),
        punctaCredita,
        grossUsdFmv,
        ...(adjustedGrossUsdFmv !== undefined ? { adjustedGrossUsdFmv } : {}),
        ...(creditedUsd !== undefined ? { creditedUsd } : {}),
        ...(fundingRate !== undefined ? { fundingRate } : {}),
        recordatum: at,
      },
    },
  }
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

/** Read `--expect <n>`; `undefined` when absent. A non-numeric value is an error, not a zero. */
export function readExpect(argv: string[]): number | undefined {
  const i = argv.indexOf('--expect')
  if (i < 0) return undefined
  const raw = argv[i + 1]
  const n = Number(raw)
  if (raw === undefined || !Number.isInteger(n) || n < 0) {
    throw new Error(`${TAG} --expect needs a non-negative whole number, got "${String(raw)}"`)
  }
  return n
}

/** A disclosure-safe description of one candidate: no addresses, no hashes, no amounts. */
function describe(index: number, doc: Record<string, unknown>): string {
  const natum = doc.natum instanceof Date ? doc.natum.toISOString().slice(0, 10) : 'unknown-date'
  return `  [${index}] natum=${natum} chain=${String(doc.chainId)} status=${String(doc.status)}`
}

async function main(): Promise<void> {
  const uri = process.env.MONGO_PASS ?? process.env.MONGODB_URI ?? 'mongodb://localhost:27017'
  const { db: dbName, dryRun } = resolveDbTarget(process.argv, TAG)
  const apply = process.argv.includes('--apply') && !dryRun
  const expect = readExpect(process.argv)
  if (apply && expect === undefined) {
    throw new Error(`${TAG} refusing to write without --expect <n>: state how many rows this run should complete, so a selection nobody predicted stops before the first write.`)
  }

  const client = await MongoClient.connect(uri)
  try {
    const live = writable(client.db(dbName), LIVE)
    // Read-only handle on the pre-cutover database. `_dbTarget` refuses it as a WRITE target and
    // that stays true — nothing below writes through this handle.
    const legacyLedger = client.db(LEGACY_DB).collection(LEGACY_LEDGER)

    const addresses = coinListedAddresses()
    if (addresses.length === 0) {
      console.log(`${TAG} no coin-listed assets configured — nothing to select. done.`)
      return
    }

    const candidates = await live.find({
      status: 'confirmatum',
      usdFmv: { $exists: false },
      token: { $in: addresses.map(a => hexEquals(a)) },
    }).toArray()

    const at = new Date()
    const recordable: Array<{ index: number; id: unknown; doc: Record<string, unknown>; set: Record<string, unknown> }> = []
    const skipped: Array<{ index: number; doc: Record<string, unknown>; reason: string }> = []

    let index = 0
    for (const raw of candidates) {
      index++
      const doc = raw as unknown as Record<string, unknown>
      const txHash = String(doc.transactioHash ?? '')
      const legacy = txHash === ''
        ? null
        : (await legacyLedger.findOne({ deposit_tx_hash: hexEquals(txHash) })) as LegacyCreditRow | null

      const decision = decideRecord(doc as RawDeposit, legacy, at)
      if (decision.kind === 'skip') { skipped.push({ index, doc, reason: decision.reason }); continue }
      recordable.push({ index, id: doc._id, doc, set: decision.set })
    }

    console.log(`${TAG} candidates fetched: ${candidates.length}`)
    console.log(`${TAG} --- completable, settlement found and CONFIRMED (${recordable.length})`)
    for (const r of recordable) console.log(describe(r.index, r.doc))
    console.log(`${TAG} --- skipped (${skipped.length})`)
    for (const s of skipped) console.log(`${describe(s.index, s.doc)}  -> SKIPPED: ${s.reason}`)

    if (expect !== undefined && expect !== recordable.length) {
      throw new Error(`${TAG} refusing to proceed: --expect ${expect} but the predicate selected ${recordable.length}. Re-read with --dry-run and settle the difference before writing.`)
    }

    if (!apply) {
      console.log(`${TAG} done — completable=${recordable.length} skipped=${skipped.length} [dry-run, no writes]`)
      return
    }

    let written = 0
    for (const r of recordable) {
      // One row, named by `_id`, and only while it still looks the way the decision was made on:
      // a concurrent credit between the read and this write must lose, not be overwritten.
      const result = await live.updateOne(
        { _id: r.id as never, status: 'confirmatum', usdFmv: { $exists: false } },
        { $set: r.set },
      )
      if (result.modifiedCount === 1) { written++; continue }
      console.warn(`${describe(r.index, r.doc)}  -> NOT WRITTEN: the row changed since it was read`)
    }

    console.log(`${TAG} done — completed=${written} selected=${recordable.length} skipped=${skipped.length}`)
    if (written !== recordable.length) {
      throw new Error(`${TAG} ${recordable.length - written} selected row(s) were not written — re-run with --dry-run and read the report above.`)
    }
  } finally {
    await client.close()
  }
}

// Only run when executed directly — importing this module (the suite does, for `decideRecord`
// and `writable`) must never open a db connection or touch argv/process.exit.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => { console.error(`${TAG} failed:`, err); process.exit(1) })
}
