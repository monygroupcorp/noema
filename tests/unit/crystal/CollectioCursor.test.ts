import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Collectio } from '../../../src/types/collectio.js'
import type { Actum, ActumStatus } from '../../../src/types/actum.js'
import type { Actorum, Inceptio } from '../../../src/types/cursus.js'
import type { Collectionum } from '../../../src/types/collectio.js'
import { CollectioCursor } from '../../../src/crystal/CollectioCursor.js'
import { selectForPiece } from '../../../src/crystal/TraitMixer.js'
import { dispatchInceptio } from '../../../src/execution/dispatchInceptio.js'
import type { DispatchDeps } from '../../../src/execution/dispatchInceptio.js'
import type { Tractus } from '../../../src/types/collectio.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCollectio(overrides: Partial<Collectio> = {}): Collectio {
  return {
    id: 'col-1',
    modusId: 'flux-schnell',
    aditusBase: {},
    tractus: [],
    numerus: 3,
    provenanceHash: 'sha256:test',
    by: { animaId: 'anima-1' },
    acta: [],
    completae: 0,
    fractae: 0,
    pendentes: 0,
    reiectae: 0,
    concurrentia: 2,
    impetusTotal: 0n,
    status: 'nascens',
    natum: new Date(),
    ...overrides,
  }
}

interface CollectionumStub extends Collectionum {
  updates: Array<{ id: string; patch: Partial<Collectio> }>
  store: Map<string, Collectio>
}

function makeCollectionum(initial?: Collectio): CollectionumStub {
  const store = new Map<string, Collectio>()
  if (initial) store.set(initial.id, { ...initial })

  const updates: Array<{ id: string; patch: Partial<Collectio> }> = []

  return {
    updates,
    store,
    async find(id: string) {
      return store.get(id) ?? null
    },
    async list(filter?: Partial<Collectio>) {
      const all = [...store.values()]
      if (!filter?.status) return all
      return all.filter(c => c.status === filter.status)
    },
    async listByStatus(status: Collectio['status']) {
      return [...store.values()].filter(c => c.status === status)
    },
    async create(input) {
      const c = { ...input, id: 'col-auto', natum: new Date(), acta: [], completae: 0, fractae: 0, pendentes: 0, reiectae: 0, impetusTotal: 0n } as Collectio
      store.set(c.id, c)
      return c
    },
    async update(id: string, patch: Partial<Collectio>) {
      updates.push({ id, patch })
      const existing = store.get(id)
      if (!existing) throw new Error(`Collectio '${id}' not found`)
      const updated = { ...existing, ...patch }
      store.set(id, updated)
      return updated
    },
  }
}

interface ActorumStub extends Actorum {
  updates: Array<{ id: string; patch: Partial<Actum> }>
  store: Map<string, Actum>
}

function makeActorum(): ActorumStub {
  const store = new Map<string, Actum>()
  const updates: Array<{ id: string; patch: Partial<Actum> }> = []

  return {
    updates,
    store,
    async create(actum) {
      const a = { ...actum, inceptum: new Date() } as Actum
      store.set(a.id, a)
      return a
    },
    async update(id: string, patch: Partial<Actum>) {
      updates.push({ id, patch })
      const existing = store.get(id)
      if (!existing) throw new Error(`Actum '${id}' not found`)
      const updated = { ...existing, ...patch } as Actum
      store.set(id, updated)
      return updated
    },
    async findById(id: string) {
      return store.get(id) ?? null
    },
    async findByExternusJobId() {
      return null
    },
    async findExpired() {
      return []
    },
    // The rest of the Actorum surface. The collectio cursor drives create/update/findById
    // only, so these are unreached here and throw rather than return a plausible default.
    async findByCallbackNonce(): Promise<Actum | null> {
      throw new Error('ActorumStub.findByCallbackNonce: not implemented for this suite')
    },
    async findByNullifier(): Promise<Actum | null> {
      throw new Error('ActorumStub.findByNullifier: not implemented for this suite')
    },
    async findInFlight(): Promise<Actum[]> {
      throw new Error('ActorumStub.findInFlight: not implemented for this suite')
    },
    async findByCompositum(): Promise<Actum[]> {
      throw new Error('ActorumStub.findByCompositum: not implemented for this suite')
    },
  }
}

interface DispatchStub {
  dispatch(inceptio: Inceptio): Promise<{ actum: Actum }>
  calls: Inceptio[]
  actorum: ActorumStub
  _counter: number
}

// The cursor now takes a `dispatch` fn (initiate + RUN). This stub mimics an ASYNC pod:
// it creates the actum (nascens) and returns it with NO exitus, so the piece stays in
// `running` until the test drives onActumCompleta (the webhook path these tests exercise).
function makeInceptor(actumIdPrefix = 'actum'): DispatchStub {
  let counter = 0
  const actorum = makeActorum()

  const stub: DispatchStub = {
    calls: [] as Inceptio[],
    actorum,
    _counter: 0,
    async dispatch(inceptio: Inceptio): Promise<{ actum: Actum }> {
      stub.calls.push(inceptio)
      const id = `${actumIdPrefix}-${counter++}`
      stub._counter = counter
      const actum: Actum = {
        id,
        modusId: inceptio.modusId,
        modusVersiono: '1',
        aditus: inceptio.aditus,
        status: 'nascens' as ActumStatus,
        impetus: 0n,
        signaConsumed: [],
        inceptum: new Date(),
        expirat: new Date(Date.now() + 60_000),
      }
      actorum.store.set(id, actum)
      return { actum }
    },
  }

  return stub
}

// ── Test 1: start() marks Collectio agens ────────────────────────────────────

test('start() marks Collectio agens', async () => {
  const collectio = makeCollectio({ numerus: 3, concurrentia: 2 })
  const collectiones = makeCollectionum(collectio)
  const inceptor = makeInceptor()
  const cursor = new CollectioCursor(
    inceptor.dispatch,
    collectiones,
    inceptor.actorum,
    {},
  )

  await cursor.start(collectio)

  const agensUpdate = collectiones.updates.find(u => u.patch.status === 'agens')
  assert.ok(agensUpdate, 'should have called update with status: agens')
  assert.equal(agensUpdate.id, 'col-1')
})

// ── Test 2: start() dispatches up to concurrentia pieces ─────────────────────

test('start() dispatches up to concurrentia pieces', async () => {
  const collectio = makeCollectio({ numerus: 5, concurrentia: 2 })
  const collectiones = makeCollectionum(collectio)
  const inceptor = makeInceptor()
  const cursor = new CollectioCursor(
    inceptor.dispatch,
    collectiones,
    inceptor.actorum,
    {},
  )

  await cursor.start(collectio)

  assert.equal(inceptor.calls.length, 2, 'should dispatch exactly 2 pieces (concurrentia)')
})

// ── Test 3: start() with numerus: 1 ─────────────────────────────────────────

