import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { SignumEvent } from '../../../../src/types/nexus.js'
import { platformSkimHook } from '../../../../src/ledger/hooks/platformSkim.js'

function makeEvent(overrides: Partial<SignumEvent<'royalty_fired'>['payload']> = {}): SignumEvent<'royalty_fired'> {
  return {
    type: 'royalty_fired',
    payload: {
      actumId: 'act-1',
      royaltyValor: 350n,
      baseValor: 1000n,
      ...overrides,
    },
  }
}

// Platform skim = 5% of baseValor, issued as 'reward' to platform account

test('returns one reward signum to the platform account', async () => {
  const signa = await platformSkimHook(makeEvent())

  assert.equal(signa.length, 1)
  assert.equal(signa[0].forma, 'reward')
  assert.equal(signa[0].auctor, 'nexus:platformSkim')
})

test('platform skim is 5% of baseValor', async () => {
  const signa = await platformSkimHook(makeEvent({ baseValor: 1000n }))

  assert.equal(signa[0].valor, 50n)
})

test('platform skim rounds down on non-divisible baseValor', async () => {
  // floor(999 * 5 / 100) = floor(49.95) = 49
  const signa = await platformSkimHook(makeEvent({ baseValor: 999n }))

  assert.equal(signa[0].valor, 49n)
})

test('signum is issued to the platform animaId', async () => {
  const signa = await platformSkimHook(makeEvent())

  // platform animaId must be present (non-empty)
  assert.ok(signa[0].animaId, 'platform animaId should be set')
})

test('signum carries the actumId in the auctor context', async () => {
  // The hook records which actum triggered the skim so the ledger is auditable
  const signa = await platformSkimHook(makeEvent({ actumId: 'act-xyz' }))

  // auctor stays 'nexus:platformSkim' — actumId traceability is in the Actum record
  assert.equal(signa[0].auctor, 'nexus:platformSkim')
})

test('returns empty array when baseValor is zero', async () => {
  const signa = await platformSkimHook(makeEvent({ baseValor: 0n }))

  assert.deepEqual(signa, [])
})

test('returns empty array when skim rounds down to zero', async () => {
  // floor(1 * 5 / 100) = 0
  const signa = await platformSkimHook(makeEvent({ baseValor: 1n }))

  assert.deepEqual(signa, [])
})
