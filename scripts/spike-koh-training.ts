// =============================================================================
// spike-koh-training — LIVE GPU spike of the crystal LOCAL training path (A+B+C)
// =============================================================================
//
// Drives a real 500-step ai-toolkit klein-4b LoRA run on /mnt/data/datasets/koh
// THROUGH the crystal AitoolkitTrainingCursor — proving the seams CI can't:
//   seed Job row → docker run → poll ui_trainer row → Progressus timeline (Slice A)
//   → completed → fsLoraReader finds output/koh/koh.safetensors (Slice B)
//   → host in R2 + register a private Intella → read it back (resolvable).
//
// SINKS ARE REAL: R2 (from .env) + Mongo pinned to `noemaplane_test` (NEVER `noema`
// prod — the .env URI is the live Atlas cluster, so the DB name is hardcoded here).
//
// Run (Node 22+ for node:sqlite; weights already in HF cache):
//   node --env-file=.env --import tsx scripts/spike-koh-training.ts
//
// Pre-req: GPU free (nvidia-smi). It ties up the 4090 for ~10–25 min.
// =============================================================================

import { MongoClient } from 'mongodb'
import { AitoolkitTrainingCursor } from '../src/crystal/AitoolkitTrainingCursor.js'
import { SqliteAitkJobStore } from '../src/crystal/AitkJobStore.js'
import { DockerAitkSpawner } from '../src/crystal/AitkSpawner.js'
import { R2Uploader } from '../src/crystal/R2Uploader.js'
import { MongoIntella } from '../src/crystal/MongoIntella.js'
import { makeTrainingFinalizer, fsLoraReader } from '../src/crystal/trainingFinalizer.js'
import { fsConfigWriter } from '../src/crystal/aitkConfig.js'
import { registerProgressusRecorder } from '../src/execution/progressusSink.js'
import { withTrace, makeTraceContext } from '../src/lib/trace.js'
import type { Actum } from '../src/types/actum.js'

const AITK = '/home/rth/projects/ai/training/ai-toolkit-klein'
const DATASET = '/mnt/data/datasets/koh'
const HF_CACHE = '/home/rth/.cache/huggingface'
const IMAGE = 'stationthis-klein:1'
const JOB = 'koh2'                      // fresh job id → fresh output dir (no reuse of the prior run)
const STEPS = 250
const TRIGGER = 'koh'
const FAMILIA = 'flux2-klein'
const OWNER = 'spike-anima'            // owner-scope the LoRA so we can prove triggerMap resolves it

function req(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`missing env ${name} (run with --env-file=.env)`)
  return v
}

async function main(): Promise<void> {
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

  const cursor = new AitoolkitTrainingCursor({
    store: new SqliteAitkJobStore(`${AITK}/aitk_db.db`),
    spawner: new DockerAitkSpawner(),
    image: IMAGE,
    mounts: [
      { host: AITK, container: '/aitk' },
      { host: DATASET, container: DATASET },          // bind at its own absolute path (config refs it)
      { host: HF_CACHE, container: '/root/.cache/huggingface' },
    ],
    shmSize: '8g',
    pollIntervalMs: 2000,
    timeoutMs: 60 * 60 * 1000,                         // 1h cap — a hung run trips this
    // the modus writes the generated config into the mounted clone's config/ dir
    writeConfig: fsConfigWriter(`${AITK}/config`),
    resolveOutput: makeTrainingFinalizer({
      reader: fsLoraReader(`${AITK}/output`),
      store: new R2Uploader(R2),
      intellae,
    }),
  })

  // Watch the Slice-A timeline live.
  registerProgressusRecorder(async (_id, p) => {
    const prog = p.progress ? ` ${p.progress.done}/${p.progress.total ?? '?'} ${p.progress.unit}` : ''
    const eta = p.etaMs ? ` · eta ${Math.round(p.etaMs / 1000)}s` : ''
    const msg = p.message ? ` — ${p.message}` : ''
    console.log(`[progress] ${p.phase}${prog}${eta}${msg}`)
  })

  const actum = {
    id: 'spike-koh',
    modusId: 'modus.aitoolkit-training',
    // High-level inputs ONLY — the modus synthesises the training config from these.
    aditus: {
      jobId: JOB, dataset: DATASET, baseModel: FAMILIA, triggerWord: TRIGGER, steps: STEPS, gpuId: '0',
      familia: FAMILIA, ownerAnimaId: OWNER, name: 'koh spike LoRA',
    },
  } as unknown as Actum

  console.log(`[spike] launching ${IMAGE} · job=${JOB} · dataset=${DATASET} · ${STEPS} steps`)
  const t0 = Date.now()
  const result = await withTrace(makeTraceContext({ actumId: 'spike-koh' }), () => cursor.run(actum))
  console.log(`[spike] cursor.run done in ${Math.round((Date.now() - t0) / 1000)}s`)
  console.log('[spike] EXITUS', JSON.stringify(result, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2))

  // Close the loop: the registered LoRA must be findable AND trigger-resolvable for its owner.
  const exitus = result.kind === 'sync' ? (result.exitus.exitus as Record<string, unknown>) : {}
  const loraId = String(exitus.loraId ?? '')
  const found = loraId ? await intellae.find(loraId) : null
  console.log('[spike] Intella.find(loraId):', found ? `${found.id} familia=${found.familia} trigger=${found.trigger} sizeGb=${found.sizeGb}` : 'NOT FOUND')
  const map = await intellae.triggerMap(FAMILIA, OWNER)
  console.log(`[spike] triggerMap(${FAMILIA}, ${OWNER}) resolves '${TRIGGER}':`, map.get(TRIGGER)?.some(i => i.id === loraId) ? 'YES ✓' : 'no')

  await mongo.close()
  console.log('[spike] done.')
}

main().then(() => process.exit(0)).catch((err) => { console.error('[spike] FAILED:', err); process.exit(1) })
