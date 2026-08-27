// The decompose half of Muse: a captionset in, fragments on the dataset's media items. Pins the
// things a decompose run depends on — fragments keyed by media id (never by position into an
// append-only array), a per-job cap enforced before the reservation, its own ministerium (so the
// hosted-API provider registrations survive), a closed door when no chat provider is registered,
// one decompose at a time per dataset (refused before the reservation is locked), a deadline
// on every chat call so a run that stops getting answers fails instead of holding its
// reservation until the actum expires, an incremental pass (items that already carry fragments
// are not sent to the model again, a pass with nothing left to do is refused before a signum is
// locked, and `redo` is the explicit way to rebuild the whole set) and — since noema-338 — a
// pass that DISPATCHES ASYNC: `run()` returns a run handle and the loop continues off-request,
// settling itself through the completor at the end because no webhook is coming.
//
// Hermetic by construction: a fake store, a fake transport and a fake completor, no Mongo and no
// network. It therefore says nothing about what a real decompose does to a real dataset.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MuseDecomposeCursor,
  MUSE_DECOMPOSE_MINISTERIUM,
  DEFAULT_MAX_DECOMPOSE_CAPTIONS,
  DEFAULT_TOKENS_PER_CAPTION,
  DEFAULT_CHAT_CALL_TIMEOUT_MS,
  DECOMPOSE_TERMINUS_MARGIN_MS,
  MAX_DECOMPOSE_TERMINUS_MS,
  DecomposeInFlightError,
  DecomposeNothingToDoError,
  type ChatProviderBinding,
  type MuseDecomposeCursorDeps,
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
import { DEFAULT_EXPIRAT_MS, MAX_TERMINUS_MS } from '../../../src/execution/ActumInceptor.js'
import { withTrace, makeTraceContext } from '../../../src/lib/trace.js'
import type { Actum } from '../../../src/types/actum.js'
import type { Modus } from '../../../src/types/modus.js'
import type { ActumCompletor, Actorum, Exitus } from '../../../src/types/cursus.js'
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

/**
 * The actum store, with `update` present and watched.
 *
 * `update` is what stamps `externusJobId` — the field that enrols a run in the pod in-flight
 * sweep. A decompose has no pod and no webhook, so nothing could ever satisfy that sweep for it
 * and the run must not be enrolled. The cursor's dep is narrowed to `findById`; `updates` below
 * is the assertion that the narrowing is real rather than declarative.
 */
class FakeActorum {
  reads: string[] = []
  updates: Array<Record<string, unknown>> = []
  constructor(private readonly record: Actum | null = null) {}
  async findById(id: string): Promise<Actum | null> {
    this.reads.push(id)
    return this.record
  }
  async update(_id: string, patch: Record<string, unknown>): Promise<Actum> {
    this.updates.push(patch)
    return this.record as Actum
  }
}

/**
 * The completor a detached pass settles through — and the only place a test can watch the pass
 * END. `run()` now returns at dispatch, so awaiting it says nothing about the loop; `settled`
 * is what resolves when the loop has reached a terminal state under its own power.
 */
class FakeCompletor {
  completed: Array<{ actum: Actum; exitus: Exitus; auctor?: unknown }> = []
  failed: Array<{ actum: Actum; error: string }> = []
  readonly settled: Promise<void>
  private announce!: () => void
  constructor() {
    this.settled = new Promise<void>((r) => { this.announce = r })
  }
  async complete(actum: Actum, exitus: Exitus, auctor?: unknown): Promise<Actum> {
    this.completed.push({ actum, exitus, auctor })
    this.announce()
    return actum
  }
  async fail(actum: Actum, error: string): Promise<Actum> {
    this.failed.push({ actum, error })
    this.announce()
    return actum
  }
}

type CursorInputs = Omit<MuseDecomposeCursorDeps, 'actorum' | 'completor'>

interface Built {
  cursor: MuseDecomposeCursor
  completor: FakeCompletor
  actorum: FakeActorum
}

