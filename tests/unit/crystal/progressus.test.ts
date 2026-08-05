// Progressus core: phaseKey + rollupPhaseDurations.
// Durations come from transition timestamps (NOT per-tick progress); consecutive
// same-key reports accumulate; the terminal report contributes nothing.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Progressus } from '../../../src/types/progressus.js'
import { phaseKey, rollupPhaseDurations, executioFromPhaseDurations } from '../../../src/execution/progressus.js'

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

// ── executioFromPhaseDurations (#6d) ───────────────────────────────────────────

test('executio derive: maps provisioning/downloading/executing dwell onto telemetry fields', () => {
  assert.deepEqual(executioFromPhaseDurations({
    provisioning: 3000,
    'pulling/fundamentum': 1000,   // no executio field — ignored
    'downloading/model': 4000,
    'loading/vram': 500,           // no executio field — ignored
    executing: 9000,
    'uploading/output': 200,       // no executio field — ignored
  }), { provisionMs: 3000, downloadMs: 4000, executionMs: 9000 })
})

test('executio derive: every downloading/* target sums into one downloadMs', () => {
  assert.deepEqual(executioFromPhaseDurations({
    'downloading/model': 4000,
    'downloading/lora': 1000,
    'downloading/dataset': 500,
  }), { downloadMs: 5500 })
})

test('executio derive: bare-phase keys (no target) fold in too', () => {
  assert.deepEqual(executioFromPhaseDurations({ downloading: 2000, executing: 3000 }),
    { downloadMs: 2000, executionMs: 3000 })
})

test('executio derive: undefined / empty / unmapped-only yields no fields', () => {
  assert.deepEqual(executioFromPhaseDurations(undefined), {})
  assert.deepEqual(executioFromPhaseDurations({}), {})
  assert.deepEqual(executioFromPhaseDurations({ 'loading/vram': 500, queued: 100 }), {})
})
