// Slice E (hermetic core) — the remote training cursor dispatches onto a pod and returns
// { kind:'async', externusJobId }, stamping the actum so the completion webhook can find it.
// Driven with a fake launcher + fake actorum — no pod, no SSH, no GPU.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { RemoteAitoolkitTrainingCursor, DEFAULT_MAX_TRAINING_SECONDS } from '../../../src/crystal/RemoteAitoolkitTrainingCursor.js'
import type { RemoteAitkLaunchSpec, RemoteAitkLauncher } from '../../../src/crystal/RemoteAitoolkitTrainingCursor.js'
import type { Actum } from '../../../src/types/actum.js'
import type { Modus } from '../../../src/types/modus.js'
import { PROVISION_BUDGET_MS } from '../../../src/crystal/SecurePodClient.js'
import { DEFAULT_EXPIRAT_MS, MAX_TERMINUS_MS } from '../../../src/execution/ActumInceptor.js'

const actum = (aditus: Record<string, unknown>): Actum => ({ id: 'act-remote', aditus } as unknown as Actum)

function harness() {
  const launched: RemoteAitkLaunchSpec[] = []
  const updates: Array<{ id: string; patch: Record<string, unknown> }> = []
  const launcher: RemoteAitkLauncher = { async launch(spec) { launched.push(spec); return { externusJobId: 'pod-42' } } }
  const actorum = { async update(id: string, patch: Record<string, unknown>) { updates.push({ id, patch }); return {} as Actum } }
  return { launched, updates, launcher, actorum }
}

const HIGH_LEVEL = { dataset: 'corpus-1', baseModel: 'klein-4b', triggerWord: 'koh', steps: 600 }

test('run: launches the pod job with high-level inputs, stamps externusJobId + agens, returns the async handle', async () => {
  const h = harness()
  const cursor = new RemoteAitoolkitTrainingCursor({ launcher: h.launcher, actorum: h.actorum })

  const result = await cursor.run(actum({ jobId: 'job-9', ...HIGH_LEVEL, gpuId: '0', jobConfig: '{"x":1}' }))

  assert.deepEqual(result, { kind: 'async', externusJobId: 'pod-42' })
  assert.equal(h.launched.length, 1)
  // the cursor passes the high-level training inputs — NOT a configPath (the launcher owns the yaml).
  // `onPodId` is the stamp hook and is asserted on its own below; the rest of the spec is pinned here.
  const { onPodId, ...spec } = h.launched[0]
  assert.equal(typeof onPodId, 'function', 'the cursor hands the launcher its stamp hook')
  assert.deepEqual(spec, { actumId: 'act-remote', jobId: 'job-9', dataset: 'corpus-1', baseModel: 'klein-4b', triggerWord: 'koh', steps: 600, autocaption: true, callbackNonce: h.launched[0].callbackNonce, gpuId: '0', jobConfig: '{"x":1}' })
  // The per-job callback nonce is minted here and rides the spec to the pod. It is random, so it
  // is captured rather than literal — but the invariant the completion rail depends on IS pinned:
  // the nonce handed to the pod is the same one stamped on the actum, in the SAME patch as
  // externusJobId. If those ever diverge the pod's callback resolves to no actum and the training
  // run is stranded (and, per the migration rule, a nonce-less actum is treated as pre-migration).
  const nonce = h.launched[0].callbackNonce
  assert.match(String(nonce), /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, 'a per-job callback nonce is minted')
  assert.deepEqual(h.updates, [{ id: 'act-remote', patch: { externusJobId: 'pod-42', callbackNonce: nonce, oneshotPod: true, status: 'agens' } }])
})

test('run: jobId defaults to the actum id; optional fields omitted from the spec', async () => {
  const h = harness()
  const cursor = new RemoteAitoolkitTrainingCursor({ launcher: h.launcher, actorum: h.actorum })
  await cursor.run(actum(HIGH_LEVEL))
  const { onPodId: _stamp, ...spec } = h.launched[0]
  assert.deepEqual(spec, { actumId: 'act-remote', jobId: 'act-remote', dataset: 'corpus-1', baseModel: 'klein-4b', triggerWord: 'koh', steps: 600, autocaption: true, callbackNonce: h.launched[0].callbackNonce })
})

