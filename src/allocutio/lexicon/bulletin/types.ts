// =============================================================================
// Bulletin subsystem — shared types & constants
// =============================================================================
// The session bulletin is a per-conversation HUD that narrates one pod's life as
// a JOURNAL (committed lines that persist) plus one volatile live line and an
// execution stat line. These types are platform-agnostic; the Telegram adapter
// renders the neutral keyboard spec into inline buttons.

/** Warm-window ladder for the stepper. ‹ steps toward 1s, › toward 30m. */
export const WARM_LADDER_MS    = [1_000, 5_000, 30_000, 60_000, 300_000, 600_000, 1_800_000]
export const WARM_LADDER_LABEL = ['1s', '5s', '30s', '1m', '5m', '10m', '30m']
export const WARM_DEFAULT_MS    = 60_000   // 1m
export const AUTO_SETTLE_MS     = 20_000   // confirm the warm window if untouched this long
export const COLD_TYPICAL_MS    = 7 * 60_000 // baseline the prep "(% vs avg)" races against
export const WARM_TYPICAL_SEC   = 25       // typical warm compute → "next gen ~$X" estimate
export const HUNT_SLOW_MS       = 12_000   // surface the hunt line only if it drags past this
export const DL_SLOW_MS         = 90_000   // annotate the download if prep runs long

/** Who is looking at the bulletin — scopes controls + copy. Only 'host' is wired today. */
export type Audience = 'host' | 'guest' | 'onlooker'

/**
 * A committed journal line — STRUCTURED, not prose, so `bail` removes by kind and
 * tests assert on data. Rendered to text by BulletinView at display time.
 */
export type JournalEntry =
  | { kind: 'found'; gpu?: string; rate?: number; ms: number }
  | { kind: 'quit'; podNum: number; reason: string }
  | { kind: 'prepared'; ms: number }

/** The current in-flight phase — drives the single volatile "live" line. */
export type LiveState =
  | { kind: 'hunting-slow' }                                  // escalated only when the hunt drags
  | { kind: 'initializing' }
  | { kind: 'downloading'; n?: number; m?: number; slow: boolean }
  | { kind: 'plugins' }
  | { kind: 'reloading' }
  | { kind: 'generating' }
  | { kind: 'saving' }

/**
 * A model queued onto the session's loadout via `Mod • → Add`, not yet installed.
 * `intellaId` is an Intella id (the same id-space as `Materia.installedModels` and
 * what `Compiler._resolveModels` resolves), so the view can de-dupe queued-vs-installed
 * and the dispatch path can stamp it onto `aditus._pinnedModels`. `genus` is narrowed
 * to the two kinds the picker offers: a base `'model'` or a `'lora'`.
 */
export interface PendingModel {
  intellaId: string
  nomen: string
  genus: 'model' | 'lora'
}

/**
 * Loadout — the studio's model base, shown when the host opens `Mod •`. It REPLACES the
 * bulletin body with a spec view: the container image, the inferred runtime shape, and the
 * installed models grouped by architectura (unet / gguf / lora / …). Pure data; the view
 * formats it. The adapter gathers it from `Materia.imageRef` + `installedModels`.
 */
export interface Loadout {
  /** Container image the studio booted, e.g. 'stationthis/flux-comfyui:v1'. */
  image?: string
  /** Runtime shape inferred from the image — 'ComfyUI' | 'llama.cpp' | 'vLLM' | …. */
  runtime?: string
  /**
   * Base models grouped by architectura (unet / gguf / …), each carrying the LoRAs trained
   * for it (LoRAs are subordinate to their base via `baseIntellaId`). Empty = nothing installed.
   */
  categories: Array<{
    architectura: string
    bases: Array<{ nomen: string; loras: string[] }>
  }>
  /** LoRAs whose base model isn't installed — shown flat at the end so nothing is lost. */
  looseLoras?: string[]
  /** Accumulated weight footprint in GB (∑ flow footprints) vs the GPU's `Materia.vramGb` capacity.
   *  The VRAM-budget stub — surfaced for info; co-hosting will enforce footprint ≤ capacity. */
  vramGb?: number
}

/**
 * Picker state for `Mod • → Add` — a sub-state of the `mod` submenu (active when
 * `activeSubmenu === 'mod'` and this is set). Pure data: the adapter fills `items`
 * (the CURRENT page, already sliced) and `pageCount` from the catalog, and the view
 * renders one button per item plus filter/nav rows. `query` is set when the items
 * came from a search rather than a browse. This shape is platform-neutral and is the
 * piece a follow-up extracts into a shared `lexicon/picker/` module for `/arm` + other
 * endpoints to reuse.
 */
/**
 * Arm wizard — `/arm` configures a studio's *shape* before models: pick the container image,
 * then the runtime/config, THEN add models (the picker). Image + config define the instance;
 * models are downstream. v1 has one image + one config (ComfyUI), but the steps are real so a
 * second image / a `llama-server` runtime slots in. Once config is chosen, the wizard hands off
 * to the Mod • loadout/Add menu.
 */
