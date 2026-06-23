// Slice E (hermetic core) — the remote training cursor dispatches onto a pod and returns
// { kind:'async', externusJobId }, stamping the actum so the completion webhook can find it.
// Driven with a fake launcher + fake actorum — no pod, no SSH, no GPU.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { RemoteAitoolkitTrainingCursor } from '../../../src/crystal/RemoteAitoolkitTrainingCursor.js'
import type { RemoteAitkLaunchSpec, RemoteAitkLauncher } from '../../../src/crystal/RemoteAitoolkitTrainingCursor.js'
import type { Actum } from '../../../src/types/actum.js'
import type { Modus } from '../../../src/types/modus.js'

const actum = (aditus: Record<string, unknown>): Actum => ({ id: 'act-remote', aditus } as unknown as Actum)

function harness() {
  const launched: RemoteAitkLaunchSpec[] = []
  const updates: Array<{ id: string; patch: Record<string, unknown> }> = []
  const launcher: RemoteAitkLauncher = { async launch(spec) { launched.push(spec); return { externusJobId: 'pod-42' } } }
  const actorum = { async update(id: string, patch: Record<string, unknown>) { updates.push({ id, patch }); return {} as Actum } }
  return { launched, updates, launcher, actorum }
}

test('run: launches the pod job, stamps externusJobId + agens, returns the async handle', async () => {
  const h = harness()
  const cursor = new RemoteAitoolkitTrainingCursor({ launcher: h.launcher, actorum: h.actorum })

  const result = await cursor.run(actum({ jobId: 'job-9', configPath: 'config/x.yaml', steps: 600, gpuId: '0', jobConfig: '{"x":1}' }))

  assert.deepEqual(result, { kind: 'async', externusJobId: 'pod-42' })
  assert.equal(h.launched.length, 1)
  assert.deepEqual(h.launched[0], { actumId: 'act-remote', jobId: 'job-9', configPath: 'config/x.yaml', steps: 600, gpuId: '0', jobConfig: '{"x":1}' })
  assert.deepEqual(h.updates, [{ id: 'act-remote', patch: { externusJobId: 'pod-42', status: 'agens' } }])
})

test('run: jobId defaults to the actum id; optional fields omitted from the spec', async () => {
  const h = harness()
  const cursor = new RemoteAitoolkitTrainingCursor({ launcher: h.launcher, actorum: h.actorum })
  await cursor.run(actum({ configPath: 'c.yaml' }))
  assert.deepEqual(h.launched[0], { actumId: 'act-remote', jobId: 'act-remote', configPath: 'c.yaml' })
})

test('run: a missing configPath is rejected before anything is launched or stamped', async () => {
  const h = harness()
  const cursor = new RemoteAitoolkitTrainingCursor({ launcher: h.launcher, actorum: h.actorum })
  await assert.rejects(() => cursor.run(actum({ steps: 60 })), /configPath` is required/)
  assert.equal(h.launched.length, 0)
  assert.equal(h.updates.length, 0)
})

test('reserve: pod-seconds cap by default, the configured max when set, a fixed price if the modus declares one', async () => {
  const h = harness()
  assert.equal(await new RemoteAitoolkitTrainingCursor({ launcher: h.launcher, actorum: h.actorum }).reserve({} as Modus, {}), 7200n)
  assert.equal(await new RemoteAitoolkitTrainingCursor({ launcher: h.launcher, actorum: h.actorum, maxTrainingSeconds: 3600 }).reserve({} as Modus, {}), 3600n)
  assert.equal(await new RemoteAitoolkitTrainingCursor({ launcher: h.launcher, actorum: h.actorum }).reserve({ impetusFixum: 5n } as Modus, {}), 5n)
})
