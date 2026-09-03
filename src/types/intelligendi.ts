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

/**
 * Adult-content classification axis (spec: docs/spec/intella-schema.md §9, "locked shape").
 * 'untriaged' = not yet reviewed; 'sfw' = safe; 'suggestive'/'explicit' are admin-assigned
 * during review.
 */
export type IntellaContentRating = 'untriaged' | 'sfw' | 'suggestive' | 'explicit'

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
  /** File format — determines how the runtime loads it ('gguf' = llama.cpp/LLM weights) */
  format?: 'safetensors' | 'ckpt' | 'pt' | 'bin' | 'gguf'
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
   * Human-readable description, when the record carries one (v2 migration output, English
   * `description` field — an outlier in this otherwise-Latin type, matching the migrated data).
   * Surfaced on the Mod • model detail card. Often a thin auto-stub on migrated LoRAs; richer
   * text is a later content sprint. Preserved through the MongoIntella v2→v1 projection (`...rest`).
   */
  description?: string
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
   * The model FAMILY this Intella belongs to ('flux','sd15','sdxl','z-image',…;
   * canonical lowercase). Formalizes the loose family `tag` (see `tags`) into a
   * first-class compat key.
   *
   * This is the LoRA-compatibility key: a base-weight Intella and the LoRA
   * Intellae compatible with it carry the IDENTICAL `familia` string (compat is
   * exact string equality). The Compiler derives a flow's family from the
   * `familia` of the weights it declares (`Modus.intellae`) and asks
   * `Intellarum.triggerMap(familia)` for the matching LoRAs.
   *
   * NOT `architectura` — that field is *structural* ('unet'/'dit'/'transformer')
   * and is inconsistently set; `familia` is the model-family axis specifically.
   */
  familia?: string

  /**
   * For genus 'lora': the base model this LoRA was trained against.
   * FK → Intella. A LoRA cannot run without its base model also being loaded.
   * PROVENANCE only — records which exact base the LoRA trained on. It is NO
   * LONGER the compatibility key; compat now keys on `familia` (above).
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
   * Generic owner key (`ownerKeyOf(auctor)` — `anima:<id>` / `bursa:<hash>` / `commitment:<hash>`).
   * Set on NEW private imports so a NON-anima owner (a Bursa purse) can own + resolve a private
   * model. `ownerAnimaId` stays populated when the owner is an anima (display + legacy resolution).
   */
  ownerKey?: string
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

  /** For trained LoRAs: the number of training steps. Provenance; surfaced on the published model card. */
  trainingSteps?: number

  /**
   * Preview samples generated at the end of training — durable R2 URLs + the prompt each was
   * rendered from. First-class preview media: interfaces (the model-detail card, the /make
   * picker, galleries) surface these to convey what the LoRA does. Persisted independently of
   * publishing; the HF publisher is just one consumer that commits them into the repo.
   */
  samples?: Array<{ url: string; prompt?: string }>

  /**
   * The training dataset (for reproduction) — each image's durable URL + its caption. Surfaced
   * on the model-detail card and committed under `dataset/` when published.
   */
  datasetItems?: Array<{ url: string; caption?: string }>

  /** The ai-toolkit training config (yaml) this LoRA was trained with — committed as `config.yaml`. */
  configYaml?: string

  /**
   * For derived/retrained LoRAs: where this was retrained from — the source registry repo
   * (e.g. 'ms2stationthis/drifella') + the base it came off ('FLUX.1-dev'). Drives the
   * provenance backlink on the published model card. Distinct from `baseIntellaId` (a crystal
   * FK to the base weight); this is the external lineage a human reads.
   */
  provenance?: { repo: string; base?: string }

  /**
   * The resolved, classifier-usable base-model descriptor this Intella was trained or imported
   * against (e.g. 'black-forest-labs/FLUX.2-klein-base-4B') — NOT the raw preset alias a caller
   * passed in ('klein-4b'). Set unconditionally, wherever a real descriptor is available, at
   * training finality and at import; a DIFFERENT statement from `provenance.base` (external
   * retrain lineage, gated on `provenanceRepo`, and never set for the ordinary local-training
   * path). `classifyModelLicense`'s fallback chain reads this FIRST — see
   * docs/spec/model-base-provenance.md.
   */
  baseModel?: string

  /**
   * License id of this model (e.g. 'apache-2.0', 'openrail-m', 'flux-1-dev-nc', 'krea-community',
   * 'unknown'). For imports: the artifact's own license folded with its base's (most-restrictive).
   * Display + audit; the commercial-catalog verdict lives in `commercialUse`.
   */
  license?: string
  /**
   * Commercial-catalog eligibility, fail-closed. `familia` collapses license-distinct variants
   * (FLUX schnell=Apache vs dev=Non-Commercial both → 'flux'), so this is a SEPARATE axis from
   * `familia`. Only 'yes' clears the public (commercial) catalog; 'no'/'conditional'/'unknown' are
   * refused at PUBLIC PROMOTION — a PRIVATE import for personal use is unaffected. Set at import
   * from the base license register + the origin's stated permission (see modelLicense.ts).
   */
  commercialUse?: 'yes' | 'no' | 'conditional' | 'unknown'
  /**
   * Adult-content classification (spec: docs/spec/intella-schema.md §9). 'untriaged' = not yet
   * reviewed (default for every new import); 'sfw' = safe (default for canonical/seed models);
   * 'suggestive'/'explicit' are admin-assigned during review. Optional for backward-compat with
   * existing persisted records that predate this field.
   */
  contentRating?: IntellaContentRating

  /** Discovery/classification tags (e.g. base family 'flux'/'sd15', 'trained'). The catalog derives
   *  a model's base family from these (the import sets them; canonical seeds set them directly). */
  tags?: Array<{ tag: string; source?: string }>

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
   * Everything publicly visible: platform-canonical intellae PLUS user-published ones
   * (`access: 'public'`, v1 or v2 shape). A superset of `canonical()` — this is the read
   * that backs the public catalog, so a model a user published is browsable alongside the
   * platform-seeded set. Never returns a private record. Optional: fakes/read-only stores
   * may omit it (the facade falls back to `canonical()`).
   */
  publicCatalog?(genus?: IntellaGenus): Promise<Intellae>
  /**
   * List the models a given owner privately holds (imports + trained LoRAs), newest first.
   * Owner-scoped counterpart to `canonical()` — backs a "my models" listing so an importer can
   * actually see/manage what they brought in (a private import is resolvable by trigger but
   * otherwise invisible on the public catalog). Optional: fakes/read-only stores may omit it
   * (the facade falls back to filtering `list()`).
   */
  listByOwner?(ownerKey: string, genus?: IntellaGenus): Promise<Intellae>
  /**
   * Resolve all LoRA intellae that match a trigger word and are compatible
   * with the given model FAMILY (via `familia`).
   *
   * `familia` accepts either one family (matched exactly) or a SET of accepted families
   * (matched as membership) — a flow declaring `acceptsFamiliae` resolves LoRAs from every
   * family it accepts, while a scalar caller keeps single-family behaviour unchanged.
   *
   * ownerKey (`ownerKeyOf(auctor)` — anima OR Bursa purse) scopes results to public +
   * private LoRAs that owner can access. Absent ownerKey returns public LoRAs only.
   */
  findByTrigger(trigger: string, familia: string | string[], ownerKey?: string): Promise<Intellae>
  /**
   * Bulk-load the trigger map for a model FAMILY: every LoRA the caller can
   * access (public + their own private) whose `familia` matches, keyed by
   * lowercased trigger word. Used by the prompt-time LoRA resolver to avoid one
   * findByTrigger query per prompt token. A trigger may map to multiple
   * Intellae — the resolver picks the best one (private-owner > shared > public,
   * by recency).
   *
   * Keyed on `familia` (not a flow-global base id) so a COMPOSITE flow can call
   * it per prompt-input with that input's step family — flux-path triggers
   * resolve only flux LoRAs. (Composite compilation is a future task; the
   * signature is family-keyed now so it plugs in with no rework.)
   *
   * `familia` accepts either one family (matched exactly) or a SET of accepted families
   * (matched as membership), so a flow declaring `Fundamentum.acceptsFamiliae` gets one map
   * spanning everything it accepts. A scalar argument keeps single-family behaviour unchanged.
   */
  triggerMap(familia: string | string[], ownerKey?: string): Promise<Map<string, Intellae>>
  /**
   * Set a model's resolvability (`access`). The publishing reconciler (§5d) calls
   * this so `Intella.access` DERIVES from its `Editio` — a model becomes resolvable
   * ('public') only when published public, and 'private' again on retract. Optional:
   * read-only stores / test fakes may omit it (the reconciler no-ops when absent).
   */
  setAccess?(id: string, access: 'public' | 'private'): Promise<Intella | null>
  /**
   * Prepend a download source as the new highest priority (`sources[0]`),
   * de-duplicating by `uri`. The publishing reconciler calls this when a model's
   * weights are hosted in OUR bucket so the pod resolves the model FROM there
   * (the `miladystation` mirror convention). Optional — fakes/read-only stores omit it.
   */
  addSource?(id: string, source: IntellaSource): Promise<Intella | null>
  /** Remove a download source by `uri` — the inverse of `addSource`, called when an
   *  our-bucket model publish is retracted (the hosted copy is gone). Optional. */
  removeSource?(id: string, uri: string): Promise<Intella | null>
  /**
   * Set a model's `license` + `commercialUse` verdict — the admin license-clearance/backfill seam
   * (going-public review). Lets an operator correct a misclassified or unclassified model (e.g. a
   * legacy import, or one cleared after taking out a commercial license) so the public-catalog gate
   * lets it through. Optional: fakes/read-only stores may omit it. */
  setLicense?(id: string, patch: { license?: string; commercialUse?: 'yes' | 'no' | 'conditional' | 'unknown' }): Promise<Intella | null>
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
