// Build #3 — comfyrunner's SSE parse now ALSO emits a typed Progressus timeline through the
// in-process recorder seam (spec §6a), in parallel with the untouched legacy `emitStage` strings.
// This covers the event→Progressus MAPPING (what comfyrunner records). Coalescing/persistence of
// that stream is the recorder's job (CrystalApi._persistAndEmit), covered in progressusSink.test.ts.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { awaitViaStream } from '../../../src/crystal/comfyrunnerClient.js'
import { registerProgressusRecorder } from '../../../src/execution/progressusSink.js'
import { withTrace, makeTraceContext } from '../../../src/lib/trace.js'
import type { Progressus } from '../../../src/types/progressus.js'

function makeSseStream(events: Array<Record<string, unknown>>): Response {
  const encoder = new TextEncoder()
  let i = 0
  const stream = new ReadableStream({
    pull(controller) {
      if (i >= events.length) { controller.close(); return }
      const ev = events[i++]
      controller.enqueue(encoder.encode(`id: ${i - 1}\ndata: ${JSON.stringify(ev)}\n\n`))
    },
  })
  return new Response(stream, { status: 200 })
}

// Register a collecting recorder for the duration of a body, then restore the no-op.
async function withRecorder(actumId: string, body: (seen: Array<{ actumId: string; p: Progressus }>) => Promise<void>): Promise<void> {
  const seen: Array<{ actumId: string; p: Progressus }> = []
  registerProgressusRecorder(async (id, p) => { seen.push({ actumId: id, p }) })
  try {
    await withTrace(makeTraceContext({ actumId }), () => body(seen))
  } finally {
    registerProgressusRecorder(async () => {})   // restore inert default
  }
}

test('comfyrunner records the §6a phase timeline; per-tick progress is NOT recorded', async () => {
  const fetchFn = (async () => makeSseStream([
    { type: 'preflight-models', total: 2, present: 0 },
    { type: 'installing-node' },
    { type: 'installing-node' },             // per-node — guarded to ONE installing entry
    { type: 'restarting-comfy' },
    { type: 'workflow-submitted', promptId: 'p1' },
    { type: 'node' },
    { type: 'node' },                       // coalesced — only the FIRST node records executing
    { type: 'progress', value: 5, max: 20 },// per-tick → NOT recorded (live-only)
    { type: 'uploading' },
    { type: 'complete', executionTimeMs: 1234 },
  ])) as unknown as typeof fetch

  await withRecorder('act-cr', async (seen) => {
    await awaitViaStream(fetchFn, 'https://pod-8080.proxy.runpod.net', 'job-1', 5000)

    assert.deepEqual(seen.map(s => s.p.phase), [
      'downloading', 'installing', 'installing', 'loading', 'executing', 'uploading', 'done',
    ])
    assert.ok(seen.every(s => s.actumId === 'act-cr'))
    // downloading carries item progress + target; loading targets vram.
    const dl = seen[0].p
    assert.equal(dl.target, 'model')
    assert.deepEqual(dl.progress, { done: 0, total: 2, unit: 'items' })
    assert.equal(seen.find(s => s.p.phase === 'loading')?.p.target, 'vram')
    // restarting-comfy carries a log message; the bare installing-node does not.
    assert.equal(seen[1].p.message, undefined)
    assert.equal(seen[2].p.message, 'restarting ComfyUI')
    // every record is stamped with a real `at`.
    assert.ok(seen.every(s => s.p.at instanceof Date))
  })
})

test('comfyrunner records a failed terminal carrying the error message', async () => {
  const fetchFn = (async () => makeSseStream([{ type: 'error', error: 'OOM on GPU' }])) as unknown as typeof fetch
  await withRecorder('act-err', async (seen) => {
    await assert.rejects(() => awaitViaStream(fetchFn, 'https://pod-8080.proxy.runpod.net', 'job-1', 5000), /OOM on GPU/)
    assert.deepEqual(seen.map(s => s.p.phase), ['failed'])
    assert.equal(seen[0].p.message, 'OOM on GPU')
  })
})

test('comfyrunner records nothing when no Actum is in the trace (e.g. warm path without actumId)', async () => {
  const fetchFn = (async () => makeSseStream([{ type: 'node' }, { type: 'complete' }])) as unknown as typeof fetch
  const seen: Array<{ actumId: string; p: Progressus }> = []
  registerProgressusRecorder(async (id, p) => { seen.push({ actumId: id, p }) })
  try {
    await withTrace(makeTraceContext({}), () =>   // no actumId
      awaitViaStream(fetchFn, 'https://pod-8080.proxy.runpod.net', 'job-1', 5000))
    assert.equal(seen.length, 0)
  } finally {
    registerProgressusRecorder(async () => {})
  }
})
