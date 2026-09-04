// =============================================================================
// MODUS — the fractal tool primitive
// =============================================================================
//
// The word "modus" is Latin second-declension masculine for "measure, manner,
// way." Spinoza used it technically: a modus is a finite expression of infinite
// substance (here: materia, the compute substrate). Aristotle: form (modus)
// imposed on matter (materia) produces a result (actum).
//
// A modus is FRACTAL: it can be an atomic leaf (atomicus) that runs one
// operation, or a composed tree (compositus) whose children are other modi.
// This single primitive replaces what were previously called "tools" (atomic),
// "spells" (sequential compositions), and batch/expression grids (a Collectio).
//
// TRIAD: modus defines → modo executes → actum records
//
// DECLENSION (how the word inflects — each form has a meaning in the codebase):
//   modus    — the class, the primitive itself (nominative)
//   modi     — of the modus / its parameters (genitive singular)
//   modorum  — of the modes / the registry (genitive plural)  → Modorum
//   modum    — the modus being acted on (accusative)
//   modo     — by/in/through a mode — the runtime session (ablative) → Modo type
// =============================================================================

import type { ComputeStrategy, GpuClass } from './actum.js'
import type { PodPolicy } from './materia.js'
import type { AuctorKey } from '../flow/types.js'
import type { CanonVerb } from '../crystal/verbResolver.js'
export type { ComputeStrategy, GpuClass, PodPolicy }
export type { AuctorKey }

/** Whether a modus is a leaf operation or a tree of other modi */
export type ModusGenus = 'atomicus' | 'compositus'

/**
 * OwnedRef — the declaration that an aditus port carries a REFERENCE to a stored,
 * owner-bearing resource rather than a plain value.
 *
 * An Actum is identity-blind by design (ADR-0002: identity lives in `Hospitium`, surfaced
 * late), so a cursor that reads a resource id out of its aditus has no caller to scope that
 * read against — the same reason `modus.muse-steer` passes its floor inline rather than by
 * session id. The scope is therefore resolved ABOVE the cursor, at the one seam that still
 * knows who is calling: the API's run entry point. This marker is what tells that seam which
 * ports to resolve, and against which store.
 *
 * It lives on `Porta` because a Porta already declares everything else about a port
 * (`{type, required, default, label…}`, ADR-0003), and the Porta canon is extended in place
 * rather than paralleled by a second declaration table (ADR-0004/0007).
 *
 *   `dataset`     — a `Dataset` id, resolved against the `Datasets` store.
 *   `corpus`      — a `Corpus` id, resolved against `Corporum`. A port of this genus may
 *                   instead carry an INLINE manifest: caller-supplied content rather than a
 *                   reference to a stored record, and passed through untouched.
 *   `captionset`  — a sub-resource: a captionset id, resolved against the parent dataset
 *                   named by `parens` (the sibling aditus key carrying the dataset id).
 */
export type OwnedRef =
  | { genus: 'dataset' }
  | { genus: 'corpus' }
  | { genus: 'captionset'; parens: string }

