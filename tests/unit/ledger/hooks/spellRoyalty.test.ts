import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { SignumEvent } from '../../../../src/types/nexus.js'
import { spellRoyaltyHook } from '../../../../src/ledger/hooks/spellRoyalty.js'

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
        status: 'completus',
        inceptum: new Date(),
        expirat: new Date(Date.now() + 60_000),
      },
      impetus: 1000n,
      baseImpetus: 1000n,
      ...overrides,
    },
  }
}

// Spell royalty = 10% of impetus, paid to modusAuctorAnimaId as 'reward' signum

test('returns reward signum to modus author when modusAuctorAnimaId is present', async () => {
  const event = makeEvent({ modusAuctorAnimaId: 'anima-author-456' })

  const signa = await spellRoyaltyHook(event)

  assert.equal(signa.length, 1)
  assert.equal(signa[0].animaId, 'anima-author-456')
  assert.equal(signa[0].forma, 'reward')
  assert.equal(signa[0].auctor, 'nexus:spellRoyalty')
})

test('spell royalty is 10% of impetus', async () => {
  const event = makeEvent({ impetus: 1000n, modusAuctorAnimaId: 'anima-author-456' })

  const signa = await spellRoyaltyHook(event)

  assert.equal(signa[0].valor, 100n)
})

test('spell royalty rounds down on non-divisible impetus', async () => {
  const event = makeEvent({ impetus: 999n, modusAuctorAnimaId: 'anima-author-456' })

  const signa = await spellRoyaltyHook(event)

  assert.equal(signa[0].valor, 99n)  // floor(999 * 0.1) = 99
})

test('returns empty array when no modusAuctorAnimaId', async () => {
  const event = makeEvent({ modusAuctorAnimaId: undefined })

  const signa = await spellRoyaltyHook(event)

  assert.deepEqual(signa, [])
})

test('returns empty array when impetus is zero', async () => {
  const event = makeEvent({ impetus: 0n, modusAuctorAnimaId: 'anima-author-456' })

  const signa = await spellRoyaltyHook(event)

  assert.deepEqual(signa, [])
})
