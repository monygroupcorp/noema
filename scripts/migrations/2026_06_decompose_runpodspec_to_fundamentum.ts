#!/usr/bin/env -S npx tsx
// =============================================================================
// Decompose `Modus.runpodSpec` → a Fundamentum reference (ADR-0005).
// =============================================================================
//
// The substrate (image + runtime + base weights) moved off the flow onto a
// first-class `Fundamentum`; the flow now references it (fundamentumId +
// fundamentumVersio) and keeps only its form (workflowTemplate, seedInputKey,
// cookFlags). Canonical essentiae self-heal on boot (re-seed sets the new
// fields), BUT user-saved flows (deriveSavedModus copied runpodSpec wholesale)
// have no fundamentumId and would fail to compile. This migration:
//   1. seeds the canonical Fundamenta into `<db>.fundamenta`,
//   2. for every `modi` doc with a runpodSpec and NO fundamentumId:
//      - maps it to a canonical Fundamentum by its workflow template,
//      - hoists workflowTemplate / seedInputKey / defaultCookFlags to top-level,
//      - sets fundamentumId + fundamentumVersio,
//      - strips the base weights that now live on the fundament (keeps any
//        flow-specific extras, e.g. pinned LoRAs),
//      - $unset runpodSpec.
//
// Idempotent: only docs WITH runpodSpec and WITHOUT fundamentumId are touched.
//
// SAFETY: requires explicit `--db <name>` (no default — .env points at the live
// cluster). `noemaplane` IS the live app db and requires `--prod`; the pre-cutover
// legacy db `noema` is always refused — see `_dbTarget.ts`. `--dry-run` reports.
//
// Run:  ./scripts/run-with-env.sh npx tsx scripts/migrations/2026_06_decompose_runpodspec_to_fundamentum.ts --db noemaplane --dry-run
//   drop --dry-run to write.

import { MongoClient } from 'mongodb'
import { CANONICAL_FUNDAMENTA, FUNDAMENTUM_FLUX_COMFYUI, FUNDAMENTUM_SD15_COMFYUI } from '../../src/crystal/seeds/fundamenta.js'
import type { Fundamentum } from '../../src/types/fundamentum.js'
import { resolveDbTarget } from './_dbTarget.js'

const TAG = '[decompose-runpodspec]'

/** Map a flow's workflow template → the canonical Fundamentum it should reference. */
function fundamentFor(workflowTemplate: string | undefined): Fundamentum | undefined {
  switch (workflowTemplate) {
    case 'flux-schnell': case 'flux-schnell-no-url': return FUNDAMENTUM_FLUX_COMFYUI
    case 'sd15': return FUNDAMENTUM_SD15_COMFYUI
    default: return undefined
  }
}

interface RunpodSpecDoc {
  imageId?: string; imageVersion?: string; runtime?: string
  workflowTemplate?: string; workflowTemplateVersion?: string
  seedInputKey?: string; defaultCookFlags?: unknown
}

async function main(): Promise<void> {
  const uri = process.env.MONGO_PASS ?? process.env.MONGODB_URI ?? 'mongodb://localhost:27017'
  const { db: dbName, dryRun: DRY_RUN } = resolveDbTarget(process.argv, TAG)
  const client = await MongoClient.connect(uri)
  try {
    const db = client.db(dbName)

    // 1. Seed the canonical fundamenta (parity with boot; idempotent upsert).
    const funds = db.collection('fundamenta')
    for (const f of CANONICAL_FUNDAMENTA) {
      if (!DRY_RUN) await funds.updateOne({ id: f.id, versio: f.versio }, { $set: { ...f } }, { upsert: true })
    }
    console.log(`[decompose-runpodspec] ${dbName}.fundamenta — seeded ${CANONICAL_FUNDAMENTA.length} canonical fundamenta${DRY_RUN ? ' [dry-run]' : ''}`)

    // 2. Decompose modi docs.
    const modi = db.collection('modi')
    const docs = await modi.find({ runpodSpec: { $exists: true }, fundamentumId: { $exists: false } }).toArray()
    console.log(`[decompose-runpodspec] ${docs.length} modi doc(s) with runpodSpec and no fundamentumId`)

    let migrated = 0, skipped = 0
    for (const doc of docs) {
      const rp = (doc.runpodSpec ?? {}) as RunpodSpecDoc
      const fund = fundamentFor(rp.workflowTemplate)
      if (!fund) {
        console.log(`[decompose-runpodspec]   SKIP ${doc.id} — unknown workflowTemplate '${rp.workflowTemplate}' (no fundament mapping); left untouched`)
        skipped++
        continue
      }
      const baseIds = new Set((fund.intellae ?? []).map(w => w.id))
      const keptIntellae = ((doc.intellae ?? []) as Array<{ id: string; role: string }>).filter(w => !baseIds.has(w.id))

      const set: Record<string, unknown> = {
        fundamentumId: fund.id,
        fundamentumVersio: fund.versio,
        workflowTemplate: rp.workflowTemplate,
        workflowTemplateVersion: rp.workflowTemplateVersion ?? '1',
        intellae: keptIntellae,
      }
      if (rp.seedInputKey !== undefined) set.seedInputKey = rp.seedInputKey
      if (rp.defaultCookFlags !== undefined) set.defaultCookFlags = rp.defaultCookFlags

      console.log(`[decompose-runpodspec]   ${doc.id} (${doc.canonica ? 'canonical' : 'saved'}${doc.fonte ? `, fonte=${doc.fonte}` : ''}) → fundamentumId='${fund.id}', kept ${keptIntellae.length} extra weight(s)${DRY_RUN ? ' [dry-run]' : ''}`)
      if (!DRY_RUN) await modi.updateOne({ _id: doc._id }, { $set: set, $unset: { runpodSpec: '' } })
      migrated++
    }
    console.log(`[decompose-runpodspec] done — ${migrated} migrated, ${skipped} skipped${DRY_RUN ? ' [dry-run, no writes]' : ''}`)
  } finally {
    await client.close()
  }
}

main().catch(err => { console.error('[decompose-runpodspec] failed:', err); process.exit(1) })
