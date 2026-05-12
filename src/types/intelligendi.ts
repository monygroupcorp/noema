// =============================================================================
// INTELLIGENDI — modi intelligendi — modes of understanding
// =============================================================================
//
// From the Modistae framework (see essendi.ts for overview).
// "intelligendi" = of understanding — the mode through which meaning is processed.
//
// An Intella is a shape with a weight.
//   "shape" → architectura: the model's structural form (unet, transformer, dit)
//   "weight" → parametri: the number of trained parameters (billions)
//
// Intella covers everything that understands or processes within a modus:
//   - Neural network models (FLUX, SDXL, SD15, LTX-Video)
//   - LoRA adapters (fine-tune layers that modify a base model)
//   - Text/image embeddings (vector representations)
//   - Pod configurations (the compute shape itself)
//
// An Essentia (atomic modus) links to an Intella via intellaId — the model
// it needs to run. The Intella lives on Materia (the pod/volume). Loading
// an Intella onto Materia is the cold-start cost the volume cache eliminates.
//
// SOURCE PRIORITY:
//   sources[0] is always the highest-priority download location.
//   The downloader tries each source in order until one succeeds.
//   Convention: index 0 = models.miladystation2.net (our R2 bucket — fast,
//   cost-controlled, always-available mirror). Subsequent entries are public
//   origins: HuggingFace, CivitAI, etc. This lets us cache any model from
//   any host in our bucket and serve it at pod-local speeds.
// =============================================================================

/**
 * What kind of intelligent substrate this is.
 * Models and LoRAs are the most common. Pod is a compute-only Intella.
 */
export type IntellaGenus =
  | 'model'       // a full neural network (FLUX, SDXL, SD15, LTX-Video, TinyLLM...)
  | 'lora'        // a LoRA adapter — a small weight delta applied over a base model
  | 'embedding'   // a text or image embedding model (CLIP, T5, VAE...)
  | 'pod'         // a compute pod configuration (GPU type, RAM, vRAM)

export type IntellaProvenance =
  | 'miladystation'   // models.miladystation2.net R2 bucket — our primary mirror
  | 'huggingface'     // huggingface.co — the public model hub
  | 'civitai'         // civitai.com — community fine-tunes and LoRAs
  | 'runpod'          // RunPod's own model registry
  | 'custom'          // self-hosted or other origin

/**
 * IntellaSource — one download location for a set of model weights.
 *
 * Sources are stored in priority order on Intella.sources[].
 * The downloader tries each in sequence, stopping on the first success.
 *
 * "fons" = spring/source in Latin — where something flows from.
 */
export interface IntellaSource {
  provenance: IntellaProvenance
  /**
   * Direct download URI.
   * miladystation: https://models.miladystation2.net/{role}/{filename}
   * huggingface:   https://huggingface.co/{repo}/resolve/{branch}/{file}
   * civitai:       https://civitai.com/api/download/models/{versionId}
   */
  uri: string
  /**
   * SHA-256 of the weights file at this source.
   * Verified after download to detect corruption or substitution.
   * Must match Intella.contentHash when set.
   */
  sha256?: string
  /** File format — determines how ComfyUI loads it */
  format?: 'safetensors' | 'ckpt' | 'pt' | 'bin'
  /**
   * Provenance-specific metadata for re-fetching or scraping.
   * civitai:    { modelId: number, versionId: number }
   * huggingface: { repo: string, branch: string, filename: string }
   */
  meta?: Record<string, unknown>
}

/**
 * Intella — a compute/model substrate. A shape with a weight.
 *
 * "intella" is a compressed form of "intelligentia" (Latin: understanding,
 * intelligence) — the thing that does the understanding within a modus.
 */
export interface Intella {
  id: string
  /** "nomen" = name in Latin */
  nomen: string
  genus: IntellaGenus

  /**
   * The shape — how the model is structured architecturally.
   * "architectura" = architecture in Latin (from Greek arkhitekton, master builder).
   * Examples: 'unet', 'transformer', 'dit' (diffusion transformer), 'llm-causal'
   */
  architectura: string
  /**
   * The weight — how many trained parameters the model has.
   * "parametri" = parameters in Latin (from Greek parametros, measuring alongside).
   * A model's parametri determines its capability and its memory footprint.
   * Examples: 12_000_000_000 (12B), 3_500_000_000 (3.5B FLUX schnell)
   */
  parametri: number

