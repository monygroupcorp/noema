import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyError } from '../../../src/lib/classifyError.js'

// ---------------------------------------------------------------------------
// Test 1 — insufficient funds
// ---------------------------------------------------------------------------

test('classifyError: insufficient funds maps to credit balance message', () => {
  const result = classifyError(new Error('insufficient funds in wallet'))
  assert.equal(result, "You don't have enough credits. Use /status to check your balance.")
})

// ---------------------------------------------------------------------------
// Test 2 — modus not found
// ---------------------------------------------------------------------------

test('classifyError: modus not found maps to setup error message', () => {
  const result = classifyError(new Error('modus xyz not found'))
  assert.equal(result, "This workflow isn't set up correctly. Please contact support.")
})

// ---------------------------------------------------------------------------
// Test 3 — RunPod pod provision failed
// ---------------------------------------------------------------------------

test('classifyError: RunPod pod provision failed maps to capacity message', () => {
  const result = classifyError(new Error('RunPod pod provision failed'))
  assert.equal(result, "Couldn't start a GPU pod — RunPod may be at capacity. Try again in a minute.")
})

// ---------------------------------------------------------------------------
// Test 4 — no capacity
// ---------------------------------------------------------------------------

test('classifyError: no capacity maps to RunPod capacity message', () => {
  const result = classifyError(new Error('no capacity available'))
  assert.equal(result, "Couldn't start a GPU pod — RunPod may be at capacity. Try again in a minute.")
})

// ---------------------------------------------------------------------------
// Test 5 — provision failed
// ---------------------------------------------------------------------------

test('classifyError: provision failed maps to RunPod capacity message', () => {
  const result = classifyError(new Error('provision of instance failed'))
  assert.equal(result, "Couldn't start a GPU pod — RunPod may be at capacity. Try again in a minute.")
})

// ---------------------------------------------------------------------------
// Test 6 — SSH not ready
// ---------------------------------------------------------------------------

test('classifyError: SSH not ready maps to SSH unreachable message', () => {
  const result = classifyError(new Error('SSH not ready'))
  assert.equal(result, 'Pod started but SSH was unreachable — try again.')
})

// ---------------------------------------------------------------------------
// Test 7 — sshd did not become ready
// ---------------------------------------------------------------------------

test('classifyError: sshd did not become ready maps to SSH unreachable message', () => {
  const result = classifyError(new Error('sshd did not become ready'))
  assert.equal(result, 'Pod started but SSH was unreachable — try again.')
})

// ---------------------------------------------------------------------------
// Test 8 — comfyrunner did not become ready
// ---------------------------------------------------------------------------

test('classifyError: comfyrunner did not become ready maps to startup timeout message', () => {
  const result = classifyError(new Error('comfyrunner did not become ready'))
  assert.equal(result, 'Runtime startup timed out — try again.')
})

// ---------------------------------------------------------------------------
// Test 9 — comfyrunner not reachable
// ---------------------------------------------------------------------------

test('classifyError: comfyrunner not reachable maps to startup timeout message', () => {
  const result = classifyError(new Error('comfyrunner not reachable'))
  assert.equal(result, 'Runtime startup timed out — try again.')
})

// ---------------------------------------------------------------------------
// Test 10 — comfyrunner job failed
// ---------------------------------------------------------------------------

test('classifyError: comfyrunner job failed maps to generation failure message', () => {
  const result = classifyError(new Error('comfyrunner job failed: out of memory'))
  assert.equal(result, 'Generation failed on the pod — try again.')
})

// ---------------------------------------------------------------------------
// Test 11 — execution failed
// ---------------------------------------------------------------------------

test('classifyError: execution failed maps to generation failure message', () => {
  const result = classifyError(new Error('execution failed at step 5'))
  assert.equal(result, 'Generation failed on the pod — try again.')
})

// ---------------------------------------------------------------------------
// Test 12 — throttling
// ---------------------------------------------------------------------------

test('classifyError: throttl maps to throttling message', () => {
  const result = classifyError(new Error('throttling detected on download'))
  assert.equal(result, "Couldn't get a fast enough GPU — the provider was throttling downloads on every pod we tried. Try again shortly.")
})

// ---------------------------------------------------------------------------
// Test 13 — timeout
// ---------------------------------------------------------------------------

test('classifyError: timeout maps to timeout message', () => {
  const result = classifyError(new Error('operation timeout'))
  assert.equal(result, "The job timed out. The pod is being shut down — try again.")
})

// ---------------------------------------------------------------------------
// Test 14 — timed out
// ---------------------------------------------------------------------------

test('classifyError: timed out maps to timeout message', () => {
  const result = classifyError(new Error('request timed out'))
  assert.equal(result, "The job timed out. The pod is being shut down — try again.")
})

// ---------------------------------------------------------------------------
// Test 15 — expired
// ---------------------------------------------------------------------------

test('classifyError: expired maps to timeout message', () => {
  const result = classifyError(new Error('token expired'))
  assert.equal(result, "The job timed out. The pod is being shut down — try again.")
})

// ---------------------------------------------------------------------------
// Test 16 — default fallback
// ---------------------------------------------------------------------------

test('classifyError: unknown error maps to generic error message', () => {
  const result = classifyError(new Error('something completely unexpected'))
  assert.equal(result, "Something went wrong. Please try again.")
})

// ---------------------------------------------------------------------------
// Test 17 — non-Error argument fallback
// ---------------------------------------------------------------------------

test('classifyError: non-Error argument maps to generic error message', () => {
  const result = classifyError('plain string error')
  assert.equal(result, "Something went wrong. Please try again.")
})

