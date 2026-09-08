// =============================================================================
// The embed sweep — whose backlog it reads, what it writes, and what it charges
// =============================================================================
//
// The sweep works off a caller's backlog of un-embedded traces as an ordinary
// metered run. Three properties are what make that safe, and each is pinned here:
//
//   OWNER-SCOPING AT THE BOUNDARY — the work is resolved from the RESOLVED CALLER
//     at the run entry point and stamped onto the aditus. A request body that names
//     another identity, or another identity's traces, is dropped unread: an Actum is
//     identity-blind, so by dispatch there is no caller left to check against.
//
//   OWNER-SCOPING AT THE WRITE — `setEmbedding` matches on the owner, so a foreign
//     id addresses no record even if one ever reached the cursor. Isolation does not
//     depend on the cursor being careful.
//
//   THE RESERVATION IS AN UPPER BOUND — the run settles what it EMBEDDED, never what
//     it was handed, and a failed batch is a skip rather than a lost pass. And a
//     settled run cannot be settled again, so no sweep is paid for twice.
// =============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  EmbedSweepCursor,
  EMBED_SWEEP_IMPETUS_PER_ITEM,
  EMBED_SWEEP_MINISTERIUM,
  MAX_SWEEP_ITEMS,
  sweepOwnerToken,
} from '../../../src/crystal/EmbedSweepCursor.js'
import { MEMORY_ONLY_DIM, fakeVector } from './embedSweep.fixtures.js'
import { MemoryVestigiorum } from '../../../src/rag/MemoryVestigiorum.js'
import { MemorySignorum } from '../../../src/ledger/MemorySignorum.js'
import { MemoryActorum } from '../../../src/execution/MemoryActorum.js'
import { MemoryModorum } from '../../../src/execution/MemoryModorum.js'
import { Cursorum } from '../../../src/execution/Cursorum.js'
import { ActumInceptor } from '../../../src/execution/ActumInceptor.js'
import { ActumCompletor } from '../../../src/execution/ActumCompletor.js'
import { Nexus } from '../../../src/ledger/Nexus.js'
import { dispatchInceptio } from '../../../src/execution/dispatchInceptio.js'
import { CrystalApi, type CrystalApiDeps } from '../../../src/allocutio/api/CrystalApi.js'
import { ApiError } from '../../../src/allocutio/api/errors.js'
import { MODUS_EMBED_SWEEP } from '../../../src/crystal/seeds/modi.js'
import type { Actum } from '../../../src/types/actum.js'
import type { Inceptio } from '../../../src/types/cursus.js'
import type { Vestigium } from '../../../src/types/vestigium.js'

const MINE = { animaId: 'anima-mine' } as const
const THEIRS = { animaId: 'anima-theirs' } as const

// ── Fixtures ─────────────────────────────────────────────────────────────────

async function seedTrace(
  store: MemoryVestigiorum,
  auctorKey: { animaId: string },
  promptum: string,
  extra: Partial<Vestigium> = {},
): Promise<Vestigium> {
  return store.create({
    modusId: 'modus.test',
    auctorKey,
    promptum,
    summarium: promptum,
    genus: 'image',
    visibilitas: 'privata',
    ...extra,
  } as Parameters<MemoryVestigiorum['create']>[0])
}

/** A CLIP double that records every batch it was asked for. */
function recordingClip(opts: { failBatch?: (texts: string[]) => boolean; short?: boolean } = {}) {
  const textBatches: string[][] = []
  const imageBatches: string[][] = []
  return {
    textBatches,
    imageBatches,
    async embedTexts(texts: string[]): Promise<number[][]> {
      textBatches.push(texts)
      if (opts.failBatch?.(texts)) throw new Error('clip service unreachable')
      const vectors = texts.map(t => fakeVector(t))
      return opts.short ? vectors.slice(0, Math.max(0, vectors.length - 1)) : vectors
    },
    async embedImages(urls: string[]): Promise<number[][]> {
      imageBatches.push(urls)
      if (opts.failBatch?.(urls)) throw new Error('clip service unreachable')
      return urls.map(u => fakeVector(u))
    },
  }
}