/** A cursor wired to fakes, with the settlement rail visible to the test. */
function build(inputs: CursorInputs, record: Actum | null = null): Built {
  const completor = new FakeCompletor()
  const actorum = new FakeActorum(record)
  const cursor = new MuseDecomposeCursor({
    ...inputs,
    actorum: actorum as unknown as Pick<Actorum, 'findById'>,
    completor: () => completor as unknown as ActumCompletor,
  })
  return { cursor, completor, actorum }
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

/** A transport held open on demand, so a pass can be parked mid-flight and released later. */
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

/**
 * Poll a condition to true, or fail the test.
 *
 * The claim is released in a `finally` inside the detached loop, which runs a microtask or two
 * after the settlement the test can see — so "is it free now" is asked rather than assumed.
 */
async function waitFor(cond: () => Promise<boolean>, attempts = 100): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    if (await cond().catch(() => false)) return
    await new Promise((r) => setTimeout(r, 5))
  }
  assert.fail('condition never became true')
}

const binding = (): ChatProviderBinding => ({ provider: OPENROUTER_PROVIDER, apiKey: 'test-key' })

const actum = (aditus: Record<string, unknown>, impetus = 10_000n): Actum =>
  ({ id: 'act-decompose', aditus, impetus } as unknown as Actum)

const modus = (over: Partial<Modus> = {}): Modus => ({ ...MODUS_DATASET_DECOMPOSE, ...over }) as Modus

const aditus = { dataset: 'ds-1', captionset: 'cs-1' }

/**
 * Dispatch and wait for the detached pass to end.
 *
 * Every assertion about what a pass DID has to wait for this rather than for `run()`, which is
 * the whole point of the change: the request is released long before the work is finished.
 */
async function pass(built: Built, a: Actum = actum(aditus)): Promise<FakeCompletor> {
  const result = await built.cursor.run(a)
  assert.equal(result.kind, 'async', 'a decompose dispatches async — the loop runs off-request')
  await built.completor.settled
  return built.completor
}

/** The settlement of a pass that completed, asserted to be the only one. */
function settlement(completor: FakeCompletor): Exitus {
  assert.equal(completor.failed.length, 0, `the pass must not have failed: ${completor.failed[0]?.error ?? ''}`)
  assert.equal(completor.completed.length, 1, 'a pass settles exactly once')
  return completor.completed[0]!.exitus
}

// ── async at dispatch (noema-338) ────────────────────────────────────────────
//
// The pass is one awaited chat call per caption, serial, up to the per-job cap. Held open on the
// dispatching request, the run's duration IS the caller's HTTP timeout, and a client whose fetch
// gives up reads a run that has already succeeded server-side as a failure. So `run()` returns a
// handle and the loop continues; the cursor settles the run itself when the loop ends.

test('run returns before the pass has finished, and the pass finishes anyway', async () => {
  const dataset = makeDataset()
  const store = new FakeDatasets(dataset)
  const held = heldChat()
  const built = build({ datasets: store, providers: [binding()], fetchImpl: held.fetchImpl })

  const result = await built.cursor.run(actum(aditus))
  await held.started

  // The dispatch is already answered while the first chat call is still on the wire — this is
  // the whole change. A sync return could not be here with nothing written yet.
  assert.equal(result.kind, 'async')
  assert.equal(store.writes.length, 0, 'the caller is released before the first fragment is written')
  assert.equal(built.completor.completed.length, 0, 'and before the run has settled')

  held.release()
  await built.completor.settled

  assert.deepEqual(settlement(built.completor).exitus, { decomposed: 2, fragments: 2 })
  assert.deepEqual(store.writes.map((w) => w.mediaId).sort(), ['m-first', 'm-second'])
})

test('the run handle is never stamped onto the actum — a webhook-less run must not enrol in the in-flight sweep', async () => {
  const store = new FakeDatasets(makeDataset())
  const chat = fakeChat()
  const built = build({ datasets: store, providers: [binding()], fetchImpl: chat.fetchImpl })

  const result = await built.cursor.run(actum(aditus))
  await built.completor.settled

  assert.equal(result.kind, 'async')
  if (result.kind !== 'async') return
  // The handle is the run's own id and is read by nothing: `dispatchInceptio` ignores it on the
  // async branch. What matters is that it never reaches the record — `findInFlight` selects on
  // `externusJobId`, and a decompose has no pod that could ever answer that sweep.
  assert.equal(result.externusJobId, 'act-decompose')
  assert.deepEqual(built.actorum.updates, [], 'the cursor must write nothing onto the actum')
})

