#!/usr/bin/env -S npx tsx
// =============================================================================
// train-local.ts — train a LoRA on a LOCAL dataset folder, any base model
// =============================================================================
//
// Generalizes the backlog driver to an arbitrary local dataset (image+.txt pairs)
// and base model, through the same crystal pipeline (AitoolkitTrainingCursor →
// withLocalSamples(finalizer) → HF publish). The base model picks the ai-toolkit
// clone + arch preset; the GPU does ONE heavy job at a time, so stop ComfyUI first.
//
//   node --env-file=.env --import tsx scripts/train-local.ts \
//     --dataset /mnt/data/datasets/impresstation --trigger stationthis \
//     --slug impresstation --base krea2-raw --familia krea2 --steps 3000 [--publish]
//
// Env: R2_*, MONGODB_URI (→ DB, default noemaplane), HF_TOKEN, HF_ORG (default ms2stationthis).
// =============================================================================

import { MongoClient } from 'mongodb'
import { AitoolkitTrainingCursor } from '../src/crystal/AitoolkitTrainingCursor.js'
import { SqliteAitkJobStore } from '../src/crystal/AitkJobStore.js'
import { DockerAitkSpawner } from '../src/crystal/AitkSpawner.js'
import { fsConfigWriter, deriveSamplePrompts } from '../src/crystal/aitkConfig.js'
import { makeTrainingFinalizer, fsLoraReader, withLocalSamples } from '../src/crystal/trainingFinalizer.js'
import { R2Uploader } from '../src/crystal/R2Uploader.js'
import { MongoIntella } from '../src/crystal/MongoIntella.js'
import { HuggingFaceUploader, HfHttpTransport } from '../src/crystal/HfUploader.js'
import type { ModelView } from '../src/crystal/ModelPublishAdapter.js'
import { httpMediaFetcher } from '../src/crystal/MediaFetcher.js'
import { MemoryActorum } from '../src/execution/MemoryActorum.js'
import { CrystalApi, type CrystalApiDeps } from '../src/allocutio/api/CrystalApi.js'
import { registerProgressusRecorder } from '../src/execution/progressusSink.js'
import { withTrace, makeTraceContext } from '../src/lib/trace.js'
import { bus } from '../src/lib/bus.js'

const ORG = process.env.HF_ORG ?? 'ms2stationthis'
const DB = process.env.DB ?? 'noemaplane'
const HF_CACHE = '/home/rth/.cache/huggingface'
const IMAGE = process.env.AITK_IMAGE ?? 'stationthis-klein:1'

// base model → the ai-toolkit clone that supports its arch.
const AITK_DIR_BY_BASE: Record<string, string> = {
  'krea2-raw': '/home/rth/projects/ai/training/ai-toolkit-krea',
  'krea2': '/home/rth/projects/ai/training/ai-toolkit-krea',
  'klein-4b': '/home/rth/projects/ai/training/ai-toolkit-klein',
}

