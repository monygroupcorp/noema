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
  rotatePartnerApiKey,
  PARTNER_KEY_NAME,
  assertMintable,
  PartnerNotMintable,
  type ApiKeyEntry,
  type ApiKeyUsersCollection,
  type MintPartnerApiKeyDeps,
} from '../../../src/crystal/apiKeys.js'
import { PARTNER_CONTRACT_VERSION } from '../../../src/crystal/partnerContract.js'
import { MemoryPartner } from '../../../src/crystal/MemoryPartner.js'
import { MemoryPartnerContract } from '../../../src/crystal/MemoryPartnerContract.js'
import type { Persona, PersonaGenus } from '../../../src/types/persona.js'

/**
 * A partner that has met all three mint conditions: approved, signed at the CURRENT agreement
 * version, and carrying a billing account. Every pre-existing mint/rotate test in this file
 * builds its deps through here, so those tests go on asserting what they always asserted — the
 * gate is a precondition they satisfy, not the thing they are about. The gate itself is
 * exercised by the `assertMintable` tests at the bottom, one missing condition at a time.
 */
async function mintableDeps(
  personae: MintPartnerApiKeyDeps['personae'],
  usersCol: ApiKeyUsersCollection,
  animaId = 'anima-real',
): Promise<MintPartnerApiKeyDeps> {
  const partners = new MemoryPartner()
  await partners.create({ animaId, sourceRequestId: 'req-1' })
  await partners.setBilling(animaId, { billingEmail: 'ap@example.com', billedTo: 'Example Ltd', netDays: 30, setAt: new Date() })
  const contracts = new MemoryPartnerContract()
  await contracts.sign({ animaId, version: PARTNER_CONTRACT_VERSION, signerName: 'A. Signer' })
  return { personae, usersCol, partners, contracts }
}

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

  async updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options?: { upsert?: boolean; arrayFilters?: Record<string, unknown>[] },
  ): Promise<unknown> {
    const id = String(filter._id)
    let doc = this.docs.get(id)
    if (!doc) {
      if (!options?.upsert) return { matchedCount: 0 }
      doc = { _id: id, apiKeys: [] }
      this.docs.set(id, doc)
    }
    const push = (update as { $push?: { apiKeys: ApiKeyEntry } }).$push
    if (push?.apiKeys) doc.apiKeys.push(push.apiKeys)
    const set = (update as { $set?: Record<string, unknown> })['$set']
    if (set && 'apiKeys.$[elem].status' in set) {
      const filterSpec = options?.arrayFilters?.[0] as { 'elem.name'?: string; 'elem.status'?: string } | undefined
      for (const k of doc.apiKeys) {
        if (filterSpec?.['elem.name'] !== undefined && k.name !== filterSpec['elem.name']) continue
        if (filterSpec?.['elem.status'] !== undefined && k.status !== filterSpec['elem.status']) continue
        k.status = set['apiKeys.$[elem].status'] as ApiKeyEntry['status']
      }
    }
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

  assert.deepEqual(await verifyApiKeyToAccountId(usersCol, apiKey), { accountId: 'acct-1', keyPrefix })
})

test('verifyApiKeyToAccountId: carries a stored maxImpetusPerRun through raw', async () => {
  const usersCol = new FakeUsersCollection()
  const { apiKey, keyPrefix, keyHash } = generateApiKeyMaterial()
  await appendApiKeyRecord(usersCol, 'acct-1', { keyPrefix, keyHash, status: 'active', maxImpetusPerRun: '500' })

  assert.deepEqual(await verifyApiKeyToAccountId(usersCol, apiKey), { accountId: 'acct-1', keyPrefix, maxImpetusPerRun: '500' })
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
  const deps = await mintableDeps(personae, usersCol)

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
  const deps = await mintableDeps(personae, usersCol)

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
  const deps = await mintableDeps(personae, usersCol)

  await assert.rejects(
    () => mintPartnerApiKey(deps, 'anima-real'),
    /refusing to mint a key that would authenticate as the wrong account/,
  )
  // No key written anywhere.
  assert.equal(usersCol.docs.size, 0)
})

