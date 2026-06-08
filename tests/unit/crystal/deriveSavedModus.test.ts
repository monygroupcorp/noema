import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deriveSavedModus } from '../../../src/crystal/deriveSavedModus.js'
import { hashModus } from '../../../src/crystal/hashModus.js'
import type { Modus } from '../../../src/types/modus.js'

function base(overrides: Partial<Modus> = {}): Modus {
  return {
    id: 'sd1-5',
    nomen: 'Stable Diffusion 1.5',
    genus: 'atomicus',
    versio: '2.3.0',
    contentHash: 'BASEHASH',
    ministerium: 'runpod',
    canonica: true,
    intellae: [{ id: 'intella.sd15-v1-5', role: 'checkpoint' }],
    aditus: {
      prompt: { type: 'text', required: true, description: 'Prompt' },
      steps:  { type: 'int', required: false, default: 20 },
      width:  { type: 'int', required: false, default: 512 },
    },
    exitus: { image: { type: 'image' } },
    natum: new Date('2025-01-01'),
    mutatum: new Date('2025-01-01'),
    ...overrides,
  }
}

const owner = { animaId: 'anima-99' }

test('derived modus: canonica false, auctor set, fonte = base.id, fresh slug/nomen', () => {
  const d = deriveSavedModus(base(), {
    slug: 'my-doodoo', name: 'My DooDoo', owner,
    aditus: { steps: 8 }, promptMode: 'open',
  })
  assert.equal(d.canonica, false)
  assert.deepEqual(d.auctor, owner)
  assert.equal(d.fonte, 'sd1-5')
  assert.equal(d.id, 'my-doodoo')
  assert.equal(d.nomen, 'My DooDoo')
  assert.equal(d.versio, '1.0.0')
})

test('derived modus: intellae = base + pinned LoRAs as { id, role: lora }', () => {
  const d = deriveSavedModus(base(), {
    slug: 'with-loras', name: 'With LoRAs', owner,
    aditus: {}, promptMode: 'open',
    pinned: [{ id: 'intella.lora-a' }, { id: 'intella.lora-b' }],
  })
  assert.deepEqual(d.intellae, [
    { id: 'intella.sd15-v1-5', role: 'checkpoint' },
    { id: 'intella.lora-a', role: 'lora' },
    { id: 'intella.lora-b', role: 'lora' },
  ])
})

test('config values become Porta defaults', () => {
  const d = deriveSavedModus(base(), {
    slug: 'cfg', name: 'Cfg', owner,
    aditus: { steps: 8, width: 768 }, promptMode: 'open',
  })
  assert.equal(d.aditus.steps.default, 8)
  assert.equal(d.aditus.width.default, 768)
  // Untouched porta keeps its base default.
  assert.equal(d.aditus.steps.type, 'int')
})

test('pinned prompt → prompt Porta gets a default', () => {
  const d = deriveSavedModus(base(), {
    slug: 'pinned', name: 'Pinned', owner,
    aditus: { prompt: 'a red fox', steps: 8 }, promptMode: 'pinned',
  })
  assert.equal(d.aditus.prompt.default, 'a red fox')
  assert.equal(d.aditus.steps.default, 8)
})

test('open prompt → prompt Porta has NO default (stays a fresh required input)', () => {
  const d = deriveSavedModus(base(), {
    slug: 'open', name: 'Open', owner,
    aditus: { prompt: 'a red fox', steps: 8 }, promptMode: 'open',
  })
  assert.equal(d.aditus.prompt.default, undefined)
  assert.equal(d.aditus.prompt.required, true)
  // Non-prompt config still bakes in even in open mode.
  assert.equal(d.aditus.steps.default, 8)
})

test('contentHash equals hashModus(result) and differs from the base', () => {
  const d = deriveSavedModus(base(), {
    slug: 'hashed', name: 'Hashed', owner,
    aditus: { steps: 8 }, promptMode: 'pinned',
  })
  const expected = hashModus({ ...d, contentHash: '' })
  assert.equal(d.contentHash, expected)
  assert.notEqual(d.contentHash, 'BASEHASH')
})

test('builder does not mutate the base modus', () => {
  const b = base()
  const before = JSON.stringify(b)
  deriveSavedModus(b, { slug: 's', name: 'S', owner, aditus: { steps: 8 }, promptMode: 'pinned', pinned: [{ id: 'x' }] })
  assert.equal(JSON.stringify(b), before)
})

test('subtype fields (e.g. categoria/runpodSpec) copy through wholesale', () => {
  const b = base({ ...({ categoria: 'image', runpodSpec: { workflowTemplate: 'sd15' } } as Partial<Modus>) })
  const d = deriveSavedModus(b, { slug: 's2', name: 'S2', owner, aditus: {}, promptMode: 'open' })
  assert.equal((d as unknown as { categoria?: string }).categoria, 'image')
  assert.deepEqual((d as unknown as { runpodSpec?: unknown }).runpodSpec, { workflowTemplate: 'sd15' })
})
