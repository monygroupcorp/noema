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
 * RunpodSpec — the RunPod execution substrate for an Essentia.
 *
 * Everything the RunPodCursor.compile step needs to build a deployment:
 * the container image, the ComfyUI workflow template reference, and the
 * cook flags that control GPU selection and inference behaviour.
 *
 * Required models come from the workflow template itself (requiredModels[])
 * — not duplicated here. The template is the single source of truth for
 * what weights must be present before inference starts.
 */
export interface RunpodSpec {
  /** Docker image ID — e.g. 'runpod/pytorch' */
  imageId: string
  /** Docker image version tag */
  imageVersion: string
  /**
   * Workflow template identifier — looked up in the template registry.
   * Corresponds to templateId in the workflow JSON on disk / in the DB.
   */
  workflowTemplate: string
  workflowTemplateVersion: string
  /**
   * Which aditus field holds the seed value.
   * Default: 'input_seed'. Passed to the slot map resolver.
   */
  seedInputKey?: string
  /** Default cook flags — merged with per-request _cookFlags overrides */
  defaultCookFlags?: {
    batchSize?: number
    /** 'shuffle' = random each run, 'fixed' = always seedPlaceholder, 'increment' = base + pieceIndex */
    seedStrategy?: 'shuffle' | 'fixed' | 'increment'
    seedPlaceholder?: number
    privateMode?: boolean
    /** Minimum VRAM in GB — used by GPUScheduler for pod selection */
    vramGb?: number
    maxPricePerHr?: number
  }
}

/**
 * Essentia — an atomic, platform-catalogued modus.
 *
 * Extends Modus with:
 *   - genus is always 'atomicus' (essentiae are leaves, never trees)
 *   - categoria declares what it produces
 *   - intellaId links to the base model it requires to run
 *   - runpodSpec carries the execution substrate for RunPod workflows
 *
 * "essentia" = essence/being in Latin — the thing that simply IS,
 * the irreducible expression the platform knows how to execute.
 */
export interface Essentia extends Modus {
  /** Essentiae are always atomic — they execute one thing */
  genus: 'atomicus'
  categoria: EssentiaCategoria
  /**
   * FK → Intella. The base model this essentia requires.
   * Optional: some essentiae are pure logic with no model dependency.
   * For LoRA-accepting workflows: this is the base model Intella —
   * compatible LoRAs are those whose baseIntellaId matches this id.
   */
  intellaId?: string
  /**
   * RunPod execution substrate. Present when ministerium === 'runpod'.
   * Carries the container image, workflow template reference, and cook flags.
   * Absent for non-RunPod essentiae (OpenAI, Replicate, local, etc.).
   */
  runpodSpec?: RunpodSpec
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