test('the settlement re-reads the actum rather than settling the dispatch-time snapshot', async () => {
  const store = new FakeDatasets(makeDataset())
  const chat = fakeChat()
  // The record as it stands at settlement time — a whole pass later than the snapshot `run()`
  // was handed. It is what the completor must be given.
  const fresh = { id: 'act-decompose', aditus, impetus: 10_000n } as unknown as Actum
  const built = build({ datasets: store, providers: [binding()], fetchImpl: chat.fetchImpl }, fresh)

  const completor = await pass(built)

  assert.deepEqual(built.actorum.reads, ['act-decompose'])
  assert.equal(completor.completed[0]!.actum, fresh)
})

test('a dispatch with no trace context still settles — the auctor is optional, the settlement is not', async () => {
  const store = new FakeDatasets(makeDataset())
  const built = build({ datasets: store, providers: [binding()], fetchImpl: fakeChat().fetchImpl })
  const completor = await pass(built)
  assert.equal(completor.completed[0]!.auctor, undefined)
})

test('the identified owner travels from the dispatch trace into the settlement', async () => {
  // The sync return path handed the owner to `complete()` from the inceptio, which is how a run
  // reaches vestigium indexing. A detached loop has no inceptio; the trace `dispatchInceptio`
  // opens around `run()` is where that identity already travels, so it is read there.
  const store = new FakeDatasets(makeDataset())
  const built = build({ datasets: store, providers: [binding()], fetchImpl: fakeChat().fetchImpl })

  await withTrace(makeTraceContext({ platform: 'api', animaId: 'anima-1' }), () =>
    built.cursor.run(actum(aditus)),
  )
  await built.completor.settled

  assert.deepEqual(built.completor.completed[0]!.auctor, { animaId: 'anima-1' })
})

test('an anonymous dispatch settles against its commitment, not against nobody', async () => {
  const store = new FakeDatasets(makeDataset())
  const built = build({ datasets: store, providers: [binding()], fetchImpl: fakeChat().fetchImpl })

  await withTrace(makeTraceContext({ platform: 'api', commitment: 'commit-1' }), () =>
    built.cursor.run(actum(aditus)),
  )
  await built.completor.settled

  assert.deepEqual(built.completor.completed[0]!.auctor, { commitment: 'commit-1' })
})

// ── failure settlement (money seam 3) ────────────────────────────────────────
//
// A sync cursor that threw was settled by `dispatchInceptio`, which caught it and called
// `fail()`. A detached loop has no caller to throw to: a loop that dies and does not settle
// leaves the payer's credits locked until the expiry reaper releases them. So the loop fails
// its own run.

test('a loop that dies mid-pass settles through fail rather than leaving a reservation dangling', async () => {
  const store = new FakeDatasets(makeDataset())
  const fetchImpl: FetchLike = async () => ({ ok: false, status: 502, text: async () => 'upstream said no' })
  const built = build({ datasets: store, providers: [binding()], fetchImpl })

  const result = await built.cursor.run(actum(aditus))
  assert.equal(result.kind, 'async', 'the dispatch itself succeeded — the pass is what failed')
  await built.completor.settled

  assert.equal(built.completor.completed.length, 0)
  assert.equal(built.completor.failed.length, 1, 'the run reaches a terminal state under its own power')
  assert.match(built.completor.failed[0]!.error, /chat completion failed \(502\)/)
  assert.equal(store.writes.length, 0, 'and nothing is written from a pass that never got an answer')
})

test('a settle that itself fails does not leave the dataset claimed', async () => {
  const store = new FakeDatasets(makeDataset())
  const cursor = new MuseDecomposeCursor({
    datasets: store,
    providers: [binding()],
    fetchImpl: fakeChat().fetchImpl,
    actorum: new FakeActorum() as unknown as Pick<Actorum, 'findById'>,
    completor: () => ({
      async complete(): Promise<Actum> { throw new Error('ledger unavailable') },
      async fail(): Promise<Actum> { throw new Error('ledger unavailable') },
    } as unknown as ActumCompletor),
  })

  await cursor.run(actum(aditus))
  // The claim is released in a `finally`, so a settlement rail that is down cannot also wedge
  // the dataset shut against every later pass.
  await waitFor(async () => (await cursor.reserve(modus(), { ...aditus, redo: true })) > 0n)
})

// ── media-id keying ──────────────────────────────────────────────────────────

