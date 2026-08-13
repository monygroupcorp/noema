#!/usr/bin/env -S npx tsx
// =============================================================================
// Repair LoRAs stranded on the stale `familia: 'klein-4b'` value.
// =============================================================================
//
// A batch of LoRA records carries `familia: 'klein-4b'`, predating the alias
// table that maps that vocabulary onto the real base family. `triggerMap` /
// `findByTrigger` (`src/crystal/MongoIntella.ts`) match `familia` by exact
// top-level equality, so a record on `'klein-4b'` is unreachable by any flow —
// invisible, not mis-offered. Today's training path already writes the correct
// value (`aitkConfig.ts` maps `'klein-4b' -> 'flux2'`, and
// `trainingFinalizer.ts` routes new records through `canonicalFamilia`), so
// this is a repair of stale data, not a code fix.
//
//     A REPAIR IS NEVER WRITTEN UNTIL THE TARGET FAMILIA HAS BEEN PROVEN TO
//     EXIST — i.e. at least one non-LoRA record already carries it.
//
// Only the named stale value is touched. This script deliberately does NOT
// generalise to "any familia with no matching base" — that would sweep in
// records legitimately awaiting a base flow and turn a small, named repair
// into an unbounded one.
//
// Idempotent: the discovery query selects only `familia: 'klein-4b'` records,
// so a record already repointed to the target familia is not selected again.
//
// SAFETY: the target DB MUST be named explicitly via `--db <name>` (there is NO
// default — `.env` points `MONGODB_URI` at the live cluster). Dev/test work uses
// `noemaplane`; `noemaplane` IS the live app DB and is refused unless you also
// pass `--prod` (a deliberate, eyes-open production migration). `noema` is the
// pre-cutover legacy db and is always refused — see `_dbTarget.ts`.
//
// Run (READ, prod):  ./scripts/run-with-env.sh npx tsx scripts/migrations/2026_08_repair_klein_familia.ts --db noemaplane --prod --dry-run
//   --prod clears the live-db gate; --dry-run suppresses every write. BOTH are required to read prod.
// Run (WRITE, prod): …same, minus --dry-run…   (only when intentionally migrating production)

import { MongoClient } from 'mongodb'
import { resolveDbTarget } from './_dbTarget.js'

const TAG = '[repair-klein-familia]'

/** The stale familia this script repairs, and the value it repoints to. Fixed
 *  structural knowledge — both sides are stable identifiers, not data
 *  discovered per run. The target is still proven to exist against the live
 *  catalog before anything is written. */
export const STALE_FAMILIA = 'klein-4b'
export const TARGET_FAMILIA = 'flux2'

interface Doc {
  id?: unknown
  _id: unknown
  genus?: string
  familia?: string | null
}

export interface Outcome { id: string; from: string; to: string }

export type RepairDecision =
  | { kind: 'repair'; outcome: Outcome }
  | { kind: 'skip-no-target' }
  | { kind: 'skip-not-stale' }

/** The pure decision core: given one candidate record and whether the target familia has been
 *  PROVEN to exist against the live catalog, decide whether it is safe to repair. No I/O — every
 *  branch is covered directly by the transform test, independent of a live db. */
export function decideRepair(doc: Doc, targetProven: boolean): RepairDecision {
  if (doc.familia !== STALE_FAMILIA) return { kind: 'skip-not-stale' }
  if (!targetProven) return { kind: 'skip-no-target' }
  const id = String(doc.id ?? doc._id)
  return { kind: 'repair', outcome: { id, from: STALE_FAMILIA, to: TARGET_FAMILIA } }
}

async function main(): Promise<void> {
  const uri = process.env.MONGO_PASS ?? process.env.MONGODB_URI ?? 'mongodb://localhost:27017'
  const { db: dbName, dryRun: DRY_RUN } = resolveDbTarget(process.argv, TAG)
  const client = await MongoClient.connect(uri)
  try {
    const col = client.db(dbName).collection('intellae')

    // Step 1: prove the target familia actually exists — a non-LoRA record already carrying it.
    // Never trust the mapping blind.
    const targetProofDoc = await col.findOne({ genus: { $ne: 'lora' }, familia: TARGET_FAMILIA })
    const targetProven = targetProofDoc !== null
    if (!targetProven) {
      console.log(`${TAG} target familia '${TARGET_FAMILIA}' not proven to exist (no non-LoRA record carries it) — writing nothing.`)
    }

    const candidates = await col.find({ genus: 'lora', familia: STALE_FAMILIA }).toArray()

    const repaired: Outcome[] = []
    const skippedNoTarget: string[] = []

    for (const raw of candidates) {
      const doc = raw as unknown as Doc
      const decision = decideRepair(doc, targetProven)
      if (decision.kind === 'skip-not-stale') continue
      if (decision.kind === 'skip-no-target') { skippedNoTarget.push(String(doc.id ?? doc._id)); continue }

      repaired.push(decision.outcome)
      if (!DRY_RUN) {
        await col.updateOne({ _id: raw._id }, { $set: { familia: TARGET_FAMILIA } })
      }
    }

    const alreadyTarget = await col.countDocuments({ genus: 'lora', familia: TARGET_FAMILIA })

    console.log(`${TAG} --- repointed (${repaired.length})${DRY_RUN ? ' [dry-run, no writes]' : ''}`)
    for (const r of repaired) console.log(`${TAG}   ${r.id}: ${r.from} -> ${r.to}`)
    console.log(`${TAG} --- skipped, target not proven (${skippedNoTarget.length})`)
    for (const id of skippedNoTarget) console.log(`${TAG}   ${id}`)
    console.log(`${TAG} --- left alone, already '${TARGET_FAMILIA}': ${alreadyTarget}`)

    console.log(
      `${TAG} done — repointed=${repaired.length} target-unproven=${skippedNoTarget.length} already-${TARGET_FAMILIA}=${alreadyTarget}` +
      `${DRY_RUN ? ' [dry-run, no writes]' : ''}`,
    )
  } finally {
    await client.close()
  }
}

// Only run when executed directly — importing this module (the transform test does, for
// `decideRepair`) must never open a db connection or touch argv/process.exit.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => { console.error(`${TAG} failed:`, err); process.exit(1) })
}
