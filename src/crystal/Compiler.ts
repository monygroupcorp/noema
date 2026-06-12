import { createHash } from 'node:crypto'
import type { Essentia } from '../types/essendi.js'
import type { Fundamentum, Fundamentorum } from '../types/fundamentum.js'
import type { Intella, Intellarum } from '../types/intelligendi.js'
import type { ModelRef } from '../types/actum.js'
import { WorkflowTemplateRegistry, WorkflowTemplateError } from './WorkflowTemplateRegistry.js'
import { resolveLoraTriggers, type ResolvedLora } from './loraResolver.js'
import type { Porta } from '../types/modus.js'

/**
 * Weave a Porta's flow-baked affixes around a runtime value. The user supplies
 * `value`; the flow supplies `porta.praefixum`/`porta.suffixum`. Only text Portae
 * with a string value are woven — anything else (or affixes absent) passes through
 * unchanged (no-op). Pieces are trimmed, empties dropped, comma-joined.
 */
function weaveAffixes(value: unknown, porta: Porta): unknown {
  if (porta.type !== 'text' || typeof value !== 'string') return value
  if (porta.praefixum === undefined && porta.suffixum === undefined) return value
  return [porta.praefixum, value, porta.suffixum]
    .map(s => (s ?? '').trim())
    .filter(Boolean)
    .join(', ')
}

/** Stable model ordering — by role, then id. Keeps `spec.models` deterministic for hashing. */
function byRoleThenId(a: { role: string; id: string }, b: { role: string; id: string }): number {
  const r = a.role.localeCompare(b.role)
  return r !== 0 ? r : a.id.localeCompare(b.id)
}

function deepSort(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(deepSort)
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(obj).sort()) {
      sorted[key] = deepSort(obj[key])
    }
    return sorted
  }
  return value
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * CompiledSpec — a runtime-dispatched discriminated union (ADR-0007).
 *
 * Shared base = the runtime-invariant half (image + resolved weights + the on-pod runtime tag).
 * The runtime-specific half is the member: a ComfyUI graph (`workflow`) vs an LLM inference call
 * (`inference`). A python-modelcard `script` member lands with the generation track.
 *
 * Discrimination is STRUCTURAL (presence of `workflow` vs `inference`) — deliberately NOT a `kind`
 * tag, so the ComfyUI member's JSON key-set is unchanged and its content-address hash (stored on
 * `Actum`/`Deploymentum`) stays stable across this refactor. Narrow with the transport guards in
 * comfyrunnerClient — `isComfyUISpec()` / `isInferenceSpec()` (and `isCompiledSpec()` for either kind).
 */
export interface CompiledSpecBase {
  image: { imageId: string; imageVersion: string; ociRef: string }
  /** Resolved weight manifest. `repo` (HF repo id) is set only for repo-download runtimes
   *  (vLLM/transformers, via `huggingface-cli`); ComfyUI single-file downloads omit it. */
  models: Array<{ role: string; id: string; url: string; dest: string; repo?: string }>
  cookFlags: Record<string, unknown>
  sourceTool: { id: string; versio: string }
  /** On-pod runtime this spec targets — the dispatch key (ADR-0005 single-source, ADR-0007 dispatch). */
  runtime: string
}

/** ComfyUI graph spec — the original shape (key-set unchanged: hash-stable). */
export interface ComfyUICompiledSpec extends CompiledSpecBase {
  workflow: {
    templateId: string
    templateVersion: string
    inputTemplate: Record<string, unknown>
  }
  seed: number
  /** Custom-node packs the workflow's graph depends on, forwarded from the template.
   *  `comfyrunnerClient.submitToRunner` ships these to the runner's `_ensure_custom_nodes`.
   *  Omitted when the template declares none. */
  customNodes?: Array<{ url: string; name?: string }>
}