  /**
   * Ordered download sources. Index 0 = highest priority.
   * Convention: always put models.miladystation2.net first when available,
   * so the pod downloads from our bucket rather than hitting external hosts.
   * The scraper populates this list when ingesting from CivitAI / HuggingFace.
   */
  sources: IntellaSource[]

  /**
   * Destination path on the ComfyUI pod relative to /root/ComfyUI/models/.
   * Determines which ComfyUI model loader finds this file.
   * Examples: 'unet/flux1-schnell.safetensors', 'loras/my-lora.safetensors'
   */
  dest: string

  /** Disk size of the model weights in GB — drives volume storage cost */
  sizeGb: number
  /** Semantic version string e.g. "1.0.0" */
  versio: string
  /**
   * Content-addressed SHA-256 hash of the canonical weights.
   * Set after the first verified download. Used to detect weight drift
   * across sources — all sources must produce the same hash.
   */
  contentHash?: string

  /** True = platform-canonical model. False = community-uploaded. */
  canonica: boolean

  /** "auctor" = author/creator in Latin — animaId or provider name */
  auctor?: string

  /**
   * For genus 'lora': the base model this LoRA was trained against.
   * FK → Intella. A LoRA cannot run without its base model also being loaded.
   * Determines workflow compatibility — only run in workflows whose base
   * Essentia.intellaId matches (or is compatible with) this baseIntellaId.
   */
  baseIntellaId?: string

  // ── LoRA-specific fields (genus: 'lora') ──────────────────────────────────

  /**
   * The trigger keyword users type in a prompt to activate this LoRA.
   * Case-insensitive. Multiple triggers: store multiple Intellae with
   * the same underlying model but different trigger values, or use
   * a comma-separated list for aliases ("milady,mld").
   */
  trigger?: string
  /**
   * The ComfyUI LoRA filename token — what goes in <lora:slug:weight>.
   * Typically the filename stem: 'my-lora' → <lora:my-lora:1.0>
   * Also used as the download dest stem: models/loras/{slug}.safetensors
   */
  slug?: string
  /** Visibility — who can activate this LoRA via trigger words */
  access?: 'public' | 'private'
  /**
   * FK → Anima. The identity that owns this LoRA (private access only).
   * Absent on public LoRAs. The ownerAnima can share access with others
   * via a separate permissions table (Phase 6).
   */
  ownerAnimaId?: string
  /**
   * Default application weight when none is specified by the user.
   * Range: 0.0–2.0. Typical values: 0.6–1.0.
   * Users can override with word:weight syntax or dot/exclamation modifiers.
   */
  defaultWeight?: number

  /**
   * FK → Corpus. The training dataset this Intella was trained from.
   * Present on community-trained LoRAs. Establishes training lineage
   * and is used for royalty attribution.
   */
  corpusId?: string

  /** "natum" = born — when this model was registered */
  natum: Date
  /** "mutatum" = changed — when this model's metadata was last updated */
  mutatum?: Date
}

/** "Intellae" — nominative plural of intella */
export type Intellae = Intella[]

/**
 * Intellarum — genitive plural "of the understandings."
 * The model registry — what the platform knows how to load onto Materia.
 */
export interface Intellarum {
  find(id: string): Promise<Intella | null>
  list(genus?: IntellaGenus): Promise<Intellae>
  /** Returns only platform-canonical (canonica: true) intellae */
  canonical(): Promise<Intellae>
  /**
   * Resolve all LoRA intellae that match a trigger word and are compatible
   * with the given base model (via baseIntellaId).
   * animaId scopes results to public + private LoRAs the user can access.
   * Absent animaId returns public LoRAs only.
   */
  findByTrigger(trigger: string, baseIntellaId: string, animaId?: string): Promise<Intellae>
}

// =============================================================================
// INTELLIGENS — the unified model weight registry
// =============================================================================
//
// "Intelligens" is the nominative singular present participle of "intelligo"
// (to perceive, to understand, to discern) — one perceiving/understanding entity.
// "Intelligenti" / "Intelligentia" = nominative plural.
// "Intelligentium" = genitive plural — "of the understanding ones" — the store.
//
// This is the backing store for the Models catalog page and the source from
// which DeploymentBuilder resolves model references. It stores LoRAs,
// checkpoints, VAEs, CLIPs, ControlNets, and IPAdapters.
//
// Compare Intella (above) — the load-onto-pod substrate used by ComfyUI
// workflow compilation. Intelligens is the user-facing catalog record;
// the two types may converge in a future phase.
// =============================================================================

