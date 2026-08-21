// The launch shape of a batch caption job — pure resolve → env, with the provisioner faked, so
// everything the pod is handed is pinned here. Three properties matter most: the manifest carries
// media ids and NO captions (a caption pass must not be handed the captions it is meant to
// produce), the pod is sent a caption bootstrap and the caption script rather than a training
// one, and the training arm's own launch is untouched by the selector that makes that possible.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CaptionPodLauncher, CAPTION_POD_SETUP, DEFAULT_CAPTION_MODEL, POD_CAPTION_DIR } from '../../../src/crystal/CaptionPodLauncher.js'
import { RemoteAitkLauncher, DEFAULT_AITK_IMAGE } from '../../../src/crystal/RemoteAitkLauncher.js'
import type { TrainingPodProvisioner, DetachedPodScript } from '../../../src/crystal/RemoteAitkLauncher.js'
import { resolveDetachedPodScript } from '../../../src/crystal/SecurePodClient.js'
import { DEFAULT_CAPTION_PROMPT } from '../../../src/crystal/aitkConfig.js'
import type { Dataset, Captionset } from '../../../src/types/dataset.js'
import type { Progressus } from '../../../src/types/progressus.js'
import { registerProgressusRecorder } from '../../../src/execution/progressusSink.js'

type ProvisionCall = {
  image: string; env: Record<string, string>; setup: string[]; script?: DetachedPodScript
  onPodId?: (podId: string) => Promise<void>; onLaunchFailed?: (err: unknown) => Promise<void>
}

class FakeProvisioner implements TrainingPodProvisioner {
  calls: ProvisionCall[] = []
  async provision(opts: ProvisionCall): Promise<{ podId: string }> {
    this.calls.push(opts)
    return { podId: 'pod-9' }
  }
}

const dataset = (media: Array<{ id: string; url: string }>, captionsets: Captionset[] = []): Dataset =>
  ({
    id: 'ds-1', owner: 'anima-abc', name: 'sample set', modality: 'image', custody: 'remote',
    media: media.map(m => ({ ...m, source: 'upload' as const, addedAt: new Date(0) })),
    captionsets, versions: [], natum: new Date(0), mutatum: new Date(0),
  })

const store = (ds: Dataset | null) => ({ async find(_id: string): Promise<Dataset | null> { return ds } })

const r2 = { endpoint: 'https://r2.example', accessKeyId: 'k', secretAccessKey: 's', bucket: 'b', publicUrl: 'https://r2.example/pub' }

const launcher = (ds: Dataset | null, provisioner = new FakeProvisioner()) =>
  new CaptionPodLauncher({
    provisioner, datasets: store(ds), r2,
    statusUrl: 'https://host.example/runner/status',
    webhookUrl: 'https://host.example/webhooks/execution',
  })

const spec = { actumId: 'act-1', jobId: 'job-1', datasetId: 'ds-1' }

const decode = (b64: string): string => Buffer.from(b64, 'base64').toString('utf8')

test('the manifest carries every media id, in order, and NO captions', async () => {
  const provisioner = new FakeProvisioner()
  const ds = dataset(
    [{ id: 'media-1', url: 'https://r2.example/a.png' }, { id: 'media-2', url: 'https://r2.example/b.jpg' }],
    // An existing captionset must not leak into the manifest: a pass captions the whole set, and
    // a caption handed back in would be a copy of the earlier pass rather than a new one.
    [{ id: 'captionset-old', name: 'first pass', method: 'manual', coverage: '2/2',
       captions: { 'media-1': 'an earlier caption', 'media-2': 'another' } }],
  )
  await launcher(ds, provisioner).launch(spec)

  const manifest = JSON.parse(decode(provisioner.calls[0].env.NOEMA_MANIFEST_B64))
  assert.deepEqual(manifest, [
    { url: 'https://r2.example/a.png', id: 'media-1' },
    { url: 'https://r2.example/b.jpg', id: 'media-2' },
  ])
  assert.ok(!JSON.stringify(manifest).includes('caption'), 'a caption job captions everything')
})

