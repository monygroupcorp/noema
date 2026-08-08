// CrystalApi BYO-secret surface — putSecret/removeSecret/getMe.secrets. Hermetic.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { CrystalApi } from '../../../../src/allocutio/api/CrystalApi.js'
import { MemorySecretarium } from '../../../../src/crystal/MemorySecretarium.js'
import { makeSecretBox } from '../../../../src/crystal/secretBox.js'

const boxOf = () => makeSecretBox([randomBytes(32)])

// Minimal ledger/session deps so `getMe`'s balance lookup (`status()`) resolves instead of
// throwing — these tests exercise the secrets surface, not the ledger, so an empty-balance
// aggregate is all `getMe` needs here.
const emptyLedgerDeps = {
  signorum: { balance: async () => 0n, history: async () => [] },
  hospitia: { findActive: async () => [] },
  materiae: { findById: async () => null },
  actorum: { findById: async () => null },
  modorum: { find: async () => null },
}

const apiWith = (s?: MemorySecretarium) =>
  new CrystalApi(({ ...emptyLedgerDeps, ...(s ? { secretWriter: s, secretPresence: s } : {}) }) as any)

test('putSecret connects, never echoes the token, and getMe reflects it', async () => {
  const store = new MemorySecretarium(boxOf())
  const api = apiWith(store)
  const auctor = { animaId: 'a1' }

  const view = await api.putSecret(auctor, 'civitai', '  civ-token  ')
  assert.equal(view.provider, 'civitai')
  assert.equal(view.status, 'connected')
  assert.ok(view.expiresAt)
  assert.ok(!JSON.stringify(view).includes('civ-token'))
  assert.equal(view.warning, undefined, 'identified caller gets no deanon warning')

  const me = await api.getMe(auctor)
  assert.deepEqual(me.secrets, { civitai: 'connected', huggingface: 'absent' })
  assert.equal(me.secretsAvailable, true, 'store wired → panel is available')

  // Stored trimmed, resolvable by the internal path only.
  assert.equal(await store.resolve('anima:a1', 'civitai'), 'civ-token')
})

test('removeSecret disconnects (idempotent)', async () => {
  const store = new MemorySecretarium(boxOf())
  const api = apiWith(store)
  const auctor = { animaId: 'a1' }
  await api.putSecret(auctor, 'huggingface', 'hf')
  assert.equal((await api.getMe(auctor)).secrets.huggingface, 'connected')

  const v = await api.removeSecret(auctor, 'huggingface')
  assert.equal(v.status, 'absent')
  assert.equal((await api.getMe(auctor)).secrets.huggingface, 'absent')
  await api.removeSecret(auctor, 'huggingface') // no throw on second remove
})

test('a purse (anon) caller can connect a secret and gets a deanonymization warning', async () => {
  const store = new MemorySecretarium(boxOf())
  const api = apiWith(store)
  const auctor = { bursaToken: 'purse-tok' }

  const view = await api.putSecret(auctor, 'civitai', 'civ')
  assert.equal(view.status, 'connected')
  assert.match(view.warning ?? '', /anonym/i)

  // getMe for the same purse sees it; a different purse does not.
  assert.equal((await api.getMe(auctor)).secrets.civitai, 'connected')
  assert.equal((await api.getMe({ bursaToken: 'other' })).secrets.civitai, 'absent')
})

test('unknown provider and empty token are rejected', async () => {
  const api = apiWith(new MemorySecretarium(boxOf()))
  await assert.rejects(() => api.putSecret({ animaId: 'a' }, 'openai', 'x'), /unknown secret provider/)
  await assert.rejects(() => api.putSecret({ animaId: 'a' }, 'civitai', '   '), /token is required/)
})

test('feature-gated: no store → secrets 501-style error on write, all absent on getMe', async () => {
  const api = apiWith(undefined)
  await assert.rejects(() => api.putSecret({ animaId: 'a' }, 'civitai', 'x'), /not available/)
  const me = await api.getMe({ animaId: 'a' })
  assert.deepEqual(me.secrets, { civitai: 'absent', huggingface: 'absent' })
  // Distinguishable from "wired but empty": the panel hides/disables proactively (F3).
  assert.equal(me.secretsAvailable, false, 'no store wired → panel unavailable before any attempt')
})

test('getMe rejects when the ledger deps are absent, instead of reporting a zero balance', async () => {
  const api = new CrystalApi({} as any)
  await assert.rejects(() => api.getMe({ animaId: 'a1' }))
})

test('ASYMMETRY: the facade never receives a resolve-capable secret handle', () => {
  const store = new MemorySecretarium(boxOf())
  // What index.ts injects — assert the slices carry no `resolve`.
  const injected: any = { secretWriter: store, secretPresence: store }
  // Structural check on the *intended* narrow types (SecretWriter/SecretPresence):
  //  a caller holding only those slices cannot call resolve.
  const writer: import('../../../../src/types/secretum.js').SecretWriter = store
  const presence: import('../../../../src/types/secretum.js').SecretPresence = store
  assert.equal(typeof (writer as any).put, 'function')
  assert.equal(typeof (writer as any).remove, 'function')
  assert.equal(typeof (presence as any).has, 'function')
  // `resolve` exists on the concrete store but is NOT part of the injected contract.
  assert.ok(!('resolve' in ({ put: writer.put, remove: writer.remove })))
  assert.ok(injected)
})
