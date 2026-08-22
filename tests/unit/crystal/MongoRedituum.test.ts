import { test, before, after, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { MongoClient, Collection } from 'mongodb'
import { MongoRedituum } from '../../../src/crystal/MongoRedituum.js'
import { USD } from '../../../src/types/reditus.js'

// MongoRedituum — the production USD revenue book. These prove the bits the memory store can't:
// bigint↔string round-trip through Mongo, and idempotency enforced by a real unique partial index
// (not a JS scan). Hits noemaplane_test on the configured cluster, isolated collection, cleaned up.

const URI = process.env.MONGO_PASS ?? process.env.MONGODB_URI ?? 'mongodb://localhost:27017'
const DB = 'noemaplane_test'
const COL = 'reditus_unit'

let client: MongoClient
let col: Collection
let redituum: MongoRedituum

before(async () => {
  client = new MongoClient(URI)
  await client.connect()
  col = client.db(DB).collection(COL)
  redituum = new MongoRedituum(col)
  await redituum.ensureIndexes()
})

afterEach(async () => {
  await col.deleteMany({})
})

after(async () => {
  await client.db(DB).dropCollection(COL).catch(() => {})
  await client.close()
})

test('record: round-trips usdFmv (bigint) through Mongo intact', async () => {
  const natum = new Date('2026-01-15T00:00:00Z')
  const rec = await redituum.record({ usdFmv: 250n * USD, fmvSource: 'chainlink@block-21000000', origo: 'crypto', depositumId: 'dep-1', natum })
  const back = await col.findOne({ id: rec.id })
  assert.equal((back as unknown as { usdFmv: string }).usdFmv, (250n * USD).toString())   // stored as string
  assert.equal(await redituum.trailingUsdRevenue(new Date('2026-02-01T00:00:00Z')), 250n * USD)  // revived as bigint
})

test('record: fail-closed on unpriced / unsourced deposits', async () => {
  await assert.rejects(() => redituum.record({ usdFmv: 0n, fmvSource: 'o', origo: 'crypto' }), /fail-closed: usdFmv/)
  await assert.rejects(() => redituum.record({ usdFmv: 5n * USD, fmvSource: '  ', origo: 'fiat' }), /fail-closed: fmvSource/)
})

test('record: idempotent on depositumId via the unique partial index — no double-count', async () => {
  const now = new Date('2026-07-01T00:00:00Z')
  const first = await redituum.record({ usdFmv: 100n * USD, fmvSource: 'o', origo: 'crypto', depositumId: 'dep-x', natum: now })
  const again = await redituum.record({ usdFmv: 100n * USD, fmvSource: 'o', origo: 'crypto', depositumId: 'dep-x', natum: now })
  assert.equal(again.id, first.id)
  assert.equal(await col.countDocuments({ depositumId: 'dep-x' }), 1)
  assert.equal(await redituum.trailingUsdRevenue(now), 100n * USD)
})

test('record: fiat rows (no depositumId) always append despite the partial index', async () => {
  const now = new Date('2026-07-01T00:00:00Z')
  await redituum.record({ usdFmv: 10n * USD, fmvSource: 'stripe:ch_1', origo: 'fiat', natum: now })
  await redituum.record({ usdFmv: 10n * USD, fmvSource: 'stripe:ch_2', origo: 'fiat', natum: now })
  assert.equal(await col.countDocuments({}), 2)
  assert.equal(await redituum.trailingUsdRevenue(now), 20n * USD)
})

test('record: idempotent on chargeRef (fiat) via the unique partial index — no double-book', async () => {
  const now = new Date('2026-07-01T00:00:00Z')
  const first = await redituum.record({ usdFmv: 25n * USD, fmvSource: 'stripe:pi_x', origo: 'fiat', chargeRef: 'pi_x', natum: now })
  const again = await redituum.record({ usdFmv: 25n * USD, fmvSource: 'stripe:pi_x', origo: 'fiat', chargeRef: 'pi_x', natum: now })
  assert.equal(again.id, first.id)                                              // replayed, not appended
  assert.equal(await col.countDocuments({ chargeRef: 'pi_x' }), 1)
  assert.equal(await redituum.trailingUsdRevenue(now), 25n * USD)               // revenue booked once
})

test('record: CONCURRENT same-chargeRef fiat rows collapse to ONE (the durable cross-instance guard)', async () => {
  const now = new Date('2026-07-01T00:00:00Z')
  const draft = { usdFmv: 50n * USD, fmvSource: 'stripe:pi_race', origo: 'fiat' as const, chargeRef: 'pi_race', natum: now }
  const rows = await Promise.all(Array.from({ length: 6 }, () => redituum.record({ ...draft })))
  const ids = new Set(rows.map(r => r.id))
  assert.equal(ids.size, 1, 'all concurrent records must resolve to the SAME single row')
  assert.equal(await col.countDocuments({ chargeRef: 'pi_race' }), 1)
  assert.equal(await redituum.trailingUsdRevenue(now), 50n * USD)               // booked exactly once
})

test('record: fiat chargeRef does NOT collide with a crypto depositumId of the same string', async () => {
  const now = new Date('2026-07-01T00:00:00Z')
  await redituum.record({ usdFmv: 5n * USD, fmvSource: 'o', origo: 'crypto', depositumId: 'shared_key', natum: now })
  await redituum.record({ usdFmv: 7n * USD, fmvSource: 'stripe:shared_key', origo: 'fiat', chargeRef: 'shared_key', natum: now })
  assert.equal(await col.countDocuments({}), 2)                                 // distinct keyspaces
  assert.equal(await redituum.trailingUsdRevenue(now), 12n * USD)
})

test('trailingUsdRevenue: window (now-12mo, now] excludes stale + future receipts', async () => {
  const now = new Date('2026-07-01T00:00:00Z')
  await redituum.record({ usdFmv: 500n * USD, fmvSource: 'o', origo: 'crypto', depositumId: 'd1', natum: new Date('2025-06-01T00:00:00Z') }) // >12mo → out
  await redituum.record({ usdFmv: 700n * USD, fmvSource: 'o', origo: 'crypto', depositumId: 'd2', natum: new Date('2025-08-01T00:00:00Z') }) // in
  await redituum.record({ usdFmv: 900n * USD, fmvSource: 'o', origo: 'crypto', depositumId: 'd3', natum: new Date('2026-08-01T00:00:00Z') }) // future → out
  assert.equal(await redituum.trailingUsdRevenue(now), 700n * USD)
})