test('fragments stay bound to their own media item after media is appended', async () => {
  const dataset = makeDataset()
  const store = new FakeDatasets(dataset)
  const chat = fakeChat()
  const built = build({ datasets: store, providers: [binding()], fetchImpl: chat.fetchImpl })

  // Media is append-only: a third item arrives between captioning and decomposing. Positional
  // pairing (fragments[i] onto media[i]) survives this silently — every item still has fragments,
  // they are simply the wrong item's. Keying on the media id does not.
  dataset.media.unshift(mediaItem('m-added-later'))

  await pass(built)

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
  const built = build({ datasets: store, providers: [binding()], fetchImpl: chat.fetchImpl })

  await pass(built)

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
  const built = build({ datasets: store, providers: [binding()], fetchImpl: chat.fetchImpl })

  // Resolved BEFORE the caller is released, so a request that cannot be honoured is still
  // answered by the request that made it rather than only on the run record.
  await assert.rejects(() => built.cursor.run(actum(aditus)), /does not name a media item/)
  assert.equal(chat.calls, 0, 'the refusal must land before the first provider call')
  assert.equal(store.writes.length, 0)
  assert.equal(built.completor.completed.length, 0)
})

// ── the per-job cap ──────────────────────────────────────────────────────────

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
  const built = build({
    datasets: store, providers: [binding()], fetchImpl: chat.fetchImpl, maxCaptions: 3,
  })

  // reserve() is where the cap bites, so an oversized job never reaches a reservation.
  await assert.rejects(() => built.cursor.reserve(modus(), aditus), /above the 3-caption per-job cap/)
  await assert.rejects(() => built.cursor.run(actum(aditus)), /above the 3-caption per-job cap/)
  assert.equal(chat.calls, 0)
  assert.equal(store.writes.length, 0)
})

test('reserve: a ceiling computed from the caption count, settled down to real usage by the pass', async () => {
  const store = new FakeDatasets(makeDataset())
  const chat = fakeChat(120)
  const built = build({ datasets: store, providers: [binding()], fetchImpl: chat.fetchImpl })

  const reserved = await built.cursor.reserve(modus(), aditus)
  const perThousand = OPENROUTER_PROVIDER.pricing.chatImpetusPer1kTokens
  assert.equal(reserved, chatImpetus(2 * DEFAULT_TOKENS_PER_CAPTION, perThousand))
  assert.ok(reserved > 0n, 'a metered job must reserve something')

  const exitus = settlement(await pass(built, actum(aditus, reserved)))
  // Settled through the SAME shared helper the ApiCursor and the concierge charge by — the move
  // off-request changed where the settlement is handed over, not what it is.
  assert.equal(exitus.impetus, chatImpetus(2 * 120, perThousand))
  assert.ok(exitus.impetus <= reserved, 'the settlement must never exceed reserve()')
  assert.deepEqual(exitus.exitus, { decomposed: 2, fragments: 2 })
  assert.equal(chat.calls, 2, 'one chat call per caption')
})

