#!/usr/bin/env npx tsx
/**
 * upstream-templates.ts — crystal's window onto Comfy-Org/workflow_templates.
 *
 *   pin  [--commit <sha>]   re-derive the committed catalogue from upstream at a commit
 *   diff [--json]           what upstream has gained/changed/dropped since the pin
 *   table [filters]         the pinned templates joined against the weights we hold
 *   match [--json]          every crystal workflow beside its nearest upstream template
 *   gap   [--json]          templates the pod could run today that no crystal workflow claims
 *
 * `pin` needs git and the network and writes src/crystal/upstream/*.catalog.json.
 * `diff` needs the network and writes nothing — it is the duty command.
 * `table` and `match` are offline queries over what is committed.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import {
  UPSTREAM_DECLINED, UPSTREAM_REPO, loadUpstreamCatalog, runnableToday, upstreamTemplateTable,
  type UpstreamCatalog, type UpstreamKind, type UpstreamModel, type UpstreamTemplate,
} from '../../src/crystal/upstreamTemplates.js'

const ROOT = process.cwd()
const CATALOG = path.join(ROOT, 'src', 'crystal', 'upstream', 'comfy-workflow-templates.catalog.json')
const CHECKOUT = path.join(ROOT, '.cache', 'comfy-workflow-templates')
const WORKFLOWS = path.join(ROOT, 'src', 'crystal', 'workflows')

const argv = process.argv.slice(2)
const cmd = argv[0] ?? 'table'
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`)
  return i === -1 ? undefined : argv[i + 1]
}
const has = (name: string) => argv.includes(`--${name}`)

// ── upstream access ──────────────────────────────────────────────────────────

const git = (args: string[], cwd = CHECKOUT) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 1 << 28 }).trim()

/** The commit upstream's default branch points at right now. */
function upstreamHead(): string {
  const out = execFileSync('git', ['ls-remote', UPSTREAM_REPO, 'HEAD'], { encoding: 'utf8' })
  const sha = out.split(/\s+/)[0]
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`could not read upstream HEAD: ${out}`)
  return sha
}