test('mintPartnerApiKey: tags every entry name=PARTNER_KEY_NAME (so rotate can find, and other keys can be spared)', async () => {
  const personae = fakePersonae()
  const usersCol = new FakeUsersCollection()
  await mintPartnerApiKey(await mintableDeps(personae, usersCol), 'anima-real')
  assert.equal(usersCol.docs.get('anima-real')?.apiKeys[0]?.name, PARTNER_KEY_NAME)
})

test('rotatePartnerApiKey: first call has nothing to retire, mints one active key', async () => {
  const personae = fakePersonae()
  const usersCol = new FakeUsersCollection()
  const apiKey = await rotatePartnerApiKey(await mintableDeps(personae, usersCol), 'anima-real')
  assert.match(apiKey, /^ms2_[0-9a-f]{48}$/)
  const keys = usersCol.docs.get('anima-real')?.apiKeys ?? []
  assert.equal(keys.length, 1)
  assert.equal(keys[0]?.status, 'active')
})

test('rotatePartnerApiKey: a second call retires the first (real rotation, not accumulation)', async () => {
  const personae = fakePersonae()
  const usersCol = new FakeUsersCollection()
  const deps = await mintableDeps(personae, usersCol)
  const first = await rotatePartnerApiKey(deps, 'anima-real')
  const second = await rotatePartnerApiKey(deps, 'anima-real')
  assert.notEqual(first, second)
  const keys = usersCol.docs.get('anima-real')?.apiKeys ?? []
  assert.equal(keys.length, 2, 'both entries kept — the old one is retired, not deleted')
  const active = keys.filter(k => k.status === 'active')
  assert.equal(active.length, 1, 'exactly one live key after rotation')
  assert.equal(await verifyApiKeyToAccountId(usersCol, first), null, 'the retired key no longer resolves')
  assert.deepEqual(await verifyApiKeyToAccountId(usersCol, second), {
    accountId: 'anima-real',
    keyPrefix: second.slice(0, 12),
    keyName: PARTNER_KEY_NAME,
    contractVersion: PARTNER_CONTRACT_VERSION,
  })
})

test('rotatePartnerApiKey: never touches a key minted some other way on the same account', async () => {
  const personae = fakePersonae()
  const usersCol = new FakeUsersCollection()
  // A key minted by some other path (e.g. mint-staging-key.ts) — no `name` tag.
  const { keyPrefix, keyHash } = generateApiKeyMaterial()
  await appendApiKeyRecord(usersCol, 'anima-real', { keyPrefix, keyHash, status: 'active' })

  await rotatePartnerApiKey(await mintableDeps(personae, usersCol), 'anima-real')

  const untaggedKey = usersCol.docs.get('anima-real')?.apiKeys.find(k => k.keyPrefix === keyPrefix)
  assert.equal(untaggedKey?.status, 'active', 'a key with no partner tag survives rotation untouched')
})

// =============================================================================
// The mint gate — no key without an active partner, a signed CURRENT agreement,
// and a billing account
// =============================================================================
//
// One test per missing condition, each removing exactly one thing from an otherwise
// mintable partner, so a refusal can never pass for the wrong reason.

/** A partner with all three conditions met, with seams to knock one out. */
async function gateFixture(opts: { approved?: boolean; revoked?: boolean; signed?: boolean | 'stale'; billing?: boolean } = {}) {
  const animaId = 'anima-real'
  const partners = new MemoryPartner()
  if (opts.approved !== false) {
    await partners.create({ animaId, sourceRequestId: 'req-1', ...(opts.revoked ? { status: 'revoked' as const } : {}) })
    if (opts.billing !== false) {
      await partners.setBilling(animaId, { billingEmail: 'ap@example.com', billedTo: 'Example Ltd', netDays: 30, setAt: new Date() })
    }
  }
  const contracts = new MemoryPartnerContract()
  if (opts.signed === 'stale') {
    await contracts.sign({ animaId, version: 'api-1999-01-01', signerName: 'A. Signer' })
  } else if (opts.signed !== false) {
    await contracts.sign({ animaId, version: PARTNER_CONTRACT_VERSION, signerName: 'A. Signer' })
  }
  const personae = fakePersonae()
  const usersCol = new FakeUsersCollection()
  return { animaId, usersCol, deps: { personae, usersCol, partners, contracts } as MintPartnerApiKeyDeps }
}

