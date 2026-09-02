// partnerApiKeyRoundTrip — proves (not assumes) that a key minted by
// `mintPartnerApiKey` (the partner-approval provisioning path,
// src/crystal/apiKeys.ts) resolves back to the EXACT animaId it was minted
// for, through the REAL production chain:
//
//   verifyApiKeyToAccountId (src/crystal/apiKeys.ts, the same function
//   src/index.ts wires against the live `users` collection)
//     -> makeCredentialAcceptors.validateApiKey (src/allocutio/api/apiAcceptors.ts)
//     -> resolveOrCreateAnima
//     -> IdentityResolver.resolve (src/allocutio/api/IdentityResolver.ts)
//
// This is deliberately NOT a re-implementation of that chain — every link is
// the real, unmodified production function. Only `personae`/`animae` are
// fakes (the same fake-store pattern `apiAcceptors.test.ts` already uses),
// and the `users` collection is the in-memory fake from `apiKeys.test.ts`'s
// pattern. No live Mongo. Hermetic.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mintPartnerApiKey, verifyApiKeyToAccountId, type ApiKeyEntry, type ApiKeyUsersCollection } from '../../../../src/crystal/apiKeys.js'
import { makeCredentialAcceptors, type AcceptorDeps } from '../../../../src/allocutio/api/apiAcceptors.js'
import { IdentityResolver } from '../../../../src/allocutio/api/IdentityResolver.js'

class FakeUsersCollection implements ApiKeyUsersCollection {
  docs = new Map<string, { _id: string; apiKeys: ApiKeyEntry[] }>()

  async findOne(filter: Record<string, unknown>): Promise<{ _id: unknown; apiKeys?: ApiKeyEntry[] } | null> {
    if (filter._id !== undefined) return this.docs.get(String(filter._id)) ?? null
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

function fakePersonaeAndAnimae() {
  const personaByKey = new Map<string, { activeAnimaId: string }>()
  const created: string[] = []
  const personae: AcceptorDeps['personae'] = {
    async findByExternus(genus, ext) {
      return (personaByKey.get(`${genus}\0${ext}`) ?? null) as never
    },
    async findOrCreate(genus, ext, defaults) {
      const existing = personaByKey.get(`${genus}\0${ext}`)
      if (existing) return existing as never
      const p = { activeAnimaId: defaults!.animaId }
      personaByKey.set(`${genus}\0${ext}`, p)
      return p as never
    },
  }
  const animae: AcceptorDeps['animae'] = {
    async create(input) {
      const id = `anima-${created.length + 1}`
      created.push(id)
      return { id, ...input } as never
    },
  }
  return { personae, animae, created }
}

test('a key minted for an EXISTING animaId resolves back to that exact animaId end-to-end, minting NO new anima', async () => {
  const { personae, animae, created } = fakePersonaeAndAnimae()
  const usersCol = new FakeUsersCollection()

  // The partner's anima ALREADY exists (from their earlier login) — this is the animaId
  // the partner-request carried and the admin route approved. Nothing here mints it.
  const partnerAnimaId = 'anima-partner-existing'

  const apiKey = await mintPartnerApiKey({ personae, usersCol }, partnerAnimaId)
  assert.deepEqual(created, [], 'minting the key must not mint a new anima')

  // The real production chain: verifyApiKeyToAccountId -> validateApiKey -> resolveOrCreateAnima.
  const acceptors = makeCredentialAcceptors({
    personae,
    animae,
    verifyApiKeyToAccountId: (k: string) => verifyApiKeyToAccountId(usersCol, k),
  })
  const resolver = new IdentityResolver(acceptors)

  const resolved = await resolver.resolve({ apiKey })
  assert.deepEqual(resolved, { animaId: partnerAnimaId }, 'the key must resolve to the SAME anima it was minted for')
  assert.deepEqual(created, [], 'resolving the key must not mint a new anima either')
})

test('two partners each get a key that resolves ONLY to their own anima — never cross-attached', async () => {
  const { personae, animae, created } = fakePersonaeAndAnimae()
  const usersCol = new FakeUsersCollection()

  const keyA = await mintPartnerApiKey({ personae, usersCol }, 'anima-alice')
  const keyB = await mintPartnerApiKey({ personae, usersCol }, 'anima-bob')

  const acceptors = makeCredentialAcceptors({
    personae,
    animae,
    verifyApiKeyToAccountId: (k: string) => verifyApiKeyToAccountId(usersCol, k),
  })
  const resolver = new IdentityResolver(acceptors)

  assert.deepEqual(await resolver.resolve({ apiKey: keyA }), { animaId: 'anima-alice' })
  assert.deepEqual(await resolver.resolve({ apiKey: keyB }), { animaId: 'anima-bob' })
  assert.deepEqual(created, [], 'neither resolution mints a new anima')
})
