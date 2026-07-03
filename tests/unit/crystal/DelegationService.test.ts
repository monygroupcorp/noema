import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryDelegatio } from '../../../src/crystal/MemoryDelegatio.js'
import { DelegationService } from '../../../src/crystal/DelegationService.js'

const SECRET = 'test-delegation-secret'
function svc() {
  const delegationes = new MemoryDelegatio()
  return { delegationes, service: new DelegationService({ delegationes, jwtSecret: SECRET, ttlSeconds: 3600 }) }
}

test('create → list → redeem → verifySession round-trip', async () => {
  const { service } = svc()
  const { delegation, token, joinPath } = await service.create('camel42', { label: 'mods', spendCapPoints: 5000n })
  assert.equal(delegation.agentId, 'camel42')
  assert.equal(delegation.spentPoints, 0n)
  assert.match(joinPath, /^\/join\/camel42\//)

  const list = await service.list('camel42')
  assert.equal(list.length, 1)
  assert.equal(list[0].remainingPoints, 5000n)
  assert.equal(list[0].isExpired, false)

  const r = await service.redeem('camel42', token)
  assert.ok(r.ok)
  if (!r.ok) return
  assert.equal(r.remainingPoints, 5000n)
  // the session verifies back to the agent + delegation
  const s = service.verifySession(r.session)
  assert.deepEqual(s, { agentId: 'camel42', delegationId: delegation.id })
})

test('redeem refuses a wrong-agent token, a revoked link, an expired link, an exhausted cap', async () => {
  const { delegationes, service } = svc()
  const { token } = await service.create('camel42', { spendCapPoints: 1000n })

  assert.deepEqual(await service.redeem('camelOTHER', token), { ok: false, code: 'agent_mismatch' })
  assert.deepEqual(await service.redeem('camel42', 'nope'), { ok: false, code: 'invalid_token' })

  // revoked
  const revoked = await service.create('camel42', {})
  await service.revoke('camel42', revoked.delegation.id)
  assert.deepEqual((await service.redeem('camel42', revoked.token)), { ok: false, code: 'revoked' })

  // expired
  const exp = await service.create('camel42', { expiresInHours: 1 })
  const past = new Date(Date.now() + 2 * 3600 * 1000)
  assert.deepEqual((await service.redeem('camel42', exp.token, past)), { ok: false, code: 'expired' })

  // exhausted — drive spentPoints to the cap
  const d = await service.redeem('camel42', token)   // ok
  assert.ok(d.ok)
  await delegationes.recordSpend((await delegationes.findByToken(token))!.id, 1000n, new Date())
  assert.deepEqual(await service.redeem('camel42', token), { ok: false, code: 'exhausted' })
})

test('revoke only affects this agent; verifySession rejects tampered/foreign tokens', async () => {
  const { service } = svc()
  const a = await service.create('camel42', {})
  assert.equal(await service.revoke('camelX', a.delegation.id), false)   // not this agent's
  assert.equal(await service.revoke('camel42', 'ghost'), false)          // unknown id
  assert.equal(await service.revoke('camel42', a.delegation.id), true)

  assert.equal(service.verifySession('garbage.jwt.here'), null)
  // a token signed with a different secret must not verify
  const other = new DelegationService({ delegationes: new MemoryDelegatio(), jwtSecret: 'other', ttlSeconds: 3600 })
  const foreign = await other.create('camel42', {}).then((c) => other.redeem('camel42', c.token))
  assert.ok(foreign.ok)
  if (foreign.ok) assert.equal(service.verifySession(foreign.session), null)
})