// THE ITEM. A caption pass loads a vision-language model and runs a forward pass per image; the
// pod it runs on must carry that and not a training toolkit.
test('a caption pass does not clone ai-toolkit', async () => {
  const provisioner = new FakeProvisioner()
  await launcher(dataset([{ id: 'media-1', url: 'https://r2.example/a.png' }]), provisioner).launch(spec)

  const { setup, script } = provisioner.calls[0]
  const recipe = setup.join('\n')
  assert.ok(!/git clone|ai-toolkit|submodule|requirements\.txt/.test(recipe),
    'the caption bootstrap clones nothing and installs no toolkit requirements')
  assert.ok(!/force-reinstall|torch==/.test(recipe),
    'the base image already carries the matched framework build — no reinstall')
  assert.ok(!/apt-get/.test(recipe), 'no system libraries: they exist for a dependency captioning does not have')
  assert.equal(setup.length, 1, 'one dependency install is the whole bootstrap')
  assert.match(setup[0], /transformers/)
  assert.match(setup[0], /boto3/)
  assert.equal(script, 'captioner', 'the pod runs the caption script, not the trainer')
  assert.deepEqual(setup, CAPTION_POD_SETUP)
})

test('the env carries the captioner’s model, prompt and token bound — and no toolkit config', async () => {
  const provisioner = new FakeProvisioner()
  const { externusJobId } = await launcher(dataset([{ id: 'media-1', url: 'https://r2.example/a.png' }]), provisioner)
    .launch({ ...spec, captionPrompt: 'describe the subject', maxNewTokens: 96, callbackNonce: 'nonce-1' })

  assert.equal(externusJobId, 'pod-9')
  const { env, image } = provisioner.calls[0]
  assert.equal(env.NOEMA_JOB_ID, 'job-1')
  assert.equal(env.NOEMA_WORK_DIR, POD_CAPTION_DIR)
  assert.equal(env.NOEMA_CAPTION_MODEL, DEFAULT_CAPTION_MODEL)
  assert.equal(env.NOEMA_CAPTION_PROMPT, 'describe the subject')
  assert.equal(env.NOEMA_CAPTION_MAX_NEW_TOKENS, '96')
  // Config transport is the environment: no yaml, and no training config either.
  assert.equal('AITK_CONFIG_B64' in env, false)
  assert.equal('AITK_CAPTION_CONFIG_B64' in env, false)
  assert.ok(!Object.values(env).some(v => v.includes('job: extension')), 'the pod is handed no toolkit config')

  // The nonce the cursor minted rides on the webhook URL, so the callback binds to this run.
  assert.match(env.NOEMA_WEBHOOK_URL, /nonce-1$/)
  assert.equal(env.NOEMA_ACTUM_ID, 'act-1')
  assert.equal(env.R2_BUCKET_NAME, 'b')
  assert.equal(image, DEFAULT_AITK_IMAGE)
})

test('with no prompt or token bound on the spec, the pod falls back to the captioner’s own defaults', async () => {
  const provisioner = new FakeProvisioner()
  await launcher(dataset([{ id: 'media-1', url: 'https://r2.example/a.png' }]), provisioner).launch(spec)
  const { env } = provisioner.calls[0]
  assert.equal(env.NOEMA_CAPTION_PROMPT, DEFAULT_CAPTION_PROMPT)
  assert.equal('NOEMA_CAPTION_MAX_NEW_TOKENS' in env, false, 'absent → the pod’s default bound')
})

test('the configured caption model reaches the pod', async () => {
  const provisioner = new FakeProvisioner()
  await new CaptionPodLauncher({
    provisioner, datasets: store(dataset([{ id: 'media-1', url: 'https://r2.example/a.png' }])), r2,
    captionModel: 'some/vl-model',
    statusUrl: 'https://host.example/runner/status',
    webhookUrl: 'https://host.example/webhooks/execution',
  }).launch(spec)
  assert.equal(provisioner.calls[0].env.NOEMA_CAPTION_MODEL, 'some/vl-model')
})

// THE TRAINING PATH DOES NOT MOVE. The script selector is optional, and the training arm names
// none — its provision call must be exactly what it was before the selector existed.
test('a provision that names no script still launches the trainer', async () => {
  const provisioner = new FakeProvisioner()
  await new RemoteAitkLauncher({
    provisioner,
    resolver: { async resolve() { return [{ url: 'https://r2.example/a.png' }] } },
    r2,
    statusUrl: 'https://host.example/runner/status',
    webhookUrl: 'https://host.example/webhooks/execution',
  }).launch({ actumId: 'act-1', jobId: 'job-1', dataset: 'ds-1', triggerWord: 'tok', baseModel: 'klein-4b', steps: 10 })

  const call = provisioner.calls[0]
  assert.equal(call.script, undefined, 'the training arm names no script')
  assert.ok(call.setup.some(s => s.includes('git clone')), 'the training bootstrap is unchanged')
  assert.ok(call.setup.some(s => s.includes('torch==2.9.1')), 'the training bootstrap is unchanged')
  assert.ok('AITK_CONFIG_B64' in call.env, 'the training env is unchanged')
})

