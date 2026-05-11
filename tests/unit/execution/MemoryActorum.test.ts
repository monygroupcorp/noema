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