function sweepActum(aditus: Record<string, unknown>, reserved: bigint): Actum {
  return {
    id: 'act-sweep', modusId: MODUS_EMBED_SWEEP.id, modusVersiono: '1.0.0',
    impetus: reserved, signaConsumed: [],
    aditus, status: 'nascens', inceptum: new Date(),
    expirat: new Date(Date.now() + 60_000),
  }
}

// ── The store: the backlog is one identity's, and so is every write ──────────

test('backlog: one identity sees only its own un-embedded traces', async () => {
  const store = new MemoryVestigiorum(async () => fakeVector('x'))
  const mine = await seedTrace(store, MINE, 'a cathedral of glass')
  await seedTrace(store, THEIRS, 'their private prompt')

  const backlog = await store.backlog(MINE, 'promptum', 10)
  assert.deepEqual(backlog.map(b => b.id), [mine.id], 'a stranger’s trace is not in my backlog')

  const counts = await store.backlogCount(MINE)
  assert.equal(counts.promptum, 1)
})

test('backlog: a dimension a trace cannot carry is never counted or handed out', async () => {
  const store = new MemoryVestigiorum(async () => fakeVector('x'))
  await seedTrace(store, MINE, 'text only')                                   // no image, no models
  await seedTrace(store, MINE, 'with a picture', { imagoUrl: 'https://e/1.png' })

  const counts = await store.backlogCount(MINE)
  assert.equal(counts.promptum, 2, 'every trace owes a promptum embedding')
  assert.equal(counts.imago, 1, 'only the trace that has an image owes an image embedding')
  assert.equal(counts.intella, 0, 'neither carries a model description, so neither owes one')

  const items = await store.backlog(MINE, 'imago', 10)
  assert.deepEqual(items.map(i => i.imagoUrl), ['https://e/1.png'])
})

test('backlog: an embedded trace leaves the backlog', async () => {
  const store = new MemoryVestigiorum(async () => fakeVector('x'))
  const v = await seedTrace(store, MINE, 'a cathedral of glass')

  assert.equal((await store.backlogCount(MINE)).promptum, 1)
  assert.equal(await store.setEmbedding(v.id, MINE, 'promptum', fakeVector('a cathedral of glass')), true)
  assert.equal((await store.backlogCount(MINE)).promptum, 0)
})

test('setEmbedding: a foreign id addresses no record, and writes nothing', async () => {
  const store = new MemoryVestigiorum(async () => fakeVector('x'))
  const theirs = await seedTrace(store, THEIRS, 'their private prompt')

  const written = await store.setEmbedding(theirs.id, MINE, 'promptum', fakeVector('mine'))
  assert.equal(written, false, 'the write is refused by not matching, not by an exception')

  const after = await store.findById(theirs.id)
  assert.equal(after?.embeddingPromptum, undefined, 'their trace is untouched')
  assert.equal((await store.backlogCount(THEIRS)).promptum, 1, 'and still owes its own embedding')
})

// ── The driver: batches, writeback, and skipping ─────────────────────────────

test('driver: the pass is cut into batches the embedding service accepts', async () => {
  const store = new MemoryVestigiorum(async () => fakeVector('x'))
  const clip = recordingClip()
  const cursor = new EmbedSweepCursor({ clip, vestigiorum: store, textBatch: 4 })

  const items = []
  for (let i = 0; i < 10; i++) {
    const v = await seedTrace(store, MINE, `prompt ${i}`)
    items.push({ id: v.id, textum: `prompt ${i}` })
  }

  const result = await cursor.run(sweepActum(
    { per: 'promptum', _owner: sweepOwnerToken(MINE), _sweep: items }, 10n,
  ))

  assert.deepEqual(clip.textBatches.map(b => b.length), [4, 4, 2], 'three batches, none over the size')
  assert.equal(result.kind, 'sync')
  assert.equal((result as { exitus: { exitus: Record<string, unknown> } }).exitus.exitus.embedded, 10)
})