test('start() with numerus: 1 dispatches exactly 1 piece', async () => {
  const collectio = makeCollectio({ numerus: 1, concurrentia: 3 })
  const collectiones = makeCollectionum(collectio)
  const inceptor = makeInceptor()
  const cursor = new CollectioCursor(
    inceptor.dispatch,
    collectiones,
    inceptor.actorum,
    {},
  )

  await cursor.start(collectio)

  assert.equal(inceptor.calls.length, 1, 'should dispatch exactly 1 piece')
})

// ── Test 4: onActumCompleta() dispatches next piece when slot opens ───────────

test('onActumCompleta() dispatches next piece when slot opens', async () => {
  const collectio = makeCollectio({ numerus: 5, concurrentia: 2 })
  const collectiones = makeCollectionum(collectio)
  const inceptor = makeInceptor()
  const cursor = new CollectioCursor(
    inceptor.dispatch,
    collectiones,
    inceptor.actorum,
    {},
  )

  await cursor.start(collectio)
  assert.equal(inceptor.calls.length, 2)

  const firstActumId = inceptor.calls[0] && 'actum-0'
  await cursor.onActumCompleta('col-1', firstActumId, true)

  assert.equal(inceptor.calls.length, 3, 'should dispatch 3rd piece after first completes')
})

// ── Test 5: onActumCompleta() does NOT dispatch when paused ──────────────────

test('onActumCompleta() does NOT dispatch when paused', async () => {
  const collectio = makeCollectio({ numerus: 5, concurrentia: 2 })
  const collectiones = makeCollectionum(collectio)
  const inceptor = makeInceptor()
  const cursor = new CollectioCursor(
    inceptor.dispatch,
    collectiones,
    inceptor.actorum,
    {},
  )

  await cursor.start(collectio)
  assert.equal(inceptor.calls.length, 2)

  await cursor.pause('col-1')
  await cursor.onActumCompleta('col-1', 'actum-0', true)

  assert.equal(inceptor.calls.length, 2, 'should NOT dispatch while paused')
})

// ── Test 6: resume() dispatches pending pieces ───────────────────────────────

test('resume() dispatches pending pieces after pause', async () => {
  const collectio = makeCollectio({ numerus: 5, concurrentia: 2 })
  const collectiones = makeCollectionum(collectio)
  const inceptor = makeInceptor()
  const cursor = new CollectioCursor(
    inceptor.dispatch,
    collectiones,
    inceptor.actorum,
    {},
  )

  await cursor.start(collectio)
  await cursor.pause('col-1')
  await cursor.onActumCompleta('col-1', 'actum-0', true)
  assert.equal(inceptor.calls.length, 2)

  await cursor.resume('col-1')
  assert.equal(inceptor.calls.length, 3, 'should dispatch after resume')
})

// ── Test 7: onActumCompleta(success: false) increments fractae ───────────────

test('onActumCompleta(success: false) increments fractae', async () => {
  const collectio = makeCollectio({ numerus: 3, concurrentia: 2 })
  const collectiones = makeCollectionum(collectio)
  const inceptor = makeInceptor()
  const cursor = new CollectioCursor(
    inceptor.dispatch,
    collectiones,
    inceptor.actorum,
    {},
  )

  await cursor.start(collectio)
  await cursor.onActumCompleta('col-1', 'actum-0', false)

  const fractaeUpdate = collectiones.updates.find(u => u.patch.fractae !== undefined)
  assert.ok(fractaeUpdate, 'should update fractae')
  assert.equal(fractaeUpdate.patch.fractae, 1)
})

// ── Test 8: onActumCompleta(success: true) without review increments completae

test('onActumCompleta(success: true) without review increments completae', async () => {
  const collectio = makeCollectio({ numerus: 3, concurrentia: 2 })
  const collectiones = makeCollectionum(collectio)
  const inceptor = makeInceptor()
  const cursor = new CollectioCursor(
    inceptor.dispatch,
    collectiones,
    inceptor.actorum,
    {},
  )

  await cursor.start(collectio)
  await cursor.onActumCompleta('col-1', 'actum-0', true)

  const completaeUpdate = collectiones.updates.find(u => u.patch.completae !== undefined)
  assert.ok(completaeUpdate, 'should update completae')
  assert.equal(completaeUpdate.patch.completae, 1)
})

// ── Test 9: Collectio marked completa when all pieces done (no review) ────────

test('Collectio marked completa when all 3 pieces done', async () => {
  const collectio = makeCollectio({ numerus: 3, concurrentia: 3 })
  const collectiones = makeCollectionum(collectio)
  const inceptor = makeInceptor()
  const cursor = new CollectioCursor(
    inceptor.dispatch,
    collectiones,
    inceptor.actorum,
    {},
  )

  await cursor.start(collectio)
  // 3 pieces dispatched (concurrentia=3, numerus=3)
  assert.equal(inceptor.calls.length, 3)

  await cursor.onActumCompleta('col-1', 'actum-0', true)
  await cursor.onActumCompleta('col-1', 'actum-1', true)
  await cursor.onActumCompleta('col-1', 'actum-2', true)

  const completaUpdate = collectiones.updates.find(u => u.patch.status === 'completa')
  assert.ok(completaUpdate, 'should mark collectio as completa')
})

// ── Test 10: reviewEnabled — completion sets reviewOutcome: 'pending' on actum exitus

test('reviewEnabled: completion sets reviewOutcome pending on actum exitus', async () => {
  const collectio = makeCollectio({ numerus: 3, concurrentia: 2 })
  const collectiones = makeCollectionum(collectio)
  const inceptor = makeInceptor()
  const actorum = inceptor.actorum
  const cursor = new CollectioCursor(
    inceptor.dispatch,
    collectiones,
    actorum,
    { reviewEnabled: true },
  )

  await cursor.start(collectio)
  await cursor.onActumCompleta('col-1', 'actum-0', true)

  const exitusPatch = actorum.updates.find(u => u.patch.exitus?.reviewOutcome === 'pending')
  assert.ok(exitusPatch, 'should set reviewOutcome: pending on actum exitus')
  assert.equal(exitusPatch.id, 'actum-0')
})

// ── Test 11: reviewEnabled — completion does NOT increment completae until approveActum

test('reviewEnabled: completion does NOT increment completae until approveActum()', async () => {
  const collectio = makeCollectio({ numerus: 3, concurrentia: 2 })
  const collectiones = makeCollectionum(collectio)
  const inceptor = makeInceptor()
  const cursor = new CollectioCursor(
    inceptor.dispatch,
    collectiones,
    inceptor.actorum,
    { reviewEnabled: true },
  )

  await cursor.start(collectio)
  await cursor.onActumCompleta('col-1', 'actum-0', true)

  const completaeUpdate = collectiones.updates.find(u => u.patch.completae !== undefined)
  assert.equal(completaeUpdate, undefined, 'should NOT increment completae before approval')
})

// ── Per-collection reviewEnabled overrides the cursor's global default

