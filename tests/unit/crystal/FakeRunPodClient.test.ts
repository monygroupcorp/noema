import { describe, it, expect, vi } from 'vitest'
import { FakeRunPodClient } from '../../../src/crystal/FakeRunPodClient.js'
import { bus } from '../../../src/lib/bus.js'
import { withTrace, makeTraceContext } from '../../../src/lib/trace.js'

describe('FakeRunPodClient', () => {
  it('emits the lifecycle stages and fires a COMPLETED webhook with an image', async () => {
    const webhooks: Array<{ status: string; output: Array<{ url: string }> }> = []
    const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => {
      webhooks.push(JSON.parse((init?.body as string) ?? '{}'))
      return new Response('{}', { status: 200 })
    }) as unknown as typeof fetch

    const stages: string[] = []
    const listener = (d: { stage: string }) => stages.push(d.stage)
    bus.on('actum.stage', listener)

    const client = new FakeRunPodClient(fetchFn, { stepMs: 1 })
    await withTrace(makeTraceContext({ actumId: 'a1' }), async () => {
      const { id } = await client.submit({ input: {}, webhook: 'http://localhost:3001/webhooks/runpod' })
      expect(id).toMatch(/^fake-/)
      await new Promise(r => setTimeout(r, 200))
    })
    bus.off('actum.stage', listener)

    expect(stages).toContain('pod-locked')
    expect(stages).toContain('downloading:2/4')
    expect(stages).toContain('inferring')
    expect(webhooks.length).toBe(1)
    expect(webhooks[0].status).toBe('COMPLETED')
    expect(webhooks[0].output[0].url).toBeTruthy()
  })
})
