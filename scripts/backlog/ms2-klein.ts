#!/usr/bin/env -S npx tsx
// =============================================================================
// ms2-klein.ts — convert the ms2stationthis FLUX.1-dev LoRA backlog → FLUX.2 klein-4b
// =============================================================================
//
// LOCAL pipeline on the 4090, driven through the crystal library (the same cursor +
// finalizer container.ts wires in prod). Per cohort-A repo:
//
//   fetch   download dataset/image_N.{png,txt} from HF → a local folder
//   train   AitoolkitTrainingCursor (Docker stationthis-klein:1) → finalize:
//           host LoRA in R2 + register a private Intella (noemaplane) + collect
//           local samples (withLocalSamples) + persist dataset/config for repro
//   publish read the Intella back → push to ms2stationthis/<name>-klein with the
//           rich card (samples + dataset/ + config.yaml)
//   run     train + publish (the full conversion)
//
// Cohort B repos (no dataset on HF) are skipped — they need backend recovery first.
//
// Run with env (.env carries R2_*, MONGODB_URI→noemaplane, HF_TOKEN):
//   node --env-file=.env --import tsx scripts/backlog/ms2-klein.ts <cmd> <name>
//
//   list                      classify all 56 → A/B
//   fetch <name>              download a cohort-A dataset locally
//   train <name> --confirm    fetch + train + finalize (long; uses the GPU)
//   publish <name>            push the registered LoRA to ms2stationthis/<name>-klein
//   run <name> --confirm      train + publish
//   status                    show local output dirs
//
// Env knobs: STEPS (4000), DB (noemaplane), OWNER_ANIMA (optional), HF_ORG (ms2stationthis).
// =============================================================================

import { MongoClient } from 'mongodb'
import { AitoolkitTrainingCursor } from '../../src/crystal/AitoolkitTrainingCursor.js'
import { SqliteAitkJobStore } from '../../src/crystal/AitkJobStore.js'
import { DockerAitkSpawner } from '../../src/crystal/AitkSpawner.js'
import { fsConfigWriter } from '../../src/crystal/aitkConfig.js'
import { makeTrainingFinalizer, fsLoraReader, withLocalSamples } from '../../src/crystal/trainingFinalizer.js'
import { R2Uploader } from '../../src/crystal/R2Uploader.js'
import { MongoIntella } from '../../src/crystal/MongoIntella.js'
import { HuggingFaceUploader, HfHttpTransport } from '../../src/crystal/HfUploader.js'
import type { ModelView } from '../../src/crystal/ModelPublishAdapter.js'
import { httpMediaFetcher } from '../../src/crystal/MediaFetcher.js'
import { MemoryActorum } from '../../src/execution/MemoryActorum.js'
import { CrystalApi, type CrystalApiDeps } from '../../src/allocutio/api/CrystalApi.js'
import { registerProgressusRecorder } from '../../src/execution/progressusSink.js'
import { withTrace, makeTraceContext } from '../../src/lib/trace.js'
import { bus } from '../../src/lib/bus.js'
import type { Actum } from '../../src/types/actum.js'

const HF = 'https://huggingface.co'
const ORG = process.env.HF_ORG ?? 'ms2stationthis'
const STEPS = Number(process.env.STEPS ?? 4000)
const DB = process.env.DB ?? 'noemaplane'                    // staging-prod; never 'noema'
const AITK_DIR = '/home/rth/projects/ai/training/ai-toolkit-klein'
const DS_ROOT = '/mnt/data/datasets/ms2-klein'
const HF_CACHE = '/home/rth/.cache/huggingface'
const IMAGE = 'stationthis-klein:1'

const ts = (): string => new Date().toISOString().slice(11, 19)
const r = (n: string): string => { const v = process.env[n]; if (!v) throw new Error(`missing env ${n}`); return v }
const resolveUrl = (repo: string, file: string): string => `${HF}/${ORG}/${repo}/resolve/main/${file}`

// ─ HF discovery ─────────────────────────────────────────────────────────────

async function hfJson(path: string): Promise<any> {
  const res = await fetch(`${HF}${path}`); if (!res.ok) throw new Error(`HF ${path}: ${res.status}`); return res.json()
}
async function hfText(repo: string, file: string): Promise<string> {
  const res = await fetch(resolveUrl(repo, file)); if (!res.ok) throw new Error(`HF ${repo}/${file}: ${res.status}`); return res.text()
}