test('per-collection reviewEnabled:false overrides a global review-on default → auto-counts', async () => {
  const collectio = makeCollectio({ numerus: 3, concurrentia: 2, reviewEnabled: false })
  const collectiones = makeCollectionum(collectio)
  const inceptor = makeInceptor()
  // Global default is ON, but this collection opted OUT.
  const cursor = new CollectioCursor(inceptor.dispatch, collectiones, inceptor.actorum, { reviewEnabled: true })

  await cursor.start(collectio)
  await cursor.onActumCompleta('col-1', 'actum-0', true)

  const completaeUpdate = collectiones.updates.find(u => u.patch.completae !== undefined)
  assert.equal(completaeUpdate?.patch.completae, 1, 'opting out counts the piece immediately')
  assert.equal(inceptor.actorum.updates.find(u => u.patch.exitus?.reviewOutcome === 'pending'), undefined, 'no pending review')
})

test('per-collection reviewEnabled:true overrides a global review-off default → holds for review', async () => {
  const collectio = makeCollectio({ numerus: 3, concurrentia: 2, reviewEnabled: true })
  const collectiones = makeCollectionum(collectio)
  const inceptor = makeInceptor()
  // Global default is OFF, but this collection opted IN.
  const cursor = new CollectioCursor(inceptor.dispatch, collectiones, inceptor.actorum, { reviewEnabled: false })

  await cursor.start(collectio)
  await cursor.onActumCompleta('col-1', 'actum-0', true)

  assert.equal(collectiones.updates.find(u => u.patch.completae !== undefined), undefined, 'opting in holds the piece')
  const exitusPatch = inceptor.actorum.updates.find(u => u.patch.exitus?.reviewOutcome === 'pending')
  assert.ok(exitusPatch, 'sets reviewOutcome: pending')
})

// ── Test 12: reviewEnabled — approveActum() increments completae and dispatches next

test('reviewEnabled: approveActum() increments completae and dispatches next piece', async () => {
  const collectio = makeCollectio({ numerus: 5, concurrentia: 2 })
  const collectiones = makeCollectionum(collectio)
  const inceptor = makeInceptor()
  const actorum = inceptor.actorum
  const cursor = new CollectioCursor(
    inceptor.dispatch,
    collectiones,
    actorum,
    { reviewEnabled: true },
  )

  await cursor.start(collectio)
  assert.equal(inceptor.calls.length, 2)

  await cursor.onActumCompleta('col-1', 'actum-0', true)
  // actum-0 → pendingReview; running.size=1 < concurrentia=2, so piece 2 dispatched immediately
  assert.equal(inceptor.calls.length, 3, 'should dispatch next piece as soon as running slot opens, not waiting for review')

  await cursor.approveActum('col-1', 'actum-0')

  // completae should now be incremented
  const completaeUpdate = collectiones.updates.find(u => u.patch.completae !== undefined)
  assert.ok(completaeUpdate, 'should increment completae after approval')
  assert.equal(completaeUpdate.patch.completae, 1)

  // running is full (actum-1, actum-2) so no new piece on approval
  assert.equal(inceptor.calls.length, 3, 'no additional dispatch on approval since running is already at concurrentia')
})

// ── Test 13: reviewEnabled — Collectio not completa while pendingReview non-empty

test('reviewEnabled: Collectio NOT marked completa while pendingReview non-empty', async () => {
  const collectio = makeCollectio({ numerus: 2, concurrentia: 2 })
  const collectiones = makeCollectionum(collectio)
  const inceptor = makeInceptor()
  const cursor = new CollectioCursor(
    inceptor.dispatch,
    collectiones,
    inceptor.actorum,
    { reviewEnabled: true },
  )

  await cursor.start(collectio)
  // Both pieces dispatched
  assert.equal(inceptor.calls.length, 2)

  // Both complete but in review
  await cursor.onActumCompleta('col-1', 'actum-0', true)
  await cursor.onActumCompleta('col-1', 'actum-1', true)

  const completaUpdate = collectiones.updates.find(u => u.patch.status === 'completa')
  assert.equal(completaUpdate, undefined, 'should NOT be completa while pending review')
})

// ── Test 14: rejectAndRevive() sets reviewOutcome: 'rejected' on original actum

test('rejectAndRevive() sets reviewOutcome: rejected on original actum', async () => {
  const collectio = makeCollectio({ numerus: 3, concurrentia: 2 })
  const collectiones = makeCollectionum(collectio)
  const inceptor = makeInceptor()
  const actorum = inceptor.actorum
  const cursor = new CollectioCursor(
    inceptor.dispatch,
    collectiones,
    actorum,
    { reviewEnabled: true },
  )

  await cursor.start(collectio)
  await cursor.onActumCompleta('col-1', 'actum-0', true)
  await cursor.rejectAndRevive('col-1', 'actum-0')

  const rejectedPatch = actorum.updates.find(
    u => u.id === 'actum-0' && u.patch.exitus?.reviewOutcome === 'rejected',
  )
  assert.ok(rejectedPatch, 'should set reviewOutcome: rejected on original actum')
})

// ── Test 15: rejectAndRevive() dispatches a new piece (revive) ────────────────

test('rejectAndRevive() dispatches a new piece', async () => {
  const collectio = makeCollectio({ numerus: 3, concurrentia: 2 })
  const collectiones = makeCollectionum(collectio)
  const inceptor = makeInceptor()
  const cursor = new CollectioCursor(
    inceptor.dispatch,
    collectiones,
    inceptor.actorum,
    { reviewEnabled: true },
  )

  await cursor.start(collectio)
  const callsBefore = inceptor.calls.length
  await cursor.onActumCompleta('col-1', 'actum-0', true)
  await cursor.rejectAndRevive('col-1', 'actum-0')

  assert.ok(inceptor.calls.length > callsBefore, 'should dispatch a new piece on revive')
})

// ── Test 16: rejectAndRevive() uses pieceIndex beyond numerus ─────────────────

test('rejectAndRevive() new piece _pieceIndex is >= collectio.numerus', async () => {
  const collectio = makeCollectio({ numerus: 3, concurrentia: 2 })
  const collectiones = makeCollectionum(collectio)
  const inceptor = makeInceptor()
  const cursor = new CollectioCursor(
    inceptor.dispatch,
    collectiones,
    inceptor.actorum,
    { reviewEnabled: true },
  )

  await cursor.start(collectio)
  // Complete both in-flight pieces and send first to review
  await cursor.onActumCompleta('col-1', 'actum-0', true)  // in review
  await cursor.onActumCompleta('col-1', 'actum-1', true)  // in review
  // at this point nextIndex = 2 (only 2 dispatched initially since concurrentia=2)
  // but third piece was dispatched after first completed... let's track more carefully

  // After start: dispatched 0, 1 (concurrentia=2)
  // After onActumCompleta('actum-0', true): review, dispatch piece 2 → running={1,2}
  // After onActumCompleta('actum-1', true): review, running={2}, nextIndex=3 ≥ numerus, no dispatch

  // Reject actum-0 → revive with pieceIndex = nextIndex (3 = numerus + 0) → ≥ numerus
  await cursor.rejectAndRevive('col-1', 'actum-0')

  // The revive piece should be the most recently initiated
  const lastCall = inceptor.calls[inceptor.calls.length - 1]
  const revivePieceIndex = lastCall.aditus._pieceIndex as number
  assert.ok(revivePieceIndex >= 3, `_pieceIndex ${revivePieceIndex} should be >= numerus (3)`)
})