test('the script selector resolves an absent value to the trainer, and “captioner” to the caption script', () => {
  assert.equal(resolveDetachedPodScript(undefined).name, 'aitktrainer.py',
    'omitting the selector behaves exactly as it did before there was one')
  assert.equal(resolveDetachedPodScript('captioner').name, 'captioner.py')
  assert.equal(resolveDetachedPodScript('trainer').name, 'aitktrainer.py')
  assert.ok(resolveDetachedPodScript('captioner').path.endsWith('scripts/pod/captioner.py'))
})

test('a missing dataset fails at resolve time, before a pod is provisioned', async () => {
  const provisioner = new FakeProvisioner()
  await assert.rejects(() => launcher(null, provisioner).launch(spec), /dataset not found/)
  assert.equal(provisioner.calls.length, 0)
})

test('an empty dataset fails at resolve time, before a pod is provisioned', async () => {
  const provisioner = new FakeProvisioner()
  await assert.rejects(() => launcher(dataset([]), provisioner).launch(spec), /no media to caption/)
  assert.equal(provisioner.calls.length, 0)
})

// The provisioner resolves at the pod id and finishes SSH + bootstrap in the background, so the
// launcher carries two hooks across that seam: the cursor's stamp (which must run before any
// pod-side work) and the failure sink (which is what fails the run when the background phase
// fails, instead of leaving it to time out). The launcher is the only place that holds the actum
// id, which is why the sink is bound here rather than passed down.
test('launch: threads the stamp hook through, and binds the failure sink to this run', async () => {
  const seen: Array<{ onPodId?: (podId: string) => Promise<void>; onLaunchFailed?: (err: unknown) => Promise<void> }> = []
  const provisioner: TrainingPodProvisioner = {
    async provision(opts) { seen.push(opts); return { podId: 'pod-9' } },
  }
  const failures: Array<{ actumId: string; err: unknown }> = []
  const l = new CaptionPodLauncher({
    provisioner, datasets: store(dataset([{ id: 'm1', url: 'https://r2/a.png' }])), r2,
    statusUrl: 'https://host.example/runner/status',
    webhookUrl: 'https://host.example/webhooks/execution',
    onLaunchFailed: async (actumId, err) => { failures.push({ actumId, err }) },
  })

  const stamped: string[] = []
  await l.launch({ ...spec, onPodId: async (podId: string) => { stamped.push(podId) } })

  await seen[0].onPodId!('pod-9')
  assert.deepEqual(stamped, ['pod-9'], 'the caller’s stamp hook reaches the provisioner unchanged')

  await seen[0].onLaunchFailed!(new Error('ssh never came up'))
  assert.equal(failures.length, 1)
  assert.equal(failures[0].actumId, 'act-1', 'the sink is bound to the actum this launch belongs to')
  assert.match(String((failures[0].err as Error).message), /ssh never came up/)
})

test('launch: with no failure sink configured, provisioning is still called (the hook is optional)', async () => {
  const provisioner = new FakeProvisioner()
  await launcher(dataset([{ id: 'm1', url: 'https://r2/a.png' }]), provisioner).launch(spec)
  assert.equal(provisioner.calls.length, 1)
  assert.equal(provisioner.calls[0].onLaunchFailed, undefined)
})

// ── the wait is reported while it happens ────────────────────────────────────
//
// A caption pass spends its first minutes acquiring a pod and building an environment on it,
// before a single caption can exist. Those minutes are the run, as far as someone watching is
// concerned, so the launcher reports them: `provisioning` on its own account, and whatever the
// provisioner reports from the background half of the launch (which runs after the launch call
// has returned, outside its trace, and can reach a timeline only through this hook).

/** Collect what the launcher routes to the in-process status sink. */
function captureReports(): { reports: Array<{ actumId: string; progressus: Progressus }>; restore: () => void } {
  const reports: Array<{ actumId: string; progressus: Progressus }> = []
  registerProgressusRecorder(async (actumId, progressus) => { reports.push({ actumId, progressus }) })
  return { reports, restore: () => registerProgressusRecorder(async () => {}) }
}