interface RepoInfo { name: string; images: string[]; captions: Set<string> }
async function inspect(name: string): Promise<RepoInfo> {
  const d = await hfJson(`/api/models/${ORG}/${name}`)
  const sib: string[] = (d.siblings ?? []).map((s: { rfilename: string }) => s.rfilename)
  const images = sib.filter((f) => f.startsWith('dataset/') && /\.(png|jpe?g|webp)$/i.test(f)).sort()
  const captions = new Set(sib.filter((f) => f.startsWith('dataset/') && f.endsWith('.txt')))
  return { name, images, captions }
}
async function triggerWord(name: string): Promise<string> {
  try {
    const m = (await hfText(name, 'config.yaml')).match(/trigger_word:\s*'?"?([^'"\n]+)'?"?/i)
    if (m) return m[1].trim()
  } catch { /* no config.yaml */ }
  const m = (await hfText(name, 'README.md').catch(() => '')).match(/instance_prompt:\s*'?"?([^'"\n]+)'?"?/i)
  return (m?.[1] ?? name).trim()
}

// ─ fetch: download a cohort-A dataset to a local folder ───────────────────────

async function fetchDataset(name: string): Promise<{ dir: string; count: number }> {
  const { mkdir, writeFile } = await import('node:fs/promises')
  const { join } = await import('node:path')
  const info = await inspect(name)
  if (info.images.length === 0) throw new Error(`${name} is cohort B (no dataset on HF) — needs backend recovery`)
  const dir = join(DS_ROOT, name)
  await mkdir(dir, { recursive: true })
  let i = 0
  for (const img of info.images) {
    const ext = (img.match(/\.(png|jpe?g|webp)$/i)?.[0] ?? '.png').toLowerCase()
    const stem = `image_${i}`
    const bytes = Buffer.from(await (await fetch(resolveUrl(name, img))).arrayBuffer())
    await writeFile(join(dir, `${stem}${ext}`), bytes)
    const cap = img.replace(/\.(png|jpe?g|webp)$/i, '.txt')
    if (info.captions.has(cap)) await writeFile(join(dir, `${stem}.txt`), await hfText(name, cap))
    i++
  }
  console.log(`[${ts()}] fetched ${i} images → ${dir}`)
  return { dir, count: i }
}

// ─ shared aditus for train + publish ──────────────────────────────────────────

async function trainingAditus(name: string, datasetDir: string): Promise<Record<string, unknown>> {
  const trigger = await triggerWord(name)
  return {
    jobId: `${name}_klein`,
    dataset: datasetDir,                                     // host == container path (mounted identically)
    triggerWord: trigger,
    baseModel: 'klein-4b',
    steps: STEPS,
    slug: `${name}-klein`,                                   // publishes to ORG/<name>-klein; trigger stays the original word
    name: `${name}-klein`,
    description: `FLUX.2 [klein] 4B conversion of ${ORG}/${name} (originally FLUX.1-dev). Trigger: "${trigger}".`,
    provenanceRepo: `${ORG}/${name}`,
    provenanceBase: 'FLUX.1-dev',
    ...(process.env.OWNER_ANIMA ? { ownerAnimaId: process.env.OWNER_ANIMA } : {}),
  }
}

// ─ train: local Docker cursor + full finality ─────────────────────────────────