// ── Test 16b: rejectAndRevive() bumps reiectae, NOT fractae ───────────────────

test('rejectAndRevive() counts the piece as reiectae (rejected), never fractae (failed)', async () => {
  const collectio = makeCollectio({ numerus: 3, concurrentia: 2 })
  const collectiones = makeCollectionum(collectio)
  const inceptor = makeInceptor()
  const cursor = new CollectioCursor(inceptor.dispatch, collectiones, inceptor.actorum, { reviewEnabled: true })

  await cursor.start(collectio)
  await cursor.onActumCompleta('col-1', 'actum-0', true) // → pending review
  await cursor.rejectAndRevive('col-1', 'actum-0')

  const reiectaeUpdate = collectiones.updates.find(u => u.patch.reiectae !== undefined)
  assert.ok(reiectaeUpdate, 'reject should bump reiectae')
  assert.equal(reiectaeUpdate.patch.reiectae, 1)
  assert.ok(
    !collectiones.updates.some(u => u.patch.fractae !== undefined),
    'reject must NOT touch fractae (that is for genuine generation failures)',
  )
})

// ── Test 16c: early reject does NOT skip undispatched original pieces ──────────

test('rejectAndRevive() before all originals dispatch does not skip any (no index gap)', async () => {
  // concurrentia: 1 forces pieces to dispatch one-at-a-time, so a reject can land
  // while originals (index 2) are still undispatched — the case the old nextIndex
  // bump silently skipped.
  const collectio = makeCollectio({ numerus: 3, concurrentia: 1 })
  const collectiones = makeCollectionum(collectio)
  const inceptor = makeInceptor()
  const cursor = new CollectioCursor(inceptor.dispatch, collectiones, inceptor.actorum, { reviewEnabled: true })

  await cursor.start(collectio)                            // dispatch piece 0
  await cursor.onActumCompleta('col-1', 'actum-0', true)   // pending; dispatch piece 1
  await cursor.rejectAndRevive('col-1', 'actum-0')         // reject early (piece 2 not yet dispatched)
  await cursor.onActumCompleta('col-1', 'actum-1', true)   // pending; dispatch piece 2 (NOT skipped)
  await cursor.onActumCompleta('col-1', 'actum-2', true)   // pending; dispatch piece 3 (the replacement)
  await cursor.onActumCompleta('col-1', 'actum-3', true)   // pending; budget exhausted

  const indexes = inceptor.calls.map(c => c.aditus._pieceIndex as number).sort((a, b) => a - b)
  assert.deepEqual(indexes, [0, 1, 2, 3], 'every original (0,1,2) plus one replacement (3) — nothing skipped')
})

// ── Test 17: TraitMixer integration ──────────────────────────────────────────

test('TraitMixer integration: dispatched aditus.prompt matches selectForPiece output', async () => {
  const tractus: Tractus[] = [
    {
      porta: 'background',
      valores: [{ value: 'desert', label: 'Desert', rarity: 1, promptFragment: 'vast desert scene' }],
    },
  ]
  const collectio = makeCollectio({
    numerus: 1,
    concurrentia: 1,
    tractus,
    aditusBase: { _basePrompt: 'photorealistic' },
  })
  const collectiones = makeCollectionum(collectio)
  const inceptor = makeInceptor()
  const cursor = new CollectioCursor(
    inceptor.dispatch,
    collectiones,
    inceptor.actorum,
    {},
  )

  await cursor.start(collectio)

  const expected = selectForPiece({
    tractus,
    pieceIndex: 0,
    basePrompt: 'photorealistic',
    collectionName: collectio.nomen,
    totalPieces: 1,
  })

  assert.equal(inceptor.calls.length, 1)
  assert.equal(inceptor.calls[0].aditus.prompt, expected.prompt)
})

// ── Test 17b: an axis that varies the `prompt` port keeps its value ───────────
// An axis declared with `porta: 'prompt'` writes the winning `valor.value` onto
// `selection.aditus.prompt`. The assembled prompt (basePrompt + promptFragments) is the
// value for collections whose axes vary other ports; it stands in only when the axes left
// `prompt` unset, so an axis that does set it reaches the dispatched piece intact.

test("a porta:'prompt' axis's winning valor.value reaches the dispatched piece's aditus.prompt unclobbered", async () => {
  const tractus: Tractus[] = [
    {
      porta: 'prompt',
      label: 'Prompt',
      valores: [
        { value: 'a lone lighthouse at dusk, cinematic lighting', label: 'Lighthouse', rarity: 1 },
        { value: 'a neon city street in rain, reflections', label: 'Neon street', rarity: 1 },
        { value: 'a quiet forest clearing, morning mist', label: 'Forest clearing', rarity: 1 },
      ],
    },
  ]
  const collectio = makeCollectio({
    numerus: 3,
    concurrentia: 3,
    tractus,
    // No `_basePrompt`: nothing to assemble, so the earlier merge produced an empty prompt.
    aditusBase: {},
  })
  const collectiones = makeCollectionum(collectio)
  const inceptor = makeInceptor()
  const cursor = new CollectioCursor(
    inceptor.dispatch,
    collectiones,
    inceptor.actorum,
    {},
  )

  await cursor.start(collectio)

  assert.equal(inceptor.calls.length, 3)
  const values = new Set(tractus[0].valores.map((v) => v.value))
  for (const call of inceptor.calls) {
    const prompt = call.aditus.prompt
    assert.equal(typeof prompt, 'string')
    assert.notEqual(prompt, '', 'the axis value must not be replaced by the empty assembled prompt')
    assert.ok(values.has(prompt as string), `dispatched prompt should be one of the axis values, got ${String(prompt)}`)
  }

  // The point of the seeded config: several pieces, several distinct prompts.
  const distinct = new Set(inceptor.calls.map((c) => c.aditus.prompt as string))
  assert.ok(distinct.size > 1, 'equal-rarity values across 3 pieces should produce more than one prompt')
})

// ── Test 18: aditus merges aditusBase with selection ─────────────────────────

test('aditus merges aditusBase fields into each dispatched inceptio', async () => {
  const collectio = makeCollectio({
    numerus: 1,
    concurrentia: 1,
    aditusBase: { width: 512, height: 768 },
  })
  const collectiones = makeCollectionum(collectio)
  const inceptor = makeInceptor()
  const cursor = new CollectioCursor(
    inceptor.dispatch,
    collectiones,
    inceptor.actorum,
    {},
  )

  await cursor.start(collectio)

  assert.equal(inceptor.calls.length, 1)
  assert.equal(inceptor.calls[0].aditus.width, 512)
  assert.equal(inceptor.calls[0].aditus.height, 768)
})

// ── Test 19: _pieceIndex and _attributes are injected into aditus ─────────────

