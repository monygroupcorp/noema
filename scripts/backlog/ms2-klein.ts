#!/usr/bin/env -S npx tsx
// =============================================================================
// ms2-klein.ts — convert the ms2stationthis FLUX.1-dev LoRA backlog → FLUX.2 klein-4b
// =============================================================================
//
// Drives the conversion entirely through the PROD crystal path (POST /v1/runs →
// modus.aitoolkit-training → finality → POST /v1/editiones). No bespoke training.
//
// Cohort A repos (dataset/ present on HF) are directly convertible: their training
// images + .txt captions are public at HF `resolve` URLs, so the dataset manifest
// points the training pod straight at HF — zero R2 staging, zero ingestion tooling.
//
// Usage:
//   npx tsx scripts/backlog/ms2-klein.ts list                 # classify all 56 → A/B
//   npx tsx scripts/backlog/ms2-klein.ts aditus <name>        # print the /v1/runs body for a cohort-A repo
//   npx tsx scripts/backlog/ms2-klein.ts run <name> --confirm # fire the run on staging (SPENDS pod time)
//   npx tsx scripts/backlog/ms2-klein.ts status <runId>       # poll a run
//
// Env:
//   HOST              staging API base   (default https://staging.noema.art)
//   STAGING_API_KEY   the ms2_<hex> /v1 key minted into noemaplane
//   STEPS             training steps     (default 4000)
// =============================================================================

const HF = 'https://huggingface.co'
const ORG = 'ms2stationthis'
const HOST = process.env.HOST ?? 'https://staging.noema.art'
const STEPS = Number(process.env.STEPS ?? 4000)

interface RepoInfo { name: string; images: string[]; captions: Set<string>; hasDataset: boolean }
interface Aditus {
  dataset: string; triggerWord: string; baseModel: string; steps: number
  slug: string; name: string; description: string; provenanceRepo: string; provenanceBase: string
}

async function hfJson(path: string): Promise<any> {
  const r = await fetch(`${HF}${path}`)
  if (!r.ok) throw new Error(`HF ${path}: ${r.status}`)
  return r.json()
}

async function hfText(repo: string, file: string): Promise<string> {
  const r = await fetch(`${HF}/${ORG}/${repo}/resolve/main/${file}`)
  if (!r.ok) throw new Error(`HF resolve ${repo}/${file}: ${r.status}`)
  return r.text()
}

/** Public, pod-fetchable URL for a file in a repo. */
const resolveUrl = (repo: string, file: string): string => `${HF}/${ORG}/${repo}/resolve/main/${file}`

async function listRepos(): Promise<string[]> {
  const models: Array<{ id: string }> = await hfJson(`/api/models?author=${ORG}&limit=100`)
  return models.map((m) => m.id.split('/')[1]).sort()
}

async function inspect(name: string): Promise<RepoInfo> {
  const d = await hfJson(`/api/models/${ORG}/${name}`)
  const sib: string[] = (d.siblings ?? []).map((s: { rfilename: string }) => s.rfilename)
  const images = sib.filter((f) => f.startsWith('dataset/') && /\.(png|jpe?g|webp)$/i.test(f)).sort()
  const captions = new Set(sib.filter((f) => f.startsWith('dataset/') && f.endsWith('.txt')))
  return { name, images, captions, hasDataset: images.length > 0 }
}

/** Pull the trigger word from the source repo's config.yaml (fallback: README instance_prompt). */
async function triggerWord(name: string): Promise<string> {
  try {
    const cfg = await hfText(name, 'config.yaml')
    const m = cfg.match(/trigger_word:\s*'?"?([^'"\n]+)'?"?/i)
    if (m) return m[1].trim()
  } catch { /* no config.yaml */ }
  const readme = await hfText(name, 'README.md').catch(() => '')
  const m = readme.match(/instance_prompt:\s*'?"?([^'"\n]+)'?"?/i)
  return (m?.[1] ?? name).trim()
}