// ---------------------------------------------------------------------------
// Test 18 — case insensitivity (insufficient)
// ---------------------------------------------------------------------------

test('classifyError: case insensitive match for insufficient funds', () => {
  const result = classifyError(new Error('INSUFFICIENT FUNDS'))
  assert.equal(result, "You don't have enough credits. Use /status to check your balance.")
})

// ---------------------------------------------------------------------------
// Test 19 — case insensitivity (modus)
// ---------------------------------------------------------------------------

test('classifyError: case insensitive match for modus not found', () => {
  const result = classifyError(new Error('MODUS something NOT FOUND'))
  assert.equal(result, "This workflow isn't set up correctly. Please contact support.")
})

// ---------------------------------------------------------------------------
// Test 20 — case insensitivity (throttl)
// ---------------------------------------------------------------------------

test('classifyError: case insensitive match for throttl', () => {
  const result = classifyError(new Error('THROTTLING IN PROGRESS'))
  assert.equal(result, "Couldn't get a fast enough GPU — the provider was throttling downloads on every pod we tried. Try again shortly.")
})

// ===========================================================================
// noema-390 — the generic sentence is a LAST resort, and no sentence asserts
// an accounting outcome this function cannot see.
// ===========================================================================

// ---------------------------------------------------------------------------
// Test 21 — the three bring-up failures that used to say "something went wrong"
// ---------------------------------------------------------------------------
//
// These are the recorded strings, verbatim, from the MiniMax H3 bring-up. Each matched
// no branch above and fell to the generic sentence while the server log named the cause;
// each cost real pod time to diagnose. They are asserted individually — a regression here
// is a regression to "read the log", which is the whole of noema-390.

test('classifyError: a full disk during the weight download names the download, not "something went wrong"', () => {
  const raw = 'model download failed: wget https://…/model.safetensors returned non-zero exit status 3'
  const result = classifyError(new Error(raw))
  assert.equal(result, "Couldn't get the model weights onto the pod — try again.")
  assert.notEqual(result, 'Something went wrong. Please try again.')
})

test('classifyError: no space left on device is a download failure, not a generic one', () => {
  const result = classifyError(new Error('wget: write error: No space left on device'))
  assert.equal(result, "Couldn't get the model weights onto the pod — try again.")
})

test('classifyError: a launch that never reached a reachable host names SSH', () => {
  const raw = 'Training pod launch exhausted 3 attempts without reaching an SSH-reachable host — abandoned pod-a, pod-b, pod-c'
  const result = classifyError(new Error(raw))
  assert.equal(result, 'Pod started but SSH was unreachable — try again.')
  assert.notEqual(result, 'Something went wrong. Please try again.')
})

test('classifyError: a bootstrap that ran out of budget names the runtime startup', () => {
  const raw = 'Pod pod-xyz provisioning budget of 900000ms exhausted — bootstrap stopped before command: pip install -r requirements.txt'
  const result = classifyError(new Error(raw))
  assert.equal(result, 'Runtime startup timed out — try again.')
})

test('classifyError: an ip-less host is a provisioning failure, not a mystery', () => {
  const raw = 'Pod pod-7 abandoned after 128476ms as an ip-less host — retrying on a fresh pod'
  const result = classifyError(new Error(raw))
  assert.equal(result, "Couldn't start a GPU pod — RunPod may be at capacity. Try again in a minute.")
})

test('classifyError: a pod that never reported in points at the runtime, not at nothing', () => {
  const raw = 'Pod never reported in — no status post within the first-heartbeat deadline'
  assert.equal(classifyError(new Error(raw)), 'Runtime startup timed out — try again.')
})

test('classifyError: CUDA OOM is an execution failure even without the word "failed"', () => {
  assert.equal(classifyError(new Error('CUDA out of memory')), 'Generation failed on the pod — try again.')
})

// ---------------------------------------------------------------------------
// Test 22 — the generic sentence still exists, for genuinely unidentified failures
// ---------------------------------------------------------------------------

test('classifyError: a failure the platform truly cannot place still gets the generic sentence', () => {
  // Closing the fallback must not mean guessing. A string the failure-mode table does not
  // recognise gets the honest generic line rather than a plausible-sounding stage.
  assert.equal(classifyError(new Error('a brand new failure nobody has classified')), 'Something went wrong. Please try again.')
})

// ---------------------------------------------------------------------------
// Test 23 — no sentence asserts a refund
// ---------------------------------------------------------------------------

test('classifyError: no sentence claims credits were not charged — it cannot see the ledger', () => {
  // This function is handed one string. Whether a reservation released is an accounting
  // outcome it has no view of; on the bring-up runs the claim happened to be true, but it
  // was asserted, never verified. Asserted across the whole corpus so a new branch cannot
  // quietly reintroduce the promise.
  const corpus = [
    'insufficient funds in wallet',
    'modus xyz not found',
    'RunPod pod provision failed',
    'no capacity available',
    'SSH not ready',
    'sshd did not become ready',
    'comfyrunner did not become ready',
    'comfyrunner not reachable',
    'comfyrunner job failed: out of memory',
    'execution failed at step 5',
    'throttling detected on download',
    'operation timed out',
    'model download failed: wget returned non-zero exit status 3',
    'Training pod launch exhausted 3 attempts without reaching an SSH-reachable host',
    'a brand new failure nobody has classified',
  ]
  for (const raw of corpus) {
    const sentence = classifyError(new Error(raw))
    assert.ok(
      !/charged|refund|credits weren|free of charge|at no cost/i.test(sentence),
      `"${sentence}" asserts an accounting outcome classifyError cannot verify (from: ${raw})`,
    )
  }
})
