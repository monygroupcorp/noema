import { test, before, after, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { MongoClient, Collection } from 'mongodb'
import { MongoActumIndex } from '../../../src/crystal/MongoActumIndex.js'
import type { ActumIndex } from '../../../src/types/actumIndex.js'

const URI = process.env.MONGO_PASS ?? process.env.MONGODB_URI ?? 'mongodb://localhost:27017'
const DB = 'noemaplane_test'
const COL = 'actum_index_settle_unit'

let client: MongoClient
let col: Collection
let store: MongoActumIndex

before(async () => {
  client = new MongoClient(URI)
  await client.connect()
  col = client.db(DB).collection(COL)
  await col.deleteMany({})
  await col.createIndex({ actumId: 1 }, { unique: true })
  await col.createIndex({ animaId: 1, settledAt: -1, actumId: -1 })
  await col.createIndex({ commitment: 1, settledAt: -1, actumId: -1 })
  store = new MongoActumIndex(col)
})

afterEach(async () => { await col.deleteMany({}) })
after(async () => {
  await client.db(DB).dropCollection(COL).catch(() => {})
  await client.close()
})

function inFlight(over: Partial<ActumIndex> & Pick<ActumIndex, 'actumId'>): ActumIndex {
  return {
    animaId: 'anima-A',
    modusId: 'modus-x',
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    // `actumId` is required on the parameter, so the spread always supplies it.
    ...over,
  }
}

async function seedSettled(entry: ActumIndex, settledAt: Date, impetus: string, label = 'Label') {
  await store.record(entry)
  await store.settle(entry.actumId, { settledAt, impetus, modusLabel: label })
}

test('settle RETAINS the row (does not prune) and stamps settledAt + impetus + label', async () => {
  await seedSettled(inFlight({ actumId: 'a1' }), new Date('2026-07-02T00:00:00Z'), '900', 'Portrait')

  // findFor is IN-FLIGHT ONLY: a settled row is retained in the collection but must
  // NOT come back through findFor (the /status + GDPR-export surface). Otherwise
  // /status would fan out one actorum.findById per lifetime run and the export would
  // silently gain all settled runs.
  const forStatus = await store.findFor({ animaId: 'anima-A' })
  assert.equal(forStatus.length, 0)

  // The row is retained and stamped — reachable only as settled history.
  const page = await store.listSettled({ animaId: 'anima-A' }, { limit: 10 })
  assert.equal(page.entries.length, 1)
  assert.equal(page.entries[0].actumId, 'a1')
  assert.equal(page.entries[0].impetus, '900')
  assert.ok(page.entries[0].settledAt instanceof Date)
  assert.equal(page.entries[0].modusLabel, 'Portrait')
})

test('settle is idempotent (webhook at-least-once) and a no-op for an unknown/pruned row', async () => {
  await seedSettled(inFlight({ actumId: 'a1' }), new Date('2026-07-02T00:00:00Z'), '100')
  await store.settle('a1', { settledAt: new Date('2026-07-02T00:00:00Z'), impetus: '100', modusLabel: 'Label' })
  const page = await store.listSettled({ animaId: 'anima-A' }, { limit: 10 })
  assert.equal(page.entries.length, 1, 'no duplicate row from a repeat settle')

  // No-op when the row was never indexed: the real settled row survives, the ghost
  // creates nothing. (Checked via listSettled — findFor is in-flight-only and a1 is settled.)
  await store.settle('ghost', { settledAt: new Date(), impetus: '1', modusLabel: 'x' })
  const stillThere = await store.listSettled({ animaId: 'anima-A' }, { limit: 10 })
  assert.deepEqual(stillThere.entries.map(e => e.actumId), ['a1'])
})

test('listSettled is owner-scoped — a second owner (identified AND anon commitment) never leaks', async () => {
  await seedSettled(inFlight({ actumId: 'a1', animaId: 'anima-A' }), new Date('2026-07-02T00:00:00Z'), '100')
  await seedSettled(inFlight({ actumId: 'b1', animaId: 'anima-B' }), new Date('2026-07-02T00:00:00Z'), '200')
  await seedSettled(
    { actumId: 'c1', commitment: 'commit-C', modusId: 'm', createdAt: new Date('2026-07-01T00:00:00Z') },
    new Date('2026-07-02T00:00:00Z'), '300',
  )

  const a = await store.listSettled({ animaId: 'anima-A' }, { limit: 10 })
  assert.deepEqual(a.entries.map(e => e.actumId), ['a1'])

  const c = await store.listSettled({ commitment: 'commit-C' }, { limit: 10 })
  assert.deepEqual(c.entries.map(e => e.actumId), ['c1'])

  // Anon commitment listing must NOT surface any identified owner's rows.
  assert.ok(c.entries.every(e => e.commitment === 'commit-C' && !e.animaId))
})

test('listSettled excludes in-flight (unsettled) rows', async () => {
  await store.record(inFlight({ actumId: 'pending-1' }))                       // never settled
  await seedSettled(inFlight({ actumId: 's-1' }), new Date('2026-07-02T00:00:00Z'), '100')
  const page = await store.listSettled({ animaId: 'anima-A' }, { limit: 10 })
  assert.deepEqual(page.entries.map(e => e.actumId), ['s-1'])
})

test('listSettled paginates newest-first with a stable cursor and no dupes across pages', async () => {
  // 5 settled rows, ascending settledAt → newest-first order is e5,e4,e3,e2,e1.
  for (let i = 1; i <= 5; i++) {
    await seedSettled(inFlight({ actumId: `e${i}` }), new Date(`2026-07-0${i}T00:00:00Z`), String(i * 10))
  }

  const seen: string[] = []
  let cursor: string | undefined
  let pages = 0
  do {
    const page = await store.listSettled({ animaId: 'anima-A' }, { limit: 2, cursor })
    seen.push(...page.entries.map(e => e.actumId))
    cursor = page.nextCursor
    pages++
    assert.ok(pages <= 5, 'pagination terminates')
  } while (cursor)

  assert.deepEqual(seen, ['e5', 'e4', 'e3', 'e2', 'e1'], 'newest-first, no dupes, no skips')
  assert.equal(new Set(seen).size, 5)
})

test('sumSettledImpetus is the lifetime settled total (excludes in-flight); owner-scoped', async () => {
  await seedSettled(inFlight({ actumId: 'a1' }), new Date('2026-07-01T00:00:00Z'), '100')
  await seedSettled(inFlight({ actumId: 'a2' }), new Date('2026-07-02T00:00:00Z'), '250')
  await store.record(inFlight({ actumId: 'a3-pending' }))                      // not counted
  await seedSettled(inFlight({ actumId: 'b1', animaId: 'anima-B' }), new Date('2026-07-02T00:00:00Z'), '999')

  assert.equal(await store.sumSettledImpetus({ animaId: 'anima-A' }), '350')
  assert.equal(await store.sumSettledImpetus({ animaId: 'anima-B' }), '999')
  assert.equal(await store.sumSettledImpetus({ animaId: 'nobody' }), '0')
})

test('bursaToken keys are never indexed — empty listing and zero total', async () => {
  await seedSettled(inFlight({ actumId: 'a1' }), new Date('2026-07-02T00:00:00Z'), '100')
  const page = await store.listSettled({ bursaToken: 'tok' } as any, { limit: 10 })
  assert.deepEqual(page.entries, [])
  assert.equal(await store.sumSettledImpetus({ bursaToken: 'tok' } as any), '0')
})
