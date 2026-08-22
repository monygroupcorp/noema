// =============================================================================
// triage-corpus — the offline batch-moderation READ (spec §5, worklist A3)
// =============================================================================
//
// Runs the host-side NSFW router over a batch of stored Acta and writes one
// TriageScore per produced-media url into the `triage` collection (SEPARATE from the
// live `editiones` publish store). It MEASURES — how much flagged material exists +
// the router's flag-rate on real content — and prioritizes human review. It NEVER
// publishes and NEVER reports (spec §5, §0-A). Nothing here acts on a verdict.
//
//   NSFW_MODEL_PATH=/models/falconsai.onnx MONGODB_URI=... DB_NAME=noemaplane \
//     npx tsx scripts/triage-corpus.ts --limit 500
//   ...                                  npx tsx scripts/triage-corpus.ts --acta ids.txt --force
//
// LIVE-UNVERIFIED: the ONNX inference needs the real exported weights; this has never
// been run on staging/GPU. It is CPU-host batch (the router is small) — no GPU pod.
//
// SAFETY: writes to the `triage` collection in DB_NAME. Refuses DB_NAME='noema' (the
// production database — memory feedback_noema_is_production_db) unless --allow-prod is
// passed; default your target to noemaplane.
// =============================================================================

import { MongoClient } from 'mongodb'
import { readFileSync } from 'node:fs'
import { MongoActorum } from '../src/crystal/MongoActorum.js'
import { MongoTriageStore } from '../src/crystal/MongoTriageStore.js'
import { BatchTriage } from '../src/crystal/BatchTriage.js'
import { httpMediaFetcher } from '../src/crystal/MediaFetcher.js'
import type { SexualContentRouter } from '../src/crystal/SexualContentRouter.js'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const has = (name: string): boolean => process.argv.includes(name)

async function main(): Promise<void> {
  const URI = process.env.MONGODB_URI
  const DB = process.env.DB_NAME ?? 'noemaplane'
  if (!URI) { console.error('MONGODB_URI is required'); process.exit(1) }
  if (DB === 'noema' && !has('--allow-prod')) {
    console.error("Refusing to run against DB_NAME='noema' (production). Set DB_NAME=noemaplane, or pass --allow-prod if you REALLY mean it.")
    process.exit(1)
  }
  const modelPath = process.env.NSFW_MODEL_PATH
  if (!modelPath) {
    console.error('NSFW_MODEL_PATH is required (the exported ONNX NSFW model, provisioned out-of-band).')
    process.exit(1)
  }

  // The detection impl is PRIVATE (ADR-0012 §49) — loaded via a guarded dynamic import
  // (variable path) so a public checkout without the module fails loudly here, not at parse.
  const privatePath = '../src/private/compliance/index.js'
  let createOnnxNsfwRouter: (opts: { modelPath: string; threshold?: number; source?: string }) => Promise<SexualContentRouter>
  try {
    ;({ createOnnxNsfwRouter } = (await import(privatePath)) as {
      createOnnxNsfwRouter: (opts: { modelPath: string; threshold?: number; source?: string }) => Promise<SexualContentRouter>
    })
  } catch {
    console.error('Private compliance module (src/private/compliance) not present — cannot build the NSFW router.')
    process.exit(1)
    return
  }

  const client = new MongoClient(URI)
  await client.connect()
  try {
    const db = client.db(DB)
    const store = new MongoTriageStore(db.collection('triage'))
    await store.ensureIndexes()
    const actorum = new MongoActorum(db.collection(process.env.ACTA_COLLECTION ?? 'acta'))

    const router = await createOnnxNsfwRouter({
      modelPath,
      ...(process.env.NSFW_THRESHOLD ? { threshold: Number(process.env.NSFW_THRESHOLD) } : {}),
      source: process.env.NSFW_MODEL_SOURCE ?? 'falconsai-nsfw',
    })

    // The work-list: explicit ids from --acta <file> (newline-delimited), else the most
    // recent completed Acta with produced media (--limit, default 500).
    let actumIds: string[]
    const file = arg('--acta')
    if (file) {
      actumIds = readFileSync(file, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean)
    } else {
      const limit = Number(arg('--limit') ?? 500)
      const docs = await db.collection(process.env.ACTA_COLLECTION ?? 'acta')
        .find<{ id: string }>({ status: 'completus', exitus: { $exists: true } }, { projection: { id: 1 } })
        .sort({ inceptum: -1 }).limit(limit).toArray()
      actumIds = docs.map((d) => String(d.id))
    }

    console.log(`[triage] DB=${DB} model=${modelPath} acta=${actumIds.length} force=${has('--force')}`)
    const summary = await new BatchTriage({ fetcher: httpMediaFetcher, router, store, actorum })
      .runActa(actumIds, { force: has('--force') })

    const totals = await store.stats()
    console.log('[triage] this run:', summary)
    console.log('[triage] store totals:', totals)
    const top = await store.listFlagged({ limit: 20, pendingOnly: true })
    console.log(`[triage] top ${top.length} flagged (pending review):`)
    for (const t of top) console.log(`  ${(t.confidence ?? 0).toFixed(3)}  ${t.actumId}  ${t.url}`)
  } finally {
    await client.close()
  }
}

main().catch((err) => { console.error(err); process.exit(1) })