/** The class of weight file — determines how it is loaded and applied */
export type IntelligensGenus =
  | 'lora'        // fine-tuned delta weights — applied via merge or injection pass
  | 'checkpoint'  // full diffusion model weights — the base generation backbone
  | 'vae'         // variational autoencoder — encodes/decodes latent ↔ pixel space
  | 'clip'        // text encoder — maps prompt tokens to conditioning vectors
  | 'controlnet'  // spatial conditioning — guides generation via structural signals
  | 'ipadapter'   // image prompt conditioning — transfers visual style or composition

/** Who may discover and use this weight */
export type IntelligensPrivacy = 'public' | 'private'

/**
 * Intelligens — one weight file known to the platform.
 *
 * "intelligens" = nominative singular: one perceiving / discerning entity.
 * The registry knows it; the system knows how to use it.
 */
export interface Intelligens {
  /** UUID primary key */
  id: string

  /** "nomen" = name in Latin — human-readable display name */
  nomen: string

  /** The class of weight this record describes */
  genus: IntelligensGenus

  /**
   * Base model this weight is compatible with.
   * "basis" = foundation/base in Latin.
   * Examples: 'flux', 'sdxl', 'sd15'
   */
  basis: string

  /**
   * "auctor" = author/creator in Latin — the animaId of the uploader.
   * Absent for platform-canonical weights.
   */
  auctor?: string

  /** true = platform-owned canonical weight; false = community-contributed */
  canonica: boolean

  /** Who may discover and use this weight */
  privacy: IntelligensPrivacy

  /**
   * "notae" = plural of nota (mark, note) — tags for discovery.
   * Used for style, subject, aesthetic classification.
   * Examples: ['portrait', 'cinematic', 'anime']
   */
  notae: string[]

  /**
   * "verba" = words in Latin — trigger words for LoRAs.
   * The text injected into prompts to activate this weight's effect.
   * Present only for genus: 'lora'. Examples: ['ohwx person', 'flux-portrait']
   */
  verba?: string[]

  /**
   * "locatio" = placement/location in Latin — storage reference.
   * Either an R2 object key or an external URL.
   * Examples: 'r2://weights/flux-lora-v1.safetensors', 'https://...'
   */
  locatio: string

  /**
   * SHA-256 of the weight file — content address.
   * Enables verification that the loaded file matches what was registered.
   */
  contentHash?: string

  /**
   * "magnitudine" = ablative of magnitudo (size, magnitude) — file size in bytes.
   * Used for storage accounting and download time estimation.
   */
  magnitudine?: number

  /**
   * "descriptio" = description in Latin — human-readable explanation.
   * Used on the Models catalog page and in search.
   */
  descriptio?: string

  /** Community star count — embedded for fast catalog sorting */
  stellae: number

  /** "natum" = born — when this weight was first registered */
  natum: Date
  /** "mutatum" = changed — when this record was last modified */
  mutatum: Date
}

/** "Intelligentia" — the collection of all Intelligens records */
export type Intelligentia = Intelligens[]

/**
 * IntelligentiumStore — genitive plural "of the understanding ones."
 * The persistence interface for the model weight registry.
 */
export interface IntelligentiumStore {
  /** Register a new weight. id, natum, mutatum, and stellae are assigned automatically. */
  create(input: Omit<Intelligens, 'id' | 'natum' | 'mutatum' | 'stellae'>): Promise<Intelligens>

  /** Look up a single weight by id. Returns null if not found. */
  find(id: string): Promise<Intelligens | null>

  /**
   * List weights matching the given filter.
   * All filter fields are ANDed together. Absent fields are not constrained.
   */
  list(filter?: {
    genus?: IntelligensGenus
    basis?: string
    auctor?: string
    canonica?: boolean
    privacy?: IntelligensPrivacy
  }): Promise<Intelligentia>

  /**
   * Update a registered weight. Stamps mutatum automatically.
   * Throws if the id is not found.
   */
  update(
    id: string,
    patch: Partial<Pick<Intelligens, 'nomen' | 'descriptio' | 'notae' | 'verba' | 'privacy' | 'stellae' | 'contentHash'>>
  ): Promise<Intelligens>

  /**
   * Full-text and prefix search across nomen, descriptio, and notae.
   * Uses MongoDB $text index if available, otherwise falls back to $regex.
   * Case-insensitive. Returns all matching weights.
   */
  search(query: string): Promise<Intelligentia>
}
