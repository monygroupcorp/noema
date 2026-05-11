import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { SignumEvent } from '../../../src/types/nexus.js'
import { Nexus } from '../../../src/ledger/Nexus.js'

// Minimal execution_spend payload for test use
function makeExecEvent(): SignumEvent<'execution_spend'> {
  return {
    type: 'execution_spend',
    payload: {
      actum: {
        id: 'act-1',
        modusId: 'mod-1',
        modusVersiono: '1.0.0',
        impetus: 100n,
        signaConsumed: [],
        aditus: {},
        status: 'completed',
        inceptum: new Date(),
      },
      impetus: 100n,
    },
  }
}

test('registered hook is called when matching event is emitted', async () => {
  const nexus = new Nexus()
  let called = false

  nexus.on('execution_spend', async () => {
    called = true
    return []
  })

  await nexus.emit(makeExecEvent())

  assert.equal(called, true)
})

test('hook receives the full event payload', async () => {
  const nexus = new Nexus()
  const event = makeExecEvent()
  let received: SignumEvent<'execution_spend'> | null = null

  nexus.on('execution_spend', async (e) => {
    received = e
    return []
  })

  await nexus.emit(event)

  assert.deepEqual(received, event)
})

test('multiple hooks on the same event type are all called', async () => {
  const nexus = new Nexus()
  let calls = 0

  nexus.on('execution_spend', async () => { calls++; return [] })
  nexus.on('execution_spend', async () => { calls++; return [] })
  nexus.on('execution_spend', async () => { calls++; return [] })

  await nexus.emit(makeExecEvent())

  assert.equal(calls, 3)
})

test('signa returned by hooks are collected and returned by emit', async () => {
  const nexus = new Nexus()

  nexus.on('execution_spend', async () => [
    { animaId: 'anima-host', forma: 'reward' as const, valor: 10n, auctor: 'nexus' },
  ])
  nexus.on('execution_spend', async () => [
    { animaId: 'anima-author', forma: 'reward' as const, valor: 5n, auctor: 'nexus' },
  ])

  const signa = await nexus.emit(makeExecEvent())

  assert.equal(signa.length, 2)
  assert.equal(signa[0].valor, 10n)
  assert.equal(signa[1].valor, 5n)
})

test('hook registered for different event type is not called', async () => {
  const nexus = new Nexus()
  let depositCalled = false

  nexus.on('deposit_confirmed', async () => {
    depositCalled = true
    return []
  })

  await nexus.emit(makeExecEvent())

  assert.equal(depositCalled, false)
})

test('emit with no registered hooks returns empty array', async () => {
  const nexus = new Nexus()

  const signa = await nexus.emit(makeExecEvent())

  assert.deepEqual(signa, [])
})
