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
  assert.equal(result, "Pod started but SSH was unreachable. Your credits weren't charged — try again.")
})

// ---------------------------------------------------------------------------
// Test 7 — sshd did not become ready
// ---------------------------------------------------------------------------

test('classifyError: sshd did not become ready maps to SSH unreachable message', () => {
  const result = classifyError(new Error('sshd did not become ready'))
  assert.equal(result, "Pod started but SSH was unreachable. Your credits weren't charged — try again.")
})

// ---------------------------------------------------------------------------
// Test 8 — comfyrunner did not become ready
// ---------------------------------------------------------------------------

test('classifyError: comfyrunner did not become ready maps to startup timeout message', () => {
  const result = classifyError(new Error('comfyrunner did not become ready'))
  assert.equal(result, "Runtime startup timed out. Your credits weren't charged — try again.")
})

// ---------------------------------------------------------------------------
// Test 9 — comfyrunner not reachable
// ---------------------------------------------------------------------------

test('classifyError: comfyrunner not reachable maps to startup timeout message', () => {
  const result = classifyError(new Error('comfyrunner not reachable'))
  assert.equal(result, "Runtime startup timed out. Your credits weren't charged — try again.")
})

// ---------------------------------------------------------------------------
// Test 10 — comfyrunner job failed
// ---------------------------------------------------------------------------

test('classifyError: comfyrunner job failed maps to generation failure message', () => {
  const result = classifyError(new Error('comfyrunner job failed: out of memory'))
  assert.equal(result, "Generation failed on the pod. Your credits weren't charged — try again.")
})

// ---------------------------------------------------------------------------
// Test 11 — execution failed
// ---------------------------------------------------------------------------

test('classifyError: execution failed maps to generation failure message', () => {
  const result = classifyError(new Error('execution failed at step 5'))
  assert.equal(result, "Generation failed on the pod. Your credits weren't charged — try again.")
})

// ---------------------------------------------------------------------------
// Test 12 — throttling
// ---------------------------------------------------------------------------

test('classifyError: throttl maps to throttling message', () => {
  const result = classifyError(new Error('throttling detected on download'))
  assert.equal(result, "Couldn't get a fast enough GPU — the provider was throttling downloads on every pod we tried. Your credits weren't charged — try again shortly.")
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
  assert.equal(result, "Couldn't get a fast enough GPU — the provider was throttling downloads on every pod we tried. Your credits weren't charged — try again shortly.")
})
