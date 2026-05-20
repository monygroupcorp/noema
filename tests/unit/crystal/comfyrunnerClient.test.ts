import { describe, it, expect, vi } from 'vitest'
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

describe('isCompiledSpec', () => {
  it('returns true for a valid compiled spec', () => {
    expect(isCompiledSpec({ workflow: { inputTemplate: {} }, models: [] })).toBe(true)
  })

  it('returns false for a plain workflow object', () => {
    expect(isCompiledSpec({ '1': { class_type: 'KSampler' } })).toBe(false)
  })

  it('returns false for null', () => {
    expect(isCompiledSpec(null)).toBe(false)
  })
})

// ── submitToRunner ─────────────────────────────────────────────────────────────

describe('submitToRunner', () => {
  it('POSTs to /job with jobId and workflow', async () => {
    let captured: unknown
    const fetchFn = vi.fn(async (_url: string, opts?: RequestInit) => {
      captured = JSON.parse(opts?.body as string)
      return new Response('{}', { status: 200 })
    }) as unknown as typeof fetch

    await submitToRunner(fetchFn, 'https://pod-8080.proxy.runpod.net', 'job-1', { '1': {} })

    expect(fetchFn).toHaveBeenCalledWith(
      'https://pod-8080.proxy.runpod.net/job',
      expect.objectContaining({ method: 'POST' }),
    )
    expect((captured as { jobId: string }).jobId).toBe('job-1')
    expect((captured as { workflow: unknown }).workflow).toEqual({ '1': {} })
  })

  it('unpacks a CompiledSpec and sends workflow/models/customNodes separately', async () => {
    let captured: unknown
    const fetchFn = vi.fn(async (_url: string, opts?: RequestInit) => {
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
    expect(body.workflow).toEqual(spec.workflow.inputTemplate)
    expect(body.models).toEqual(spec.models)
    expect(body.customNodes).toEqual(spec.customNodes)
  })

  it('includes webhook and r2 when provided', async () => {
    let captured: unknown
    const fetchFn = vi.fn(async (_url: string, opts?: RequestInit) => {
      captured = JSON.parse(opts?.body as string)
      return new Response('{}', { status: 200 })
    }) as unknown as typeof fetch

    const r2 = { endpoint: 'https://x.r2.cloudflarestorage.com', accessKeyId: 'k', secretAccessKey: 's', bucket: 'b' }
    await submitToRunner(fetchFn, 'https://pod-8080.proxy.runpod.net', 'job-3', {}, 'https://hook.example.com', r2)

    const body = captured as Record<string, unknown>
    expect(body.webhook).toBe('https://hook.example.com')
    expect(body.r2).toEqual(r2)
  })

  it('throws when runner returns non-200', async () => {
    const fetchFn = vi.fn(async () =>
      new Response('queue full', { status: 503 }),
    ) as unknown as typeof fetch

    await expect(
      submitToRunner(fetchFn, 'https://pod-8080.proxy.runpod.net', 'job-x', {}),
    ).rejects.toThrow('503')
  })
})

// ── awaitViaStream ─────────────────────────────────────────────────────────────

describe('awaitViaStream', () => {
  it('resolves when a complete event arrives', async () => {
    const fetchFn = vi.fn(async () =>
      makeSseStream([{ type: 'complete', outputs: [] }]),
    ) as unknown as typeof fetch

    await expect(
      awaitViaStream(fetchFn, 'https://pod-8080.proxy.runpod.net', 'job-1', 5000),
    ).resolves.toBeUndefined()
  })

  it('throws when an error event arrives', async () => {
    const fetchFn = vi.fn(async () =>
      makeSseStream([{ type: 'error', error: 'OOM on GPU' }]),
    ) as unknown as typeof fetch

    await expect(
      awaitViaStream(fetchFn, 'https://pod-8080.proxy.runpod.net', 'job-1', 5000),
    ).rejects.toThrow('OOM on GPU')
  })

  it('calls emitStage for downloading, installing-node, restarting-comfy, node, uploading', async () => {
    const stages: string[] = []
    const fetchFn = vi.fn(async () =>
      makeSseStream([
        { type: 'downloading' },
        { type: 'installing-node' },
        { type: 'restarting-comfy' },
        { type: 'node' },
        { type: 'uploading' },
        { type: 'complete' },
      ]),
    ) as unknown as typeof fetch

    await awaitViaStream(fetchFn, 'https://pod-8080.proxy.runpod.net', 'job-1', 5000, (s) => stages.push(s))

    expect(stages).toContain('downloading')
    expect(stages).toContain('installing-nodes')
    expect(stages).toContain('restarting')
    expect(stages).toContain('inferring')
    expect(stages).toContain('uploading')
  })

  it('emits inferring only once even with multiple node events', async () => {
    const stages: string[] = []
    const fetchFn = vi.fn(async () =>
      makeSseStream([
        { type: 'node' },
        { type: 'node' },
        { type: 'node' },
        { type: 'complete' },
      ]),
    ) as unknown as typeof fetch

    await awaitViaStream(fetchFn, 'https://pod-8080.proxy.runpod.net', 'job-1', 5000, (s) => stages.push(s))

    expect(stages.filter(s => s === 'inferring')).toHaveLength(1)
  })

  it('throws on timeout when stream never terminates', async () => {
    const fetchFn = vi.fn(async () =>
      makeSseStream([]),  // empty stream closes immediately → retry
    ) as unknown as typeof fetch

    await expect(
      awaitViaStream(fetchFn, 'https://pod-8080.proxy.runpod.net', 'job-1', 1),
    ).rejects.toThrow()
  }, 3000)

  it('sends Last-Event-ID on reconnect', async () => {
    const headers: Array<Record<string, string>> = []
    let call = 0
    const fetchFn = vi.fn(async (_url: string, opts?: RequestInit) => {
      headers.push(Object.fromEntries(Object.entries((opts?.headers ?? {}) as Record<string, string>)))
      call++
      if (call === 1) {
        // First call: stream with one event then close (triggers reconnect)
        return makeSseStream([{ type: 'downloading' }])
      }
      return makeSseStream([{ type: 'complete' }])
    }) as unknown as typeof fetch

    await awaitViaStream(fetchFn, 'https://pod-8080.proxy.runpod.net', 'job-1', 5000)

    // Second request should have Last-Event-ID header
    expect(headers[1]?.['Last-Event-ID']).toBe('0')
  })
})
