// =============================================================================
// GDPR Art. 17 right-to-erasure — the invariants that must hold.
// =============================================================================
//
// Pseudonymize-and-tombstone: sever the PERSON, RETAIN the anonymized financial rows. These
// hermetic tests (pure fakes, no Mongo) assert every load-bearing invariant the two-reviewer
// the review stresses:
//   • denylist FIRST, then tombstone, then hard-deletes (ordering/safety);
//   • the identity/content collections are hard-deleted; dicta are cascaded before their colloquia;
//   • the financial ledger + ZK anonymity set are UNTOUCHED (no such store is even wired into the
//     eraser — it structurally cannot reach them);
//   • the Anima is tombstoned with `retentionUntil = erasedAt + 7y`;
//   • idempotent re-run completes cleanly (never double-deletes / errors);
//   • a previously-valid session JWT for the erased animaId is REJECTED by verifyJwt;
//   • DELETE /v1/me resolves auth FIRST (401, no feature-state disclosure) then, once
//     authenticated, gates OFF (501) when ERASURE_ENABLED is unset;
//   • an anon caller cannot be erased (403); the receipt copy is truthful (retained, not "all gone").
// =============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import express from 'express'
import jwt from 'jsonwebtoken'

import { MeEraser, ERASURE_RETENTION_YEARS } from '../../../../src/crystal/MeEraser.js'
import { makeCredentialAcceptors } from '../../../../src/allocutio/api/apiAcceptors.js'
import { createApiRouter, type ApiFacade, type Identity } from '../../../../src/allocutio/api/apiRouter.js'
import { CrystalApi } from '../../../../src/allocutio/api/CrystalApi.js'
import { ownerKeyOf } from '../../../../src/crystal/ownerKey.js'
import { Errors } from '../../../../src/allocutio/api/errors.js'
import type { AuctorKey } from '../../../../src/flow/types.js'
import type { ResolvedCaller } from '../../../../src/allocutio/api/IdentityResolver.js'

// ---------------------------------------------------------------------------
// MeEraser — the orchestration + ordering + idempotency + retention invariants
// ---------------------------------------------------------------------------

function makeEraserFakes() {
  const calls: string[] = []
  const denylisted = new Set<string>()
  const tombstones: Array<{ id: string; stamp: { erasedAt: Date; retentionUntil: Date } }> = []
  let dictaGotIds: string[] | null = null
  let colloquiaOwnerKey: string | null = null

  const deps = {
    denylist: {
      async add(id: string) { calls.push('denylist.add'); denylisted.add(id) },
      async has(id: string) { return denylisted.has(id) },
    },
    animae: {
      async tombstone(id: string, stamp: { erasedAt: Date; retentionUntil: Date }) {
        calls.push('tombstone'); tombstones.push({ id, stamp })
      },
    },
    personae: { async deleteByAnima() { calls.push('personae'); return 1 } },
    credenta: { async deleteByAnima() { calls.push('credenta'); return 1 } },
    consuetudinum: { async deleteByAnima() { calls.push('consuetudinum'); return 3 } },
    memoriae: { async deleteByAnima() { calls.push('memoriae'); return 1 } },
    provinciae: { async deleteByOwner() { calls.push('provinciae'); return 2 } },
    petitiones: { async deleteByAnima() { calls.push('petitiones'); return 0 } },
    colloquia: {
      async listIdsByOwner(ownerKey: string) { calls.push('colloquia.list'); colloquiaOwnerKey = ownerKey; return ['c1', 'c2'] },
      async deleteByOwner() { calls.push('colloquia.del'); return 2 },
    },
    dicta: { async deleteByColloquia(ids: string[]) { calls.push('dicta'); dictaGotIds = ids; return 5 } },
  }
  return {
    deps,
    calls,
    denylisted,
    tombstones,
    get dictaGotIds() { return dictaGotIds },
    get colloquiaOwnerKey() { return colloquiaOwnerKey },
  }
}

test('MeEraser: denylist FIRST, then tombstone, then the hard-deletes (ordering/safety)', async () => {
  const f = makeEraserFakes()
  await new MeEraser(f.deps).erase('anima-1')
  assert.equal(f.calls[0], 'denylist.add', 'denylist must be added BEFORE anything else (revoke sessions first)')
  assert.equal(f.calls[1], 'tombstone', 'tombstone (sever PII) must come before the hard-deletes')
  // dicta must be deleted BEFORE their parent colloquia (no orphaned messages).
  assert.ok(f.calls.indexOf('colloquia.list') < f.calls.indexOf('dicta'), 'colloquium ids gathered before dicta delete')
  assert.ok(f.calls.indexOf('dicta') < f.calls.indexOf('colloquia.del'), 'dicta deleted before their colloquia')
})

