import { test, before, after, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { MongoClient, Collection } from 'mongodb'
import { MongoSignorum } from '../../../src/crystal/MongoSignorum.js'
import type { Signum } from '../../../src/types/significandi.js'

const URI = process.env.MONGO_PASS ?? process.env.MONGODB_URI ?? 'mongodb://localhost:27017'
const DB = 'noemaplane_test'
const COL = 'signa_unit'

let client: MongoClient
let col: Collection
let signorum: MongoSignorum

function makeSignum(overrides: Partial<Omit<Signum, 'id' | 'natum' | 'status'>> = {}): Omit<Signum, 'id' | 'natum' | 'status'> {
  return {
    forma: 'minted',
    valor: 100n,
    auctor: 'system:test',
    animaId: 'anima-abc',
    ...overrides,
  }
}

before(async () => {
  client = new MongoClient(URI)
  await client.connect()
  col = client.db(DB).collection(COL)
  await col.createIndex({ id: 1 }, { unique: true })
  signorum = new MongoSignorum(col)
})

afterEach(async () => {
  await col.deleteMany({})
})

after(async () => {
  await client.db(DB).dropCollection(COL).catch(() => {})
  await client.close()
})

// ── issue ─────────────────────────────────────────────────────────────────────

test('issue returns signum with id, natum, and status valid', async () => {
  const s = await signorum.issue(makeSignum())
  assert.ok(s.id)
  assert.ok(s.natum instanceof Date)
  assert.equal(s.status, 'valid')
})

test('issue persists valor as bigint through round-trip', async () => {
  const s = await signorum.issue(makeSignum({ valor: 999n }))
  const history = await signorum.history({ animaId: 'anima-abc' })
  assert.equal(history[0].valor, 999n)
  assert.equal(typeof history[0].valor, 'bigint')
})

test('issue zero valor round-trips correctly', async () => {
  const s = await signorum.issue(makeSignum({ valor: 0n }))
  assert.equal(s.valor, 0n)
})

test('issue large valor round-trips correctly', async () => {
  const large = 9_007_199_254_740_993n // beyond Number.MAX_SAFE_INTEGER
  const s = await signorum.issue(makeSignum({ valor: large }))
  const found = (await signorum.history({ animaId: 'anima-abc' }))[0]
  assert.equal(found.valor, large)
})

test('issue enforces privacy invariant: arcanum forma must not have animaId', async () => {
  await assert.rejects(
    () => signorum.issue(makeSignum({ forma: 'arcanum', animaId: 'anima-abc', testis: 'abc123' })),
    /privacy/i
  )
})

test('issue enforces privacy invariant: tessera forma must not have animaId', async () => {
  await assert.rejects(
    () => signorum.issue(makeSignum({ forma: 'tessera', animaId: 'anima-abc' })),
    /privacy/i
  )
})

test('issue arcanum without animaId succeeds', async () => {
  const s = await signorum.issue({ forma: 'arcanum', valor: 50n, auctor: 'system', testis: 'deadbeef' })
  assert.equal(s.forma, 'arcanum')
  assert.equal(s.animaId, undefined)
})

// ── balance ───────────────────────────────────────────────────────────────────

test('balance returns 0n for unknown identity', async () => {
  const b = await signorum.balance({ animaId: 'nobody' })
  assert.equal(b, 0n)
})

test('balance sums all valid signa for animaId', async () => {
  await signorum.issue(makeSignum({ valor: 100n }))
  await signorum.issue(makeSignum({ valor: 250n }))
  const b = await signorum.balance({ animaId: 'anima-abc' })
  assert.equal(b, 350n)
})

test('balance excludes spent signa', async () => {
  const s = await signorum.issue(makeSignum({ valor: 100n }))
  await signorum.lock([s.id], 'actum-1')
  await signorum.settle([s.id], 100n, 'actum-1')
  const b = await signorum.balance({ animaId: 'anima-abc' })
  assert.equal(b, 0n)
})

test('balance excludes locked signa', async () => {
  const s = await signorum.issue(makeSignum({ valor: 100n }))
  await signorum.lock([s.id], 'actum-1')
  const b = await signorum.balance({ animaId: 'anima-abc' })
  assert.equal(b, 0n)
})

test('balance does not include other identities', async () => {
  await signorum.issue(makeSignum({ animaId: 'anima-abc', valor: 100n }))
  await signorum.issue(makeSignum({ animaId: 'anima-xyz', valor: 500n }))
  const b = await signorum.balance({ animaId: 'anima-abc' })
  assert.equal(b, 100n)
})

test('balance works by commitment', async () => {
  await signorum.issue({ forma: 'arcanum', valor: 200n, auctor: 'system', testis: 'myhash' })
  const b = await signorum.balance({ commitment: 'myhash' })
  assert.equal(b, 200n)
})

// ── lock ──────────────────────────────────────────────────────────────────────

test('lock changes signum status to locked', async () => {
  const s = await signorum.issue(makeSignum())
  await signorum.lock([s.id], 'actum-1')
  const history = await signorum.history({ animaId: 'anima-abc' })
  assert.equal(history[0].status, 'locked')
})

test('lock sets actumId on locked signum', async () => {
  const s = await signorum.issue(makeSignum())
  await signorum.lock([s.id], 'actum-99')
  const history = await signorum.history({ animaId: 'anima-abc' })
  assert.equal(history[0].actumId, 'actum-99')
})

test('lock is atomic — locks all or nothing on success', async () => {
  const a = await signorum.issue(makeSignum({ valor: 50n }))
  const b = await signorum.issue(makeSignum({ valor: 75n }))
  await signorum.lock([a.id, b.id], 'actum-1')
  const history = await signorum.history({ animaId: 'anima-abc' })
  assert.ok(history.every(s => s.status === 'locked'))
})

// ── release ───────────────────────────────────────────────────────────────────

test('release restores locked signum to valid', async () => {
  const s = await signorum.issue(makeSignum())
  await signorum.lock([s.id], 'actum-1')
  await signorum.release([s.id])
  const b = await signorum.balance({ animaId: 'anima-abc' })
  assert.equal(b, 100n)
})

test('release is no-op on spent signa — does not throw or resurrect', async () => {
  const s = await signorum.issue(makeSignum())
  await signorum.lock([s.id], 'actum-1')
  await signorum.settle([s.id], 100n, 'actum-1')
  await assert.doesNotReject(() => signorum.release([s.id]))
  const b = await signorum.balance({ animaId: 'anima-abc' })
  // settle issued a 0n refund (actualImpetus == total), balance stays 0
  assert.equal(b, 0n)
})

// ── history ───────────────────────────────────────────────────────────────────

test('history returns all signa regardless of status', async () => {
  const a = await signorum.issue(makeSignum({ valor: 50n }))
  const b = await signorum.issue(makeSignum({ valor: 75n }))
  await signorum.lock([a.id], 'actum-1')
  const history = await signorum.history({ animaId: 'anima-abc' })
  assert.equal(history.length, 2)
})

test('history returns empty array for unknown identity', async () => {
  const h = await signorum.history({ animaId: 'ghost' })
  assert.deepEqual(h, [])
})

test('history does not return other identities signa', async () => {
  await signorum.issue(makeSignum({ animaId: 'anima-abc' }))
  await signorum.issue(makeSignum({ animaId: 'anima-xyz' }))
  const h = await signorum.history({ animaId: 'anima-abc' })
  assert.equal(h.length, 1)
  assert.equal(h[0].animaId, 'anima-abc')
})

// ── settle ────────────────────────────────────────────────────────────────────

test('settle marks all signa as spent', async () => {
  const a = await signorum.issue(makeSignum({ valor: 100n }))
  const b = await signorum.issue(makeSignum({ valor: 200n }))
  await signorum.lock([a.id, b.id], 'actum-1')
  await signorum.settle([a.id, b.id], 300n, 'actum-1')
  const history = await signorum.history({ animaId: 'anima-abc' })
  const spent = history.filter(s => s.status === 'spent')
  assert.equal(spent.length, 2)
})

test('settle issues refund signum for delta when actualImpetus < total', async () => {
  const s = await signorum.issue(makeSignum({ valor: 300n }))
  await signorum.lock([s.id], 'actum-1')
  await signorum.settle([s.id], 100n, 'actum-1') // used 100 of 300
  const b = await signorum.balance({ animaId: 'anima-abc' })
  assert.equal(b, 200n) // 300 - 100 = 200 refunded
})

test('settle refund signum has forma minted and auctor system:refund', async () => {
  const s = await signorum.issue(makeSignum({ valor: 300n }))
  await signorum.lock([s.id], 'actum-1')
  await signorum.settle([s.id], 100n, 'actum-1')
  const history = await signorum.history({ animaId: 'anima-abc' })
  const refund = history.find(s => s.status === 'valid')
  assert.ok(refund)
  assert.equal(refund.forma, 'minted')
  assert.equal(refund.auctor, 'system:refund')
  assert.equal(refund.valor, 200n)
})

test('settle issues no refund when actualImpetus equals total locked', async () => {
  const s = await signorum.issue(makeSignum({ valor: 100n }))
  await signorum.lock([s.id], 'actum-1')
  await signorum.settle([s.id], 100n, 'actum-1')
  const history = await signorum.history({ animaId: 'anima-abc' })
  assert.equal(history.length, 1) // only the original, no refund
  assert.equal(history[0].status, 'spent')
})

test('settle refund preserves identity — goes back to same animaId', async () => {
  const s = await signorum.issue(makeSignum({ animaId: 'anima-specific', valor: 500n }))
  await signorum.lock([s.id], 'actum-1')
  await signorum.settle([s.id], 200n, 'actum-1')
  const history = await signorum.history({ animaId: 'anima-specific' })
  const refund = history.find(h => h.status === 'valid')
  assert.ok(refund)
  assert.equal(refund.animaId, 'anima-specific')
  assert.equal(refund.valor, 300n)
})

test('settle sets expensum timestamp on spent signa', async () => {
  const before = new Date()
  const s = await signorum.issue(makeSignum())
  await signorum.lock([s.id], 'actum-1')
  await signorum.settle([s.id], 100n, 'actum-1')
  const history = await signorum.history({ animaId: 'anima-abc' })
  const spent = history.find(h => h.status === 'spent')
  assert.ok(spent?.expensum)
  assert.ok(spent!.expensum! >= before)
})

test('settle handles multiple signa across the total correctly', async () => {
  const a = await signorum.issue(makeSignum({ valor: 100n }))
  const b = await signorum.issue(makeSignum({ valor: 100n }))
  const c = await signorum.issue(makeSignum({ valor: 100n }))
  await signorum.lock([a.id, b.id, c.id], 'actum-1')
  await signorum.settle([a.id, b.id, c.id], 250n, 'actum-1') // used 250 of 300
  const bal = await signorum.balance({ animaId: 'anima-abc' })
  assert.equal(bal, 50n) // 50 refunded
})