/** LLM/serving inference spec — runtime 'vLLM' | 'llm'. No graph, no seed. */
export interface InferenceCompiledSpec extends CompiledSpecBase {
  inference: {
    /** Flow-baked system/instruction prompt (from `Essentia.inferentia.systemPrompt`). */
    systemPrompt?: string
    /** The affix-woven user prompt. */
    prompt: string
    /** Non-text inputs (image/audio/video) by ref — the executor fetches/loads each. */
    media?: Array<{ type: string; ref: string }>
    /** Resolved generation parameters (max_tokens, temperature, … ∪ flow genParams). */
    genParams: Record<string, unknown>
  }
}

/** python-modelcard spec — a cloned repo run as a one-shot CLI (HeartMuLa, Hunyuan3D). */
export interface ScriptCompiledSpec extends CompiledSpecBase {
  script: {
    repo: string
    entry: string
    /** Resolved CLI args (fixedArgs ∪ argMap-resolved from aditus). */
    args: string[]
    /** File path → content to write before the run (resolved from aditus). */
    fileInputs?: Record<string, string>
    output: string
    outputKind: string
  }
}

export type CompiledSpec = ComfyUICompiledSpec | InferenceCompiledSpec | ScriptCompiledSpec

/** Narrow a CompiledSpec (or compatible) to the LLM inference member. */
export function isInferenceSpec(spec: CompiledSpec): spec is InferenceCompiledSpec {
  return 'inference' in spec && spec.inference != null
}

/** Narrow a CompiledSpec to the python-modelcard script member. */
export function isScriptSpec(spec: CompiledSpec): spec is ScriptCompiledSpec {
  return 'script' in spec && spec.script != null
}

export interface CompileResult {
  hash: string
  spec: CompiledSpec
  /** LoRAs the trigger resolver applied (empty when the workflow isn't loraCapable
   *  or the prompt didn't match any). Surfaces upward for analytics + bulletin. */
  appliedLoras?: ResolvedLora[]
  /** Resolver warnings (multi-public conflicts, stripped inline tags). */
  loraWarnings?: string[]
}

export interface CompileOptions {
  /** The runner's anima — scopes private-LoRA conflict resolution. */
  animaId?: string
  /** Models the host pinned onto the studio loadout via `Mod • → Add`. Unioned into
   *  `spec.models` (deduped against the template + prompt-resolved LoRAs). */
  pinnedModels?: ModelRef[]
}

export class CompilerError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'CompilerError'
    this.code = code
  }
}

// ---------------------------------------------------------------------------
// Compiler
// ---------------------------------------------------------------------------

export class Compiler {
  private readonly randomSeed: () => number

  constructor(
    private readonly templates: WorkflowTemplateRegistry,
    randomSeed?: () => number,
    private readonly intellarum?: Intellarum,
    private readonly fundamentorum?: Fundamentorum,
  ) {
    this.randomSeed = randomSeed ?? (() => Math.floor(Math.random() * 0x100000000))
  }

