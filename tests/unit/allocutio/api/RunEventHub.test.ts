import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'

import { RunEventHub } from '../../../../src/allocutio/api/RunEventHub.js'
import type { RunEvent } from '../../../../src/allocutio/api/runEvents.js'

function makeHub(opts?: { bufferSize?: number }) {
  const bus = new EventEmitter()
  const calls: { url: string; body: unknown }[] = []
  const postWebhook = async (url: string, body: unknown) => { calls.push({ url, body }) }
  const hub = new RunEventHub({ bus, postWebhook, ...opts })
  return { bus, hub, calls }
}

/** Minimal owned status report — the single live-status channel since #6e. */
const prog = (message: string) => ({ phase: 'executing' as const, message, at: new Date(0) })

test('subscriber receives a typed progress event from actum.progressus (#6c)', () => {
  const { bus, hub } = makeHub()
  const received: RunEvent[] = []
  hub.subscribe('rp', ev => received.push(ev))
  const progressus = { phase: 'executing' as const, progress: { done: 5, total: 20, unit: 'steps' as const }, at: new Date(0) }
  bus.emit('actum.progressus', { actumId: 'rp', progressus })
  assert.equal(received.length, 1)
  assert.equal(received[0].kind, 'progress')
  assert.equal(received[0].terminal, false)
  assert.equal(received[0].progressus, progressus)
})

test('recentFor returns buffered events', () => {
  const { bus, hub } = makeHub()
  bus.emit('actum.progressus', { actumId: 'r2', progressus: prog('prep') })
  bus.emit('actum.progressus', { actumId: 'r2', progressus: prog('running') })
  const recent = hub.recentFor('r2')
  assert.equal(recent.length, 2)
  assert.equal(recent[0].progressus?.message, 'prep')
  assert.equal(recent[1].progressus?.message, 'running')
})

test('recentFor returns a copy (not the internal array)', () => {
  const { bus, hub } = makeHub()
  bus.emit('actum.progressus', { actumId: 'r3', progressus: prog('prep') })
  const a = hub.recentFor('r3')
  const b = hub.recentFor('r3')
  assert.notEqual(a, b)
})

test('recentFor returns [] for unknown runId', () => {
  const { hub } = makeHub()
  assert.deepEqual(hub.recentFor('nope'), [])
})

test('on actum.complete subscriber gets terminal event AND postWebhook fires', async () => {
  const { bus, hub, calls } = makeHub()
  const received: RunEvent[] = []
  hub.subscribe('r4', ev => received.push(ev))
  hub.setWebhook('r4', 'https://example.com/hook')
  bus.emit('actum.complete', { actumId: 'r4', status: 'completed', costUsd: 0.01, executionMs: 3000 })
  // give microtasks / promise resolution a tick
  await new Promise(r => setImmediate(r))
  assert.equal(received.length, 1)
  assert.equal(received[0].terminal, true)
  assert.equal(received[0].kind, 'complete')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://example.com/hook')
  assert.deepEqual(calls[0].body, received[0])
})

test('postWebhook does NOT fire when setWebhook was not called', async () => {
  const { bus, hub, calls } = makeHub()
  bus.emit('actum.complete', { actumId: 'r5', status: 'completed' })
  await new Promise(r => setImmediate(r))
  assert.equal(calls.length, 0)
})

test('bufferSize cap drops oldest events', () => {
  const { bus, hub } = makeHub({ bufferSize: 3 })
  for (let i = 0; i < 5; i++) {
    bus.emit('actum.progressus', { actumId: 'r6', progressus: prog(`s${i}`) })
  }
  const recent = hub.recentFor('r6')
  assert.equal(recent.length, 3)
  assert.equal(recent[0].progressus?.message, 's2')
  assert.equal(recent[2].progressus?.message, 's4')
})

test('unsubscribe stops delivery', () => {
  const { bus, hub } = makeHub()
  const received: RunEvent[] = []
  const off = hub.subscribe('r7', ev => received.push(ev))
  bus.emit('actum.progressus', { actumId: 'r7', progressus: prog('prep') })
  off()
  bus.emit('actum.progressus', { actumId: 'r7', progressus: prog('running') })
  assert.equal(received.length, 1)
})

test('events for other runIds are not delivered to an unrelated subscriber', () => {
  const { bus, hub } = makeHub()
  const received: RunEvent[] = []
  hub.subscribe('r8', ev => received.push(ev))
  bus.emit('actum.progressus', { actumId: 'other', progressus: prog('prep') })
  assert.equal(received.length, 0)
})
