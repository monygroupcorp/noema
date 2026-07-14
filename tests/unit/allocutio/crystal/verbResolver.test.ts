import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveCanonVerb, ENHANCE, type PortShaped } from '../../../../src/crystal/verbResolver.js'
import {
  ESSENTIA_RUNMAKE_FLUX_SCHNELL,
  ESSENTIA_FLUXI2I,
  ESSENTIA_RMBG,
  ESSENTIA_UPSCALE,
  ESSENTIA_QWEN3_VL,
} from '../../../../src/crystal/seeds/essentiae.js'

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

test('qwen3-vl (required text, optional image, text output) resolves to chat — non-image-output case', () => {
  assert.equal(resolveCanonVerb(ESSENTIA_QWEN3_VL), 'chat')
})

test('synthetic i2t modus (required image, no text at all, text output) resolves to enhance, not describe', () => {
  // Media-only aditus (no text port at all) always wins the enhance bucket, even
  // when the output modality would otherwise map to a non-image verb (describe).
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