/** Upstream's index.json at a commit, fetched over HTTP — no clone. */
async function fetchIndex(commit: string): Promise<unknown[]> {
  const url = `https://raw.githubusercontent.com/Comfy-Org/workflow_templates/${commit}/templates/index.json`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`)
  return (await res.json()) as unknown[]
}

/**
 * A blobless, template-only checkout at `commit` under .cache/. Blobless keeps
 * the fetch to the files actually read; the sparse cone keeps the 500 MB of
 * thumbnails out of the working tree.
 */
function ensureCheckout(commit: string): void {
  if (!existsSync(path.join(CHECKOUT, '.git'))) {
    mkdirSync(path.dirname(CHECKOUT), { recursive: true })
    execFileSync('git', [
      'clone', '--filter=blob:none', '--no-checkout', '--sparse', UPSTREAM_REPO, CHECKOUT,
    ], { stdio: 'inherit' })
    git(['sparse-checkout', 'set', 'templates'])
  }
  git(['fetch', '--filter=blob:none', 'origin', commit])
  git(['checkout', '--detach', commit])
}

// ── deriving the catalogue ───────────────────────────────────────────────────

/**
 * Every weight a graph downloads. Loader nodes carry `properties.models` as
 * `{name, url, directory}`; since ComfyUI 0.10 most templates wrap their guts in
 * a subgraph, so the whole document is walked rather than just `nodes[]`.
 */
function modelsInGraph(doc: unknown): UpstreamModel[] {
  const found = new Map<string, UpstreamModel>()
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) { for (const v of node) walk(v); return }
    if (!node || typeof node !== 'object') return
    const obj = node as Record<string, unknown>
    if (Array.isArray(obj.models)) {
      for (const raw of obj.models) {
        if (!raw || typeof raw !== 'object') continue
        const m = raw as Record<string, unknown>
        if (typeof m.url !== 'string' || typeof m.name !== 'string') continue
        const model: UpstreamModel = {
          name: m.name,
          directory: typeof m.directory === 'string' ? m.directory : '',
          url: m.url,
        }
        found.set(`${model.directory}/${model.name}`, model)
      }
    }
    for (const v of Object.values(obj)) walk(v)
  }
  walk(doc)
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * `openSource: false` is upstream's mark for a template that reaches a hosted
 * model somewhere in the graph. It is the only offline signal that separates a
 * flow the pod could run from one that needs somebody's API key partway
 * through: `templates_ohneis_i2v` declares the whole Z-Image stack AND calls
 * Gemini and Kling, and would otherwise read as fully ours.
 */
function classify(models: UpstreamModel[], openSource: boolean | undefined, name: string): UpstreamKind {
  const hosted = openSource === false || name.startsWith('api_')
  if (models.length > 0) return hosted ? 'hybrid' : 'local'
  return hosted ? 'api' : 'weightless'
}

function buildCatalog(commit: string): UpstreamCatalog {
  const templatesDir = path.join(CHECKOUT, 'templates')
  const index = JSON.parse(readFileSync(path.join(templatesDir, 'index.json'), 'utf8')) as Array<{
    category?: string; title?: string; templates?: Array<Record<string, unknown>>
  }>
  const templates: UpstreamTemplate[] = []
  for (const group of index) {
    for (const raw of group.templates ?? []) {
      const name = String(raw.name)
      const file = path.join(templatesDir, `${name}.json`)
      const models = existsSync(file) ? modelsInGraph(JSON.parse(readFileSync(file, 'utf8'))) : []
      templates.push({
        name,
        section: String(group.category ?? ''),
        category: String(group.title ?? ''),
        title: String(raw.title ?? name),
        description: typeof raw.description === 'string' ? raw.description : undefined,
        tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
        date: typeof raw.date === 'string' ? raw.date : undefined,
        size: typeof raw.size === 'number' ? raw.size : undefined,
        mediaType: typeof raw.mediaType === 'string' ? raw.mediaType : undefined,
        openSource: typeof raw.openSource === 'boolean' ? raw.openSource : undefined,
        tutorialUrl: typeof raw.tutorialUrl === 'string' ? raw.tutorialUrl : undefined,
        kind: classify(models, raw.openSource as boolean | undefined, name),
        models,
      })
    }
  }
  return {
    repo: UPSTREAM_REPO,
    commit,
    pinnedAt: new Date().toISOString().slice(0, 10),
    derivedFrom: ['templates/index.json', 'templates/<name>.json'],
    templates,
  }
}

// ── crystal's own side ───────────────────────────────────────────────────────

interface CrystalWorkflow {
  file: string
  templateId: string
  isDraft: boolean
  displayName?: string
  /** Weight FILENAMES the workflow loads, from wherever they are written down. */
  weights: Set<string>
  nodeTypes: string[]
}

const WEIGHT_EXT = /\.(safetensors|ckpt|pth|pt|bin|gguf|onnx|sft)$/i

/**
 * Weight filenames a crystal graph loads. `requiredModels` carries them only
 * when a flow has a url/dest fallback table — the drafts ported off ComfyDeploy
 * carry none — so the loader widgets are read too: `ckpt_name`, `unet_name`,
 * `lora_name` and their kin hold the filename the node will look for.
 * Filenames alone, not directories: the same weight is filed under `unet/` in
 * one graph and `diffusion_models/` in the next, and the name is what is stable.
 */
function crystalWeights(doc: {
  inputTemplate?: Record<string, { inputs?: Record<string, unknown> }>
  requiredModels?: Array<{ dest?: string }>
}): Set<string> {
  const out = new Set<string>()
  for (const m of doc.requiredModels ?? []) {
    const f = m.dest?.split('/').pop()
    if (f && WEIGHT_EXT.test(f)) out.add(f)
  }
  for (const node of Object.values(doc.inputTemplate ?? {})) {
    for (const v of Object.values(node?.inputs ?? {})) {
      if (typeof v === 'string' && WEIGHT_EXT.test(v)) out.add(v.split('/').pop()!)
    }
  }
  return out
}

function readCrystalWorkflows(): CrystalWorkflow[] {
  const out: CrystalWorkflow[] = []
  const scan = (dir: string, isDraft: boolean) => {
    if (!existsSync(dir)) return
    for (const f of readdirSync(dir).filter(n => n.endsWith('.json'))) {
      const doc = JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as {
        templateId?: string; displayName?: string
        inputTemplate?: Record<string, { class_type?: string; inputs?: Record<string, unknown> }>
        requiredModels?: Array<{ dest?: string }>
      }
      out.push({
        file: isDraft ? `drafts/${f}` : f,
        templateId: String(doc.templateId ?? f.replace(/\.json$/, '')),
        isDraft,
        displayName: doc.displayName,
        weights: crystalWeights(doc),
        nodeTypes: [...new Set(Object.values(doc.inputTemplate ?? {})
          .map(n => n.class_type).filter((c): c is string => !!c))],
      })
    }
  }
  scan(WORKFLOWS, false)
  scan(path.join(WORKFLOWS, 'drafts'), true)
  return out
}

/**
 * Quantisation and packaging noise, stripped before two weight filenames are
 * compared. `flux1-dev-kontext_fp8_scaled` and `flux1-kontext-dev` are the same
 * weight at different precision, and a flow that loads one is a port of the flow
 * that loads the other. The remaining tokens are sorted, so the two spellings of
 * a hyphenated name collapse onto each other too.
 */
const NOISE = new Set([
  'fp4', 'fp8', 'fp16', 'fp32', 'bf16', 'int8', 'int4', 'nvfp4', 'e4m3fn', 'e5m2',
  'scaled', 'mixed', 'pruned', 'convrot', 'awq', 'distilled', 'emaonly', 'comfyui',
])

function weightStem(filename: string): string {
  return filename
    .replace(WEIGHT_EXT, '')
    .toLowerCase()
    .split(/[-_.]+/)
    .filter(t => t && !NOISE.has(t))
    .sort()
    .join('-')
}

function jaccard(a: Set<string>, b: Set<string>): number {
  const union = new Set([...a, ...b]).size
  if (union === 0) return 0
  return [...a].filter(x => b.has(x)).length / union
}

/** Two name tokens agree when one contains the other — `kontext` inside `kontextedit`. */
function tokenOverlap(mine: Set<string>, theirs: Set<string>): number {
  if (mine.size === 0) return 0
  const hit = [...mine].filter(t =>
    [...theirs].some(o => o === t || (t.length >= 4 && o.includes(t)) || (o.length >= 4 && t.includes(o))))
  return hit.length / mine.size
}

/**
 * Nearest upstream template for a crystal workflow. Weight filenames decide it —
 * two graphs that load the same files are the same flow whatever they are called
 * — with name-token overlap breaking ties among templates that share a weight set
 * (Wan i2v and t2v load identical weights and differ only in framing).
 */
function nearest(w: CrystalWorkflow, rows = upstreamTemplateTable()) {
  const myTokens = new Set(w.templateId.split(/[-_]/).filter(t => t.length > 1))
  const myStems = new Set([...w.weights].map(weightStem))
  let best: { row: (typeof rows)[number]; weights: number; tokens: number } | undefined
  for (const row of rows) {
    if (row.kind !== 'local') continue
    const theirs = new Set(row.models.map(m => m.name))
    const weights = Math.max(
      jaccard(w.weights, theirs),
      jaccard(myStems, new Set([...theirs].map(weightStem))),
    )
    const tokens = tokenOverlap(myTokens, new Set(row.name.split(/[-_]/).filter(t => t.length > 1)))
    if (!best || weights > best.weights || (weights === best.weights && tokens > best.tokens)) {
      best = { row, weights, tokens }
    }
  }
  if (!best || (best.weights === 0 && best.tokens === 0)) return undefined
  return best
}

// ── commands ─────────────────────────────────────────────────────────────────

const fmt = (n: number) => n.toString().padStart(3)

async function main(): Promise<number> {
  if (cmd === 'pin') {
    const commit = flag('commit') ?? upstreamHead()
    ensureCheckout(commit)
    const catalog = buildCatalog(commit)
    mkdirSync(path.dirname(CATALOG), { recursive: true })
    writeFileSync(CATALOG, `${JSON.stringify(catalog, null, 1)}\n`)
    const kinds = catalog.templates.reduce<Record<string, number>>((a, t) => {
      a[t.kind] = (a[t.kind] ?? 0) + 1
      return a
    }, {})
    console.log(`pinned ${UPSTREAM_REPO} @ ${commit}`)
    console.log(`${catalog.templates.length} templates → ${path.relative(ROOT, CATALOG)}`)
    console.log(`  ${Object.entries(kinds).map(([k, v]) => `${k}: ${v}`).join('   ')}`)
    return 0
  }

  if (cmd === 'diff') {
    const pinned = loadUpstreamCatalog()
    const head = upstreamHead()
    if (head === pinned.commit) {
      console.log(`pin is current: ${pinned.commit.slice(0, 12)} (${pinned.templates.length} templates)`)
      return 0
    }
    const live = (await fetchIndex(head)) as Array<{ templates?: Array<Record<string, unknown>> }>
    const liveNames = new Map<string, Record<string, unknown>>()
    for (const g of live) for (const t of g.templates ?? []) liveNames.set(String(t.name), t)
    const pinnedNames = new Map(pinned.templates.map(t => [t.name, t]))
    const added = [...liveNames.keys()].filter(n => !pinnedNames.has(n))
    const removed = [...pinnedNames.keys()].filter(n => !liveNames.has(n))
    const retitled = [...liveNames.entries()]
      .filter(([n, t]) => pinnedNames.has(n) && String(t.title ?? n) !== pinnedNames.get(n)!.title)
      .map(([n]) => n)

    if (has('json')) {
      console.log(JSON.stringify({ pinned: pinned.commit, head, added, removed, retitled }, null, 1))
    } else {
      console.log(`pinned  ${pinned.commit.slice(0, 12)}  (${pinned.templates.length} templates)`)
      console.log(`upstream ${head.slice(0, 12)}  (${liveNames.size} templates)`)
      for (const n of added) {
        const t = liveNames.get(n)!
        console.log(`  + ${n}  ${String(t.title ?? '')}${t.openSource === false ? '  [api]' : ''}`)
      }
      for (const n of removed) console.log(`  - ${n}`)
      for (const n of retitled) console.log(`  ~ ${n}  retitled → ${String(liveNames.get(n)!.title)}`)
      if (!added.length && !removed.length && !retitled.length) {
        console.log('  no template added, dropped or retitled — the pin is behind only in graph edits')
      }
      console.log(`\nre-pin with: npx tsx scripts/crystal/upstream-templates.ts pin --commit ${head}`)
    }
    // Exit 0 either way: a duty that fails when upstream moves is an alarm, not a report.
    return 0
  }

  if (cmd === 'table') {
    const rows = upstreamTemplateTable()
    const only = flag('kind')
    const cov = flag('coverage')
    const cat = flag('category')
    const sel = rows.filter(r =>
      (!only || r.kind === only) && (!cov || r.coverage === cov) &&
      (!cat || r.category.toLowerCase().includes(cat.toLowerCase())))
    if (has('json')) { console.log(JSON.stringify(sel, null, 1)); return 0 }
    const pin = loadUpstreamCatalog()
    console.log(`${UPSTREAM_REPO} @ ${pin.commit.slice(0, 12)} (pinned ${pin.pinnedAt})\n`)
    for (const r of sel) {
      const held = r.models.filter(m => m.match !== 'none').length
      console.log(
        `${r.coverage.padEnd(7)} ${r.kind.padEnd(10)} ${r.category.padEnd(16)} ${r.name.padEnd(46)} ` +
        `${fmt(held)}/${fmt(r.models.length)} weights${r.sizeGb ? `  ${r.sizeGb}GB` : ''}`)
      if (has('models')) {
        for (const m of r.models) {
          console.log(`           ${m.match.padEnd(5)} ${m.directory}/${m.name}${m.intellaId ? `  ← ${m.intellaId}` : ''}`)
        }
      }
    }
    const tally = sel.reduce<Record<string, number>>((a, r) => {
      a[`${r.kind}/${r.coverage}`] = (a[`${r.kind}/${r.coverage}`] ?? 0) + 1
      return a
    }, {})
    console.log(`\n${sel.length} of ${rows.length} templates`)
    for (const [k, v] of Object.entries(tally).sort()) console.log(`  ${k.padEnd(20)} ${fmt(v)}`)
    return 0
  }

  if (cmd === 'match') {
    const rows = upstreamTemplateTable()
    const out = readCrystalWorkflows().map(w => {
      const best = nearest(w, rows)
      return {
        file: w.file,
        draft: w.isDraft,
        nearest: best?.row.name,
        title: best?.row.title,
        weightOverlap: best ? Math.round(best.weights * 100) / 100 : 0,
        nameOverlap: best ? Math.round(best.tokens * 100) / 100 : 0,
      }
    })
    if (has('json')) { console.log(JSON.stringify(out, null, 1)); return 0 }
    for (const r of out.sort((a, b) => Number(a.draft) - Number(b.draft) || a.file.localeCompare(b.file))) {
      const verdict = r.nearest && (r.weightOverlap >= 0.5 || r.nameOverlap >= 0.5) ? '' : '  (no near template)'
      console.log(
        `${r.draft ? 'draft ' : '      '}${r.file.padEnd(36)} → ${(r.nearest ?? '—').padEnd(46)} ` +
        `w=${r.weightOverlap.toFixed(2)} n=${r.nameOverlap.toFixed(2)}${verdict}`)
    }
    return 0
  }

  if (cmd === 'gap') {
    // Every template whose weights we already hold, minus the ones a crystal
    // workflow already names in its `upstream` field, minus the ones crystal
    // has decided not to convert (UPSTREAM_DECLINED, with why). What is left
    // is the work this feed exists to surface: flows one conversion from running.
    const claimed = new Set(
      readCrystalWorkflows()
        .map(w => JSON.parse(readFileSync(path.join(WORKFLOWS, w.file), 'utf8')) as {
          upstream?: { template?: string | null }
        })
        .map(d => d.upstream?.template)
        .filter((t): t is string => !!t),
    )
    const all = runnableToday()
    const unclaimed = all.filter(r => !claimed.has(r.name))
    const declined = unclaimed.filter(r => UPSTREAM_DECLINED[r.name])
    const open = unclaimed.filter(r => !UPSTREAM_DECLINED[r.name])
    if (has('json')) {
      console.log(JSON.stringify({ open, declined: declined.map(r => ({ ...r, reason: UPSTREAM_DECLINED[r.name] })) }, null, 1))
      return 0
    }
    console.log(`${all.length} templates the registry already covers; ${all.length - unclaimed.length} claimed by a crystal workflow, ${declined.length} declined\n`)
    for (const r of open) {
      console.log(`  ${r.category.padEnd(16)} ${r.name.padEnd(46)} ${r.title}`)
    }
    if (open.length === 0) console.log('  nothing unclaimed — every covered template has a flow or a declared reason not to')
    if (declined.length) {
      console.log('\ndeclined — covered, but not a new capability:')
      for (const r of declined) console.log(`  ${r.name.padEnd(46)} ${UPSTREAM_DECLINED[r.name]}`)
    }
    return 0
  }

  console.error(`unknown command '${cmd}' — one of: pin, diff, table, match, gap`)
  return 1
}

main().then(code => process.exit(code)).catch(err => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
