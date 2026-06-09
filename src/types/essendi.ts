// =============================================================================
// ESSENDI — modi essendi — modes of being
// =============================================================================
//
// From the 13th-century Modistae philosopher-grammarians who divided language
// into three modes: essendi (being), intelligendi (understanding), significandi
// (signifying). Our type system maps directly onto this framework:
//
//   essendi      → Essentia    what EXISTS in the platform (atomic operations)
//   intelligendi → Intella     what UNDERSTANDS / processes (models, compute)
//   significandi → Signum      what SIGNIFIES value (proofs of credit)
//
// An Essentia is an atomicus Modus that lives in the platform's canonical
// catalog. It is the smallest named unit of expression — what the platform
// formerly called a "tool." Users never see Essentia directly; they see Mode
// (the user-facing composed Modus that wraps one or more Essentiae).
//
// Examples: runmake (image generation), upscale-x4, caption, ltx-video
// =============================================================================

import type { Modus } from './modus'

/**
 * The output category of an essentia — what kind of thing it produces.
 * Also constrains which Intella (models) are compatible with it.
 */
export type EssentiaCategoria =
  | 'image'   // produces image output (FLUX, SDXL, SD15...)
  | 'video'   // produces video output (LTX-Video...)
  | 'audio'   // produces audio output
  | 'text'    // produces text output (LLM inference)
  | 'code'    // produces executable code
  | 'chain'   // on-chain operation (transaction, contract call)

/**
 * CookFlags — per-flow defaults for GPU selection + inference behaviour, merged with
 * per-request `_cookFlags` overrides at compile time. The flow's own FORM, not substrate.
 */
export interface CookFlags {
  batchSize?: number
  /** 'shuffle' = random each run, 'fixed' = always seedPlaceholder, 'increment' = base + pieceIndex */
  seedStrategy?: 'shuffle' | 'fixed' | 'increment'
  seedPlaceholder?: number
  privateMode?: boolean
  /** Minimum VRAM in GB — used by GPUScheduler for pod selection. (The fundament also declares a
   *  capacity via `Fundamentum.vramGb`; this stays for the request-time scheduler path.) */
  vramGb?: number
  maxPricePerHr?: number
}

/**
 * Essentia — an atomic, platform-catalogued modus.
 *
 * Extends Modus with:
 *   - genus is always 'atomicus' (essentiae are leaves, never trees)
 *   - categoria declares what it produces
 *   - a version-pinned reference to the `Fundamentum` it runs on (the substrate), plus its own
 *     execution FORM (workflow template, seed key, cook flags)
 *
 * Per ADR-0005, the SUBSTRATE (image + runtime + base/support weights) was lifted out of the old
 * provider-named `runpodSpec` into `Fundamentum`; the Essentia now REFERENCES it (id + versio, the
 * same discipline as the template ref) so a family of essentiae share one fundament. The form half
 * — `workflowTemplate`, `seedInputKey`, `defaultCookFlags` — stays here. The provider name (runpod)
 * lives only on the `Cursor` / `Materia.genus`. Base weights live on the `Fundamentum`; any
 * flow-specific extra weights may still ride `Modus.intellae`.
 *
 * "essentia" = essence/being in Latin — the thing that simply IS,
 * the irreducible expression the platform knows how to execute.
 */
export interface Essentia extends Modus {
  /** Essentiae are always atomic — they execute one thing */
  genus: 'atomicus'
  categoria: EssentiaCategoria

  /**
   * The compute substrate this flow runs on — a version-pinned reference into `Fundamentorum`.
   * Present for pod-hosted flows (ministerium === 'runpod'); absent for API-hosted essentiae
   * (OpenAI, Replicate, …). Replaces the former provider-named `runpodSpec` envelope (ADR-0005).
   */
  fundamentumId?: string
  fundamentumVersio?: string

  /**
   * Workflow template identifier — looked up in the template registry (templateId in the workflow
   * JSON / DB). The flow's own FORM: which graph runs on the fundament. Required for pod flows.
   */
  workflowTemplate?: string
  workflowTemplateVersion?: string
  /** Which aditus field holds the seed value. Default: 'input_seed'. Passed to the slot map resolver. */
  seedInputKey?: string
  /** Default cook flags — merged with per-request `_cookFlags` overrides. */
  defaultCookFlags?: CookFlags
}

/** "Essentiae" — nominative plural of essentia */
export type Essentiae = Essentia[]

/**
 * Essentiarum — genitive plural "of the essences."
 * The catalog of all platform-known atomic operations.
 */
export interface Essentiarum {
  find(id: string): Promise<Essentia | null>
  list(categoria?: EssentiaCategoria): Promise<Essentiae>
  /** Returns only platform-canonical (canonica: true) essentiae */
  canonical(): Promise<Essentiae>
}