test('MeEraser: hard-deletes the identity/content collections and cascades dicta by the caller ids', async () => {
  const f = makeEraserFakes()
  const receipt = await new MeEraser(f.deps).erase('anima-1')
  for (const step of ['personae', 'credenta', 'consuetudinum', 'memoriae', 'provinciae', 'petitiones', 'colloquia.del']) {
    assert.ok(f.calls.includes(step), `${step} must be erased`)
  }
  assert.deepEqual(f.dictaGotIds, ['c1', 'c2'], 'dicta cascade uses exactly the caller\'s own colloquium ids')
  assert.equal(f.colloquiaOwnerKey, ownerKeyOf({ animaId: 'anima-1' }), 'colloquia scoped by the caller\'s ownerKey')
  assert.deepEqual(receipt.deleted, {
    personae: 1, credenta: 1, consuetudines: 3, memoriae: 1, provinciae: 2, petitiones: 0, colloquia: 2, dicta: 5,
  })
})

test('MeEraser: tombstones the Anima with retentionUntil = erasedAt + 7y', async () => {
  const f = makeEraserFakes()
  const receipt = await new MeEraser(f.deps).erase('anima-1')
  assert.equal(f.tombstones.length, 1)
  const { erasedAt, retentionUntil } = f.tombstones[0].stamp
  assert.equal(retentionUntil.getUTCFullYear() - erasedAt.getUTCFullYear(), ERASURE_RETENTION_YEARS)
  // the receipt echoes the same stamps (ISO), and the window is 7y there too.
  assert.equal(
    new Date(receipt.retentionUntil).getUTCFullYear() - new Date(receipt.erasedAt).getUTCFullYear(),
    7,
  )
  assert.equal(receipt.animaId, 'anima-1', 'the opaque anchor is retained in the receipt')
})

test('MeEraser: the financial ledger + ZK set are UNTOUCHED (structurally unreachable) and the receipt says so truthfully', async () => {
  const f = makeEraserFakes()
  const receipt = await new MeEraser(f.deps).erase('anima-1')
  // The eraser deps carry NO ledger/deposita/reditus/arcanum store — it cannot mutate them.
  const wiredStores = Object.keys(f.deps)
  for (const forbidden of ['signorum', 'deposita', 'reditus', 'redituum', 'arcanum', 'solutiones']) {
    assert.ok(!wiredStores.includes(forbidden), `eraser must NOT be wired with a ${forbidden} store`)
  }
  assert.equal(receipt.retained.financialLedger, 'untouched')
  assert.equal(receipt.retained.publishedWorks, 'anonymized-in-place')
})

test('MeEraser: idempotent — a re-run on an already-erased soul completes cleanly (no double-delete error)', async () => {
  const f = makeEraserFakes()
  const eraser = new MeEraser(f.deps)
  await eraser.erase('anima-1')
  // Re-run must not throw; the denylist add is a no-op-safe re-add, deletes return 0-or-more.
  await assert.doesNotReject(() => eraser.erase('anima-1'))
  assert.ok(f.denylisted.has('anima-1'))
})

// ---------------------------------------------------------------------------
// verifyJwt — the session-revocation invariant (the load-bearing assertion)
// ---------------------------------------------------------------------------

const SECRET = 'test-secret-noema-025'
function acceptorsWithDenylist(denylisted: Set<string>) {
  return makeCredentialAcceptors({
    personae: { async findByExternus() { return null }, async findOrCreate() { return {} as never } },
    animae: { async create() { return { id: 'never' } as never } },
    jwtSecret: SECRET,
    denylist: { async add(id: string) { denylisted.add(id) }, async has(id: string) { return denylisted.has(id) } },
  })
}

test('verifyJwt: a previously-valid SESSION JWT for an ERASED animaId is REJECTED (session revoked)', async () => {
  const denylisted = new Set<string>()
  const acceptors = acceptorsWithDenylist(denylisted)
  const token = jwt.sign({ sub: 'anima-erased', typ: 'session' }, SECRET)

  // Before erasure the token authenticates to its animaId.
  assert.equal(await acceptors.verifyJwt!(token), 'anima-erased')

  // After erasure adds the soul to the denylist, the SAME signature-valid token is rejected.
  denylisted.add('anima-erased')
  assert.equal(await acceptors.verifyJwt!(token), null, 'erased soul\'s live JWT must be revoked')
})

test('verifyJwt: a non-denylisted session token still authenticates (no false revocation)', async () => {
  const acceptors = acceptorsWithDenylist(new Set())
  const token = jwt.sign({ sub: 'anima-live', typ: 'session' }, SECRET)
  assert.equal(await acceptors.verifyJwt!(token), 'anima-live')
})

// ---------------------------------------------------------------------------
// CrystalApi.eraseMe — self-only + anon-denied + unavailable-guard
// ---------------------------------------------------------------------------

function crystalApiWithEraser(eraser: unknown): CrystalApi {
  // Only `eraser` (and, via the method, Errors) is exercised by eraseMe — a partial deps object is
  // sufficient at runtime (tsx strips the type). Cast keeps the test self-contained.
  return new CrystalApi({ eraser } as never)
}

