// MemoryActumIndex round-trip + the /status aggregator path that consumes it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryActumIndex } from '../../../src/execution/MemoryActumIndex.js'

test('record + findFor: single entry round-trips for the right anima', async () => {
  const idx = new MemoryActumIndex()
  await idx.record({ animaId: 'a', actumId: 'act1', modusId: 'm.flux', createdAt: new Date() })
  const got = await idx.findFor('a')
  assert.equal(got.length, 1)
  assert.equal(got[0].actumId, 'act1')
})

test('record is idempotent on actumId (re-record overwrites, no duplicates)', async () => {
  const idx = new MemoryActumIndex()
  const t1 = new Date('2026-01-01')
  const t2 = new Date('2026-02-01')
  await idx.record({ animaId: 'a', actumId: 'act1', modusId: 'm.flux', createdAt: t1 })
  await idx.record({ animaId: 'a', actumId: 'act1', modusId: 'm.flux', createdAt: t2 })
  const got = await idx.findFor('a')
  assert.equal(got.length, 1)
  assert.equal(got[0].createdAt.getTime(), t2.getTime())
})

test('findFor: scoped to its anima — different animas are isolated', async () => {
  const idx = new MemoryActumIndex()
  await idx.record({ animaId: 'a', actumId: 'aa', modusId: 'm', createdAt: new Date() })
  await idx.record({ animaId: 'b', actumId: 'bb', modusId: 'm', createdAt: new Date() })
  assert.deepEqual((await idx.findFor('a')).map(e => e.actumId), ['aa'])
  assert.deepEqual((await idx.findFor('b')).map(e => e.actumId), ['bb'])
})

test('remove: drops the entry; subsequent findFor omits it', async () => {
  const idx = new MemoryActumIndex()
  await idx.record({ animaId: 'a', actumId: 'act1', modusId: 'm', createdAt: new Date() })
  await idx.record({ animaId: 'a', actumId: 'act2', modusId: 'm', createdAt: new Date() })
  await idx.remove('act1')
  const got = await idx.findFor('a')
  assert.deepEqual(got.map(e => e.actumId), ['act2'])
})

test('remove on unknown actumId is a no-op', async () => {
  const idx = new MemoryActumIndex()
  await idx.remove('nope')   // does not throw
})

test('findFor unknown anima returns empty list', async () => {
  const idx = new MemoryActumIndex()
  assert.deepEqual(await idx.findFor('nobody'), [])
})