/** Build the manifest: every dataset image → its public HF resolve URL + its .txt caption. */
async function buildManifest(info: RepoInfo): Promise<Array<{ url: string; caption?: string }>> {
  return Promise.all(info.images.map(async (img) => {
    const cap = img.replace(/\.(png|jpe?g|webp)$/i, '.txt')
    const caption = info.captions.has(cap) ? (await hfText(info.name, cap)).trim() : undefined
    return { url: resolveUrl(info.name, img), ...(caption ? { caption } : {}) }
  }))
}

async function buildAditus(name: string): Promise<Aditus> {
  const info = await inspect(name)
  if (!info.hasDataset) throw new Error(`${name} is cohort B (no dataset on HF) — needs backend recovery`)
  const trigger = await triggerWord(name)
  const manifest = await buildManifest(info)
  return {
    dataset: JSON.stringify(manifest),
    triggerWord: trigger,
    baseModel: 'klein-4b',
    steps: STEPS,
    slug: `${name}-klein`,                       // publishes to ms2stationthis/<name>-klein; trigger stays `${trigger}`
    name: `${name}-klein`,
    description: `FLUX.2 [klein] 4B conversion of ${ORG}/${name} (originally trained on FLUX.1-dev). Trigger: "${trigger}".`,
    provenanceRepo: `${ORG}/${name}`,
    provenanceBase: 'FLUX.1-dev',
  }
}

async function postRun(aditus: Aditus): Promise<{ id: string; status: string }> {
  const key = process.env.STAGING_API_KEY
  if (!key) throw new Error('STAGING_API_KEY required to fire a run')
  const r = await fetch(`${HOST}/v1/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key },
    body: JSON.stringify({ modusId: 'modus.aitoolkit-training', aditus }),
  })
  const body = await r.json()
  if (!r.ok) throw new Error(`POST /v1/runs ${r.status}: ${JSON.stringify(body)}`)
  return body.run
}

async function pollRun(id: string): Promise<any> {
  const key = process.env.STAGING_API_KEY
  const r = await fetch(`${HOST}/v1/runs/${id}`, { headers: key ? { 'x-api-key': key } : {} })
  const body = await r.json()
  if (!r.ok) throw new Error(`GET /v1/runs/${id} ${r.status}: ${JSON.stringify(body)}`)
  return body.run
}

async function main(): Promise<void> {
  const [cmd, arg] = process.argv.slice(2)
  if (cmd === 'list') {
    const repos = await listRepos()
    const infos = await Promise.all(repos.map(inspect))
    const A = infos.filter((i) => i.hasDataset)
    const B = infos.filter((i) => !i.hasDataset)
    console.log(`COHORT A — directly convertible (${A.length}):`)
    for (const i of A) console.log(`  ${i.name.padEnd(28)} imgs=${String(i.images.length).padStart(3)} caps=${i.captions.size}`)
    console.log(`COHORT B — needs backend recovery (${B.length}):`)
    for (const i of B) console.log(`  ${i.name}`)
    return
  }
  if (cmd === 'aditus') {
    if (!arg) throw new Error('usage: aditus <name>')
    const a = await buildAditus(arg)
    const preview = { ...a, dataset: `${JSON.parse(a.dataset).length} items (manifest elided)` }
    console.log(JSON.stringify(preview, null, 2))
    return
  }
  if (cmd === 'run') {
    if (!arg) throw new Error('usage: run <name> --confirm')
    if (!process.argv.includes('--confirm')) throw new Error('refusing to spend pod time without --confirm')
    const a = await buildAditus(arg)
    console.log(`firing ${arg} → ${a.slug} (${JSON.parse(a.dataset).length} imgs, ${a.steps} steps)…`)
    const run = await postRun(a)
    console.log(`run ${run.id} → ${run.status}`)
    return
  }
  if (cmd === 'status') {
    if (!arg) throw new Error('usage: status <runId>')
    console.log(JSON.stringify(await pollRun(arg), null, 2))
    return
  }
  throw new Error('usage: ms2-klein.ts <list|aditus|run|status> [arg]')
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