  async compile(
    essentia: Essentia,
    aditus: Record<string, unknown>,
    opts: CompileOptions = {},
  ): Promise<CompileResult> {
    // ── Resolve the substrate (Fundamentum) the flow runs on (ADR-0005) ────
    // The flow references its fundament by id+versio; the registry resolves it.
    // The image + runtime + base weights come from HERE; the flow's own form
    // (template, seed key, cook flags) stays on the Essentia.
    if (!essentia.fundamentumId) {
      throw new CompilerError('MISSING_FUNDAMENTUM', `Essentia '${essentia.id}' has no fundamentumId`)
    }
    const fundamentum: Fundamentum | null = this.fundamentorum
      ? await this.fundamentorum.find(essentia.fundamentumId, essentia.fundamentumVersio)
      : null
    if (!fundamentum) {
      throw new CompilerError('FUNDAMENTUM_NOT_FOUND',
        `Fundamentum '${essentia.fundamentumId}'${essentia.fundamentumVersio ? `@${essentia.fundamentumVersio}` : ''} not found for Essentia '${essentia.id}'`)
    }

    const image = {
      imageId: fundamentum.imageId,
      imageVersion: fundamentum.imageVersion,
      ociRef: `${fundamentum.imageId}:${fundamentum.imageVersion}`,
    }

    // ── Dispatch on the substrate's runtime (ADR-0007) ─────────────────────
    // The runtime-invariant prologue (fundamentum + image) is done; the rest of the
    // pipeline is runtime-specific. ComfyUI keeps the original inline body below; LLM
    // runtimes branch to `_compileInference`. An unknown runtime is a hard error — no
    // silent ComfyUI fallback (ADR-0007 enforcement).
    const runtime = fundamentum.runtime ?? 'ComfyUI'
    // OpenAI-compatible serving runtimes (vLLM for native archs, SGLang/transformers for custom
    // archs via trust_remote_code) all compile to the same `spec.inference` shape.
    if (runtime === 'vLLM' || runtime === 'llm' || runtime === 'sglang' || runtime === 'transformers') {
      return this._compileInference(essentia, aditus, opts, fundamentum, image, runtime)
    }
    if (runtime === 'python-modelcard') {
      return this._compileScript(essentia, aditus, fundamentum, image, runtime)
    }
    if (runtime !== 'ComfyUI') {
      throw new CompilerError('UNKNOWN_RUNTIME',
        `Fundamentum '${fundamentum.id}' declares runtime '${runtime}' — no executor/compile path registered`)
    }

    // ── ComfyUI path ───────────────────────────────────────────────────────
    if (!essentia.workflowTemplate) {
      throw new CompilerError('MISSING_WORKFLOW_TEMPLATE', `Essentia '${essentia.id}' has no workflowTemplate`)
    }

    let template
    try {
      template = this.templates.get(essentia.workflowTemplate, essentia.workflowTemplateVersion ?? '1')
    } catch (err) {
      if (err instanceof WorkflowTemplateError) {
        throw new CompilerError(err.code, err.message)
      }
      throw err
    }

    const cookFlags: Record<string, unknown> = {
      ...(essentia.defaultCookFlags ?? {}),
      ...((aditus._cookFlags as Record<string, unknown>) ?? {}),
    }

    const seed = this._resolveSeed(essentia, aditus, cookFlags)

    // ── Weight manifest = the FUNDAMENT's base weights ∪ the flow's own extras ─
    // Base/support weights live on the `Fundamentum` (shared substrate); a flow may
    // add its own extra weights via `Modus.intellae`. Each declared weight's url/dest
    // is enriched from a matching `template.requiredModels` entry by id (fallback);
    // `_resolveModels` then overrides from the registered Intella when present.
    // Precedence: Intella > template fallback > MODEL_NOT_RESOLVED.
    const templateFallback = new Map(
      (template.requiredModels ?? []).map(m => [m.id, m] as const),
    )
    const weightRefs = this._manifestRefs(fundamentum, essentia).map(w => {
      const fb = templateFallback.get(w.id)
      return {
        role: w.role,
        id: w.id,
        ...(fb?.url ? { url: fb.url } : {}),
        dest: fb?.dest ?? '',
      }
    })

    // Resolve the base weights FIRST — this loads each weight's Intella record
    // (the same find() the family derivation needs), so we derive the family
    // fetch-once from those records rather than a second N+1 pass.
    const { resolved: baseWeights, records } = await this._resolveModelsWithRecords(weightRefs)

    // ── Derive the flow's model family (role-agnostic) ─────────────────────
    // The distinct non-empty `familia` across the flow's weights (atomic → one;
    // composite → the union). NOT hardcoded to role ∈ checkpoint|unet.
    const families = Array.from(
      new Set(weightRefs.map(w => records.get(w.id)?.familia).filter((f): f is string => !!f)),
    )

    // ── Affix weave (flow-baked prefix/suffix on text Portae) ──────────────
    // BEFORE lora resolution: rewrite each text Porta's value to weave its
    // `praefixum`/`suffixum` around the user-supplied value. Done first so a
    // trigger word living inside an affix still resolves into a `<lora:…>` tag
    // below. Affixes absent → value unchanged (no-op).
    const wovenAditus: Record<string, unknown> = { ...aditus }
    for (const [key, porta] of Object.entries(essentia.aditus)) {
      if (key in wovenAditus) wovenAditus[key] = weaveAffixes(wovenAditus[key], porta)
    }

    // ── LoRA trigger resolution (when the template is loraCapable) ─────────
    // Walks `wovenAditus.prompt`, rewrites trigger words into `<lora:slug:weight>`
    // tokens that the workflow's multi-LoRA extraction node will consume.
    // The resolved LoRAs are then appended to the weight set so any missing
    // weights download on this dispatch.
    //
    // COMPOSITE NOTE: an atomic flow has exactly one family, so we call
    // `triggerMap(families[0])`. Composite compilation (`_compileComposed`,
    // future) calls this PER PROMPT-INPUT with that input's step family — the
    // map is already family-keyed and the resolver is already per-prompt, so it
    // plugs in here with no rework.
    let appliedLoras: ResolvedLora[] = []
    let loraWarnings: string[] = []
    let promptForSlots: Record<string, unknown> = wovenAditus
    if (template.loraCapable && this.intellarum && families.length > 0 && typeof wovenAditus.prompt === 'string') {
      const map = await this.intellarum.triggerMap(families[0], opts.animaId)
      const r = resolveLoraTriggers(wovenAditus.prompt, { triggerMap: map, ...(opts.animaId ? { animaId: opts.animaId } : {}) })
      appliedLoras = r.appliedLoras
      loraWarnings = r.warnings
      if (r.modifiedPrompt !== wovenAditus.prompt) {
        promptForSlots = { ...wovenAditus, prompt: r.modifiedPrompt }
      }
    }

    const seedKey = essentia.seedInputKey ?? 'input_seed'
    const slotInputs = { ...promptForSlots, [seedKey]: seed }
    const inputTemplate = this._applySlotMap(template, slotInputs)

    // models = the resolved base weights + LoRAs from prompt resolution + any
    // models the host pinned onto the session via `Mod • → Add`. LoRA + pinned
    // refs go through the same Intellarum.find() resolution path.
    const loraRefs = await this._loraIntellaeToRefs(appliedLoras)
    const seen = new Set([...weightRefs.map(r => r.id), ...loraRefs.map(r => r.id)])
    const pinnedRefs = (opts.pinnedModels ?? []).filter(r => !seen.has(r.id))
    const extraModels = await this._resolveModels([...loraRefs, ...pinnedRefs])
    const models = [...baseWeights, ...extraModels].sort(byRoleThenId)

    const spec: ComfyUICompiledSpec = {
      image,
      models,
      workflow: {
        templateId: template.templateId,
        templateVersion: template.version,
        inputTemplate,
      },
      cookFlags,
      seed,
      sourceTool: { id: essentia.id, versio: essentia.versio },
      runtime: fundamentum.runtime ?? 'ComfyUI',
      ...(template.customNodes && template.customNodes.length > 0
        ? { customNodes: template.customNodes }
        : {}),
    }

    const hash = `sha256:${this._hashSpec(spec)}`
    return {
      hash,
      spec,
      ...(appliedLoras.length > 0 ? { appliedLoras } : {}),
      ...(loraWarnings.length > 0 ? { loraWarnings } : {}),
    }
  }