test('driver: every embedded vector is written back onto its own trace', async () => {
  const store = new MemoryVestigiorum(async () => fakeVector('x'))
  const cursor = new EmbedSweepCursor({ clip: recordingClip(), vestigiorum: store })

  const a = await seedTrace(store, MINE, 'first')
  const b = await seedTrace(store, MINE, 'second')

  await cursor.run(sweepActum({
    per: 'promptum',
    _owner: sweepOwnerToken(MINE),
    _sweep: [{ id: a.id, textum: 'first' }, { id: b.id, textum: 'second' }],
  }, 2n))

  assert.deepEqual((await store.findById(a.id))?.embeddingPromptum, fakeVector('first'))
  assert.deepEqual((await store.findById(b.id))?.embeddingPromptum, fakeVector('second'))
  assert.equal((await store.findById(a.id))?.embeddingPromptum?.length, MEMORY_ONLY_DIM)
  assert.equal((await store.backlogCount(MINE)).promptum, 0, 'the backlog is worked off')
})

test('driver: a batch that fails is skipped, and the rest of the pass still lands', async () => {
  const store = new MemoryVestigiorum(async () => fakeVector('x'))
  // The batch carrying 'prompt 2' is the one the service refuses.
  const clip = recordingClip({ failBatch: texts => texts.includes('prompt 2') })
  const cursor = new EmbedSweepCursor({ clip, vestigiorum: store, textBatch: 2 })

  const items = []
  for (let i = 0; i < 6; i++) {
    const v = await seedTrace(store, MINE, `prompt ${i}`)
    items.push({ id: v.id, textum: `prompt ${i}` })
  }

  const result = await cursor.run(sweepActum(
    { per: 'promptum', _owner: sweepOwnerToken(MINE), _sweep: items }, 6n,
  ))
  const exitus = (result as { exitus: { exitus: Record<string, unknown>; impetus: bigint } }).exitus

  assert.equal(exitus.exitus.embedded, 4, 'the four items in the healthy batches embedded')
  assert.equal(exitus.exitus.skipped, 2, 'the failed batch is a skip, not a lost pass')
  assert.equal(exitus.impetus, 4n * EMBED_SWEEP_IMPETUS_PER_ITEM, 'charged for what it did')
  assert.equal((await store.backlogCount(MINE)).promptum, 2, 'the skipped pair is still owed')
})

test('driver: a foreign id in the work writes nothing and is counted skipped', async () => {
  const store = new MemoryVestigiorum(async () => fakeVector('x'))
  const cursor = new EmbedSweepCursor({ clip: recordingClip(), vestigiorum: store })

  const mine = await seedTrace(store, MINE, 'mine')
  const theirs = await seedTrace(store, THEIRS, 'theirs')

  const result = await cursor.run(sweepActum({
    per: 'promptum',
    _owner: sweepOwnerToken(MINE),
    _sweep: [{ id: mine.id, textum: 'mine' }, { id: theirs.id, textum: 'theirs' }],
  }, 2n))
  const exitus = (result as { exitus: { exitus: Record<string, unknown>; impetus: bigint } }).exitus

  assert.equal(exitus.exitus.embedded, 1)
  assert.equal(exitus.exitus.skipped, 1)
  assert.equal((await store.findById(theirs.id))?.embeddingPromptum, undefined, 'their trace is untouched')
  assert.equal(exitus.impetus, 1n * EMBED_SWEEP_IMPETUS_PER_ITEM, 'and it was not billed for')
})

