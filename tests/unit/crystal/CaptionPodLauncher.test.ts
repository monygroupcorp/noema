// The launch shape of a batch caption job — pure resolve → generate → env, with the provisioner
// faked, so everything the pod is handed is pinned here. Two properties matter most: the manifest
// carries media ids and NO captions (a caption pass must not be handed the captions it is meant
// to produce, or the captioner's recaption:false skips them), and the env carries the caption
// config but no training config.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CaptionPodLauncher } from '../../../src/crystal/CaptionPodLauncher.js'
import { POD_DATASET_DIR, DEFAULT_AITK_IMAGE } from '../../../src/crystal/RemoteAitkLauncher.js'
import type { TrainingPodProvisioner } from '../../../src/crystal/RemoteAitkLauncher.js'
import type { Dataset, Captionset } from '../../../src/types/dataset.js'

class FakeProvisioner implements TrainingPodProvisioner {
  calls: Array<{ image: string; env: Record<string, string>; setup: string[] }> = []
  async provision(opts: { image: string; env: Record<string, string>; setup: string[] }): Promise<{ podId: string }> {
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
    // An existing captionset must not leak into the manifest: recaption:false means any image
    // arriving with a caption is skipped, so a re-caption would return a copy of this pass.
    [{ id: 'captionset-old', name: 'first pass', method: 'manual', coverage: '2/2',
       captions: { 'media-1': 'an earlier caption', 'media-2': 'another' } }],
  )
  await launcher(ds, provisioner).launch(spec)

  const manifest = JSON.parse(decode(provisioner.calls[0].env.AITK_MANIFEST_B64))
  assert.deepEqual(manifest, [
    { url: 'https://r2.example/a.png', id: 'media-1' },
    { url: 'https://r2.example/b.jpg', id: 'media-2' },
  ])
  assert.ok(!JSON.stringify(manifest).includes('caption'), 'a caption job captions everything')
})

test('the env sets caption mode + the caption config, and NOT a training config', async () => {
  const provisioner = new FakeProvisioner()
  const { externusJobId } = await launcher(dataset([{ id: 'media-1', url: 'https://r2.example/a.png' }]), provisioner)
    .launch({ ...spec, captionPrompt: 'describe the subject', maxNewTokens: 96, callbackNonce: 'nonce-1' })

  assert.equal(externusJobId, 'pod-9')
  const { env, image, setup } = provisioner.calls[0]
  assert.equal(env.NOEMA_JOB_MODE, 'caption')
  assert.equal('AITK_CONFIG_B64' in env, false, 'there is no training config in a caption job')
  assert.equal(env.AITK_DATASET_DIR, POD_DATASET_DIR)

  const yaml = decode(env.AITK_CAPTION_CONFIG_B64)
  assert.match(yaml, /Qwen3VLCaptioner/)
  assert.match(yaml, /describe the subject/)
  assert.match(yaml, /max_new_tokens: 96/)
  // The config's caption target must be the SAME pod dir the pod stages into.
  assert.ok(yaml.includes(`path_to_caption: "${POD_DATASET_DIR}"`), 'config and staging dir must not drift')

  // The nonce the cursor minted rides on the webhook URL, so the callback binds to this run.
  assert.match(env.NOEMA_WEBHOOK_URL, /nonce-1$/)
  assert.equal(env.NOEMA_ACTUM_ID, 'act-1')
  assert.equal(image, DEFAULT_AITK_IMAGE)
  // The bootstrap recipe is the training arm's, verbatim — both lines are load-bearing.
  assert.ok(setup.some(s => s.includes('libgl1')), 'system libs the captioner stack needs')
  assert.ok(setup.some(s => s.includes('torch==2.9.1')), 'the matched cu128 torch trio')
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
