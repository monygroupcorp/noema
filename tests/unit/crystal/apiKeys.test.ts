// apiKeys — pure unit tests for the shared `ms2_<48hex>` API-key primitives
// (src/crystal/apiKeys.ts). Hermetic: fake `ApiKeyUsersCollection` + fake
// `PersonaStore` slice, no Mongo.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  generateApiKeyMaterial,
  appendApiKeyRecord,
  verifyApiKeyToAccountId,
  mintPartnerApiKey,
  type ApiKeyEntry,
  type ApiKeyUsersCollection,
  type MintPartnerApiKeyDeps,
} from '../../../src/crystal/apiKeys.js'
import type { Persona, PersonaGenus } from '../../../src/types/persona.js'

class FakeUsersCollection implements ApiKeyUsersCollection {
  docs = new Map<string, { _id: string; apiKeys: ApiKeyEntry[] }>()

  async findOne(filter: Record<string, unknown>): Promise<{ _id: unknown; apiKeys?: ApiKeyEntry[] } | null> {
    if (filter._id !== undefined) {
      return this.docs.get(String(filter._id)) ?? null
    }
    const prefix = filter['apiKeys.keyPrefix']
    if (typeof prefix === 'string') {
      for (const doc of this.docs.values()) {
        if (doc.apiKeys.some(k => k.keyPrefix === prefix)) return doc
      }
    }
    return null
  }

  async updateOne(filter: Record<string, unknown>, update: Record<string, unknown>, options?: { upsert?: boolean }): Promise<unknown> {
    const id = String(filter._id)
    let doc = this.docs.get(id)
    if (!doc) {
      if (!options?.upsert) return { matchedCount: 0 }
      doc = { _id: id, apiKeys: [] }
      this.docs.set(id, doc)
    }
    const push = (update as { $push?: { apiKeys: ApiKeyEntry } }).$push
    if (push?.apiKeys) doc.apiKeys.push(push.apiKeys)
    return { matchedCount: 1 }
  }
}

function fakePersonae() {
  const byKey = new Map<string, Persona>()
  return {
    async findByExternus(genus: PersonaGenus, externusId: string): Promise<Persona | null> {
      return byKey.get(`${genus}\0${externusId}`) ?? null
    },
    async findOrCreate(genus: PersonaGenus, externusId: string, defaults?: { animaId: string }): Promise<Persona> {
      const existing = byKey.get(`${genus}\0${externusId}`)
      if (existing) return existing
      const p = {
        id: `persona-${byKey.size + 1}`,
        activeAnimaId: defaults!.animaId,
        animaIds: [defaults!.animaId],
        genus,
        externusId,
        status: 'active' as const,
        natum: new Date(),
        visum: new Date(),
      }
      byKey.set(`${genus}\0${externusId}`, p)
      return p
    },
    // test-only seam to seed a persona pointing at a DIFFERENT anima (simulating pre-existing bad data)
    _seed(genus: PersonaGenus, externusId: string, p: Persona) {
      byKey.set(`${genus}\0${externusId}`, p)
    },
  }
}

test('generateApiKeyMaterial: ms2_<48hex> shape, correct prefix + hash', () => {
  const { apiKey, keyPrefix, keyHash } = generateApiKeyMaterial()
  assert.match(apiKey, /^ms2_[0-9a-f]{48}$/)
  assert.equal(keyPrefix, apiKey.slice(0, 12))
  assert.equal(keyHash, createHash('sha256').update(apiKey).digest('hex'))
})

test('generateApiKeyMaterial: two calls never collide', () => {
  const a = generateApiKeyMaterial()
  const b = generateApiKeyMaterial()
  assert.notEqual(a.apiKey, b.apiKey)
})

test('appendApiKeyRecord + verifyApiKeyToAccountId: round-trips to the account id', async () => {
  const usersCol = new FakeUsersCollection()
  const { apiKey, keyPrefix, keyHash } = generateApiKeyMaterial()
  await appendApiKeyRecord(usersCol, 'acct-1', { keyPrefix, keyHash, status: 'active' })

  assert.equal(await verifyApiKeyToAccountId(usersCol, apiKey), 'acct-1')
})

test('verifyApiKeyToAccountId: garbage / unknown / malformed keys return null', async () => {
  const usersCol = new FakeUsersCollection()
  assert.equal(await verifyApiKeyToAccountId(usersCol, 'garbage'), null)
  assert.equal(await verifyApiKeyToAccountId(usersCol, 'ms2_deadbeef'), null, 'well-formed prefix, no matching doc')
  const { apiKey } = generateApiKeyMaterial()
  assert.equal(await verifyApiKeyToAccountId(usersCol, apiKey), null, 'never stored')
})

test('verifyApiKeyToAccountId: an inactive key does not resolve', async () => {
  const usersCol = new FakeUsersCollection()
  const { apiKey, keyPrefix, keyHash } = generateApiKeyMaterial()
  await appendApiKeyRecord(usersCol, 'acct-1', { keyPrefix, keyHash, status: 'inactive' })
  assert.equal(await verifyApiKeyToAccountId(usersCol, apiKey), null)
})

test('mintPartnerApiKey: attaches a fresh key to the EXACT animaId given, minting no new anima', async () => {
  const personae = fakePersonae()
  const usersCol = new FakeUsersCollection()
  const deps: MintPartnerApiKeyDeps = { personae, usersCol }

  const apiKey = await mintPartnerApiKey(deps, 'anima-real')
  assert.match(apiKey, /^ms2_[0-9a-f]{48}$/)

  // The 'api' persona was linked to the SAME animaId — never a fresh one.
  const persona = await personae.findByExternus('api', 'anima-real')
  assert.equal(persona?.activeAnimaId, 'anima-real')

  // The users doc keyed by the animaId itself carries the key.
  const doc = usersCol.docs.get('anima-real')
  assert.equal(doc?.apiKeys.length, 1)
})

test('mintPartnerApiKey: idempotent api-persona reuse mints a second key without disturbing the link', async () => {
  const personae = fakePersonae()
  const usersCol = new FakeUsersCollection()
  const deps: MintPartnerApiKeyDeps = { personae, usersCol }

  const first = await mintPartnerApiKey(deps, 'anima-real')
  const second = await mintPartnerApiKey(deps, 'anima-real')
  assert.notEqual(first, second)
  assert.equal(usersCol.docs.get('anima-real')?.apiKeys.length, 2)
  assert.equal((await personae.findByExternus('api', 'anima-real'))?.activeAnimaId, 'anima-real')
})

test('mintPartnerApiKey: REFUSES to mint when the externusId already resolves to a DIFFERENT anima', async () => {
  const personae = fakePersonae()
  const usersCol = new FakeUsersCollection()
  // Simulate corrupted/pre-existing data: an 'api' persona for externusId 'anima-real'
  // somehow points at a different anima already.
  personae._seed('api', 'anima-real', {
    id: 'persona-bad',
    activeAnimaId: 'anima-WRONG',
    animaIds: ['anima-WRONG'],
    genus: 'api',
    externusId: 'anima-real',
    status: 'active',
    natum: new Date(),
    visum: new Date(),
  })
  const deps: MintPartnerApiKeyDeps = { personae, usersCol }

  await assert.rejects(
    () => mintPartnerApiKey(deps, 'anima-real'),
    /refusing to mint a key that would authenticate as the wrong account/,
  )
  // No key written anywhere.
  assert.equal(usersCol.docs.size, 0)
})