  // ── private ──────────────────────────────────────────────────────────────

  /**
   * Convert resolver output into model refs that `_resolveModels` can consume.
   * Each Intella's full record is already in the trigger map, but `_resolveModels`
   * also queries Intellarum to resolve URL + dest, so we only need to pass `id`
   * here. Role is the LoRA's slug to keep download paths human-readable.
   */
  private async _loraIntellaeToRefs(
    applied: ResolvedLora[],
  ): Promise<Array<{ role: string; id: string; dest: string }>> {
    if (applied.length === 0) return []
    // Skip placeholder IDs (inline tags resolved against the cached map alone).
    const real = applied.filter(a => a.intellaId !== 'INLINE_TAG')
    return real.map(a => ({ role: 'lora', id: a.intellaId, dest: `models/loras/${a.slug}.safetensors` }))
  }

  private async _resolveModels(
    refs: Array<{ role: string; id: string; url?: string; dest: string; sizeBytes?: number }>,
  ): Promise<Array<{ role: string; id: string; url: string; dest: string; sizeBytes?: number }>> {
    const { resolved } = await this._resolveModelsWithRecords(refs)
    return resolved.sort(byRoleThenId)
  }

  /** The flow's base weight manifest: fundament base ∪ flow extras, de-duped by id (base-first).
   *  Shared by both compile paths (ADR-0007); each maps it differently (ComfyUI enriches from the
   *  template fallback, inference resolves purely from the Intella registry). */
  private _manifestRefs(
    fundamentum: Fundamentum,
    essentia: Essentia,
  ): Array<{ role: string; id: string }> {
    return [...(fundamentum.intellae ?? []), ...(essentia.intellae ?? [])]
      .filter((w, i, all) => all.findIndex(o => o.id === w.id) === i)
  }