/** A single named port (input or output) on a modus */
export interface Porta {
  // "porta" = gate/door in Latin — an opening in the modus boundary
  // Canonical type name: 'text' | 'image' | 'video' | 'audio' | '3d' | 'int' | 'float' | 'bool'.
  // Left as a bare `string` rather than a union so a new provider can name a type the core does
  // not know yet; `validateAditus` passes an unrecognised type through untouched.
  //
  // 'bool' exists because the coercion a port gets is decided by this name, and a boolean port
  // declared 'text' would be coerced with `String(value)` — turning `false` into the truthy
  // string `"false"` and inverting any `!== false` opt-out the cursor reads it with. A boolean
  // port must say 'bool' to survive validation as a boolean.
  type: string
  required?: boolean
  default?: unknown
  label?: string        // short display name shown on the canvas port
  description?: string  // longer helper text / tooltip
  /**
   * Flow-baked text woven AROUND this (text) Porta's value at compile time. The
   * user supplies the variable; the flow supplies the wrapper. On a 'text' Porta
   * carrying a string value the Compiler rewrites it to
   * `[praefixum, value, suffixum].map(trim).filter(Boolean).join(', ')`, BEFORE
   * LoRA trigger resolution (so a trigger word inside an affix still resolves).
   * Absent → value unchanged (no-op). This is how a saved flow carries a "style".
   */
  praefixum?: string    // "praefixum" = prefixed — text woven before the value
  suffixum?: string     // "suffixum" = suffixed — text woven after the value
  /** Enumerated choices for this port. When present the UI renders a select rather than a free-text
   *  input; the value is still whatever the caller sends (the list is a convenience, not a validator —
   *  a caller may pass an id not in the list, e.g. a brand-new upstream model). */
  optiones?: Array<{ value: string; label: string }>
  /**
   * NUMERIC LEGALITY (noema-396) — the legal values of an 'int' / 'float' port, declared rather
   * than described. Before these existed a port with a legality rule could only state it in the
   * `description` and hope: MiniMax H3 accepts clip lengths of 17k+5 frames and nothing else, so
   * `frames: 100` provisioned a pod, pulled 56 GB of weights and failed at execution — ~28 minutes
   * and real GPU spend to reject an input that was illegal before the run started. Declared here,
   * the run entry point refuses it before anything is reserved (`portaConstraints.ts`), and the
   * published per-flow JSON-Schema carries it so a caller sees the rule before calling.
   *
   *   `min`  — the smallest legal value (inclusive).
   *   `max`  — the largest legal value (inclusive).
   *   `step` — the spacing between legal values, measured FROM `min` (from 0 when `min` is unset).
   *            This is the ComfyUI INPUT_TYPES sense of the word, which is where these rules come
   *            from, and it is what lets `{min: 5, step: 17}` state "17k+5" exactly. Note it is
   *            NOT JSON Schema's `multipleOf` unless `min` is itself a multiple of `step`.
   *
   * Deliberately only three scalars. An enumerated set is ALREADY expressible (`optiones`) and is
   * deliberately advisory there — a caller may pass an id the list does not carry, e.g. a
   * brand-new upstream model — so promoting it to a validator would break that on every port that
   * uses it. A named-predicate registry was considered and rejected: it reintroduces flow-specific
   * code, and no second flow demands one.
   *
   * Meaningful on 'int' and 'float' ports only; a constraint on any other type is refused by the
   * catalog guard rather than silently ignored. Absent → the port is unconstrained and behaves
   * exactly as it did before this field existed.
   *
   * Definitional, like `owned`: it is part of the modus's contract about what its inputs MEAN, so
   * it rides the `contentHash` with the rest of `aditus`.
   */
  min?: number
  max?: number
  step?: number
  /**
   * Declares that this (aditus) port names a stored, owner-bearing resource — see `OwnedRef`.
   * Present → the run entry point resolves the value against the declared store, scoped to the
   * calling anima, and refuses the run before anything is reserved or dispatched when the
   * reference does not resolve for that caller. Absent → the port is a plain value.
   *
   * Definitional: it is part of the modus's contract about what its inputs MEAN, so it rides
   * the `contentHash` like the rest of `aditus`.
   */
  owned?: OwnedRef
}

/**
 * The full input or output schema of a modus.
 * "forma" = shape/form in Latin — the declared shape of what enters or exits.
 * aditus (entrance) and exitus (exit) are both Forma.
 */
export type Forma = Record<string, Porta>

/**
 * A single step within a compositus modus.
 * "gradus" = step/degree in Latin — root of the English word "gradient."
 * A compositus modus is an ordered list of gradus, each invoking a child modus.
 */
export interface Gradus {
  /** "ordine" = in order — the position of this step in the sequence (0-indexed) */
  ordine: number
  /** Which modus to invoke at this step */
  modusId: string
  /**
   * "condicio" = condition — an optional expression string that must evaluate
   * to true for this step to run. Uses the expression system (expr-eval).
   * Example: "input.width > 512"
   */
  condicio?: string
  /** If true, this step can run in parallel with adjacent steps at the same ordine */
  parallel?: boolean
  /**
   * "ligamina" = bonds/ties (plural of ligamen) — per-port input wiring.
   * Maps THIS step's aditus port → a prior step's exitus. Only cross-step wires
   * need an entry; ports not listed bind by name from the compositus modus's own
   * `aditus`, then fall back to the child modus's `Porta.default`.
   *
   * Resolution precedence for a step's input port (most specific first):
   *   explicit ligamen (prior step exitus) > compositus aditus by name > child default.
   *
   * Example (sd1-5 → upscale): the upscale step declares
   *   `{ image: { gradus: 0, exitus: 'image' } }`
   * — its `image` input is fed by step 0's `image` output.
   *
   * This is the distilled form of a `TabulaVinculum`: the Tabula→Modus publish
   * compiler emits `ligamina` from the canvas edges. (ADR-0008.)
   */
  ligamina?: Record<string, GradusFons>
}

/**
 * GradusFons — "fons" = source/spring in Latin. Where one input port of a gradus
 * draws its value: the exitus of a prior step (by ordine + output port key).
 */
export interface GradusFons {
  /** The ordine of the prior step whose exitus feeds this port */
  gradus: number
  /** The output port key on that prior step's exitus */
  exitus: string
}

