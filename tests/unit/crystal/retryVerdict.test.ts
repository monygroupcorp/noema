// =============================================================================
// retryVerdict — the quit line, asserted class by class
// =============================================================================
//
// This table decides whether the platform may spend a user's credits on another
// attempt. Every named failure mode is asserted INDIVIDUALLY rather than through a
// sampled few, because the cost of a wrong row is either an order that gives up on a
// failure a fresh machine would have fixed, or one that keeps re-running work that
// already ran. Two rows carry that risk most directly and are called out below: the
// ip-less host and the silent pod both fall to generic "something went wrong" copy in
// `classifyError`, so nothing else in the system distinguishes them.
// =============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  INFRA_RETRY_PATTERNS, QUIT_PATTERNS, failureText, retryVerdict,
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
