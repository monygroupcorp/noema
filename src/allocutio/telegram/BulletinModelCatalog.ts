// =============================================================================
// BulletinModelCatalog — the `Mod • → Add` catalog + search backend for Telegram.
// =============================================================================
// Extracted from TelegramAllocutio to keep that adapter from accreting the picker's
// catalog/search concern. Provides the bulletin deps (`listCategories`, `listMount`,
// `searchModels`, `promptSearch`) plus the force-reply reply-capture registry.
//
// Navigation is by MOUNT LOCATION (the ComfyUI folder = `Intella.dest`'s first segment:
// loras / checkpoints / unet / vae / gguf …) rather than a custom taxonomy. The LoRA mount
// scopes to the studio's base model(s) by default (via the injected `installedBases`
// resolver) so a host doesn't see LoRAs for unrelated bases.
// =============================================================================

import type { Intellarum, Intella } from '../../types/intelligendi.js'
import type { Fundamentorum, Fundamentum } from '../../types/fundamentum.js'
import type { PendingModel, ModelDetail, StudioBase } from '../lexicon/bulletin/types.js'
import { familiaOf } from '../../crystal/inferFamilia.js'
import { COPY } from '../lexicon/copy.js'

/** A studio's container image + the SET of on-pod runtimes it can serve. Compatibility is declared,
 *  not auto-detected: a general PyTorch/CUDA image hosts both ComfyUI and llama-server (they're just
 *  processes launched on it); a purpose-built image is leaner but single-runtime. A flow is
 *  compatible with an image iff its runtime ∈ the image's set. (ociRef is for real provisioning,
 *  deferred to a GPU sprint — fake mode + the UI use the label + runtimes.) */
interface StudioImage { label: string; runtimes: string[]; ociRef: string }
const STUDIO_IMAGES: StudioImage[] = [
  { label: 'PyTorch 2.4 · CUDA 12.4', runtimes: ['ComfyUI', 'llama.cpp'], ociRef: 'runpod/pytorch:2.4.0-cuda12.4' },
  { label: 'llama.cpp server (CUDA)', runtimes: ['llama.cpp'],            ociRef: 'ghcr.io/ggml-org/llama.cpp:server-cuda' },
]
// VRAM-budget stub: the GPU CAPACITY is `Materia.vramGb` (already modeled, e.g. 24 for a 4090); the
// loadout FOOTPRINT is `Loadout.vramGb` / `StudioBase.vramGb` (sum of model sizes, added below).
// Co-hosting decisions (does footprint ≤ capacity?) consume both once the real runner lands — inert today.

/** The container image (label) for a runtime — the first (most general) image that supports it,
 *  so a studio is provisioned co-host-capable where possible. */
function imageForRuntime(runtime: string): string {
  return (STUDIO_IMAGES.find(im => im.runtimes.includes(runtime)) ?? STUDIO_IMAGES[0]).label
}

/** The base family of a model/LoRA — the first-class `familia`, falling back to the tag/name
 *  heuristic for any record not yet backfilled (`familiaOf`, single-sourced in crystal). */
const familyOf = familiaOf

/** The slice of the sender this needs — just enough to post the force-reply prompt. */
interface PromptSender {
  sendMessage(chatId: number, text: string, extra?: { reply_markup?: unknown }): Promise<{ message_id: number }>
}

/** Mount location = the meaningful ComfyUI folder from the volume dest. Migrated records use a
 *  'models/<folder>/…' prefix while canonical ones use '<folder>/…'; normalize so both land on
 *  the real folder (loras / unet / vae / clip / checkpoints …), never the moot 'models'. */
