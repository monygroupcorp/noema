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
import { fsConfigWriter, deriveSamplePrompts } from '../../src/crystal/aitkConfig.js'
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
const ORG = process.env.HF_ORG ?? 'noema-art'        // org renamed from ms2stationthis (HF redirects old URLs)
const STEPS = Number(process.env.STEPS ?? 4000)
const DB = process.env.DB ?? 'noemaplane'                    // staging-prod; never 'noema'
const AITK_DIR = '/home/rth/projects/ai/training/ai-toolkit-klein'
const DS_ROOT = '/mnt/data/datasets/ms2-klein'
const HF_CACHE = '/home/rth/.cache/huggingface'
const IMAGE = 'stationthis-klein:1'
const LORAS_DIR = process.env.LORAS_DIR ?? '/mnt/data/models/loras'   // shared ComfyUI lora dir
// Repos to never train (dead clients / unwanted variants). Extend via SKIP env (comma-separated).
const SKIP = new Set(['aoiflux', 'crimeflux', 'impresstation-zimage', 'hehehflux', 'wongflux', 'mimany_2flux', 'mogcat2_1flux',
  ...(process.env.SKIP ?? '').split(',').map((s) => s.trim()).filter(Boolean)])

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
/** The source repo's dataset as {url,caption} — its images are public, so the card's `dataset/`
 *  re-hosts them into the new repo. Used to populate datasetItems for the local path, where the
 *  `dataset` aditus is a folder (not a manifest the finalizer could parse). */
