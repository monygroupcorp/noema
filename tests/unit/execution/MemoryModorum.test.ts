import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryModorum } from '../../../src/execution/MemoryModorum.js'
import type { Modus } from '../../../src/types/modus.js'

function makeModus(overrides: Partial<Modus> = {}): Modus {
  return {
    id: 'mod-1',
    nomen: 'Test Modus',
    genus: 'atomicus',
    versio: '1.0.0',
    contentHash: 'abc123',
    aditus: {},
    exitus: {},
    ministerium: 'test',
    canonica: false,
    natum: new Date(),
    mutatum: new Date(),
    ...overrides,
  }
}

test('find returns registered modus by id', async () => {
  const store = new MemoryModorum()
  await store.register(makeModus())

  const found = await store.find('mod-1')
  assert.ok(found)
  assert.equal(found.id, 'mod-1')
})

test('find returns null for unknown id', async () => {
  const store = new MemoryModorum()
  const found = await store.find('ghost')
  assert.equal(found, null)
})

test('find with versio returns the matching version', async () => {
  const store = new MemoryModorum()
  await store.register(makeModus({ versio: '1.0.0' }))
  await store.register(makeModus({ versio: '2.0.0', contentHash: 'def456' }))

  const found = await store.find('mod-1', '2.0.0')
  assert.ok(found)
  assert.equal(found.versio, '2.0.0')
})

test('find without versio returns latest (highest semver)', async () => {
  const store = new MemoryModorum()
  await store.register(makeModus({ versio: '1.0.0' }))
  await store.register(makeModus({ versio: '2.0.0', contentHash: 'def456' }))

  const found = await store.find('mod-1')
  assert.equal(found!.versio, '2.0.0')
})

test('list returns all registered modi', async () => {
  const store = new MemoryModorum()
  await store.register(makeModus({ id: 'mod-1' }))
  await store.register(makeModus({ id: 'mod-2', contentHash: 'xyz' }))

  const all = await store.list()
  assert.equal(all.length, 2)
})

test('list filters by genus', async () => {
  const store = new MemoryModorum()
  await store.register(makeModus({ id: 'mod-1', genus: 'atomicus' }))
  await store.register(makeModus({ id: 'mod-2', genus: 'compositus', contentHash: 'xyz' }))

  const atoms = await store.list({ genus: 'atomicus' })
  assert.equal(atoms.length, 1)
  assert.equal(atoms[0].id, 'mod-1')
})
