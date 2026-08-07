// Over-capture is the ENTIRE risk of retiring the legacy shadow deposit rows by predicate: the
// script archives and then irreversibly deletes whatever `isLegacyShadow` says `true` to. These
// tests pin the boundary — most of all that a row carrying a receipt-time `token` is never a
// match, because such a row is a genuine deposit that is still owed a credit.
//
// All fixtures are invented. No production identifiers, addresses, hashes or amounts.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isLegacyShadow, copyDefects, sameValue, retire } from '../../../../scripts/retire-legacy-shadow-deposita.js'
import type { Depositum } from '../../../../src/types/catena.js'
import type { Collection, Document } from 'mongodb'

type Basis = Pick<Depositum, 'status' | 'token' | 'usdFmv'>

/** The shadow shape: parked confirmatum, no receipt-time basis at all. */
const SHADOW: Basis = { status: 'confirmatum' }

const SAMPLE_TOKEN = '0x0000000000000000000000000000000000000000'

test('isLegacyShadow: confirmatum with neither token nor usdFmv is a shadow row', () => {
  assert.equal(isLegacyShadow(SHADOW), true)
})

test('isLegacyShadow: a confirmatum row carrying `token` is NEVER a match', () => {
  // Load-bearing case. A genuine deposit parked because it could not be priced still carries
  // the asset it arrived in; it is owed a credit and must survive this script untouched.
  assert.equal(isLegacyShadow({ ...SHADOW, token: SAMPLE_TOKEN }), false)
})

test('isLegacyShadow: a confirmatum row carrying `usdFmv` is NEVER a match', () => {
  assert.equal(isLegacyShadow({ ...SHADOW, usdFmv: 1_000_000n }), false)
})

test('isLegacyShadow: a fully priced confirmatum row is not a match', () => {
  assert.equal(isLegacyShadow({ status: 'confirmatum', token: SAMPLE_TOKEN, usdFmv: 1_000_000n }), false)
})

test('isLegacyShadow: no other status matches, however bare the row looks', () => {
  for (const status of ['processatum', 'fractum', 'detectum'] as const) {
    assert.equal(isLegacyShadow({ status }), false, `${status} with no basis must not match`)
    assert.equal(isLegacyShadow({ status, token: SAMPLE_TOKEN }), false, `${status} with token must not match`)
  }
})

test('isLegacyShadow: reads a raw Mongo document too, where usdFmv is a decimal string', () => {
  // MongoDepositum serializes the bigint usdFmv to a string on write, so the script re-tests
  // documents in that shape. Presence must decide identically in both shapes.
  assert.equal(isLegacyShadow({ status: 'confirmatum' }), true)
  assert.equal(isLegacyShadow({ status: 'confirmatum', usdFmv: '1000000' }), false)
  assert.equal(isLegacyShadow({ status: 'confirmatum', token: SAMPLE_TOKEN }), false)
  assert.equal(isLegacyShadow({ status: 'processatum' }), false)
})

test('isLegacyShadow: an explicitly null basis field is not an absent one', () => {
  // A row that stored an explicit null is NOT the pre-freeze shape the archive targets, and the
  // `$exists: false` selector would not fetch it either. Fail closed.
  assert.equal(isLegacyShadow({ status: 'confirmatum', token: null as unknown as string }), false)
  assert.equal(isLegacyShadow({ status: 'confirmatum', usdFmv: null as unknown as bigint }), false)
})

// --- copy verification: the gate between a row and an irreversible delete --------------------

test('copyDefects: an identical copy has no defects', () => {
  const source = { _id: 1, status: 'confirmatum', chainId: 8453, valor: '1000', natum: new Date('2026-01-02T03:04:05Z') }
  const copy = { _id: 1, status: 'confirmatum', chainId: 8453, valor: '1000', natum: new Date('2026-01-02T03:04:05Z') }
  assert.deepEqual(copyDefects(source, copy), [])
})