  /**
   * Resolve refs to download entries AND return the loaded Intella records by id.
   * Precedence per ref: Intella (registry) > template fallback (ref.url/dest) >
   * MODEL_NOT_RESOLVED. Surfacing the records lets the caller derive the flow
   * family fetch-once (no second find() pass). Result order matches `refs`.
   */
  private async _resolveModelsWithRecords(
    refs: Array<{ role: string; id: string; url?: string; dest: string; sizeBytes?: number }>,
  ): Promise<{
    resolved: Array<{ role: string; id: string; url: string; dest: string; sizeBytes?: number }>
    records: Map<string, Intella>
  }> {
    const resolved: Array<{ role: string; id: string; url: string; dest: string; sizeBytes?: number }> = []
    const records = new Map<string, Intella>()
    for (const ref of refs) {
      let url = ref.url
      let dest = ref.dest
      if (this.intellarum) {
        const intella = await this.intellarum.find(ref.id)
        if (intella) {
          records.set(ref.id, intella)
          if (intella.sources.length > 0) {
            url = intella.sources[0].uri
            dest = intella.dest
          }
        }
      }
      if (!url) {
        throw new CompilerError('MODEL_NOT_RESOLVED', `No URL for model '${ref.id}' — register it in the model registry`)
      }
      resolved.push({ role: ref.role, id: ref.id, url, dest, sizeBytes: ref.sizeBytes })
    }
    return { resolved, records }
  }

  /**
   * Compile an LLM/serving flow (runtime 'vLLM' | 'llm') into an InferenceCompiledSpec.
   * No workflow template, no slot map, no seed: the form half is `Essentia.inferentia`
   * (system prompt + flow gen params) plus the typed `aditus` (prompt, media, knobs).
   * Shares the weight-manifest resolution + affix weave with the ComfyUI path; diverges
   * after — there is no graph to slot into. (ADR-0007 A1.)
   */
  private async _compileInference(
    essentia: Essentia,
    aditus: Record<string, unknown>,
    opts: CompileOptions,
    fundamentum: Fundamentum,
    image: { imageId: string; imageVersion: string; ociRef: string },
    runtime: string,
  ): Promise<CompileResult> {
    const cookFlags: Record<string, unknown> = {
      ...(essentia.defaultCookFlags ?? {}),
      ...((aditus._cookFlags as Record<string, unknown>) ?? {}),
    }

    // ── Weight manifest = fundament base ∪ flow weights (no template fallback) ─
    // Unlike ComfyUI there is no template to enrich url/dest from — the weights MUST
    // resolve from the registered Intella (the seeds provide sources[0]).
    const weightRefs = this._manifestRefs(fundamentum, essentia).map(w => ({ role: w.role, id: w.id, dest: '' }))
    const { resolved: baseWeights, records } = await this._resolveModelsWithRecords(weightRefs)

    // Enrich with the HF repo id — the pod's vLLM executor downloads the WHOLE repo via
    // `huggingface-cli download <repo>`, not a single file (so `url`/`dest` alone aren't
    // enough). Sourced from the Intella's `sources[0].meta.repo`. ComfyUI never sets this
    // (single-file download), so its spec stays byte-identical — only the inference path adds it.
    const withRepo = baseWeights.map(m => {
      const repo = records.get(m.id)?.sources?.[0]?.meta?.repo
      return typeof repo === 'string' ? { ...m, repo } : m
    })

    // Host-pinned models (the studio loadout) union in, same as the ComfyUI path.
    const seen = new Set(weightRefs.map(r => r.id))
    const pinnedRefs = (opts.pinnedModels ?? []).filter(r => !seen.has(r.id))
    const extraModels = await this._resolveModels(pinnedRefs)
    const models = [...withRepo, ...extraModels].sort(byRoleThenId)

    // ── The user prompt, affix-woven (same seam as ComfyUI's text Portae) ──────
    const promptPorta = essentia.aditus.prompt
    let prompt = typeof aditus.prompt === 'string' ? aditus.prompt : ''
    if (promptPorta) prompt = weaveAffixes(prompt, promptPorta) as string

    // ── Media inputs: non-text aditus ports (image/audio/video) present in input ─
    const mediaTypes = new Set(['image', 'audio', 'video'])
    const media: Array<{ type: string; ref: string }> = []
    for (const [key, porta] of Object.entries(essentia.aditus)) {
      if (!mediaTypes.has(porta.type)) continue
      const v = aditus[key]
      if (typeof v === 'string' && v !== '') media.push({ type: porta.type, ref: v })
    }

    const genParams = this._resolveGenParams(essentia, aditus)

    const spec: InferenceCompiledSpec = {
      image,
      models,
      cookFlags,
      sourceTool: { id: essentia.id, versio: essentia.versio },
      runtime,
      inference: {
        ...(essentia.inferentia?.systemPrompt ? { systemPrompt: essentia.inferentia.systemPrompt } : {}),
        prompt,
        ...(media.length > 0 ? { media } : {}),
        genParams,
      },
    }

    const hash = `sha256:${this._hashSpec(spec)}`
    return { hash, spec }
  }

