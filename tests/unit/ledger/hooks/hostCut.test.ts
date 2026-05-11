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

// Host cut = 20% of impetus, paid to modoHostAnimaId as 'reward' signum

test('returns reward signum to host when modoHostAnimaId is present', async () => {
  const event = makeEvent({ modoHostAnimaId: 'anima-host-123' })

  const signa = await hostCutHook(event)

  assert.equal(signa.length, 1)
  assert.equal(signa[0].animaId, 'anima-host-123')
  assert.equal(signa[0].forma, 'reward')
  assert.equal(signa[0].auctor, 'nexus:hostCut')
})

test('host cut is 20% of impetus', async () => {
  const event = makeEvent({ impetus: 1000n, modoHostAnimaId: 'anima-host-123' })

  const signa = await hostCutHook(event)

  assert.equal(signa[0].valor, 200n)
})

test('host cut rounds down on non-divisible impetus', async () => {
  const event = makeEvent({ impetus: 999n, modoHostAnimaId: 'anima-host-123' })

  const signa = await hostCutHook(event)

  assert.equal(signa[0].valor, 199n)  // floor(999 * 0.2) = 199
})

test('returns empty array when no modoHostAnimaId', async () => {
  const event = makeEvent({ modoHostAnimaId: undefined })

  const signa = await hostCutHook(event)

  assert.deepEqual(signa, [])
})

test('returns empty array when impetus is zero', async () => {
  const event = makeEvent({ impetus: 0n, modoHostAnimaId: 'anima-host-123' })

  const signa = await hostCutHook(event)

  assert.deepEqual(signa, [])
})
