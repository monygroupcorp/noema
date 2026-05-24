import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FakeRunPodClient } from '../../../src/crystal/FakeRunPodClient.js'
import { bus } from '../../../src/lib/bus.js'
import { withTrace, makeTraceContext } from '../../../src/lib/trace.js'

test('FakeRunPodClient emits the lifecycle stages and fires a COMPLETED webhook with an image', async () => {
  const webhooks: Array<{ status: string; output: Array<{ url: string }> }> = []
  const fetchFn = (async (_url: string, init?: RequestInit) => {
    webhooks.push(JSON.parse((init?.body as string) ?? '{}'))
    return new Response('{}', { status: 200 })
  }) as unknown as typeof fetch

  const stages: string[] = []
  const listener = (d: { stage: string }): void => { stages.push(d.stage) }
  bus.on('actum.stage', listener)

  const client = new FakeRunPodClient(fetchFn, { stepMs: 1 })
  await withTrace(makeTraceContext({ actumId: 'a1' }), async () => {
    const { id } = await client.submit({ input: {}, webhook: 'http://localhost:3001/webhooks/runpod' })
    assert.match(id, /^fake-/)
    await new Promise(r => setTimeout(r, 200))
  })
  bus.off('actum.stage', listener)

  assert.ok(stages.includes('pod-locked'),       `stages missing pod-locked: ${stages.join(',')}`)
  assert.ok(stages.includes('downloading:2/4'),  `stages missing downloading:2/4: ${stages.join(',')}`)
  assert.ok(stages.includes('inferring'),        `stages missing inferring: ${stages.join(',')}`)
  assert.equal(webhooks.length, 1)
  assert.equal(webhooks[0].status, 'COMPLETED')
  assert.ok(webhooks[0].output[0].url, 'webhook should include an output url')
})
