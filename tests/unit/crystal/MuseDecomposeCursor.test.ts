// The decompose half of Muse: a captionset in, fragments on the dataset's media items. Pins the
// six things a decompose run depends on — fragments keyed by media id (never by position into an
// append-only array), a per-job cap enforced before the reservation, its own ministerium (so the
// hosted-API provider registrations survive), a closed door when no chat provider is registered,
// one decompose at a time per dataset (refused before the reservation is locked), a deadline
// on every chat call so a run that stops getting answers fails instead of holding its
// reservation until the actum expires, and — since noema-278 — an incremental pass: items that
// already carry fragments are not sent to the model again, a pass with nothing left to do is
// refused before a signum is locked, and `redo` is the explicit way to rebuild the whole set.
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
  DEFAULT_CHAT_CALL_TIMEOUT_MS,
  DecomposeInFlightError,
  DecomposeNothingToDoError,
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

// ── single flight, and where the refusal lands (non-vacuity 5) ────────────────
//
// A decompose holds its reservation for the whole run, so a second one started on top of a
// running one locks a SECOND reservation against the same work. Both properties are asserted
// here: that the second is refused at all, and that it is refused from `reserve()` — the call
// ActumInceptor makes BEFORE it locks anything. A guard that let `reserve()` through and
// refused inside `run()` would leave the second reservation locked until the reaper.

/** A transport held open on demand, so a run can be parked mid-flight and released later. */
function heldChat(): { fetchImpl: FetchLike; started: Promise<void>; release: () => void; calls: number } {
  const chat = fakeChat()
  let release!: () => void
  let announceStart!: () => void
  const held = new Promise<void>((r) => { release = r })
  const started = new Promise<void>((r) => { announceStart = r })
  const inner = chat.fetchImpl
  return {
    get calls() { return chat.calls },
    started,
    release,
    fetchImpl: async (url, init) => {
      announceStart()
      await held
      return inner(url, init)
    },
  }
}

test('a second decompose for a dataset already decomposing is refused', async () => {
  const store = new FakeDatasets(makeDataset())
  const held = heldChat()
  const cursor = new MuseDecomposeCursor({ datasets: store, providers: [binding()], fetchImpl: held.fetchImpl })

  const first = cursor.run(actum(aditus))
  await held.started

  await assert.rejects(
    () => cursor.reserve(modus(), aditus),
    (err: Error) => err instanceof DecomposeInFlightError && /already running on dataset 'ds-1'/.test(err.message),
  )

  held.release()
  await first
})

test('the refusal happens BEFORE any reservation is locked', async () => {
  // ActumInceptor calls reserve() first and locks signa against its answer; a refusal that
  // only reached run() would already be holding the second reservation it was meant to prevent.
  const store = new FakeDatasets(makeDataset())
  const held = heldChat()
  const cursor = new MuseDecomposeCursor({ datasets: store, providers: [binding()], fetchImpl: held.fetchImpl })

  const first = cursor.run(actum(aditus))
  await held.started
  await assert.rejects(() => cursor.reserve(modus(), aditus), DecomposeInFlightError)

  held.release()
  await first
})

test('a decompose on a DIFFERENT dataset is not caught by the guard', async () => {
  const store = new FakeDatasets(makeDataset())
  const held = heldChat()
  const cursor = new MuseDecomposeCursor({ datasets: store, providers: [binding()], fetchImpl: held.fetchImpl })

  const first = cursor.run(actum(aditus))
  await held.started
  // Unknown, but refused for NOT EXISTING — not for a decompose that is running elsewhere.
  await assert.rejects(
    () => cursor.reserve(modus(), { dataset: 'ds-other', captionset: 'cs-1' }),
    /dataset 'ds-other' does not exist/,
  )

  held.release()
  await first
})

test('a finished decompose frees its dataset for the next one', async () => {
  const store = new FakeDatasets(makeDataset())
  const chat = fakeChat()
  const cursor = new MuseDecomposeCursor({ datasets: store, providers: [binding()], fetchImpl: chat.fetchImpl })

  await cursor.run(actum(aditus))
  // The run is over, so its claim is gone. Asked with `redo` because the pass it just finished
  // left nothing else to do — the claim is what is under test here, not the workload.
  assert.ok(
    await cursor.reserve(modus(), { ...aditus, redo: true }) > 0n,
    'the claim must not outlive the run that took it',
  )
})

