import { test } from 'node:test'
import assert from 'node:assert/strict'
import jwt from 'jsonwebtoken'
import { makeCredentialAcceptors, parseKeyImpetusCeiling, type AcceptorDeps } from '../../../../src/allocutio/api/apiAcceptors.js'
import { PARTNER_KEY_NAME } from '../../../../src/crystal/apiKeys.js'

const SECRET = 'test-secret'

function fakes() {
  const personaByKey = new Map<string, { activeAnimaId: string }>()
  let n = 0
  const created: string[] = []
  const personae: AcceptorDeps['personae'] = {
    async findByExternus(genus, ext) {
      return (personaByKey.get(`${genus}\0${ext}`) ?? null) as never
    },
    async findOrCreate(genus, ext, defaults) {
      const p = { activeAnimaId: defaults!.animaId }
      personaByKey.set(`${genus}\0${ext}`, p)
      return p as never
    },
  }
  const animae: AcceptorDeps['animae'] = {
    async create(input) {
      const id = `anima-${++n}`
      created.push(id)
      return { id, ...input } as never
    },
  }
  return { personae, animae, created }
}

test('verifyJwt: valid token mints an anima on first sight, reuses it after', async () => {
  const { personae, animae, created } = fakes()
  const acc = makeCredentialAcceptors({ personae, animae, jwtSecret: SECRET })
  const token = jwt.sign({ userId: 'u1' }, SECRET)

  const a1 = await acc.verifyJwt!(token)
  assert.equal(a1, 'anima-1')
  assert.deepEqual(created, ['anima-1'])

  const a2 = await acc.verifyJwt!(token)   // persona now exists → reuse, no new anima
  assert.equal(a2, 'anima-1')
  assert.deepEqual(created, ['anima-1'], 'no second anima minted')
})

test('verifyJwt: bad signature, wrong secret, or no id → null', async () => {
  const { personae, animae } = fakes()
  const acc = makeCredentialAcceptors({ personae, animae, jwtSecret: SECRET })
  assert.equal(await acc.verifyJwt!('garbage'), null)
  assert.equal(await acc.verifyJwt!(jwt.sign({ userId: 'u1' }, 'wrong')), null)
  assert.equal(await acc.verifyJwt!(jwt.sign({ foo: 'bar' }, SECRET)), null, 'no userId/sub → null')
})

test('verifyJwt accepts sub/_id/id as the external id', async () => {
  const { personae, animae } = fakes()
  const acc = makeCredentialAcceptors({ personae, animae, jwtSecret: SECRET })
  assert.equal(await acc.verifyJwt!(jwt.sign({ sub: 's1' }, SECRET)), 'anima-1')
})

test('verifyJwt: a typ:session token returns sub as a DIRECT animaId (no re-resolution)', async () => {
  const { personae, animae, created } = fakes()
  const acc = makeCredentialAcceptors({ personae, animae, jwtSecret: SECRET })
  // The fiat-auth session shape — sub IS the animaId; must NOT mint a new anima via a 'web' persona.
  const session = jwt.sign({ sub: 'anima-xyz', typ: 'session' }, SECRET)
  assert.equal(await acc.verifyJwt!(session), 'anima-xyz')
  assert.deepEqual(created, [], 'no anima minted for a session token')
  // A session token with a non-string sub is rejected.
  assert.equal(await acc.verifyJwt!(jwt.sign({ typ: 'session' }, SECRET)), null)
})

test('validateApiKey: injected verifier → anima via an api persona', async () => {
  const { personae, animae } = fakes()
  const acc = makeCredentialAcceptors({
    personae, animae,
    verifyApiKeyToAccountId: async (k) => (k === 'good' ? { accountId: 'acct1' } : null),
  })
  // A key record with no `maxImpetusPerRun` resolves to the animaId and NOTHING else — the shape
  // every key had before per-key ceilings existed, and the shape every non-partner key still has.
  assert.deepEqual(await acc.validateApiKey!('good'), { animaId: 'anima-1' })
  assert.deepEqual(await acc.validateApiKey!('good'), { animaId: 'anima-1' }, 'same account → same anima')
  assert.equal(await acc.validateApiKey!('bad'), null)
})