/** The sink is fire-and-forget; let its microtasks drain before asserting. */
const settle = (): Promise<void> => new Promise(resolve => setImmediate(resolve))

test('launch: a caption run reports it is provisioning a pod before any caption exists', async () => {
  const { reports, restore } = captureReports()
  try {
    const provisioner = new FakeProvisioner()
    await launcher(dataset([{ id: 'm1', url: 'https://r2/a.png' }]), provisioner).launch(spec)
    await settle()

    const first = reports[0]
    assert.ok(first, 'the pass reports nothing at all while it provisions')
    assert.equal(first.actumId, 'act-1')
    assert.equal(first.progressus.phase, 'provisioning')
    assert.ok(first.progressus.at instanceof Date)
  } finally { restore() }
})

test('launch: a caption run reports the pod being prepared', async () => {
  const { reports, restore } = captureReports()
  try {
    // The provisioner's background half — the SSH wait, the bootstrap, the detached start — is
    // where the bulk of the wait lives; it reports through `onPhase`.
    const provisioner: TrainingPodProvisioner = {
      async provision(opts) {
        opts.onPhase?.({ phase: 'installing', message: 'preparing the pod' })
        return { podId: 'pod-9' }
      },
    }
    await new CaptionPodLauncher({
      provisioner, datasets: store(dataset([{ id: 'm1', url: 'https://r2/a.png' }])), r2,
      statusUrl: 'https://host.example/runner/status',
      webhookUrl: 'https://host.example/webhooks/execution',
    }).launch(spec)
    await settle()

    const phases = reports.map(r => r.progressus.phase)
    assert.deepEqual(phases, ['provisioning', 'installing'], 'the pod being prepared is its own phase')
    assert.ok(reports.every(r => r.actumId === 'act-1'), 'every report is bound to this run')
  } finally { restore() }
})

// ── Extending a captionset (noema-279) ────────────────────────────────────────────────────────
// The launcher is the only production caller of `datasetToManifest`, so this is where the filter
// either reaches the pod or does not exist.

test('the pod is staged only the media the extended captionset does not cover', async () => {
  const provisioner = new FakeProvisioner()
  const ds = dataset(
    [
      { id: 'media-1', url: 'https://r2.example/a.png' },
      { id: 'media-2', url: 'https://r2.example/b.jpg' },
      { id: 'media-3', url: 'https://r2.example/c.jpg' },
    ],
    [{ id: 'captionset-1', name: 'first pass', method: 'Qwen3-VL', coverage: '1/3',
       captions: { 'media-1': 'an earlier caption' } }],
  )
  await launcher(ds, provisioner).launch({ ...spec, captionsetId: 'captionset-1' })

  const manifest = JSON.parse(decode(provisioner.calls[0].env.NOEMA_MANIFEST_B64))
  assert.deepEqual(manifest, [
    { url: 'https://r2.example/b.jpg', id: 'media-2' },
    { url: 'https://r2.example/c.jpg', id: 'media-3' },
  ])
  // The saved download is the point: the covered image's url is nowhere in what the pod is handed.
  assert.ok(!JSON.stringify(manifest).includes('a.png'), 'a covered image is not downloaded again')
  assert.ok(!JSON.stringify(manifest).includes('caption'), 'and no caption is shipped back out')
})

test('a captionset id naming no pass on the dataset fails the launch rather than widening it', async () => {
  const provisioner = new FakeProvisioner()
  const ds = dataset([{ id: 'media-1', url: 'https://r2.example/a.png' }])
  await assert.rejects(
    () => launcher(ds, provisioner).launch({ ...spec, captionsetId: 'captionset-nope' }),
    /captionset captionset-nope is not on dataset/,
  )
  assert.equal(provisioner.calls.length, 0, 'nothing is provisioned')
})

test('an extending pass with nothing left to caption fails before a pod is provisioned', async () => {
  const provisioner = new FakeProvisioner()
  const ds = dataset(
    [{ id: 'media-1', url: 'https://r2.example/a.png' }],
    [{ id: 'captionset-1', name: 'first pass', method: 'Qwen3-VL', coverage: '1/1',
       captions: { 'media-1': 'already captioned' } }],
  )
  await assert.rejects(
    () => launcher(ds, provisioner).launch({ ...spec, captionsetId: 'captionset-1' }),
    /has no media left to caption/,
  )
  assert.equal(provisioner.calls.length, 0)
})
