import { test } from 'node:test'
import assert from 'node:assert/strict'

import { busToRunEvent } from '../../../../src/allocutio/api/runEvents.js'

test('actum.stage maps to stage RunEvent', () => {
  const ev = busToRunEvent('actum.stage', { actumId: 'r1', stage: 'provisioning', elapsedMs: 100 })
  assert.ok(ev)
  assert.equal(ev.runId, 'r1')
  assert.equal(ev.kind, 'stage')
  assert.equal(ev.terminal, false)
  assert.equal(ev.stage, 'provisioning')
  assert.equal(ev.elapsedMs, 100)
  // no status on stage
  assert.equal(ev.status, undefined)
})

test('actum.progressus maps to a non-terminal progress RunEvent carrying the typed report (#6c)', () => {
  const progressus = {
    phase: 'downloading' as const,
    target: 'model' as const,
    progress: { done: 1, total: 3, unit: 'items' as const },
    at: new Date(0),
  }
  const ev = busToRunEvent('actum.progressus', { actumId: 'r6', progressus })
  assert.ok(ev)
  assert.equal(ev.runId, 'r6')
  assert.equal(ev.kind, 'progress')
  assert.equal(ev.terminal, false)        // cost/completion ride actum.complete/fail
  assert.equal(ev.progressus, progressus) // passed through by reference
  assert.equal(ev.stage, undefined)
})

test('actum.progressus without a progressus payload is dropped', () => {
  assert.equal(busToRunEvent('actum.progressus', { actumId: 'r7' }), null)
  assert.equal(busToRunEvent('actum.progressus', { actumId: 'r7', progressus: 'nope' }), null)
})

test('actum.complete maps to complete RunEvent', () => {
  const ev = busToRunEvent('actum.complete', {
    actumId: 'r2',
    status: 'completed',
    costUsd: 0.042,
    executionMs: 5000,
  })
  assert.ok(ev)
  assert.equal(ev.runId, 'r2')
  assert.equal(ev.kind, 'complete')
  assert.equal(ev.terminal, true)
  assert.equal(ev.status, 'complete')
  assert.equal(ev.costUsd, 0.042)
  assert.equal(ev.executionMs, 5000)
})

test('actum.complete without optional fields omits them', () => {
  const ev = busToRunEvent('actum.complete', { actumId: 'r3', status: 'completed' })
  assert.ok(ev)
  assert.equal(ev.costUsd, undefined)
  assert.equal(ev.executionMs, undefined)
})

test('actum.fail maps to failed RunEvent', () => {
  const ev = busToRunEvent('actum.fail', { actumId: 'r4', status: 'failed' })
  assert.ok(ev)
  assert.equal(ev.runId, 'r4')
  assert.equal(ev.kind, 'failed')
  assert.equal(ev.terminal, true)
  assert.equal(ev.status, 'failed')
})

test('unknown event returns null', () => {
  assert.equal(busToRunEvent('actum.start', { actumId: 'r5' }), null)
  assert.equal(busToRunEvent('pod.reaped', { externusId: 'p1' }), null)
  assert.equal(busToRunEvent('log', {}), null)
})
