import { readFileSync } from 'node:fs'
import path from 'node:path'
import { CANONICAL_INTELLAE } from './seeds/intellae.js'
import type { Intella } from '../types/intelligendi.js'

// =============================================================================
// Upstream ComfyUI workflow templates — the pinned catalogue and the pod join
// =============================================================================
//
// Comfy-Org publishes the workflow library that ships inside ComfyUI itself
// (github.com/Comfy-Org/workflow_templates). Every flow crystal runs is a
// ComfyUI graph, so that library is the natural feedstock: a template there is
// a graph that upstream keeps working against current ComfyUI, with the weights
// it needs already named and addressed.
//
// The repo is ~540 MB (thumbnails and sample media), and the 629 graph files
// alone are ~35 MB, so it is NOT vendored. What is committed is the catalogue
// DERIVED from a pinned commit: for every template, the fields the index carries
// plus the weight files the graph actually downloads, which the index does not
// carry — those live in each graph's loader nodes as `properties.models`,
// including inside subgraph definitions.
//
// Rebuild it with `npx tsx scripts/crystal/upstream-templates.ts pin`; ask what
// upstream has gained since with `... diff`.
// =============================================================================

/** A weight file a template's graph downloads, exactly as upstream addresses it. */
export interface UpstreamModel {
  /** Filename as it lands on disk, e.g. `z_image_turbo_bf16.safetensors`. */
  name: string
  /** ComfyUI models/ subdirectory, e.g. `diffusion_models`. */
  directory: string
  /** Download URL upstream ships (usually a HuggingFace `resolve` link). */
  url: string
}

/**
 * What a template needs from the machine that runs it.
 *  - `local`      — downloads weights and runs them; a pod candidate.
 *  - `hybrid`     — downloads weights AND calls a hosted model partway through
 *                   (Gemini, Kling). The weights being ours does not make it
 *                   runnable, so it is not a candidate either.
 *  - `api`        — calls a third-party hosted model and nothing else; no
 *                   weights, and nothing crystal's pod can run.
 *  - `weightless` — open graph that needs no weights at all (crop, upscale-less
 *                   image tools, node-basics demos).
 *
 * Upstream marks every template that reaches a hosted model `openSource: false`,
 * which is what separates `local` from `hybrid` and `weightless` from `api`.
 */
export type UpstreamKind = 'local' | 'hybrid' | 'api' | 'weightless'

export interface UpstreamTemplate {
  name: string
  /** Index grouping, e.g. `Image`, `Video`, `Product & Ads`. */
  category: string
  /** `Foundation` or `Applied` — the index's own top split. */
  section: string
  title: string
  description?: string
  tags: string[]
  /** Upstream's publication date for the template, `YYYY-MM-DD`. */
  date?: string
  /** Declared total download size in bytes, when the index carries one. */
  size?: number
  mediaType?: string
  openSource?: boolean
  tutorialUrl?: string
  kind: UpstreamKind
  models: UpstreamModel[]
}

export interface UpstreamCatalog {
  /** The repo the catalogue was derived from. */
  repo: string
  /** The commit it was derived AT — the pin. */
  commit: string
  /** ISO date the pin was taken. */
  pinnedAt: string
  /** Upstream files read to produce this, for the record. */
  derivedFrom: string[]
  templates: UpstreamTemplate[]
}

const CATALOG_PATH = path.join(
  process.cwd(), 'src', 'crystal', 'upstream', 'comfy-workflow-templates.catalog.json',
)

export const UPSTREAM_REPO = 'https://github.com/Comfy-Org/workflow_templates'

let cached: UpstreamCatalog | undefined

/** Read the committed catalogue. Cached — the file does not change at runtime. */
export function loadUpstreamCatalog(file = CATALOG_PATH): UpstreamCatalog {
  if (file === CATALOG_PATH && cached) return cached
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as UpstreamCatalog
  if (file === CATALOG_PATH) cached = parsed
  return parsed
}

// ── Weight identity ──────────────────────────────────────────────────────────
//
// ComfyUI resolves several models/ subdirectories to the same loader search
// path, and crystal's own seeds are split across both spellings of each pair
// (INTELLA_FLUX_SCHNELL sits in `unet/`, INTELLA_Z_IMAGE_TURBO in
// `diffusion_models/`). So a weight is identified by its directory CLASS and its
// filename, not by the literal `dest` string.

const DIR_CLASS: Record<string, string> = {
  unet: 'diffusion_models',
  diffusion_models: 'diffusion_models',
  clip: 'text_encoders',
  text_encoders: 'text_encoders',
}

/** `dirClass/filename` — the key two weight paths must share to be the same file. */
export function weightKey(directory: string, filename: string): string {
  const dir = directory.replace(/^\/+|\/+$/g, '')
  return `${DIR_CLASS[dir] ?? dir}/${filename}`
}

/** `weightKey` for a path already written as `directory/filename`. */
export function weightKeyOfPath(p: string): string {
  const segs = p.split('/').filter(Boolean)
  const filename = segs.pop() ?? ''
  return weightKey(segs.join('/'), filename)
}

