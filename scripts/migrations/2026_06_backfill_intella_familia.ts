#!/usr/bin/env -S npx tsx
// =============================================================================
// Backfill `Intella.familia` across the imported catalog.
// =============================================================================
//
// The imported catalog predates the first-class `familia` field — it encodes
// family loosely in `tags` (and, failing that, the name/dest). `triggerMap` /
// `findByTrigger` now key on `familia` (exact equality), so any LoRA without it
// is invisible to trigger resolution. This populates `familia` ONCE using the
// canonical tag/name heuristic (`inferFamilia`, the same one `MongoIntella.upsert`
// self-heals with going forward), so the runtime can stop deriving family from
// tags (see BulletinModelCatalog convergence).
//
// Idempotent: only docs MISSING a non-empty `familia` are touched; docs where
// nothing recognizable can be inferred are left as-is (reported as skipped).
//
// SAFETY: the target DB MUST be named explicitly via `--db <name>` (there is NO
// default — `.env` points `MONGODB_URI` at the live Atlas cluster, so a silent
// default would risk writing to PRODUCTION). Dev/test work uses `noemaplane`;
// `noemaplane` IS the live app DB and is refused unless you also pass `--prod`
// (a deliberate, eyes-open production migration). `noema` is the pre-cutover
// legacy db and is always refused — see `_dbTarget.ts`.
//
// Run (dev):   ./scripts/run-with-env.sh npx tsx scripts/migrations/2026_06_backfill_intella_familia.ts --db noemaplane --dry-run
//   drop --dry-run to write.
// Run (prod):  …same… --db noemaplane --prod        (only when intentionally migrating production)

import { MongoClient } from 'mongodb'
import { inferFamilia } from '../../src/crystal/inferFamilia.js'
import { resolveDbTarget } from './_dbTarget.js'

const TAG = '[backfill-familia]'

async function main(): Promise<void> {
  const uri = process.env.MONGO_PASS ?? process.env.MONGODB_URI ?? 'mongodb://localhost:27017'
  const { db: dbName, dryRun: DRY_RUN } = resolveDbTarget(process.argv, TAG)
  const client = await MongoClient.connect(uri)
  try {
    const col = client.db(dbName).collection('intellae')
    // Records with no usable familia (absent or empty string).
    const docs = await col.find({ $or: [{ familia: { $exists: false } }, { familia: '' }] }).toArray()
    console.log(`[backfill-familia] ${dbName}.intellae — ${docs.length} record(s) without familia`)

    let set = 0
    let skipped = 0
    for (const doc of docs) {
      const familia = inferFamilia(doc)
      if (!familia) { skipped++; continue }
      console.log(`[backfill-familia]   ${doc.id} (${doc.genus}) → familia='${familia}'${DRY_RUN ? ' [dry-run]' : ''}`)
      if (!DRY_RUN) await col.updateOne({ _id: doc._id }, { $set: { familia } })
      set++
    }
    console.log(`[backfill-familia] done — ${set} set, ${skipped} unrecognized (left untouched)${DRY_RUN ? ' [dry-run, no writes]' : ''}`)
  } finally {
    await client.close()
  }
}

main().catch(err => { console.error('[backfill-familia] failed:', err); process.exit(1) })
