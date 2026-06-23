// Slice E step 2 — the pod runner (scripts/pod/aitktrainer.py) emits two wire shapes the
// HOST consumes: a /runner/status Progressus signal and a completion-webhook payload. The
// Python side pins what the pod PRODUCES (scripts/pod/test_aitktrainer.py); this pins what
// the host ACCEPTS, over the SAME literal fixtures — so neither end can drift unnoticed.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeProgressus } from '../../../src/execution/progressus.js'
import { makeTrainingExitusResolver } from '../../../src/crystal/trainingFinalizer.js'
import type { Actum } from '../../../src/types/actum.js'
import type { AitkOutcome } from '../../../src/crystal/aitoolkitRunnerClient.js'

// ── Fixtures: the EXACT bodies aitktrainer.py posts (keep in lockstep with the Python test) ──
const STATUS_RUNNING = { actumId: 'act-1', progressus: { phase: 'executing', progress: { done: 30, total: 250, unit: 'steps' } } }
const STATUS_DONE = { actumId: 'act-1', progressus: { phase: 'done' } }
const STATUS_FAILED = { actumId: 'act-1', progressus: { phase: 'failed', message: 'CUDA OOM' } }
const WEBHOOK_COMPLETED = { id: 'pod-9', status: 'COMPLETED', output: [{ url: 'https://r2/training/koh/koh.safetensors' }], executionTime: 12345 }

test('host accepts the pod running-status signal → executing on steps with total + eta-less', () => {
  const p = normalizeProgressus(STATUS_RUNNING.progressus)
  assert.equal(p.phase, 'executing')
  assert.deepEqual(p.progress, { done: 30, total: 250, unit: 'steps' })
})

test('host accepts the pod terminal signals → done / failed', () => {
  assert.equal(normalizeProgressus(STATUS_DONE.progressus).phase, 'done')
  const f = normalizeProgressus(STATUS_FAILED.progressus)
  assert.equal(f.phase, 'failed')
  assert.equal(f.message, 'CUDA OOM')
})

test('host extracts the LoRA URL from the pod completion payload → finality outcome', async () => {
  const seen: AitkOutcome[] = []
  const resolve = makeTrainingExitusResolver(async (_actum, outcome) => {
    seen.push(outcome)
    return { trained: true, steps: outcome.lastStep, loraId: 'lora-1', loraUrl: outcome.outputUrl }
  })
  const actum = { id: 'act-1', aditus: { steps: 250 } } as unknown as Actum
  const exitus = await resolve(actum, { ministerium: 'aitoolkit' }, WEBHOOK_COMPLETED.output)

  // the pod's output[].url became the finalizer's outputUrl; aditus.steps drove lastStep.
  assert.deepEqual(seen, [{ status: 'completed', lastStep: 250, outputUrl: 'https://r2/training/koh/koh.safetensors' }])
  assert.deepEqual(exitus, { trained: true, steps: 250, loraId: 'lora-1', loraUrl: 'https://r2/training/koh/koh.safetensors' })
})

test('a non-training completion is left to the generic projector (resolver returns null)', async () => {
  const resolve = makeTrainingExitusResolver(async () => ({ trained: true }))
  const actum = { id: 'act-1', aditus: {} } as unknown as Actum
  assert.equal(await resolve(actum, { ministerium: 'comfyui' }, WEBHOOK_COMPLETED.output), null)
})
