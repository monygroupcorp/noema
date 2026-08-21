// The decompose half of Muse: a captionset in, fragments on the dataset's media items. Pins the
// four things a decompose run depends on before any of it reaches a provider — fragments keyed by
// media id (never by position into an append-only array), a per-job cap enforced before the
// reservation, its own ministerium (so the hosted-API provider registrations survive), and a
// closed door when no chat provider is registered.
//
// Hermetic by construction: a fake store and a fake transport, no Mongo and no network. It
// therefore says nothing about what a real decompose does to a real dataset.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MuseDecomposeCursor,
  MUSE_DECOMPOSE_MINISTERIUM,
  DEFAULT_MAX_DECOMPOSE_CAPTIONS,
  DEFAULT_TOKENS_PER_CAPTION,
  type ChatProviderBinding,
} from '../../../src/crystal/MuseDecomposeCursor.js'
import { ApiCursor, httpApiTransport } from '../../../src/crystal/ApiCursor.js'
import {
  API_PROVIDERS,
  OPENAI_PROVIDER,
  OPENROUTER_PROVIDER,
  chatImpetus,
} from '../../../src/crystal/apiProviders.js'
import { SimpleCursorum } from '../../../src/crystal/SimpleCursorum.js'
import {
  MODUS_DATASET_DECOMPOSE,
  MODUS_CHATGPT,
  MODUS_DALLE_III,
  MODUS_OPENROUTER_CHAT,
  MODUS_VENICE_CHAT,
} from '../../../src/crystal/seeds/modi.js'
import type { Actum } from '../../../src/types/actum.js'
import type { Modus } from '../../../src/types/modus.js'
import type { Dataset, DatasetMediaItem } from '../../../src/types/dataset.js'
import type { Fragment } from '../../../src/crystal/muse/taxonomy.js'
import type { FetchLike } from '../../../src/crystal/muse/garden.js'

// ── fakes ────────────────────────────────────────────────────────────────────

const mediaItem = (id: string): DatasetMediaItem =>
  ({ id, url: `https://example.invalid/${id}.png`, source: 'upload', addedAt: new Date(0) })

/** A dataset with two media items and one captionset covering both, keyed by media id. */
function makeDataset(over: Partial<Dataset> = {}): Dataset {
  return {
    id: 'ds-1',
    owner: 'anima-1',
    name: 'sample-board',
    modality: 'image',
    custody: 'sealed',
    media: [mediaItem('m-first'), mediaItem('m-second')],
    captionsets: [{
      id: 'cs-1',
      name: 'pass one',
      method: 'sample',
      coverage: '2/2',
      captions: { 'm-first': 'a woman in a red coat', 'm-second': 'a cat on a wall' },
    }],
    versions: [],
    natum: new Date(0),
    mutatum: new Date(0),
    ...over,
  }
}

/** In-memory Datasets slice. Records every fragment write in call order. */
class FakeDatasets {
  writes: Array<{ mediaId: string; fragments: Fragment[] }> = []
  constructor(private dataset: Dataset | null) {}
  async find(id: string): Promise<Dataset | null> {
    return this.dataset && this.dataset.id === id ? this.dataset : null
  }
  async setFragments(datasetId: string, mediaId: string, fragments: Fragment[]): Promise<Dataset | null> {
    const d = await this.find(datasetId)
    if (!d) return null
    const item = d.media.find((m) => m.id === mediaId)
    if (!item) return null
    item.fragments = fragments
    this.writes.push({ mediaId, fragments })
    return d
  }
}

/** One caption → one fragment naming the caption, so a write can be traced back to its caption. */
type FakeChat = { calls: number; fetchImpl: FetchLike }
function fakeChat(tokensPerCall = 100): FakeChat {
  const chat: FakeChat = {
    calls: 0,
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => '' }),
  }
  chat.fetchImpl = async (_url, init) => {
    chat.calls++
    const sent = JSON.parse(init.body) as { messages: Array<{ role: string; content: string }> }
    const caption = (sent.messages[1]?.content ?? '').split('\n')[1] ?? ''
    const fragments = [{ category: 'subject', text: `subject of: ${caption}` }]
    const body = JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ fragments }) } }],
      usage: { total_tokens: tokensPerCall },
    })
    return { ok: true, status: 200, text: async () => body }
  }
  return chat
}

const binding = (): ChatProviderBinding => ({ provider: OPENROUTER_PROVIDER, apiKey: 'test-key' })

const actum = (aditus: Record<string, unknown>, impetus = 10_000n): Actum =>
  ({ id: 'act-decompose', aditus, impetus } as unknown as Actum)

const modus = (over: Partial<Modus> = {}): Modus => ({ ...MODUS_DATASET_DECOMPOSE, ...over }) as Modus