// ── the per-call deadline (non-vacuity 6) ────────────────────────────────────
//
// One chat call per caption, and no deadline on any of them: a provider call that never
// answers parks the whole run until the actum's expiry, holding the reservation for the
// entire expiry window. The deadline is what makes a stuck call a failure of the run.

test('a chat call that never answers fails the decompose instead of running until the actum expires', async () => {
  const store = new FakeDatasets(makeDataset())
  const silent: FetchLike = () => new Promise(() => {})   // answers never
  const cursor = new MuseDecomposeCursor({
    datasets: store, providers: [binding()], fetchImpl: silent, chatCallTimeoutMs: 20,
  })

  await assert.rejects(
    () => cursor.run(actum(aditus)),
    /the chat call for media item 'm-first' did not answer within/,
  )
  assert.equal(store.writes.length, 0, 'a run that never got an answer writes nothing')
})

test('the deadline aborts the call it gave up on', async () => {
  const store = new FakeDatasets(makeDataset())
  let seen: AbortSignal | undefined
  const silent: FetchLike = (_url, init) => { seen = init.signal; return new Promise(() => {}) }
  const cursor = new MuseDecomposeCursor({
    datasets: store, providers: [binding()], fetchImpl: silent, chatCallTimeoutMs: 20,
  })

  await assert.rejects(() => cursor.run(actum(aditus)), /did not answer within/)
  assert.ok(seen, 'the transport must be handed a signal to cancel with')
  assert.equal(seen?.aborted, true, 'a call the run gave up on must not be left open')
})

test('a timed-out decompose releases its dataset rather than leaving it claimed for the reaper', async () => {
  const store = new FakeDatasets(makeDataset())
  const silent: FetchLike = () => new Promise(() => {})
  const cursor = new MuseDecomposeCursor({
    datasets: store, providers: [binding()], fetchImpl: silent, chatCallTimeoutMs: 20,
  })

  await assert.rejects(() => cursor.run(actum(aditus)), /did not answer within/)
  // The dataset is free the moment the run ends — not fifteen minutes later, when the
  // expiry reaper would have been the one to notice.
  assert.ok(await cursor.reserve(modus(), aditus) > 0n)
})

test('a healthy call is not cut off by the deadline', async () => {
  const store = new FakeDatasets(makeDataset())
  const chat = fakeChat()
  const cursor = new MuseDecomposeCursor({
    datasets: store, providers: [binding()], fetchImpl: chat.fetchImpl, chatCallTimeoutMs: 5_000,
  })
  const result = await cursor.run(actum(aditus))
  assert.equal(result.kind, 'sync')
  assert.equal(chat.calls, 2)
  assert.equal(store.writes.length, 2)
})

test('the default deadline is a real bound', () => {
  assert.ok(DEFAULT_CHAT_CALL_TIMEOUT_MS > 0 && Number.isFinite(DEFAULT_CHAT_CALL_TIMEOUT_MS))
})

// ── incremental by default (non-vacuity 7) ───────────────────────────────────
//
// A decompose costs one chat call per caption it runs, and `setFragments` overwrites what was
// there. Running every caption every time means growing a captioned set by two images pays for
// the whole set and rebuilds fragments that were already correct. The record of what is already
// decomposed is `DatasetMediaItem.fragments` — the field this job itself writes — so the work
// left is a fact the cursor can read before it calls anything.

/** The dataset above with `m-first` already decomposed by an earlier pass. */
function partlyDecomposed(): Dataset {
  const dataset = makeDataset()
  dataset.media[0]!.fragments = [
    { category: 'subject', text: 'a woman', source: 'sample-board', trigger: '' },
  ]
  return dataset
}

test('a media item that already carries fragments is not sent to the model a second time', async () => {
  const dataset = partlyDecomposed()
  const before = dataset.media[0]!.fragments
  const store = new FakeDatasets(dataset)
  const chat = fakeChat()
  const cursor = new MuseDecomposeCursor({ datasets: store, providers: [binding()], fetchImpl: chat.fetchImpl })

  // The reservation is taken against the work, not against the captionset: one caption left.
  const reserved = await cursor.reserve(modus(), aditus)
  assert.equal(
    reserved,
    chatImpetus(1 * DEFAULT_TOKENS_PER_CAPTION, OPENROUTER_PROVIDER.pricing.chatImpetusPer1kTokens),
    'a pass with one item left must not lock the ceiling of a whole-set pass',
  )

  await cursor.run(actum(aditus, reserved))

  assert.equal(chat.calls, 1, 'the decomposed item costs no provider call')
  assert.deepEqual(store.writes.map((w) => w.mediaId), ['m-second'])
  assert.equal(dataset.media[0]!.fragments, before, 'and its existing fragments are left alone')
  assert.ok(dataset.media[1]!.fragments?.[0]?.text.includes('a cat on a wall'))
})

