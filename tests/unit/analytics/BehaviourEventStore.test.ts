import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BehaviourEventStore } from '../../../src/analytics/BehaviourEventStore.js'
import type { BehaviourEventDoc } from '../../../src/analytics/BehaviourEventStore.js'
import type { BehaviourEvent } from '../../../src/analytics/BehaviourEvent.js'

function makeEvent(overrides: Partial<BehaviourEvent> = {}): BehaviourEvent {
  return {
    kind: 'catalog_view',
    ts: new Date().toISOString(),
    ownerKey: `commitment:${Math.random().toString(36).slice(2)}`,
    byType: 'commitment',
    device: { deviceClass: 'desktop', browserFamily: 'Chrome', browserMajor: 128, osFamily: 'Windows' },
    ...overrides,
  }
}

// Minimal in-memory Mongo collection mock — find/insertOne (mirrors WideEventStore.test.ts)
// plus a hand-rolled aggregate() covering exactly the two pipeline shapes this store issues
// ($group by kind with $sum, and $group by kind with $addToSet).
function makeMockCollection(docs: BehaviourEventDoc[] = []) {
  return {
    docs,
    async insertOne(doc: BehaviourEventDoc) {
      this.docs.push({ ...doc })
      return { insertedId: 'ignored' }
    },
    find(q: Record<string, unknown>) {
      let results = [...this.docs]
      if (q.kind !== undefined) results = results.filter(d => d.kind === q.kind)
      if (q.ownerKey !== undefined) results = results.filter(d => d.ownerKey === q.ownerKey)
      if (q.ts !== undefined && typeof q.ts === 'object' && q.ts !== null) {
        const since = (q.ts as { $gte: string }).$gte
        results = results.filter(d => d.ts >= since)
      }
      const sorted = results.sort((a, b) => b.ts.localeCompare(a.ts))
      let limitVal = 100
      return {
        sort(_s: unknown) { return this },
        limit(n: number) { limitVal = n; return this },
        async toArray() { return sorted.slice(0, limitVal) },
      }
    },
    aggregate<T>(pipeline: Array<Record<string, unknown>>) {
      const match = pipeline.find(s => '$match' in s)?.['$match'] as { ts?: { $gte: string } } | undefined
      const group = pipeline.find(s => '$group' in s)?.['$group'] as Record<string, unknown>
      let rows = [...this.docs]
      if (match?.ts?.$gte) rows = rows.filter(d => d.ts >= match.ts!.$gte)
      const byKind = new Map<string, BehaviourEventDoc[]>()
      for (const d of rows) byKind.set(d.kind, [...(byKind.get(d.kind) ?? []), d])
      const usesAddToSet = JSON.stringify(group).includes('$addToSet')
      const out = Array.from(byKind.entries()).map(([kind, kindDocs]) =>
        usesAddToSet
          ? { _id: kind, owners: Array.from(new Set(kindDocs.map(d => d.ownerKey))) }
          : { _id: kind, count: kindDocs.length },
      )
      return { async toArray() { return out as T[] } }
    },
  }
}

function makeStoreWithMock(docs: BehaviourEventDoc[] = []) {
  const col = makeMockCollection(docs)
  const fakeDb = { collection(_name: string) { return col as unknown as import('mongodb').Collection } } as unknown as import('mongodb').Db
  return { store: new BehaviourEventStore(fakeDb), col }
}

test('save() inserts a document with savedAt stamped', async () => {
  const { store, col } = makeStoreWithMock()
  await store.save(makeEvent())
  assert.equal(col.docs.length, 1)
  assert.ok(col.docs[0].savedAt)
})

test('query() filters by kind and ownerKey', async () => {
  const a = makeEvent({ kind: 'catalog_view', ownerKey: 'commitment:a' })
  const b = makeEvent({ kind: 'sign_in', ownerKey: 'commitment:b' })
  const { store } = makeStoreWithMock([
    { ...a, savedAt: new Date().toISOString() },
    { ...b, savedAt: new Date().toISOString() },
  ])
  const results = await store.query({ kind: 'sign_in' })
  assert.equal(results.length, 1)
  assert.equal(results[0].ownerKey, 'commitment:b')
})

test('totals() counts events per kind since the cutoff', async () => {
  const now = new Date().toISOString()
  const { store } = makeStoreWithMock([
    { ...makeEvent({ kind: 'catalog_view' }), ts: now, savedAt: now },
    { ...makeEvent({ kind: 'catalog_view' }), ts: now, savedAt: now },
    { ...makeEvent({ kind: 'sign_in' }), ts: now, savedAt: now },
  ])
  const totals = await store.totals(new Date(Date.now() - 60_000))
  assert.equal(totals.catalog_view, 2)
  assert.equal(totals.sign_in, 1)
})

test('distinctOwnersByKind() counts unique owners, not raw event volume', async () => {
  const now = new Date().toISOString()
  const { store } = makeStoreWithMock([
    { ...makeEvent({ kind: 'catalog_view', ownerKey: 'commitment:a' }), ts: now, savedAt: now },
    { ...makeEvent({ kind: 'catalog_view', ownerKey: 'commitment:a' }), ts: now, savedAt: now }, // same owner, refreshed
    { ...makeEvent({ kind: 'catalog_view', ownerKey: 'commitment:b' }), ts: now, savedAt: now },
  ])
  const owners = await store.distinctOwnersByKind(new Date(Date.now() - 60_000))
  assert.equal(owners.catalog_view, 2)
})