  /**
   * Compile a python-modelcard flow (runtime 'python-modelcard') into a ScriptCompiledSpec — a
   * cloned repo run as a one-shot CLI (ADR-0007). Resolves the `Essentia.script` form: fixed args ∪
   * argMap (aditus→flags) into a flat arg list, and fileInputs (aditus→file content, affix-woven).
   * Shares the weight-manifest resolution with the other paths. (HeartMuLa, Hunyuan3D.)
   */
  private async _compileScript(
    essentia: Essentia,
    aditus: Record<string, unknown>,
    fundamentum: Fundamentum,
    image: { imageId: string; imageVersion: string; ociRef: string },
    runtime: string,
  ): Promise<CompileResult> {
    const form = essentia.script
    if (!form) {
      throw new CompilerError('MISSING_SCRIPT', `Essentia '${essentia.id}' (runtime ${runtime}) has no script form`)
    }
    const cookFlags: Record<string, unknown> = {
      ...(essentia.defaultCookFlags ?? {}),
      ...((aditus._cookFlags as Record<string, unknown>) ?? {}),
    }

    // Weight manifest (fundament ∪ flow), resolved from the registry — same as the other paths.
    const weightRefs = this._manifestRefs(fundamentum, essentia).map(w => ({ role: w.role, id: w.id, dest: '' }))
    const { resolved: baseWeights, records } = await this._resolveModelsWithRecords(weightRefs)
    const withRepo = baseWeights.map(m => {
      const repo = records.get(m.id)?.sources?.[0]?.meta?.repo
      return typeof repo === 'string' ? { ...m, repo } : m
    })
    const models = withRepo.sort(byRoleThenId)

    // CLI args: fixed flags + argMap-resolved (aditus value ?? port default).
    const args: string[] = [...(form.fixedArgs ?? [])]
    for (const [key, flag] of Object.entries(form.argMap ?? {})) {
      const v = aditus[key] ?? essentia.aditus[key]?.default
      if (v !== undefined && v !== null && v !== '') args.push(flag, String(v))
    }

    // File inputs: write each aditus value (affix-woven) to its declared path before the run.
    const fileInputs: Record<string, string> = {}
    for (const [key, path] of Object.entries(form.fileInputs ?? {})) {
      const porta = essentia.aditus[key]
      const raw = aditus[key]
      const woven = porta ? weaveAffixes(raw, porta) : raw
      fileInputs[path] = typeof woven === 'string' ? woven : String(woven ?? '')
    }

    const spec: ScriptCompiledSpec = {
      image,
      models,
      cookFlags,
      sourceTool: { id: essentia.id, versio: essentia.versio },
      runtime,
      script: {
        repo: form.repo,
        entry: form.entry,
        args,
        ...(Object.keys(fileInputs).length > 0 ? { fileInputs } : {}),
        output: form.output,
        outputKind: form.outputKind,
      },
    }
    const hash = `sha256:${this._hashSpec(spec)}`
    return { hash, spec }
  }

