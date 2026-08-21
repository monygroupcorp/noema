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
import type { Captionset, Dataset } from '../../../src/types/dataset.js'
import type { Cursor, CursorResult } from '../../../src/types/cursus.js'
import type { Modus } from '../../../src/types/modus.js'
import { PROVISION_BUDGET_MS } from '../../../src/crystal/SecurePodClient.js'
import { DEFAULT_EXPIRAT_MS, MAX_TERMINUS_MS } from '../../../src/execution/ActumInceptor.js'

class FakeLauncher implements CaptionLauncher {
  launched: CaptionLaunchSpec[] = []
  async launch(spec: CaptionLaunchSpec): Promise<{ externusJobId: string }> {
    this.launched.push(spec)
    return { externusJobId: 'pod-1' }
  }
}

/** The dataset store the cursor reads in `reserve()` — a required dep, because a refusal a
 *  deployment can leave unwired is a refusal that never runs where the spend happens. */
class FakeDatasets {
  constructor(private readonly ds: Dataset | null = null) {}
  reads = 0
  async find(_id: string): Promise<Dataset | null> { this.reads++; return this.ds }
}

const dataset = (media: string[], captionsets: Captionset[] = []): Dataset => ({
  id: 'ds-1', owner: 'anima-abc', name: 'sample set', modality: 'image', custody: 'remote',
  media: media.map((id, i) => ({ id, url: `https://r2.example/${i}.png`, source: 'upload' as const, addedAt: new Date(0) })),
  captionsets, versions: [], natum: new Date(0), mutatum: new Date(0),
})

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
  const cursor = new DatasetCaptionCursor({ launcher: new FakeLauncher(), actorum: new FakeActorum(), datasets: new FakeDatasets() })
  assert.equal(await cursor.reserve(modus(), {}), BigInt(DEFAULT_MAX_CAPTION_SECONDS))
  assert.ok(DEFAULT_MAX_CAPTION_SECONDS < 7200, 'a caption pass must not reserve a training-sized cap')

  const capped = new DatasetCaptionCursor({
    launcher: new FakeLauncher(), actorum: new FakeActorum(), datasets: new FakeDatasets(), maxCaptionSeconds: 900,
  })
  assert.equal(await capped.reserve(modus(), {}), 900n)
})

test('reserve: honours a fixed price when the modus declares one', async () => {
  const cursor = new DatasetCaptionCursor({ launcher: new FakeLauncher(), actorum: new FakeActorum(), datasets: new FakeDatasets() })
  assert.equal(await cursor.reserve(modus({ impetusFixum: 42n }), {}), 42n)
})

test('run: launches, stamps externusJobId + agens, and returns an async result', async () => {
  const launcher = new FakeLauncher()
  const actorum = new FakeActorum()
  const cursor = new DatasetCaptionCursor({ launcher, actorum, datasets: new FakeDatasets() })

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
  await new DatasetCaptionCursor({ launcher, actorum, datasets: new FakeDatasets() }).run(actum({ dataset: 'ds-1' }))

  const minted = launcher.launched[0].callbackNonce
  assert.ok(minted && minted.length > 0, 'the launcher is handed a nonce it did not mint')
  // Same patch as externusJobId: a pod is never in flight carrying a nonce the actum lacks.
  assert.equal(actorum.patches[0].callbackNonce, minted)
})

// NON-VACUITY: have the cursor stamp the actum after the launcher returns instead of through the
// `onPodId` hook and this fails — the launch resolves at the pod id and bootstraps the pod
// afterwards, so a stamp that waits for the launcher to return can leave a pod live carrying a
// callback credential the actum does not yet have.
test('run: the actum carries externusJobId + callbackNonce before any pod-side work can call back', async () => {
  const actorum = new FakeActorum()
  let patchesWhenPodIdKnown = -1
  const launcher: CaptionLauncher = {
    async launch(spec: CaptionLaunchSpec) {
      await spec.onPodId!('pod-1')            // provisioning returned; nothing pod-side has run yet
      patchesWhenPodIdKnown = actorum.patches.length
      return { externusJobId: 'pod-1' }
    },
  }

  const result = await new DatasetCaptionCursor({ launcher, actorum, datasets: new FakeDatasets() }).run(actum({ dataset: 'ds-1' }))

  assert.equal(patchesWhenPodIdKnown, 1, 'the stamp lands inside the launch, before the pod is bootstrapped')
  assert.equal(actorum.patches.length, 1, 'and it is not written a second time when the launch returns')
  assert.equal(actorum.patches[0].externusJobId, 'pod-1')
  assert.equal(actorum.patches[0].status, 'agens')
  assert.ok(actorum.patches[0].callbackNonce, 'the nonce rides the same patch as the handle')
  assert.deepEqual(result, { kind: 'async', externusJobId: 'pod-1' })
})

test('run: a missing dataset id fails before anything is provisioned', async () => {
  const launcher = new FakeLauncher()
  await assert.rejects(
    () => new DatasetCaptionCursor({ launcher, actorum: new FakeActorum(), datasets: new FakeDatasets() }).run(actum({})),
    /dataset/,
  )
  assert.equal(launcher.launched.length, 0)
})

