// =============================================================================
// retryVerdict — the quit line, asserted class by class
// =============================================================================
//
// This table decides whether the platform may spend a user's credits on another
// attempt. Every named failure mode is asserted INDIVIDUALLY rather than through a
// sampled few, because the cost of a wrong row is either an order that gives up on a
// failure a fresh machine would have fixed, or one that keeps re-running work that
// already ran. Two rows carry that risk most directly and are called out below: the
// ip-less host and the silent pod are the two whose recorded text names no condition a
// reader would recognise, so this table is what stands between them and a request that
// gives up.
//
// The rows also carry a `stage` (noema-390) — WHERE the run died — read by
// `classifyError` and published as `Run.failure.stage`. Verdict and stage are asserted
// off the SAME rows here, because they are one table with two readers.
// =============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  FAILURE_MODES, INFRA_RETRY_PATTERNS, QUIT_PATTERNS, failureStage, failureText, retryVerdict,
} from '../../../src/lib/retryVerdict.js'
import { EXPIRED_ERROR, SILENT_POD_ERROR } from '../../../src/crystal/expiryReaper.js'

// Real recorded failure text, one per infra class. The strings are the SHAPE the pod →
// webhook boundary delivers: the typed markers do not survive it, the message does.
const INFRA_CASES: Array<[string, string]> = [
  ['ip-less host', 'Pod pod-abc abandoned after 128476ms as an ip-less host — retrying on a fresh pod'],
  ['ssh not ready', 'SSH not ready after 600000ms'],
  ['sshd never came up', 'sshd did not become ready in time'],
  ['provision failed', 'RunPod pod provision failed: no capacity for the requested GPU class'],
  ['no capacity', 'no capacity in any region'],
  ['silent pod', SILENT_POD_ERROR],
  ['actum expired', EXPIRED_ERROR],
  ['throttled', 'download throttled to 3.1 MB/s (min 12)'],
  ['runtime startup', 'comfyrunner did not become ready within 900000ms'],
  ['runtime unreachable', 'comfyrunner not reachable on the pod'],
]

for (const [name, message] of INFRA_CASES) {
  test(`retryVerdict: ${name} is infra-retry`, () => {
    assert.equal(retryVerdict(new Error(message)), 'infra-retry', message)
    assert.equal(retryVerdict(message), 'infra-retry', 'the bare recorded string reads the same as the Error')
  })
}

const QUIT_CASES: Array<[string, string]> = [
  ['insufficient funds', 'insufficient funds: balance 10 < required 4200'],
  ['insufficient signa', 'economy.insufficient_signa'],
  ['content refused', 'content_refused: the prompt was refused by the safety guard'],
  ['unknown modus', "modus 'modus.nope' not found"],
  ['invalid input', 'invalid aditus: steps must be a number'],
  ['forbidden', 'forbidden: this model is not yours'],
  ['job failed on the pod', 'comfyrunner job failed: exit code 1'],
  ['execution error in the trainer', 'execution failed: cuDNN error CUDNN_STATUS_EXECUTION_FAILED'],
  ['out of memory', 'CUDA out of memory'],
  // noema-390: three modes the table had no row for until the MiniMax H3 bring-up. Each
  // already got 'quit' as the unmatched default, so naming them changes no verdict — see
  // the parity test below.
  ['model download failed on a full disk', 'model download failed: wget https://…/model.safetensors returned non-zero exit status 3'],
  ['launch never reached a reachable host', 'Training pod launch exhausted 3 attempts without reaching an SSH-reachable host — abandoned pod-a, pod-b'],
  ['bootstrap budget exhausted', 'Pod pod-xyz provisioning budget of 900000ms exhausted — bootstrap stopped before command: pip install -r requirements.txt'],
]

for (const [name, message] of QUIT_CASES) {
  test(`retryVerdict: ${name} quits`, () => {
    assert.equal(retryVerdict(new Error(message)), 'quit', message)
  })
}

test('the ip-less host and the silent pod are infra-retry — the two that generic copy hides', () => {
  // Named separately from the table above: both render as "something went wrong" to a user,
  // so this assertion is the only thing standing between them and a request that gives up.
  assert.equal(retryVerdict('Pod pod-1 abandoned after 130000ms as an ip-less host'), 'infra-retry')
  assert.equal(retryVerdict(SILENT_POD_ERROR), 'infra-retry')
})

test('the typed ip-less marker is honoured even when the message says nothing', () => {
  const err = Object.assign(new Error('bail'), { iplessHost: true })
  assert.equal(retryVerdict(err), 'infra-retry')
})

test('a job that RAN and failed is never re-run automatically, even on an infra-sounding word', () => {
  // "timed out" reads like infrastructure; inside the trainer it is an answer about this
  // request. The quit table is consulted first precisely so this cannot invert.
  assert.equal(retryVerdict(new Error('comfyrunner job failed: the training step timed out')), 'quit')
})

test('an unrecognised failure quits — retryability is opt-in, never inferred', () => {
  assert.equal(retryVerdict(new Error('a brand new failure nobody has classified')), 'quit')
  assert.equal(retryVerdict(undefined), 'quit')
})

test('failureText reads an Error, a string, and an API-style error alike', () => {
  assert.equal(failureText(new Error('boom')), 'boom')
  assert.equal(failureText('boom'), 'boom')
  assert.equal(failureText({ code: 'x.y', message: 'boom' }), 'boom')
})

