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

// Model royalty = 5% of impetus, split equally across intellaAuctorAnimaIds

test('returns one reward signum per intella author', async () => {
  const event = makeEvent({ intellaAuctorAnimaIds: ['intella-a', 'intella-b', 'intella-c'] })

  const signa = await modelRoyaltyHook(event)

  assert.equal(signa.length, 3)
})

test('each signum targets the correct intella author', async () => {
  const event = makeEvent({ intellaAuctorAnimaIds: ['intella-a', 'intella-b'] })

  const signa = await modelRoyaltyHook(event)

  assert.equal(signa[0].animaId, 'intella-a')
  assert.equal(signa[1].animaId, 'intella-b')
})

test('all signa are reward forma from nexus:modelRoyalty', async () => {
  const event = makeEvent({ intellaAuctorAnimaIds: ['intella-a'] })

  const signa = await modelRoyaltyHook(event)

  assert.equal(signa[0].forma, 'reward')
  assert.equal(signa[0].auctor, 'nexus:modelRoyalty')
})

test('single author receives full 5% of impetus', async () => {
  const event = makeEvent({ impetus: 1000n, intellaAuctorAnimaIds: ['intella-a'] })

  const signa = await modelRoyaltyHook(event)

  assert.equal(signa[0].valor, 50n)  // 1000 * 5% = 50
})

test('two authors each receive floor(5% / 2) of impetus', async () => {
  const event = makeEvent({ impetus: 1000n, intellaAuctorAnimaIds: ['intella-a', 'intella-b'] })

  const signa = await modelRoyaltyHook(event)

  assert.equal(signa[0].valor, 25n)  // floor(50 / 2)
  assert.equal(signa[1].valor, 25n)
})

test('three authors split floors correctly on non-divisible royalty', async () => {
  // 100 * 5% = 5, split among 3 → floor(5/3) = 1 each
  const event = makeEvent({ impetus: 100n, intellaAuctorAnimaIds: ['a', 'b', 'c'] })

  const signa = await modelRoyaltyHook(event)

  assert.equal(signa[0].valor, 1n)
  assert.equal(signa[1].valor, 1n)
  assert.equal(signa[2].valor, 1n)
})

test('returns empty array when intellaAuctorAnimaIds is undefined', async () => {
  const event = makeEvent({ intellaAuctorAnimaIds: undefined })

  const signa = await modelRoyaltyHook(event)

  assert.deepEqual(signa, [])
})

test('returns empty array when intellaAuctorAnimaIds is empty', async () => {
  const event = makeEvent({ intellaAuctorAnimaIds: [] })

  const signa = await modelRoyaltyHook(event)

  assert.deepEqual(signa, [])
})

test('returns empty array when impetus is zero', async () => {
  const event = makeEvent({ impetus: 0n, intellaAuctorAnimaIds: ['intella-a'] })

  const signa = await modelRoyaltyHook(event)

  assert.deepEqual(signa, [])
})

test('authors with zero share after floor are excluded', async () => {
  // 1 * 5% = 0 (integer division), 3 authors → each would get 0 → all excluded
  const event = makeEvent({ impetus: 1n, intellaAuctorAnimaIds: ['a', 'b', 'c'] })

  const signa = await modelRoyaltyHook(event)

  assert.deepEqual(signa, [])
})
