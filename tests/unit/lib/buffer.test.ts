import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shouldFlush, flushBuffer } from '../../../src/lib/buffer.js'
import { makeTraceContext } from '../../../src/lib/trace.js'
import { bus } from '../../../src/lib/bus.js'
import type { LogEntry } from '../../../src/lib/logger.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Capture process.stdout.write calls during fn(), returning parsed JSON lines.
 */
function captureStdout(fn: () => void): unknown[] {
  const captured: string[] = []
  const orig = process.stdout.write.bind(process.stdout)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(process.stdout as any).write = (chunk: string | Uint8Array, ..._rest: unknown[]) => {
    if (typeof chunk === 'string') captured.push(chunk)
    return true
  }
  try {
    fn()
  } finally {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(process.stdout as any).write = orig
  }
  return captured
    .join('')
    .split('\n')
    .filter(Boolean)
    .map(line => {
      try { return JSON.parse(line) } catch { return line }
    })
}

function makeEntry(msg: string): LogEntry {
  return { ts: new Date().toISOString(), level: 'debug', component: 'test', msg }
}

// ---------------------------------------------------------------------------
// Test 1 — shouldFlush returns true for failed actum
// ---------------------------------------------------------------------------

test('shouldFlush returns true for failed actum', () => {
  const ctx = makeTraceContext()
  assert.equal(shouldFlush(ctx, 'failed'), true)
})

// ---------------------------------------------------------------------------
// Test 2 — shouldFlush returns true when durationMs > SLOW_THRESHOLD_MS
// ---------------------------------------------------------------------------

test('shouldFlush returns true when durationMs exceeds slow threshold', () => {
  // Set startTs far in the past (10 minutes ago) so duration > default 5-min threshold
  const ctx = makeTraceContext({ startTs: Date.now() - 10 * 60 * 1000 })
  assert.equal(shouldFlush(ctx, 'completed'), true)
})

// ---------------------------------------------------------------------------
// Test 3 — shouldFlush returns false for completed actum under threshold
// ---------------------------------------------------------------------------

test('shouldFlush returns false for completed actum under slow threshold', () => {
  const ctx = makeTraceContext()  // startTs = now, so durationMs ≈ 0
  assert.equal(shouldFlush(ctx, 'completed'), false)
})

// ---------------------------------------------------------------------------
// Test 4 — flushBuffer emits all buffered entries to stdout with _retro: true
// ---------------------------------------------------------------------------

test('flushBuffer emits all buffered entries with _retro: true', () => {
  const ctx = makeTraceContext()
  ctx.buffer.push(makeEntry('entry one'))
  ctx.buffer.push(makeEntry('entry two'))

  const lines = captureStdout(() => flushBuffer(ctx, 'test-reason'))

  const retros = (lines as Array<Record<string, unknown>>).filter(l => l._retro === true)
  assert.equal(retros.length, 2)
  assert.equal(retros[0].msg, 'entry one')
  assert.equal(retros[1].msg, 'entry two')
})

// ---------------------------------------------------------------------------
// Test 5 — flushBuffer emits a marker entry before the buffered entries
// ---------------------------------------------------------------------------

test('flushBuffer emits a marker entry with msg "retroactive trace flushed" first', () => {
  const ctx = makeTraceContext()
  ctx.buffer.push(makeEntry('buffered entry'))

  const lines = captureStdout(() => flushBuffer(ctx, 'test-reason')) as Array<Record<string, unknown>>

  assert.ok(lines.length >= 2, 'expected marker + at least one entry')
  const marker = lines[0]
  assert.equal(marker.msg, 'retroactive trace flushed')
  assert.equal(marker.component, 'tracer')
  assert.equal(marker.level, 'warn')
  assert.equal(marker.reason, 'test-reason')
})

// ---------------------------------------------------------------------------
// Test 6 — flushBuffer clears the buffer after flushing
// ---------------------------------------------------------------------------

test('flushBuffer clears ctx.buffer after flushing', () => {
  const ctx = makeTraceContext()
  ctx.buffer.push(makeEntry('will be flushed'))

  captureStdout(() => flushBuffer(ctx, 'test-reason'))

  assert.equal(ctx.buffer.length, 0)
})

// ---------------------------------------------------------------------------
// Test 7 — flushBuffer is a no-op when buffer is empty
// ---------------------------------------------------------------------------

test('flushBuffer is a no-op when buffer is empty', () => {
  const ctx = makeTraceContext()
  // buffer is empty by default

  const busEvents: unknown[] = []
  const listener = (entry: LogEntry) => busEvents.push(entry)
  bus.on('log', listener)

  const lines = captureStdout(() => flushBuffer(ctx, 'test-reason'))

  bus.removeListener('log', listener)

  assert.equal(lines.length, 0, 'no stdout output when buffer is empty')
  assert.equal(busEvents.length, 0, 'no bus events when buffer is empty')
})
