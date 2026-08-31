import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Collectio, Collectionum } from '../../../src/types/collectio.js'
import type { Actum } from '../../../src/types/actum.js'
import type { Actorum, Inceptio } from '../../../src/types/cursus.js'
import { CollectioCursor } from '../../../src/crystal/CollectioCursor.js'
import { CrystalApi } from '../../../src/allocutio/api/CrystalApi.js'
import type { CrystalApiDeps } from '../../../src/allocutio/api/CrystalApi.js'
import { toCollection } from '../../../src/allocutio/api/runProjection.js'
import { handleExecutionWebhook } from '../../../src/api/webhooks/executionWebhook.js'
import type { ExecutionWebhookDeps } from '../../../src/api/webhooks/executionWebhook.js'

// =============================================================================
// noema-383 — cancelling a collection cancels the acta it has in flight.
// =============================================================================
//
// Cancelling a collection stops it dispatching and marks it cancelled. The pieces it had
// ALREADY dispatched are settled by the same cancellation `POST /v1/runs/:id/cancel` uses:
// each pod is terminated and its reservation released rather than charged.
//
// The whole difficulty is concurrency. Cancelling N in-flight pieces is N settlements racing
// with completions already in transit, so these tests drive the REAL `CollectioCursor` (and,
// for the webhook case, the REAL webhook handler) rather than asserting against a double of
// the thing under test. What they pin down:
//
//   - a cancel settles what is in flight, through the supplied settlement, once per piece;
//   - a piece that completes mid-sweep is settled ONCE and counted as the work it did;
//   - a webhook arriving after the cancel neither resurrects the piece nor credits it again;
//   - a settlement that throws does not abort the sweep, and the collection still lands;
//   - the counters reconcile against the target afterwards (noema-376's identity).

// ── Fixtures ─────────────────────────────────────────────────────────────────

const OWNER = { animaId: 'anima-owner' }