test('a decompose with nothing left to do is refused before anything is reserved', async () => {
  // THE MONEY PROOF. `reserve()` is what ActumInceptor calls before it locks a signum, so a
  // refusal that only reached `run()` would freeze credits against a job with no work in it —
  // the same defect the single-flight guard is placed here to avoid.
  const dataset = makeDataset()
  for (const item of dataset.media) {
    item.fragments = [{ category: 'subject', text: 'already', source: 'sample-board', trigger: '' }]
  }
  const store = new FakeDatasets(dataset)
  const chat = fakeChat()
  const cursor = new MuseDecomposeCursor({ datasets: store, providers: [binding()], fetchImpl: chat.fetchImpl })

  await assert.rejects(
    () => cursor.reserve(modus(), aditus),
    (err: Error) => err instanceof DecomposeNothingToDoError && /already carries fragments/.test(err.message),
  )
  await assert.rejects(() => cursor.run(actum(aditus)), DecomposeNothingToDoError)
  assert.equal(chat.calls, 0)
  assert.equal(store.writes.length, 0, 'nothing is rewritten by a run that had nothing to do')
})

test('a decompose asked to redo everything decomposes an item that already has fragments', async () => {
  const dataset = partlyDecomposed()
  const store = new FakeDatasets(dataset)
  const chat = fakeChat()
  const cursor = new MuseDecomposeCursor({ datasets: store, providers: [binding()], fetchImpl: chat.fetchImpl })

  const redo = { ...aditus, redo: true }
  const reserved = await cursor.reserve(modus(), redo)
  assert.equal(
    reserved,
    chatImpetus(2 * DEFAULT_TOKENS_PER_CAPTION, OPENROUTER_PROVIDER.pricing.chatImpetusPer1kTokens),
    'the redo path is priced for the whole pass, which is why it is not the default',
  )

  const result = await cursor.run(actum(redo, reserved))

  assert.equal(chat.calls, 2)
  assert.deepEqual(store.writes.map((w) => w.mediaId).sort(), ['m-first', 'm-second'])
  // The already-decomposed item was rebuilt from its caption rather than left as it was.
  assert.ok(dataset.media[0]!.fragments?.[0]?.text.includes('a woman in a red coat'))
  assert.equal(result.kind, 'sync')
  if (result.kind !== 'sync') return
  assert.deepEqual(result.exitus.exitus, { decomposed: 2, fragments: 2 })
})

test('redo is an explicit ask: a value that is not one is left on the incremental path', async () => {
  const store = new FakeDatasets(partlyDecomposed())
  const chat = fakeChat()
  const cursor = new MuseDecomposeCursor({ datasets: store, providers: [binding()], fetchImpl: chat.fetchImpl })

  // A loose truthiness test here would make every one of these decompose the whole set.
  for (const value of ['false', 'no', '', 0, null, undefined]) {
    const reserved = await cursor.reserve(modus(), { ...aditus, redo: value })
    assert.equal(
      reserved,
      chatImpetus(1 * DEFAULT_TOKENS_PER_CAPTION, OPENROUTER_PROVIDER.pricing.chatImpetusPer1kTokens),
      `redo: ${JSON.stringify(value)} must not be read as a request to redo everything`,
    )
  }
  assert.equal(chat.calls, 0)
})

test('the run reports how many items it actually decomposed, not how many the captionset holds', async () => {
  const dataset = partlyDecomposed()
  const store = new FakeDatasets(dataset)
  const chat = fakeChat(120)
  const cursor = new MuseDecomposeCursor({ datasets: store, providers: [binding()], fetchImpl: chat.fetchImpl })

  const result = await cursor.run(actum(aditus, 10_000n))
  assert.equal(result.kind, 'sync')
  if (result.kind !== 'sync') return

  // The captionset holds two captions and one item was already decomposed: a run reporting two
  // would disagree with its own settlement, which is the summed real cost of the calls it made.
  assert.equal(Object.keys(dataset.captionsets[0]!.captions ?? {}).length, 2)
  assert.deepEqual(result.exitus.exitus, { decomposed: 1, fragments: 1 })
  assert.equal(
    result.exitus.impetus,
    chatImpetus(1 * 120, OPENROUTER_PROVIDER.pricing.chatImpetusPer1kTokens),
    'the settlement is one call, and the count must say one item',
  )
})
