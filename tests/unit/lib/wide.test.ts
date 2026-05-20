import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildWideEvent, emitWideEvent } from '../../../src/lib/wide.js'
import { makeTraceContext } from '../../../src/lib/trace.js'
import { bus } from '../../../src/lib/bus.js'
import type { Actum, ActumExecutio } from '../../../src/types/actum.js'
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
// Pod telemetry is sourced from actum.executio (durable across the webhook
// boundary), NOT from the trace context — the completion webhook runs in a
// fresh context with none of the in-flight pod state.
// ---------------------------------------------------------------------------

test('buildWideEvent reads pod timings from actum.executio', () => {
  const executio: ActumExecutio = { provisionMs: 1000, sshReadyMs: 2000, coldStart: true }
  const ctx = makeTraceContext({ webhookMs: 2900, jobSubmitMs: 2500 })
  const actum = makeActum({ executio })
  const wide = buildWideEvent(actum, ctx, 'completed', makeExitus())

  assert.equal(wide.provisionMs, 1000)
  assert.equal(wide.sshReadyMs,  2000)
  assert.equal(wide.webhookMs,   2900)   // webhookMs still comes from the (correct) webhook ctx
})

test('buildWideEvent computes durationMs from the actum, not the trace context', () => {
  const inceptum = new Date(Date.now() - 6 * 60 * 1000)
  const completum = new Date(inceptum.getTime() + 5 * 60 * 1000)  // 5 min run
  const actum = makeActum({ inceptum, completum })
  // ctx.startTs is recent (webhook just started) — must NOT be used for durationMs
  const wide = buildWideEvent(actum, makeTraceContext(), 'completed', makeExitus())
  assert.equal(wide.durationMs, 5 * 60 * 1000)
})

test('buildWideEvent computes refund as reservation minus impetus', () => {
  const ctx = makeTraceContext()
  const actum = makeActum({ impetus: 1000n })  // reservation = 1000
  const exitus = makeExitus(700n)               // impetus = 700
  const wide = buildWideEvent(actum, ctx, 'completed', exitus)

  assert.equal(wide.reservation, '1000')
  assert.equal(wide.impetus,     '700')
  assert.equal(wide.refund,      '300')         // 1000 - 700 = 300
})

test('buildWideEvent surfaces gpuType and podId from executio', () => {
  const actum = makeActum({ executio: { gpuType: 'NVIDIA_A40', podId: 'pod-xyz-999' } })
  const wide = buildWideEvent(actum, makeTraceContext(), 'completed', makeExitus())
  assert.equal(wide.gpuType, 'NVIDIA_A40')
  assert.equal(wide.podId,   'pod-xyz-999')
})

test('buildWideEvent coldStart reflects executio.coldStart', () => {
  const cold = buildWideEvent(makeActum({ executio: { coldStart: true } }), makeTraceContext(), 'completed', makeExitus())
  assert.equal(cold.coldStart, true)
  const warm = buildWideEvent(makeActum({ executio: { coldStart: false } }), makeTraceContext(), 'completed', makeExitus())
  assert.equal(warm.coldStart, false)
  const none = buildWideEvent(makeActum(), makeTraceContext(), 'completed', makeExitus())
  assert.equal(none.coldStart, false)  // no executio → not a cold start
})

test('buildWideEvent carries download telemetry from executio', () => {
  const actum = makeActum({ executio: {
    modelsDownloaded: 3, modelsReused: 1, downloadMs: 42_000, downloadBytes: 28_000_000_000,
  } })
  const wide = buildWideEvent(actum, makeTraceContext(), 'completed', makeExitus())
  assert.equal(wide.modelsDownloaded, 3)
  assert.equal(wide.modelsReused,     1)
  assert.equal(wide.downloadMs,       42_000)
  assert.equal(wide.downloadBytes,    28_000_000_000)
})

test('buildWideEvent derives costUsd from costPerHr and duration', () => {
  const inceptum = new Date(Date.now() - 60 * 60 * 1000)
  const completum = new Date(inceptum.getTime() + 30 * 60 * 1000)  // 30 min = 0.5 hr
  const actum = makeActum({ inceptum, completum, executio: { costPerHr: 0.7, coldStart: true } })
  const wide = buildWideEvent(actum, makeTraceContext(), 'completed', makeExitus())
  assert.equal(wide.costPerHr, 0.7)
  assert.equal(wide.costUsd,   0.35)  // 0.7 * 0.5 hr
})

test('buildWideEvent leaves costUsd undefined when no rate is known', () => {
  const wide = buildWideEvent(makeActum(), makeTraceContext(), 'completed', makeExitus())
  assert.equal(wide.costUsd, undefined)
})

test('buildWideEvent executionMs prefers executio, falls back to exitus.duratio', () => {
  const fromExecutio = buildWideEvent(makeActum({ executio: { executionMs: 1234 } }), makeTraceContext(), 'completed', makeExitus())
  assert.equal(fromExecutio.executionMs, 1234)
  const fromExitus = buildWideEvent(makeActum(), makeTraceContext(), 'completed', makeExitus())
  assert.equal(fromExitus.executionMs, 5000)  // exitus.duratio
})

// ---------------------------------------------------------------------------
// Event-name regression: emitWideEvent must emit the name listeners subscribe
// to ('actum.complete' / 'actum.fail'). The original bug emitted
// 'actum.completed' / 'actum.failed' → nothing was ever persisted.
// ---------------------------------------------------------------------------

test('buildWideEvent sets event to actum.complete / actum.fail', () => {
  assert.equal(buildWideEvent(makeActum(), makeTraceContext(), 'completed', makeExitus()).event, 'actum.complete')
  assert.equal(buildWideEvent(makeActum(), makeTraceContext(), 'failed', undefined, 'boom').event, 'actum.fail')
})

test('emitWideEvent emits on the actum.complete channel listeners use', () => {
  const wide = buildWideEvent(makeActum(), makeTraceContext(), 'completed', makeExitus())

  const busEvents: WideEvent[] = []
  const listener = (w: WideEvent) => busEvents.push(w)
  bus.on('actum.complete', listener)

  const lines = captureStdout(() => emitWideEvent(wide)) as Array<Record<string, unknown>>

  bus.removeListener('actum.complete', listener)

  assert.ok(lines.length >= 1, 'expected at least one stdout line')
  assert.equal(lines[0].component, 'wide')
  assert.equal(lines[0].actumId,   'actum-001')

  assert.equal(busEvents.length, 1)
  assert.equal(busEvents[0].actumId, 'actum-001')
})

test('emitWideEvent emits on the actum.fail channel for failures', () => {
  const wide = buildWideEvent(makeActum({ status: 'fractus' }), makeTraceContext(), 'failed', undefined, 'OOM')

  const failEvents: WideEvent[] = []
  const listener = (w: WideEvent) => failEvents.push(w)
  bus.on('actum.fail', listener)
  captureStdout(() => emitWideEvent(wide))
  bus.removeListener('actum.fail', listener)

  assert.equal(failEvents.length, 1)
  assert.equal(failEvents[0].errorCode, 'OOM')
})
