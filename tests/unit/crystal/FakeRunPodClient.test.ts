import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FakeRunPodClient } from '../../../src/crystal/FakeRunPodClient.js'
import { registerProgressusRecorder } from '../../../src/execution/progressusSink.js'
import { withTrace, makeTraceContext } from '../../../src/lib/trace.js'
import type { Progressus } from '../../../src/types/progressus.js'

test('FakeRunPodClient records the lifecycle onto the owned timeline and fires a COMPLETED webhook with an image', async () => {
  const webhooks: Array<{ status: string; output: Array<{ url: string }> }> = []
  const fetchFn = (async (_url: string, init?: RequestInit) => {
    webhooks.push(JSON.parse((init?.body as string) ?? '{}'))
    return new Response('{}', { status: 200 })
  }) as unknown as typeof fetch

  // The fake drives status through the in-process recorder seam (#6e — no more `actum.stage`).
  const seen: Progressus[] = []
  registerProgressusRecorder(async (_id, p) => { seen.push(p) })

  const client = new FakeRunPodClient(fetchFn, { stepMs: 1 })
  try {
    await withTrace(makeTraceContext({ actumId: 'a1' }), async () => {
      const { id } = await client.submit({ input: {}, webhook: 'http://localhost:3001/webhooks/runpod' })
      assert.match(id, /^fake-/)
      await new Promise(r => setTimeout(r, 200))
    })
  } finally {
    registerProgressusRecorder(async () => {})   // restore inert default
  }

  // pod-locked → a `provisioning` report carrying pod identity; downloading:2/4 → `downloading`
  // with item progress; inferring → `executing`.
  assert.ok(seen.some(p => p.phase === 'provisioning' && p.pod?.podId), `missing pod-locked: ${seen.map(p => p.phase).join(',')}`)
  assert.ok(seen.some(p => p.phase === 'downloading' && p.progress?.done === 2 && p.progress?.total === 4), 'missing downloading 2/4')
  assert.ok(seen.some(p => p.phase === 'executing'), 'missing executing')
  assert.equal(webhooks.length, 1)
  assert.equal(webhooks[0].status, 'COMPLETED')
  assert.ok(webhooks[0].output[0].url, 'webhook should include an output url')
})
