import { test, before, after, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { MongoClient, Collection } from 'mongodb'
import { MongoSponsio } from '../../../src/crystal/MongoSponsio.js'

// Real-Mongo coverage for sponsorship pledges (ADR-0011 §2). The `claimCycle` CAS is
// the sweeper's idempotency guard under concurrency — only real Mongo proves that a
// race of N sweepers claiming the same cycle yields exactly ONE winner.

const URI = process.env.MONGO_PASS ?? process.env.MONGODB_URI ?? 'mongodb://localhost:27017'
const DB = 'noemaplane_test'
const COL = 'sponsiones_unit'

let client: MongoClient
let col: Collection
let store: MongoSponsio

before(async () => {
  client = new MongoClient(URI)
  await client.connect()
  col = client.db(DB).collection(COL)
  await col.deleteMany({})
  await col.createIndex({ id: 1 }, { unique: true })
  store = new MongoSponsio(col)
})

afterEach(async () => { await col.deleteMany({}) })
after(async () => {
  await client.db(DB).dropCollection(COL).catch(() => {})
  await client.close()
})

async function make(over: Record<string, unknown> = {}) {
  return store.create({
    sponsor: { animaId: 'sponsor' },
    beneficiarius: { animaId: 'friend' },
    subsidia: { grant: 100n, cadence: 'weekly' },
    ...over,
  } as never)
}

test('create → find round-trips bigints (grant/capTotal/drippedTotal)', async () => {
  const s = await make({ capTotal: 1000n, subsidia: { grant: 250n, cadence: 'monthly', balanceCap: 5000n } })
  const found = await store.find(s.id)
  assert.equal(found?.subsidia.grant, 250n)
  assert.equal(found?.subsidia.balanceCap, 5000n)
  assert.equal(found?.capTotal, 1000n)
  assert.equal(found?.drippedTotal, 0n)
  assert.equal(found?.status, 'active')
})

test('claimCycle CAS: exactly one of many concurrent claims wins', async () => {
  const s = await make()
  const results = await Promise.all(Array.from({ length: 12 }, () => store.claimCycle(s.id, '2026-W27')))
  assert.equal(results.filter(Boolean).length, 1, 'a single winner for the cycle')
  // A different cycle can still be claimed once.
  assert.equal(await store.claimCycle(s.id, '2026-W28'), true)
  assert.equal(await store.claimCycle(s.id, '2026-W28'), false)
})

test('releaseCycle re-opens the claim (fail-closed retry path)', async () => {
  const s = await make()
  assert.equal(await store.claimCycle(s.id, '2026-W27'), true)
  await store.releaseCycle(s.id, '2026-W27')
  assert.equal(await store.claimCycle(s.id, '2026-W27'), true, 'claimable again after release')
})

test('recordDrip accumulates and exhausts at capTotal', async () => {
  const s = await make({ capTotal: 150n })
  await store.recordDrip(s.id, 100n)
  assert.equal((await store.find(s.id))?.status, 'active')
  await store.recordDrip(s.id, 50n)
  const done = await store.find(s.id)
  assert.equal(done?.drippedTotal, 150n)
  assert.equal(done?.status, 'exhausted')
})

test('listActive excludes paused/exhausted; listBySponsor scopes to the owner', async () => {
  const a = await make()
  const b = await make({ sponsor: { animaId: 'other' } })
  await store.setStatus(b.id, 'paused')
  const active = await store.listActive()
  assert.deepEqual(active.map(s => s.id), [a.id])
  assert.equal((await store.listBySponsor('sponsor')).length, 1)
  assert.equal((await store.listBySponsor('other')).length, 1)
})
