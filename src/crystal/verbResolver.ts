// =============================================================================
// verbResolver — derives an essentia's canon verb from its aditus/exitus ports
// =============================================================================
//
// `CANON_VERBS` (canonVerbs.ts) is a sparse verb→default-flow lookup, not a
// per-essentia classifier — it answers "what flow does this verb use today,"
// not "what verb is THIS essentia." This module answers the latter: given any
// modus's port shapes, DERIVE its canon verb at call time from the signature
// table in `docs/capability-map.md` (input modality(ies) → output modality →
// verb), rather than storing/seeding a verb field per essentia.
//
// Not wired into any consumer yet (catalogue UI / CrystalApi / concierge —
// noema-055/056). This item builds the resolver in isolation.
// =============================================================================

import type { Forma, Modus } from '../types/modus.js'

/**
 * The 14 capability-map verbs, plus `enhance` — a 15th, uncatalogued verb for
 * essentiae whose aditus is image-only with no text input at all (rmbg,
 * upscale, per their own source comments in seeds/essentiae.ts).
 */
export type CanonVerb =
  | 'make' | 'effect' | 'animate' | 'direct' | 'render'
  | 'chat' | 'describe' | 'transcribe' | 'speak' | 'compose' | 'foley'
  | 'sculpt' | 'lift' | 'scan'
  | 'enhance'

/** The 15th verb — outside `docs/capability-map.md`'s 14-row table (see module doc). */
export const ENHANCE: CanonVerb = 'enhance'

type Modality = 'text' | 'image' | 'video' | 'audio' | '3d'

/** Any object carrying `aditus`/`exitus` port schemas — a `Modus` or an `Essentia` (which extends it). */
export type PortShaped = Pick<Modus, 'aditus' | 'exitus'>

/**
 * The capability-map signature table, encoded as data: required-input-modality-set →
 * output-modality → verb. Mirrors `docs/capability-map.md`'s "Canon verbs" table
 * (ADR-0004: verbs = signatures; conditioning = flow).
 *
 * Keyed by whether the required input is text-only ('text') or includes a media
 * port ('media' — image/video/audio/3d, keyed by the media port's own type since a
 * few rows fork by input media type, e.g. i2i vs v2i share an image-family verb only
 * where noted). Rows the codebase marks 'planned' (no live flow yet) are still
 * encoded here — this component classifies structurally, independent of what has a
 * shipped flow.
 */
const TEXT_INPUT_TABLE: Record<Modality, CanonVerb> = {
  text: 'chat',      // t2t — conversational text
  image: 'make',     // t2i — image from prompt
  video: 'direct',   // t2v — video from text
  audio: 'compose',  // t2a — music (foley/speak are t2a·sfx / t2a·speech sub-flavors; compose is default)
  '3d': 'sculpt',    // t2m — text → 3D
}

const MEDIA_INPUT_TABLE: Partial<Record<Modality, Partial<Record<Modality, CanonVerb>>>> = {
  image: {
    text: 'describe',  // i2t — caption / VQA / analyze
    image: 'effect',   // i2i — image transform
    video: 'animate',  // i2v — video from a still
    '3d': 'lift',      // i2m — image → 3D
  },
  video: {
    text: 'describe',  // v2t — recap (reachable via /run today; same describe family)
    video: 'effect',   // v2v — rework
    '3d': 'scan',      // v2m — video → 3D (photogrammetry / NeRF / splat)
  },
  audio: {
    text: 'transcribe', // a2t — speech → text
    video: 'effect',    // a2v — visualizer / lipsync
    audio: 'effect',    // a2a — voice convert / denoise / stems
  },
  '3d': {
    image: 'render',  // m2i — render a 3D asset → image
    video: 'render',  // m2v — render a 3D asset → video
  },
}

/** Media modalities, in priority order for picking "the" required media input when more than one exists. */
const MEDIA_MODALITIES: Modality[] = ['image', 'video', 'audio', '3d']

function requiredPortTypes(forma: Forma): Set<string> {
  const types = new Set<string>()
  for (const porta of Object.values(forma)) {
    if (porta.required) types.add(porta.type)
  }
  return types
}

function anyPortTypes(forma: Forma): Set<string> {
  const types = new Set<string>()
  for (const porta of Object.values(forma)) types.add(porta.type)
  return types
}

function outputModality(exitus: Forma): Modality | undefined {
  // The primary output port's type — the first port declared, matching how every
  // essentia in seeds/essentiae.ts declares a single-purpose exitus.
  const first = Object.values(exitus)[0]
  const type = first?.type
  return type === 'text' || type === 'image' || type === 'video' || type === 'audio' || type === '3d'
    ? type
    : undefined
}

/**
 * Resolve the canon verb for a modus (or essentia) from its aditus/exitus port
 * shapes. Pure function — no I/O, no registry lookups.
 *
 * Classification rule (operator decision, 2026-07-14) — checked in this order:
 *
 * 1. If aditus contains **only media input(s) (image/video/audio/3d) and no text
 *    input at all** (required or optional) → `enhance`, the 15th verb — returned
 *    explicitly, never silently folded into another verb. This is checked FIRST
 *    because it overrides rule 2 below: `rmbg` and `upscale` both have a
 *    *required* image input (which rule 2 alone would route to `effect`), but
 *    their total absence of any text port is what marks them `enhance` instead
 *    (per their own source comments in seeds/essentiae.ts).
 * 2. Else if aditus has a **required media input** (image/video/audio/3d,
 *    regardless of whether text is also required) → the matching media-family
 *    row (e.g. required image + required text, output image → `effect`). A
 *    required text prompt alongside a required media input does NOT disqualify
 *    this row — e.g. `flux-i2i` (required `prompt` + required `image`, image
 *    out) is `effect`, not `make`.
 * 3. Else if aditus has a **required text input** and no required media input →
 *    the matching text-origin row (e.g. output image → `make`). An *optional*
 *    media input (a control/reference image) does not change this — classification
 *    is driven by required ports only. No essentia in seeds/essentiae.ts currently
 *    carries an optional secondary image alongside a required prompt (flux-schnell's
 *    aditus is text-only); this rule exists for when one ships (e.g. a future
 *    ControlNet-conditioned t2i flow).
 */
export function resolveCanonVerb(modus: PortShaped): CanonVerb {
  const required = requiredPortTypes(modus.aditus)
  const anyTypes = anyPortTypes(modus.aditus)
  const outModality = outputModality(modus.exitus)

  const hasAnyMedia = MEDIA_MODALITIES.some((m) => anyTypes.has(m))
  const hasAnyText = anyTypes.has('text')
  if (hasAnyMedia && !hasAnyText) return ENHANCE

  const requiredMedia = MEDIA_MODALITIES.find((m) => required.has(m))
  if (requiredMedia) {
    const row = MEDIA_INPUT_TABLE[requiredMedia]
    const verb = row && outModality ? row[outModality] : undefined
    if (verb) return verb
  }

  if (required.has('text')) {
    const verb = outModality ? TEXT_INPUT_TABLE[outModality] : undefined
    if (verb) return verb
  }

  // Fell through every rule (no recognized required input, or no matching
  // output-modality row) — enhance is the explicit "unclassified" fallback
  // rather than throwing; callers that need a hard error can check the input
  // shape themselves before calling.
  return ENHANCE
}