function makeCollectio(overrides: Partial<Collectio> = {}): Collectio {
  return {
    id: 'col-1',
    modusId: 'flux-schnell',
    aditusBase: {},
    tractus: [],
    numerus: 4,
    provenanceHash: 'sha256:test',
    by: OWNER,
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
  store: Map<string, Collectio>
}

function makeCollectionum(initial: Collectio): CollectionumStub {
  const store = new Map<string, Collectio>([[initial.id, { ...initial }]])
  return {
    store,
    async find(id) { return store.get(id) ?? null },
    async list(filter?: Partial<Collectio>) {
      const all = [...store.values()]
      return filter?.status ? all.filter(c => c.status === filter.status) : all
    },
    async listByStatus(status) {
      return [...store.values()].filter(c => c.status === status)
    },
    async create(input) {
      const c = { ...input, id: 'col-auto', natum: new Date(), acta: [], completae: 0, fractae: 0, pendentes: 0, reiectae: 0, impetusTotal: 0n } as Collectio
      store.set(c.id, c)
      return c
    },
    async update(id, patch) {
      const existing = store.get(id)
      if (!existing) throw new Error(`Collectio '${id}' not found`)
      const updated = { ...existing, ...patch }
      store.set(id, updated)
      return updated
    },
  }
}

interface ActorumStub extends Actorum {
  store: Map<string, Actum>
}

function makeActorum(): ActorumStub {
  const store = new Map<string, Actum>()
  const unused = (name: string) => async (): Promise<never> => {
    throw new Error(`ActorumStub.${name}: not exercised by this suite`)
  }
  return {
    store,
    async create(actum) {
      const a = { ...actum, inceptum: new Date() } as Actum
      store.set(a.id, a)
      return a
    },
    async update(id, patch) {
      const existing = store.get(id)
      if (!existing) throw new Error(`Actum '${id}' not found`)
      const updated = { ...existing, ...patch } as Actum
      store.set(id, updated)
      return updated
    },
    async findById(id) { return store.get(id) ?? null },
    async findByExternusJobId(jobId: string) {
      return [...store.values()].find(a => a.externusJobId === jobId) ?? null
    },
    async findExpired() { return [] },
    findByCallbackNonce: unused('findByCallbackNonce'),
    findByNullifier: unused('findByNullifier'),
    findInFlight: unused('findInFlight'),
    findByCompositum: unused('findByCompositum'),
  }
}

/**
 * A completor double that mirrors the ONE behaviour the sweep leans on: `fail` re-reads the
 * record and, when it is already terminal, returns it untouched — no second release, no
 * overwritten cause. Every settlement is recorded, so "settled once" is observable.
 *
 * `released` is the reservation-release side of it: a cancelled piece releases, a completed
 * piece does not. It is what "a cancel does not charge for the work it stopped" reduces to at
 * this seam, and what a double-settle would show up in.
 */
function makeCompletor(actorum: ActorumStub) {
  const failedWith: Array<{ actumId: string; error: string }> = []
  const released: string[] = []
  const completed: string[] = []
  return {
    failedWith,
    released,
    completed,
    completor: {
      async complete(actum: Actum, result: { exitus: unknown; impetus: bigint; duratio?: number }) {
        const current = await actorum.findById(actum.id)
        if (current?.status === 'completus') throw new Error('double-completion rejected')
        completed.push(actum.id)
        return actorum.update(actum.id, {
          status: 'completus',
          exitus: result.exitus as Record<string, unknown>,
          impetus: result.impetus,
          completum: new Date(),
        })
      },
      async fail(actum: Actum, error: string) {
        failedWith.push({ actumId: actum.id, error })
        const current = await actorum.findById(actum.id)
        if (current?.status === 'completus' || current?.status === 'fractus') return current
        released.push(actum.id)
        return actorum.update(actum.id, { status: 'fractus', error, completum: new Date() })
      },
    },
  }
}

interface Rig {
  collectiones: CollectionumStub
  actorum: ActorumStub
  cursor: CollectioCursor
  api: CrystalApi
  dispatched: string[]
  failedWith: Array<{ actumId: string; error: string }>
  released: string[]
  completor: ReturnType<typeof makeCompletor>['completor']
}

/**
 * The store-into-cursor-into-API seam, wired as production wires it: the real cursor over a
 * real `CrystalApi`, dispatching async pieces (no inline exitus) so they stay in flight until
 * something — a webhook, or the cancel — settles them.
 */
function makeRig(overrides: Partial<Collectio> = {}): Rig {
  const collectio = makeCollectio(overrides)
  const collectiones = makeCollectionum(collectio)
  const actorum = makeActorum()
  const dispatched: string[] = []
  let counter = 0

  const dispatch = async (inceptio: Inceptio): Promise<{ actum: Actum }> => {
    const id = `actum-${counter++}`
    const actum: Actum = {
      id,
      modusId: inceptio.modusId,
      modusVersiono: '1',
      aditus: inceptio.aditus,
      status: 'nascens',
      impetus: 100n,
      signaConsumed: [`signum-${id}`],
      inceptum: new Date(),
      expirat: new Date(Date.now() + 60_000),
      externusJobId: `job-${id}`,
    }
    actorum.store.set(id, actum)
    dispatched.push(id)
    return { actum }
  }

  const cursor = new CollectioCursor(dispatch, collectiones, actorum, {})
  const { completor, failedWith, released } = makeCompletor(actorum)
  const api = new CrystalApi({
    collectiones,
    collectioCursor: cursor,
    actorum,
    completor,
  } as unknown as CrystalApiDeps)

  return { collectiones, actorum, cursor, api, dispatched, failedWith, released, completor }
}

/** The counter identity noema-376 pinned down: every dispatched piece is in exactly one
 *  bucket, and the buckets sum to the target. `inFlight` is derived from the acta the way
 *  `getCollection` derives it, so a piece that left flight has to have landed somewhere. */
function assertCountersReconcile(rig: Rig, collectioId: string, note: string): void {
  const c = rig.collectiones.store.get(collectioId)!
  const inFlight = c.acta.filter(id => {
    const a = rig.actorum.store.get(id)
    return a?.status === 'nascens' || a?.status === 'agens'
  }).length
  const outstanding = c.numerus + c.reiectae - c.acta.length
  const view = toCollection(c)
  assert.equal(
    view.completed + view.pendingReview + view.failed + inFlight + outstanding,
    view.total,
    `every dispatched piece is in exactly one bucket, and the buckets sum to the target (${note})`,
  )
  assert.ok(outstanding >= 0, `a collection never dispatches more than its budget (${note})`)
}

// ── A cancel settles what the collection has in flight ────────────────────────

test('cancelling a collection settles every piece it has in flight', async () => {
  const rig = makeRig({ numerus: 4, concurrentia: 2 })
  await rig.cursor.start(rig.collectiones.store.get('col-1')!)
  assert.equal(rig.dispatched.length, 2, 'two pieces are in flight')

  const view = await rig.api.cancelCollection(OWNER, 'col-1')

  assert.equal(view.status, 'cancelled')
  assert.deepEqual(
    rig.released.sort(),
    ['actum-0', 'actum-1'],
    'both in-flight pieces are settled — the reservation is released, not charged',
  )
  for (const id of rig.dispatched) {
    assert.equal(rig.actorum.store.get(id)!.status, 'fractus', `${id} is terminal after the cancel`)
  }
  assert.equal(
    rig.failedWith[0]!.error,
    'cancelled by the run owner',
    'the cancelled piece records the same cause a single-run cancel records',
  )
  assert.equal(view.failed, 2, 'a cancelled piece did not generate — it is counted in failed')
  assert.equal(view.completed, 0, 'a cancelled piece never counts toward the target')
  assertCountersReconcile(rig, 'col-1', 'after a cancel with pieces in flight')
})

test('a cancel dispatches nothing further — the slots it frees stay free', async () => {
  const rig = makeRig({ numerus: 6, concurrentia: 2 })
  await rig.cursor.start(rig.collectiones.store.get('col-1')!)
  assert.equal(rig.dispatched.length, 2)

  await rig.api.cancelCollection(OWNER, 'col-1')

  assert.equal(rig.dispatched.length, 2, 'settling a piece must not refill its slot')
  assert.equal(
    rig.collectiones.store.get('col-1')!.acta.length,
    2,
    'the collection paid for two pieces and no more',
  )
  assertCountersReconcile(rig, 'col-1', 'undispatched pieces stay outstanding')
})

// ── Race 1: a completion in transit must not be double-settled ────────────────

test('a piece that completes mid-sweep is settled once and counted as the work it did', async () => {
  const rig = makeRig({ numerus: 4, concurrentia: 2 })
  await rig.cursor.start(rig.collectiones.store.get('col-1')!)

  // The completion lands between the sweep's decision and this piece's settlement: the record
  // is already `completus` by the time the cancellation reaches it. A pre-check read before
  // the settlement would have said "in flight" and acted on a stale answer.
  await rig.completor.complete(rig.actorum.store.get('actum-0')!, { exitus: { image: 'x' }, impetus: 7n })

  await rig.api.cancelCollection(OWNER, 'col-1')

  assert.equal(
    rig.actorum.store.get('actum-0')!.status,
    'completus',
    'a finished run is not un-finished by a cancel that arrives after it',
  )
  assert.deepEqual(rig.released, ['actum-1'], 'only the still-running piece released its reservation')
  assert.equal(
    rig.failedWith.filter(f => f.actumId === 'actum-0').length,
    1,
    'the settlement was attempted once and no-opped — it is not retried into a second release',
  )

  const c = rig.collectiones.store.get('col-1')!
  assert.equal(c.completae, 1, 'the piece that generated is counted as generated')
  assert.equal(c.fractae, 1, 'only the cancelled piece is counted as failed')
  assertCountersReconcile(rig, 'col-1', 'a completion raced the cancel')
})

test('a completion already booked by its webhook is not booked a second time by the sweep', async () => {
  const rig = makeRig({ numerus: 4, concurrentia: 2 })
  await rig.cursor.start(rig.collectiones.store.get('col-1')!)

  // Fully in transit: settled AND booked into the collection before the cancel runs. Booking
  // it frees its slot, so a third piece goes out and is in flight when the cancel arrives.
  await rig.completor.complete(rig.actorum.store.get('actum-0')!, { exitus: { image: 'x' }, impetus: 7n })
  await rig.cursor.onActumCompleta('col-1', 'actum-0', true)
  assert.deepEqual(rig.dispatched, ['actum-0', 'actum-1', 'actum-2'])

  await rig.api.cancelCollection(OWNER, 'col-1')

  const c = rig.collectiones.store.get('col-1')!
  assert.equal(c.completae, 1, 'the booked completion stands, and is not re-counted by the sweep')
  assert.equal(c.fractae, 2, 'exactly the two pieces the cancel settled')
  assert.deepEqual(rig.released.sort(), ['actum-1', 'actum-2'])
  assertCountersReconcile(rig, 'col-1', 'a booked completion raced the cancel')
})

// ── Race 2: a webhook arriving after the cancel is inert ──────────────────────

test('a webhook arriving after the cancel neither resurrects the piece nor credits it again', async () => {
  const rig = makeRig({ numerus: 4, concurrentia: 2 })
  await rig.cursor.start(rig.collectiones.store.get('col-1')!)
  await rig.api.cancelCollection(OWNER, 'col-1')

  const before = { ...rig.collectiones.store.get('col-1')! }

  // The pod did not know it was cancelled and reports success. Drive the REAL webhook handler.
  const deps = {
    actorum: rig.actorum,
    completor: rig.completor,
    collectioRouter: rig.cursor,
  } as unknown as ExecutionWebhookDeps
  const body = { id: 'job-actum-0', status: 'COMPLETED', output: [{ url: 'https://example.invalid/out.png' }], executionTime: 5000 }
  const result = await handleExecutionWebhook({ body, rawBody: JSON.stringify(body) }, deps)

  assert.equal(result.status, 200, 'the callback is acknowledged rather than retried forever')
  const actum = rig.actorum.store.get('actum-0')!
  assert.equal(actum.status, 'fractus', 'the cancelled run stays cancelled — it is not resurrected')
  assert.equal(actum.exitus, undefined, 'no outputs are recorded onto a run that was cancelled')

  const after = rig.collectiones.store.get('col-1')!
  assert.equal(after.completae, before.completae, 'nothing is credited to the collection')
  assert.equal(after.fractae, before.fractae, 'nor counted a second time as a failure')
  assert.equal(after.status, 'cancellata', 'the collection stays cancelled')
  assertCountersReconcile(rig, 'col-1', 'after a late webhook')
})

test('a cancelled piece is no longer routable to its collection', async () => {
  const rig = makeRig({ numerus: 4, concurrentia: 2 })
  await rig.cursor.start(rig.collectiones.store.get('col-1')!)
  await rig.api.cancelCollection(OWNER, 'col-1')

  assert.equal(
    rig.cursor.findCollectioIdForActum('actum-0'),
    null,
    'a settled piece is out of flight, so a late completion has no collection to advance',
  )
})

// ── Race 3: one failing cancellation does not stop the others ─────────────────

test('a settlement that throws leaves the rest cancelled and the collection terminal', async () => {
  const rig = makeRig({ numerus: 6, concurrentia: 3 })
  await rig.cursor.start(rig.collectiones.store.get('col-1')!)
  assert.equal(rig.dispatched.length, 3)

  // The first piece the sweep reaches cannot be settled — the pod terminate call errors.
  const realFail = rig.completor.fail.bind(rig.completor)
  rig.completor.fail = async (actum: Actum, error: string) => {
    if (actum.id === 'actum-0') throw new Error('terminate refused')
    return realFail(actum, error)
  }

  const view = await rig.api.cancelCollection(OWNER, 'col-1')

  assert.equal(view.status, 'cancelled', 'the collection still reaches its terminal state')
  assert.deepEqual(
    rig.released.sort(),
    ['actum-1', 'actum-2'],
    'the sweep carried on past the failure and cancelled the rest',
  )
  assert.equal(
    rig.actorum.store.get('actum-0')!.status,
    'nascens',
    'the piece that could not be settled is still in flight — it is not pretended terminal',
  )
  assert.equal(view.failed, 2, 'only the pieces actually settled are counted as failed')
  assertCountersReconcile(rig, 'col-1', 'one settlement threw')
})

test('the sweep reports what it could not cancel rather than swallowing it', async () => {
  const rig = makeRig({ numerus: 4, concurrentia: 2 })
  await rig.cursor.start(rig.collectiones.store.get('col-1')!)

  const report = await rig.cursor.cancelInFlight('col-1', async (actumId) => {
    if (actumId === 'actum-0') throw new Error('terminate refused')
    const a = rig.actorum.store.get(actumId)!
    return rig.completor.fail(a, 'cancelled by the run owner')
  })

  assert.deepEqual(report.cancelled, ['actum-1'])
  assert.deepEqual(report.completed, [])
  assert.equal(report.unsettled.length, 1)
  assert.equal(report.unsettled[0]!.actumId, 'actum-0')
  assert.match(report.unsettled[0]!.error, /terminate refused/)
})

// ── Idempotency + terminal coherence ─────────────────────────────────────────

test('cancelling an already-cancelled collection settles nothing and does not error', async () => {
  const rig = makeRig({ numerus: 4, concurrentia: 2 })
  await rig.cursor.start(rig.collectiones.store.get('col-1')!)

  const first = await rig.api.cancelCollection(OWNER, 'col-1')
  const settlesAfterFirst = rig.failedWith.length
  const second = await rig.api.cancelCollection(OWNER, 'col-1')

  assert.equal(
    rig.failedWith.length,
    settlesAfterFirst,
    'a second cancel does not re-cancel pieces that are already settled',
  )
  assert.equal(second.status, 'cancelled')
  assert.equal(second.failed, first.failed, 'the counters do not move on a repeat cancel')
  assert.equal(second.completed, first.completed)
  assertCountersReconcile(rig, 'col-1', 'after a repeated cancel')
})

test('cancelling a collection with nothing in flight is a no-op cancel', async () => {
  const rig = makeRig({ numerus: 4, concurrentia: 2, status: 'draft' })

  const view = await rig.api.cancelCollection(OWNER, 'col-1')

  assert.equal(view.status, 'cancelled')
  assert.equal(rig.failedWith.length, 0, 'a collection that never fired has nothing to settle')
  assert.equal(rig.dispatched.length, 0)
})

test('the last piece leaving flight does not re-settle a cancelled collection as complete', async () => {
  // Every piece of the target is in flight, so the sweep empties `running` with the dispatch
  // budget exhausted — exactly the condition that settles a collection `completa`.
  const rig = makeRig({ numerus: 2, concurrentia: 2 })
  await rig.cursor.start(rig.collectiones.store.get('col-1')!)
  assert.equal(rig.dispatched.length, 2, 'the whole target is in flight')

  const view = await rig.api.cancelCollection(OWNER, 'col-1')

  assert.equal(view.status, 'cancelled', 'cancelled is the terminal state it reached')
  assert.equal(rig.collectiones.store.get('col-1')!.status, 'cancellata')
  assertCountersReconcile(rig, 'col-1', 'the whole target was in flight')
})

// ── The noema-376 identity across a cancel ───────────────────────────────────

test('the counters reconcile against total across a mixed cancel', async () => {
  // Four pieces of six dispatched: one already generated, one failed, two still in flight.
  const rig = makeRig({ numerus: 6, concurrentia: 2 })
  await rig.cursor.start(rig.collectiones.store.get('col-1')!)

  await rig.completor.complete(rig.actorum.store.get('actum-0')!, { exitus: { image: 'x' }, impetus: 3n })
  await rig.cursor.onActumCompleta('col-1', 'actum-0', true)
  await rig.completor.fail(rig.actorum.store.get('actum-1')!, 'pod died')
  await rig.cursor.onActumCompleta('col-1', 'actum-1', false)
  assert.equal(rig.dispatched.length, 4, 'two replacements went out for the two that settled')
  assertCountersReconcile(rig, 'col-1', 'before the cancel')

  await rig.api.cancelCollection(OWNER, 'col-1')

  const c = rig.collectiones.store.get('col-1')!
  assert.equal(c.completae, 1, 'the generated piece keeps its counter')
  assert.equal(c.fractae, 3, 'the piece that died plus the two the cancel settled')
  assert.equal(c.pendentes, 0)
  assert.equal(c.acta.length, 4, 'two of the six pieces were never dispatched')
  assertCountersReconcile(rig, 'col-1', 'after the cancel')
})

test('a piece held for review survives a cancel in pendentes', async () => {
  const rig = makeRig({ numerus: 4, concurrentia: 2, reviewEnabled: true })
  await rig.cursor.start(rig.collectiones.store.get('col-1')!)

  await rig.completor.complete(rig.actorum.store.get('actum-0')!, { exitus: { image: 'x' }, impetus: 3n })
  await rig.cursor.onActumCompleta('col-1', 'actum-0', true)
  assert.equal(rig.collectiones.store.get('col-1')!.pendentes, 1)

  await rig.api.cancelCollection(OWNER, 'col-1')

  const c = rig.collectiones.store.get('col-1')!
  assert.equal(c.pendentes, 1, 'a generated piece awaiting a decision is not discarded by a cancel')
  assert.equal(c.completae, 0)
  assert.equal(c.status, 'cancellata')
  assertCountersReconcile(rig, 'col-1', 'a held piece across a cancel')
})