const aditus = { dataset: 'ds-1', captionset: 'cs-1' }

// ── media-id keying (non-vacuity 1) ──────────────────────────────────────────

test('fragments stay bound to their own media item after media is appended', async () => {
  const dataset = makeDataset()
  const store = new FakeDatasets(dataset)
  const chat = fakeChat()
  const cursor = new MuseDecomposeCursor({ datasets: store, providers: [binding()], fetchImpl: chat.fetchImpl })

  // Media is append-only: a third item arrives between captioning and decomposing. Positional
  // pairing (fragments[i] onto media[i]) survives this silently — every item still has fragments,
  // they are simply the wrong item's. Keying on the media id does not.
  dataset.media.unshift(mediaItem('m-added-later'))

  await cursor.run(actum(aditus))

  const first = dataset.media.find((m) => m.id === 'm-first')
  const second = dataset.media.find((m) => m.id === 'm-second')
  const added = dataset.media.find((m) => m.id === 'm-added-later')

  assert.ok(first?.fragments?.[0]?.text.includes('a woman in a red coat'))
  assert.ok(second?.fragments?.[0]?.text.includes('a cat on a wall'))
  assert.equal(added?.fragments, undefined, 'an item with no caption must not receive fragments')
  assert.deepEqual(store.writes.map((w) => w.mediaId).sort(), ['m-first', 'm-second'])
})

test('an archived media item is absent from the set a decompose reads', async () => {
  const dataset = makeDataset()
  dataset.media[0]!.archivum = new Date(1)
  const store = new FakeDatasets(dataset)
  const chat = fakeChat()
  const cursor = new MuseDecomposeCursor({ datasets: store, providers: [binding()], fetchImpl: chat.fetchImpl })

  await cursor.run(actum(aditus))

  // The archived item has left the working set, so its caption is not decomposed and nothing is
  // written back onto it. Its caption stays on the captionset — the map is keyed by media id and
  // a restore must find it there.
  assert.deepEqual(store.writes.map((w) => w.mediaId), ['m-second'])
  assert.equal(dataset.media[0]!.fragments, undefined)
  assert.equal(dataset.captionsets[0]!.captions?.['m-first'], 'a woman in a red coat')
  assert.equal(chat.calls, 1, 'and the archived item costs no provider call')
})

test('a caption whose media id does not resolve fails the job before any provider call', async () => {
  const dataset = makeDataset()
  dataset.captionsets[0]!.captions = { 'm-unknown': 'a caption for nothing' }
  const store = new FakeDatasets(dataset)
  const chat = fakeChat()
  const cursor = new MuseDecomposeCursor({ datasets: store, providers: [binding()], fetchImpl: chat.fetchImpl })

  await assert.rejects(
    () => cursor.run(actum(aditus)),
    /does not name a media item/,
  )
  assert.equal(chat.calls, 0, 'the refusal must land before the first provider call')
  assert.equal(store.writes.length, 0)
})

// ── the per-job cap (non-vacuity 2) ──────────────────────────────────────────

test('a captionset larger than the cap is refused before any provider call', async () => {
  const dataset = makeDataset()
  const media: DatasetMediaItem[] = []
  const captions: Record<string, string> = {}
  for (let i = 0; i < 5; i++) {
    media.push(mediaItem(`m-${i}`))
    captions[`m-${i}`] = `caption ${i}`
  }
  dataset.media = media
  dataset.captionsets[0]!.captions = captions

  const store = new FakeDatasets(dataset)
  const chat = fakeChat()
  const cursor = new MuseDecomposeCursor({
    datasets: store, providers: [binding()], fetchImpl: chat.fetchImpl, maxCaptions: 3,
  })

  // reserve() is where the cap bites, so an oversized job never reaches a reservation.
  await assert.rejects(() => cursor.reserve(modus(), aditus), /above the 3-caption per-job cap/)
  await assert.rejects(() => cursor.run(actum(aditus)), /above the 3-caption per-job cap/)
  assert.equal(chat.calls, 0)
  assert.equal(store.writes.length, 0)
})

test('reserve: a ceiling computed from the caption count, settled down to real usage by run', async () => {
  const store = new FakeDatasets(makeDataset())
  const chat = fakeChat(120)
  const cursor = new MuseDecomposeCursor({ datasets: store, providers: [binding()], fetchImpl: chat.fetchImpl })

  const reserved = await cursor.reserve(modus(), aditus)
  const perThousand = OPENROUTER_PROVIDER.pricing.chatImpetusPer1kTokens
  assert.equal(reserved, chatImpetus(2 * DEFAULT_TOKENS_PER_CAPTION, perThousand))
  assert.ok(reserved > 0n, 'a metered job must reserve something')

  const result = await cursor.run(actum(aditus, reserved))
  assert.equal(result.kind, 'sync')
  if (result.kind !== 'sync') return
  // Settled through the SAME shared helper the ApiCursor and the concierge charge by.
  assert.equal(result.exitus.impetus, chatImpetus(2 * 120, perThousand))
  assert.ok(result.exitus.impetus <= reserved, 'run().impetus must never exceed reserve()')
  assert.deepEqual(result.exitus.exitus, { decomposed: 2, fragments: 2 })
  assert.equal(chat.calls, 2, 'one chat call per caption')
})