// NON-VACUITY: have the cursor stamp the actum after the launcher returns instead of through the
// `onPodId` hook and this fails — the launch resolves at the pod id and bootstraps the pod
// afterwards, so a stamp that waits for the launcher to return can leave a pod live carrying a
// callback credential the actum does not yet have.
test('run: the actum carries externusJobId + callbackNonce before any pod-side work can call back', async () => {
  const h = harness()
  let updatesWhenPodIdKnown = -1
  const launcher: RemoteAitkLauncher = {
    async launch(spec) {
      await spec.onPodId!('pod-42')          // provisioning returned; nothing pod-side has run yet
      updatesWhenPodIdKnown = h.updates.length
      return { externusJobId: 'pod-42' }
    },
  }

  const result = await new RemoteAitoolkitTrainingCursor({ launcher, actorum: h.actorum }).run(actum(HIGH_LEVEL))

  assert.equal(updatesWhenPodIdKnown, 1, 'the stamp lands inside the launch, before the pod is bootstrapped')
  assert.equal(h.updates.length, 1, 'and it is not written a second time when the launch returns')
  assert.equal(h.updates[0].patch.externusJobId, 'pod-42')
  assert.equal(h.updates[0].patch.status, 'agens')
  assert.ok(h.updates[0].patch.callbackNonce, 'the nonce rides the same patch as the handle')
  assert.deepEqual(result, { kind: 'async', externusJobId: 'pod-42' })
})

test('run: autocaption defaults on, and aditus.autocaption:false threads through as opt-out', async () => {
  const h = harness()
  const cursor = new RemoteAitoolkitTrainingCursor({ launcher: h.launcher, actorum: h.actorum })
  await cursor.run(actum({ ...HIGH_LEVEL, autocaption: false }))
  assert.equal(h.launched[0].autocaption, false)
})

test('run: the required high-level inputs are validated before anything is launched or stamped', async () => {
  const h = harness()
  const cursor = new RemoteAitoolkitTrainingCursor({ launcher: h.launcher, actorum: h.actorum })
  await assert.rejects(() => cursor.run(actum({ baseModel: 'klein-4b', triggerWord: 'koh', steps: 60 })), /`dataset` is required/)
  await assert.rejects(() => cursor.run(actum({ dataset: 'c', triggerWord: 'koh', steps: 60 })), /`baseModel` is required/)
  await assert.rejects(() => cursor.run(actum({ dataset: 'c', baseModel: 'klein-4b', steps: 60 })), /`triggerWord` is required/)
  await assert.rejects(() => cursor.run(actum({ dataset: 'c', baseModel: 'klein-4b', triggerWord: 'koh' })), /`steps` is required/)
  assert.equal(h.launched.length, 0)
  assert.equal(h.updates.length, 0)
})

test('reserve: pod-seconds cap by default, the configured max when set, a fixed price if the modus declares one', async () => {
  const h = harness()
  assert.equal(await new RemoteAitoolkitTrainingCursor({ launcher: h.launcher, actorum: h.actorum }).reserve({} as Modus, {}), 7200n)
  assert.equal(await new RemoteAitoolkitTrainingCursor({ launcher: h.launcher, actorum: h.actorum, maxTrainingSeconds: 3600 }).reserve({} as Modus, {}), 3600n)
  assert.equal(await new RemoteAitoolkitTrainingCursor({ launcher: h.launcher, actorum: h.actorum }).reserve({ impetusFixum: 5n } as Modus, {}), 5n)
})

// ---------------------------------------------------------------------------
// terminus — provisioning budget + the training window, added
// ---------------------------------------------------------------------------

test("a training actum's expirat outlives the training window it reserved", async () => {
  const h = harness()
  const cursor = new RemoteAitoolkitTrainingCursor({ launcher: h.launcher, actorum: h.actorum })
  const m = { id: 'mod-train' } as unknown as Modus

  const reservedSeconds = Number(await cursor.reserve(m, {}))
  const terminusMs = await cursor.terminus(m, {})

  assert.equal(reservedSeconds, DEFAULT_MAX_TRAINING_SECONDS)
  assert.ok(terminusMs > reservedSeconds * 1000, 'the deadline must cover provisioning as well as the run')
  assert.ok(terminusMs > DEFAULT_EXPIRAT_MS)
  assert.equal(terminusMs, PROVISION_BUDGET_MS + DEFAULT_MAX_TRAINING_SECONDS * 1000)
  assert.ok(terminusMs <= MAX_TERMINUS_MS, 'the training deadline must sit inside the ceiling')
})