test('copyDefects: a changed, dropped or added field is reported', () => {
  const source = { a: 1, b: 'x', c: 3 }
  assert.deepEqual(copyDefects(source, { a: 1, b: 'y', c: 3 }), ['b'])
  assert.deepEqual(copyDefects(source, { a: 1, c: 3 }), ['b'])
  assert.deepEqual(copyDefects(source, { a: 1, b: 'x', c: 3, d: 4 }), ['d'])
})

test('copyDefects: a value that merely looks equal is still a defect', () => {
  // A string "1000" is not the number 1000; a lossy copy must never clear the gate.
  assert.deepEqual(copyDefects({ valor: '1000' }, { valor: 1000 }), ['valor'])
  assert.deepEqual(copyDefects({ v: undefined }, {}), ['v'])
})

test('sameValue: dates compare by instant, nested docs and arrays compare recursively', () => {
  assert.equal(sameValue(new Date('2026-01-02T00:00:00Z'), new Date('2026-01-02T00:00:00Z')), true)
  assert.equal(sameValue(new Date('2026-01-02T00:00:00Z'), new Date('2026-01-03T00:00:00Z')), false)
  assert.equal(sameValue(new Date('2026-01-02T00:00:00Z'), '2026-01-02T00:00:00.000Z'), false)
  assert.equal(sameValue({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] }), true)
  assert.equal(sameValue({ a: [1, { b: 2 }] }, { a: [1, { b: 3 }] }), false)
  assert.equal(sameValue({ a: 1 }, { a: 1, b: undefined }), false)
})

test('sameValue: BSON values compare through their own equals()', () => {
  // Stand-in for an ObjectId: the driver's BSON types self-compare via `equals`.
  const bson = (v: string) => ({ v, equals(o: unknown) { return (o as { v?: string })?.v === v } })
  assert.equal(sameValue(bson('a'), bson('a')), true)
  assert.equal(sameValue(bson('a'), bson('b')), false)
})

// --- the irreversible path: archive -> verify -> delete --------------------------------------
//
// The delete cannot be undone, so the ORDER is the safety property, not an implementation
// detail. These drive `retire` against in-memory collection doubles: no database is touched.

type Doc = Record<string, unknown>

function clone(v: unknown): unknown {
  if (v instanceof Date) return new Date(v.getTime())
  if (Array.isArray(v)) return v.map(clone)
  if (v !== null && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v as Doc).map(([k, x]) => [k, clone(x)]))
  }
  return v
}

function matches(doc: Doc, sel: Doc): boolean {
  return Object.entries(sel).every(([k, want]) => {
    if (want !== null && typeof want === 'object' && '$exists' in (want as Doc)) {
      return (doc[k] !== undefined) === (want as { $exists: boolean }).$exists
    }
    return doc[k] === want
  })
}

/** Minimal stand-in for a Mongo collection: only what `retire` calls, all in memory. */
class FakeCol {
  constructor(public docs: Doc[] = [], private opts: { ignoreSelector?: boolean; corruptOnInsert?: boolean } = {}) {}
  async countDocuments(sel: Doc): Promise<number> { return this.docs.filter(d => matches(d, sel)).length }
  find(sel: Doc): { toArray: () => Promise<Doc[]> } {
    const hits = this.opts.ignoreSelector ? this.docs : this.docs.filter(d => matches(d, sel))
    return { toArray: async () => hits.map(d => clone(d) as Doc) }
  }
  async findOne(sel: Doc): Promise<Doc | null> { return this.docs.find(d => matches(d, sel)) ?? null }
  async insertOne(doc: Doc): Promise<void> {
    const stored = clone(doc) as Doc
    if (this.opts.corruptOnInsert) delete stored.valor    // a silently lossy copy
    this.docs.push(stored)
  }
  async deleteOne(sel: Doc): Promise<{ deletedCount: number }> {
    const i = this.docs.findIndex(d => matches(d, sel))
    if (i < 0) return { deletedCount: 0 }
    this.docs.splice(i, 1)
    return { deletedCount: 1 }
  }
  as(): Collection<Document> { return this as unknown as Collection<Document> }
}

