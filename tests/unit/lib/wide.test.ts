import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildWideEvent, emitWideEvent } from '../../../src/lib/wide.js'
import { makeTraceContext } from '../../../src/lib/trace.js'
import { bus } from '../../../src/lib/bus.js'
import type { Actum } from '../../../src/types/actum.js'
import type { Exitus } from '../../../src/types/cursus.js'
import type { WideEvent } from '../../../src/lib/wide.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function makeActum(overrides: Partial<Actum> = {}): Actum {
  return {
    id:            'actum-001',
    modusId:       'modus-abc',
    modusVersiono: '1.0.0',
    impetus:       1000n,
    signaConsumed: [],
    aditus:        {},
    status:        'completus',
    inceptum:      new Date(),
    expirat:       new Date(Date.now() + 15 * 60 * 1000),
    ...overrides,
  }
}

function makeExitus(impetus = 700n): Exitus {
  return {
    exitus:  { outputs: [] },
    impetus,
    duratio: 5000,
  }
}

// ---------------------------------------------------------------------------
// Test 1 — buildWideEvent includes correct timings from trace context
// ---------------------------------------------------------------------------

test('buildWideEvent includes correct timings from trace context', () => {
  const ctx = makeTraceContext({
    startTs:     Date.now() - 3000,
    provisionMs: 1000,
    sshReadyMs:  2000,
    jobSubmitMs: 2500,
    webhookMs:   2900,
  })
  const actum = makeActum()
  const wide = buildWideEvent(actum, ctx, 'completed', makeExitus())

  assert.equal(wide.provisionMs, 1000)
  assert.equal(wide.sshReadyMs,  2000)
  assert.equal(wide.jobSubmitMs, 2500)
  assert.equal(wide.webhookMs,   2900)
  assert.ok(wide.durationMs >= 2900, 'durationMs should be at least 2900ms')
})

// ---------------------------------------------------------------------------
// Test 2 — buildWideEvent computes refund as reservation - impetus
// ---------------------------------------------------------------------------

test('buildWideEvent computes refund as reservation minus impetus', () => {
  const ctx = makeTraceContext()
  const actum = makeActum({ impetus: 1000n })  // reservation = 1000
  const exitus = makeExitus(700n)               // impetus = 700
  const wide = buildWideEvent(actum, ctx, 'completed', exitus)

  assert.equal(wide.reservation, '1000')
  assert.equal(wide.impetus,     '700')
  assert.equal(wide.refund,      '300')         // 1000 - 700 = 300
})

// ---------------------------------------------------------------------------
// Test 3 — buildWideEvent spreads ctx.wideFields (gpuType, podId present)
// ---------------------------------------------------------------------------

test('buildWideEvent spreads ctx.wideFields onto the wide event', () => {
  const ctx = makeTraceContext({
    wideFields: { gpuType: 'NVIDIA_A40', podId: 'pod-xyz-999', cursorType: 'runpod:secure' },
  })
  const actum = makeActum()
  const wide = buildWideEvent(actum, ctx, 'completed', makeExitus())

  assert.equal(wide.gpuType,     'NVIDIA_A40')
  assert.equal(wide.podId,       'pod-xyz-999')
  assert.equal(wide.cursorType,  'runpod:secure')
})

// ---------------------------------------------------------------------------
// Test 4 — buildWideEvent marks coldStart: true when ctx.provisionMs is set
// ---------------------------------------------------------------------------

test('buildWideEvent marks coldStart true when ctx.provisionMs is set', () => {
  const ctx = makeTraceContext({ provisionMs: 1500 })
  const wide = buildWideEvent(makeActum(), ctx, 'completed', makeExitus())
  assert.equal(wide.coldStart, true)
})

// ---------------------------------------------------------------------------
// Test 5 — buildWideEvent marks coldStart: false when ctx.provisionMs is undefined
// ---------------------------------------------------------------------------

test('buildWideEvent marks coldStart false when ctx.provisionMs is undefined', () => {
  const ctx = makeTraceContext()  // provisionMs not set
  const wide = buildWideEvent(makeActum(), ctx, 'completed', makeExitus())
  assert.equal(wide.coldStart, false)
})

// ---------------------------------------------------------------------------
// Test 6 — emitWideEvent writes to stdout and emits on bus
// ---------------------------------------------------------------------------

test('emitWideEvent writes to stdout and emits actum.complete on bus', () => {
  const ctx = makeTraceContext()
  const wide = buildWideEvent(makeActum(), ctx, 'completed', makeExitus())

  const busEvents: WideEvent[] = []
  const listener = (w: WideEvent) => busEvents.push(w)
  bus.on('actum.complete', listener)

  let stdoutLine: Record<string, unknown> | null = null
  const lines = captureStdout(() => emitWideEvent(wide)) as Array<Record<string, unknown>>

  bus.removeListener('actum.complete', listener)

  // stdout check
  assert.ok(lines.length >= 1, 'expected at least one stdout line')
  stdoutLine = lines[0]
  assert.equal(stdoutLine.component, 'wide')
  assert.equal(stdoutLine.level,     'info')
  assert.equal(stdoutLine.actumId,   'actum-001')

  // bus check
  assert.equal(busEvents.length, 1)
  assert.equal(busEvents[0].actumId, 'actum-001')
})
