#!/usr/bin/env -S npx tsx
// =============================================================================
// Disable Market_Domina_FLUX2 in the public catalogue.
// =============================================================================
//
// `2026_11_backfill_lora_sources.ts` tagged this one record `sources-unrecoverable`:
// its `sources[]` names no file that serves anonymously, so every prompt that
// triggers it fails on the pod. Every OTHER record the same run tagged was
// deliberately dropped from the DB (ruling 2026-11-14) — this one is the named
// exception, kept rather than deleted because it may come back once its CivitAI
// source (model 1059501) returns.
//
// The ruling: "Disable (disabled:true) rather than hard-delete ... so usage
// history survives." `Intella.disabled` (added alongside this script) is the
// kill switch `readPublicCatalog` now honours — it is the one lever that pulls
// a `canonica: true` record out of the public catalog without touching the
// canonica invariant (canonica is otherwise public by definition).
//
// Only the one named record is touched — this is a repair of one exception,
// not a sweep. Idempotent: an already-disabled record is reported as a no-op.
//
// SAFETY: `--db <name>` is required; see _dbTarget.ts.
//
// Run (READ, prod):  ./scripts/run-with-env.sh npx tsx scripts/migrations/2026_11_disable_market_domina.ts --db <LIVE_DB> --prod --dry-run
// Run (WRITE, prod): …same, minus --dry-run…

import { MongoClient } from 'mongodb'
import { resolveDbTarget, DbTargetRefusedError } from './_dbTarget.js'

const TAG = '[disable-market-domina]'

/** The one record this script is allowed to touch. Fixed — not discovered per run. */
export const TARGET_ID = '6840901d0c6e432ada9d0997'
export const TARGET_NOMEN = 'Market_Domina_FLUX2'

interface Doc {
  id?: unknown
  nomen?: unknown
  disabled?: unknown
}

export type Decision =
  | { kind: 'disable' }
  | { kind: 'already-disabled' }
  | { kind: 'refuse'; why: string }

/** Pure: decide what to do given the record read back, before any write. */
export function decide(doc: Doc | null): Decision {
  if (!doc) return { kind: 'refuse', why: `no record with id "${TARGET_ID}" — nothing to disable` }
  if (doc.nomen !== TARGET_NOMEN) {
    return {
      kind: 'refuse',
      why: `record "${TARGET_ID}" carries nomen "${String(doc.nomen)}", not "${TARGET_NOMEN}" — refusing in case the id is stale or reused`,
    }
  }
  if (doc.disabled === true) return { kind: 'already-disabled' }
  return { kind: 'disable' }
}

async function main(): Promise<void> {
  let target: { db: string; dryRun: boolean }
  try {
    target = resolveDbTarget(process.argv, TAG)
  } catch (err) {
    if (err instanceof DbTargetRefusedError) {
      console.error(err.message)
      process.exit(1)
    }
    throw err
  }
  const { db: dbName, dryRun } = target

  const uri = process.env.MONGO_PASS ?? process.env.MONGODB_URI ?? 'mongodb://localhost:27017'
  const client = await MongoClient.connect(uri)
  try {
    const col = client.db(dbName).collection('intellae')
    console.log(`${TAG} ${dbName}.intellae — reading "${TARGET_ID}"`)
    const doc = (await col.findOne({ id: TARGET_ID })) as Doc | null

    const decision = decide(doc)
    if (decision.kind === 'refuse') {
      console.error(`${TAG} REFUSING: ${decision.why}`)
      process.exit(1)
    }
    if (decision.kind === 'already-disabled') {
      console.log(`${TAG} "${TARGET_NOMEN}" (${TARGET_ID}) is already disabled — nothing to do (idempotent no-op).`)
      return
    }
    if (dryRun) {
      console.log(`${TAG} DRY RUN — would set { disabled: true, mutatum: <now> } on "${TARGET_NOMEN}" (${TARGET_ID}). No write performed.`)
      return
    }
    const res = await col.updateOne({ id: TARGET_ID, disabled: { $ne: true } }, { $set: { disabled: true, mutatum: new Date() } })
    if (res.matchedCount !== 1) {
      console.error(`${TAG} write matched 0 documents — the record changed since it was read; re-run to pick up the new state.`)
      process.exit(1)
    }
    console.log(`${TAG} disabled "${TARGET_NOMEN}" (${TARGET_ID}). Usage history and the record itself are untouched — it is hidden from the public catalog, not deleted.`)
  } finally {
    await client.close()
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(`${TAG} failed:`, err)
    process.exit(1)
  })
}
