import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { SignumEvent } from '../../../../src/types/nexus.js'
import { modelRoyaltyHook } from '../../../../src/ledger/hooks/modelRoyalty.js'

function makeEvent(overrides: Partial<SignumEvent<'execution_spend'>['payload']> = {}): SignumEvent<'execution_spend'> {
  return {
    type: 'execution_spend',
    payload: {
      actum: {
        id: 'act-1',
        modusId: 'mod-1',
        modusVersiono: '1.0.0',
        impetus: 1000n,
        signaConsumed: [],
        aditus: {},
        status: 'completed',
        inceptum: new Date(),
      },
      impetus: 1000n,
      ...overrides,
    },
  }
}

// Model royalty = 5% of impetus, split across intellaRoyaltyPayees by weight.
// Equal credit across a model's authors is just equal weights; a published rights
// split (Editio.owners[]) is unequal weights. One field, one path.

/** Equal-weight payees — the "credit the model authors equally" case. */
const equal = (...ids: string[]) => ids.map(animaId => ({ animaId, weight: 1 }))

test('returns one reward signum per payee', async () => {
  const signa = await modelRoyaltyHook(makeEvent({ intellaRoyaltyPayees: equal('intella-a', 'intella-b', 'intella-c') }))
  assert.equal(signa.length, 3)
})

test('each signum targets the correct payee', async () => {
  const signa = await modelRoyaltyHook(makeEvent({ intellaRoyaltyPayees: equal('intella-a', 'intella-b') }))
  assert.equal(signa[0].animaId, 'intella-a')
  assert.equal(signa[1].animaId, 'intella-b')
})

test('all signa are reward forma from nexus:modelRoyalty', async () => {
  const signa = await modelRoyaltyHook(makeEvent({ intellaRoyaltyPayees: equal('intella-a') }))
  assert.equal(signa[0].forma, 'reward')
  assert.equal(signa[0].auctor, 'nexus:modelRoyalty')
})

test('a single payee receives the full 5% of impetus', async () => {
  const signa = await modelRoyaltyHook(makeEvent({ impetus: 1000n, intellaRoyaltyPayees: equal('intella-a') }))
  assert.equal(signa[0].valor, 50n)  // 1000 * 5% = 50
})

test('two equal payees each receive exactly floor(5% / 2)', async () => {
  const signa = await modelRoyaltyHook(makeEvent({ impetus: 1000n, intellaRoyaltyPayees: equal('intella-a', 'intella-b') }))
  assert.equal(signa[0].valor, 25n)  // floor(50 / 2)
  assert.equal(signa[1].valor, 25n)
})

test('three equal payees split floors correctly on non-divisible royalty', async () => {
  // 100 * 5% = 5, equal split among 3 → floor(5/3) = 1 each (exact, via integer math)
  const signa = await modelRoyaltyHook(makeEvent({ impetus: 100n, intellaRoyaltyPayees: equal('a', 'b', 'c') }))
  assert.deepEqual(signa.map(s => s.valor), [1n, 1n, 1n])
})

test('returns empty array when payees is undefined', async () => {
  assert.deepEqual(await modelRoyaltyHook(makeEvent({ intellaRoyaltyPayees: undefined })), [])
})

test('returns empty array when payees is empty', async () => {
  assert.deepEqual(await modelRoyaltyHook(makeEvent({ intellaRoyaltyPayees: [] })), [])
})

test('returns empty array when impetus is zero', async () => {
  assert.deepEqual(await modelRoyaltyHook(makeEvent({ impetus: 0n, intellaRoyaltyPayees: equal('intella-a') })), [])
})

// Unequal weights — a published Editio.owners[] split.

test('weighted payees split the 5% pool by weight', async () => {
  const event = makeEvent({ impetus: 1000n, intellaRoyaltyPayees: [{ animaId: 'a', weight: 0.7 }, { animaId: 'b', weight: 0.3 }] })
  const signa = await modelRoyaltyHook(event)
  assert.equal(signa.length, 2)
  assert.equal(signa[0].valor, 35n)  // 50 * 0.7
  assert.equal(signa[1].valor, 15n)  // 50 * 0.3
})

test('weighted payees: non-normalized weights are normalized by their sum', async () => {
  const event = makeEvent({ impetus: 1000n, intellaRoyaltyPayees: [{ animaId: 'a', weight: 3 }, { animaId: 'b', weight: 1 }] })
  const signa = await modelRoyaltyHook(event)
  assert.equal(signa[0].valor, 37n)  // pool 50 * 3/4 = 37.5 → bigint floor 37
  assert.equal(signa[1].valor, 12n)  // pool 50 * 1/4 = 12.5 → bigint floor 12
})

test('weighted payees: zero/negative weights are dropped', async () => {
  const event = makeEvent({ impetus: 1000n, intellaRoyaltyPayees: [{ animaId: 'a', weight: 1 }, { animaId: 'b', weight: 0 }] })
  const signa = await modelRoyaltyHook(event)
  assert.equal(signa.length, 1)
  assert.equal(signa[0].animaId, 'a')
})

test('payees with zero share after floor are excluded', async () => {
  // 1 * 5% = 0 (integer division) → pool 0 → all excluded
  const signa = await modelRoyaltyHook(makeEvent({ impetus: 1n, intellaRoyaltyPayees: equal('a', 'b', 'c') }))
  assert.deepEqual(signa, [])
})