test('the default cap is a real bound, and the reservation scales with the caption count', () => {
  assert.ok(DEFAULT_MAX_DECOMPOSE_CAPTIONS > 0)
  assert.ok(Number.isFinite(DEFAULT_MAX_DECOMPOSE_CAPTIONS))
  const perThousand = OPENROUTER_PROVIDER.pricing.chatImpetusPer1kTokens
  assert.ok(
    chatImpetus(2 * DEFAULT_TOKENS_PER_CAPTION, perThousand) >
    chatImpetus(1 * DEFAULT_TOKENS_PER_CAPTION, perThousand),
  )
})

// ── the ministerium (non-vacuity 3) ──────────────────────────────────────────

test('registering the decompose cursor leaves the ApiCursor registration intact', () => {
  // `Cursorum` is a flat Map<ministerium, Cursor> whose register is a bare set. A decompose
  // cursor registered under a provider id would replace that provider's ApiCursor, and every
  // chat, image and image-edit dispatch would land in the decomposer — with a green typecheck
  // and a green suite. This is the assertion that notices.
  const cursorum = new SimpleCursorum()
  for (const provider of API_PROVIDERS) {
    cursorum.register(provider.id, new ApiCursor(provider, { apiKey: 'k', http: httpApiTransport }))
  }
  cursorum.register(
    MUSE_DECOMPOSE_MINISTERIUM,
    new MuseDecomposeCursor({ datasets: new FakeDatasets(null), providers: [binding()] }),
  )

  for (const m of [MODUS_CHATGPT, MODUS_DALLE_III, MODUS_OPENROUTER_CHAT, MODUS_VENICE_CHAT]) {
    assert.ok(cursorum.resolve(m) instanceof ApiCursor, `${m.id} must still resolve to the ApiCursor`)
  }
  assert.ok(cursorum.resolve(MODUS_DATASET_DECOMPOSE) instanceof MuseDecomposeCursor)
  assert.equal(MODUS_DATASET_DECOMPOSE.ministerium, MUSE_DECOMPOSE_MINISTERIUM)
  for (const provider of API_PROVIDERS) {
    assert.notEqual(MUSE_DECOMPOSE_MINISTERIUM, provider.id)
  }
})

// ── fail closed (non-vacuity 4) ──────────────────────────────────────────────

test('no registered chat provider refuses the run with a named error rather than a 401 from the wire', async () => {
  const store = new FakeDatasets(makeDataset())
  const chat = fakeChat()
  const cursor = new MuseDecomposeCursor({ datasets: store, providers: [], fetchImpl: chat.fetchImpl })

  // reserve() refuses first, so nothing is ever locked for a run that cannot be served.
  await assert.rejects(() => cursor.reserve(modus(), aditus), /no chat-capable API provider/)
  await assert.rejects(() => cursor.run(actum(aditus)), /no chat-capable API provider/)
  assert.equal(chat.calls, 0)
  assert.equal(store.writes.length, 0)
})

test('a provider registered without a usable key is not a usable provider', async () => {
  const store = new FakeDatasets(makeDataset())
  const cursor = new MuseDecomposeCursor({
    datasets: store, providers: [{ provider: OPENROUTER_PROVIDER, apiKey: '' }],
  })
  await assert.rejects(() => cursor.reserve(modus(), aditus), /no chat-capable API provider/)
})

test('an explicitly named provider that is not registered is refused, not silently substituted', async () => {
  const store = new FakeDatasets(makeDataset())
  const cursor = new MuseDecomposeCursor({ datasets: store, providers: [binding()] })
  await assert.rejects(
    () => cursor.reserve(modus(), { ...aditus, provider: 'openai' }),
    /no chat provider 'openai' is registered/,
  )
})

test('with several providers registered the run goes to the named one', async () => {
  const dataset = makeDataset()
  const store = new FakeDatasets(dataset)
  const seen: string[] = []
  const fetchImpl: FetchLike = async (url) => {
    seen.push(url)
    const body = JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ fragments: [] }) } }],
      usage: { total_tokens: 10 },
    })
    return { ok: true, status: 200, text: async () => body }
  }
  const cursor = new MuseDecomposeCursor({
    datasets: store,
    providers: [{ provider: OPENAI_PROVIDER, apiKey: 'k1' }, { provider: OPENROUTER_PROVIDER, apiKey: 'k2' }],
    fetchImpl,
  })

  await cursor.run(actum({ ...aditus, provider: 'openai' }))
  assert.ok(seen.every((u) => u.startsWith(OPENAI_PROVIDER.baseUrl)), 'every call must hit the named provider')
})