const shadowRow = (id: number): Doc => ({
  _id: id, id: `row-${id}`, status: 'confirmatum', chainId: 8453,
  valor: '1000', confirmationes: 12, natum: new Date('2026-01-02T03:04:05Z'),
})
const pricedRow = (id: number): Doc => ({ ...shadowRow(id), token: SAMPLE_TOKEN, usdFmv: '3000000' })
const creditedRow = (id: number): Doc => ({ ...pricedRow(id), status: 'processatum' })

test('retire: dry-run reports the matches and writes absolutely nothing', async () => {
  const live = new FakeCol([shadowRow(1), shadowRow(2), pricedRow(3), creditedRow(4)])
  const archive = new FakeCol()

  const res = await retire(live.as(), archive.as(), { apply: false })

  assert.equal(res.matched, 2)
  assert.equal(res.retired, 0)
  assert.equal(archive.docs.length, 0, 'dry-run must not archive')
  assert.equal(live.docs.length, 4, 'dry-run must not delete')
  assert.equal(res.before, 2)
  assert.equal(res.after, 2)
})

test('retire: --apply archives then deletes only the shadow rows', async () => {
  const live = new FakeCol([shadowRow(1), pricedRow(2), creditedRow(3), shadowRow(4)])
  const archive = new FakeCol()

  const res = await retire(live.as(), archive.as(), { apply: true })

  assert.equal(res.matched, 2)
  assert.equal(res.archived, 2)
  assert.equal(res.retired, 2)
  assert.equal(res.refused, 0)
  assert.equal(res.after, 0)
  assert.deepEqual(archive.docs.map(d => d._id).sort(), [1, 4])
  assert.deepEqual(live.docs.map(d => d._id).sort(), [2, 3], 'a priced or credited row must survive')
  // The archived copy is the source, verbatim.
  assert.deepEqual(copyDefects(shadowRow(1), archive.docs.find(d => d._id === 1) as Doc), [])
})

test('retire: an unverifiable copy refuses the delete and exits non-zero-worthy', async () => {
  const live = new FakeCol([shadowRow(1)])
  const archive = new FakeCol([], { corruptOnInsert: true })

  const res = await retire(live.as(), archive.as(), { apply: true })

  assert.equal(res.refused, 1)
  assert.equal(res.retired, 0)
  assert.equal(live.docs.length, 1, 'the source row must still be there')
  assert.equal(res.after, 1, 'a non-zero after-count is what makes the run exit non-zero')
})

test('retire: the predicate overrides the selector — a fetched non-shadow row is never touched', async () => {
  // The fake ignores the selector and hands back everything, simulating a selector that has
  // drifted wider than the predicate. Nothing but a true shadow row may be acted on.
  const live = new FakeCol([shadowRow(1), pricedRow(2), creditedRow(3)], { ignoreSelector: true })
  const archive = new FakeCol()

  const res = await retire(live.as(), archive.as(), { apply: true })

  assert.equal(res.matched, 1)
  assert.equal(res.retired, 1)
  assert.equal(res.refused, 2, 'the two non-shadow rows are refused, not archived')
  assert.deepEqual(archive.docs.map(d => d._id), [1])
  assert.deepEqual(live.docs.map(d => d._id).sort(), [2, 3])
})

test('retire: a second run is a no-op, and a resumed run re-verifies before deleting', async () => {
  const live = new FakeCol([shadowRow(1)])
  const archive = new FakeCol()

  await retire(live.as(), archive.as(), { apply: true })
  const second = await retire(live.as(), archive.as(), { apply: true })
  assert.equal(second.matched, 0)
  assert.equal(second.retired, 0)
  assert.equal(second.after, 0)

  // Resume: the row is already archived from an interrupted run but still live. It must not be
  // re-inserted, and it must still pass verification before the source goes.
  const resumeLive = new FakeCol([shadowRow(9)])
  const resumeArchive = new FakeCol([clone(shadowRow(9)) as Doc])
  const res = await retire(resumeLive.as(), resumeArchive.as(), { apply: true })
  assert.equal(res.alreadyArchived, 1)
  assert.equal(res.archived, 0)
  assert.equal(res.retired, 1)
  assert.equal(resumeArchive.docs.length, 1, 'no duplicate archive row')
  assert.equal(resumeLive.docs.length, 0)
})