function mountOf(i: Intella): string {
  return (i.dest ?? '').replace(/^models\//, '').split('/')[0] || i.architectura || i.genus || 'other'
}
/** Map an Intella to the bulletin's PendingModel shape. */
function toPendingModel(i: Intella): PendingModel {
  return { intellaId: i.id, nomen: i.nomen || i.slug || i.id, genus: i.genus === 'lora' ? 'lora' : 'model' }
}
/** Prettify a base-family id for the filter button / flow label: 'flux' → 'FLUX'. */
function baseFamilyName(id: string): string {
  if (id === '∅') return 'No base'
  const stem = id.replace(/^intella\./, '').replace(/-base$/, '')
  const known: Record<string, string> = { flux: 'FLUX', sdxl: 'SDXL', sd3: 'SD3', sd15: 'SD1.5', pony: 'Pony', illustrious: 'Illustrious', kontext: 'Kontext', hunyuan: 'Hunyuan', wan: 'Wan', ltx: 'LTX', noobai: 'NoobAI', smollm: 'SmolLM2', qwen: 'Qwen', llama: 'Llama', mistral: 'Mistral', gemma: 'Gemma', phi: 'Phi', unknown: 'Unknown' }
  return known[stem] ?? (stem.charAt(0).toUpperCase() + stem.slice(1))
}

/** A `versio` as comparable numeric segments, or null when it is absent/non-numeric. Numeric
 *  segments — NOT a string compare, which orders '1.10.0' before '1.9.0'. */
function versioSegments(versio?: string): number[] | null {
  const parts = (versio ?? '').trim().split('.')
  if (!versio || parts.length === 0 || !parts.every(p => /^\d+$/.test(p))) return null
  return parts.map(Number)
}
/** Segment-wise compare, shorter versions zero-padded ('1.2' === '1.2.0'). */
function compareSegments(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}
/** Milliseconds of a date-ish field, or null when it is absent/unparseable. */
function timeOf(d?: Date): number | null {
  if (d === undefined || d === null) return null
  const t = new Date(d as Date).getTime()
  return Number.isFinite(t) ? t : null
}
/**
 * Is `cand` the version of a fundament id that should be shown, given the one already held?
 * Ordering is by `versio` (numeric segments), NOT by `natum`/`mutatum`: two canonical versions of
 * one id can share a birth date, which makes a date sort a tie broken by document order. A
 * non-numeric or absent `versio` sorts LAST; a versio tie falls back to `mutatum`, then to
 * first-seen — so the comparison is total and never throws on unexpected data.
 */
function prefersOver(cand: Fundamentum, held: Fundamentum): boolean {
  const a = versioSegments(cand.versio)
  const b = versioSegments(held.versio)
  if (a && b) {
    const d = compareSegments(a, b)
    if (d !== 0) return d > 0
  } else if (a || b) {
    return !!a                      // a parseable versio beats an unparseable/absent one
  }
  const ta = timeOf(cand.mutatum)
  const tb = timeOf(held.mutatum)
  if (ta !== null && tb !== null && ta !== tb) return ta > tb
  if ((ta === null) !== (tb === null)) return ta !== null
  return false                      // fully tied → keep the one seen first
}

/**
 * The card label from the fundament's own `nomen`, with a trailing ` · <runtime>` segment removed
 * when that segment names the fundament's OWN runtime — the runtime already appears in the card's
 * blurb. Conditioning the strip on the runtime (rather than "chop after the last ·") leaves a nomen
 * whose tail is meaningful intact, and leaves a nomen with no separator alone. Empty result → the
 * caller's fallback.
 */
function stripRuntime(nomen: string | undefined, runtime: string): string {
  const name = (nomen ?? '').trim()
  const cut = name.lastIndexOf('·')
  if (cut < 0) return name
  const tail = name.slice(cut + 1).trim().toLowerCase()
  return tail && tail === runtime.trim().toLowerCase() ? name.slice(0, cut).trim() : name
}

export class BulletinModelCatalog {
  /** A live force-reply prompt's message_id → the chat + host awaiting a reply, and which KIND of
   *  reply (a free-text search vs. trigger word(s)). Single-shot + TTL'd so a stale prompt can't
   *  capture an unrelated reply. */
  private readonly pending = new Map<number, { chatId: number; hostUserId: string; kind: 'search' | 'trigger'; expiresAt: number }>()
  private static readonly TTL_MS = 5 * 60 * 1000

  constructor(private readonly deps: { intellarum?: Intellarum; fundamentorum?: Fundamentorum; sender: PromptSender }) {}

  /** Mod • → Add (category stage): the mount-location types present in the catalog, ordered
   *  popular-first (most-populated mount first). Absent intellarum → no categories. */
  async listCategories(): Promise<string[]> {
    if (!this.deps.intellarum) return []
    const all = await this.deps.intellarum.list().catch(() => [])
    const counts = new Map<string, number>()
    for (const i of all) counts.set(mountOf(i), (counts.get(mountOf(i)) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([mount]) => mount)
  }

  /** `/arm` chooser: project each canonical `Fundamentum` (the compute substrate, ADR-0005) into a
   *  card — its base/support weights, family, LoRA count, runtime/image — then Custom for the manual
   *  builder. Grounded on the `Fundamentorum` registry (NOT synthesized from raw weights): a fundament
   *  exists because flows reference it, so the list IS the set of armable substrates, and grows as new
   *  fundamenta are seeded. The user picks in flow/family vocab; what gets provisioned is a fundament. */
  async listFlows(): Promise<StudioBase[]> {
    const custom: StudioBase = { id: 'custom', label: 'Custom' }
    if (!this.deps.fundamentorum) return [custom]
    const listed = await this.deps.fundamentorum.list({ canonica: true }).catch(() => [])
    // ONE card per fundament id. The registry is versioned on purpose and keeps every canonical
    // version of an id, so the raw list carries an id once per version; a chooser that renders each
    // document shows the same substrate several times under one name, and the version a tap resolves
    // to is then whichever document came back first. Collapse here, at the read seam (the registry
    // itself is left as-is — other callers pin versions deliberately). Insertion order is preserved.
    const newestById = new Map<string, Fundamentum>()
    for (const f of listed) {
      const held = newestById.get(f.id)
      if (!held || prefersOver(f, held)) newestById.set(f.id, f)
    }
    const funds = [...newestById.values()]
    const all = this.deps.intellarum ? await this.deps.intellarum.list().catch(() => []) : []
    const byId = new Map(all.map(i => [i.id, i]))
    // LoRA availability per family — surfaced on the card so a host sees what they can layer.
    const loraCount = new Map<string, number>()
    for (const i of all) if (i.genus === 'lora') { const f = familyOf(i); if (f) loraCount.set(f, (loraCount.get(f) ?? 0) + 1) }

    const flows: StudioBase[] = funds.map(f => {
      // Resolve the fundament's weight manifest to display names; derive its family from the base
      // weights' `Intella.familia` (single source — same as the Compiler).
      const weights = (f.intellae ?? []).map(w => byId.get(w.id)).filter((w): w is Intella => !!w)
      const familia = weights.map(w => familyOf(w)).find((x): x is string => !!x)
      // The ACCEPTED set travels with the card: the fundament's own derived family unioned with its
      // declared `acceptsFamiliae` (same rule as the Compiler — a declaration can only widen, never
      // exclude a flow's native LoRAs). Resolved HERE because the `Fundamentum` is in hand; carrying
      // it forward is what keeps two same-family fundamenta distinguishable at the picker.
      const acceptsFamiliae = [...new Set([...(familia ? [familia] : []), ...(f.acceptsFamiliae ?? [])])]
      const models = weights.length ? weights.map(w => w.nomen || w.slug || w.id) : (f.intellae ?? []).map(w => w.id)
      const runtime = f.runtime ?? 'ComfyUI'
      // The fundament's OWN name identifies the card. Deriving the label from the family instead
      // collapses distinct substrates of one family onto a single name, so the chooser cannot say
      // which one a row arms. `baseFamilyName` stays as the fallback for a nomen-less fundament
      // (and is still what `listCategories` prettifies base-family ids with).
      const label = stripRuntime(f.nomen, runtime) || baseFamilyName(familia ?? f.id)
      const loras = familia ? (loraCount.get(familia) ?? 0) : 0
      const vramGb = f.vramGb ?? Math.round(weights.reduce((n, w) => n + (w.sizeGb ?? 0), 0) * 10) / 10
      const loraTail = loras ? `, ${loras} LoRAs available.` : '.'
      const blurb = `${label} — ${models.length} weight${models.length === 1 ? '' : 's'} · ${runtime}${loraTail}`
      return {
        id: f.id,
        ...(familia ? { familia } : {}),
        ...(acceptsFamiliae.length ? { acceptsFamiliae } : {}),
        label,
        blurb,
        models,
        config: runtime,
        image: imageForRuntime(runtime),
        ...(vramGb > 0 ? { vramGb } : {}),
      }
    })
    flows.push(custom)
    return flows
  }

  /** `/arm` Custom path — the container images on offer (by display label), each advertising a
   *  runtime via `configsForImage`. The two axes of the config ring: image → runtime. */
  listImages(): string[] {
    return STUDIO_IMAGES.map(im => im.label)
  }

  /** The runtime(s) a chosen image serves (one per image today: ComfyUI image → ['ComfyUI'],
   *  llama.cpp image → ['llama.cpp']). Drives the /arm config step off the chosen image. */
  configsForImage(image: string): string[] {
    const im = STUDIO_IMAGES.find(i => i.label === image || i.ociRef === image)
    return im ? im.runtimes : STUDIO_IMAGES[0].runtimes
  }

  /** Friendly display label for a container ref — so the loadout shows "llama.cpp server (CUDA)"
   *  rather than the raw `ghcr.io/…` OCI ref (which Telegram auto-links, breaking the feel).
   *  Unknown refs fall back to themselves with the registry host stripped (still no bare URL). */
  imageLabel(ref: string): string {
    const im = STUDIO_IMAGES.find(i => i.ociRef === ref || i.label === ref)
    return im ? im.label : ref.replace(/^[^/]+\.[^/]+\//, '')   // drop a 'host.tld/' prefix if present
  }

  /** Mod • → Add (list stage): the models in a mount. For the LoRA folder, the base families
   *  present in the data (from `baseIntellaId`, with counts) + an "All bases" entry are returned
   *  so the filter button can cycle them; `baseFilter` (`''` = all) selects the displayed family.
   *  Default (no/unknown filter) = all bases — never presumes a single base. */
  async listMount(mount: string, opts: { baseFilter?: string }): Promise<{ items: PendingModel[]; baseFamilies?: Array<{ id: string; label: string }>; baseFilter?: string }> {
    if (!this.deps.intellarum) return { items: [] }
    const all = await this.deps.intellarum.list().catch(() => [])
    const inMount = all.filter(i => mountOf(i) === mount)
    const isLoraMount = inMount.length > 0 && inMount.every(i => i.genus === 'lora')
    if (!isLoraMount) return { items: inMount.map(toPendingModel) }

    // LoRA mount → families derived from each LoRA's base-family tag (baseIntellaId is empty in
    // this data), popular-first, plus an All entry. '∅' = no recognizable base family.
    const counts = new Map<string, number>()
    for (const i of inMount) { const b = familyOf(i) ?? '∅'; counts.set(b, (counts.get(b) ?? 0) + 1) }
    const baseFamilies = [
      { id: '', label: `All bases (${inMount.length})` },
      ...[...counts.entries()].sort((a, b) => b[1] - a[1]).map(([id, n]) => ({ id, label: `${baseFamilyName(id)} (${n})` })),
    ]
    const filter = baseFamilies.some(f => f.id === opts.baseFilter) ? opts.baseFilter! : ''
    const items = filter === '' ? inMount : inMount.filter(i => (familyOf(i) ?? '∅') === filter)
    return { items: items.map(toPendingModel), baseFamilies, baseFilter: filter }
  }

  /** Mod • → tap a model name: resolve its detail card (structural fields + description when
   *  present; base model resolved via baseIntellaId). */
  async detail(intellaId: string): Promise<ModelDetail | undefined> {
    if (!this.deps.intellarum) return undefined
    const i = await this.deps.intellarum.find(intellaId).catch(() => null)
    if (!i) return undefined
    let base: string | undefined
    if (i.baseIntellaId) base = (await this.deps.intellarum.find(i.baseIntellaId).catch(() => null))?.nomen
    const mount = i.dest?.split('/')[0]
    return {
      intellaId: i.id,
      nomen: i.nomen || i.slug || i.id,
      genus: i.genus === 'lora' ? 'lora' : 'model',
      ...(mount ? { mount } : {}),
      ...(base ? { base } : {}),
      ...(i.trigger ? { trigger: i.trigger } : {}),
      ...(typeof i.sizeGb === 'number' ? { sizeGb: i.sizeGb } : {}),
      ...(i.sources?.[0]?.provenance ? { provenance: i.sources[0].provenance } : {}),
      ...(i.sources?.[0]?.uri ? { sourceUri: i.sources[0].uri } : {}),
      ...(i.auctor ? { auctor: i.auctor } : {}),
      ...(i.versio ? { versio: i.versio } : {}),
      ...(i.description ? { description: i.description } : {}),
    }
  }

  /** Mod • → Add → Search: case-insensitive substring match over nomen / slug / trigger,
   *  flat across all mounts. Intellarum has no search(); scan list() — the catalog is small. */
  async search(query: string): Promise<PendingModel[]> {
    if (!this.deps.intellarum) return []
    const q = query.trim().toLowerCase()
    if (q === '') return []
    const all = await this.deps.intellarum.list().catch(() => [])
    return all.filter(i => [i.nomen, i.slug, i.trigger].some(f => f?.toLowerCase().includes(q))).map(toPendingModel)
  }

  /** Mod • → Add → By trigger: resolve trigger word(s) to LoRAs the way the gen does. With a base
   *  `family` (an armed studio), defer to the crystal `Intellarum.triggerMap(familia)` — the SAME
   *  familia-keyed, access-scoped resolution the Compiler uses, so the picker and the gen agree.
   *  `family` takes a SET as well as a single string: acceptance is directed, so an armed studio
   *  passes the fundament's resolved accepted set (`StudioBase.acceptsFamiliae`) and the studios
   *  that share a derived family stay distinguishable here.
   *  Without one (a Custom studio, no preset family chosen yet) fall back to a flat alias scan over
   *  every LoRA in the catalog. Returns matches (deduped, first hit per alias) + tokens that hit nothing. */
  async resolveTriggers(text: string, opts: { family?: string | string[] } = {}): Promise<{ matched: PendingModel[]; unmatched: string[] }> {
    if (!this.deps.intellarum) return { matched: [], unmatched: [] }
    const tokens = [...new Set(text.toLowerCase().split(/[\s,]+/).map(t => t.trim()).filter(Boolean))]
    if (!tokens.length) return { matched: [], unmatched: [] }

    // An EMPTY set is not a scope — it would query `$in: []` and match nothing. Treat it as absent
    // (Custom studio) so the flat scan still serves the host.
    const family = Array.isArray(opts.family) ? (opts.family.length ? opts.family : undefined) : opts.family
    const index = new Map<string, Intella>()   // alias → first LoRA carrying it
    if (family) {
      // Crystal's trigger map is already alias-keyed (comma-split, lowercased) and familia-scoped.
      const map = await this.deps.intellarum.triggerMap(family).catch(() => new Map<string, Intella[]>())
      for (const [alias, bucket] of map) if (bucket[0] && !index.has(alias)) index.set(alias, bucket[0])
    } else {
      const all = await this.deps.intellarum.list().catch(() => [])
      for (const i of all) {
        if (i.genus !== 'lora') continue
        for (const alias of (i.trigger ?? '').split(',').map(a => a.trim().toLowerCase()).filter(Boolean)) {
          if (!index.has(alias)) index.set(alias, i)
        }
      }
    }

    const matched: PendingModel[] = []
    const unmatched: string[] = []
    const seen = new Set<string>()
    for (const tok of tokens) {
      const hit = index.get(tok)
      if (!hit) { unmatched.push(tok); continue }
      if (!seen.has(hit.id)) { seen.add(hit.id); matched.push(toPendingModel(hit)) }
    }
    return { matched, unmatched }
  }

  /** Send the search force-reply prompt; register its message_id so the host's reply routes back. */
  async promptSearch(chatId: number, hostUserId: string): Promise<void> {
    await this._prompt(chatId, hostUserId, 'search', COPY.bulletin.mod.searchPrompt)
  }
  /** Send the trigger-word force-reply prompt (same registry, tagged 'trigger' for routing). */
  async promptTrigger(chatId: number, hostUserId: string): Promise<void> {
    await this._prompt(chatId, hostUserId, 'trigger', COPY.bulletin.mod.triggerPrompt)
  }
  /** `hostUserId` gates the reply to the host (a group sees the prompt). */
  private async _prompt(chatId: number, hostUserId: string, kind: 'search' | 'trigger', text: string): Promise<void> {
    const sent = await this.deps.sender
      .sendMessage(chatId, text, { reply_markup: { force_reply: true } })
      .catch(() => null)
    if (sent) this.pending.set(sent.message_id, { chatId, hostUserId, kind, expiresAt: Date.now() + BulletinModelCatalog.TTL_MS })
  }

  /**
   * If `repliedTo` is this host's live, non-expired prompt and `text` is non-empty, consume it
   * (single-shot) and return its kind + the trimmed text. Otherwise null — an empty reply leaves
   * the prompt alive for a retry; an expired one is swept.
   */
  takeReply(repliedTo: number, chatId: number, fromUserId: string, text: string): { kind: 'search' | 'trigger'; text: string } | null {
    const entry = this.pending.get(repliedTo)
    if (!entry) return null
    if (entry.expiresAt < Date.now()) { this.pending.delete(repliedTo); return null }
    if (entry.chatId !== chatId || entry.hostUserId !== fromUserId) return null
    const q = text.trim()
    if (q === '') return null
    this.pending.delete(repliedTo)
    return { kind: entry.kind, text: q }
  }
}