/**
 * Pretium — a flow's fitted cost curve, in wall-clock SECONDS of execution.
 * See `Modus.pretium` for what each term means and `reservationImpetus`
 * (ledger/rates.ts) for how they combine into a reservation.
 */
export interface Pretium {
  /** This flow's own fixed overhead: weight download + model load. */
  baseSeconds: number
  /** The per-inference-step part, multiplied by `aditus.steps`. */
  perStepSeconds?: number
  /** The resolution-dependent part, multiplied by `width × height / 1e6`. */
  perMegapixelSeconds?: number
}

/**
 * Modus — the fractal tool primitive.
 *
 * Atomic modus (genus: 'atomicus'):
 *   A leaf operation. Has aditus/exitus schema. No gradus. Executes one thing.
 *   These are what the platform's Essentia catalog is made of.
 *
 * Composed modus (genus: 'compositus'):
 *   A tree of other modi wired by gradus steps and condicio expressions.
 *   This is how "spells" (sequential) and batch/expression (a Collectio) are expressed.
 *   Can contain other compositus modi — fractal depth is unlimited.
 */
export interface Modus {
  id: string
  /** "nomen" = name in Latin */
  nomen: string
  /**
   * "descriptio" = a written description in Latin — a flow-LEVEL routing line: what
   * this flow is for and when to pick it over its siblings, in one sentence. Distinct
   * from the per-Porta `Porta.description` (input-field tooltip). Read by the
   * concierge/router to disambiguate flows that share a category (e.g. the text-to-image
   * family). Inert display/routing metadata — NOT part of the contentHash (a copy edit
   * must never re-hash a modus); see hashModus.ts. Absent → the flow carries no routing line.
   */
  descriptio?: string
  genus: ModusGenus
  /** Semantic version string e.g. "1.0.0" */
  versio: string
  /**
   * Content-addressed SHA-256 hash of the modus definition.
   * Locks the definition at a point in time. Changing any field changes the hash.
   * Used to verify that the modus that ran matches the modus that was quoted.
   */
  contentHash: string

  /** Input schema — "aditus" = entrance in Latin */
  aditus: Forma
  /** Output schema — "exitus" = exit in Latin */
  exitus: Forma

  /**
   * "verbum" = word in Latin — an explicit canon-verb override for this seed.
   * When set, `resolveCanonVerb` (crystal/verbResolver.ts) returns it directly,
   * bypassing the 3-rule structural cascade entirely (operator decision,
   * 2026-07-14: fixes derivation blind spots for a handful of named flows
   * without rewriting the cascade). Absent (the default) → the cascade derives
   * the verb from `aditus`/`exitus` as before, unaffected.
   */
  verbum?: CanonVerb

  /** Ordered steps — present only when genus is 'compositus' */
  gradus?: Gradus[]

  /**
   * The physical WEIGHT manifest — the set of Intellae this flow downloads onto
   * the pod before inference. Each entry is an `{ id, role }` ref:
   *   - `id`   FK → Intella (the registered weight record; url/dest resolve from it)
   *   - `role` the weight's slot — existing strings: 'checkpoint' | 'unet' | 'vae'
   *            | 'clip' | 'lora' | … (matches a ComfyUI model loader / download dir)
   *
   * Atomic flow → its full weight set (flux = unet + vae + 2×clip; sd1.5 = the
   * single self-contained checkpoint). Composite flow → the union across `gradus`
   * children. This REPLACES the workflow template's `requiredModels` *list* as the
   * source of truth: the flow declares what it downloads. The template's
   * `requiredModels` survives only as a url/dest fallback (keyed by id).
   *
   * The flow's model FAMILY is DERIVED from these weights' `Intella.familia`
   * (never declared here) — single source of truth, zero drift. (See the
   * Compiler's family-derivation step.)
   */
  intellae?: Array<{ id: string; role: string }>

  /**
   * Which execution service (cursor) handles this modus.
   * "ministerium" = service/office in Latin — the function assigned to this modus.
   * Maps to a registered Cursor in the Cursorum.
   * Examples: 'runpod', 'openai', 'replicate', 'comfyui', 'local'
   * Absent on compositus modi — execution is handled by their constituent atomici.
   */
  ministerium?: string

  /**
   * Fixed impetus cost for this modus, if cost is known at definition time.
   * "fixum" = fixed/fastened in Latin.
   * Present for third-party API tools (OpenAI, Replicate, etc.) where cost
   * is deterministic. Absent for pod-based tools where actual cost depends
   * on runtime duration: impetus = Materia.impetusPerSecond × Actum.duratio.
   */
  impetusFixum?: bigint

