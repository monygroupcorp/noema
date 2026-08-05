import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { SignumEvent } from '../../../../src/types/nexus.js'
import { referralSplitHook } from '../../../../src/ledger/hooks/referralSplit.js'

function makeEvent(overrides: Partial<SignumEvent<'deposit_confirmed'>['payload']> = {}): SignumEvent<'deposit_confirmed'> {
  return {
    type: 'deposit_confirmed',
    payload: {
      signum: {
        id: 'sig-1',
        forma: 'eth',
        valor: 1000n,
        auctor: 'deposit-watcher',
        status: 'valid',
        natum: new Date(),
      },
      ...overrides,
    },
  }
}

// Referral split = 5% of deposit valor, paid to referrerAnimaId as 'reward' signum

test('returns reward signum to referrer when referrerAnimaId is present', async () => {
  const event = makeEvent({ referrerAnimaId: 'anima-referrer-789' })

  const signa = await referralSplitHook(event)

  assert.equal(signa.length, 1)
  assert.equal(signa[0].animaId, 'anima-referrer-789')
  assert.equal(signa[0].forma, 'reward')
  assert.equal(signa[0].auctor, 'nexus:referralSplit')
})

test('referral split is 5% of deposit valor', async () => {
  const event = makeEvent({ referrerAnimaId: 'anima-referrer-789' })

  const signa = await referralSplitHook(event)

  assert.equal(signa[0].valor, 50n)  // 1000 * 5% = 50
})

test('referral split rounds down on non-divisible valor', async () => {
  const event = makeEvent({
    referrerAnimaId: 'anima-referrer-789',
    signum: {
      id: 'sig-2', forma: 'eth', valor: 999n, auctor: 'deposit-watcher',
      status: 'valid', natum: new Date(),
    },
  })

  const signa = await referralSplitHook(event)

  assert.equal(signa[0].valor, 49n)  // floor(999 * 5 / 100) = 49
})

test('returns empty array when no referrerAnimaId', async () => {
  const event = makeEvent({ referrerAnimaId: undefined })

  const signa = await referralSplitHook(event)

  assert.deepEqual(signa, [])
})

test('returns empty array when deposit valor is zero', async () => {
  const event = makeEvent({
    referrerAnimaId: 'anima-referrer-789',
    signum: {
      id: 'sig-3', forma: 'eth', valor: 0n, auctor: 'deposit-watcher',
      status: 'valid', natum: new Date(),
    },
  })

  const signa = await referralSplitHook(event)

  assert.deepEqual(signa, [])
})
