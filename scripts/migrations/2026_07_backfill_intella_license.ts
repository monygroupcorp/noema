#!/usr/bin/env -S npx tsx
// =============================================================================
// Backfill `Intella.license` + `Intella.commercialUse` across the catalog.
// =============================================================================
//
// The go-public gate (CrystalApi.publish → isCatalogEligible) reads a model's
// `commercialUse` verdict to decide whether it may be promoted to the public
// (commercial) catalog. Records that predate license classification (legacy
// imports, early seeds) have NO verdict — and an ABSENT verdict is treated as
// "not gated" (legacy passthrough), so an un-classified model could slip onto
// the public catalogue unchecked. This sweep closes that hole: it stamps a
// verdict on every catalog record so nothing is silently ungated.
//
// It derives the verdict via the SAME classifier the admin `reclassify` path
// uses (`classifyModelLicense`: provenance.base > nomen > familia). Fail-closed:
// an indeterminable base is stamped `commercialUse:'unknown'` — which the gate
// REFUSES for public promotion (so a swept 'unknown' is stricter than an unset
// verdict, on purpose). An operator then clears real cases via
// `PUT /v1/models/:id/license` (CrystalApi.setModelLicense).
//
// Idempotent: only records MISSING `commercialUse` are touched. To FORCE
// re-derivation over records that already carry a verdict (e.g. after a
// classifier fix), pass `--reclassify`.
//
// CANONICAL MODELS ARE SKIPPED (`canonica: true`). Their license is authored
// authoritatively in `src/crystal/seeds/intellae.ts` — the seed nomen alone is
// often too coarse for the classifier (a Qwen3-VL encoder named "…Krea 2…"
// mis-hits the Krea row; a 4B-based LoRA whose name omits "4B" mis-hits the NC
// klein row). Update canonical verdicts by editing the seed + RE-SEEDING, not by
// sweeping. This sweep owns the imported/legacy tail only.
//
// SAFETY: the target DB MUST be named explicitly via `--db <name>` (there is NO
// default — `.env` points `MONGODB_URI` at the live Atlas cluster). Dev/test work
// uses `noemaplane`; `noemaplane` IS the live app DB and is refused unless you also
// pass `--prod` (a deliberate, eyes-open production migration). `noema` is the
// pre-cutover legacy db and is always refused — see `_dbTarget.ts`.
//
// Run (READ, prod):  ./scripts/run-with-env.sh npx tsx scripts/migrations/2026_07_backfill_intella_license.ts --db noemaplane --prod --dry-run
//   --prod clears the live-db gate; --dry-run suppresses every write. BOTH are required to read prod.
//   Add --reclassify to also re-derive already-stamped records.
// Run (WRITE, prod): …same, minus --dry-run…   (only when intentionally migrating production)

import { MongoClient } from 'mongodb'
import { classifyModelLicense } from '../../src/crystal/modelLicense.js'
import { resolveDbTarget } from './_dbTarget.js'

const TAG = '[backfill-license]'
const RECLASSIFY = process.argv.includes('--reclassify')

async function main(): Promise<void> {
  const uri = process.env.MONGO_PASS ?? process.env.MONGODB_URI ?? 'mongodb://localhost:27017'
  const { db: dbName, dryRun: DRY_RUN } = resolveDbTarget(process.argv, TAG)
  const client = await MongoClient.connect(uri)
  try {
    const col = client.db(dbName).collection('intellae')
    // Canonical models are seed-owned (see header) — never swept. Default: only records with no
    // verdict yet. --reclassify: re-derive every NON-canonical record.
    const notCanonical = { canonica: { $ne: true } }
    const query = RECLASSIFY
      ? notCanonical
      : { ...notCanonical, $or: [{ commercialUse: { $exists: false } }, { commercialUse: null }] }
    const docs = await col.find(query).toArray()
    console.log(`[backfill-license] ${dbName}.intellae — ${docs.length} non-canonical record(s) to classify${RECLASSIFY ? ' (--reclassify: all)' : ' (missing commercialUse)'}`)

    const tally: Record<string, number> = { yes: 0, no: 0, conditional: 0, unknown: 0 }
    for (const doc of docs) {
      const { license, commercialUse } = classifyModelLicense({
        provenance: doc.provenance,
        nomen: doc.nomen,
        familia: doc.familia,
      })
      tally[commercialUse] = (tally[commercialUse] ?? 0) + 1
      const base = doc.provenance?.base || doc.nomen || doc.familia || '(none)'
      console.log(`[backfill-license]   ${doc.id} (${doc.genus}) base='${base}' → license='${license}' commercialUse='${commercialUse}'${DRY_RUN ? ' [dry-run]' : ''}`)
      if (!DRY_RUN) await col.updateOne({ _id: doc._id }, { $set: { license, commercialUse } })
    }
    console.log(
      `[backfill-license] done — ${docs.length} classified ` +
      `(yes=${tally.yes} conditional=${tally.conditional} no=${tally.no} unknown=${tally.unknown})` +
      `${DRY_RUN ? ' [dry-run, no writes]' : ''}`,
    )
    if (tally.unknown > 0) {
      console.log(`[backfill-license] NOTE: ${tally.unknown} record(s) are fail-closed 'unknown' — they cannot auto-promote to the public catalog; clear real ones via PUT /v1/models/:id/license.`)
    }
  } finally {
    await client.close()
  }
}

main().catch(err => { console.error('[backfill-license] failed:', err); process.exit(1) })
