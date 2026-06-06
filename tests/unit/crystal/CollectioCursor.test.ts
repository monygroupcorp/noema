import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Collectio } from '../../../src/types/collectio.js'
import type { Actum, ActumStatus } from '../../../src/types/actum.js'
import type { Actorum, Inceptio } from '../../../src/types/cursus.js'
import type { Collectionum } from '../../../src/types/collectio.js'
import { ActumInceptor } from '../../../src/execution/ActumInceptor.js'
import { CollectioCursor } from '../../../src/crystal/CollectioCursor.js'
import { selectForPiece } from '../../../src/crystal/TraitMixer.js'
import type { Tractus } from '../../../src/types/collectio.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCollectio(overrides: Partial<Collectio> = {}): Collectio {
  return {
    id: 'col-1',
    modusId: 'flux-schnell',
    aditusBase: {},
    tractus: [],
    numerus: 3,
    by: { animaId: 'anima-1' },
    acta: [],
    completae: 0,
    fractae: 0,
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
      const c = { ...input, id: 'col-auto', natum: new Date(), acta: [], completae: 0, fractae: 0, impetusTotal: 0n } as Collectio
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
  }
}

interface InceptorStub {
  initiate(inceptio: Inceptio): Promise<Actum>
  calls: Inceptio[]
  actorum: ActorumStub
}

function makeInceptor(actumIdPrefix = 'actum'): InceptorStub & { _counter: number } {
  let counter = 0
  const actorum = makeActorum()

  const stub = {
    calls: [] as Inceptio[],
    actorum,
    _counter: 0,
    async initiate(inceptio: Inceptio): Promise<Actum> {
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
      return actum
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
    inceptor as unknown as ActumInceptor,
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
    inceptor as unknown as ActumInceptor,
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
    inceptor as unknown as ActumInceptor,
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
    inceptor as unknown as ActumInceptor,
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
    inceptor as unknown as ActumInceptor,
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
    inceptor as unknown as ActumInceptor,
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
    inceptor as unknown as ActumInceptor,
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
    inceptor as unknown as ActumInceptor,
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
    inceptor as unknown as ActumInceptor,
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
    inceptor as unknown as ActumInceptor,
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
    inceptor as unknown as ActumInceptor,
    collectiones,
    inceptor.actorum,
    { reviewEnabled: true },
  )

  await cursor.start(collectio)
  await cursor.onActumCompleta('col-1', 'actum-0', true)

  const completaeUpdate = collectiones.updates.find(u => u.patch.completae !== undefined)
  assert.equal(completaeUpdate, undefined, 'should NOT increment completae before approval')
})

// ── Test 12: reviewEnabled — approveActum() increments completae and dispatches next

test('reviewEnabled: approveActum() increments completae and dispatches next piece', async () => {
  const collectio = makeCollectio({ numerus: 5, concurrentia: 2 })
  const collectiones = makeCollectionum(collectio)
  const inceptor = makeInceptor()
  const actorum = inceptor.actorum
  const cursor = new CollectioCursor(
    inceptor as unknown as ActumInceptor,
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
    inceptor as unknown as ActumInceptor,
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
    inceptor as unknown as ActumInceptor,
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
    inceptor as unknown as ActumInceptor,
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
    inceptor as unknown as ActumInceptor,
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
    inceptor as unknown as ActumInceptor,
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
    inceptor as unknown as ActumInceptor,
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
    inceptor as unknown as ActumInceptor,
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
    inceptor as unknown as ActumInceptor,
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
    inceptor as unknown as ActumInceptor,
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
    inceptor as unknown as ActumInceptor,
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
    inceptor as unknown as ActumInceptor,
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
    inceptor as unknown as ActumInceptor,
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

// ── Test 22: Idempotency on onActumCompleta ───────────────────────────────────

test('onActumCompleta called twice for same actumId is no-op on second call', async () => {
  const collectio = makeCollectio({ numerus: 3, concurrentia: 2 })
  const collectiones = makeCollectionum(collectio)
  const inceptor = makeInceptor()
  const cursor = new CollectioCursor(
    inceptor as unknown as ActumInceptor,
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
