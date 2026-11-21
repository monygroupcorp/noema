import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryActorum } from '../../../src/execution/MemoryActorum.js'

function makeActum(overrides: Record<string, unknown> = {}) {
  return {
    id: 'act-1',
    modusId: 'mod-1',
    modusVersiono: '1.0.0',
    impetus: 0n,
    signaConsumed: [] as string[],
    aditus: {},
    status: 'nascens' as const,
    expirat: new Date(Date.now() + 60_000),
    ...overrides,
  }
}

test('create stores actum and sets inceptum', async () => {
  const store = new MemoryActorum()
  const actum = await store.create(makeActum())

  assert.equal(actum.id, 'act-1')
  assert.ok(actum.inceptum instanceof Date)
  assert.equal(actum.status, 'nascens')
})

test('findById returns the created actum', async () => {
  const store = new MemoryActorum()
  await store.create(makeActum())

  const found = await store.findById('act-1')
  assert.ok(found)
  assert.equal(found.id, 'act-1')
})

test('findByNullifier returns a LIVE actum (blocks double-spend)', async () => {
  const store = new MemoryActorum()
  await store.create(makeActum({ id: 'a', nullifier: 'null-x', status: 'agens' }))
  const found = await store.findByNullifier('null-x')
  assert.equal(found?.id, 'a')
})

test('findByNullifier ignores a FAILED (fractus) actum — frees the commitment to re-spend', async () => {
  const store = new MemoryActorum()
  // a failed run refunds its signa, so its nullifier must NOT block a retry
  await store.create(makeActum({ id: 'failed', nullifier: 'null-y', status: 'fractus' }))
  assert.equal(await store.findByNullifier('null-y'), null)
})

test('findById returns null for unknown id', async () => {
  const store = new MemoryActorum()
  const found = await store.findById('ghost')
  assert.equal(found, null)
})

test('update merges patch into the actum', async () => {
  const store = new MemoryActorum()
  await store.create(makeActum())

  const updated = await store.update('act-1', { status: 'completus', impetus: 500n })

  assert.equal(updated.status, 'completus')
  assert.equal(updated.impetus, 500n)
  assert.equal(updated.modusId, 'mod-1')  // unchanged fields preserved
})

test('update throws for unknown id', async () => {
  const store = new MemoryActorum()

  await assert.rejects(
    () => store.update('ghost', { status: 'fractus' }),
    /not found/i
  )
})

// Clause 1 (noema/user-behaviour-corpus): an attempt leaves a record at creation
// (status: 'nascens'), independent of whether it ever completes — statusCountsSince
// is how attempts and completions get counted separately from that one record.
test('statusCountsSince counts created-since acta by current status', async () => {
  const store = new MemoryActorum()
  const since = new Date(Date.now() - 60_000)
  await store.create(makeActum({ id: 'a1', status: 'nascens' }))
  await store.create(makeActum({ id: 'a2', status: 'nascens' }))
  await store.update('a2', { status: 'completus' })
  await store.create(makeActum({ id: 'a3', status: 'nascens' }))
  await store.update('a3', { status: 'fractus' })

  const counts = await store.statusCountsSince(since)
  assert.equal(counts.nascens, 1)
  assert.equal(counts.completus, 1)
  assert.equal(counts.fractus, 1)
})

test('statusCountsSince excludes acta created before the cutoff', async () => {
  const store = new MemoryActorum()
  await store.create(makeActum({ id: 'old' }))

  const future = new Date(Date.now() + 60_000)
  const counts = await store.statusCountsSince(future)
  assert.equal(Object.keys(counts).length, 0)
})
