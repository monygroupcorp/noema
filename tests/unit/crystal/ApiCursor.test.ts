import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ApiCursor, type ApiHttp } from '../../../src/crystal/ApiCursor.js'
import { OPENAI_PROVIDER, OPENROUTER_PROVIDER, type ApiProvider } from '../../../src/crystal/apiProviders.js'
import type { MediaFetcher } from '../../../src/crystal/MediaFetcher.js'
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

function makeActum(aditus: Record<string, unknown>, reserved = 100n): Actum {
  return {
    id: 'actum-1',
    modusId: 'openai.chat',
    modusVersiono: '1.0.0',
    impetus: reserved,          // the reservation ActumInceptor locked
    signaConsumed: [],
    aditus,
    status: 'nascens',
    inceptum: new Date(),
    expirat: new Date(Date.now() + 60_000),
  }
}

/** A fake transport that records the last request and returns canned JSON. */
function fakeHttp(response: unknown): ApiHttp & { lastJson?: { url: string; body: unknown }; lastForm?: { url: string; form: FormData } } {
  const rec: any = {
    async postJson(url: string, _key: string, body: unknown) { rec.lastJson = { url, body }; return response },
    async postForm(url: string, _key: string, form: FormData) { rec.lastForm = { url, form }; return response },
  }
  return rec
}

const fakeFetcher: MediaFetcher = { async fetch(url) { return Buffer.from(`bytes:${url}`) } }

function cursor(provider: ApiProvider, http: ApiHttp) {
  return new ApiCursor(provider, { apiKey: 'sk-test', http, mediaFetcher: fakeFetcher })
}

const CHAT_RES = { choices: [{ message: { content: 'Hello!' } }], usage: { total_tokens: 500 } }
const IMAGE_RES = { data: [{ url: 'https://cdn.openai.com/gen.png' }] }

// ── reserve() ─────────────────────────────────────────────────────────────────

test('reserve returns impetusFixum from modus', async () => {
  const c = cursor(OPENAI_PROVIDER, fakeHttp(CHAT_RES))
  assert.equal(await c.reserve(makeModus({ impetusFixum: 25n }), {}), 25n)
})

test('reserve returns 0n when impetusFixum absent', async () => {
  const c = cursor(OPENAI_PROVIDER, fakeHttp(CHAT_RES))
  const modus = makeModus()
  delete (modus as any).impetusFixum
  assert.equal(await c.reserve(modus, {}), 0n)
})

// ── capability dispatch ─────────────────────────────────────────────────────────

test('__capability chat hits the chat path and maps content → response', async () => {
  const http = fakeHttp(CHAT_RES)
  const c = cursor(OPENAI_PROVIDER, http)
  const res = await c.run(makeActum({ prompt: 'hi', __capability: 'chat' }))
  assert.equal(res.kind, 'sync')
  const { exitus } = res as Extract<typeof res, { kind: 'sync' }>
  assert.equal((exitus.exitus as { response: string }).response, 'Hello!')
  assert.equal(http.lastJson?.url, 'https://api.openai.com/v1/chat/completions')
})

test('absent __capability defaults to chat', async () => {
  const http = fakeHttp(CHAT_RES)
  const c = cursor(OPENAI_PROVIDER, http)
  await c.run(makeActum({ prompt: 'hi' }))
  assert.equal(http.lastJson?.url, 'https://api.openai.com/v1/chat/completions')
})

test('__capability image hits the image path and maps data[0].url → image', async () => {
  const http = fakeHttp(IMAGE_RES)
  const c = cursor(OPENAI_PROVIDER, http)
  const res = await c.run(makeActum({ prompt: 'a cat', __capability: 'image' }))
  const { exitus } = res as Extract<typeof res, { kind: 'sync' }>
  assert.equal((exitus.exitus as { image: string }).image, 'https://cdn.openai.com/gen.png')
  assert.equal(http.lastJson?.url, 'https://api.openai.com/v1/images/generations')
})

test('image b64_json response becomes a data URI', async () => {
  const http = fakeHttp({ data: [{ b64_json: 'QUJD' }] })
  const c = cursor(OPENAI_PROVIDER, http)
  const res = await c.run(makeActum({ prompt: 'a cat', __capability: 'image' }))
  const { exitus } = res as Extract<typeof res, { kind: 'sync' }>
  assert.equal((exitus.exitus as { image: string }).image, 'data:image/png;base64,QUJD')
})

test('__capability imageEdit posts multipart form and maps to image', async () => {
  const http = fakeHttp(IMAGE_RES)
  const c = cursor(OPENAI_PROVIDER, http)
  const res = await c.run(makeActum({ image: 'https://x/in.png', prompt: 'add a hat', __capability: 'imageEdit' }))
  const { exitus } = res as Extract<typeof res, { kind: 'sync' }>
  assert.equal((exitus.exitus as { image: string }).image, 'https://cdn.openai.com/gen.png')
  assert.equal(http.lastForm?.url, 'https://api.openai.com/v1/images/edits')
  assert.ok(http.lastForm?.form.has('image'), 'form carries the downloaded image')
  assert.equal(http.lastForm?.form.get('prompt'), 'add a hat')
})

