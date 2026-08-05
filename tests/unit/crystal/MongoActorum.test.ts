import { test, before, after, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { MongoClient, Collection } from 'mongodb'
import { MongoActorum } from '../../../src/crystal/MongoActorum.js'

const URI = process.env.MONGO_PASS ?? process.env.MONGODB_URI ?? 'mongodb://localhost:27017'
const DB = 'noemaplane_test'
const COL = 'acta_unit'

let client: MongoClient
let col: Collection
let acta: MongoActorum

function makeActum(overrides: Record<string, unknown> = {}) {
  return {
    id: `actum-${Math.random().toString(36).slice(2)}`,
    modusId: 'flux-schnell',
    modusVersiono: '1.0.0',
    impetus: 0n,
    signaConsumed: [],
    aditus: { prompt: 'a cat' },
    status: 'nascens' as const,
    expirat: new Date(Date.now() + 60_000),
    ...overrides,
  }
}

before(async () => {
  client = new MongoClient(URI)
  await client.connect()
  col = client.db(DB).collection(COL)
  await col.createIndex({ id: 1 }, { unique: true })
  acta = new MongoActorum(col)
})

afterEach(async () => {
  await col.deleteMany({})
})

after(async () => {
  await client.db(DB).dropCollection(COL).catch(() => {})
  await client.close()
})

// ── create ────────────────────────────────────────────────────────────────────

test('create returns actum with inceptum set', async () => {
  const before = new Date()
  const a = await acta.create(makeActum())
  assert.ok(a.inceptum >= before)
  assert.equal(a.status, 'nascens')
})

test('create persists actum readable by findById', async () => {
  const input = makeActum({ modusId: 'make.v2' })
  const created = await acta.create(input)
  const found = await acta.findById(created.id)
  assert.ok(found)
  assert.equal(found.modusId, 'make.v2')
})

test('create preserves bigint impetus through round-trip', async () => {
  const a = await acta.create(makeActum({ impetus: 42n }))
  const found = await acta.findById(a.id)
  assert.ok(found)
  assert.equal(typeof found.impetus, 'bigint')
  assert.equal(found.impetus, 42n)
})

test('create zero impetus round-trips correctly', async () => {
  const a = await acta.create(makeActum({ impetus: 0n }))
  const found = await acta.findById(a.id)
  assert.equal(found!.impetus, 0n)
})

// ── findById ──────────────────────────────────────────────────────────────────

test('findById returns null for unknown id', async () => {
  const result = await acta.findById('no-such-id')
  assert.equal(result, null)
})

// ── update ────────────────────────────────────────────────────────────────────

test('update patches status and completum', async () => {
  const a = await acta.create(makeActum())
  const completum = new Date()
  const updated = await acta.update(a.id, { status: 'completus', completum })
  assert.equal(updated.status, 'completus')
  assert.deepEqual(updated.completum, completum)
})

test('update patches impetus bigint', async () => {
  const a = await acta.create(makeActum())
  const updated = await acta.update(a.id, { impetus: 317n })
  assert.equal(updated.impetus, 317n)
  assert.equal(typeof updated.impetus, 'bigint')
})

test('update preserves untouched fields', async () => {
  const input = makeActum({ modusId: 'modus-preserved' })
  const a = await acta.create(input)
  const updated = await acta.update(a.id, { status: 'agens' })
  assert.equal(updated.modusId, 'modus-preserved')
})

test('update throws for unknown id', async () => {
  await assert.rejects(
    () => acta.update('ghost-id', { status: 'completus' }),
    /not found/i
  )
})

// ── findExpired ───────────────────────────────────────────────────────────────

test('findExpired returns nascens actum past expirat', async () => {
  const expired = makeActum({ expirat: new Date(Date.now() - 1000) })
  await acta.create(expired)
  const results = await acta.findExpired()
  assert.equal(results.length, 1)
  assert.equal(results[0].id, expired.id)
})

test('findExpired ignores nascens actum with future expirat', async () => {
  await acta.create(makeActum({ expirat: new Date(Date.now() + 60_000) }))
  const results = await acta.findExpired()
  assert.equal(results.length, 0)
})

test('findExpired ignores completus and fractus actum even if past expirat', async () => {
  await acta.create(makeActum({ status: 'completus', expirat: new Date(Date.now() - 1000) }))
  await acta.create(makeActum({ status: 'fractus', expirat: new Date(Date.now() - 1000) }))
  const results = await acta.findExpired()
  assert.equal(results.length, 0)
})

test('findExpired returns agens actum past expirat', async () => {
  const stuck = makeActum({ status: 'agens', expirat: new Date(Date.now() - 1000) })
  await acta.create(stuck)
  const results = await acta.findExpired()
  assert.equal(results.length, 1)
  assert.equal(results[0].id, stuck.id)
})

test('findExpired returns multiple expired actum', async () => {
  await acta.create(makeActum({ expirat: new Date(Date.now() - 2000) }))
  await acta.create(makeActum({ expirat: new Date(Date.now() - 1000) }))
  await acta.create(makeActum({ expirat: new Date(Date.now() + 60_000) })) // not expired
  const results = await acta.findExpired()
  assert.equal(results.length, 2)
})

// ── findByExternusJobId ───────────────────────────────────────────────────────

test('findByExternusJobId returns null when no actum has that externusJobId', async () => {
  const result = await acta.findByExternusJobId('ext-job-unknown')
  assert.equal(result, null)
})

test('findByExternusJobId returns actum with matching externusJobId', async () => {
  const input = makeActum({ externusJobId: 'ext-job-abc123' })
  const created = await acta.create(input)
  const found = await acta.findByExternusJobId('ext-job-abc123')
  assert.ok(found)
  assert.equal(found.id, created.id)
})

test('findByExternusJobId does not return actum with different externusJobId', async () => {
  await acta.create(makeActum({ externusJobId: 'ext-job-xyz' }))
  const result = await acta.findByExternusJobId('ext-job-other')
  assert.equal(result, null)
})

test('update can set externusJobId on an actum', async () => {
  const a = await acta.create(makeActum())
  const updated = await acta.update(a.id, { externusJobId: 'ext-job-set-via-update' })
  assert.equal(updated.externusJobId, 'ext-job-set-via-update')
})

test('findByExternusJobId finds actum whose externusJobId was set via update', async () => {
  const a = await acta.create(makeActum())
  await acta.update(a.id, { externusJobId: 'ext-job-updated' })
  const found = await acta.findByExternusJobId('ext-job-updated')
  assert.ok(found)
  assert.equal(found.id, a.id)
})
