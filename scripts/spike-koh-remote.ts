// =============================================================================
// spike-koh-remote — LIVE GPU spike of the crystal REMOTE training path (Slice E)
// =============================================================================
//
// Drives a real klein-4b LoRA run on a provisioned, BILLED RunPod SECURE pod THROUGH
// the crystal RemoteAitoolkitTrainingCursor → RemoteAitkLauncher → SecurePodClient, proving
// the seams CI can't: stock torch>=2.9 base → SSH-bootstrap ai-toolkit → aitktrainer.py pulls
// the koh manifest from R2 → trains → POSTs /runner/status (Slice A) → uploads the LoRA to R2
// → fires the completion webhook → finalizer re-hosts it + registers a private Intella.
//
// To OBSERVE the pod's callbacks (the pod is remote), this stands up a tiny local receiver for
// /runner/status + /webhooks/runpod and runs the SAME finality index.ts wires (urlLoraReader →
// R2 re-host → Intella). The pod must REACH this receiver, so expose it publicly first:
//     ngrok http 7799          → set NOEMA_PUBLIC_BASE=https://<id>.ngrok.io
//
// SINKS ARE REAL: RunPod (real pod-$), R2 (.env), Mongo pinned to `noemaplane_test` (NEVER
// `noema` prod — the .env URI is the live Atlas cluster, so the DB name is hardcoded here).
//
// Run (after `node --env-file=.env --import tsx scripts/stage-koh-r2.ts` + ngrok):
//   NOEMA_PUBLIC_BASE=https://<id>.ngrok.io \
//     node --env-file=.env --import tsx scripts/spike-koh-remote.ts
// =============================================================================

import { readFileSync } from 'node:fs'
import express from 'express'
import { MongoClient } from 'mongodb'
import { SecurePodClient, makeSecurePodSshFactory } from '../src/crystal/SecurePodClient.js'
import { RemoteAitkLauncher, securePodTrainingProvisioner, DEFAULT_AITK_IMAGE } from '../src/crystal/RemoteAitkLauncher.js'
import { RemoteAitoolkitTrainingCursor } from '../src/crystal/RemoteAitoolkitTrainingCursor.js'
import { makeDatasetResolver } from '../src/crystal/datasetManifest.js'
import { makeTrainingFinalizer, urlLoraReader } from '../src/crystal/trainingFinalizer.js'
import { HuggingFaceUploader, HfHttpTransport } from '../src/crystal/HfUploader.js'
import type { ModelView } from '../src/crystal/ModelPublishAdapter.js'
import { httpMediaFetcher } from '../src/crystal/MediaFetcher.js'
import { R2Uploader } from '../src/crystal/R2Uploader.js'
import { MongoIntella } from '../src/crystal/MongoIntella.js'
import { terminatePod } from '../src/crystal/terminatePod.js'
import type { Corporum } from '../src/types/corpus.js'
import type { Actum } from '../src/types/actum.js'
import type { Actorum } from '../src/types/cursus.js'

const PORT = Number(process.env.SPIKE_PORT ?? 7799)
const STEPS = Number(process.env.SPIKE_STEPS ?? 250)
const TRIGGER = 'koh'
const FAMILIA = 'flux2-klein'
const OWNER = 'spike-anima'          // owner-scope the LoRA so we can prove triggerMap resolves it
const JOB = 'koh-remote'
const DEADLINE_MS = Number(process.env.SPIKE_DEADLINE_MS ?? 60 * 60 * 1000)   // 1h overall cap

function req(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`missing env ${name} (run with --env-file=.env)`)
  return v
}

