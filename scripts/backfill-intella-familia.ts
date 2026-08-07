#!/usr/bin/env -S npx tsx
// =============================================================================
// backfill-intella-familia.ts — populate `familia` on LoRAs the v1→v2 migration
// left without one, deriving it from the `params.baseIntellaId` the migration DID write.
// =============================================================================
//
// WHY
//   `MongoIntella.findByTrigger` and `MongoIntella.triggerMap` — the two prompt-time
//   resolvers — both query `{ genus:'lora', familia, … }` with exact top-level equality.
//   The LoRA migration (`src/migrations/loras/legacyToIntella.ts`) wrote the base model
//   into the spec-v2 field `params.baseIntellaId` and never populated `familia`, so every
//   migrated LoRA matches NEITHER query and its trigger word silently resolves to nothing.
//   This is a DATA repair. `familia` is not being redefined — it is being populated where
//   the migration left it empty.
//
// WHAT IT WRITES
//   `familia`. Nothing else. Not `trigger`, not `access`, not `canonica`, not `ownerAnimaId`,
//   not `sources`, not `dest`. Visibility (`access`/`canonica`) is a separate concern with its
//   own review — changing it here would silently change who can see these models.
//
// SAFETY
//   - Dry-run by DEFAULT. It writes only with an explicit `--apply`.
//   - `--db <name>` is REQUIRED (no default — `.env` points MONGODB_URI at the live cluster).
//   - Every document's precondition is re-checked immediately before its write; any drift
//     between planning and writing aborts the run non-zero rather than writing.
//   - A `params.baseIntellaId` that is not in FAMILIA_BY_BASE_INTELLA_ID is REPORTED and
//     SKIPPED, never guessed. Adding a row to that map is an operator decision.
//   - Idempotent: a second run finds nothing to do.
//
// USAGE
//     npx tsx scripts/backfill-intella-familia.ts --db <dbname>              # dry-run (default)
//     npx tsx scripts/backfill-intella-familia.ts --db <dbname> --apply      # writes
//
//   See docs/phases/familia-backfill.md for the runbook and the post-run verification query.

import { MongoClient, type Document } from 'mongodb'
import {
  FAMILIA_BY_BASE_INTELLA_ID,
  familiaFromBaseIntellaId,
  isKnownBaseIntellaId,
} from '../src/crystal/modelLicense.js'

const TAG = '[backfill-familia]'
const APPLY = process.argv.includes('--apply')

/** The ONLY eligible documents: a LoRA with no `familia` that carries a migrated base id. */
const SELECTOR: Document = {
  genus: 'lora',
  familia: { $exists: false },
  'params.baseIntellaId': { $exists: true },
}

/** Read `--db <name>`; no default — an unset target is an error, not a guess at a live cluster. */
function targetDb(): string {
  const i = process.argv.indexOf('--db')
  const name = i >= 0 ? process.argv[i + 1] : undefined
  if (!name || name.startsWith('--')) {
    console.error(`${TAG} refusing to run: pass --db <name>. No default — .env points at a live cluster.`)
    process.exit(1)
  }
  return name
}

interface Planned { _id: unknown; id: unknown; nomen: unknown; base: string; familia: string }
interface Skipped { _id: unknown; id: unknown; nomen: unknown; base: unknown }