test('every table row is reachable — no row matches nothing, and none is a duplicate', () => {
  const names = [...INFRA_RETRY_PATTERNS, ...QUIT_PATTERNS].map(r => r.nomen)
  assert.equal(new Set(names).size, names.length, 'two rows share a name')
  for (const row of INFRA_RETRY_PATTERNS) {
    assert.ok(
      INFRA_CASES.some(([, message]) => row.pattern.test(message)),
      `infra row '${row.nomen}' has no asserted case — an unexercised row is an unverified claim`,
    )
  }
  for (const row of QUIT_PATTERNS) {
    assert.ok(
      QUIT_CASES.some(([, message]) => row.pattern.test(message)),
      `quit row '${row.nomen}' has no asserted case`,
    )
  }
})

// =============================================================================
// noema-390 — the stage half of the same table
// =============================================================================

const STAGE_CASES: Array<[string, string, string | undefined]> = [
  ['provision failed', 'RunPod pod provision failed: no capacity for the requested GPU class', 'provision'],
  ['ip-less host', 'Pod pod-abc abandoned after 128476ms as an ip-less host', 'provision'],
  ['ssh not ready', 'Pod pod-3 SSH not ready within 300000ms', 'ssh'],
  ['launch exhausted without a reachable host', 'Training pod launch exhausted 3 attempts without reaching an SSH-reachable host', 'ssh'],
  ['runtime never came up', 'comfyrunner did not become ready within 900000ms', 'bootstrap'],
  ['bootstrap budget exhausted', 'Pod p provisioning budget of 900000ms exhausted — bootstrap stopped before command: pip install x', 'bootstrap'],
  ['silent pod', SILENT_POD_ERROR, 'bootstrap'],
  ['full disk during the weight download', 'model download failed: wget returned non-zero exit status 3', 'download'],
  ['throttled', 'download throttled to 3.1 MB/s (min 12)', 'download'],
  ['job failed on the pod', 'comfyrunner job failed: exit code 1', 'execute'],
  // The two honest blanks: the outer deadline elapsing says WHEN, never WHERE, and an
  // unrecognised failure is exactly that.
  ['actum expired', EXPIRED_ERROR, undefined],
  ['unrecognised', 'a brand new failure nobody has classified', undefined],
]

for (const [name, message, stage] of STAGE_CASES) {
  test(`failureStage: ${name} → ${stage ?? 'no stage'}`, () => {
    assert.equal(failureStage(new Error(message)), stage, message)
    assert.equal(failureStage(message), stage, 'the bare recorded string reads the same as the Error')
  })
}

test('the typed ip-less marker carries a stage too, even when the message says nothing', () => {
  assert.equal(failureStage(Object.assign(new Error('bail'), { iplessHost: true })), 'provision')
})

test('naming the three new modes changed NO verdict — they get the default they already had', () => {
  // The rows added for noema-390 are appended at the END of the table and every one carries
  // verdict 'quit', which is exactly what an unmatched string returns. This asserts the
  // property rather than trusting the placement: for each new row, the verdict equals the
  // verdict the same text would have had with that row absent — 'quit', by default.
  const NEW_ROWS = ['model-download-failed', 'ssh-exhausted', 'bootstrap-budget']
  for (const nomen of NEW_ROWS) {
    const row = FAILURE_MODES.find(r => r.nomen === nomen)
    assert.ok(row, `row '${nomen}' is missing`)
    assert.equal(row?.verdict, 'quit',
      `'${nomen}' must keep the default verdict — whether it SHOULD be retried is noema-391's call, not this table's to change silently`)
  }
  // And nothing earlier in the table was reordered: the quit answers still precede the
  // infra ones, which is what keeps a trainer timeout from reading as a provisioning fault.
  const firstInfra = FAILURE_MODES.findIndex(r => r.verdict === 'infra-retry')
  const lastOriginalQuit = FAILURE_MODES.findIndex(r => r.nomen === 'execution-error')
  assert.ok(lastOriginalQuit >= 0 && lastOriginalQuit < firstInfra,
    'the original quit rows must still be consulted before the infra rows')
})

test('every stage a row declares is one of the five published values', () => {
  // `Run.failure.stage` is public API. A row inventing a sixth value would ship it.
  const PUBLISHED = new Set(['provision', 'ssh', 'bootstrap', 'download', 'execute'])
  for (const row of FAILURE_MODES) {
    if (row.stage !== undefined) {
      assert.ok(PUBLISHED.has(row.stage), `row '${row.nomen}' declares unpublished stage '${row.stage}'`)
    }
  }
})

test('every stage row is exercised, and every published stage is reachable', () => {
  // The sibling of the reachability guard above, for the stage half: a row whose stage
  // nothing asserts is an unverified claim, and a stage no row can produce is dead API.
  for (const row of FAILURE_MODES) {
    if (row.stage === undefined) continue
    assert.ok(
      STAGE_CASES.some(([, message, stage]) => stage === row.stage && row.pattern.test(message)),
      `row '${row.nomen}' (stage '${row.stage}') has no asserted case`,
    )
  }
  const produced = new Set(FAILURE_MODES.map(r => r.stage).filter(Boolean))
  assert.deepEqual([...produced].sort(), ['bootstrap', 'download', 'execute', 'provision', 'ssh'])
})

test('the derived views are the table, partitioned — no row is lost or duplicated', () => {
  assert.equal(INFRA_RETRY_PATTERNS.length + QUIT_PATTERNS.length, FAILURE_MODES.length)
  const names = FAILURE_MODES.map(r => r.nomen)
  assert.equal(new Set(names).size, names.length, 'two rows share a name')
})
