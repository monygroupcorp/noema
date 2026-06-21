import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { SignumEvent } from '../../../../src/types/nexus.js'
import { hostCutHook } from '../../../../src/ledger/hooks/hostCut.js'

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

// Host cut = 20% of baseImpetus, paid to modoHostKey.animaId as 'reward' signum

test('returns reward signum to host when modoHostKey is present', async () => {
  const event = makeEvent({ baseImpetus: 1000n, modoHostKey: { animaId: 'anima-host-123' } })

  const signa = await hostCutHook(event)

  assert.equal(signa.length, 1)
  assert.equal(signa[0].animaId, 'anima-host-123')
  assert.equal(signa[0].forma, 'reward')
  assert.equal(signa[0].auctor, 'nexus:hostCut')
})

test('host cut is 20% of baseImpetus', async () => {
  const event = makeEvent({ baseImpetus: 1000n, modoHostKey: { animaId: 'anima-host-123' } })

  const signa = await hostCutHook(event)

  assert.equal(signa[0].valor, 200n)
})

test('host cut rounds down on non-divisible baseImpetus', async () => {
  const event = makeEvent({ baseImpetus: 999n, modoHostKey: { animaId: 'anima-host-123' } })

  const signa = await hostCutHook(event)

  assert.equal(signa[0].valor, 199n)  // floor(999 * 0.2) = 199
})

test('returns empty array when no modoHostKey', async () => {
  const event = makeEvent({ baseImpetus: 1000n, modoHostKey: undefined })

  const signa = await hostCutHook(event)

  assert.deepEqual(signa, [])
})

test('returns empty array when baseImpetus is zero', async () => {
  const event = makeEvent({ baseImpetus: 0n, modoHostKey: { animaId: 'anima-host-123' } })

  const signa = await hostCutHook(event)

  assert.deepEqual(signa, [])
})