async function main(): Promise<void> {
  const base = req('NOEMA_PUBLIC_BASE').replace(/\/$/, '')   // a tunnel/host the POD can reach
  const R2 = {
    endpoint: `https://${req('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
    accessKeyId: req('R2_ACCESS_KEY_ID'),
    secretAccessKey: req('R2_SECRET_ACCESS_KEY'),
    bucket: req('R2_BUCKET_NAME'),
    publicUrl: process.env.R2_PUBLIC_URL,
  }

  // Mongo — HARD-PINNED to noemaplane_test. Never `noema` (prod). Never the env default.
  const mongo = new MongoClient(req('MONGODB_URI'))
  await mongo.connect()
  const intellae = new MongoIntella(mongo.db('noemaplane_test').collection('intellae'))

  // The SAME finality index.ts wires for a remote completion: fetch the pod-uploaded LoRA, re-host
  // it under our durable key, register a private Intella.
  const finalize = makeTrainingFinalizer({
    reader: urlLoraReader(httpMediaFetcher), store: new R2Uploader(R2), intellae,
  })

  // The aditus the finalizer reads (triggerWord/familia/owner/name) — mirrors what the modus carries
  // (the production resolver passes the real Actum, whose aditus has all of these).
  const finalAditus = {
    triggerWord: TRIGGER, familia: FAMILIA, ownerAnimaId: OWNER, name: 'koh remote spike LoRA', steps: STEPS,
    description: 'A FLUX.2 [klein] 4B LoRA — koh, trained via the crystal remote training pod.',
  }

  // ── tiny receiver for the pod's callbacks ────────────────────────────────────
  let resolveDone!: (v: { ok: boolean; exitus?: Record<string, unknown>; error?: string }) => void
  const done = new Promise<{ ok: boolean; exitus?: Record<string, unknown>; error?: string }>(r => { resolveDone = r })

  const app = express()
  app.use(express.json({ limit: '5mb' }))
  app.post('/runner/status', (rq, rs) => {
    const p = rq.body?.progressus ?? rq.body
    const prog = p?.progress ? ` ${p.progress.done}/${p.progress.total ?? '?'} ${p.progress.unit}` : ''
    const msg = p?.message ? ` — ${p.message}` : ''
    console.log(`[status] ${p?.phase}${prog}${msg}`)
    rs.json({ continue: true })
  })
  app.post('/webhooks/runpod', async (rq, rs) => {
    rs.json({ ok: true })
    const { id, status, output, error } = rq.body ?? {}
    console.log(`[webhook] id=${id} status=${status}`)
    if (status === 'COMPLETED') {
      try {
        const loraUrl = Array.isArray(output) ? (typeof output[0] === 'string' ? output[0] : output[0]?.url) : undefined
        if (!loraUrl) throw new Error('completion carried no LoRA url')
        const actumLike = { id: JOB, aditus: finalAditus } as unknown as Actum
        const exitus = await finalize(actumLike, { status: 'completed', lastStep: STEPS, outputUrl: loraUrl })
        resolveDone({ ok: true, exitus })
      } catch (e) { resolveDone({ ok: false, error: (e as Error).message }) }
    } else {
      resolveDone({ ok: false, error: error ?? `status ${status}` })
    }
  })
  const server = app.listen(PORT, () => console.log(`[spike] receiver on :${PORT} (public ${base})`))

  // ── build the REAL remote stack ──────────────────────────────────────────────
  const securePod = new SecurePodClient(
    { apiKey: req('RUNPOD_API_KEY'), sshKeyPath: req('RUNPOD_SSH_KEY_PATH'), containerDiskGb: 60 },
    makeSecurePodSshFactory(req('RUNPOD_SSH_KEY_PATH')),
  )
  const launcher = new RemoteAitkLauncher({
    provisioner: securePodTrainingProvisioner(securePod),
    resolver: makeDatasetResolver({ corpora: {} as Corporum }),   // inline manifest → corpora unused
    r2: R2,
    statusUrl: `${base}/runner/status`,
    webhookUrl: `${base}/webhooks/runpod`,
  })
  // Fake actorum — the spike doesn't persist the Actum; it just needs the stamp to not throw.
  const actorum = { async update(_id: string, patch: Record<string, unknown>) { console.log('[actorum] update', patch); return {} as Actum } } as Pick<Actorum, 'update'>
  const cursor = new RemoteAitoolkitTrainingCursor({ launcher, actorum, maxTrainingSeconds: 7200 })

  // The koh manifest is already staged to R2 (scripts/stage-koh-r2.ts). Pass it inline.
  // SPIKE_STRIP_CAPTIONS=1 drops the captions → exercises the on-pod Qwen3-VL auto-captioner.
  let manifest = readFileSync('scripts/.koh-manifest.json', 'utf8').trim()
  if (process.env.SPIKE_STRIP_CAPTIONS === '1') {
    manifest = JSON.stringify((JSON.parse(manifest) as Array<{ url: string }>).map(({ url }) => ({ url })))
    console.log('[spike] stripped captions → forcing on-pod auto-captioning (images-only)')
  }
  const actum = {
    id: JOB, modusId: 'modus.aitoolkit-training',
    aditus: { jobId: JOB, dataset: manifest, baseModel: 'klein-4b', triggerWord: TRIGGER, steps: STEPS },
  } as unknown as Actum

  console.log(`[spike] image=${DEFAULT_AITK_IMAGE} · job=${JOB} · ${STEPS} steps · provisioning a SECURE pod…`)
  const t0 = Date.now()
  let podId: string | undefined
  try {
    const result = await cursor.run(actum)
    if (result.kind !== 'async') throw new Error(`expected async result, got ${result.kind}`)
    podId = result.externusJobId
    console.log(`[spike] pod launched: ${podId} (provision+bootstrap ${Math.round((Date.now() - t0) / 1000)}s)`)
    console.log('[spike] waiting for the pod to pull weights, train, and call back…')
  } catch (e) {
    console.error('[spike] dispatch FAILED:', (e as Error).message)
    server.close(); await mongo.close(); process.exit(1)
  }

  // ── await the completion (or the deadline) ───────────────────────────────────
  const timeout = new Promise<{ ok: false; error: string }>(r => setTimeout(() => r({ ok: false, error: `deadline ${DEADLINE_MS}ms` }), DEADLINE_MS))
  const outcome = await Promise.race([done, timeout])
  console.log(`[spike] outcome after ${Math.round((Date.now() - t0) / 1000)}s:`, JSON.stringify(outcome, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)))

  // Close the loop: the registered LoRA must be findable AND trigger-resolvable for its owner.
  if (outcome.ok && outcome.exitus) {
    const loraId = String(outcome.exitus.loraId ?? '')
    const found = loraId ? await intellae.find(loraId) : null
    console.log('[spike] Intella.find(loraId):', found ? `${found.id} familia=${found.familia} trigger=${found.trigger}` : 'NOT FOUND')
    const map = await intellae.triggerMap(FAMILIA, OWNER)
    console.log(`[spike] triggerMap(${FAMILIA}, ${OWNER}) resolves '${TRIGGER}':`, map.get(TRIGGER)?.some(i => i.id === loraId) ? 'YES ✓' : 'no')

    // ── publish to HuggingFace (FIRST live exercise of HfHttpTransport) ────────────
    // SPIKE_PUBLISH=1 + HF_TOKEN → push the registered LoRA to HF_ORG/HF_SLUG with the
    // new model card. This is the only LIVE-UNVERIFIED seam in the publish rail.
    const found2 = loraId ? await intellae.find(loraId) : null
    if (process.env.SPIKE_PUBLISH === '1' && process.env.HF_TOKEN && found2) {
      const org = process.env.HF_ORG ?? 'ms2stationthis'
      const slug = process.env.HF_SLUG ?? `${TRIGGER}-klein`
      const model: ModelView = {
        nomen: found2.nomen, genus: found2.genus, sources: found2.sources,
        ...(found2.slug !== undefined ? { slug: found2.slug } : {}),
        ...(found2.trigger !== undefined ? { trigger: found2.trigger } : {}),
        ...(found2.familia !== undefined ? { familia: found2.familia } : {}),
        ...(found2.description !== undefined ? { description: found2.description } : {}),
        ...(found2.trainingSteps !== undefined ? { trainingSteps: found2.trainingSteps } : {}),
        ...(found2.provenance !== undefined ? { provenance: found2.provenance } : {}),
      }
      console.log(`[spike] publishing → https://huggingface.co/${org}/${slug} …`)
      try {
        const uploader = new HuggingFaceUploader({ transport: new HfHttpTransport({ token: process.env.HF_TOKEN }), fetcher: httpMediaFetcher })
        const { externalRef } = await uploader.upload({ account: org, slug, private: false, model })
        console.log(`[spike] PUBLISHED ✓ ${externalRef}`)
      } catch (e) { console.error('[spike] publish FAILED:', (e as Error).message) }
    } else if (process.env.SPIKE_PUBLISH === '1') {
      console.log('[spike] publish skipped — need HF_TOKEN (and a registered LoRA).')
    }
  }

  // Always terminate the pod — it does not self-terminate.
  if (podId) { console.log(`[spike] terminating pod ${podId}`); await terminatePod(req('RUNPOD_API_KEY'), podId).catch(() => {}) }
  server.close(); await mongo.close()
  console.log('[spike] done.')
  process.exit(outcome.ok ? 0 : 1)
}

main().catch((err) => { console.error('[spike] FAILED:', err); process.exit(1) })