test('assertMintable: passes when the partner is approved, signed at the current version, and billable', async () => {
  const { deps, animaId } = await gateFixture()
  await assertMintable(deps, animaId)   // does not throw
})

test('mintPartnerApiKey: refuses an account with no partner record, and writes no key', async () => {
  const { deps, animaId, usersCol } = await gateFixture({ approved: false })
  await assert.rejects(() => mintPartnerApiKey(deps, animaId), (err: unknown) => {
    assert.ok(err instanceof PartnerNotMintable)
    assert.equal(err.reason, 'not_a_partner')
    return true
  })
  assert.equal(usersCol.docs.size, 0, 'nothing was written')
})

test('mintPartnerApiKey: refuses a REVOKED partner — cutting access must also stop new keys', async () => {
  const { deps, animaId, usersCol } = await gateFixture({ revoked: true })
  await assert.rejects(() => mintPartnerApiKey(deps, animaId), (err: unknown) => {
    assert.ok(err instanceof PartnerNotMintable)
    assert.equal(err.reason, 'not_a_partner')
    return true
  })
  assert.equal(usersCol.docs.size, 0)
})

test('mintPartnerApiKey: refuses an unsigned agreement', async () => {
  const { deps, animaId, usersCol } = await gateFixture({ signed: false })
  await assert.rejects(() => mintPartnerApiKey(deps, animaId), (err: unknown) => {
    assert.ok(err instanceof PartnerNotMintable)
    assert.equal(err.reason, 'contract_unsigned')
    return true
  })
  assert.equal(usersCol.docs.size, 0)
})

test('mintPartnerApiKey: a signature on a SUPERSEDED version is not a signature on this one', async () => {
  const { deps, animaId, usersCol } = await gateFixture({ signed: 'stale' })
  await assert.rejects(() => mintPartnerApiKey(deps, animaId), (err: unknown) => {
    assert.ok(err instanceof PartnerNotMintable)
    assert.equal(err.reason, 'contract_unsigned')
    return true
  })
  assert.equal(usersCol.docs.size, 0)
})

test('mintPartnerApiKey: refuses when no billing account is on file', async () => {
  const { deps, animaId, usersCol } = await gateFixture({ billing: false })
  await assert.rejects(() => mintPartnerApiKey(deps, animaId), (err: unknown) => {
    assert.ok(err instanceof PartnerNotMintable)
    assert.equal(err.reason, 'no_billing_account')
    return true
  })
  assert.equal(usersCol.docs.size, 0)
})

test('mintPartnerApiKey: stamps the key with the agreement version it was minted against', async () => {
  const { deps, animaId, usersCol } = await gateFixture()
  await mintPartnerApiKey(deps, animaId)
  assert.equal(usersCol.docs.get(animaId)?.apiKeys[0]?.contractVersion, PARTNER_CONTRACT_VERSION)
})

test('rotatePartnerApiKey: a refused rotation leaves the existing key live', async () => {
  // The order matters: gate first, retire second. A partner whose billing account was removed
  // must not lose the key it is holding as a side effect of asking for a new one.
  const { deps, animaId, usersCol } = await gateFixture()
  const original = await rotatePartnerApiKey(deps, animaId)
  await deps.partners.find(animaId)   // sanity: the fixture's store is the one the gate reads
  const partners = new MemoryPartner()
  await partners.create({ animaId, sourceRequestId: 'req-1' })   // same partner, billing removed
  const degraded: MintPartnerApiKeyDeps = { ...deps, partners }

  await assert.rejects(() => rotatePartnerApiKey(degraded, animaId), PartnerNotMintable)
  assert.equal(
    (await verifyApiKeyToAccountId(usersCol, original))?.accountId,
    animaId,
    'the key the partner already holds still resolves',
  )
})
