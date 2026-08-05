import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { SignumEvent } from '../../../../src/types/nexus.js'
import { sessionSpendHook } from '../../../../src/ledger/hooks/sessionSpend.js'

function makeEvent(overrides: Partial<SignumEvent<'session_spend'>['payload']> = {}): SignumEvent<'session_spend'> {
  return {
    type: 'session_spend',
    payload: {
      modo: {
        id: 'modo-1',
        status: 'active',
        impetusAccrued: 0n,
        acta: [],
        idleWarmthSec: 300,
        inceptum: new Date(),
      },
      seconds: 10,
      impetus: 1000n,
      ...overrides,
    },
  }
}

// Session spend — pod-time billing tick. No modus, no host identity (modo is anonymous).
// Full impetus flows to the platform account as a 'reward' signum.

test('returns one reward signum to the platform account', async () => {
  const signa = await sessionSpendHook(makeEvent())

  assert.equal(signa.length, 1)
  assert.equal(signa[0].forma, 'reward')
  assert.equal(signa[0].auctor, 'nexus:sessionSpend')
})

test('full impetus goes to platform', async () => {
  const signa = await sessionSpendHook(makeEvent({ impetus: 1000n }))

  assert.equal(signa[0].valor, 1000n)
})

test('signum is issued to the platform animaId', async () => {
  const signa = await sessionSpendHook(makeEvent())

  assert.ok(signa[0].animaId, 'platform animaId should be set')
})

test('returns empty array when impetus is zero', async () => {
  const signa = await sessionSpendHook(makeEvent({ impetus: 0n }))

  assert.deepEqual(signa, [])
})
