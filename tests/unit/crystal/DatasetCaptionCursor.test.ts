// The dispatch half of the batch dataset caption job. Pins the three things a caption run
// depends on before a pod exists: it reserves a pod-seconds cap (so the job is metered like any
// other run rather than free), it mints its OWN callback nonce and persists it in the same patch
// as the external job handle, and it resolves through its own ministerium — never the training
// one, whose registration a shared key would silently take over.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatasetCaptionCursor, DEFAULT_MAX_CAPTION_SECONDS } from '../../../src/crystal/DatasetCaptionCursor.js'
import type { CaptionLauncher, CaptionLaunchSpec } from '../../../src/crystal/DatasetCaptionCursor.js'
import { SimpleCursorum } from '../../../src/crystal/SimpleCursorum.js'
import { MODUS_DATASET_CAPTION, MODUS_AITOOLKIT_TRAINING } from '../../../src/crystal/seeds/modi.js'
import type { Actum } from '../../../src/types/actum.js'
import type { Cursor, CursorResult } from '../../../src/types/cursus.js'
import type { Modus } from '../../../src/types/modus.js'

class FakeLauncher implements CaptionLauncher {
  launched: CaptionLaunchSpec[] = []
  async launch(spec: CaptionLaunchSpec): Promise<{ externusJobId: string }> {
    this.launched.push(spec)
    return { externusJobId: 'pod-1' }
  }
}

class FakeActorum {
  patches: Array<Record<string, unknown>> = []
  async update(_id: string, patch: Record<string, unknown>): Promise<never> {
    this.patches.push(patch)
    return undefined as never
  }
}

const actum = (aditus: Record<string, unknown>): Actum =>
  ({ id: 'act-caption', aditus } as unknown as Actum)

const modus = (over: Partial<Modus> = {}): Modus =>
  ({ ...MODUS_DATASET_CAPTION, ...over }) as Modus

test('reserve: returns the pod-seconds cap, and its default is well under the training cap', async () => {
  const cursor = new DatasetCaptionCursor({ launcher: new FakeLauncher(), actorum: new FakeActorum() })
  assert.equal(await cursor.reserve(modus(), {}), BigInt(DEFAULT_MAX_CAPTION_SECONDS))
  assert.ok(DEFAULT_MAX_CAPTION_SECONDS < 7200, 'a caption pass must not reserve a training-sized cap')

  const capped = new DatasetCaptionCursor({
    launcher: new FakeLauncher(), actorum: new FakeActorum(), maxCaptionSeconds: 900,
  })
  assert.equal(await capped.reserve(modus(), {}), 900n)
})

test('reserve: honours a fixed price when the modus declares one', async () => {
  const cursor = new DatasetCaptionCursor({ launcher: new FakeLauncher(), actorum: new FakeActorum() })
  assert.equal(await cursor.reserve(modus({ impetusFixum: 42n }), {}), 42n)
})

test('run: launches, stamps externusJobId + agens, and returns an async result', async () => {
  const launcher = new FakeLauncher()
  const actorum = new FakeActorum()
  const cursor = new DatasetCaptionCursor({ launcher, actorum })

  const result: CursorResult = await cursor.run(actum({
    dataset: 'ds-1', captionPrompt: 'describe it', maxNewTokens: 128,
  }))

  assert.deepEqual(result, { kind: 'async', externusJobId: 'pod-1' })
  assert.equal(launcher.launched.length, 1)
  assert.equal(launcher.launched[0].datasetId, 'ds-1')
  assert.equal(launcher.launched[0].captionPrompt, 'describe it')
  assert.equal(launcher.launched[0].maxNewTokens, 128)
  assert.equal(launcher.launched[0].actumId, 'act-caption')

  assert.equal(actorum.patches.length, 1)
  assert.equal(actorum.patches[0].externusJobId, 'pod-1')
  assert.equal(actorum.patches[0].status, 'agens')
  assert.equal(actorum.patches[0].oneshotPod, true)
})

test('run: the CURSOR mints the callback nonce, and the same one lands on the actum', async () => {
  const launcher = new FakeLauncher()
  const actorum = new FakeActorum()
  await new DatasetCaptionCursor({ launcher, actorum }).run(actum({ dataset: 'ds-1' }))

  const minted = launcher.launched[0].callbackNonce
  assert.ok(minted && minted.length > 0, 'the launcher is handed a nonce it did not mint')
  // Same patch as externusJobId: a pod is never in flight carrying a nonce the actum lacks.
  assert.equal(actorum.patches[0].callbackNonce, minted)
})

test('run: a missing dataset id fails before anything is provisioned', async () => {
  const launcher = new FakeLauncher()
  await assert.rejects(
    () => new DatasetCaptionCursor({ launcher, actorum: new FakeActorum() }).run(actum({})),
    /dataset/,
  )
  assert.equal(launcher.launched.length, 0)
})

// NON-VACUITY: drop the caption modus' own ministerium (set it back to 'aitoolkit') and this
// fails — `Cursorum` is a flat map whose `register` is a bare set, so the two modi sharing a key
// means one cursor serves both and whichever registered last wins.
test('the caption modus resolves to the caption cursor, not the training cursor', () => {
  const captionCursor = new DatasetCaptionCursor({ launcher: new FakeLauncher(), actorum: new FakeActorum() })
  const trainingCursor: Cursor = {
    async reserve() { return 0n },
    async run() { return { kind: 'async', externusJobId: 'training' } },
  }

  const cursorum = new SimpleCursorum()
  // Registration order matches the container's: training first, caption second.
  cursorum.register(MODUS_AITOOLKIT_TRAINING.ministerium!, trainingCursor)
  cursorum.register(MODUS_DATASET_CAPTION.ministerium!, captionCursor)

  assert.equal(cursorum.resolve(MODUS_DATASET_CAPTION), captionCursor)
  assert.equal(cursorum.resolve(MODUS_AITOOLKIT_TRAINING), trainingCursor)
})