async function train(name: string): Promise<Record<string, unknown>> {
  const { dir } = await fetchDataset(name)
  const R2 = {
    endpoint: `https://${r('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
    accessKeyId: r('R2_ACCESS_KEY_ID'), secretAccessKey: r('R2_SECRET_ACCESS_KEY'),
    bucket: r('R2_BUCKET_NAME'), publicUrl: process.env.R2_PUBLIC_URL,
  }
  const mongo = new MongoClient(r('MONGODB_URI')); await mongo.connect()
  const store = new R2Uploader(R2)
  const finalize = withLocalSamples(
    makeTrainingFinalizer({
      reader: fsLoraReader(`${AITK_DIR}/output`),
      store,
      intellae: new MongoIntella(mongo.db(DB).collection('intellae')),
    }),
    { outputDir: `${AITK_DIR}/output`, store },
  )

  const actorum = new MemoryActorum()
  const api = new CrystalApi({ actorum } as unknown as CrystalApiDeps)
  registerProgressusRecorder((id, p) => api.recordProgressus(id, p))
  bus.on('actum.progressus', ({ progressus: p }) => {
    const prog = p.progress ? ` ${p.progress.done}${p.progress.total != null ? '/' + p.progress.total : ''} ${p.progress.unit}` : ''
    console.log(`[${ts()}] ${p.phase}${p.target ? '/' + p.target : ''}${prog}${p.message ? '  — ' + p.message : ''}`)
  })

  const cursor = new AitoolkitTrainingCursor({
    store: new SqliteAitkJobStore(`${AITK_DIR}/aitk_db.db`),
    spawner: new DockerAitkSpawner(),
    image: IMAGE,
    mounts: [
      { host: AITK_DIR, container: '/aitk' },
      { host: dir, container: dir },
      { host: HF_CACHE, container: '/root/.cache/huggingface' },
    ],
    shmSize: '8g', pollIntervalMs: 5000, timeoutMs: 8 * 60 * 60 * 1000,
    writeConfig: fsConfigWriter(`${AITK_DIR}/config`),
    resolveOutput: finalize,
  })

  const aditus = await trainingAditus(name, dir)
  const actum = await actorum.create({
    id: `act-${aditus.jobId}`, modusId: 'modus.aitoolkit-training', modusVersiono: '1',
    impetus: 0n, signaConsumed: [], aditus, status: 'agens',
    expirat: new Date(Date.now() + 7 * 24 * 3600 * 1000),
  })
  console.log(`[${ts()}] training ${name} → ${aditus.slug} (${STEPS} steps, trigger "${aditus.triggerWord}")`)
  try {
    const exitus = await withTrace(makeTraceContext({ actumId: actum.id }), () => cursor.run(actum))
    console.log(`[${ts()}] === TRAINED + FINALIZED ===`, JSON.stringify(exitus, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)))
    return exitus
  } finally { await mongo.close() }
}

// ─ publish: registered Intella → ms2stationthis/<name>-klein ──────────────────

async function publish(name: string): Promise<void> {
  if (!process.env.HF_TOKEN) throw new Error('HF_TOKEN required to publish')
  const slug = `${name}-klein`
  const mongo = new MongoClient(r('MONGODB_URI')); await mongo.connect()
  try {
    // The finalizer registers with a uuid id + slug=<name>-klein; look it up by slug.
    const i = await mongo.db(DB).collection('intellae').findOne({ slug })
    if (!i) throw new Error(`no registered Intella with slug ${slug} — train first`)
    const model: ModelView = {
      nomen: i.nomen, genus: i.genus, sources: i.sources,
      ...(i.slug !== undefined ? { slug: i.slug } : {}),
      ...(i.trigger !== undefined ? { trigger: i.trigger } : {}),
      ...(i.familia !== undefined ? { familia: i.familia } : {}),
      ...(i.description !== undefined ? { description: i.description } : {}),
      ...(i.trainingSteps !== undefined ? { trainingSteps: i.trainingSteps } : {}),
      ...(i.provenance !== undefined ? { provenance: i.provenance } : {}),
      // derive each sample's repo path exactly as CrystalApi._artifactOutput does.
      ...(Array.isArray(i.samples) && i.samples.length
        ? { samples: i.samples.map((s: { url: string; prompt?: string }, idx: number) =>
            ({ url: s.url, pathInRepo: `samples/sample_${String(idx).padStart(3, '0')}.jpg`, ...(s.prompt ? { prompt: s.prompt } : {}) })) }
        : {}),
      ...(Array.isArray(i.datasetItems) ? { datasetItems: i.datasetItems } : {}),
      ...(typeof i.configYaml === 'string' ? { configYaml: i.configYaml } : {}),
    }
    console.log(`[${ts()}] publishing → ${HF}/${ORG}/${slug} (${model.samples?.length ?? 0} samples, ${model.datasetItems?.length ?? 0} dataset items) …`)
    const uploader = new HuggingFaceUploader({ transport: new HfHttpTransport({ token: process.env.HF_TOKEN }), fetcher: httpMediaFetcher })
    const { externalRef } = await uploader.upload({ account: ORG, slug, private: false, model })
    console.log(`[${ts()}] PUBLISHED ✓ ${externalRef}`)
  } finally { await mongo.close() }
}

// ─ entry ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const [cmd, arg] = process.argv.slice(2)
  const confirm = process.argv.includes('--confirm')
  if (cmd === 'list') {
    const models: Array<{ id: string }> = await hfJson(`/api/models?author=${ORG}&limit=100`)
    const names = models.map((m) => m.id.split('/')[1]).sort()
    const infos = await Promise.all(names.map(inspect))
    const A = infos.filter((i) => i.images.length > 0); const B = infos.filter((i) => i.images.length === 0)
    console.log(`COHORT A — directly convertible (${A.length}):`)
    for (const i of A) console.log(`  ${i.name.padEnd(28)} imgs=${String(i.images.length).padStart(3)} caps=${i.captions.size}`)
    console.log(`COHORT B — needs backend recovery (${B.length}):`)
    for (const i of B) console.log(`  ${i.name}`)
    return
  }
  if (cmd === 'fetch') { if (!arg) throw new Error('usage: fetch <name>'); await fetchDataset(arg); return }
  if (cmd === 'train') {
    if (!arg) throw new Error('usage: train <name> --confirm')
    if (!confirm) throw new Error('refusing a multi-hour GPU run without --confirm')
    await train(arg); return
  }
  if (cmd === 'publish') { if (!arg) throw new Error('usage: publish <name>'); await publish(arg); return }
  if (cmd === 'run') {
    if (!arg) throw new Error('usage: run <name> --confirm')
    if (!confirm) throw new Error('refusing a multi-hour GPU run without --confirm')
    await train(arg); await publish(arg); return
  }
  throw new Error('usage: ms2-klein.ts <list|fetch|train|publish|run> [name] [--confirm]')
}

main().then(() => process.exit(0)).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