  /**
   * Resolve generation parameters for an inference flow. Precedence (low→high):
   * flow `inferentia.genParams` (baked baseline) < each int/float `aditus` knob's
   * default < the user's explicit `aditus` value. Text/media ports and the cook-flags
   * envelope are excluded — only the numeric knobs (max_tokens, temperature, …) flow in.
   */
  private _resolveGenParams(
    essentia: Essentia,
    aditus: Record<string, unknown>,
  ): Record<string, unknown> {
    const out: Record<string, unknown> = { ...(essentia.inferentia?.genParams ?? {}) }
    const knobTypes = new Set(['int', 'float'])
    for (const [key, porta] of Object.entries(essentia.aditus)) {
      if (!knobTypes.has(porta.type)) continue
      const v = aditus[key]
      if (v !== undefined && v !== null && v !== '') out[key] = v
      else if (porta.default !== undefined) out[key] = porta.default
    }
    return out
  }

  private _resolveSeed(
    essentia: Essentia,
    aditus: Record<string, unknown>,
    cookFlags: Record<string, unknown>,
  ): number {
    const seedKey = essentia.seedInputKey ?? 'input_seed'
    const explicit = aditus[seedKey]
    if (explicit !== undefined && explicit !== null && explicit !== '' && explicit !== -1) {
      return Number(explicit)
    }

    const strategy = (cookFlags.seedStrategy as string | undefined) ?? 'shuffle'
    switch (strategy) {
      case 'shuffle':
        return this.randomSeed()
      case 'fixed': {
        const placeholder = cookFlags.seedPlaceholder ?? essentia.defaultCookFlags?.seedPlaceholder ?? 88888888
        return Number(placeholder)
      }
      case 'increment': {
        const base = Number(cookFlags.baseSeed ?? 0)
        const idx = Number(cookFlags.pieceIndex ?? 0)
        return base + idx
      }
      default:
        throw new CompilerError('UNKNOWN_SEED_STRATEGY', `Unknown seedStrategy: ${strategy}`)
    }
  }

  private _applySlotMap(
    template: { inputTemplate: Record<string, unknown>; slotMap: Record<string, string> },
    inputs: Record<string, unknown>,
  ): Record<string, unknown> {
    const payload = JSON.parse(JSON.stringify(template.inputTemplate)) as Record<string, unknown>
    const slotMap = template.slotMap ?? {}

    for (const [pointer, inputKey] of Object.entries(slotMap)) {
      if (inputs[inputKey] === undefined) continue
      if (!pointer.startsWith('/')) {
        throw new CompilerError('INVALID_SLOT_POINTER', `slot pointer must start with '/': ${pointer}`)
      }
      const segments = pointer.slice(1).split('/')
      let node: Record<string, unknown> = payload
      for (let i = 0; i < segments.length - 1; i++) {
        const seg = segments[i]
        if (node[seg] == null || typeof node[seg] !== 'object') {
          throw new CompilerError('INVALID_SLOT_POINTER', `slot pointer parent missing at '${seg}' in '${pointer}'`)
        }
        node = node[seg] as Record<string, unknown>
      }
      node[segments[segments.length - 1]] = inputs[inputKey]
    }

    return payload
  }

  private _hashSpec(spec: CompiledSpec): string {
    const canonical = JSON.stringify(deepSort(spec))
    return createHash('sha256').update(canonical).digest('hex')
  }
}
