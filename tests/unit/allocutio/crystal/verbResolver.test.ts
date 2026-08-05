import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveCanonVerb, ENHANCE, type PortShaped } from '../../../../src/crystal/verbResolver.js'
import {
  ESSENTIA_RUNMAKE_FLUX_SCHNELL,
  ESSENTIA_FLUXI2I,
  ESSENTIA_RMBG,
  ESSENTIA_UPSCALE,
  ESSENTIA_QWEN3_VL,
  ESSENTIA_SHOTVL,
  ESSENTIA_HUNYUAN3D,
} from '../../../../src/crystal/seeds/essentiae.js'
import { COMPOSITUS_IMAGE_CAPTION } from '../../../../src/crystal/seeds/compositi.js'
import {
  MODUS_LAYER_COMPOSITE,
  MODUS_FRAMES_TO_VIDEO,
  MODUS_AITOOLKIT_TRAINING,
} from '../../../../src/crystal/seeds/modi.js'

test('flux-schnell (text-only aditus, image output) resolves to make', () => {
  assert.equal(resolveCanonVerb(ESSENTIA_RUNMAKE_FLUX_SCHNELL), 'make')
})

test('flux-i2i (required image + text aditus, image output) resolves to effect', () => {
  assert.equal(resolveCanonVerb(ESSENTIA_FLUXI2I), 'effect')
})

test('rmbg (image-only aditus) resolves to enhance', () => {
  assert.equal(resolveCanonVerb(ESSENTIA_RMBG), ENHANCE)
  assert.equal(resolveCanonVerb(ESSENTIA_RMBG), 'enhance')
})

test('upscale (image-only aditus) resolves to enhance', () => {
  assert.equal(resolveCanonVerb(ESSENTIA_UPSCALE), ENHANCE)
})

test('required text + optional secondary image, image output resolves to make (control-image snag)', () => {
  const synthetic: PortShaped = {
    aditus: {
      prompt: { type: 'text', required: true, description: 'Prompt' },
      control_image: { type: 'image', required: false, description: 'Optional reference/control image' },
    },
    exitus: {
      image: { type: 'image', description: 'Generated image' },
    },
  }
  assert.equal(resolveCanonVerb(synthetic), 'make')
})

test('qwen3-vl-8b resolves to describe via its verbum override, not the cascade\'s chat default', () => {
  // Optional (not required) image input means rule 2 never fires, so the unmodified
  // cascade alone would fall through to the text rule's `chat` default (proven by the
  // override-precedence test below). The seed's `verbum: 'describe'` override
  // (noema-087) wins outright instead.
  assert.equal(resolveCanonVerb(ESSENTIA_QWEN3_VL), 'describe')
})

test('synthetic i2t modus (required image, no text at all, text output) resolves to enhance via the unmodified cascade', () => {
  // Media-only aditus (no text port at all) always wins the enhance bucket in the
  // cascade itself — this is still true by default (noema-087 does not touch the
  // cascade's rule order). Named seeds that match this exact shape and want a
  // different verb (e.g. `hunyuan3d-21`, `image-caption`) opt out via their own
  // `verbum` override instead — this synthetic fixture has none, so it still falls
  // through to the cascade and still resolves `enhance`.
  const synthetic: PortShaped = {
    aditus: {
      image: { type: 'image', required: true, description: 'Image to analyze' },
    },
    exitus: {
      text: { type: 'text', description: 'Caption' },
    },
  }
  assert.equal(resolveCanonVerb(synthetic), ENHANCE)
})

test('synthetic required image + text aditus, video output resolves to animate', () => {
  const synthetic: PortShaped = {
    aditus: {
      prompt: { type: 'text', required: true, description: 'Motion prompt' },
      image: { type: 'image', required: true, description: 'Start frame' },
    },
    exitus: {
      video: { type: 'video', description: 'Generated video' },
    },
  }
  assert.equal(resolveCanonVerb(synthetic), 'animate')
})

// =============================================================================
// verbum override (noema-087) — the 7 named flows the operator ruled must resolve
// to an explicit verb rather than whatever the 3-rule cascade would derive.
// =============================================================================

test('hunyuan3d-21 resolves to lift via its verbum override', () => {
  assert.equal(resolveCanonVerb(ESSENTIA_HUNYUAN3D), 'lift')
})

test('image-caption (compositus) resolves to describe via its verbum override', () => {
  assert.equal(resolveCanonVerb(COMPOSITUS_IMAGE_CAPTION), 'describe')
})

test('shotvl-7b resolves to describe via its verbum override', () => {
  assert.equal(resolveCanonVerb(ESSENTIA_SHOTVL), 'describe')
})

test('modus.layer-composite resolves to effect via its verbum override', () => {
  assert.equal(resolveCanonVerb(MODUS_LAYER_COMPOSITE), 'effect')
})

test('modus.frames-to-video resolves to animate via its verbum override', () => {
  assert.equal(resolveCanonVerb(MODUS_FRAMES_TO_VIDEO), 'animate')
})

test('modus.aitoolkit-training resolves to compose via its verbum override', () => {
  assert.equal(resolveCanonVerb(MODUS_AITOOLKIT_TRAINING), 'compose')
})

test('override precedence: a seed whose verbum is set wins over what the cascade would otherwise derive', () => {
  // Cascade-only, this shape (required text, image output) derives `make` — proven
  // by the `flux-schnell` fixture above. Setting `verbum` to an unrelated verb must
  // short-circuit the cascade entirely, not merely coincide with its output.
  const withoutOverride: PortShaped = {
    aditus: {
      prompt: { type: 'text', required: true, description: 'Prompt' },
    },
    exitus: {
      image: { type: 'image', description: 'Generated image' },
    },
  }
  assert.equal(resolveCanonVerb(withoutOverride), 'make')

  const withOverride: PortShaped = {
    ...withoutOverride,
    verbum: 'sculpt',
  }
  assert.equal(resolveCanonVerb(withOverride), 'sculpt')
})
