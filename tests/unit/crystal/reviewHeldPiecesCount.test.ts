import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Collection, Document } from 'mongodb'
import type { Actum } from '../../../src/types/actum.js'
import type { Actorum, Inceptio } from '../../../src/types/cursus.js'
import { MongoCollectio } from '../../../src/crystal/MongoCollectio.js'
import { CollectioCursor } from '../../../src/crystal/CollectioCursor.js'
import { toCollection } from '../../../src/allocutio/api/runProjection.js'

// =============================================================================
// noema-376 — a piece held for review must be counted by its collection.
// =============================================================================
//
// The defect: a collection fired with `reviewEnabled` whose pieces completed held every
// success in the cursor's in-memory pending set and wrote nothing to the collection. The
// record kept `completae: 0, fractae: 0, reiectae: 0` while real pieces accumulated, so the
// documented poll target reported a collection producing work and one producing nothing with
// the same numbers.
//
// The semantics these tests pin down: `completae` is GENERATED AND ACCEPTED, and `pendentes`
// is GENERATED AND AWAITING A DECISION. A held piece is in `pendentes`; approval moves it to
// `completae`, rejection to `reiectae`. Every dispatched piece is in exactly one counter, so
// the four reconcile against `numerus`.
//
// These drive the REAL store (over an in-memory stand-in for the mongodb driver) into the
// REAL cursor — the store-into-cursor seam, as noema-373's regression test does — because the
// bookkeeping is a property of the two together, not of either alone.

// ── An in-memory stand-in for the driver surface MongoCollectio uses ──────────

type Doc = Record<string, unknown>

class FakeCol {
  readonly docs: Doc[] = []

  async insertOne(doc: Doc): Promise<{ acknowledged: true }> {
    // Structured-clone the write the way a round-trip through the wire would: the store
    // only ever sees back what it actually persisted.
    this.docs.push(structuredClone(doc))
    return { acknowledged: true }
  }

  async findOne(sel: Doc): Promise<Doc | null> {
    const hit = this.docs.find(d => this._matches(d, sel))
    return hit ? structuredClone(hit) : null
  }

  find(sel: Doc): { toArray: () => Promise<Doc[]> } {
    const hits = this.docs.filter(d => this._matches(d, sel))
    return { toArray: async () => hits.map(d => structuredClone(d)) }
  }

  async findOneAndUpdate(sel: Doc, update: Doc): Promise<Doc | null> {
    const doc = this.docs.find(d => this._matches(d, sel))
    if (!doc) return null
    Object.assign(doc, (update.$set as Doc) ?? {})
    for (const key of Object.keys((update.$unset as Doc) ?? {})) delete doc[key]
    return structuredClone(doc)
  }

  private _matches(doc: Doc, sel: Doc): boolean {
    return Object.entries(sel).every(([k, v]) => doc[k] === v)
  }