// ── input resolution ─────────────────────────────────────────────────────────

test('an unknown dataset or captionset is refused by name, and nothing is written', async () => {
  const store = new FakeDatasets(makeDataset())
  const chat = fakeChat()
  const cursor = new MuseDecomposeCursor({ datasets: store, providers: [binding()], fetchImpl: chat.fetchImpl })

  await assert.rejects(() => cursor.run(actum({ dataset: 'ds-missing', captionset: 'cs-1' })), /does not exist/)
  await assert.rejects(() => cursor.run(actum({ dataset: 'ds-1', captionset: 'cs-missing' })), /is not on dataset/)
  await assert.rejects(() => cursor.run(actum({ captionset: 'cs-1' })), /`dataset` is required/)
  await assert.rejects(() => cursor.run(actum({ dataset: 'ds-1' })), /`captionset` is required/)
  assert.equal(chat.calls, 0)
  assert.equal(store.writes.length, 0)
})

test('an empty captionset is refused rather than settling a run that decomposed nothing', async () => {
  const dataset = makeDataset()
  dataset.captionsets[0]!.captions = { 'm-first': '   ' }
  const store = new FakeDatasets(dataset)
  const cursor = new MuseDecomposeCursor({ datasets: store, providers: [binding()], fetchImpl: fakeChat().fetchImpl })
  await assert.rejects(() => cursor.run(actum(aditus)), /carries no captions/)
})

test('out-of-taxonomy answers are dropped, so an item only ever carries renderable fragments', async () => {
  const dataset = makeDataset()
  dataset.captionsets[0]!.captions = { 'm-first': 'a woman in a red coat' }
  const store = new FakeDatasets(dataset)
  const fetchImpl: FetchLike = async () => {
    const body = JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ fragments: [
        { category: 'subject', text: 'a young woman' },
        { category: 'vibe', text: 'not a category anybody declared' },
        { category: 'subject', text: 'A YOUNG WOMAN' },
        { category: 'outfit', text: '   ' },
      ] }) } }],
      usage: { total_tokens: 90 },
    })
    return { ok: true, status: 200, text: async () => body }
  }
  const cursor = new MuseDecomposeCursor({ datasets: store, providers: [binding()], fetchImpl })

  const result = await cursor.run(actum(aditus))
  assert.equal(result.kind, 'sync')
  if (result.kind !== 'sync') return
  assert.deepEqual(result.exitus.exitus, { decomposed: 1, fragments: 1 })
  const written = dataset.media.find((m) => m.id === 'm-first')?.fragments ?? []
  assert.deepEqual(written.map((f) => [f.category, f.text]), [['subject', 'a young woman']])
  assert.equal(written[0]?.source, 'sample-board', 'a fragment keeps the source it was lifted from')
})

test('the trigger word reaches the decomposer so fragments come back unbranded', async () => {
  const dataset = makeDataset()
  dataset.captionsets[0]!.captions = { 'm-first': 'sampletrig, a woman in a red coat' }
  const store = new FakeDatasets(dataset)
  const systems: string[] = []
  const fetchImpl: FetchLike = async (_url, init) => {
    const sent = JSON.parse(init.body) as { messages: Array<{ content: string }> }
    systems.push(sent.messages[0]?.content ?? '')
    const body = JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ fragments: [{ category: 'subject', text: 'a woman' }] }) } }],
      usage: { total_tokens: 50 },
    })
    return { ok: true, status: 200, text: async () => body }
  }
  const cursor = new MuseDecomposeCursor({ datasets: store, providers: [binding()], fetchImpl })

  await cursor.run(actum({ ...aditus, trigger: 'sampletrig' }))
  assert.ok(systems[0]?.includes('sampletrig'), 'the trigger must reach the decomposition rules')
  assert.equal(dataset.media.find((m) => m.id === 'm-first')?.fragments?.[0]?.trigger, 'sampletrig')
})

test('a provider error fails the run instead of writing a partial item', async () => {
  const store = new FakeDatasets(makeDataset())
  const fetchImpl: FetchLike = async () => ({ ok: false, status: 502, text: async () => 'upstream said no' })
  const cursor = new MuseDecomposeCursor({ datasets: store, providers: [binding()], fetchImpl })
  await assert.rejects(() => cursor.run(actum(aditus)), /chat completion failed \(502\)/)
  assert.equal(store.writes.length, 0)
})
