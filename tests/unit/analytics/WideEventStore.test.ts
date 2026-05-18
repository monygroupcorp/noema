import { test } from 'node:test'
import assert from 'node:assert/strict'
import { WideEventStore } from '../../../src/analytics/WideEventStore.js'
import type { WideEventDoc } from '../../../src/analytics/WideEventStore.js'
import type { WideEvent } from '../../../src/lib/wide.js'

// ---------------------------------------------------------------------------
// Minimal in-memory MongoDB collection mock
// ---------------------------------------------------------------------------

function makeWideEvent(overrides: Partial<WideEvent> = {}): WideEvent {
  return {
    event:         'actum.complete',
    ts:            new Date().toISOString(),
    actumId:       `actum-${Math.random().toString(36).slice(2)}`,
    modusId:       'test.flux-dev',
    modusVersiono: '1.0.0',
    byType:        'animaId',
    reservation:   '1000000000000000',
    impetus:       '800000000000000',
    refund:        '200000000000000',
    durationMs:    1234,
    coldStart:     false,
    status:        'completed',
    ...overrides,
  }
}

function makeMockCollection(docs: WideEventDoc[] = []) {
  return {
    docs,
    async insertOne(doc: WideEventDoc) {
      this.docs.push({ ...doc })
      return { insertedId: doc.actumId }
    },
    find(q: Record<string, unknown>) {
      let results = [...this.docs]

      // Filter by animaId
      if (q.animaId !== undefined) {
        results = results.filter(d => d.animaId === q.animaId)
      }
      // Filter by modusId
      if (q.modusId !== undefined) {
        results = results.filter(d => d.modusId === q.modusId)
      }
      // Filter by status
      if (q.status !== undefined) {
        results = results.filter(d => d.status === q.status)
      }
      // Filter by ts >= since
      if (q.ts !== undefined && typeof q.ts === 'object' && q.ts !== null) {
        const since = (q.ts as { $gte: string }).$gte
        results = results.filter(d => d.ts >= since)
      }

      let sorted = results.sort((a, b) => b.ts.localeCompare(a.ts))
      let limitVal = 100

      return {
        sort(_s: unknown) { return this },
        limit(n: number) { limitVal = n; return this },
        async toArray() { return sorted.slice(0, limitVal) },
      }
    },
  }
}

function makeStoreWithMock(docs: WideEventDoc[] = []): { store: WideEventStore; col: ReturnType<typeof makeMockCollection> } {
  const col = makeMockCollection(docs)
  const fakeDb = {
    collection(_name: string) { return col as unknown as import('mongodb').Collection },
  } as unknown as import('mongodb').Db
  const store = new WideEventStore(fakeDb)
  return { store, col }
}

// ---------------------------------------------------------------------------
// Test 1 — save() inserts a document into the collection
// ---------------------------------------------------------------------------

test('save() inserts a document into the collection', async () => {
  const { store, col } = makeStoreWithMock()
  const wide = makeWideEvent()

  await store.save(wide)

  assert.equal(col.docs.length, 1)
  assert.equal(col.docs[0].actumId, wide.actumId)
  assert.ok(col.docs[0].savedAt, 'savedAt should be set')
})

// ---------------------------------------------------------------------------
// Test 2 — query() filters by modusId
// ---------------------------------------------------------------------------

test('query() filters by modusId', async () => {
  const wideA = makeWideEvent({ modusId: 'test.flux-dev' }) as WideEventDoc
  const wideB = makeWideEvent({ modusId: 'test.sdxl' }) as WideEventDoc
  const { store } = makeStoreWithMock([
    { ...wideA, savedAt: new Date().toISOString() },
    { ...wideB, savedAt: new Date().toISOString() },
  ])

  const results = await store.query({ modusId: 'test.flux-dev' })

  assert.equal(results.length, 1)
  assert.equal(results[0].modusId, 'test.flux-dev')
})

// ---------------------------------------------------------------------------
// Test 3 — query() filters by status: 'failed'
// ---------------------------------------------------------------------------

test('query() filters by status: failed', async () => {
  const wideOk   = makeWideEvent({ status: 'completed', actumId: 'a1' }) as WideEventDoc
  const wideFail = makeWideEvent({ status: 'failed',    actumId: 'a2' }) as WideEventDoc
  const { store } = makeStoreWithMock([
    { ...wideOk,   savedAt: new Date().toISOString() },
    { ...wideFail, savedAt: new Date().toISOString() },
  ])

  const results = await store.query({ status: 'failed' })

  assert.equal(results.length, 1)
  assert.equal(results[0].status, 'failed')
  assert.equal(results[0].actumId, 'a2')
})

// ---------------------------------------------------------------------------
// Test 4 — query() filters by since date
// ---------------------------------------------------------------------------

test('query() filters by since date', async () => {
  const old  = makeWideEvent({ ts: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(), actumId: 'old' }) as WideEventDoc
  const fresh = makeWideEvent({ ts: new Date().toISOString(), actumId: 'fresh' }) as WideEventDoc
  const { store } = makeStoreWithMock([
    { ...old,   savedAt: new Date().toISOString() },
    { ...fresh, savedAt: new Date().toISOString() },
  ])

  const since = new Date(Date.now() - 60 * 60 * 1000) // 1 hour ago
  const results = await store.query({ since })

  assert.equal(results.length, 1)
  assert.equal(results[0].actumId, 'fresh')
})

// ---------------------------------------------------------------------------
// Test 5 — totals() sums impetus field across all docs since given date
// ---------------------------------------------------------------------------

test('totals() sums impetus across all docs since given date', async () => {
  const doc1 = makeWideEvent({ impetus: '100', status: 'completed', actumId: 'b1' }) as WideEventDoc
  const doc2 = makeWideEvent({ impetus: '200', status: 'completed', actumId: 'b2' }) as WideEventDoc
  const { store } = makeStoreWithMock([
    { ...doc1, savedAt: new Date().toISOString() },
    { ...doc2, savedAt: new Date().toISOString() },
  ])

  const result = await store.totals(new Date(Date.now() - 24 * 60 * 60 * 1000))

  assert.equal(result.revenue, 300n)
  assert.equal(result.count, 2)
})

// ---------------------------------------------------------------------------
// Test 6 — totals() counts failed docs correctly
// ---------------------------------------------------------------------------

test('totals() counts failed docs correctly', async () => {
  const ok1  = makeWideEvent({ status: 'completed', actumId: 'c1', impetus: '100' }) as WideEventDoc
  const ok2  = makeWideEvent({ status: 'completed', actumId: 'c2', impetus: '50' })  as WideEventDoc
  const fail = makeWideEvent({ status: 'failed',    actumId: 'c3', impetus: '0' })   as WideEventDoc
  const { store } = makeStoreWithMock([
    { ...ok1,  savedAt: new Date().toISOString() },
    { ...ok2,  savedAt: new Date().toISOString() },
    { ...fail, savedAt: new Date().toISOString() },
  ])

  const result = await store.totals(new Date(Date.now() - 24 * 60 * 60 * 1000))

  assert.equal(result.count, 3)
  assert.equal(result.failed, 1)
  assert.equal(result.revenue, 150n)
})