  as(): Collection<Document> { return this as unknown as Collection<Document> }
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

/** A held run's shape: a small target, the window wide enough to dispatch it in one pass. */
const draftInput = {
  nomen: 'held run',
  modusId: 'flux-schnell',
  aditusBase: {},
  tractus: [{ porta: 'seed', valores: [{ value: 1 }, { value: 2 }, { value: 3 }] }],
  numerus: 3,
  provenanceHash: `sha256:${'0'.repeat(64)}`,
  by: { animaId: 'anima-1' } as { animaId: string },
  concurrentia: 3,
  reviewEnabled: true,
  status: 'draft' as const,
}

interface ActorumStub extends Actorum {
  store: Map<string, Actum>
}

function makeActorum(): ActorumStub {
  const store = new Map<string, Actum>()
  return {
    store,
    async create(actum: Omit<Actum, 'inceptum'>) { const a = { ...actum, inceptum: new Date() } as Actum; store.set(a.id, a); return a },
    async update(id: string, patch: Partial<Actum>) {
      const existing = store.get(id)
      if (!existing) throw new Error(`Actum '${id}' not found`)
      const updated = { ...existing, ...patch } as Actum
      store.set(id, updated)
      return updated
    },
    async findById(id: string) { return store.get(id) ?? null },
    async findByExternusJobId() { return null },
    async findExpired() { return [] },
  } as unknown as ActorumStub
}

/**
 * A rig around the real store + real cursor: an async-pod dispatch (the production shape —
 * the piece parks and a webhook settles it later), and the two moves a webhook makes.
 */
function makeRig(actorum: ActorumStub = makeActorum()) {
  const col = new FakeCol()
  const store = new MongoCollectio(col.as())
  const dispatched: string[] = []
  let n = 0

  const dispatch = async (_inceptio: Inceptio): Promise<{ actum: Actum; exitus?: Record<string, unknown> }> => {
    const actum = { id: `actum-${++n}`, status: 'agens', modusId: draftInput.modusId } as Actum
    actorum.store.set(actum.id, actum)
    dispatched.push(actum.id)
    return { actum }
  }

  const cursor = new CollectioCursor(dispatch, store, actorum, { reviewEnabled: false })

  /** What the webhook does for a piece that produced an image: settle the actum, tell the cursor. */
  const complete = async (collectioId: string, actumId: string): Promise<void> => {
    await actorum.update(actumId, { status: 'completus', exitus: { images: ['image'] } } as Partial<Actum>)
    await cursor.onActumCompleta(collectioId, actumId, true)
  }

  return { col, store, actorum, cursor, dispatch, dispatched, complete }
}

/** Fire a draft the way `fireCollection` does, and return the collection id. */
async function fire(store: MongoCollectio, cursor: CollectioCursor): Promise<string> {
  const draft = await store.create(draftInput)
  const fired = await store.update(draft.id, { status: 'nascens' })
  await cursor.start(fired)
  return draft.id
}

// ── A held completion is counted, and it is in acta ───────────────────────────

test('a review-held completion lands in acta and is counted in pendentes', async () => {
  const { store, cursor, dispatched, complete } = makeRig()
  const id = await fire(store, cursor)

  await complete(id, dispatched[0]!)
  await complete(id, dispatched[1]!)

  const c = (await store.find(id))!
  assert.equal(c.pendentes, 2, 'a generated piece held for review is counted in pendentes')
  assert.equal(c.completae, 0, 'it is not yet accepted, so it is not in completae')
  assert.equal(c.fractae, 0, 'a held piece generated — it is not a failure')
  assert.equal(c.reiectae, 0, 'nobody rejected anything')
  assert.deepEqual(
    c.acta.slice(0, 2),
    [dispatched[0], dispatched[1]],
    'the collection records the pieces it paid for, held or not',
  )
})

test('the poll target reports the held work rather than a run that produced nothing', async () => {
  const { store, cursor, dispatched, complete } = makeRig()
  const id = await fire(store, cursor)

  await complete(id, dispatched[0]!)
  await complete(id, dispatched[1]!)

  const view = toCollection((await store.find(id))!)
  assert.equal(view.pendingReview, 2, 'the projection carries the held pieces')
  assert.equal(view.completed, 0, 'held pieces are not accepted yet')
  assert.equal(view.failed, 0)
  assert.equal(
    view.completed + view.pendingReview + view.failed,
    2,
    'a caller can tell this run from one that produced nothing',
  )
})

// ── The counters reconcile against total ─────────────────────────────────────

test('the counters reconcile against total while pieces are in flight and held', async () => {
  const { store, cursor, dispatched, complete } = makeRig()
  const id = await fire(store, cursor)

  await complete(id, dispatched[0]!)

  const c = (await store.find(id))!
  // One held, two still executing, none outstanding — the window covers the whole target.
  const inFlight = 2
  const outstanding = c.numerus + c.reiectae - c.acta.length
  assert.equal(
    c.completae + c.pendentes + c.fractae + inFlight + outstanding,
    c.numerus,
    'every dispatched piece is in exactly one bucket, and the buckets sum to the target',
  )
})

// ── Approve / reject move the piece between counters ─────────────────────────

test('approving a held piece moves it from pendentes to completae', async () => {
  const { store, cursor, dispatched, complete } = makeRig()
  const id = await fire(store, cursor)

  await complete(id, dispatched[0]!)
  await cursor.approveActum(id, dispatched[0]!)

  const c = (await store.find(id))!
  assert.equal(c.completae, 1, 'an approved piece is generated AND accepted')
  assert.equal(c.pendentes, 0, 'it left the holding counter — it is not counted twice')
  assert.equal(c.reiectae, 0)
  assert.equal(c.fractae, 0)
})

test('rejecting a held piece moves it from pendentes to reiectae and extends the budget', async () => {
  const { store, cursor, dispatched, complete } = makeRig()
  const id = await fire(store, cursor)

  await complete(id, dispatched[0]!)
  await cursor.rejectAndRevive(id, dispatched[0]!)

  const c = (await store.find(id))!
  assert.equal(c.reiectae, 1, 'a rejection is counted as a rejection')
  assert.equal(c.pendentes, 0, 'the piece left the holding counter')
  assert.equal(c.fractae, 0, 'a rejection is NOT a failure')
  assert.equal(c.completae, 0, 'a declined piece never counts toward the target')
  assert.equal(
    c.acta.length,
    4,
    'the rejection extended the dispatch budget by one — a replacement piece was dispatched',
  )
})

test('a repeated review decision does not move a counter twice', async () => {
  const { store, cursor, dispatched, complete } = makeRig()
  const id = await fire(store, cursor)

  await complete(id, dispatched[0]!)
  await cursor.approveActum(id, dispatched[0]!)
  await cursor.approveActum(id, dispatched[0]!)
  await cursor.rejectAndRevive(id, dispatched[0]!)

  const c = (await store.find(id))!
  assert.equal(c.completae, 1, 'the piece is accepted once, however many times approve is called')
  assert.equal(c.reiectae, 0, 'a decided piece cannot then be rejected — that would extend the budget')
  assert.equal(c.pendentes, 0)
  assert.equal(c.acta.length, 3, 'no phantom replacement was dispatched')
})

// ── A decision that arrives after a restart ──────────────────────────────────

test('a review decision after a restart still moves the counters', async () => {
  const actorum = makeActorum()
  const first = makeRig(actorum)
  const id = await fire(first.store, first.cursor)
  await first.complete(id, first.dispatched[0]!)

  // Restart: a fresh cursor over the same store and the same acta, with no in-memory state.
  const restarted = new CollectioCursor(first.dispatch, first.store, actorum, { reviewEnabled: false })
  await restarted.approveActum(id, first.dispatched[0]!)

  const c = (await first.store.find(id))!
  assert.equal(c.completae, 1, 'approval reconstructs state from the record rather than falling through')
  assert.equal(c.pendentes, 0)
  const actum = await actorum.findById(first.dispatched[0]!)
  assert.equal(actum?.exitus?.reviewOutcome, 'approved', 'the piece itself carries the decision')
})

// ── Terminal ─────────────────────────────────────────────────────────────────

test('the counters reconcile at terminal, across a rejection and its replacement', async () => {
  const { store, cursor, dispatched, complete } = makeRig()
  const id = await fire(store, cursor)

  // Every piece of the original target generates.
  for (const actumId of [...dispatched]) await complete(id, actumId)

  // One is declined — its replacement is dispatched, generates, and is approved.
  await cursor.rejectAndRevive(id, dispatched[0]!)
  const replacement = dispatched[dispatched.length - 1]!
  await complete(id, replacement)

  for (const actumId of [dispatched[1]!, dispatched[2]!, replacement]) {
    await cursor.approveActum(id, actumId)
  }

  const c = (await store.find(id))!
  assert.equal(c.status, 'completa', 'nothing in flight and nothing held — the run is settled')
  assert.equal(c.pendentes, 0, 'no piece is left holding at terminal')
  assert.equal(c.completae, 3)
  assert.equal(c.reiectae, 1)
  assert.equal(c.fractae, 0)
  assert.equal(
    c.completae + c.pendentes + c.fractae,
    c.numerus,
    'at terminal the accepted, held and failed pieces account for the whole target',
  )
  assert.equal(c.acta.length, c.numerus + c.reiectae, 'the collection paid for the target plus one re-roll')
})

// ── A legacy record, written before the counter existed ──────────────────────

test('a doc persisted without pendentes reads back as 0 and still decides coherently', async () => {
  const actorum = makeActorum()
  const { col, store, cursor } = makeRig(actorum)

  // A held piece that predates the counter: on the record, in acta, marked pending.
  actorum.store.set('actum-legacy', {
    id: 'actum-legacy',
    status: 'completus',
    modusId: draftInput.modusId,
    exitus: { reviewOutcome: 'pending' },
  } as unknown as Actum)
  col.docs.push({
    ...draftInput,
    id: 'col-legacy',
    natum: new Date(),
    acta: ['actum-legacy'],
    completae: 0,
    fractae: 0,
    impetusTotal: '0',
    status: 'agens',
  })

  const before = (await store.find('col-legacy'))!
  assert.equal(before.pendentes, 0, 'an absent counter reads back as 0, never undefined')

  await cursor.approveActum('col-legacy', 'actum-legacy')

  const after = (await store.find('col-legacy'))!
  assert.equal(after.completae, 1, 'the decision still lands')
  assert.equal(after.pendentes, 0, 'a counter at 0 stays at 0 — it never goes negative')
})
