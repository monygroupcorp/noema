import type { Modus } from '../../types/modus.js'

// =============================================================================
// Canonical compositus modi — the first "spells" (ADR-0008)
//
// A compositus Modus has no `ministerium`: its body is other modi, executed by the
// CompositusCursor walking `gradus` in order and threading each step's `exitus` into
// the next step's `aditus` per `ligamina`. A step's inputs bind by name from the
// compositus's own `aditus`, then fall back to the child's `Porta.default`; a
// `ligamen` overrides one port from a prior step's exitus.
//
// contentHash is set on registration via hashModus() (same discipline as essentiae).
// =============================================================================

/**
 * Make → Upscale — generate with SD1.5, then 4x-upscale the result. The canonical
 * proof of compositus execution: a hot pod runs both steps back-to-back.
 *
 *   prompt ─→ [sd1-5] ──image──→ [upscale] ──→ image (4x)
 *
 * The single cross-step wire is the upscale step's `image` input, fed by step 0's
 * `image` output. Both ports are type 'image' and hold a URL — the exitus-schema
 * contract (ADR-0009) makes this port-to-port wire honest at runtime.
 */
export const COMPOSITUS_MAKE_UPSCALE: Modus = {
  id: 'make-upscale',
  nomen: 'Make → Upscale',
  genus: 'compositus',
  versio: '1.0.0',
  contentHash: '',        // set on registration via hashModus()
  canonica: true,

  // The spell's public face: a prompt in, a 4x image out. (Width/steps/etc. use
  // SD1.5's own Porta defaults — not surfaced at the spell level in v1.)
  aditus: {
    prompt: { type: 'text', required: true, description: 'What to generate, then upscale 4x' },
  },
  exitus: {
    image: { type: 'image', description: 'The generated image, upscaled 4x' },
  },

  gradus: [
    // Step 0 — SD1.5 text→image. `prompt` binds by name from the spell aditus.
    { ordine: 0, modusId: 'sd1-5' },
    // Step 1 — upscale step 0's image. The one cross-step wire.
    { ordine: 1, modusId: 'upscale', ligamina: { image: { gradus: 0, exitus: 'image' } } },
  ],

  natum: new Date('2026-06-19'),
  mutatum: new Date('2026-06-19'),
}

/**
 * Image → Caption — caption an image with the Qwen3-VL captioner (Slice D). A single
 * step today; the public face that feeds the canon-training dataset-prep loop (and the
 * graft point for a later caption→dataset-write chain).
 *
 *   image ─→ [qwen3-vl-caption] ──→ caption
 *
 * The `image` input binds BY NAME from the spell aditus to the child's `image` port —
 * no cross-step wire needed. The captioning instruction is baked into the essentia
 * (systemPrompt + the prompt-Porta praefixum), so the spell takes just an image.
 */
export const COMPOSITUS_IMAGE_CAPTION: Modus = {
  id: 'image-caption',
  nomen: 'Image → Caption',
  genus: 'compositus',
  versio: '1.0.0',
  contentHash: '',
  canonica: true,

  // Explicit override (noema-087): image-only aditus (no text port) hits rule 1 and
  // misclassifies as `enhance`; this is really i2t — `describe`.
  verbum: 'describe',

  aditus: {
    image: { type: 'image', required: true, description: 'Image to caption' },
  },
  exitus: {
    caption: { type: 'text', description: 'A dense, comma-separated training caption' },
  },

  gradus: [
    { ordine: 0, modusId: 'qwen3-vl-caption' },
  ],

  natum: new Date('2026-06-23'),
  mutatum: new Date('2026-06-23'),
}

export const CANONICAL_COMPOSITI: Modus[] = [
  COMPOSITUS_MAKE_UPSCALE,
  COMPOSITUS_IMAGE_CAPTION,
]
