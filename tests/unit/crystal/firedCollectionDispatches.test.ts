import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Collection, Document } from 'mongodb'
import type { Collectio } from '../../../src/types/collectio.js'
import type { Actum } from '../../../src/types/actum.js'
import type { Actorum, Inceptio } from '../../../src/types/cursus.js'
import { MongoCollectio } from '../../../src/crystal/MongoCollectio.js'
import { CollectioCursor } from '../../../src/crystal/CollectioCursor.js'

// =============================================================================
// noema-373 — a fired collection must actually reach the dispatcher.
// =============================================================================
//
// The live failure: `POST /v1/collectiones/:id/fire` returned 200, the collection went
// `agens`, and then nothing happened — 0 dispatched, 0 failed, 0 in flight, `acta: []`,
// purse untouched, for 301s. Every existing collection test stubs `Collectionum` with a
// hand-written fake that seeds `reiectae: 0`, so the one store production actually wires
// (`MongoCollectio`, src/container.ts) was never exercised by the fan-out. It did not seed
// `reiectae`, so `numerus + reiectae` — the CollectioCursor's dispatch budget — was NaN and
// the `nextIndex < totalPieces` guard was false on the very first iteration.
//
// These tests drive the REAL store (over an in-memory stand-in for the mongodb driver) into
// the REAL cursor, which is the seam that had no coverage.

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
    return this.docs.find(d => this._matches(d, sel)) ?? null
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

/** The incident's shape: 24 pieces, the default concurrency of 3. */
const draftInput = {
  nomen: 'landing dataset',
  modusId: 'flux-schnell',
  aditusBase: {},
  tractus: [{ porta: 'seed', valores: [{ value: 1 }, { value: 2 }, { value: 3 }] }],
  numerus: 24,
  provenanceHash: `sha256:${'0'.repeat(64)}`,
  by: { animaId: 'anima-1' } as { animaId: string },
  concurrentia: 3,
  status: 'draft' as const,
}

function makeActorum(): Actorum {
  const store = new Map<string, Actum>()
  return {
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
  } as unknown as Actorum
}

/** A dispatch that parks for a webhook (async pod) — the production shape. */
function makeDispatch() {
  const seen: Inceptio[] = []
  let n = 0
  const dispatch = async (inceptio: Inceptio): Promise<{ actum: Actum; exitus?: Record<string, unknown> }> => {
    seen.push(inceptio)
    return { actum: { id: `actum-${++n}`, status: 'agens' } as Actum }
  }
  return { dispatch, seen }
}

// ── Test 1: the store seeds the counter it owns ──────────────────────────────

test('MongoCollectio.create seeds reiectae — the persisted doc carries the dispatch budget', async () => {
  const col = new FakeCol()
  const store = new MongoCollectio(col.as())

  const created = await store.create(draftInput)

  assert.equal(created.reiectae, 0, 'create must seed reiectae, not leave it to the caller')
  assert.equal(col.docs[0]!.reiectae, 0, 'reiectae must reach the persisted document')
  assert.equal(
    created.numerus + created.reiectae,
    24,
    'numerus + reiectae is the dispatch budget — it must be a number, never NaN',
  )
})

// ── Test 2: docs already persisted without the field read back as 0 ──────────

test('MongoCollectio.find defaults a legacy doc with no reiectae to 0', async () => {
  const col = new FakeCol()
  const store = new MongoCollectio(col.as())

  // Exactly what the two incident collections look like on disk today.
  col.docs.push({
    ...draftInput,
    id: 'col-legacy',
    natum: new Date(),
    acta: [],
    completae: 0,
    fractae: 0,
    impetusTotal: '0',
    status: 'agens',
  })

  const found = await store.find('col-legacy')
  assert.equal(found?.reiectae, 0, 'a doc written without reiectae must read back as 0')
  assert.ok(!Number.isNaN(found!.numerus + found!.reiectae), 'dispatch budget must not be NaN')
})

// ── Test 3: THE INCIDENT — a fired collection reaches dispatch ───────────────

test('a fired collection reaches the dispatcher (noema-373)', async () => {
  const col = new FakeCol()
  const store = new MongoCollectio(col.as())
  const { dispatch, seen } = makeDispatch()
  const cursor = new CollectioCursor(dispatch, store, makeActorum(), { reviewEnabled: false })

  const draft = await store.create(draftInput)

  // What fireCollection does: freeze provenance, flip to nascens, hand the record to the cursor.
  const fired = await store.update(draft.id, { status: 'nascens' })
  await cursor.start(fired)

  assert.equal(
    seen.length,
    draftInput.concurrentia,
    'fire must fill the concurrency window — before the fix this was 0 and the collection sat agens forever',
  )

  const after = await store.find(draft.id)
  assert.equal(after?.status, 'agens', 'a dispatching collection is agens')
  assert.equal(after?.acta.length, draftInput.concurrentia, 'every dispatched piece is recorded in acta')
  assert.equal(after?.fractae, 0, 'no dispatch failed — these pieces are in flight')
})

// ── Test 4: restart liveness (#476) also depends on a numeric budget ─────────

test('rehydrate re-enters the fan-out for an agens collection persisted without reiectae', async () => {
  const col = new FakeCol()
  const store = new MongoCollectio(col.as())
  const { dispatch, seen } = makeDispatch()
  const cursor = new CollectioCursor(dispatch, store, makeActorum(), { reviewEnabled: false })

  // A collection stranded by the bug: agens, nothing in flight, nothing done.
  col.docs.push({
    ...draftInput,
    id: 'col-stranded',
    natum: new Date(),
    acta: [],
    completae: 0,
    fractae: 0,
    impetusTotal: '0',
    status: 'agens',
  })

  await cursor.rehydrate()

  assert.equal(
    seen.length,
    draftInput.concurrentia,
    'the orphan re-dispatch guard compares against numerus + reiectae — a NaN budget silently skipped it',
  )
})