test('driver: a service that answers with fewer vectors than asked skips the tail', async () => {
  const store = new MemoryVestigiorum(async () => fakeVector('x'))
  const cursor = new EmbedSweepCursor({ clip: recordingClip({ short: true }), vestigiorum: store })

  const a = await seedTrace(store, MINE, 'first')
  const b = await seedTrace(store, MINE, 'second')

  const result = await cursor.run(sweepActum({
    per: 'promptum',
    _owner: sweepOwnerToken(MINE),
    _sweep: [{ id: a.id, textum: 'first' }, { id: b.id, textum: 'second' }],
  }, 2n))
  const exitus = (result as { exitus: { exitus: Record<string, unknown> } }).exitus

  assert.equal(exitus.exitus.embedded, 1)
  assert.equal(exitus.exitus.skipped, 1)
  assert.equal((await store.findById(b.id))?.embeddingPromptum, undefined, 'no wrong vector is written')
})

// ── The reservation ──────────────────────────────────────────────────────────

test('reserve: the sweep is priced per item, and a run never settles above it', async () => {
  const store = new MemoryVestigiorum(async () => fakeVector('x'))
  const cursor = new EmbedSweepCursor({ clip: recordingClip(), vestigiorum: store })

  const items = []
  for (let i = 0; i < 3; i++) {
    const v = await seedTrace(store, MINE, `prompt ${i}`)
    items.push({ id: v.id, textum: `prompt ${i}` })
  }
  const aditus = { per: 'promptum', _owner: sweepOwnerToken(MINE), _sweep: items }

  const reserved = await cursor.reserve(MODUS_EMBED_SWEEP, aditus)
  assert.equal(reserved, 3n * EMBED_SWEEP_IMPETUS_PER_ITEM)

  const result = await cursor.run(sweepActum(aditus, reserved))
  const settled = (result as { exitus: { impetus: bigint } }).exitus.impetus
  assert.ok(settled <= reserved, 'run().impetus ≤ reserve() — the two-phase cost contract')
})

test('reserve: a run whose reservation is below the work is clamped to what was locked', async () => {
  const store = new MemoryVestigiorum(async () => fakeVector('x'))
  const cursor = new EmbedSweepCursor({ clip: recordingClip(), vestigiorum: store })

  const items = []
  for (let i = 0; i < 5; i++) {
    const v = await seedTrace(store, MINE, `prompt ${i}`)
    items.push({ id: v.id, textum: `prompt ${i}` })
  }

  // A deliberately under-reserved actum: the settlement may never exceed the lock.
  const result = await cursor.run(sweepActum(
    { per: 'promptum', _owner: sweepOwnerToken(MINE), _sweep: items }, 2n,
  ))
  assert.equal((result as { exitus: { impetus: bigint } }).exitus.impetus, 2n)
})

test('reserve: a sweep with no owner is refused before anything is locked', async () => {
  const cursor = new EmbedSweepCursor({ clip: recordingClip(), vestigiorum: new MemoryVestigiorum() })
  await assert.rejects(
    () => cursor.reserve(MODUS_EMBED_SWEEP, { per: 'promptum', _sweep: [{ id: 'v1', textum: 'x' }] }),
    /no owner on the run/,
  )
})

test('reserve: a sweep above the per-pass cap is refused before anything is locked', async () => {
  const cursor = new EmbedSweepCursor({ clip: recordingClip(), vestigiorum: new MemoryVestigiorum() })
  const items = Array.from({ length: MAX_SWEEP_ITEMS + 1 }, (_, i) => ({ id: `v${i}`, textum: `t${i}` }))
  await assert.rejects(
    () => cursor.reserve(MODUS_EMBED_SWEEP, { per: 'promptum', _owner: sweepOwnerToken(MINE), _sweep: items }),
    /per-sweep cap/,
  )
})

// ── The run entry point: whose work a sweep gets ─────────────────────────────

interface BoundaryHarness {
  api: CrystalApi
  dispatched: () => Inceptio | undefined
}

