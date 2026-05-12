import { test } from 'node:test'
import assert from 'node:assert/strict'
import { HuggingFaceCursor } from '../../../src/crystal/HuggingFaceCursor.js'
import type { Modus } from '../../../src/types/modus.js'
import type { Actum } from '../../../src/types/actum.js'

// ── helpers ───────────────────────────────────────────────────────────────────

function makeModus(overrides: Partial<Modus> = {}): Modus {
  return {
    id: 'hf.joycaption',
    nomen: 'JoyCaption',
    genus: 'atomicus',
    versio: '1.0.0',
    contentHash: 'abc',
    aditus: { imageUrl: { type: 'image', required: true } },
    exitus: { description: { type: 'text' } },
    ministerium: 'huggingface',
    impetusFixum: 5n,
    canonica: true,
    natum: new Date(),
    mutatum: new Date(),
    ...overrides,
  }
}

function makeActum(overrides: Partial<Actum> = {}): Actum {
  return {
    id: 'actum-hf-1',
    modusId: 'hf.joycaption',
    modusVersiono: '1.0.0',
    impetus: 0n,
    signaConsumed: [],
    aditus: {
      imageUrl: 'https://cdn.example.com/photo.jpg',
      captionType: 'descriptive',
      __spaceUrl: 'https://huggingface.co/spaces/fancyfeast/joy-caption',
    },
    status: 'nascens',
    inceptum: new Date(),
    expirat: new Date(Date.now() + 60_000),
    ...overrides,
  }
}

function makeClient(response: Record<string, unknown> = { description: 'A cat sitting on a mat.' }) {
  return {
    predict: async (_spaceUrl: string, _params: Record<string, unknown>) => response,
  }
}

// ── reserve() ─────────────────────────────────────────────────────────────────

test('reserve returns impetusFixum from modus', async () => {
  const cursor = new HuggingFaceCursor(makeClient())
  const result = await cursor.reserve(makeModus({ impetusFixum: 7n }), {})
  assert.equal(result, 7n)
})

test('reserve returns 0n when impetusFixum absent', async () => {
  const cursor = new HuggingFaceCursor(makeClient())
  const modus = makeModus()
  delete (modus as any).impetusFixum
  const result = await cursor.reserve(modus, {})
  assert.equal(result, 0n)
})

// ── run() ─────────────────────────────────────────────────────────────────────

test('run returns sync kind', async () => {
  const cursor = new HuggingFaceCursor(makeClient())
  const result = await cursor.run(makeActum())
  assert.equal(result.kind, 'sync')
})

test('run passes __spaceUrl from aditus to client.predict', async () => {
  let capturedUrl: string | undefined
  const client = {
    predict: async (spaceUrl: string, _params: Record<string, unknown>) => {
      capturedUrl = spaceUrl
      return { description: 'x' }
    },
  }
  const cursor = new HuggingFaceCursor(client)
  await cursor.run(makeActum())
  assert.equal(capturedUrl, 'https://huggingface.co/spaces/fancyfeast/joy-caption')
})

test('run passes aditus fields (excluding __spaceUrl) to client.predict', async () => {
  let capturedParams: Record<string, unknown> | undefined
  const client = {
    predict: async (_url: string, params: Record<string, unknown>) => {
      capturedParams = params
      return { description: 'result' }
    },
  }
  const cursor = new HuggingFaceCursor(client)
  await cursor.run(makeActum({
    aditus: {
      imageUrl: 'https://example.com/img.jpg',
      captionType: 'descriptive',
      __spaceUrl: 'https://hf.co/spaces/test',
    },
  }))
  assert.ok(capturedParams)
  assert.equal(capturedParams.__spaceUrl, undefined, '__spaceUrl should be excluded from params')
  assert.equal(capturedParams.imageUrl, 'https://example.com/img.jpg')
  assert.equal(capturedParams.captionType, 'descriptive')
})

test('run result exitus contains description from client response', async () => {
  const cursor = new HuggingFaceCursor(makeClient({ description: 'A fluffy orange cat.' }))
  const result = await cursor.run(makeActum())
  assert.equal(result.kind, 'sync')
  const { exitus } = result as Extract<typeof result, { kind: 'sync' }>
  assert.equal((exitus.exitus as { description: string }).description, 'A fluffy orange cat.')
})

test('run result impetus is 0n', async () => {
  const cursor = new HuggingFaceCursor(makeClient())
  const result = await cursor.run(makeActum())
  assert.equal(result.kind, 'sync')
  const { exitus } = result as Extract<typeof result, { kind: 'sync' }>
  assert.equal(exitus.impetus, 0n)
})

test('run propagates client error', async () => {
  const client = {
    predict: async (_url: string, _params: Record<string, unknown>): Promise<Record<string, unknown>> => {
      throw new Error('Space unavailable')
    },
  }
  const cursor = new HuggingFaceCursor(client)
  await assert.rejects(
    () => cursor.run(makeActum()),
    /space unavailable/i
  )
})

test('run throws when __spaceUrl is missing from aditus', async () => {
  const cursor = new HuggingFaceCursor(makeClient())
  const actum = makeActum({ aditus: { imageUrl: 'https://example.com/img.jpg' } })
  await assert.rejects(
    () => cursor.run(actum),
    /__spaceUrl/i
  )
})
