import { createHash } from 'node:crypto'
import type { Essentia } from '../types/essendi.js'
import type { Intellarum } from '../types/intelligendi.js'
import type { ModelRef } from '../types/actum.js'
import { WorkflowTemplateRegistry, WorkflowTemplateError } from './WorkflowTemplateRegistry.js'
import { resolveLoraTriggers, type ResolvedLora } from './loraResolver.js'

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

export interface CompiledSpec {
  image: { imageId: string; imageVersion: string; ociRef: string }
  models: Array<{ role: string; id: string; url: string; dest: string }>
  workflow: {
    templateId: string
    templateVersion: string
    inputTemplate: Record<string, unknown>
  }
  cookFlags: Record<string, unknown>
  seed: number
  sourceTool: { id: string; versio: string }
  /** On-pod runtime this spec targets ('ComfyUI' default). RESERVED for the second-runtime dispatch
   *  (the runner that consumes it lands in a GPU sprint); carried now so the abstraction is whole. */
  runtime: string
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
  ) {
    this.randomSeed = randomSeed ?? (() => Math.floor(Math.random() * 0x100000000))
  }

  async compile(
    essentia: Essentia,
    aditus: Record<string, unknown>,
    opts: CompileOptions = {},
  ): Promise<CompileResult> {
    if (!essentia.runpodSpec) {
      throw new CompilerError('MISSING_RUNPOD_SPEC', `Essentia '${essentia.id}' has no runpodSpec`)
    }

    const { runpodSpec } = essentia
    const image = {
      imageId: runpodSpec.imageId,
      imageVersion: runpodSpec.imageVersion,
      ociRef: `${runpodSpec.imageId}:${runpodSpec.imageVersion}`,
    }

    let template
    try {
      template = this.templates.get(runpodSpec.workflowTemplate, runpodSpec.workflowTemplateVersion)
    } catch (err) {
      if (err instanceof WorkflowTemplateError) {
        throw new CompilerError(err.code, err.message)
      }
      throw err
    }

    const cookFlags: Record<string, unknown> = {
      ...(runpodSpec.defaultCookFlags ?? {}),
      ...((aditus._cookFlags as Record<string, unknown>) ?? {}),
    }

    const seed = this._resolveSeed(essentia, aditus, cookFlags)

    // ── LoRA trigger resolution (when the template is loraCapable) ─────────
    // Walks `aditus.prompt`, rewrites trigger words into `<lora:slug:weight>`
    // tokens that the workflow's multi-LoRA extraction node will consume.
    // The resolved LoRAs are then appended to `requiredModels` so any missing
    // weights download on this dispatch.
    let appliedLoras: ResolvedLora[] = []
    let loraWarnings: string[] = []
    let promptForSlots = aditus
    if (template.loraCapable && this.intellarum && essentia.intellaId && typeof aditus.prompt === 'string') {
      const map = await this.intellarum.triggerMap(essentia.intellaId, opts.animaId)
      const r = resolveLoraTriggers(aditus.prompt, { triggerMap: map, ...(opts.animaId ? { animaId: opts.animaId } : {}) })
      appliedLoras = r.appliedLoras
      loraWarnings = r.warnings
      if (r.modifiedPrompt !== aditus.prompt) {
        promptForSlots = { ...aditus, prompt: r.modifiedPrompt }
      }
    }

    const seedKey = runpodSpec.seedInputKey ?? 'input_seed'
    const slotInputs = { ...promptForSlots, [seedKey]: seed }
    const inputTemplate = this._applySlotMap(template, slotInputs)

    // Required models = template's static set + LoRAs from prompt resolution + any models
    // the host pinned onto the session via `Mod • → Add` (ride `aditus._pinnedModels`).
    // The intella's `sources[0].uri` and `dest` are filled in by `_resolveModels`
    // via the same Intellarum.find() path used for static models.
    const loraRefs = await this._loraIntellaeToRefs(appliedLoras)
    const baseRefs = [...(template.requiredModels ?? []), ...loraRefs]
    const seen = new Set(baseRefs.map(r => r.id))
    const pinnedRefs = (opts.pinnedModels ?? []).filter(r => !seen.has(r.id))
    const models = await this._resolveModels([...baseRefs, ...pinnedRefs])

    const spec: CompiledSpec = {
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
      runtime: runpodSpec.runtime ?? 'ComfyUI',
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
    const resolved: Array<{ role: string; id: string; url: string; dest: string; sizeBytes?: number }> = []
    for (const ref of refs) {
      let url = ref.url
      let dest = ref.dest
      if (this.intellarum) {
        const intella = await this.intellarum.find(ref.id)
        if (intella && intella.sources.length > 0) {
          url = intella.sources[0].uri
          dest = intella.dest
        }
      }
      if (!url) {
        throw new CompilerError('MODEL_NOT_RESOLVED', `No URL for model '${ref.id}' — register it in the model registry`)
      }
      resolved.push({ role: ref.role, id: ref.id, url, dest, sizeBytes: ref.sizeBytes })
    }
    return resolved.sort((a, b) => {
      const r = a.role.localeCompare(b.role)
      return r !== 0 ? r : a.id.localeCompare(b.id)
    })
  }

  private _resolveSeed(
    essentia: Essentia,
    aditus: Record<string, unknown>,
    cookFlags: Record<string, unknown>,
  ): number {
    const seedKey = essentia.runpodSpec?.seedInputKey ?? 'input_seed'
    const explicit = aditus[seedKey]
    if (explicit !== undefined && explicit !== null && explicit !== '' && explicit !== -1) {
      return Number(explicit)
    }

    const strategy = (cookFlags.seedStrategy as string | undefined) ?? 'shuffle'
    switch (strategy) {
      case 'shuffle':
        return this.randomSeed()
      case 'fixed': {
        const placeholder = cookFlags.seedPlaceholder ?? essentia.runpodSpec?.defaultCookFlags?.seedPlaceholder ?? 88888888
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