/** A CrystalApi whose dispatch is a probe: the Inceptio is captured, never run. */
function boundaryApi(store: MemoryVestigiorum): BoundaryHarness {
  let captured: Inceptio | undefined
  const deps = {
    modorum: { async find(id: string) { return id === MODUS_EMBED_SWEEP.id ? MODUS_EMBED_SWEEP : null } },
    cursorum: { resolve: () => ({ async reserve() { return 0n } }) },
    inceptor: {
      async initiate(inceptio: Inceptio): Promise<Actum> {
        captured = inceptio
        throw new Error('reached-dispatch')
      },
    },
    completor: {}, actorum: {},
    vestigiorum: store,
  } as unknown as CrystalApiDeps
  return { api: new CrystalApi(deps), dispatched: () => captured }
}

test('entry point: the sweep is stamped with the caller’s own backlog', async () => {
  const store = new MemoryVestigiorum(async () => fakeVector('x'))
  const mine = await seedTrace(store, MINE, 'mine')
  await seedTrace(store, THEIRS, 'theirs')
  const { api, dispatched } = boundaryApi(store)

  await assert.rejects(
    () => api.invokeFlow(MINE, { modusId: MODUS_EMBED_SWEEP.id }, { limit: 10 }),
    /reached-dispatch/,
  )

  const aditus = dispatched()?.aditus as { _owner: string; _sweep: Array<{ id: string }> }
  assert.equal(aditus._owner, sweepOwnerToken(MINE))
  assert.deepEqual(aditus._sweep.map(i => i.id), [mine.id], 'only my own trace travels with the run')
})

test('entry point: a body naming another identity’s work is dropped unread', async () => {
  const store = new MemoryVestigiorum(async () => fakeVector('x'))
  const mine = await seedTrace(store, MINE, 'mine')
  const theirs = await seedTrace(store, THEIRS, 'theirs')
  const { api, dispatched } = boundaryApi(store)

  await assert.rejects(
    () => api.invokeFlow(MINE, { modusId: MODUS_EMBED_SWEEP.id }, {
      limit: 10,
      _owner: sweepOwnerToken(THEIRS),
      _sweep: [{ id: theirs.id, textum: 'theirs' }],
    }),
    /reached-dispatch/,
  )

  const aditus = dispatched()?.aditus as { _owner: string; _sweep: Array<{ id: string }> }
  assert.equal(aditus._owner, sweepOwnerToken(MINE), 'the forged owner never reaches the run')
  assert.deepEqual(aditus._sweep.map(i => i.id), [mine.id], 'nor do the traces it named')
})

test('entry point: a caller with nothing to sweep is refused, and no run is created', async () => {
  const store = new MemoryVestigiorum(async () => fakeVector('x'))
  const v = await seedTrace(store, MINE, 'mine')
  await store.setEmbedding(v.id, MINE, 'promptum', fakeVector('mine'))
  const { api, dispatched } = boundaryApi(store)

  await assert.rejects(
    () => api.invokeFlow(MINE, { modusId: MODUS_EMBED_SWEEP.id }, {}),
    (err: unknown) => {
      assert.ok(err instanceof ApiError)
      assert.equal(err.code, 'conflict.nothing_to_sweep')
      assert.equal(err.httpStatus, 409)
      return true
    },
  )
  assert.equal(dispatched(), undefined, 'nothing was dispatched, so nothing was reserved')
})

test('entry point: a purse bearer names no trail, and is refused', async () => {
  const store = new MemoryVestigiorum(async () => fakeVector('x'))
  await seedTrace(store, MINE, 'mine')
  const { api, dispatched } = boundaryApi(store)

  await assert.rejects(
    () => api.invokeFlow({ bursaToken: 'purse-1' }, { modusId: MODUS_EMBED_SWEEP.id }, {}),
    (err: unknown) => {
      assert.ok(err instanceof ApiError)
      assert.equal(err.code, 'auth.forbidden')
      return true
    },
  )
  assert.equal(dispatched(), undefined)
})