const ts = (): string => new Date().toISOString().slice(11, 19)
const r = (n: string): string => { const v = process.env[n]; if (!v) throw new Error(`missing env ${n}`); return v }
function arg(name: string, def?: string): string {
  const i = process.argv.indexOf(`--${name}`)
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1]
  if (def !== undefined) return def
  throw new Error(`--${name} required`)
}
function r2cfg() {
  return { endpoint: `https://${r('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
    accessKeyId: r('R2_ACCESS_KEY_ID'), secretAccessKey: r('R2_SECRET_ACCESS_KEY'),
    bucket: r('R2_BUCKET_NAME'), publicUrl: process.env.R2_PUBLIC_URL }
}

/** Read a local dataset folder → {url? , caption} pairs (captions from .txt siblings). For the card
 *  `dataset/` we upload the images to R2; for sample prompts we only need the captions. */
async function readLocalDataset(dir: string): Promise<Array<{ file: string; caption?: string }>> {
  const { readdir, readFile } = await import('node:fs/promises')
  const { join, extname, basename } = await import('node:path')
  const names = (await readdir(dir)).filter((n) => /\.(png|jpe?g|webp)$/i.test(n)).sort()
  return Promise.all(names.map(async (n) => {
    const cap = join(dir, basename(n, extname(n)) + '.txt')
    const caption = await readFile(cap, 'utf8').then((s) => s.trim()).catch(() => undefined)
    return { file: join(dir, n), ...(caption ? { caption } : {}) }
  }))
}

async function train(opts: { dataset: string; trigger: string; slug: string; base: string; familia: string; steps: number }): Promise<string> {
  const aitkDir = AITK_DIR_BY_BASE[opts.base]
  if (!aitkDir) throw new Error(`no ai-toolkit clone mapped for base ${opts.base}`)
  const items = await readLocalDataset(opts.dataset)
  const samplePrompts = deriveSamplePrompts(items.map((i) => i.caption))

  const mongo = new MongoClient(r('MONGODB_URI')); await mongo.connect()
  const store = new R2Uploader(r2cfg())
  const finalize = withLocalSamples(
    makeTrainingFinalizer({ reader: fsLoraReader(`${aitkDir}/output`), store, intellae: new MongoIntella(mongo.db(DB).collection('intellae')) }),
    { outputDir: `${aitkDir}/output`, store },
  )
  const actorum = new MemoryActorum()
  const api = new CrystalApi({ actorum } as unknown as CrystalApiDeps)
  registerProgressusRecorder((id, p) => api.recordProgressus(id, p))
  bus.on('actum.progressus', ({ progressus: p }) => {
    const prog = p.progress ? ` ${p.progress.done}${p.progress.total != null ? '/' + p.progress.total : ''} ${p.progress.unit}` : ''
    console.log(`[${ts()}] ${p.phase}${p.target ? '/' + p.target : ''}${prog}${p.message ? '  — ' + p.message : ''}`)
  })

  const cursor = new AitoolkitTrainingCursor({
    store: new SqliteAitkJobStore(`${aitkDir}/aitk_db.db`),
    spawner: new DockerAitkSpawner(), image: IMAGE,
    mounts: [
      { host: aitkDir, container: '/aitk' },
      { host: opts.dataset, container: opts.dataset },
      { host: HF_CACHE, container: '/root/.cache/huggingface' },
    ],
    shmSize: '8g', pollIntervalMs: 5000, timeoutMs: 12 * 60 * 60 * 1000,
    writeConfig: fsConfigWriter(`${aitkDir}/config`),
    resolveOutput: finalize,
  })
  const jobId = `${opts.slug.replace(/[^a-z0-9]+/gi, '_')}`
  const aditus = {
    jobId, dataset: opts.dataset, triggerWord: opts.trigger, baseModel: opts.base, familia: opts.familia,
    steps: opts.steps, slug: opts.slug, name: opts.slug,
    description: `${opts.familia} LoRA "${opts.slug}" — trigger "${opts.trigger}".`,
    samplePrompts: JSON.stringify(samplePrompts),
  }
  const actum = await actorum.create({ id: `act-${jobId}`, modusId: 'modus.aitoolkit-training', modusVersiono: '1',
    impetus: 0n, signaConsumed: [], aditus, status: 'agens', expirat: new Date(Date.now() + 7 * 24 * 3600 * 1000) })
  console.log(`[${ts()}] training ${opts.slug} on ${opts.base} (${opts.steps} steps, trigger "${opts.trigger}", ${items.length} imgs)`)
  try {
    const exitus = await withTrace(makeTraceContext({ actumId: actum.id }), () => cursor.run(actum))
    console.log(`[${ts()}] === TRAINED + FINALIZED ===`, JSON.stringify(exitus, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)))
    return opts.slug
  } finally { await mongo.close() }
}

async function publish(opts: { dataset: string; slug: string }): Promise<void> {
  if (!process.env.HF_TOKEN) throw new Error('HF_TOKEN required to publish')
  const mongo = new MongoClient(r('MONGODB_URI')); await mongo.connect()
  try {
    const col = mongo.db(DB).collection('intellae')
    const i = await col.findOne({ slug: opts.slug })
    if (!i) throw new Error(`no Intella with slug ${opts.slug} — train first`)
    // Host the local dataset images so the published repo carries `dataset/` for reproduction.
    const store = new R2Uploader(r2cfg())
    const { readFile } = await import('node:fs/promises')
    const { extname } = await import('node:path')
    const items = await readLocalDataset(opts.dataset)
    const datasetItems: Array<{ url: string; caption?: string }> = []
    for (let idx = 0; idx < items.length; idx++) {
      const ext = extname(items[idx].file).toLowerCase()
      const ct = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg'
      const url = await store.put(`models/${i.id}/dataset/${String(idx).padStart(4, '0')}${ext}`, await readFile(items[idx].file), ct)
      datasetItems.push({ url, ...(items[idx].caption ? { caption: items[idx].caption } : {}) })
    }
    const model: ModelView = {
      nomen: i.nomen, genus: i.genus, sources: i.sources, datasetItems,
      ...(i.slug !== undefined ? { slug: i.slug } : {}), ...(i.trigger !== undefined ? { trigger: i.trigger } : {}),
      ...(i.familia !== undefined ? { familia: i.familia } : {}), ...(i.description !== undefined ? { description: i.description } : {}),
      ...(i.trainingSteps !== undefined ? { trainingSteps: i.trainingSteps } : {}),
      ...(Array.isArray(i.samples) && i.samples.length
        ? { samples: i.samples.map((s: { url: string; prompt?: string }, idx: number) =>
            ({ url: s.url, pathInRepo: `samples/sample_${String(idx).padStart(3, '0')}${(s.url.match(/\.(png|jpe?g|webp)(?:\?|$)/i)?.[1] ? '.' + s.url.match(/\.(png|jpe?g|webp)(?:\?|$)/i)![1].toLowerCase() : '.jpg')}`, ...(s.prompt ? { prompt: s.prompt } : {}) })) }
        : {}),
      ...(typeof i.configYaml === 'string' ? { configYaml: i.configYaml } : {}),
    }
    console.log(`[${ts()}] publishing → https://huggingface.co/${ORG}/${opts.slug} (${model.samples?.length ?? 0} samples, ${datasetItems.length} dataset) …`)
    const uploader = new HuggingFaceUploader({ transport: new HfHttpTransport({ token: process.env.HF_TOKEN }), fetcher: httpMediaFetcher })
    const { externalRef } = await uploader.upload({ account: ORG, slug: opts.slug, private: false, model })
    console.log(`[${ts()}] PUBLISHED ✓ ${externalRef}`)
  } finally { await mongo.close() }
}

async function main(): Promise<void> {
  const opts = { dataset: arg('dataset'), trigger: arg('trigger'), slug: arg('slug'),
    base: arg('base', 'krea2-raw'), familia: arg('familia', 'krea2'), steps: Number(arg('steps', '3000')) }
  if (process.argv.includes('--publish-only')) { await publish(opts); return }
  await train(opts)
  if (process.argv.includes('--publish')) await publish(opts)
}
main().then(() => process.exit(0)).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
