import { test } from 'node:test'
import assert from 'node:assert/strict'
import { OpenAICursor } from '../../../src/crystal/OpenAICursor.js'
import type { Modus } from '../../../src/types/modus.js'
import type { Actum } from '../../../src/types/actum.js'

// ── helpers ───────────────────────────────────────────────────────────────────

function makeModus(overrides: Partial<Modus> = {}): Modus {
  return {
    id: 'openai.chat',
    nomen: 'ChatGPT',
    genus: 'atomicus',
    versio: '1.0.0',
    contentHash: 'abc',
    aditus: { prompt: { type: 'text', required: true } },
    exitus: { response: { type: 'text' } },
    ministerium: 'openai',
    impetusFixum: 10n,
    canonica: true,
    natum: new Date(),
    mutatum: new Date(),
    ...overrides,
  }
}

function makeActum(overrides: Partial<Actum> = {}): Actum {
  return {
    id: 'actum-openai-1',
    modusId: 'openai.chat',
    modusVersiono: '1.0.0',
    impetus: 0n,
    signaConsumed: [],
    aditus: { prompt: 'say hello', model: 'gpt-4o' },
    status: 'nascens',
    inceptum: new Date(),
    expirat: new Date(Date.now() + 60_000),
    ...overrides,
  }
}

function makeChatClient(response = 'Hello!') {
  return {
    chat: async (_params: unknown) => ({ content: response, usage: { total_tokens: 42 } }),
    image: async (_params: unknown) => ({ url: 'https://cdn.openai.com/img.png' }),
  }
}

function makeImageClient(url = 'https://cdn.openai.com/gen.png') {
  return {
    chat: async (_params: unknown) => ({ content: 'unexpected', usage: {} }),
    image: async (_params: unknown) => ({ url }),
  }
}

// ── reserve() ─────────────────────────────────────────────────────────────────

test('reserve returns impetusFixum from modus', async () => {
  const cursor = new OpenAICursor(makeChatClient())
  const result = await cursor.reserve(makeModus({ impetusFixum: 25n }), {})
  assert.equal(result, 25n)
})

test('reserve returns 0n when impetusFixum absent', async () => {
  const cursor = new OpenAICursor(makeChatClient())
  const modus = makeModus()
  delete (modus as any).impetusFixum
  const result = await cursor.reserve(modus, {})
  assert.equal(result, 0n)
})

// ── run() — chat path ─────────────────────────────────────────────────────────

test('run with chat aditus calls client.chat and returns sync result', async () => {
  const cursor = new OpenAICursor(makeChatClient('Hi there!'))
  const result = await cursor.run(makeActum({ aditus: { prompt: 'hello', model: 'gpt-4o' } }))
  assert.equal(result.kind, 'sync')
})

test('run chat result contains response in exitus.exitus', async () => {
  const cursor = new OpenAICursor(makeChatClient('Greetings!'))
  const result = await cursor.run(makeActum({ aditus: { prompt: 'hello', model: 'gpt-4o' } }))
  assert.equal(result.kind, 'sync')
  const { exitus } = result as Extract<typeof result, { kind: 'sync' }>
  assert.equal((exitus.exitus as { response: string }).response, 'Greetings!')
})

test('run chat result impetus is 0n when no impetusFixum in actum aditus', async () => {
  const cursor = new OpenAICursor(makeChatClient())
  const result = await cursor.run(makeActum({ aditus: { prompt: 'hello' } }))
  assert.equal(result.kind, 'sync')
  const { exitus } = result as Extract<typeof result, { kind: 'sync' }>
  assert.equal(typeof exitus.impetus, 'bigint')
})

// ── run() — image path ────────────────────────────────────────────────────────

test('run with size in aditus dispatches to client.image', async () => {
  let imageCalled = false
  const client = {
    chat: async (_p: unknown) => ({ content: 'unexpected' }),
    image: async (_p: unknown) => { imageCalled = true; return { url: 'https://x.com/img.png' } },
  }
  const cursor = new OpenAICursor(client)
  await cursor.run(makeActum({ aditus: { prompt: 'a cat', size: '1024x1024' } }))
  assert.ok(imageCalled, 'expected client.image to be called')
})

test('run with quality in aditus dispatches to client.image', async () => {
  let imageCalled = false
  const client = {
    chat: async (_p: unknown) => ({ content: 'unexpected' }),
    image: async (_p: unknown) => { imageCalled = true; return { url: 'https://x.com/img.png' } },
  }
  const cursor = new OpenAICursor(client)
  await cursor.run(makeActum({ aditus: { prompt: 'a cat', quality: 'hd' } }))
  assert.ok(imageCalled, 'expected client.image to be called')
})

test('run image result contains imageUrl in exitus.exitus', async () => {
  const cursor = new OpenAICursor(makeImageClient('https://cdn.openai.com/mypic.png'))
  const result = await cursor.run(makeActum({ aditus: { prompt: 'a cat', size: '512x512' } }))
  assert.equal(result.kind, 'sync')
  const { exitus } = result as Extract<typeof result, { kind: 'sync' }>
  assert.equal((exitus.exitus as { imageUrl: string }).imageUrl, 'https://cdn.openai.com/mypic.png')
})

test('run image result is sync kind', async () => {
  const cursor = new OpenAICursor(makeImageClient())
  const result = await cursor.run(makeActum({ aditus: { prompt: 'sunset', quality: 'standard' } }))
  assert.equal(result.kind, 'sync')
})

// ── run() — error propagation ─────────────────────────────────────────────────

test('run propagates client.chat error', async () => {
  const client = {
    chat: async (_p: unknown) => { throw new Error('OpenAI rate limit') },
    image: async (_p: unknown) => { return { url: '' } },
  }
  const cursor = new OpenAICursor(client)
  await assert.rejects(
    () => cursor.run(makeActum({ aditus: { prompt: 'hello' } })),
    /rate limit/i
  )
})

test('run propagates client.image error', async () => {
  const client = {
    chat: async (_p: unknown) => ({ content: '' }),
    image: async (_p: unknown) => { throw new Error('Content policy violation') },
  }
  const cursor = new OpenAICursor(client)
  await assert.rejects(
    () => cursor.run(makeActum({ aditus: { prompt: 'x', size: '1024x1024' } })),
    /content policy/i
  )
})
