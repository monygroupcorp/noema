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
// `noema` is the live app DB. The script refuses to run against `noema` unless
// you also pass `--prod` (a deliberate, eyes-open production migration).
//
// Run (dev):   ./scripts/run-with-env.sh npx tsx scripts/migrations/2026_06_backfill_intella_familia.ts --db noemaplane
//   add  --dry-run  to report without writing.
// Run (prod):  …same… --db noema --prod        (only when intentionally migrating production)

import { MongoClient } from 'mongodb'
import { inferFamilia } from '../../src/crystal/inferFamilia.js'

const DRY_RUN = process.argv.includes('--dry-run')

/** Read `--db <name>`; no default — an unset target is an error, not a guess at production. */
function targetDb(): string {
  const i = process.argv.indexOf('--db')
  const name = i >= 0 ? process.argv[i + 1] : undefined
  if (!name) {
    console.error('[backfill-familia] refusing to run: pass --db <name> (e.g. --db noemaplane). No default — .env points at the live cluster.')
    process.exit(1)
  }
  if (name === 'noema' && !process.argv.includes('--prod')) {
    console.error('[backfill-familia] refusing to target the PRODUCTION db "noema" without --prod. Use --db noemaplane for dev/test.')
    process.exit(1)
  }
  return name
}

async function main(): Promise<void> {
  const uri = process.env.MONGO_PASS ?? process.env.MONGODB_URI ?? 'mongodb://localhost:27017'
  const dbName = targetDb()
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