// NON-VACUITY: drop the caption modus' own ministerium (set it back to 'aitoolkit') and this
// fails — `Cursorum` is a flat map whose `register` is a bare set, so the two modi sharing a key
// means one cursor serves both and whichever registered last wins.
test('the caption modus resolves to the caption cursor, not the training cursor', () => {
  const captionCursor = new DatasetCaptionCursor({ launcher: new FakeLauncher(), actorum: new FakeActorum(), datasets: new FakeDatasets() })
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

// ---------------------------------------------------------------------------
// terminus — the wall-clock deadline, which is NOT the reservation
//
// A caption pod is rented, then an environment is built on it, and only then does the first
// image get captioned. The deadline has to cover both halves or the run is failed while it is
// still legitimately working. `expirat` is also what releases the locked reserve, so this number
// is the ceiling on how long a payer's credits stay locked against a run that has died.
// ---------------------------------------------------------------------------

test("a caption actum's expirat outlives the caption cursor's own reservation window", async () => {
  const cursor = new DatasetCaptionCursor({ launcher: new FakeLauncher(), actorum: new FakeActorum(), datasets: new FakeDatasets() })

  const reservedSeconds = Number(await cursor.reserve(modus(), {}))
  const terminusMs = await cursor.terminus(modus(), {})

  assert.ok(terminusMs > reservedSeconds * 1000,
    `terminus ${terminusMs}ms must outlive the ${reservedSeconds}s window it reserved`)
  assert.ok(terminusMs > DEFAULT_EXPIRAT_MS,
    'a flat default deadline is shorter than a single bootstrap command')
  assert.equal(terminusMs, PROVISION_BUDGET_MS + DEFAULT_MAX_CAPTION_SECONDS * 1000)
  assert.ok(terminusMs <= MAX_TERMINUS_MS, 'the caption deadline must sit inside the ceiling')
})

test('terminus tracks the configured caption window, not a hardcoded one', async () => {
  const capped = new DatasetCaptionCursor({
    launcher: new FakeLauncher(), actorum: new FakeActorum(), datasets: new FakeDatasets(), maxCaptionSeconds: 900,
  })
  assert.equal(await capped.terminus(modus(), {}), PROVISION_BUDGET_MS + 900 * 1000)
})

// ── Extending, and the money proof (noema-279) ────────────────────────────────────────────────
//
// A caption pass reserves a pod-seconds cap and then rents real hardware: provisioning and the
// runtime bootstrap are both billed before the first caption exists. So a pass over a captionset
// that already covers every live image must be refused in `reserve()` — before the reservation
// is locked and before a pod is asked for. Refusing in `run()` instead would leave the payer's
// credits frozen for the run's expiry window, which is the cost this refusal exists to avoid.

const covering = (mediaIds: string[]): Captionset => ({
  id: 'captionset-1', name: 'first pass', method: 'Qwen3-VL', coverage: `${mediaIds.length}/${mediaIds.length}`,
  captions: Object.fromEntries(mediaIds.map((id) => [id, `a caption for ${id}`])),
})

test('a caption pass with every image already captioned is refused before a pod is provisioned', async () => {
  const launcher = new FakeLauncher()
  const datasets = new FakeDatasets(dataset(['media-1', 'media-2'], [covering(['media-1', 'media-2'])]))
  const cursor = new DatasetCaptionCursor({ launcher, actorum: new FakeActorum(), datasets })

  await assert.rejects(
    () => cursor.reserve(modus(), { dataset: 'ds-1', captionset: 'captionset-1' }),
    /already covers every image/,
  )
  // The refusal is in reserve(), so no reservation was priced and nothing reached the launcher.
  assert.equal(launcher.launched.length, 0)

  // A declared fixed price must not short-circuit past the refusal: the pass is refused on what
  // there is to do, not on what it would have cost.
  await assert.rejects(
    () => cursor.reserve(modus({ impetusFixum: 42n }), { dataset: 'ds-1', captionset: 'captionset-1' }),
    /already covers every image/,
  )
})

test('reserve: an extending pass with images left to caption is priced normally', async () => {
  const datasets = new FakeDatasets(dataset(['media-1', 'media-2', 'media-3'], [covering(['media-1'])]))
  const cursor = new DatasetCaptionCursor({ launcher: new FakeLauncher(), actorum: new FakeActorum(), datasets })
  assert.equal(
    await cursor.reserve(modus(), { dataset: 'ds-1', captionset: 'captionset-1' }),
    BigInt(DEFAULT_MAX_CAPTION_SECONDS),
  )
})

test('reserve: a fresh-set pass reads no dataset at all — it captions everything by definition', async () => {
  const datasets = new FakeDatasets(dataset(['media-1'], [covering(['media-1'])]))
  const cursor = new DatasetCaptionCursor({ launcher: new FakeLauncher(), actorum: new FakeActorum(), datasets })
  assert.equal(await cursor.reserve(modus(), { dataset: 'ds-1' }), BigInt(DEFAULT_MAX_CAPTION_SECONDS))
  assert.equal(datasets.reads, 0)
})

test('reserve: a captionset that is not on the dataset is refused, not silently widened', async () => {
  const datasets = new FakeDatasets(dataset(['media-1']))
  const cursor = new DatasetCaptionCursor({ launcher: new FakeLauncher(), actorum: new FakeActorum(), datasets })
  await assert.rejects(
    () => cursor.reserve(modus(), { dataset: 'ds-1', captionset: 'captionset-nope' }),
    /is not on dataset/,
  )
})

test('run: the captionset the run was given is handed to the launcher', async () => {
  const launcher = new FakeLauncher()
  const cursor = new DatasetCaptionCursor({
    launcher, actorum: new FakeActorum(), datasets: new FakeDatasets(dataset(['media-1'])),
  })

  await cursor.run(actum({ dataset: 'ds-1', captionset: 'captionset-1' }))
  assert.equal(launcher.launched[0].captionsetId, 'captionset-1')

  // And a pass given none carries none — the launcher's fresh-set path is chosen by absence.
  await cursor.run(actum({ dataset: 'ds-1' }))
  assert.equal('captionsetId' in launcher.launched[1], false)
})
