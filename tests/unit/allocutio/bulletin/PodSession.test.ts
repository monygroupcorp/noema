import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PodSession } from '../../../../src/allocutio/lexicon/bulletin/PodSession.js'

test('cold lifecycle: silent hunt → Found → prep → ready, journal commits persist', () => {
  const s = new PodSession('host-1')
  s.onStage('provisioning', undefined, 0)
  assert.equal(s.phase, 'hunting')
  assert.equal(s.snapshot().live, null, 'fast hunt is silent')

  s.onStage('pod-locked', { podId: 'pod-1', gpuType: 'RTX 4090', costPerHr: 0.69, phaseMs: 30_000 }, 1000)
  let snap = s.snapshot()
  assert.deepEqual(snap.journal[0], { kind: 'found', gpu: 'RTX 4090', rate: 0.69, ms: 30_000 })
  assert.deepEqual(snap.live, { kind: 'initializing' })
  assert.equal(s.phase, 'prep')

  s.onStage('downloading:3/4', undefined, 2000)
  assert.deepEqual(s.snapshot().live, { kind: 'downloading', n: 3, m: 4, slow: false })

  s.onStage('comfy-ready', { phaseMs: 4.5 * 60_000 }, 3000)
  snap = s.snapshot()
  assert.deepEqual(snap.journal[1], { kind: 'prepared', ms: 4.5 * 60_000 })
  assert.deepEqual(snap.live, { kind: 'generating' })
  assert.equal(s.phase, 'ready')
})

test('bail erases the Found entry and records a Quit entry (by kind, not prose)', () => {
  const s = new PodSession('host-1')
  s.onStage('provisioning', undefined, 0)
  s.onStage('pod-locked', { podId: 'pod-1', gpuType: 'RTX 4090', costPerHr: 0.69, phaseMs: 30_000 }, 1000)
  s.onStage('downloading:2/4', undefined, 2000)
  s.onStage('pod-bailed', { bailReason: 'download throttle' }, 3000)

  const j = s.snapshot().journal
  assert.ok(!j.some(e => e.kind === 'found'), 'the bailed pod\'s Found entry is gone')
  assert.deepEqual(j.at(-1), { kind: 'quit', podNum: 1, reason: 'download throttle' })
  assert.equal(s.phase, 'hunting', 're-hunting after the bail')
})

test('markHuntSlow only escalates while hunting', () => {
  const s = new PodSession('host-1')
  s.onStage('provisioning', undefined, 0)
  s.markHuntSlow()
  assert.deepEqual(s.snapshot().live, { kind: 'hunting-slow' })
  // Once locked, a stray markHuntSlow must not overwrite the live line.
  s.onStage('pod-locked', { podId: 'p', gpuType: 'RTX 4090', costPerHr: 0.69 }, 100)
  s.markHuntSlow()
  assert.deepEqual(s.snapshot().live, { kind: 'initializing' })
})

test('recordGen tallies the ledger and rests; warm stepping + confirm', () => {
  const s = new PodSession('host-1')
  s.onStage('pod-locked', { podId: 'p', gpuType: 'RTX 4090', costPerHr: 0.69 }, 0)
  s.recordGen({ costUsd: 0.08, execMs: 12_000 })
  const snap = s.snapshot()
  assert.equal(snap.ledger.genCount, 1)
  assert.equal(snap.ledger.avgCostUsd, 0.08)
  assert.equal(snap.live, null, 'rests after a gen')
  assert.equal(s.phase, 'idle')

  s.stepWarm('dec')   // 1m → 30s
  assert.equal(s.warmTtlMs, 30_000)
  s.setConfirmed(true)
  assert.equal(s.confirmed, true)
})

test('end() freezes and clears the live line', () => {
  const s = new PodSession('host-1')
  s.onStage('pod-locked', { podId: 'p', gpuType: 'RTX 4090', costPerHr: 0.69 }, 0)
  s.end()
  assert.equal(s.ended, true)
  assert.equal(s.snapshot().live, null)
})