test('_pieceIndex and _attributes are injected into dispatched aditus', async () => {
  const tractus: Tractus[] = [
    {
      porta: 'style',
      label: 'Style',
      valores: [{ value: 'impressionist', label: 'Impressionist', rarity: 1 }],
    },
  ]
  const collectio = makeCollectio({
    numerus: 1,
    concurrentia: 1,
    tractus,
  })
  const collectiones = makeCollectionum(collectio)
  const inceptor = makeInceptor()
  const cursor = new CollectioCursor(
    inceptor.dispatch,
    collectiones,
    inceptor.actorum,
    {},
  )

  await cursor.start(collectio)

  assert.equal(inceptor.calls.length, 1)
  const aditus = inceptor.calls[0].aditus
  assert.equal(aditus._pieceIndex, 0)
  assert.ok(Array.isArray(aditus._attributes), '_attributes should be an array')
  const attrs = aditus._attributes as Array<{ trait_type: string; value: string }>
  assert.equal(attrs[0].trait_type, 'Style')
  assert.equal(attrs[0].value, 'Impressionist')
})

// ── Test 20: reviewEnabled — pendingReview does NOT block concurrentia slots ──

test('reviewEnabled: pendingReview does not block concurrentia — dispatches 2 more after 2 completions', async () => {
  const collectio = makeCollectio({ numerus: 5, concurrentia: 2 })
  const collectiones = makeCollectionum(collectio)
  const inceptor = makeInceptor()
  const cursor = new CollectioCursor(
    inceptor.dispatch,
    collectiones,
    inceptor.actorum,
    { reviewEnabled: true },
  )

  await cursor.start(collectio)
  // start() dispatches 2 pieces (concurrentia=2)
  assert.equal(inceptor.calls.length, 2, 'should dispatch 2 pieces on start')

  // Both complete — they go to pendingReview, NOT blocking new dispatches
  await cursor.onActumCompleta('col-1', 'actum-0', true)
  await cursor.onActumCompleta('col-1', 'actum-1', true)

  // running.size is now 0, pendingReview.size is 2
  // concurrentia check should be: running.size (0) < concurrentia (2) → dispatch 2 more
  assert.equal(
    inceptor.calls.length,
    4,
    'should dispatch 2 more pieces because running.size=0 < concurrentia=2, pendingReview does not count',
  )
})

// ── Tests 23–26: rehydrate() ──────────────────────────────────────────────────

test('rehydrate() restores state for agens collections', async () => {
  // Simulate a collection that was agens at restart time
  const collectio = makeCollectio({
    id: 'col-restart',
    status: 'agens',
    acta: ['actum-r0', 'actum-r1'],
    numerus: 4,
    concurrentia: 2,
  })
  const collectiones = makeCollectionum(collectio)

  // Seed actum store with two in-flight acta
  const actorum = makeActorum()
  const a0: Actum = {
    id: 'actum-r0',
    modusId: 'modus-x',
    modusVersiono: '1',
    aditus: {},
    status: 'nascens',
    impetus: 0n,
    signaConsumed: [],
    inceptum: new Date(),
    expirat: new Date(Date.now() + 60_000),
  }
  const a1: Actum = {
    id: 'actum-r1',
    modusId: 'modus-x',
    modusVersiono: '1',
    aditus: {},
    status: 'agens',
    impetus: 0n,
    signaConsumed: [],
    inceptum: new Date(),
    expirat: new Date(Date.now() + 60_000),
  }
  actorum.store.set('actum-r0', a0)
  actorum.store.set('actum-r1', a1)

  const inceptor = makeInceptor()
  const cursor = new CollectioCursor(
    inceptor.dispatch,
    collectiones,
    actorum,
    {},
  )

  await cursor.rehydrate()

  // After rehydrate, onActumCompleta should work for the restored state
  // Signal that actum-r0 completed — cursor should dispatch next piece
  await cursor.onActumCompleta('col-restart', 'actum-r0', true)
  assert.equal(inceptor.calls.length, 1, 'should dispatch next piece when a running actum completes after rehydrate')
})

test('rehydrate() correctly identifies running vs pending-review acta', async () => {
  const collectio = makeCollectio({
    id: 'col-review',
    status: 'agens',
    acta: ['actum-q0', 'actum-q1', 'actum-q2'],
    numerus: 5,
    concurrentia: 3,
  })
  const collectiones = makeCollectionum(collectio)

  const actorum = makeActorum()
  // actum-q0: completed, pending review
  actorum.store.set('actum-q0', {
    id: 'actum-q0', modusId: 'm', modusVersiono: '1', aditus: {},
    status: 'completus', impetus: 0n, signaConsumed: [],
    inceptum: new Date(), expirat: new Date(Date.now() + 60_000),
    exitus: { reviewOutcome: 'pending' },
  } as Actum)
  // actum-q1: in-flight
  actorum.store.set('actum-q1', {
    id: 'actum-q1', modusId: 'm', modusVersiono: '1', aditus: {},
    status: 'nascens', impetus: 0n, signaConsumed: [],
    inceptum: new Date(), expirat: new Date(Date.now() + 60_000),
  } as Actum)
  // actum-q2: previously rejected (revive)
  actorum.store.set('actum-q2', {
    id: 'actum-q2', modusId: 'm', modusVersiono: '1', aditus: {},
    status: 'fractus', impetus: 0n, signaConsumed: [],
    inceptum: new Date(), expirat: new Date(Date.now() + 60_000),
    exitus: { reviewOutcome: 'rejected' },
  } as Actum)

  const inceptor = makeInceptor()
  const cursor = new CollectioCursor(
    inceptor.dispatch,
    collectiones,
    actorum,
    { reviewEnabled: true },
  )

  await cursor.rehydrate()

  // actum-q1 is running — complete it; since reviewEnabled, it goes to pendingReview
  // and a new piece should be dispatched (running.size 0 < concurrentia 3)
  await cursor.onActumCompleta('col-review', 'actum-q1', true)
  assert.ok(inceptor.calls.length >= 1, 'should dispatch next piece after running actum completes')

  // actum-q0 was pending review — approving it should increment completae
  await cursor.approveActum('col-review', 'actum-q0')
  const completaeUpdate = collectiones.updates.find(u => u.patch.completae !== undefined)
  assert.ok(completaeUpdate, 'approving a rehydrated pending-review actum should increment completae')
})

test('rehydrate() is a no-op when no agens collections exist', async () => {
  const collectio = makeCollectio({ id: 'col-nascens', status: 'nascens' })
  const collectiones = makeCollectionum(collectio)
  const inceptor = makeInceptor()
  const cursor = new CollectioCursor(
    inceptor.dispatch,
    collectiones,
    inceptor.actorum,
    {},
  )

  await cursor.rehydrate()

  // No state loaded — onActumCompleta for an unknown collection is a no-op
  await cursor.onActumCompleta('col-nascens', 'actum-0', true)
  assert.equal(inceptor.calls.length, 0, 'no dispatches after rehydrate with no agens collections')
  assert.equal(collectiones.updates.length, 0, 'no updates after rehydrate with no agens collections')
})