test('entry point: the pass is capped however large a limit is asked for', async () => {
  const store = new MemoryVestigiorum(async () => fakeVector('x'))
  for (let i = 0; i < 3; i++) await seedTrace(store, MINE, `prompt ${i}`)
  const { api, dispatched } = boundaryApi(store)

  await assert.rejects(
    () => api.invokeFlow(MINE, { modusId: MODUS_EMBED_SWEEP.id }, { limit: 10_000 }),
    /reached-dispatch/,
  )
  assert.equal((dispatched()?.aditus as { limit: number }).limit, MAX_SWEEP_ITEMS)
})

// ── The whole rail: reserve, dispatch, settle — once ─────────────────────────

test('rail: a sweep reserves, runs and settles for what it embedded', async () => {
  const signorum = new MemorySignorum()
  const acta = new MemoryActorum()
  const modorum = new MemoryModorum()
  const cursorum = new Cursorum()
  const nexus = new Nexus()
  const traces = new MemoryVestigiorum(async () => fakeVector('x'))

  await modorum.register(MODUS_EMBED_SWEEP)
  cursorum.register(EMBED_SWEEP_MINISTERIUM, new EmbedSweepCursor({
    clip: recordingClip(), vestigiorum: traces,
  }))
  await signorum.issue({ animaId: MINE.animaId, forma: 'minted', valor: 1000n, auctor: 'test' })

  const items = []
  for (let i = 0; i < 4; i++) {
    const v = await seedTrace(traces, MINE, `prompt ${i}`)
    items.push({ id: v.id, textum: `prompt ${i}` })
  }

  const inceptor = new ActumInceptor({ modorum, cursorum, signorum, acta })
  const completor = new ActumCompletor({ acta, signorum, nexus })

  const before = await signorum.balance(MINE)
  const { actum } = await dispatchInceptio({ inceptor, modorum, cursorum, completor }, {
    modusId: MODUS_EMBED_SWEEP.id,
    aditus: { per: 'promptum', _owner: sweepOwnerToken(MINE), _sweep: items },
    by: MINE,
  })

  const settled = await acta.findById(actum.id)
  assert.equal(settled?.status, 'completus')
  assert.equal(settled?.impetus, 4n * EMBED_SWEEP_IMPETUS_PER_ITEM, 'settled at the real cost')
  assert.equal(await signorum.balance(MINE), before - 4n * EMBED_SWEEP_IMPETUS_PER_ITEM)
  assert.equal((await traces.backlogCount(MINE)).promptum, 0, 'the backlog is worked off')
})

test('rail: a settled sweep cannot be settled again — double-completion is rejected', async () => {
  const signorum = new MemorySignorum()
  const acta = new MemoryActorum()
  const modorum = new MemoryModorum()
  const cursorum = new Cursorum()
  const nexus = new Nexus()
  const traces = new MemoryVestigiorum(async () => fakeVector('x'))

  await modorum.register(MODUS_EMBED_SWEEP)
  cursorum.register(EMBED_SWEEP_MINISTERIUM, new EmbedSweepCursor({
    clip: recordingClip(), vestigiorum: traces,
  }))
  await signorum.issue({ animaId: MINE.animaId, forma: 'minted', valor: 1000n, auctor: 'test' })

  const v = await seedTrace(traces, MINE, 'only one')
  const inceptor = new ActumInceptor({ modorum, cursorum, signorum, acta })
  const completor = new ActumCompletor({ acta, signorum, nexus })

  const { actum } = await dispatchInceptio({ inceptor, modorum, cursorum, completor }, {
    modusId: MODUS_EMBED_SWEEP.id,
    aditus: { per: 'promptum', _owner: sweepOwnerToken(MINE), _sweep: [{ id: v.id, textum: 'only one' }] },
    by: MINE,
  })

  const afterFirst = await signorum.balance(MINE)
  await assert.rejects(
    () => completor.complete(actum, { exitus: { embedded: 1, skipped: 0, per: 'promptum' }, impetus: 1n }),
    /already completus/,
  )
  assert.equal(await signorum.balance(MINE), afterFirst, 'the second settlement charges nothing')
})