// ── Per-key spend ceiling (`maxImpetusPerRun`) ────────────────────────────────

test('validateApiKey: a stored maxImpetusPerRun rides through as a bigint ceiling', async () => {
  const { personae, animae } = fakes()
  const acc = makeCredentialAcceptors({
    personae, animae,
    // Stored as a STRING — the value can exceed Number.MAX_SAFE_INTEGER and must survive the trip.
    verifyApiKeyToAccountId: async () => ({ accountId: 'acct1', maxImpetusPerRun: '9007199254740993' }),
  })
  assert.deepEqual(await acc.validateApiKey!('good'), {
    animaId: 'anima-1',
    maxImpetusPerRun: 9007199254740993n,
  })
})

test('validateApiKey: a MALFORMED maxImpetusPerRun refuses the key rather than dropping the ceiling', async () => {
  // The whole point of the field is to cap spend. A ceiling that cannot be read must never
  // degrade to "no ceiling" — that would turn one corrupt record into an uncapped key. Refusing
  // the key fails closed: the caller gets auth.invalid and no run is admitted.
  const { personae, animae, created } = fakes()
  for (const bad of ['', 'lots', '-1', '1e6', '1.5', ' 7 ']) {
    const acc = makeCredentialAcceptors({
      personae, animae,
      verifyApiKeyToAccountId: async () => ({ accountId: 'acct1', maxImpetusPerRun: bad }),
    })
    assert.equal(await acc.validateApiKey!('good'), null, `'${bad}' must refuse the key`)
  }
  assert.deepEqual(created, [], 'a refused key mints no anima')
})

test('parseKeyImpetusCeiling: absent → undefined, canonical digits → bigint, anything else → null', async () => {
  // undefined/null in — the shape of every key minted before the field existed.
  assert.equal(parseKeyImpetusCeiling(undefined), undefined)
  assert.equal(parseKeyImpetusCeiling(null), undefined)
  // A canonical non-negative integer string.
  assert.equal(parseKeyImpetusCeiling('0'), 0n)
  assert.equal(parseKeyImpetusCeiling('250000'), 250000n)
  // Everything else is unreadable, and unreadable is a refusal, never "no ceiling".
  for (const bad of ['', ' ', '-1', '1.0', '0x10', '1e3', 'nope', 42, 42n, {}, []]) {
    assert.equal(parseKeyImpetusCeiling(bad), null, `${String(bad)} must be unreadable`)
  }
})

test('verifyWeb3: injected verifier → anima via a web persona keyed by lowercased address', async () => {
  const { personae, animae } = fakes()
  const acc = makeCredentialAcceptors({
    personae, animae,
    verifyWeb3ToAddress: async (w) => (w.signature === 'sig' ? '0xABC' : null),
  })
  assert.equal(await acc.verifyWeb3!({ address: '0xABC', signature: 'sig', nonce: 'n' }), 'anima-1')
  assert.equal(await acc.verifyWeb3!({ address: '0xABC', signature: 'bad', nonce: 'n' }), null)
})

test('unconfigured acceptors are undefined', async () => {
  const { personae, animae } = fakes()
  const acc = makeCredentialAcceptors({ personae, animae })
  assert.equal(acc.verifyJwt, undefined)
  assert.equal(acc.validateApiKey, undefined)
  assert.equal(acc.verifyWeb3, undefined)
})

// =============================================================================
// The B2B key gate on the CALL — the three mint conditions, re-asked per request
// =============================================================================
//
// `assertMintable` answers them once, at issue. All three decay: a partner is revoked, the
// agreement is revised, a billing account is removed. A key that outlived any of them is a
// customer generating outside the arrangement it signed, so the acceptor asks again — and a
// refusal is a plain 401, indistinguishable from a key that never verified.