test('after rehydrate, onActumCompleta() dispatches the next piece correctly', async () => {
  // Simulate restart mid-collection: 2 of 5 pieces already dispatched
  // both still running (nascens), nextIndex reconstructed as acta.length = 2
  const collectio = makeCollectio({
    id: 'col-mid',
    status: 'agens',
    acta: ['actum-m0', 'actum-m1'],
    numerus: 5,
    concurrentia: 2,
  })
  const collectiones = makeCollectionum(collectio)

  const actorum = makeActorum()
  actorum.store.set('actum-m0', {
    id: 'actum-m0', modusId: 'm', modusVersiono: '1', aditus: {},
    status: 'nascens', impetus: 0n, signaConsumed: [],
    inceptum: new Date(), expirat: new Date(Date.now() + 60_000),
  } as Actum)
  actorum.store.set('actum-m1', {
    id: 'actum-m1', modusId: 'm', modusVersiono: '1', aditus: {},
    status: 'nascens', impetus: 0n, signaConsumed: [],
    inceptum: new Date(), expirat: new Date(Date.now() + 60_000),
  } as Actum)

  const inceptor = makeInceptor()
  const cursor = new CollectioCursor(
    inceptor.dispatch,
    collectiones,
    actorum,
    {},
  )

  await cursor.rehydrate()

  // Complete actum-m0 — should dispatch piece at index 2 (not 0 or 1)
  await cursor.onActumCompleta('col-mid', 'actum-m0', true)
  assert.equal(inceptor.calls.length, 1, 'should dispatch exactly 1 new piece')
  const dispatched = inceptor.calls[0]
  assert.equal(dispatched.aditus._pieceIndex, 2, 'should dispatch piece at nextIndex=2, not restart from 0')
})

// ── Pause persistence: survives a simulated restart ──────────────────────────

test('pause() persists pausatum on the Collectio record', async () => {
  const collectio = makeCollectio({ numerus: 5, concurrentia: 2 })
  const collectiones = makeCollectionum(collectio)
  const inceptor = makeInceptor()
  const cursor = new CollectioCursor(inceptor.dispatch, collectiones, inceptor.actorum, {})

  await cursor.start(collectio)
  await cursor.pause('col-1')

  const stored = await collectiones.find('col-1')
  assert.ok(stored?.pausatum instanceof Date, 'pausatum should be persisted as a Date')
})

test('resume() clears the persisted pausatum', async () => {
  const collectio = makeCollectio({ numerus: 5, concurrentia: 2 })
  const collectiones = makeCollectionum(collectio)
  const inceptor = makeInceptor()
  const cursor = new CollectioCursor(inceptor.dispatch, collectiones, inceptor.actorum, {})

  await cursor.start(collectio)
  await cursor.pause('col-1')
  await cursor.resume('col-1')

  const stored = await collectiones.find('col-1')
  assert.equal(stored?.pausatum, undefined, 'pausatum should be cleared on resume')
})

test('pause -> simulated restart (fresh cursor over same store) -> no dispatch until resume', async () => {
  // Shared, persistent stores that survive the "restart" (only the CollectioCursor's
  // in-memory state map is lost — the real failure mode this test guards against).
  const collectio = makeCollectio({
    id: 'col-restart-pause',
    status: 'agens',
    numerus: 5,
    concurrentia: 2,
  })
  const collectiones = makeCollectionum(collectio)
  const actorum = makeActorum()

  let counter = 0
  const calls: Inceptio[] = []
  // Dispatch writes into the SAME shared actorum — mirrors a real async pod
  // creating a persisted Actum row, not an isolated per-cursor stub.
  async function dispatch(inceptio: Inceptio): Promise<{ actum: Actum }> {
    calls.push(inceptio)
    const id = `actum-${counter++}`
    const actum: Actum = {
      id,
      modusId: inceptio.modusId,
      modusVersiono: '1',
      aditus: inceptio.aditus,
      status: 'nascens' as ActumStatus,
      impetus: 0n,
      signaConsumed: [],
      inceptum: new Date(),
      expirat: new Date(Date.now() + 60_000),
    }
    actorum.store.set(id, actum)
    return { actum }
  }

  // First cursor: start a collection, pause it (persists pausatum), then "die"
  // (no more calls on this instance — simulating a process restart).
  const cursor1 = new CollectioCursor(dispatch, collectiones, actorum, {})
  await cursor1.start(collectio)
  assert.equal(calls.length, 2, 'dispatched 2 pieces before pause')
  await cursor1.pause('col-restart-pause')

  const stored = await collectiones.find('col-restart-pause')
  assert.ok(stored?.pausatum, 'pause was persisted before the "restart"')

  // Fresh CollectioCursor instance — the "restart". Same underlying stores, so it
  // reads the persisted pausatum and the persisted acta.
  const cursor2 = new CollectioCursor(dispatch, collectiones, actorum, {})
  await cursor2.rehydrate()

  // In-flight acta completing must NOT trigger a new dispatch while paused.
  const callsBeforeResume = calls.length
  await cursor2.onActumCompleta('col-restart-pause', 'actum-0', true)
  assert.equal(calls.length, callsBeforeResume, 'no dispatch after restart while still paused')

  // Resume — now dispatching continues.
  await cursor2.resume('col-restart-pause')
  assert.ok(calls.length > callsBeforeResume, 'dispatch resumes once unpaused')
})

// ── Test 22: Idempotency on onActumCompleta ───────────────────────────────────

test('onActumCompleta called twice for same actumId is no-op on second call', async () => {
  const collectio = makeCollectio({ numerus: 3, concurrentia: 2 })
  const collectiones = makeCollectionum(collectio)
  const inceptor = makeInceptor()
  const cursor = new CollectioCursor(
    inceptor.dispatch,
    collectiones,
    inceptor.actorum,
    {},
  )

  await cursor.start(collectio)
  const countBefore = collectiones.updates.filter(u => u.patch.completae !== undefined).length

  await cursor.onActumCompleta('col-1', 'actum-0', true)
  await cursor.onActumCompleta('col-1', 'actum-0', true)  // duplicate

  const countAfter = collectiones.updates.filter(u => u.patch.completae !== undefined).length
  assert.equal(countAfter - countBefore, 1, 'completae should only be incremented once')
})

// ── Restart liveness ──────────────────────────────────────────────────────────
//
// Every test below builds a FRESH CollectioCursor over stores that already hold a
// collection — the shape of a process restart, where the persisted record and acta
// survive and only the cursor's in-memory state map is gone.

function seedActum(overrides: Partial<Actum> & { id: string }): Actum {
  return {
    modusId: 'm',
    modusVersiono: '1',
    aditus: {},
    status: 'nascens',
    impetus: 0n,
    signaConsumed: [],
    inceptum: new Date(),
    expirat: new Date(Date.now() + 60_000),
    ...overrides,
  } as Actum
}

test('resume() after a restart reconstructs state and dispatches', async () => {
  const collectio = makeCollectio({
    id: 'col-resume-restart',
    status: 'agens',
    pausatum: new Date(),
    acta: ['a0'],
    numerus: 4,
    concurrentia: 2,
  })
  const collectiones = makeCollectionum(collectio)
  const actorum = makeActorum()
  actorum.store.set('a0', seedActum({ id: 'a0', status: 'completus' }))

  const inceptor = makeInceptor()
  const cursor = new CollectioCursor(inceptor.dispatch, collectiones, actorum, {})

  // No rehydrate() — resume alone has to bring the collection back to life.
  await cursor.resume('col-resume-restart')

  assert.equal(collectiones.store.get('col-resume-restart')?.pausatum, undefined, 'pausatum cleared')
  assert.equal(inceptor.calls.length, 2, 'resume should dispatch up to concurrentia after a restart')
  assert.equal(inceptor.calls[0].aditus._pieceIndex, 1, 'nextIndex reconstructed from persisted acta')
})