async function main(): Promise<void> {
  const uri = process.env.MONGO_PASS ?? process.env.MONGODB_URI
  if (!uri) {
    console.error(`${TAG} refusing to run: set MONGODB_URI (or MONGO_PASS).`)
    process.exit(1)
  }
  const dbName = targetDb()
  const client = await MongoClient.connect(uri)
  try {
    const col = client.db(dbName).collection('intellae')

    const before = await col.countDocuments({ genus: 'lora', familia: { $exists: false } })
    console.log(`${TAG} ${dbName}.intellae — ${APPLY ? 'APPLY' : 'DRY-RUN (no writes; pass --apply to write)'}`)
    console.log(`${TAG} before: ${before} lora(s) with no familia`)

    const docs = await col.find(SELECTOR).toArray()
    console.log(`${TAG} eligible (lora + no familia + has params.baseIntellaId): ${docs.length}`)

    // ── Plan ────────────────────────────────────────────────────────────────
    const mapped: Planned[] = []                    // will write
    const skippedNoFamiliaExists: Skipped[] = []    // known base, correctly has NO familia (kontext)
    const skippedUnknownBase: Skipped[] = []        // not in the map — needs an operator decision

    for (const doc of docs) {
      const base = (doc as Document).params?.baseIntellaId
      if (!isKnownBaseIntellaId(base)) {
        skippedUnknownBase.push({ _id: doc._id, id: doc.id, nomen: doc.nomen, base })
        continue
      }
      const familia = familiaFromBaseIntellaId(base as string)
      if (familia === null) {
        skippedNoFamiliaExists.push({ _id: doc._id, id: doc.id, nomen: doc.nomen, base })
        continue
      }
      mapped.push({ _id: doc._id, id: doc.id, nomen: doc.nomen, base: base as string, familia })
    }

    // ── Report: counts, then itemised ───────────────────────────────────────
    console.log('')
    console.log(`${TAG} mapped                     : ${mapped.length}`)
    console.log(`${TAG} skipped-no-familia-exists  : ${skippedNoFamiliaExists.length}`)
    console.log(`${TAG} skipped-unknown-base       : ${skippedUnknownBase.length}`)
    console.log('')

    const byFamilia = new Map<string, number>()
    for (const m of mapped) byFamilia.set(m.familia, (byFamilia.get(m.familia) ?? 0) + 1)
    for (const [familia, n] of [...byFamilia].sort()) console.log(`${TAG}   familia='${familia}': ${n}`)
    for (const m of mapped) console.log(`${TAG}   mapped  ${m.id} "${m.nomen}"  ${m.base} → familia='${m.familia}'`)

    for (const s of skippedNoFamiliaExists) {
      console.log(`${TAG}   skip(no-familia-exists)  ${s.id} "${s.nomen}"  ${s.base} — known base with no base flow; absent familia is CORRECT`)
    }
    for (const s of skippedUnknownBase) {
      console.error(`${TAG}   SKIP(unknown-base)       ${s.id} "${s.nomen}"  baseIntellaId=${JSON.stringify(s.base)} — NOT in FAMILIA_BY_BASE_INTELLA_ID`)
    }
    if (skippedUnknownBase.length > 0) {
      console.error('')
      console.error(`${TAG} !! ${skippedUnknownBase.length} document(s) carry a baseIntellaId this script does not know.`)
      console.error(`${TAG} !! Known ids: ${Object.keys(FAMILIA_BY_BASE_INTELLA_ID).join(', ')}`)
      console.error(`${TAG} !! Adding a row is an OPERATOR decision (the value must exist in BASE_TABLE). Not guessing.`)
      console.error('')
    }

    // ── Write ───────────────────────────────────────────────────────────────
    if (!APPLY) {
      console.log(`${TAG} dry-run — no writes. Re-run with --apply to write ${mapped.length} familia value(s).`)
      console.log(`${TAG} after (unchanged): ${before} lora(s) with no familia`)
      return
    }

    let written = 0
    for (const m of mapped) {
      // Precondition re-checked immediately before THIS write: familia still absent AND the base
      // is still the value the plan was computed from. Drift = abort, never write.
      const precondition: Document = {
        _id: m._id,
        familia: { $exists: false },
        'params.baseIntellaId': m.base,
      }
      const res = await col.updateOne(precondition, { $set: { familia: m.familia } })
      if (res.matchedCount !== 1) {
        console.error(`${TAG} ABORT: precondition drifted for ${m.id} (expected familia absent and params.baseIntellaId='${m.base}'). ${written} write(s) already applied.`)
        process.exit(1)
      }
      written++
    }

    const after = await col.countDocuments({ genus: 'lora', familia: { $exists: false } })
    console.log(`${TAG} wrote familia on ${written} document(s)`)
    console.log(`${TAG} after: ${after} lora(s) with no familia (was ${before})`)
    if (skippedUnknownBase.length === 0) {
      console.log(`${TAG} remaining should be exactly the known no-base-flow records (${skippedNoFamiliaExists.length}) plus any lora with no params.baseIntellaId at all.`)
    }
  } finally {
    await client.close()
  }
}

main().catch(err => { console.error(`${TAG} failed:`, err); process.exit(1) })
