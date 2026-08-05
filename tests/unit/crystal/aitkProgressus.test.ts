// Build #5 — project ostris/ai-toolkit's structured `Job` row → Progressus (spec §6c).
// The mapping is derived from ai-toolkit's typed source of truth (UITrainer writes the
// SQLite Job table: status ∈ {running,stopped,error,completed}+queued, info sub-phase,
// step, speed_string), NOT from the legacy stdout regex parser. These pin the two-axis
// (status × info) map; real captured Job rows from a local klein smoke validate it next.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { aitkJobToProgressus, etaMsFromSpeed, type AitkJob } from '../../../src/execution/aitkProgressus.js'

const NOW = new Date(1_700_000_000_000)
const job = (over: Partial<AitkJob>): AitkJob => ({ status: 'running', step: 0, ...over })

// ── lifecycle phases ────────────────────────────────────────────────────────

test('queued → queued, with queue position as message', () => {
  const p = aitkJobToProgressus(job({ status: 'queued', queue_position: 3 }), 1000, NOW)
  assert.equal(p.phase, 'queued')
  assert.equal(p.message, 'queue position 3')
})

test('running + "Loading model" (step 0) → loading/vram', () => {
  const p = aitkJobToProgressus(job({ info: 'Loading model' }), 1000, NOW)
  assert.equal(p.phase, 'loading')
  assert.equal(p.target, 'vram')
  assert.equal(p.message, 'Loading model')
})

test('running + "Starting" (step 0) → loading/vram (the pre-loop floor)', () => {
  const p = aitkJobToProgressus(job({ info: 'Starting' }), 1000, NOW)
  assert.equal(p.phase, 'loading')
  assert.equal(p.target, 'vram')
})

test('running + "Loading dataset" → downloading/dataset', () => {
  const p = aitkJobToProgressus(job({ info: 'Loading dataset' }), 1000, NOW)
  assert.equal(p.phase, 'downloading')
  assert.equal(p.target, 'dataset')
  assert.equal(p.message, 'Loading dataset')
})

test('running + "Generating baseline" (step 0) → warming, not loading (it is sample inference)', () => {
  const p = aitkJobToProgressus(job({ info: 'Generating baseline' }), 1000, NOW)
  assert.equal(p.phase, 'warming')
  assert.equal(p.target, undefined)   // no VRAM-load target — this is readiness inference
  assert.equal(p.message, 'Generating baseline')
})

test('running + "Training" (step>0) → executing with step/total progress + etaMs', () => {
  const p = aitkJobToProgressus(job({ info: 'Training', step: 250, speed_string: '2.00 iter/sec' }), 1000, NOW)
  assert.equal(p.phase, 'executing')
  assert.deepEqual(p.progress, { done: 250, total: 1000, unit: 'steps' })
  // 750 steps left at 2/sec = 375s = 375000ms.
  assert.equal(p.etaMs, 375_000)
})

test('completed → done (terminal, no message noise)', () => {
  const p = aitkJobToProgressus(job({ status: 'completed', step: 1000, info: 'Training completed' }), 1000, NOW)
  assert.equal(p.phase, 'done')
  assert.equal(p.message, undefined)
})

test('error → failed carrying the error string', () => {
  const p = aitkJobToProgressus(job({ status: 'error', info: 'CUDA out of memory' }), 1000, NOW)
  assert.equal(p.phase, 'failed')
  assert.equal(p.message, 'CUDA out of memory')
})

test('stopped → cancelling (terminal)', () => {
  const p = aitkJobToProgressus(job({ status: 'stopped', info: 'Job stopped (remote)' }), 1000, NOW)
  assert.equal(p.phase, 'cancelling')
  assert.equal(p.message, 'Job stopped (remote)')
})

// ── coalescing-friendliness (the §7 contract this projection must respect) ──────

test('steady "Training" pings carry NO message → consecutive ticks coalesce live-only', () => {
  const a = aitkJobToProgressus(job({ info: 'Training', step: 100 }), 1000, NOW)
  const b = aitkJobToProgressus(job({ info: 'Training', step: 101 }), 1000, NOW)
  // Same phase, no target, no message → only `progress` differs ⇒ shouldPersist() drops b.
  assert.equal(a.message, undefined)
  assert.equal(b.message, undefined)
  assert.equal(a.phase, 'executing')
  assert.equal(b.phase, 'executing')
})

