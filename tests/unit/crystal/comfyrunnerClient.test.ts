import { test } from 'node:test'
import assert from 'node:assert/strict'
import { submitToRunner, awaitViaStream, isCompiledSpec } from '../../../src/crystal/comfyrunnerClient.js'

// ── helpers ───────────────────────────────────────────────────────────────────

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

// ── isCompiledSpec ─────────────────────────────────────────────────────────────

test('isCompiledSpec: true for a valid compiled spec', () => {
  assert.equal(isCompiledSpec({ workflow: { inputTemplate: {} }, models: [] }), true)
})
test('isCompiledSpec: false for a plain workflow object', () => {
  assert.equal(isCompiledSpec({ '1': { class_type: 'KSampler' } }), false)
})
test('isCompiledSpec: false for null', () => {
  assert.equal(isCompiledSpec(null), false)
})

// ── submitToRunner ─────────────────────────────────────────────────────────────

test('submitToRunner: POSTs to /job with jobId and workflow', async () => {
  let captured: unknown
  let calledUrl = ''
  let calledMethod = ''
  const fetchFn = (async (url: string, opts?: RequestInit) => {
    calledUrl = url
    calledMethod = (opts?.method as string) ?? ''
    captured = JSON.parse(opts?.body as string)
    return new Response('{}', { status: 200 })
  }) as unknown as typeof fetch

  await submitToRunner(fetchFn, 'https://pod-8080.proxy.runpod.net', 'job-1', { '1': {} })

  assert.equal(calledUrl, 'https://pod-8080.proxy.runpod.net/job')
  assert.equal(calledMethod, 'POST')
  assert.equal((captured as { jobId: string }).jobId, 'job-1')
  assert.deepEqual((captured as { workflow: unknown }).workflow, { '1': {} })
})

test('submitToRunner: unpacks a CompiledSpec into workflow/models/customNodes', async () => {
  let captured: unknown
  const fetchFn = (async (_url: string, opts?: RequestInit) => {
    captured = JSON.parse(opts?.body as string)
    return new Response('{}', { status: 200 })
  }) as unknown as typeof fetch

  const spec = {
    workflow: { inputTemplate: { '1': { class_type: 'KSampler' } } },
    models: [{ url: 'https://example.com/model.safetensors', dest: 'checkpoints/model.safetensors' }],
    customNodes: [{ url: 'https://github.com/example/node', name: 'example-node' }],
  }
  await submitToRunner(fetchFn, 'https://pod-8080.proxy.runpod.net', 'job-2', spec)

  const body = captured as Record<string, unknown>
  assert.deepEqual(body.workflow, spec.workflow.inputTemplate)
  assert.deepEqual(body.models, spec.models)
  assert.deepEqual(body.customNodes, spec.customNodes)
})

test('submitToRunner: includes webhook and r2 when provided', async () => {
  let captured: unknown
  const fetchFn = (async (_url: string, opts?: RequestInit) => {
    captured = JSON.parse(opts?.body as string)
    return new Response('{}', { status: 200 })
  }) as unknown as typeof fetch

  const r2 = { endpoint: 'https://x.r2.cloudflarestorage.com', accessKeyId: 'k', secretAccessKey: 's', bucket: 'b' }
  await submitToRunner(fetchFn, 'https://pod-8080.proxy.runpod.net', 'job-3', {}, 'https://hook.example.com', r2)

  const body = captured as Record<string, unknown>
  assert.equal(body.webhook, 'https://hook.example.com')
  assert.deepEqual(body.r2, r2)
})

test('submitToRunner: throws when runner returns non-200', async () => {
  const fetchFn = (async () => new Response('queue full', { status: 503 })) as unknown as typeof fetch
  await assert.rejects(
    () => submitToRunner(fetchFn, 'https://pod-8080.proxy.runpod.net', 'job-x', {}),
    /503/,
  )
})

// ── awaitViaStream ─────────────────────────────────────────────────────────────

test('awaitViaStream: resolves when a complete event arrives', async () => {
  const fetchFn = (async () => makeSseStream([{ type: 'complete', outputs: [] }])) as unknown as typeof fetch
  await awaitViaStream(fetchFn, 'https://pod-8080.proxy.runpod.net', 'job-1', 5000)
})