test('pause() after a restart reconstructs state alongside persisting pausatum', async () => {
  const collectio = makeCollectio({
    id: 'col-pause-restart',
    status: 'agens',
    acta: ['a0'],
    numerus: 4,
    concurrentia: 2,
  })
  const collectiones = makeCollectionum(collectio)
  const actorum = makeActorum()
  actorum.store.set('a0', seedActum({ id: 'a0', status: 'agens' }))

  const inceptor = makeInceptor()
  const cursor = new CollectioCursor(inceptor.dispatch, collectiones, actorum, {})

  await cursor.pause('col-pause-restart')

  assert.ok(
    collectiones.store.get('col-pause-restart')?.pausatum instanceof Date,
    'pausatum persisted',
  )
  // The in-flight actum is tracked, which is only true if state was reconstructed:
  // this is the routing the webhook handler needs to find the owning collection.
  assert.equal(
    cursor.findCollectioIdForActum('a0'),
    'col-pause-restart',
    'the persisted in-flight actum should be in the reconstructed running set',
  )
})

test('rehydrate() dispatches an agens collection left with nothing in flight', async () => {
  // Two orphan shapes: every persisted actum settled, and none dispatched at all.
  const settled = makeCollectio({
    id: 'col-orphan-settled',
    status: 'agens',
    acta: ['s0'],
    numerus: 3,
    concurrentia: 2,
  })
  const none = makeCollectio({
    id: 'col-orphan-none',
    status: 'agens',
    acta: [],
    numerus: 1,
    concurrentia: 2,
  })
  const collectiones = makeCollectionum(settled)
  collectiones.store.set(none.id, { ...none })

  const actorum = makeActorum()
  actorum.store.set('s0', seedActum({ id: 's0', status: 'completus' }))

  const inceptor = makeInceptor()
  const cursor = new CollectioCursor(inceptor.dispatch, collectiones, actorum, {})

  await cursor.rehydrate()

  const indexes = inceptor.calls.map(c => c.aditus._pieceIndex)
  assert.equal(inceptor.calls.length, 3, 'two pieces for the settled orphan, one for the untouched one')
  assert.deepEqual(indexes, [1, 2, 0], 'settled orphan resumes at nextIndex 1; the other starts at 0')
})

test('rehydrate() does NOT dispatch when acta are in flight or awaiting review', async () => {
  // Free concurrency slots and unspent budget on both — the only thing holding
  // dispatch back is that an event is still coming for each collection.
  const inFlight = makeCollectio({
    id: 'col-inflight',
    status: 'agens',
    acta: ['f0', 'f1'],
    numerus: 6,
    concurrentia: 4,
  })
  const awaiting = makeCollectio({
    id: 'col-awaiting',
    status: 'agens',
    acta: ['p0'],
    numerus: 6,
    concurrentia: 4,
    reviewEnabled: true,
  })
  const collectiones = makeCollectionum(inFlight)
  collectiones.store.set(awaiting.id, { ...awaiting })

  const actorum = makeActorum()
  actorum.store.set('f0', seedActum({ id: 'f0', status: 'nascens' }))
  actorum.store.set('f1', seedActum({ id: 'f1', status: 'agens' }))
  actorum.store.set('p0', seedActum({
    id: 'p0',
    status: 'completus',
    exitus: { reviewOutcome: 'pending' },
  }))

  const inceptor = makeInceptor()
  const cursor = new CollectioCursor(inceptor.dispatch, collectiones, actorum, {})

  await cursor.rehydrate()

  assert.equal(inceptor.calls.length, 0, 'rehydrate must not dispatch alongside in-flight or pending-review acta')

  // The in-flight collection still advances the normal way, from its own completions.
  await cursor.onActumCompleta('col-inflight', 'f0', true)
  assert.equal(
    inceptor.calls.length,
    3,
    'a completion refills the free concurrency slots from the reconstructed nextIndex',
  )
  assert.deepEqual(inceptor.calls.map(c => c.aditus._pieceIndex), [2, 3, 4])
})

test('resume() after a restart carries the reconstructed DNA ledger', async () => {
  const tractus: Tractus[] = [
    {
      porta: 'stilus',
      label: 'Stilus',
      valores: [
        { value: 'v-alpha', label: 'Alpha', rarity: 1 },
        { value: 'v-beta', label: 'Beta', rarity: 1 },
        { value: 'v-gamma', label: 'Gamma', rarity: 1 },
      ],
    },
  ]
  const collectio = makeCollectio({
    id: 'col-resume-dna',
    status: 'agens',
    pausatum: new Date(),
    dna: true,
    tractus,
    acta: ['d0', 'd1'],
    numerus: 3,
    concurrentia: 2,
  })
  const collectiones = makeCollectionum(collectio)
  const actorum = makeActorum()
  // The fingerprints stamped at dispatch time — the ledger's only persisted form.
  actorum.store.set('d0', seedActum({
    id: 'd0', status: 'completus', aditus: { _dna: 'stilus=Alpha' },
  }))
  actorum.store.set('d1', seedActum({
    id: 'd1', status: 'completus', aditus: { _dna: 'stilus=Beta' },
  }))

  const inceptor = makeInceptor()
  const cursor = new CollectioCursor(inceptor.dispatch, collectiones, actorum, {})

  await cursor.resume('col-resume-dna')

  assert.equal(inceptor.calls.length, 1, 'one piece of budget left')
  assert.equal(
    inceptor.calls[0].aditus._dna,
    'stilus=Gamma',
    'the surviving piece must take the one combination the persisted acta did not use',
  )
})

test('resume() after a restart carries the reconstructed pending-review set', async () => {
  const collectio = makeCollectio({
    id: 'col-resume-review',
    status: 'agens',
    pausatum: new Date(),
    reviewEnabled: true,
    acta: ['r0', 'r1'],
    numerus: 2,
    concurrentia: 2,
  })
  const collectiones = makeCollectionum(collectio)
  const actorum = makeActorum()
  actorum.store.set('r0', seedActum({
    id: 'r0', status: 'completus', exitus: { reviewOutcome: 'pending' },
  }))
  actorum.store.set('r1', seedActum({ id: 'r1', status: 'agens' }))

  const inceptor = makeInceptor()
  const cursor = new CollectioCursor(inceptor.dispatch, collectiones, actorum, {})

  await cursor.resume('col-resume-review')
  assert.equal(inceptor.calls.length, 0, 'budget already spent — nothing new to dispatch')

  // r1 finishes and joins review; r0 was already there.
  await cursor.onActumCompleta('col-resume-review', 'r1', true)
  await cursor.approveActum('col-resume-review', 'r1')
  assert.equal(
    collectiones.store.get('col-resume-review')?.status,
    'agens',
    'the collection is not settled while the pre-restart actum still awaits review',
  )

  await cursor.approveActum('col-resume-review', 'r0')
  assert.equal(
    collectiones.store.get('col-resume-review')?.status,
    'completa',
    'settles once every piece — including the pre-restart one — is approved',
  )
})