test('a pass that outruns its reservation settles at the reservation, not above it', async () => {
  // The clamp is the cursor's half of the cost contract. Without it the completor rejects the
  // completion outright as an overcharge, and the run would fail after doing all of its work.
  const store = new FakeDatasets(makeDataset())
  const chat = fakeChat(500_000)
  const built = build({ datasets: store, providers: [binding()], fetchImpl: chat.fetchImpl })

  const reserved = 5n
  assert.equal(settlement(await pass(built, actum(aditus, reserved))).impetus, reserved)
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

// ── the declared terminus (money seam 4) ─────────────────────────────────────
//
// `expirat` is what lets the expiry reaper call a run dead and refund it. A pass that now runs
// off-request has no open request keeping it visibly alive, and a serial pass of N captions can
// honestly take N × the per-call deadline — hours for a full job, against an inceptor default of
// fifteen minutes. Under the default the reaper would fail-and-refund a LIVE decompose that is
// still writing fragments.

/** A dataset whose captionset carries `n` captions, none of them decomposed yet. */
function datasetOf(n: number): Dataset {
  const dataset = makeDataset()
  dataset.media = []
  const captions: Record<string, string> = {}
  for (let i = 0; i < n; i++) {
    dataset.media.push(mediaItem(`m-${i}`))
    captions[`m-${i}`] = `caption ${i}`
  }
  dataset.captionsets[0]!.captions = captions
  return dataset
}

test('the terminus is the pass\'s own length: one call deadline per item, plus the margin', async () => {
  const store = new FakeDatasets(makeDataset())
  const built = build({ datasets: store, providers: [binding()], fetchImpl: fakeChat().fetchImpl })

  assert.equal(
    await built.cursor.terminus(modus(), aditus),
    2 * DEFAULT_CHAT_CALL_TIMEOUT_MS + DECOMPOSE_TERMINUS_MARGIN_MS,
  )
})

test('a pass longer than the default window declares a window that fits it', async () => {
  // THE POINT OF THE SEAM. Under the inceptor's fifteen-minute default, a pass with more work in
  // it than fifteen minutes of call deadlines is reaped — failed and refunded — while it is still
  // making calls and writing fragments. A sync run was kept visibly alive by its open request; an
  // off-request one is not, so the length has to be declared.
  const items = Math.ceil(DEFAULT_EXPIRAT_MS / DEFAULT_CHAT_CALL_TIMEOUT_MS) + 1
  assert.ok(items <= DEFAULT_MAX_DECOMPOSE_CAPTIONS, 'a legal job must be able to be this long')
  const built = build({
    datasets: new FakeDatasets(datasetOf(items)), providers: [binding()], fetchImpl: fakeChat().fetchImpl,
  })

  const declared = await built.cursor.terminus(modus(), aditus)
  assert.equal(declared, items * DEFAULT_CHAT_CALL_TIMEOUT_MS + DECOMPOSE_TERMINUS_MARGIN_MS)
  assert.ok(declared > DEFAULT_EXPIRAT_MS, 'the declared window must outlive the default it replaces')
})

test('the terminus scales with the work, not with the captionset', async () => {
  const dataset = makeDataset()
  dataset.media[0]!.fragments = [{ category: 'subject', text: 'a woman', source: 'sample-board', trigger: '' }]
  const built = build({ datasets: new FakeDatasets(dataset), providers: [binding()], fetchImpl: fakeChat().fetchImpl })

  // One item is already decomposed, so the pass is one call long and says so.
  assert.equal(
    await built.cursor.terminus(modus(), aditus),
    1 * DEFAULT_CHAT_CALL_TIMEOUT_MS + DECOMPOSE_TERMINUS_MARGIN_MS,
  )
})

test('the terminus is clamped — a full job cannot buy an unbounded deadline', async () => {
  const built = build({
    datasets: new FakeDatasets(datasetOf(DEFAULT_MAX_DECOMPOSE_CAPTIONS)),
    providers: [binding()],
    fetchImpl: fakeChat().fetchImpl,
  })

  const uncapped = DEFAULT_MAX_DECOMPOSE_CAPTIONS * DEFAULT_CHAT_CALL_TIMEOUT_MS + DECOMPOSE_TERMINUS_MARGIN_MS
  assert.ok(uncapped > MAX_DECOMPOSE_TERMINUS_MS, 'the longest legal pass must be the one the clamp bites on')
  assert.equal(await built.cursor.terminus(modus(), aditus), MAX_DECOMPOSE_TERMINUS_MS)
})

test('the declared ceiling is no wider than the one the inceptor enforces', () => {
  // A cursor cannot buy a deadline past MAX_TERMINUS_MS — the inceptor clamps every declaration
  // to it. Declaring above that would be a number that never means what it says.
  assert.ok(MAX_DECOMPOSE_TERMINUS_MS <= MAX_TERMINUS_MS)
  assert.ok(DECOMPOSE_TERMINUS_MARGIN_MS > 0)
})

// ── the ministerium ──────────────────────────────────────────────────────────

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
    build({ datasets: new FakeDatasets(null), providers: [binding()] }).cursor,
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

// ── fail closed ──────────────────────────────────────────────────────────────

test('no registered chat provider refuses the run with a named error rather than a 401 from the wire', async () => {
  const store = new FakeDatasets(makeDataset())
  const chat = fakeChat()
  const built = build({ datasets: store, providers: [], fetchImpl: chat.fetchImpl })

  // reserve() refuses first, so nothing is ever locked for a run that cannot be served.
  await assert.rejects(() => built.cursor.reserve(modus(), aditus), /no chat-capable API provider/)
  await assert.rejects(() => built.cursor.run(actum(aditus)), /no chat-capable API provider/)
  assert.equal(chat.calls, 0)
  assert.equal(store.writes.length, 0)
})

test('a provider registered without a usable key is not a usable provider', async () => {
  const store = new FakeDatasets(makeDataset())
  const built = build({ datasets: store, providers: [{ provider: OPENROUTER_PROVIDER, apiKey: '' }] })
  await assert.rejects(() => built.cursor.reserve(modus(), aditus), /no chat-capable API provider/)
})

test('an explicitly named provider that is not registered is refused, not silently substituted', async () => {
  const store = new FakeDatasets(makeDataset())
  const built = build({ datasets: store, providers: [binding()] })
  await assert.rejects(
    () => built.cursor.reserve(modus(), { ...aditus, provider: 'openai' }),
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
  const built = build({
    datasets: store,
    providers: [{ provider: OPENAI_PROVIDER, apiKey: 'k1' }, { provider: OPENROUTER_PROVIDER, apiKey: 'k2' }],
    fetchImpl,
  })

  await pass(built, actum({ ...aditus, provider: 'openai' }))
  assert.ok(seen.length > 0, 'the pass must have reached the wire')
  assert.ok(seen.every((u) => u.startsWith(OPENAI_PROVIDER.baseUrl)), 'every call must hit the named provider')
})

// ── input resolution ─────────────────────────────────────────────────────────

test('an unknown dataset or captionset is refused by name, and nothing is written', async () => {
  const store = new FakeDatasets(makeDataset())
  const chat = fakeChat()
  const built = build({ datasets: store, providers: [binding()], fetchImpl: chat.fetchImpl })

  await assert.rejects(() => built.cursor.run(actum({ dataset: 'ds-missing', captionset: 'cs-1' })), /does not exist/)
  await assert.rejects(() => built.cursor.run(actum({ dataset: 'ds-1', captionset: 'cs-missing' })), /is not on dataset/)
  await assert.rejects(() => built.cursor.run(actum({ captionset: 'cs-1' })), /`dataset` is required/)
  await assert.rejects(() => built.cursor.run(actum({ dataset: 'ds-1' })), /`captionset` is required/)
  assert.equal(chat.calls, 0)
  assert.equal(store.writes.length, 0)
})

test('an empty captionset is refused rather than settling a run that decomposed nothing', async () => {
  const dataset = makeDataset()
  dataset.captionsets[0]!.captions = { 'm-first': '   ' }
  const store = new FakeDatasets(dataset)
  const built = build({ datasets: store, providers: [binding()], fetchImpl: fakeChat().fetchImpl })
  await assert.rejects(() => built.cursor.run(actum(aditus)), /carries no captions/)
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
  const built = build({ datasets: store, providers: [binding()], fetchImpl })

  const exitus = settlement(await pass(built))
  assert.deepEqual(exitus.exitus, { decomposed: 1, fragments: 1 })
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
  const built = build({ datasets: store, providers: [binding()], fetchImpl })

  await pass(built, actum({ ...aditus, trigger: 'sampletrig' }))
  assert.ok(systems[0]?.includes('sampletrig'), 'the trigger must reach the decomposition rules')
  assert.equal(dataset.media.find((m) => m.id === 'm-first')?.fragments?.[0]?.trigger, 'sampletrig')
})

// ── single flight, and where the refusal lands ───────────────────────────────
//
// A decompose holds its reservation for the whole pass, so a second one started on top of a
// running one locks a SECOND reservation against the same work. Three properties are asserted
// here: that the second is refused at all, that it is refused from `reserve()` — the call
// ActumInceptor makes BEFORE it locks anything — and that the claim outlives `run()`. That last
// one is what the async move puts at risk: with the pass detached, a claim released when `run()`
// returns is released while the loop is still spending.

test('a second decompose for a dataset already decomposing is refused', async () => {
  const store = new FakeDatasets(makeDataset())
  const held = heldChat()
  const built = build({ datasets: store, providers: [binding()], fetchImpl: held.fetchImpl })

  await built.cursor.run(actum(aditus))
  await held.started

  await assert.rejects(
    () => built.cursor.reserve(modus(), aditus),
    (err: Error) => err instanceof DecomposeInFlightError && /already running on dataset 'ds-1'/.test(err.message),
  )

  held.release()
  await built.completor.settled
})

test('the claim is held for the LOOP\'s duration, not the request\'s', async () => {
  // NON-VACUITY. `run()` has already returned here — the dispatching request is closed and the
  // caller has its run id. Releasing the claim at that point (rather than at the end of the
  // detached loop) frees the dataset while the first pass is still making paid calls against it,
  // and a second dispatch locks a second reservation over the same work.
  const store = new FakeDatasets(makeDataset())
  const held = heldChat()
  const built = build({ datasets: store, providers: [binding()], fetchImpl: held.fetchImpl })

  const dispatched = await built.cursor.run(actum(aditus))
  assert.equal(dispatched.kind, 'async', 'the request is over')
  await held.started

  await assert.rejects(() => built.cursor.reserve(modus(), aditus), DecomposeInFlightError)

  held.release()
  await built.completor.settled
  // And it IS released once the loop is genuinely done — a claim that never cleared would be its
  // own defect, refusing every later pass on the dataset for the life of the process.
  await waitFor(async () => (await built.cursor.reserve(modus(), { ...aditus, redo: true })) > 0n)
})

test('the refusal happens BEFORE any reservation is locked', async () => {
  // ActumInceptor calls reserve() first and locks signa against its answer; a refusal that
  // only reached run() would already be holding the second reservation it was meant to prevent.
  const store = new FakeDatasets(makeDataset())
  const held = heldChat()
  const built = build({ datasets: store, providers: [binding()], fetchImpl: held.fetchImpl })

  await built.cursor.run(actum(aditus))
  await held.started
  await assert.rejects(() => built.cursor.reserve(modus(), aditus), DecomposeInFlightError)

  held.release()
  await built.completor.settled
})

test('a decompose on a DIFFERENT dataset is not caught by the guard', async () => {
  const store = new FakeDatasets(makeDataset())
  const held = heldChat()
  const built = build({ datasets: store, providers: [binding()], fetchImpl: held.fetchImpl })

  await built.cursor.run(actum(aditus))
  await held.started
  // Unknown, but refused for NOT EXISTING — not for a decompose that is running elsewhere.
  await assert.rejects(
    () => built.cursor.reserve(modus(), { dataset: 'ds-other', captionset: 'cs-1' }),
    /dataset 'ds-other' does not exist/,
  )

  held.release()
  await built.completor.settled
})

test('a finished decompose frees its dataset for the next one', async () => {
  const store = new FakeDatasets(makeDataset())
  const chat = fakeChat()
  const built = build({ datasets: store, providers: [binding()], fetchImpl: chat.fetchImpl })

  await pass(built)
  // The pass is over, so its claim is gone. Asked with `redo` because the pass it just finished
  // left nothing else to do — the claim is what is under test here, not the workload.
  await waitFor(async () => (await built.cursor.reserve(modus(), { ...aditus, redo: true })) > 0n)
})

// ── the per-call deadline ────────────────────────────────────────────────────
//
// One chat call per caption, and no deadline on any of them: a provider call that never
// answers parks the whole pass until the actum's expiry, holding the reservation for the
// entire expiry window. The deadline is what makes a stuck call a failure of the run.

test('a chat call that never answers fails the decompose instead of running until the actum expires', async () => {
  const store = new FakeDatasets(makeDataset())
  const silent: FetchLike = () => new Promise(() => {})   // answers never
  const built = build({
    datasets: store, providers: [binding()], fetchImpl: silent, chatCallTimeoutMs: 20,
  })

  await built.cursor.run(actum(aditus))
  await built.completor.settled

  assert.equal(built.completor.completed.length, 0)
  assert.match(built.completor.failed[0]!.error, /the chat call for media item 'm-first' did not answer within/)
  assert.equal(store.writes.length, 0, 'a run that never got an answer writes nothing')
})

test('the deadline aborts the call it gave up on', async () => {
  const store = new FakeDatasets(makeDataset())
  let seen: AbortSignal | undefined
  const silent: FetchLike = (_url, init) => { seen = init.signal; return new Promise(() => {}) }
  const built = build({
    datasets: store, providers: [binding()], fetchImpl: silent, chatCallTimeoutMs: 20,
  })

  await built.cursor.run(actum(aditus))
  await built.completor.settled
  assert.match(built.completor.failed[0]!.error, /did not answer within/)
  assert.ok(seen, 'the transport must be handed a signal to cancel with')
  assert.equal(seen?.aborted, true, 'a call the run gave up on must not be left open')
})

test('a timed-out decompose releases its dataset rather than leaving it claimed for the reaper', async () => {
  const store = new FakeDatasets(makeDataset())
  const silent: FetchLike = () => new Promise(() => {})
  const built = build({
    datasets: store, providers: [binding()], fetchImpl: silent, chatCallTimeoutMs: 20,
  })

  await built.cursor.run(actum(aditus))
  await built.completor.settled
  // The dataset is free the moment the pass ends — not hours later, when the expiry reaper
  // would have been the one to notice.
  await waitFor(async () => (await built.cursor.reserve(modus(), aditus)) > 0n)
})

test('a healthy call is not cut off by the deadline', async () => {
  const store = new FakeDatasets(makeDataset())
  const chat = fakeChat()
  const built = build({
    datasets: store, providers: [binding()], fetchImpl: chat.fetchImpl, chatCallTimeoutMs: 5_000,
  })
  settlement(await pass(built))
  assert.equal(chat.calls, 2)
  assert.equal(store.writes.length, 2)
})

test('the default deadline is a real bound', () => {
  assert.ok(DEFAULT_CHAT_CALL_TIMEOUT_MS > 0 && Number.isFinite(DEFAULT_CHAT_CALL_TIMEOUT_MS))
})

// ── incremental by default ───────────────────────────────────────────────────
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
  const built = build({ datasets: store, providers: [binding()], fetchImpl: chat.fetchImpl })

  // The reservation is taken against the work, not against the captionset: one caption left.
  const reserved = await built.cursor.reserve(modus(), aditus)
  assert.equal(
    reserved,
    chatImpetus(1 * DEFAULT_TOKENS_PER_CAPTION, OPENROUTER_PROVIDER.pricing.chatImpetusPer1kTokens),
    'a pass with one item left must not lock the ceiling of a whole-set pass',
  )

  await pass(built, actum(aditus, reserved))

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
  const built = build({ datasets: store, providers: [binding()], fetchImpl: chat.fetchImpl })

  await assert.rejects(
    () => built.cursor.reserve(modus(), aditus),
    (err: Error) => err instanceof DecomposeNothingToDoError && /already carries fragments/.test(err.message),
  )
  await assert.rejects(() => built.cursor.run(actum(aditus)), DecomposeNothingToDoError)
  assert.equal(chat.calls, 0)
  assert.equal(store.writes.length, 0, 'nothing is rewritten by a run that had nothing to do')
})

test('a decompose asked to redo everything decomposes an item that already has fragments', async () => {
  const dataset = partlyDecomposed()
  const store = new FakeDatasets(dataset)
  const chat = fakeChat()
  const built = build({ datasets: store, providers: [binding()], fetchImpl: chat.fetchImpl })

  const redo = { ...aditus, redo: true }
  const reserved = await built.cursor.reserve(modus(), redo)
  assert.equal(
    reserved,
    chatImpetus(2 * DEFAULT_TOKENS_PER_CAPTION, OPENROUTER_PROVIDER.pricing.chatImpetusPer1kTokens),
    'the redo path is priced for the whole pass, which is why it is not the default',
  )

  const exitus = settlement(await pass(built, actum(redo, reserved)))

  assert.equal(chat.calls, 2)
  assert.deepEqual(store.writes.map((w) => w.mediaId).sort(), ['m-first', 'm-second'])
  // The already-decomposed item was rebuilt from its caption rather than left as it was.
  assert.ok(dataset.media[0]!.fragments?.[0]?.text.includes('a woman in a red coat'))
  assert.deepEqual(exitus.exitus, { decomposed: 2, fragments: 2 })
})

test('redo is an explicit ask: a value that is not one is left on the incremental path', async () => {
  const store = new FakeDatasets(partlyDecomposed())
  const chat = fakeChat()
  const built = build({ datasets: store, providers: [binding()], fetchImpl: chat.fetchImpl })

  // A loose truthiness test here would make every one of these decompose the whole set.
  for (const value of ['false', 'no', '', 0, null, undefined]) {
    const reserved = await built.cursor.reserve(modus(), { ...aditus, redo: value })
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
  const built = build({ datasets: store, providers: [binding()], fetchImpl: chat.fetchImpl })

  const exitus = settlement(await pass(built, actum(aditus, 10_000n)))

  // The captionset holds two captions and one item was already decomposed: a run reporting two
  // would disagree with its own settlement, which is the summed real cost of the calls it made.
  assert.equal(Object.keys(dataset.captionsets[0]!.captions ?? {}).length, 2)
  assert.deepEqual(exitus.exitus, { decomposed: 1, fragments: 1 })
  assert.equal(
    exitus.impetus,
    chatImpetus(1 * 120, OPENROUTER_PROVIDER.pricing.chatImpetusPer1kTokens),
    'the settlement is one call, and the count must say one item',
  )
})