  /**
   * "pretium" = price/cost in Latin — this flow's own COST MODEL, used to size the
   * up-front reservation for pod-based flows (which have no `impetusFixum`).
   *
   * All fields are BILLED SECONDS — the runner's own job clock, which is also the
   * settlement unit on the pod path (one impetus per billed second):
   *   baseSeconds          this flow's own fixed overhead — weight download + model
   *                        load, i.e. its cold-run billed window minus its execution
   *                        time. (Pod provisioning is outside that window and so is
   *                        not in this term.) Always the cold case: `reserve()` runs
   *                        before pod routing, so it cannot know whether the job will
   *                        land on a warm pod — and concurrent dispatches routinely
   *                        all miss the warm pool and each pay their own download, so
   *                        this term is never amortised across a fan-out.
   *   perStepSeconds       the per-inference-step part, multiplied by `aditus.steps`.
   *   perMegapixelSeconds  the resolution-dependent part, multiplied by
   *                        `width × height / 1e6`.
   *
   * Optional and per-flow: declare it only for a flow with enough observed runs to
   * fit a curve. A flow without `pretium` falls back to `GENERIC_RESERVE_IMPETUS`
   * (see `ledger/rates.ts`), so leaving it undefined is always safe — but the generic
   * bound is set by the most expensive flow on the platform, so a cheap flow left on
   * it holds far more than it needs and caps how wide a fan-out over it can run.
   *
   * Definitional (it prices the flow), so it IS part of the contentHash. It rides the
   * `...rest` passthrough in `hashModus`, and the same passthrough in `MongoModorum`'s
   * toDoc/fromDoc persists it as a plain nested object. That is deliberate — only
   * bigint fields (`impetusFixum`) need per-field serialisation; do not add any here.
   */
  pretium?: Pretium

  /**
   * How results are delivered to the caller.
   * sync: cursor.run() blocks and returns Exitus inline.
   * async: cursor.run() submits the job and returns externusJobId; completion
   *        arrives via inbound webhook → ActumCompletor.complete().
   * Absent defaults to 'sync'.
   */
  deliveryMode?: 'sync' | 'async'

  // ── Execution preferences ────────────────────────────────────────────────
  // These fields are per-flow user preferences. They are NOT part of the
  // contentHash — changing them does not change the workflow definition.
  // The HOME "set default" bulk-updates these across all user-owned flows.
  /** How this flow should be dispatched. Absent: 'standard'. */
  computeStrategy?: ComputeStrategy
  /** GPU class for performance-tier runs. Only meaningful when computeStrategy is 'performance'. */
  gpuClass?: GpuClass
  /** What happens to the warm pod after a job on this flow completes. Absent: 'economy'. */
  podPolicy?: PodPolicy

  /**
   * "auctor" = author/creator in Latin — the OWNER of this modus.
   * Reuses the crystal's identity union (`AuctorKey` = `{ animaId } | { commitment }`,
   * the same shape `Collectio.by` carries): identified souls own by `animaId`,
   * anonymous users own by their arcanum `commitment` (H(secret)). Canonical
   * platform modi leave this undefined.
   */
  auctor?: AuctorKey
  /**
   * "fonte" = source/spring in Latin — the parent `Modus.id` a saved (derived)
   * flow was forked from. Provenance + the ADR-0003 fork chain (royalties). Absent
   * on canonical modi and any modus authored from scratch.
   */
  fonte?: string
  /** True = platform-owned canonical modus. False = community-published. */
  canonica: boolean

  /** Community star count — embedded count for fast catalog sorting */
  stellae?: number

  /** "natum" = born — when this modus was first registered */
  natum: Date
  /** "mutatum" = changed — when this modus was last modified */
  mutatum: Date
}

/** "Modi" — nominative plural of modus. A collection of modi. */
export type Modi = Modus[]

/**
 * Modorum — genitive plural "of the modes."
 * The registry that owns, stores, and resolves all modus definitions.
 */
export interface Modorum {
  find(id: string, versio?: string): Promise<Modus | null>
  register(modus: Modus): Promise<void>
  list(filter?: Partial<Pick<Modus, 'genus' | 'canonica' | 'auctor'>>): Promise<Modi>
  /**
   * Update execution preferences on a user-owned modus.
   * Only non-definitional fields (computeStrategy, gpuClass, podPolicy) are
   * accepted here — changes that would alter the workflow definition require
   * a new register() call with a bumped versio and recomputed contentHash.
   */
  update(id: string, patch: Partial<Pick<Modus, 'computeStrategy' | 'gpuClass' | 'podPolicy'>>): Promise<Modus>
}