/**
 * A `/arm` chooser card — a presentation projection of a `Fundamentum` (ADR-0005): the compute
 * substrate a host can provision a studio from. `id` is the fundament id (e.g. 'flux-comfyui');
 * `familia` is the model family it scopes the LoRA menu to (e.g. 'flux'); `'custom'` drops into the
 * manual image→config path. The detail fields back the card (what the fundament bundles before you
 * commit). All detail fields are optional (the chooser only needs id + label).
 */
export interface ArmPreset {
  id: string
  label: string
  /** The model family this fundament serves — scopes the LoRA picker (`armBase`). Absent on Custom. */
  familia?: string
  /** One-line summary shown on the detail card. */
  blurb?: string
  /** The base/support weights this fundament provisions. */
  models?: string[]
  /** The runtime/config it provisions (e.g. 'ComfyUI'). */
  config?: string
  /** The container image it runs on. */
  image?: string
  /** Rough weight footprint in GB (∑ model sizes) — the VRAM-budget stub; inert until co-hosting. */
  vramGb?: number
}

export interface ArmState {
  step: 'preset' | 'flowdetail' | 'image' | 'config'
  /**
   * Curated quick-start presets shown FIRST (e.g. FLUX / SDXL / Z-Image) — each a recognizable
   * flow abstracting image+config+base. Tapping a name opens its detail card ('flowdetail'); the
   * `+` commits it. `'custom'` drops into the manual image→config path (for advanced hosts — and,
   * later, composing multiple flows/configs on one studio).
   */
  presets: ArmPreset[]
  /** The preset whose detail card is open (step 'flowdetail'). */
  flow?: ArmPreset
  /** A transient notice on the chooser (e.g. a runtime-conflict rejection), cleared on next add/nav. */
  note?: string
  /** Available container images (Custom path — popular/only-one first). */
  images: string[]
  /** The chosen image (set at the 'config' step). */
  image?: string
  /** Available runtimes/configs for the chosen image (e.g. 'ComfyUI', later 'llama-server'). */
  configs: string[]
}

/**
 * Model detail card — shown when the host taps a model's name in the list (a `detail` sub-stage
 * of the picker). Sources the reliably-populated structural fields; description appears when the
 * record carries one. Ratings / comments / example images are a later content sprint.
 */
export interface ModelDetail {
  intellaId: string
  nomen: string
  genus: 'model' | 'lora'
  mount?: string        // ComfyUI folder (dest's first segment)
  base?: string         // base model nomen (LoRAs)
  trigger?: string      // LoRA trigger word
  sizeGb?: number
  provenance?: string   // sources[0].provenance
  sourceUri?: string    // sources[0].uri
  auctor?: string
  versio?: string
  description?: string
}

export interface PickerState {
  /** 'categories' = choose a model type; 'list' = the paginated models; 'detail' = one model's card. */
  stage: 'categories' | 'list' | 'detail'
  /** Mount-location categories, popular-first (stage 'categories'). */
  categories: string[]
  /** The chosen mount/category (stage 'list'); undefined while choosing one. */
  mount?: string
  /** The current page's candidates (already sliced to page size; stage 'list'). */
  items: PendingModel[]
  /** 0-based page index. */
  page: number
  /** Total pages available for the current mount/query. */
  pageCount: number
  /** The search term, when results came from a search (flat across mounts; overrides mount). */
  query?: string
  /** The model card, when `stage === 'detail'` (the list state behind it is preserved for Back). */
  detail?: ModelDetail
  /**
   * LoRA list base filter — the base families present in the data, derived from the loras'
   * `baseIntellaId` (e.g. FLUX/SDXL/Illustrious), each with a count, plus an "All bases" entry.
   * Set ⟺ the mount supports base filtering (the LoRA folder), which is also when the filter
   * button shows. `baseFilter` is the selected family id (`''` = all); the button cycles them.
   */
  baseFamilies?: Array<{ id: string; label: string }>
  baseFilter?: string
  /** Transient one-line result of an "add by trigger" reply (e.g. "Added: milady · no match: foo"),
   *  shown under the list and cleared on the next navigation. */
  note?: string
  /**
   * Monotonic generation of the displayed item set — bumped whenever the items change
   * (page/mount/search/filter). Encoded into each pick button's id (`mod.pick:<token>:<i>`);
   * a tap whose token ≠ the current one is a stale button from a superseded view and is
   * rejected, so a page-relative index can never resolve to the wrong model.
   */
  token: number
}

// The bulletin keyboard is just the shared neutral UI keyboard (aliased for history).
import type { UiButton, UiKeyboard } from '../ui/Keyboard.js'
export type BulletinButton = UiButton
export type BulletinKeyboard = UiKeyboard

/** A fully-rendered bulletin: text + keyboard. Pure output of BulletinView. */
export interface RenderedBulletin {
  text: string
  keyboard: BulletinKeyboard
}