test('awaitViaStream: throws when an error event arrives', async () => {
  const fetchFn = (async () => makeSseStream([{ type: 'error', error: 'OOM on GPU' }])) as unknown as typeof fetch
  await assert.rejects(
    () => awaitViaStream(fetchFn, 'https://pod-8080.proxy.runpod.net', 'job-1', 5000),
    /OOM on GPU/,
  )
})

test('awaitViaStream: emits the canonical stage names for each event kind', async () => {
  const stages: string[] = []
  const fetchFn = (async () => makeSseStream([
    { type: 'downloading' },
    { type: 'installing-node' },
    { type: 'restarting-comfy' },
    { type: 'node' },
    { type: 'uploading' },
    { type: 'complete' },
  ])) as unknown as typeof fetch

  await awaitViaStream(fetchFn, 'https://pod-8080.proxy.runpod.net', 'job-1', 5000, (s) => stages.push(s))

  assert.ok(stages.includes('downloading'))
  assert.ok(stages.includes('installing-nodes'))
  assert.ok(stages.includes('restarting'))
  assert.ok(stages.includes('inferring'))
  assert.ok(stages.includes('uploading'))
})

test('awaitViaStream: emits inferring only once even with multiple node events', async () => {
  const stages: string[] = []
  const fetchFn = (async () => makeSseStream([
    { type: 'node' }, { type: 'node' }, { type: 'node' }, { type: 'complete' },
  ])) as unknown as typeof fetch
  await awaitViaStream(fetchFn, 'https://pod-8080.proxy.runpod.net', 'job-1', 5000, (s) => stages.push(s))
  assert.equal(stages.filter(s => s === 'inferring').length, 1)
})

test('awaitViaStream: throws on timeout when stream never terminates', { timeout: 3000 }, async () => {
  const fetchFn = (async () => makeSseStream([])) as unknown as typeof fetch  // empty stream → retry
  await assert.rejects(() => awaitViaStream(fetchFn, 'https://pod-8080.proxy.runpod.net', 'job-1', 1))
})

test('awaitViaStream: sends Last-Event-ID on reconnect', async () => {
  const headers: Array<Record<string, string>> = []
  let call = 0
  const fetchFn = (async (_url: string, opts?: RequestInit) => {
    headers.push(Object.fromEntries(Object.entries((opts?.headers ?? {}) as Record<string, string>)))
    call++
    if (call === 1) return makeSseStream([{ type: 'downloading' }])
    return makeSseStream([{ type: 'complete' }])
  }) as unknown as typeof fetch

  await awaitViaStream(fetchFn, 'https://pod-8080.proxy.runpod.net', 'job-1', 5000)
  assert.equal(headers[1]?.['Last-Event-ID'], '0')
})

// ── throttle detection ────────────────────────────────────────────────────────

test('throttle detection: throws ThrottleError on sustained low download velocity', async () => {
  // ~5 MB/s for 60s (well under the 20 MB/s floor) → bail
  const fetchFn = (async () => makeSseStream([
    { type: 'download-progress', bytesDownloaded: 0,           elapsedMs: 0 },
    { type: 'download-progress', bytesDownloaded: 75_000_000,  elapsedMs: 15_000 },
    { type: 'download-progress', bytesDownloaded: 150_000_000, elapsedMs: 30_000 },
    { type: 'download-progress', bytesDownloaded: 225_000_000, elapsedMs: 45_000 },
    { type: 'download-progress', bytesDownloaded: 300_000_000, elapsedMs: 60_000 },
    { type: 'complete' },
  ])) as unknown as typeof fetch
  await assert.rejects(
    () => awaitViaStream(fetchFn, 'https://pod-8080.proxy.runpod.net', 'job-t', 600_000),
    /throttl/i,
  )
})

test('throttle detection: does NOT bail when download velocity is healthy', async () => {
  // ~100 MB/s → fine
  const fetchFn = (async () => makeSseStream([
    { type: 'download-progress', bytesDownloaded: 0,             elapsedMs: 0 },
    { type: 'download-progress', bytesDownloaded: 1_500_000_000, elapsedMs: 15_000 },
    { type: 'download-progress', bytesDownloaded: 3_000_000_000, elapsedMs: 30_000 },
    { type: 'complete' },
  ])) as unknown as typeof fetch
  await awaitViaStream(fetchFn, 'https://pod-8080.proxy.runpod.net', 'job-h', 600_000)
})