/**
 * How firmly a template's weight is identified with one crystal already holds.
 *  - `url`  — an Intella source points at the same URL upstream does. Certain.
 *  - `path` — same directory class and filename, different (or no) shared URL.
 *             Strong but not proof: `vae/ae.safetensors` is the FLUX VAE to us
 *             and ships in the Z-Image bundle too, and those are two files.
 *  - `none` — crystal has no weight under that name.
 */
export type WeightMatch = 'url' | 'path' | 'none'

export interface ResolvedModel extends UpstreamModel {
  match: WeightMatch
  /** The Intella id that answered for it, when one did. */
  intellaId?: string
}

/** Whether the pod can run a template today without sourcing a new weight. */
export type PodCoverage = 'all' | 'partial' | 'none' | 'n/a'

export interface UpstreamTemplateRow {
  name: string
  section: string
  category: string
  title: string
  kind: UpstreamKind
  /** `n/a` for `api` and `weightless` templates, which need no weights at all. */
  coverage: PodCoverage
  models: ResolvedModel[]
  tags: string[]
  date?: string
  sizeGb?: number
}

interface WeightIndex {
  byUrl: Map<string, Intella>
  byKey: Map<string, Intella>
}

function indexIntellae(intellae: readonly Intella[]): WeightIndex {
  const byUrl = new Map<string, Intella>()
  const byKey = new Map<string, Intella>()
  for (const i of intellae) {
    if (i.dest) {
      const key = weightKeyOfPath(i.dest)
      if (!byKey.has(key)) byKey.set(key, i)
    }
    for (const s of i.sources ?? []) {
      if (s.uri && !byUrl.has(s.uri)) byUrl.set(s.uri, i)
      // A mirrored weight keeps its filename but not its host, so index the
      // mirror path too: our R2 copy of an upstream URL is the same weight.
      const file = s.uri?.split('?')[0].split('/').pop()
      if (file) {
        const key = weightKey(i.dest.split('/').slice(0, -1).join('/'), file)
        if (!byKey.has(key)) byKey.set(key, i)
      }
    }
  }
  return { byUrl, byKey }
}

function resolveModel(m: UpstreamModel, idx: WeightIndex): ResolvedModel {
  const byUrl = idx.byUrl.get(m.url)
  if (byUrl) return { ...m, match: 'url', intellaId: byUrl.id }
  const byKey = idx.byKey.get(weightKey(m.directory, m.name))
  if (byKey) return { ...m, match: 'path', intellaId: byKey.id }
  return { ...m, match: 'none' }
}

function coverageOf(kind: UpstreamKind, models: ResolvedModel[]): PodCoverage {
  if (kind !== 'local') return 'n/a'
  if (models.length === 0) return 'n/a'
  const held = models.filter(m => m.match !== 'none').length
  if (held === models.length) return 'all'
  return held === 0 ? 'none' : 'partial'
}

export interface TableOptions {
  catalog?: UpstreamCatalog
  /** Defaults to the canonical seed registry. */
  intellae?: readonly Intella[]
}

/**
 * THE TABLE clause 1 asks for: one row per upstream template — name, category,
 * the weights it needs, and whether crystal already holds every one of them.
 * A query over the pin and the registry; nothing here is hand-maintained.
 */
export function upstreamTemplateTable(opts: TableOptions = {}): UpstreamTemplateRow[] {
  const catalog = opts.catalog ?? loadUpstreamCatalog()
  const idx = indexIntellae(opts.intellae ?? CANONICAL_INTELLAE)
  return catalog.templates.map(t => {
    const models = t.models.map(m => resolveModel(m, idx))
    return {
      name: t.name,
      section: t.section,
      category: t.category,
      title: t.title,
      kind: t.kind,
      coverage: coverageOf(t.kind, models),
      models,
      tags: t.tags,
      date: t.date,
      sizeGb: t.size === undefined ? undefined : Math.round((t.size / 1e9) * 10) / 10,
    }
  })
}

/** Templates the pod could run today: every weight they name is already ours. */
export function runnableToday(rows = upstreamTemplateTable()): UpstreamTemplateRow[] {
  return rows.filter(r => r.coverage === 'all')
}

/**
 * Templates the pod could run today that crystal has deliberately decided not
 * to convert, with why — the null+note a workflow's own `upstream` field
 * carries when there is no equivalent (clause 2), mirrored here for a template
 * that has no workflow of its own to carry the field.
 */
export const UPSTREAM_DECLINED: Record<string, string> = {
  llm_qwen3vl_text_gen:
    't2t/i2t are already live via modus.chatgpt; a second, local-only chat flow over different weights is not a new capability.',
  llm_qwen3_text_gen:
    't2t is already live via modus.chatgpt; a second, local-only chat flow over different weights is not a new capability.',
  utility_text_lists_select_prompt:
    'a Node Basics tutorial on list iteration over z-image-turbo, not a new generation capability — batching belongs in Actum/runtime, not a flow.',
  templates_purz_batch_generation:
    'a Node Basics tutorial on batch/queue mechanics over z-image-turbo, not a new generation capability — batching belongs in Actum/runtime, not a flow.',
}