test('imageEdit without an input image throws', async () => {
  const c = cursor(OPENAI_PROVIDER, fakeHttp(IMAGE_RES))
  await assert.rejects(() => c.run(makeActum({ prompt: 'edit', __capability: 'imageEdit' })), /requires an input/i)
})

// ── unsupported capability / provider ───────────────────────────────────────────

test('provider that does not serve a capability throws', async () => {
  // OpenRouter has no image capability.
  const c = cursor(OPENROUTER_PROVIDER, fakeHttp(IMAGE_RES))
  await assert.rejects(() => c.run(makeActum({ prompt: 'a cat', __capability: 'image' })), /does not serve capability/i)
})

// ── OpenRouter via descriptor — zero new cursor code ────────────────────────────

test('OpenRouter chat runs through the same cursor at its own baseUrl', async () => {
  const http = fakeHttp(CHAT_RES)
  const c = cursor(OPENROUTER_PROVIDER, http)
  const res = await c.run(makeActum({ prompt: 'hi', __capability: 'chat' }))
  const { exitus } = res as Extract<typeof res, { kind: 'sync' }>
  assert.equal((exitus.exitus as { response: string }).response, 'Hello!')
  assert.equal(http.lastJson?.url, 'https://openrouter.ai/api/v1/chat/completions')
})

// ── metering + reserve clamp ────────────────────────────────────────────────────

test('chat impetus is metered from usage.total_tokens (ceil per 1k)', async () => {
  // 500 tokens × 3 / 1000 = 1.5 → ceil = 2
  const c = cursor(OPENAI_PROVIDER, fakeHttp(CHAT_RES))
  const res = await c.run(makeActum({ prompt: 'hi', __capability: 'chat' }, 100n))
  const { exitus } = res as Extract<typeof res, { kind: 'sync' }>
  assert.equal(exitus.impetus, 2n)
})

test('chat impetus is clamped to the reservation', async () => {
  // 500 tokens meters to 2n, but reservation is only 1n → clamp to 1n.
  const c = cursor(OPENAI_PROVIDER, fakeHttp(CHAT_RES))
  const res = await c.run(makeActum({ prompt: 'hi', __capability: 'chat' }, 1n))
  const { exitus } = res as Extract<typeof res, { kind: 'sync' }>
  assert.equal(exitus.impetus, 1n)
})

test('image impetus is one image, clamped to reservation', async () => {
  // OpenAI imageImpetusPerImage = 40n; the rail charges one image → 40n; reservation 25n → clamp to 25n.
  const c = cursor(OPENAI_PROVIDER, fakeHttp(IMAGE_RES))
  const res = await c.run(makeActum({ prompt: 'a cat', __capability: 'image' }, 25n))
  const { exitus } = res as Extract<typeof res, { kind: 'sync' }>
  assert.equal(exitus.impetus, 25n)
})

// ── generation rail reads only declared ports (noema-317) ───────────────────────

test('image generation pins n to 1 — an undeclared n neither reaches the provider nor the meter', async () => {
  // imageImpetusPerImage = 40n. Undeclared `n: 3` must not become 3 provider images, and must
  // not become 120n of metering; the rail requests one image and charges one image.
  const http = fakeHttp(IMAGE_RES)
  const c = cursor(OPENAI_PROVIDER, http)
  const res = await c.run(makeActum({ prompt: 'a cat', n: 3, __capability: 'image' }, 100n))
  assert.equal((http.lastJson?.body as { n: number }).n, 1)
  const { exitus } = res as Extract<typeof res, { kind: 'sync' }>
  assert.equal(exitus.impetus, 40n)
})

test('image generation pins the model to the capability default — an undeclared model is not sent', async () => {
  const http = fakeHttp(IMAGE_RES)
  const c = cursor(OPENAI_PROVIDER, http)
  await c.run(makeActum({ prompt: 'a cat', model: 'some-other-model', __capability: 'image' }))
  assert.equal(
    (http.lastJson?.body as { model: string }).model,
    OPENAI_PROVIDER.capabilities.image!.defaultModel,
  )
})

test('imageEdit still honours its declared model port', async () => {
  const http = fakeHttp(IMAGE_RES)
  const c = cursor(OPENAI_PROVIDER, http)
  await c.run(makeActum({ image: 'https://x/in.png', prompt: 'add a hat', model: 'edit-model', __capability: 'imageEdit' }))
  assert.equal(http.lastForm?.form.get('model'), 'edit-model')
})

test('run is always sync kind and never exceeds reserve', async () => {
  const c = cursor(OPENAI_PROVIDER, fakeHttp(IMAGE_RES))
  const res = await c.run(makeActum({ prompt: 'a cat', __capability: 'image' }, 40n))
  assert.equal(res.kind, 'sync')
  const { exitus } = res as Extract<typeof res, { kind: 'sync' }>
  assert.ok(exitus.impetus <= 40n)
})

// ── error propagation ───────────────────────────────────────────────────────────

test('run propagates transport errors', async () => {
  const http: ApiHttp = {
    async postJson() { throw new Error('OpenAI rate limit') },
    async postForm() { throw new Error('unused') },
  }
  const c = cursor(OPENAI_PROVIDER, http)
  await assert.rejects(() => c.run(makeActum({ prompt: 'hi', __capability: 'chat' })), /rate limit/i)
})