test('training step 0 (loop just entered) → executing done:0, not loading', () => {
  const p = aitkJobToProgressus(job({ info: 'Training', step: 0 }), 1000, NOW)
  assert.equal(p.phase, 'executing')
  assert.deepEqual(p.progress, { done: 0, total: 1000, unit: 'steps' })
})

// ── no config / open-ended ──────────────────────────────────────────────────

test('executing without cfgSteps → open-ended progress, no total, no etaMs', () => {
  const p = aitkJobToProgressus(job({ info: 'Training', step: 42, speed_string: '1.0 iter/sec' }), undefined, NOW)
  assert.deepEqual(p.progress, { done: 42, unit: 'steps' })
  assert.equal(p.etaMs, undefined)
})

// ── etaMsFromSpeed: both ai-toolkit speed formats ───────────────────────────

test('etaMsFromSpeed: iter/sec and sec/iter both parse; complete/garbage → undefined', () => {
  assert.equal(etaMsFromSpeed('2.00 iter/sec', 750), 375_000)
  assert.equal(etaMsFromSpeed('0.50 sec/iter', 100), 50_000)   // 100 steps × 0.5s
  assert.equal(etaMsFromSpeed('1.0 iter/sec', 0), undefined)   // nothing remaining
  assert.equal(etaMsFromSpeed(undefined, 100), undefined)
  assert.equal(etaMsFromSpeed('warming up', 100), undefined)   // no rate
})

test('at is carried through from the supplied clock', () => {
  assert.equal(aitkJobToProgressus(job({ info: 'Training', step: 1 }), 10, NOW).at.getTime(), NOW.getTime())
})

// ── GROUND TRUTH: real Job rows from a local FLUX.2 Klein-4B smoke (2026-06-22) ─────
// Captured from an actual ai-toolkit run on the 4090 (dataset: impresstation, 60 steps).
// These are the exact status/info strings UITrainer wrote — including klein-specific load
// substates ("Loading Qwen3" / "Quantizing Qwen3" — the Qwen3 text encoder) and the
// pre-train "Generating baseline" sample, none of which were hardcoded in the projector.
// This is the spec §6c "validate against ground truth" gate: the real timeline projects to
// a clean loading → executing → done shape.
test('ground truth: the real klein-4b smoke timeline projects to loading → executing → done', () => {
  const TOTAL = 60
  // (status, info, step) tuples in the order ai-toolkit emitted them.
  const realTimeline: Array<[string, string, number]> = [
    ['queued',    'seeded by launcher', 0],   // our launcher's seed row
    ['running',   'Starting',           0],
    ['running',   'Loading Qwen3',      0],    // klein loads a Qwen3 text encoder
    ['running',   'Quantizing Qwen3',   0],    // qfloat8 quantization (low-VRAM path)
    ['running',   'Loading model',      0],
    ['running',   'Loading dataset',    0],
    ['running',   'Generating baseline',0],    // pre-train sample
    ['running',   'Training',           1],
    ['running',   'Training',          30],
    ['running',   'Training',          60],
    ['completed', 'Training completed',60],
  ]
  const phases = realTimeline.map(([status, info, step]) =>
    aitkJobToProgressus({ status, info, step }, TOTAL, NOW).phase)

  assert.deepEqual(phases, [
    'queued',
    'loading', 'loading', 'loading', 'loading',  // Starting/Qwen3/Quantizing/Loading model
    'downloading',                                // "Loading dataset" → downloading/dataset
    'warming',                                    // "Generating baseline" (pre-train sample) → warming
    'executing', 'executing', 'executing',        // the training loop
    'done',
  ])
  // the dataset step is specifically targeted, and training steps carry real progress.
  assert.equal(aitkJobToProgressus({ status: 'running', info: 'Loading dataset', step: 0 }, TOTAL, NOW).target, 'dataset')
  assert.deepEqual(aitkJobToProgressus({ status: 'running', info: 'Training', step: 30 }, TOTAL, NOW).progress,
    { done: 30, total: 60, unit: 'steps' })
})
