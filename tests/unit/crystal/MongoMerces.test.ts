import { test, before, after, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { MongoClient, Collection } from 'mongodb'
import { MongoMerces } from '../../../src/crystal/MongoMerces.js'
import type { MercesDraft } from '../../../src/types/merces.js'

// Real-Mongo coverage for the payee-payout book (ADR-0013 §4c). The load-bearing bits:
// the unique-sourceRef accrual idempotency (a re-settled x402 payment must pay once) and the
// per-payee/per-year annualTotal rollup that the $600 gate reads. Only real Mongo proves both.

const URI = process.env.MONGO_PASS ?? process.env.MONGODB_URI ?? 'mongodb://localhost:27017'
const DB = 'noemaplane_test'
const COL = 'mercedes_unit'

let client: MongoClient
let col: Collection
let store: MongoMerces

function draft(over: Partial<MercesDraft> = {}): MercesDraft {
  return {
    payeeAnimaId: 'anima-1', payoutAddress: '0x' + 'a'.repeat(40),
    usdFmv: 100_000_000n, fmvSource: 'x402:margin-split', sourceRef: Math.random().toString(36).slice(2),
    kind: 'agent', natum: new Date('2026-03-01T00:00:00Z'), ...over,
  }
}

before(async () => {
  client = new MongoClient(URI)
  await client.connect()
  col = client.db(DB).collection(COL)
  await col.deleteMany({})
  await col.createIndex({ sourceRef: 1 }, { unique: true })
  store = new MongoMerces(col)
})
afterEach(async () => { await col.deleteMany({}) })
after(async () => {
  await client.db(DB).dropCollection(COL).catch(() => {})
  await client.close()
})

test('accrue stamps taxYear from natum + persists status', async () => {
  const m = await store.accrue(draft({ sourceRef: 's1' }), 'payable')
  assert.equal(m.taxYear, 2026)
  assert.equal(m.status, 'payable')
  assert.equal((await store.find(m.id))?.usdFmv, 100_000_000n)   // bigint round-trips
})

test('accrue is idempotent on sourceRef — a re-settle returns the existing row', async () => {
  const a = await store.accrue(draft({ sourceRef: 'dup', usdFmv: 100_000_000n }), 'payable')
  const b = await store.accrue(draft({ sourceRef: 'dup', usdFmv: 999_000_000n }), 'gated') // same event, different amount
  assert.equal(b.id, a.id)
  assert.equal(b.usdFmv, 100_000_000n)                            // first write wins; no double-pay
  assert.equal(await store.annualTotal('anima-1', 2026), 100_000_000n)
})

test('annualTotal sums one payee/year across all statuses; other payees + years excluded', async () => {
  await store.accrue(draft({ sourceRef: 'p1a', usdFmv: 300_000_000n }), 'payable')
  await store.accrue(draft({ sourceRef: 'p1b', usdFmv: 400_000_000n }), 'gated')   // gated still counts
  await store.accrue(draft({ sourceRef: 'p1c', usdFmv: 50_000_000n, natum: new Date('2025-06-01T00:00:00Z') }), 'paid') // other year
  await store.accrue(draft({ sourceRef: 'p2a', payeeAnimaId: 'anima-2', usdFmv: 999_000_000n }), 'payable') // other payee
  assert.equal(await store.annualTotal('anima-1', 2026), 700_000_000n)
  assert.equal(await store.annualTotal('anima-1', 2025), 50_000_000n)
})

test('fail-closed: non-positive usdFmv / empty fmvSource / empty sourceRef throw', async () => {
  await assert.rejects(() => store.accrue(draft({ usdFmv: 0n }), 'payable'), /positive/)
  await assert.rejects(() => store.accrue(draft({ fmvSource: '' }), 'payable'), /fmvSource/)
  await assert.rejects(() => store.accrue(draft({ sourceRef: '' }), 'payable'), /sourceRef/)
})

test('setStatus releases a gated row; listByPayee returns the year statement newest-first', async () => {
  const m1 = await store.accrue(draft({ sourceRef: 'l1', natum: new Date('2026-01-01T00:00:00Z') }), 'gated')
  await store.accrue(draft({ sourceRef: 'l2', natum: new Date('2026-02-01T00:00:00Z') }), 'payable')
  await store.setStatus(m1.id, 'payable')
  assert.equal((await store.find(m1.id))?.status, 'payable')
  const stmt = await store.listByPayee('anima-1', 2026)
  assert.deepEqual(stmt.map((m) => m.sourceRef), ['l2', 'l1'])   // newest first
})