async function sourceDatasetItems(name: string): Promise<Array<{ url: string; caption?: string }>> {
  const info = await inspect(name)
  return Promise.all(info.images.map(async (img) => {
    const cap = img.replace(/\.(png|jpe?g|webp)$/i, '.txt')
    const caption = info.captions.has(cap) ? (await hfText(name, cap)).trim() : undefined
    return { url: resolveUrl(name, img), ...(caption ? { caption } : {}) }
  }))
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
  // Sample the card gallery on the dataset's OWN captions — captures the LoRA's real look.
  const items = await sourceDatasetItems(name).catch(() => [])
  const samplePrompts = deriveSamplePrompts(items.map((i) => i.caption))
  return {
    samplePrompts: JSON.stringify(samplePrompts),
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

function r2cfg() {
  return {
    endpoint: `https://${r('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
    accessKeyId: r('R2_ACCESS_KEY_ID'), secretAccessKey: r('R2_SECRET_ACCESS_KEY'),
    bucket: r('R2_BUCKET_NAME'), publicUrl: process.env.R2_PUBLIC_URL,
  }
}

async function train(name: string): Promise<Record<string, unknown>> {
  const { dir } = await fetchDataset(name)
  const mongo = new MongoClient(r('MONGODB_URI')); await mongo.connect()
  const store = new R2Uploader(r2cfg())
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
  await rmStaleContainer(String(aditus.jobId))   // clear any zombie container from a prior killed run
  try {
    const exitus = await withTrace(makeTraceContext({ actumId: actum.id }), () => cursor.run(actum))
    console.log(`[${ts()}] === TRAINED + FINALIZED ===`, JSON.stringify(exitus, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)))
    await linkLora(String(aditus.jobId))
    return exitus
  } finally { await mongo.close() }
}

/** Remove any stale container from a prior killed/crashed run of this job — its deterministic name
 *  (aitk-<jobId>) would otherwise name-conflict the next docker run, or worse keep pinning VRAM and
 *  OOM every subsequent repo. Best-effort; no-op if none exists. */
async function rmStaleContainer(jobId: string): Promise<void> {
  const { exec } = await import('node:child_process')
  await new Promise<void>((res) => exec(`docker rm -f aitk-${jobId}`, () => res()))
}

/** Copy a finished run's final LoRA into the shared loras dir (best-effort; never fails the run).
 *  A real copy, not a symlink: the ComfyUI container mounts /mnt/data/models but NOT the ai-toolkit
 *  output dir, so a symlink would dangle inside the container. */
async function linkLora(jobId: string): Promise<void> {
  const { copyFile, mkdir, access } = await import('node:fs/promises')
  const { join } = await import('node:path')
  const final = `${AITK_DIR}/output/${jobId}/${jobId}.safetensors`
  const dest = join(LORAS_DIR, `${jobId}.safetensors`)
  try {
    await access(final)
    await mkdir(LORAS_DIR, { recursive: true })
    await copyFile(final, dest)
    console.log(`[${ts()}] copied → ${dest}`)
  } catch (e) { console.warn(`[${ts()}] linkLora skipped: ${e instanceof Error ? e.message : e}`) }
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
            ({ url: s.url, pathInRepo: `samples/sample_${String(idx).padStart(3, '0')}${(s.url.match(/\.(png|jpe?g|webp)(?:\?|$)/i)?.[1] ? '.' + s.url.match(/\.(png|jpe?g|webp)(?:\?|$)/i)![1].toLowerCase() : '.jpg')}`, ...(s.prompt ? { prompt: s.prompt } : {}) })) }
        : {}),
      ...(typeof i.configYaml === 'string' ? { configYaml: i.configYaml } : {}),
    }
    // Local training's `dataset` aditus is a folder, so the finalizer can't persist datasetItems.
    // Re-host the source repo's public dataset into the new repo's `dataset/` for reproduction.
    const datasetItems = Array.isArray(i.datasetItems) && i.datasetItems.length
      ? i.datasetItems
      : await sourceDatasetItems(name).catch(() => [])
    if (datasetItems.length) model.datasetItems = datasetItems
    console.log(`[${ts()}] publishing → ${HF}/${ORG}/${slug} (${model.samples?.length ?? 0} samples, ${model.datasetItems?.length ?? 0} dataset items) …`)
    const uploader = new HuggingFaceUploader({ transport: new HfHttpTransport({ token: process.env.HF_TOKEN }), fetcher: httpMediaFetcher })
    const { externalRef } = await uploader.upload({ account: ORG, slug, private: false, model })
    console.log(`[${ts()}] PUBLISHED ✓ ${externalRef}`)
  } finally { await mongo.close() }
}

// ─ entry ──────────────────────────────────────────────────────────────────────

/** Has this repo already been converted? (its <name>-klein exists on HF). Makes batch resumable. */
async function kleinExists(name: string): Promise<boolean> {
  const res = await fetch(`${HF}/api/models/${ORG}/${name}-klein`)
  return res.ok
}

/** Run the next N un-converted cohort-A repos serially, continuing past any failure. */
async function batch(limit: number, dryRun = false): Promise<void> {
  const models: Array<{ id: string }> = await hfJson(`/api/models?author=${ORG}&limit=100`)
  const names = models.map((m) => m.id.split('/')[1]).filter((n) => !n.endsWith('-klein')).sort()
  const queue: string[] = []
  for (const name of names) {
    if (queue.length >= limit) break
    if (SKIP.has(name)) { console.log(`[${ts()}] skip ${name} — on skip list`); continue }
    const info = await inspect(name).catch(() => null)
    if (!info || info.images.length === 0) continue          // skip cohort B
    if (await kleinExists(name)) { console.log(`[${ts()}] skip ${name} — ${name}-klein already exists`); continue }
    queue.push(name)
  }
  console.log(`[${ts()}] batch of ${queue.length}: ${queue.join(', ')}`)
  if (dryRun) { console.log(`[${ts()}] dry preview — pass --confirm to run`); return }
  const results: Array<{ name: string; ok: boolean; error?: string }> = []
  for (const name of queue) {
    console.log(`\n[${ts()}] ===== START ${name} (${results.length + 1}/${queue.length}) =====`)
    try { await train(name); await publish(name); results.push({ name, ok: true }); console.log(`[${ts()}] ===== OK ${name} =====`) }
    catch (e) { const error = e instanceof Error ? e.message : String(e); results.push({ name, ok: false, error }); console.error(`[${ts()}] ===== FAILED ${name}: ${error} =====`) }
  }
  console.log(`\n[${ts()}] ===== BATCH DONE: ${results.filter((r) => r.ok).length}/${results.length} ok =====`)
  for (const r of results) console.log(`  ${r.ok ? '✓' : '✗'} ${r.name}${r.error ? ' — ' + r.error : ''}`)
}

// ─ backfill: re-render an already-published model's gallery on dataset captions ──────────────────

const COMFY = process.env.COMFY_HOST ?? 'http://127.0.0.1:8188'
const sleep = (ms: number): Promise<void> => new Promise((res) => setTimeout(res, ms))

/** Flat FLUX.2 klein-4b (base) + LoRA text-to-image graph in ComfyUI API-prompt format. */
function kleinApiGraph(loraFile: string, prompt: string, seed: number): Record<string, unknown> {
  return {
    '1':  { class_type: 'UNETLoader', inputs: { unet_name: 'flux-2-klein-base-4b.safetensors', weight_dtype: 'default' } },
    '2':  { class_type: 'LoraLoaderModelOnly', inputs: { model: ['1', 0], lora_name: loraFile, strength_model: 1.0 } },
    '3':  { class_type: 'CLIPLoader', inputs: { clip_name: 'qwen_3_4b.safetensors', type: 'flux2', device: 'default' } },
    '4':  { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['3', 0] } },
    '5':  { class_type: 'CLIPTextEncode', inputs: { text: '', clip: ['3', 0] } },
    '6':  { class_type: 'VAELoader', inputs: { vae_name: 'flux2-vae.safetensors' } },
    '7':  { class_type: 'EmptyFlux2LatentImage', inputs: { width: 1024, height: 1024, batch_size: 1 } },
    '8':  { class_type: 'Flux2Scheduler', inputs: { steps: 20, width: 1024, height: 1024 } },
    '9':  { class_type: 'KSamplerSelect', inputs: { sampler_name: 'euler' } },
    '10': { class_type: 'CFGGuider', inputs: { model: ['2', 0], positive: ['4', 0], negative: ['5', 0], cfg: 5.0 } },
    '11': { class_type: 'RandomNoise', inputs: { noise_seed: seed } },
    '12': { class_type: 'SamplerCustomAdvanced', inputs: { noise: ['11', 0], guider: ['10', 0], sampler: ['9', 0], sigmas: ['8', 0], latent_image: ['7', 0] } },
    '13': { class_type: 'VAEDecode', inputs: { samples: ['12', 0], vae: ['6', 0] } },
    '14': { class_type: 'SaveImage', inputs: { filename_prefix: 'backfill', images: ['13', 0] } },
  }
}

/** Submit a graph to ComfyUI, wait for the render, return the PNG bytes. */
async function renderSample(loraFile: string, prompt: string, seed: number): Promise<Buffer> {
  const sub = await fetch(`${COMFY}/prompt`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: kleinApiGraph(loraFile, prompt, seed) }) })
  const body = await sub.json()
  const pid = body?.prompt_id
  if (!pid) throw new Error(`comfy rejected: ${JSON.stringify(body)}`)
  for (let i = 0; i < 300; i++) {
    await sleep(2000)
    const h = await (await fetch(`${COMFY}/history/${pid}`)).json().catch(() => ({}))
    const entry = h[pid]
    if (!entry) continue
    if (entry.status?.status_str === 'error') throw new Error('comfy render error')
    for (const out of Object.values(entry.outputs ?? {}) as Array<{ images?: Array<{ filename: string; subfolder?: string; type?: string }> }>) {
      const im = out.images?.[0]
      if (im) {
        const q = `filename=${encodeURIComponent(im.filename)}&subfolder=${encodeURIComponent(im.subfolder ?? '')}&type=${im.type ?? 'output'}`
        return Buffer.from(await (await fetch(`${COMFY}/view?${q}`)).arrayBuffer())
      }
    }
  }
  throw new Error('comfy render timeout')
}

/** Delete files from an HF repo (NDJSON commit) — used to prune stale sample images. */
async function deleteRepoFiles(repo: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return
  const lines = [JSON.stringify({ key: 'header', value: { summary: 'prune stale samples' } })]
  for (const p of paths) lines.push(JSON.stringify({ key: 'deletedFile', value: { path: p } }))
  const res = await fetch(`${HF}/api/models/${repo}/commit/main`, {
    method: 'POST', headers: { Authorization: `Bearer ${r('HF_TOKEN')}`, 'Content-Type': 'application/x-ndjson' },
    body: lines.join('\n') + '\n',
  })
  if (!res.ok) throw new Error(`hf delete ${repo}: ${res.status} ${await res.text()}`)
}

/** Re-render an already-published model's card gallery on dataset captions, then re-publish. */
async function backfill(name: string): Promise<void> {
  const { Jimp } = await import('jimp')
  const slug = `${name}-klein`
  const trigger = await triggerWord(name)
  const items = await sourceDatasetItems(name)
  const prompts = deriveSamplePrompts(items.map((i) => i.caption)).map((p) => p.replace(/\[trigger\]/g, trigger))
  const mongo = new MongoClient(r('MONGODB_URI')); await mongo.connect()
  try {
    const col = mongo.db(DB).collection('intellae')
    const intella = await col.findOne({ slug })
    if (!intella) throw new Error(`no registered Intella with slug ${slug} — train first`)
    const store = new R2Uploader(r2cfg())
    const samples: Array<{ url: string; prompt: string }> = []
    for (let idx = 0; idx < prompts.length; idx++) {
      console.log(`[${ts()}] render ${slug} sample ${idx + 1}/${prompts.length}: ${prompts[idx].slice(0, 70)}…`)
      const png = await renderSample(`${slug}.safetensors`, prompts[idx], 42 + idx)
      const jpg = await (await Jimp.read(png)).getBuffer('image/jpeg')   // .jpg overwrites the originals on re-publish
      const url = await store.put(`models/${intella.id}/samples/sample_${String(idx).padStart(3, '0')}.jpg`, jpg, 'image/jpeg')
      samples.push({ url, prompt: prompts[idx] })
    }
    await col.updateOne({ slug }, { $set: { samples } })
    console.log(`[${ts()}] updated ${slug} Intella with ${samples.length} dataset-prompt samples`)
  } finally { await mongo.close() }
  await publish(name)
  // prune any stale sample files (e.g. a prior .png set) the fresh .jpg commit didn't overwrite.
  const keep = new Set(prompts.map((_, idx) => `samples/sample_${String(idx).padStart(3, '0')}.jpg`))
  const sib: string[] = ((await (await fetch(`${HF}/api/models/${ORG}/${slug}`)).json()).siblings ?? []).map((s: { rfilename: string }) => s.rfilename)
  const stale = sib.filter((f) => f.startsWith('samples/') && !keep.has(f))
  if (stale.length) { await deleteRepoFiles(`${ORG}/${slug}`, stale); console.log(`[${ts()}] pruned ${stale.length} stale samples: ${stale.join(', ')}`) }
}

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
  if (cmd === 'batch') { await batch(arg ? Number(arg) : 99, !confirm); return }
  if (cmd === 'backfill') {
    if (!arg) throw new Error('usage: backfill <name|all>')
    const names = arg === 'all' ? ['333flux','13angel33flux','aeonflux','aespaflux','animalcrossingflux'] : [arg]
    for (const n of names) { console.log(`\n[${ts()}] ===== BACKFILL ${n} =====`); await backfill(n) }
    return
  }
  if (cmd === 'run') {
    if (!arg) throw new Error('usage: run <name> --confirm')
    if (!confirm) throw new Error('refusing a multi-hour GPU run without --confirm')
    await train(arg); await publish(arg); return
  }
  throw new Error('usage: ms2-klein.ts <list|fetch|train|publish|run> [name] [--confirm]')
}

main().then(() => process.exit(0)).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
