// MemoryActumIndex round-trip + AuctorKey-shaped read/write for both
// identified and anonymous (commitment) runners.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryActumIndex } from '../../../src/execution/MemoryActumIndex.js'

const ANIMA = { animaId: 'anima-alice' } as const
const COMMIT = { commitment: '0xabc123' } as const

// ── identified path ─────────────────────────────────────────────────────────

test('animaId: record + findFor round-trips a single entry', async () => {
  const idx = new MemoryActumIndex()
  await idx.record({ animaId: ANIMA.animaId, actumId: 'act1', modusId: 'm.flux', createdAt: new Date() })
  const got = await idx.findFor(ANIMA)
  assert.equal(got.length, 1)
  assert.equal(got[0].actumId, 'act1')
  assert.equal(got[0].animaId, ANIMA.animaId)
})

test('animaId: record is idempotent on actumId — overwrites, no duplicate', async () => {
  const idx = new MemoryActumIndex()
  const t1 = new Date('2026-01-01')
  const t2 = new Date('2026-02-01')
  await idx.record({ animaId: ANIMA.animaId, actumId: 'act1', modusId: 'm', createdAt: t1 })
  await idx.record({ animaId: ANIMA.animaId, actumId: 'act1', modusId: 'm', createdAt: t2 })
  const got = await idx.findFor(ANIMA)
  assert.equal(got.length, 1)
  assert.equal(got[0].createdAt.getTime(), t2.getTime())
})

test('animaId: different animas are isolated', async () => {
  const idx = new MemoryActumIndex()
  await idx.record({ animaId: 'a', actumId: 'aa', modusId: 'm', createdAt: new Date() })
  await idx.record({ animaId: 'b', actumId: 'bb', modusId: 'm', createdAt: new Date() })
  assert.deepEqual((await idx.findFor({ animaId: 'a' })).map(e => e.actumId), ['aa'])
  assert.deepEqual((await idx.findFor({ animaId: 'b' })).map(e => e.actumId), ['bb'])
})

test('remove drops the entry; subsequent findFor omits it', async () => {
  const idx = new MemoryActumIndex()
  await idx.record({ animaId: ANIMA.animaId, actumId: 'act1', modusId: 'm', createdAt: new Date() })
  await idx.record({ animaId: ANIMA.animaId, actumId: 'act2', modusId: 'm', createdAt: new Date() })
  await idx.remove('act1')
  const got = await idx.findFor(ANIMA)
  assert.deepEqual(got.map(e => e.actumId), ['act2'])
})

test('remove on unknown actumId is a no-op', async () => {
  const idx = new MemoryActumIndex()
  await idx.remove('nope')
})

test('findFor unknown key returns empty list', async () => {
  const idx = new MemoryActumIndex()
  assert.deepEqual(await idx.findFor({ animaId: 'nobody' }), [])
  assert.deepEqual(await idx.findFor({ commitment: '0xnobody' }), [])
})

// ── anonymous (commitment) path ─────────────────────────────────────────────

test('commitment: record + findFor round-trips a single entry, animaId NEVER set', async () => {
  const idx = new MemoryActumIndex()
  await idx.record({ commitment: COMMIT.commitment, actumId: 'act-anon', modusId: 'm', createdAt: new Date() })
  const got = await idx.findFor(COMMIT)
  assert.equal(got.length, 1)
  assert.equal(got[0].actumId, 'act-anon')
  assert.equal(got[0].commitment, COMMIT.commitment)
  assert.equal(got[0].animaId, undefined, 'commitment-side entries MUST NOT carry animaId')
})

test('commitment + animaId entries are isolated from each other', async () => {
  const idx = new MemoryActumIndex()
  await idx.record({ animaId: 'a',    actumId: 'id-act',   modusId: 'm', createdAt: new Date() })
  await idx.record({ commitment: 'X', actumId: 'anon-act', modusId: 'm', createdAt: new Date() })

  const idEntries = await idx.findFor({ animaId: 'a' })
  assert.deepEqual(idEntries.map(e => e.actumId), ['id-act'], 'animaId lookup never returns commitment entries')

  const anonEntries = await idx.findFor({ commitment: 'X' })
  assert.deepEqual(anonEntries.map(e => e.actumId), ['anon-act'], 'commitment lookup never returns animaId entries')
})

test('commitment: remove drops the entry', async () => {
  const idx = new MemoryActumIndex()
  await idx.record({ commitment: COMMIT.commitment, actumId: 'act-anon', modusId: 'm', createdAt: new Date() })
  await idx.remove('act-anon')
  assert.deepEqual(await idx.findFor(COMMIT), [])
})

test('different commitments are isolated', async () => {
  const idx = new MemoryActumIndex()
  await idx.record({ commitment: 'X', actumId: 'x1', modusId: 'm', createdAt: new Date() })
  await idx.record({ commitment: 'Y', actumId: 'y1', modusId: 'm', createdAt: new Date() })
  assert.deepEqual((await idx.findFor({ commitment: 'X' })).map(e => e.actumId), ['x1'])
  assert.deepEqual((await idx.findFor({ commitment: 'Y' })).map(e => e.actumId), ['y1'])
})
