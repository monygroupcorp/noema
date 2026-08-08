import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Db } from 'mongodb'
import type { Modus, Modorum } from '../../../src/types/modus.js'
import type { IssuerStore } from '../../../src/types/issuer.js'
import { seedCamel, CAMEL_TEMPLATE_MODUS } from '../../../src/crystal/seeds/camel.js'

// `seedCamel` reconciles the starter template through the raw `Db` handle (the
// `Modorum.update` patch type only covers execution preferences, not `canonica`),
// so these doubles share one backing map: the fake Modorum for `find`/`register`,
// the fake `Db` for the collection-level `canonica` correction — same shape the
// real `MongoModorum` + raw `modi` collection have in prod.

function fakeModorum(): Pick<Modorum, 'find' | 'register'> & { store: Map<string, Modus> } {
  const store = new Map<string, Modus>()
  return {
    store,
    async find(id: string) { return store.get(id) ?? null },
    async register(m: Modus) { store.set(m.id, m) },
  }
}

function fakeIssuers(): Pick<IssuerStore, 'upsert' | 'findByIssuerId'> {
  return {
    async upsert() { /* no-op double */ },
    async findByIssuerId() { return null },
  }
}

function fakeDb(modorum: { store: Map<string, Modus> }): Db {
  const animae = new Map<string, unknown>()
  return {
    collection(name: string) {
      if (name === 'modi') {
        return {
          async updateOne(filter: { id: string }, update: { $set?: Partial<Modus> }) {
            const existing = modorum.store.get(filter.id)
            if (existing && update.$set) modorum.store.set(filter.id, { ...existing, ...update.$set })
          },
        }
      }
      if (name === 'animae') {
        return {
          async updateOne(filter: { id: string }, update: { $setOnInsert?: unknown }, opts?: { upsert?: boolean }) {
            if (!animae.has(filter.id) && opts?.upsert) animae.set(filter.id, update.$setOnInsert)
          },
        }
      }
      throw new Error(`fakeDb: unexpected collection ${name}`)
    },
  } as unknown as Db
}

test('seeding into an empty store registers the template as non-canonical', async () => {
  const modorum = fakeModorum()
  await seedCamel({ issuers: fakeIssuers(), modorum, db: fakeDb(modorum) })

  const seeded = modorum.store.get(CAMEL_TEMPLATE_MODUS.id)
  assert.ok(seeded)
  assert.equal(seeded!.canonica, false)
  assert.ok(seeded!.contentHash.length > 0)
})

test('seeding twice is a no-op', async () => {
  const modorum = fakeModorum()
  const db = fakeDb(modorum)
  await seedCamel({ issuers: fakeIssuers(), modorum, db })
  const first = modorum.store.get(CAMEL_TEMPLATE_MODUS.id)!

  await seedCamel({ issuers: fakeIssuers(), modorum, db })
  const second = modorum.store.get(CAMEL_TEMPLATE_MODUS.id)!

  assert.deepEqual(second, first)
})

test('seeding over an existing canonical row flips canonica and leaves contentHash, gradus, aditus untouched', async () => {
  const modorum = fakeModorum()
  const existing: Modus = {
    ...CAMEL_TEMPLATE_MODUS,
    canonica: true,
    contentHash: 'prod-sealed-hash',
  }
  modorum.store.set(existing.id, existing)

  await seedCamel({ issuers: fakeIssuers(), modorum, db: fakeDb(modorum) })

  const reconciled = modorum.store.get(CAMEL_TEMPLATE_MODUS.id)!
  assert.equal(reconciled.canonica, false)
  assert.equal(reconciled.contentHash, 'prod-sealed-hash')
  assert.deepEqual(reconciled.gradus, existing.gradus)
  assert.deepEqual(reconciled.aditus, existing.aditus)
})
