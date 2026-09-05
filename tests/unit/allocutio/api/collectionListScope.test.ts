import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Collection, Document } from 'mongodb'
import { MongoCollectio } from '../../../../src/crystal/MongoCollectio.js'

// The caller's collection listing is a per-caller read of a shared, multi-tenant collection.
// These tests hold the two properties that makes it safe and bounded: the ownership predicate
// is IN THE QUERY (no other tenant's document is ever loaded), and one request pulls back a
// bounded page however large the store grows.

type Doc = Record<string, unknown>

/** Records the query MongoCollectio issues, and replays a fixed result set through the
 *  find → sort → limit → toArray chain the store uses. */
class RecordingCol {
  filter: Doc | undefined
  sort: Doc | undefined
  limit: number | undefined
  constructor(private readonly docs: Doc[] = []) {}
  find(filter: Doc) {
    this.filter = filter
    const chain = {
      sort: (s: Doc) => { this.sort = s; return chain },
      limit: (n: number) => { this.limit = n; return chain },
      toArray: async () => this.docs,
    }
    return chain
  }
  as(): Collection<Document> { return this as unknown as Collection<Document> }
}

const doc = (id: string, natum: string, extra: Doc = {}): Doc =>
  ({ id, natum: new Date(natum), impetusTotal: '0', acta: [], completae: 0, fractae: 0, ...extra })

test('listOwned scopes an anima to their own collections in the query', async () => {
  const col = new RecordingCol()
  await new MongoCollectio(col.as()).listOwned({ by: { animaId: 'anima-a' } })
  assert.deepEqual(col.filter, { $and: [{ 'by.animaId': 'anima-a' }] })
})

test('listOwned scopes an anonymous commitment to their own collections in the query', async () => {
  const col = new RecordingCol()
  await new MongoCollectio(col.as()).listOwned({ by: { commitment: '0xabc' } })
  assert.deepEqual(col.filter, { $and: [{ 'by.commitment': '0xabc' }] })
})

test("listOwned unions in the caller's teams, and only the caller's teams", async () => {
  const col = new RecordingCol()
  await new MongoCollectio(col.as()).listOwned({ by: { animaId: 'anima-a' }, sodalitasIds: ['t1', 't2'] })
  assert.deepEqual(col.filter, {
    $and: [{ $or: [{ 'by.animaId': 'anima-a' }, { sodalitasId: { $in: ['t1', 't2'] } }] }],
  })
})

test('listOwned bounds the page: default, clamp, and newest-first sort', async () => {
  const shown = async (limit?: number) => {
    const col = new RecordingCol()
    await new MongoCollectio(col.as()).listOwned({ by: { animaId: 'a' }, ...(limit !== undefined ? { limit } : {}) })
    return col
  }
  // limit+1 is the has-more probe, so the requested page size is one less than what is asked of Mongo.
  assert.equal((await shown()).limit, 101, 'default page is 100')
  assert.equal((await shown(10)).limit, 11)
  assert.equal((await shown(5000)).limit, 501, 'clamped to 500')
  assert.equal((await shown(0)).limit, 101, 'a zero limit falls back to the default, never unbounded')
  assert.equal((await shown(-3)).limit, 2, 'a negative limit clamps to 1')
  assert.deepEqual((await shown()).sort, { natum: -1, id: -1 })
})

test('listOwned pages with a cursor that resumes the sort, and stops when the store does', async () => {
  const rows = [doc('c3', '2026-03-01T00:00:00Z'), doc('c2', '2026-02-01T00:00:00Z'), doc('c1', '2026-01-01T00:00:00Z')]

  // Two rows asked for, three available → a page of two plus a cursor.
  const first = new RecordingCol(rows)
  const page1 = await new MongoCollectio(first.as()).listOwned({ by: { animaId: 'a' }, limit: 2 })
  assert.deepEqual(page1.entries.map(e => e.id), ['c3', 'c2'])
  assert.ok(page1.nextCursor, 'a full page carries a cursor')

  // That cursor asks the store for what sorts strictly after the last row of the page.
  const second = new RecordingCol([rows[2] as Doc])
  const page2 = await new MongoCollectio(second.as()).listOwned({ by: { animaId: 'a' }, limit: 2, cursor: page1.nextCursor! })
  assert.deepEqual(second.filter, {
    $and: [
      { 'by.animaId': 'a' },
      { $or: [{ natum: { $lt: new Date('2026-02-01T00:00:00Z') } }, { natum: new Date('2026-02-01T00:00:00Z'), id: { $lt: 'c2' } }] },
    ],
  })
  assert.deepEqual(page2.entries.map(e => e.id), ['c1'])
  assert.equal(page2.nextCursor, undefined, 'a short page ends the walk')
})

test('listOwned ignores an unreadable cursor rather than widening the owner scope', async () => {
  const col = new RecordingCol()
  await new MongoCollectio(col.as()).listOwned({ by: { animaId: 'a' }, cursor: 'not-a-cursor' })
  assert.deepEqual(col.filter, { $and: [{ 'by.animaId': 'a' }] })
})
