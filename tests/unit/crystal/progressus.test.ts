// Progressus core: phaseKey + rollupPhaseDurations.
// Durations come from transition timestamps (NOT per-tick progress); consecutive
// same-key reports accumulate; the terminal report contributes nothing.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Progressus } from '../../../src/types/progressus.js'
import { phaseKey, rollupPhaseDurations } from '../../../src/execution/progressus.js'

const at = (ms: number): Date => new Date(1_700_000_000_000 + ms)

// ── phaseKey ─────────────────────────────────────────────────────────────────

test('phaseKey: bare phase has no target suffix', () => {
  assert.equal(phaseKey({ phase: 'provisioning' }), 'provisioning')
})

test('phaseKey: target appends as phase/target', () => {
  assert.equal(phaseKey({ phase: 'downloading', target: 'model' }), 'downloading/model')
  assert.equal(phaseKey({ phase: 'loading', target: 'vram' }), 'loading/vram')
})

// ── rollupPhaseDurations ───────────────────────────────────────────────────────

test('rollup: empty / single-report timelines yield no durations', () => {
  assert.deepEqual(rollupPhaseDurations([]), {})
  assert.deepEqual(rollupPhaseDurations([{ phase: 'queued', at: at(0) }]), {})
})

test('rollup: each segment runs until the next report; terminal contributes nothing', () => {
  const timeline: Progressus[] = [
    { phase: 'provisioning', at: at(0) },
    { phase: 'pulling', target: 'fundamentum', at: at(1000) },
    { phase: 'downloading', target: 'model', at: at(4000) },
    { phase: 'loading', target: 'vram', at: at(4500) },
    { phase: 'executing', at: at(5000) },
    { phase: 'done', at: at(9000) },
  ]
  assert.deepEqual(rollupPhaseDurations(timeline), {
    provisioning: 1000,
    'pulling/fundamentum': 3000,
    'downloading/model': 500,
    'loading/vram': 500,
    executing: 4000,
    // 'done' is terminal — no successor, no duration.
  })
})

test('rollup: same (phase,target) across coalesced reports accumulates total dwell', () => {
  // Two executing reports (e.g. a progress checkpoint + a message) between loading and done.
  const timeline: Progressus[] = [
    { phase: 'loading', target: 'vram', at: at(0) },
    { phase: 'executing', at: at(1000) },
    { phase: 'executing', message: 'sampler step', at: at(3000) },
    { phase: 'done', at: at(6000) },
  ]
  const durations = rollupPhaseDurations(timeline)
  assert.equal(durations['loading/vram'], 1000)
  assert.equal(durations.executing, 5000) // (3000-1000) + (6000-3000)
})

test('rollup: download-of-model and download-of-dataset measure apart (target axis)', () => {
  const timeline: Progressus[] = [
    { phase: 'downloading', target: 'model', at: at(0) },
    { phase: 'downloading', target: 'dataset', at: at(2000) },
    { phase: 'executing', at: at(5000) },
    { phase: 'done', at: at(5001) },
  ]
  const durations = rollupPhaseDurations(timeline)
  assert.equal(durations['downloading/model'], 2000)
  assert.equal(durations['downloading/dataset'], 3000)
})

test('rollup: out-of-order timestamps are skipped, not counted negative', () => {
  const timeline: Progressus[] = [
    { phase: 'executing', at: at(5000) },
    { phase: 'uploading', at: at(2000) }, // clock skew — earlier than predecessor
    { phase: 'done', at: at(8000) },
  ]
  const durations = rollupPhaseDurations(timeline)
  assert.ok(!('executing' in durations)) // negative segment skipped
  assert.equal(durations.uploading, 6000)
})