test('CrystalApi.eraseMe: SELF-ONLY — erases exactly the authenticated caller\'s own animaId', async () => {
  let got: string | null = null
  const api = crystalApiWithEraser({ async erase(id: string) { got = id; return { animaId: id } } })
  await api.eraseMe({ animaId: 'caller-self' })
  assert.equal(got, 'caller-self', 'eraseMe passes the caller\'s OWN animaId — a caller can never target another owner')
})

test('CrystalApi.eraseMe: an anonymous caller (commitment/bursaToken) cannot be erased (403)', async () => {
  const api = crystalApiWithEraser({ async erase() { throw new Error('should not be called') } })
  await assert.rejects(() => api.eraseMe({ commitment: 'cmt-1' }), /signed-in account/i)
  await assert.rejects(() => api.eraseMe({ bursaToken: 'tok-1' } as AuctorKey), /signed-in account/i)
})

test('CrystalApi.eraseMe: unavailable when no eraser is wired (flag-off deployment)', async () => {
  const api = crystalApiWithEraser(undefined)
  await assert.rejects(() => api.eraseMe({ animaId: 'x' }), /unavailable/i)
})

// ---------------------------------------------------------------------------
// DELETE /v1/me — the flag gate (404 when disabled) + wiring when enabled
// ---------------------------------------------------------------------------

function serve(router: express.Router): Promise<{ base: string; close: () => void }> {
  const app = express()
  app.use(express.json())
  app.use('/v1', router)
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const addr = server.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      resolve({ base: `http://127.0.0.1:${port}`, close: () => server.close() })
    })
  })
}

function del(base: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(`${base}/v1/me`, { method: 'DELETE' }, (res) => {
      let data = ''
      res.on('data', (c) => (data += c))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }))
    })
    req.on('error', reject)
    req.end()
  })
}

// `Identity` also carries `resolveCaller` — identity plus the limits the CREDENTIAL imposes
// (a partner API key's per-run spend ceiling). These stubs mint no ceiling, so it is `resolve`
// plus an empty limit set: exactly the shape a key with no ceiling resolves to.
const fakeIdentity: Identity = {
  async resolve(): Promise<AuctorKey> { return { animaId: 'anima-1' } },
  async resolveCaller(creds): Promise<ResolvedCaller> { return { auctor: await this.resolve(creds) } },
}
// An unauthenticating stub — mirrors a real resolver rejecting a caller with no credentials, so
// the auth-first ordering is actually exercised (noema-178).
const unauthIdentity: Identity = {
  async resolve(): Promise<AuctorKey> { throw Errors.authMissing() },
  async resolveCaller(creds): Promise<ResolvedCaller> { return { auctor: await this.resolve(creds) } },
}

test('DELETE /v1/me: unauthenticated caller gets 401 and never learns the feature-state', async () => {
  let called = false
  const api = { async eraseMe() { called = true; return {} } } as unknown as ApiFacade
  const router = createApiRouter({ api, identity: unauthIdentity /* erasureEnabled omitted → off */ })
  const s = await serve(router)
  try {
    const res = await del(s.base)
    assert.equal(res.status, 401, 'no credential → 401, auth runs before the feature-state check')
    assert.doesNotMatch(res.body, /erasure/i, 'the response must not reveal the erasure feature-state')
    assert.equal(called, false, 'eraseMe must NOT run when the caller is unauthenticated')
  } finally { s.close() }
})

test('DELETE /v1/me: authenticated + gated OFF → 501 (does not run eraseMe)', async () => {
  let called = false
  const api = { async eraseMe() { called = true; return {} } } as unknown as ApiFacade
  const router = createApiRouter({ api, identity: fakeIdentity /* erasureEnabled omitted → off */ })
  const s = await serve(router)
  try {
    const res = await del(s.base)
    assert.equal(res.status, 501, 'authenticated + flag off → 501 Not Implemented')
    assert.equal(called, false, 'eraseMe must NOT run when the flag is off')
  } finally { s.close() }
})

test('DELETE /v1/me: when erasureEnabled, authenticates the caller and calls eraseMe', async () => {
  let erasedAuctor: AuctorKey | null = null
  const api = { async eraseMe(a: AuctorKey) { erasedAuctor = a; return { animaId: 'anima-1', retained: { financialLedger: 'untouched' } } } } as unknown as ApiFacade
  const router = createApiRouter({ api, identity: fakeIdentity, erasureEnabled: true })
  const s = await serve(router)
  try {
    const res = await del(s.base)
    assert.equal(res.status, 200)
    assert.deepEqual(erasedAuctor, { animaId: 'anima-1' }, 'the authenticated caller is erased')
    assert.match(res.body, /untouched/, 'truthful receipt surfaces the retained financial ledger')
  } finally { s.close() }
})