// ── noema-359: a dispatch that throws is still accounted for ──────────────────
//
// A dispatch can throw after it has already persisted its actum and locked that
// piece's signa. That run exists and is terminal, so the collection has to contain
// it: the id comes back on the error and is appended to `acta`. And because no
// completion event will ever fire for a piece that never entered `running`, the
// collection has to settle itself — a collection whose dispatches all fail must
// still reach a terminal state rather than sitting agens with nothing in flight.

/** A dispatch stub that throws for every piece, carrying a persisted actum id. */
function makeThrowingDispatch(actumIdPrefix = 'failed'): {
  dispatch(inceptio: Inceptio): Promise<{ actum: Actum }>
  calls: Inceptio[]
  ids: string[]
} {
  let counter = 0
  const calls: Inceptio[] = []
  const ids: string[] = []
  return {
    calls,
    ids,
    async dispatch(inceptio: Inceptio): Promise<{ actum: Actum }> {
      calls.push(inceptio)
      const id = `${actumIdPrefix}-${counter++}`
      ids.push(id)
      const err = new Error('no cursor for this modus')
      // Mirrors what dispatchInceptio stamps on a post-initiate failure.
      Object.defineProperty(err, '__noemaDispatchFailureActumId', {
        value: id, enumerable: false, configurable: true, writable: true,
      })
      throw err
    },
  }
}

test('a dispatch that throws appends the failed piece to acta and counts it fractus', async () => {
  const collectio = makeCollectio({ numerus: 2, concurrentia: 2 })
  const collectiones = makeCollectionum(collectio)
  const failing = makeThrowingDispatch()
  const cursor = new CollectioCursor(
    failing.dispatch,
    collectiones,
    makeActorum(),
    {},
  )

  await cursor.start(collectio)

  const stored = collectiones.store.get('col-1')!
  assert.deepEqual(stored.acta, failing.ids, 'every failed piece is a member of the collection')
  assert.equal(stored.fractae, 2, 'each failed dispatch counted once')
  assert.equal(stored.completae, 0)
})

test('a collection whose dispatches all fail reaches a terminal state', async () => {
  const collectio = makeCollectio({ numerus: 2, concurrentia: 2 })
  const collectiones = makeCollectionum(collectio)
  const cursor = new CollectioCursor(
    makeThrowingDispatch().dispatch,
    collectiones,
    makeActorum(),
    {},
  )

  await cursor.start(collectio)

  const stored = collectiones.store.get('col-1')!
  assert.equal(stored.status, 'completa', 'settled, not left agens with nothing in flight')
  assert.ok(stored.completum instanceof Date, 'terminal state carries its completion time')
})

test('a failed piece consumes its slot — no replacement is dispatched for it', async () => {
  const collectio = makeCollectio({ numerus: 3, concurrentia: 3 })
  const collectiones = makeCollectionum(collectio)
  const failing = makeThrowingDispatch()
  const cursor = new CollectioCursor(
    failing.dispatch,
    collectiones,
    makeActorum(),
    {},
  )

  await cursor.start(collectio)

  assert.equal(failing.calls.length, 3, 'exactly the target count — a failure is not retried')
  assert.equal(collectiones.store.get('col-1')!.reiectae, 0, 'a failure is not a rejection')
})

test('a dispatch failure does not stop the pieces that follow it', async () => {
  const collectio = makeCollectio({ numerus: 3, concurrentia: 3 })
  const collectiones = makeCollectionum(collectio)
  const ok = makeInceptor()
  let calls = 0
  const mixed = async (inceptio: Inceptio): Promise<{ actum: Actum }> => {
    calls += 1
    if (calls === 1) {
      const err = new Error('no cursor for this modus')
      Object.defineProperty(err, '__noemaDispatchFailureActumId', {
        value: 'failed-0', enumerable: false, configurable: true, writable: true,
      })
      throw err
    }
    return ok.dispatch(inceptio)
  }
  const cursor = new CollectioCursor(mixed, collectiones, ok.actorum, {})

  await cursor.start(collectio)

  assert.equal(calls, 3, 'the remaining pieces were still dispatched')
  const stored = collectiones.store.get('col-1')!
  assert.equal(stored.fractae, 1)
  assert.equal(stored.acta.length, 3, 'the failed piece and both live pieces are all members')
  assert.ok(stored.acta.includes('failed-0'))
  assert.equal(stored.status, 'agens', 'still running — the live pieces have not settled yet')
})

// The seam itself, unstubbed: the real dispatchInceptio settles the piece and hands
// back the persisted actum id, and the cursor puts that id into the collection. The
// two halves are only worth anything joined, so this test joins them.
test('the failed piece the real dispatch settles is the one that lands in acta', async () => {
  const collectio = makeCollectio({ numerus: 2, concurrentia: 2 })
  const collectiones = makeCollectionum(collectio)
  const actorum = makeActorum()

  let counter = 0
  const failed: string[] = []
  const deps: DispatchDeps = {
    inceptor: {
      initiate: async (inceptio) => {
        const actum: Actum = {
          id: `piece-${counter++}`,
          modusId: inceptio.modusId,
          modusVersiono: '1.0.0',
          aditus: inceptio.aditus,
          status: 'nascens' as ActumStatus,
          impetus: 100n,
          signaConsumed: ['sig-1'],
          inceptum: new Date(),
          expirat: new Date(Date.now() + 60_000),
        }
        actorum.store.set(actum.id, actum)
        return actum
      },
    },
    modorum: {
      find: async () => ({
        id: 'flux-schnell', nomen: 'Test', genus: 'atomicus', versio: '1.0.0',
        contentHash: 'abc', aditus: {}, exitus: {}, ministerium: 'runpod',
        canonica: true, natum: new Date(), mutatum: new Date(),
      }),
      register: async () => {},
      list: async () => [],
    } as unknown as DispatchDeps['modorum'],
    cursorum: {
      register: () => {},
      resolve: () => { throw new Error('No cursor registered for ministerium') },
    },
    completor: {
      complete: async (actum) => actum,
      fail: async (actum, error) => {
        failed.push(actum.id)
        const updated = { ...actum, status: 'fractus' as ActumStatus, error }
        actorum.store.set(actum.id, updated)
        return updated
      },
    },
  }

  const cursor = new CollectioCursor(
    (inceptio) => dispatchInceptio(deps, inceptio),
    collectiones,
    actorum,
    {},
  )

  await cursor.start(collectio)

  const stored = collectiones.store.get('col-1')!
  assert.deepEqual(failed, ['piece-0', 'piece-1'], 'both pieces were settled by the dispatch')
  assert.deepEqual(stored.acta, failed, 'and the collection contains exactly those runs')
  assert.equal(stored.fractae, 2)
  assert.equal(stored.status, 'completa')
})