test('validateApiKey: a PARTNER key is admitted when the gate says yes, and carries its prefix through', async () => {
  const { personae, animae } = fakes()
  const acc = makeCredentialAcceptors({
    personae,
    animae,
    verifyApiKeyToAccountId: async () => ({ accountId: 'acct-1', keyPrefix: 'ms2_abc1234', keyName: PARTNER_KEY_NAME, contractVersion: 'v1' }),
    partnerKeyAdmitted: async () => true,
  })
  assert.deepEqual(await acc.validateApiKey!('ms2_abc1234def'), { animaId: 'anima-1', keyPrefix: 'ms2_abc1234' })
})

test('validateApiKey: a PARTNER key the gate refuses does not verify at all', async () => {
  const { personae, animae } = fakes()
  const acc = makeCredentialAcceptors({
    personae,
    animae,
    verifyApiKeyToAccountId: async () => ({ accountId: 'acct-1', keyPrefix: 'ms2_abc1234', keyName: PARTNER_KEY_NAME, contractVersion: 'v1' }),
    partnerKeyAdmitted: async () => false,
  })
  assert.equal(await acc.validateApiKey!('ms2_abc1234def'), null)
})

test('validateApiKey: the gate is asked with the animaId and the version stamped on the key', async () => {
  const { personae, animae } = fakes()
  const asked: Array<[string, string | undefined]> = []
  const acc = makeCredentialAcceptors({
    personae,
    animae,
    verifyApiKeyToAccountId: async () => ({ accountId: 'acct-1', keyName: PARTNER_KEY_NAME, contractVersion: 'api-2026-09-17' }),
    partnerKeyAdmitted: async (animaId, version) => {
      asked.push([animaId, version])
      return true
    },
  })
  await acc.validateApiKey!('ms2_abc1234def')
  assert.deepEqual(asked, [['anima-1', 'api-2026-09-17']])
})

test('validateApiKey: a partner key with an UNREADABLE stored version reaches the gate as undefined (fail-closed)', async () => {
  // Mirrors `parseKeyImpetusCeiling`'s discipline: a stored value that is not the type the field
  // promises must never degrade into "no constraint". It arrives as `undefined`, which every real
  // gate refuses, rather than silently matching the current version.
  const { personae, animae } = fakes()
  const asked: Array<string | undefined> = []
  const acc = makeCredentialAcceptors({
    personae,
    animae,
    verifyApiKeyToAccountId: async () => ({ accountId: 'acct-1', keyName: PARTNER_KEY_NAME, contractVersion: { nope: true } }),
    partnerKeyAdmitted: async (_animaId, version) => {
      asked.push(version)
      return false
    },
  })
  assert.equal(await acc.validateApiKey!('ms2_abc1234def'), null)
  assert.deepEqual(asked, [undefined])
})

test('validateApiKey: a NON-partner key never reaches the gate', async () => {
  // The gate governs the B2B program. A key the account holder minted some other way — a staging
  // key, say — is not part of that arrangement and must keep working exactly as it did.
  const { personae, animae } = fakes()
  let asked = 0
  const acc = makeCredentialAcceptors({
    personae,
    animae,
    verifyApiKeyToAccountId: async () => ({ accountId: 'acct-1', keyPrefix: 'ms2_abc1234' }),
    partnerKeyAdmitted: async () => {
      asked += 1
      return false
    },
  })
  assert.deepEqual(await acc.validateApiKey!('ms2_abc1234def'), { animaId: 'anima-1', keyPrefix: 'ms2_abc1234' })
  assert.equal(asked, 0, 'the partner gate was not consulted for a key that is not a partner key')
})

test('validateApiKey: with NO gate wired, a partner key is admitted on its stored fields alone', async () => {
  // A deployment that wires no partner directory has no B2B program to enforce; it must not be
  // turned into one that refuses every partner key.
  const { personae, animae } = fakes()
  const acc = makeCredentialAcceptors({
    personae,
    animae,
    verifyApiKeyToAccountId: async () => ({ accountId: 'acct-1', keyName: PARTNER_KEY_NAME, contractVersion: 'v1' }),
  })
  assert.deepEqual(await acc.validateApiKey!('ms2_abc1234def'), { animaId: 'anima-1' })
})
