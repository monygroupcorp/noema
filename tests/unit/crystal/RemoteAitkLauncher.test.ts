// Slice E step 3 — RemoteAitkLauncher turns the high-level training inputs into a provisioned
// pod job: resolve dataset→manifest, SYNTHESISE the config (pod-side path), assemble the pod
// env, provision detached. Driven with a fake provisioner + a real resolver over an inline
// manifest — no pod, no SSH, no GPU. The provisioner's SSH/GPU work is the live seam (step 5).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { RemoteAitkLauncher, securePodTrainingProvisioner, POD_DATASET_DIR, POD_AITK_DIR, POD_RESUME_PATH, DEFAULT_AITK_IMAGE, DEFAULT_AITK_REF } from '../../../src/crystal/RemoteAitkLauncher.js'
import type { TrainingPodProvisioner } from '../../../src/crystal/RemoteAitkLauncher.js'
import { makeDatasetResolver } from '../../../src/crystal/datasetManifest.js'
import type { Corporum, Corpus, Corpora } from '../../../src/types/corpus.js'

const R2 = { endpoint: 'https://acc.r2.cloudflarestorage.com', accessKeyId: 'AK', secretAccessKey: 'SK', bucket: 'b', publicUrl: 'https://cdn.example' }

function harness() {
  const calls: Array<{ image: string; env: Record<string, string>; setup: string[] }> = []
  const provisioner: TrainingPodProvisioner = { async provision(opts) { calls.push(opts); return { podId: 'pod-77' } } }
  const resolver = makeDatasetResolver({ corpora: {} as Corporum })   // inline-manifest path needs no store
  const launcher = new RemoteAitkLauncher({
    provisioner, resolver, r2: R2,                                     // image omitted → DEFAULT_AITK_IMAGE
    statusUrl: 'https://noema.art/runner/status', webhookUrl: 'https://noema.art/webhooks/runpod',
  })
  return { calls, launcher }
}

const MANIFEST = '[{"url":"https://r2/a.png","caption":"a koh"},{"url":"https://r2/b.png"}]'
const decode = (b64: string): string => Buffer.from(b64, 'base64').toString('utf8')

test('launch: resolves the dataset, generates the config, assembles env, provisions → externusJobId', async () => {
  const h = harness()
  const result = await h.launcher.launch({
    actumId: 'act-1', jobId: 'koh', dataset: MANIFEST, baseModel: 'klein-4b', triggerWord: 'koh', steps: 250, gpuId: '0',
  })

  // the pod id is the external run handle.
  assert.deepEqual(result, { externusJobId: 'pod-77' })
  assert.equal(h.calls.length, 1)
  assert.equal(h.calls[0].image, DEFAULT_AITK_IMAGE)      // stock torch≥2.9 base (no custom image)

  // bootstrap recipe: apt system libs (libGL for opencv) + clone ai-toolkit (pinned) + install deps.
  const setup = h.calls[0].setup
  assert.ok(setup.some(c => c.includes('apt-get install') && c.includes('libgl1')))
  assert.ok(setup.some(c => c.includes(`git clone https://github.com/ostris/ai-toolkit ${POD_AITK_DIR}`)))
  assert.ok(setup.some(c => c.includes(`git checkout ${DEFAULT_AITK_REF}`)))
  assert.ok(setup.some(c => c.includes('pip install') && c.includes('requirements.txt') && c.includes('boto3')))
  // and the torch-stack restore (matched cu128 trio) as the final step — guards the torchaudio ABI crash.
  assert.ok(setup.some(c => c.includes('--force-reinstall') && c.includes('torch==2.9.1') && c.includes('cu128')))

  const env = h.calls[0].env
  assert.equal(env.AITK_DIR, POD_AITK_DIR)

  // config: generated for this run, pointed at the POD-SIDE dataset dir, carrying the user's knobs.
  const yaml = decode(env.AITK_CONFIG_B64)
  assert.match(yaml, /name: "koh"/)
  assert.match(yaml, /trigger_word: "koh"/)
  assert.match(yaml, new RegExp(`folder_path: "${POD_DATASET_DIR}"`))
  assert.match(yaml, /steps: 250/)
  assert.match(yaml, /FLUX\.2-klein-base-4B/)                 // klein-4b preset resolved

  // manifest: the resolved [{url,caption?}] the pod pulls.
  assert.deepEqual(JSON.parse(decode(env.AITK_MANIFEST_B64)), [
    { url: 'https://r2/a.png', caption: 'a koh' }, { url: 'https://r2/b.png' },
  ])

  // pod wiring: job/steps/gpu/dataset-dir + our sinks + R2 creds.
  assert.equal(env.AITK_JOB_ID, 'koh')
  assert.equal(env.AITK_STEPS, '250')
  assert.equal(env.AITK_GPU_IDS, '0')
  assert.equal(env.AITK_DATASET_DIR, POD_DATASET_DIR)
  assert.equal(env.NOEMA_ACTUM_ID, 'act-1')
  assert.equal(env.NOEMA_STATUS_URL, 'https://noema.art/runner/status')
  assert.equal(env.NOEMA_WEBHOOK_URL, 'https://noema.art/webhooks/runpod')
  assert.equal(env.R2_ENDPOINT, R2.endpoint)
  assert.equal(env.R2_ACCESS_KEY_ID, 'AK')
  assert.equal(env.R2_SECRET_ACCESS_KEY, 'SK')
  assert.equal(env.R2_BUCKET_NAME, 'b')
  assert.equal(env.R2_PUBLIC_URL, 'https://cdn.example')
  // RUNPOD_POD_ID is injected by the provisioner (it knows the pod id), NOT by the launcher.
  assert.equal(env.RUNPOD_POD_ID, undefined)

  // auto-caption on by default → a Qwen3-VL caption config rides along, pointed at the pod dataset dir.
  const captionYaml = decode(env.AITK_CAPTION_CONFIG_B64)
  assert.match(captionYaml, /type: Qwen3VLCaptioner/)
  assert.match(captionYaml, /recaption: false/)                 // dataset captions win; fill only gaps
  assert.match(captionYaml, new RegExp(`path_to_caption: "${POD_DATASET_DIR}"`))
})

test('launch: autocaption:false omits the caption config (raw images-as-given)', async () => {
  const h = harness()
  await h.launcher.launch({ actumId: 'a', jobId: 'j', dataset: MANIFEST, baseModel: 'klein-4b', triggerWord: 'koh', steps: 10, autocaption: false })
  assert.equal(h.calls[0].env.AITK_CAPTION_CONFIG_B64, undefined)
})

test('launch: gpuId defaults to 0 when omitted', async () => {
  const h = harness()
  await h.launcher.launch({ actumId: 'a', jobId: 'j', dataset: MANIFEST, baseModel: 'klein-4b', triggerWord: 'koh', steps: 10 })
  assert.equal(h.calls[0].env.AITK_GPU_IDS, '0')
})

test('launch: resumeFrom sets AITK_RESUME_URL + pretrained_lora_path; absent on a fresh run', async () => {
  const h = harness()
  await h.launcher.launch({ actumId: 'a', jobId: 'j', dataset: MANIFEST, baseModel: 'klein-4b', triggerWord: 'koh', steps: 10, resumeFrom: 'https://r2/prior.safetensors' })
  assert.equal(h.calls[0].env.AITK_RESUME_URL, 'https://r2/prior.safetensors')
  assert.match(decode(h.calls[0].env.AITK_CONFIG_B64), new RegExp(`pretrained_lora_path: "${POD_RESUME_PATH}"`))

  const h2 = harness()
  await h2.launcher.launch({ actumId: 'a', jobId: 'j', dataset: MANIFEST, baseModel: 'klein-4b', triggerWord: 'koh', steps: 10 })
  assert.equal(h2.calls[0].env.AITK_RESUME_URL, undefined)
  assert.doesNotMatch(decode(h2.calls[0].env.AITK_CONFIG_B64), /pretrained_lora_path/)
})

test('launch: resolves a corpusId via the store (dataset ref, not just inline)', async () => {
  const calls: Array<{ image: string; env: Record<string, string>; setup: string[] }> = []
  const provisioner: TrainingPodProvisioner = { async provision(opts) { calls.push(opts); return { podId: 'pod-9' } } }
  const corpus: Corpus = { id: 'c1', nomen: 'koh', genus: 'imagines', auctor: 'a1',
    exemplaria: [{ ref: 'https://r2/x.png', titulus: 'koh', genus: 'image/png' }], numerus: 1,
    status: 'validatus', natum: new Date(0), mutatum: new Date(0) }
  const corpora: Corporum = {
    async find(id) { return id === 'c1' ? corpus : null },
    async list() { return [] as Corpora }, async create() { throw new Error('x') }, async update() { throw new Error('x') },
  }
  const launcher = new RemoteAitkLauncher({
    provisioner, resolver: makeDatasetResolver({ corpora }), r2: R2, statusUrl: 's', webhookUrl: 'w',
  })
  await launcher.launch({ actumId: 'a', jobId: 'j', dataset: 'c1', baseModel: 'klein-4b', triggerWord: 'koh', steps: 10 })
  assert.deepEqual(JSON.parse(decode(calls[0].env.AITK_MANIFEST_B64)), [{ url: 'https://r2/x.png', caption: 'koh' }])
})

test('launch: image + aitkRef overrides flow into the provision call', async () => {
  const h = harness()
  const launcher = new RemoteAitkLauncher({
    provisioner: { async provision(o) { h.calls.push(o); return { podId: 'p' } } },
    resolver: makeDatasetResolver({ corpora: {} as Corporum }), r2: R2, statusUrl: 's', webhookUrl: 'w',
    image: 'runpod/pytorch:custom', aitkRef: 'deadbeef',
  })
  await launcher.launch({ actumId: 'a', jobId: 'j', dataset: MANIFEST, baseModel: 'klein-4b', triggerWord: 'koh', steps: 10 })
  assert.equal(h.calls[0].image, 'runpod/pytorch:custom')
  assert.ok(h.calls[0].setup.some(c => c.includes('git checkout deadbeef')))
})

test('launch: a bad dataset ref fails before provisioning (no pod spun on an empty dataset)', async () => {
  const h = harness()
  await assert.rejects(
    () => h.launcher.launch({ actumId: 'a', jobId: 'j', dataset: '[]', baseModel: 'klein-4b', triggerWord: 'koh', steps: 10 }),
    /manifest is empty/,
  )
  assert.equal(h.calls.length, 0)
})

test('securePodTrainingProvisioner: adapts a client.launchTrainingPod to the provision port', async () => {
  const seen: Array<{ image: string; env: Record<string, string>; setup: string[] }> = []
  const client = { async launchTrainingPod(opts: { image: string; env: Record<string, string>; setup: string[] }) { seen.push(opts); return { podId: 'p1' } } }
  const prov = securePodTrainingProvisioner(client)
  assert.deepEqual(await prov.provision({ image: 'i', env: { A: '1' }, setup: ['x'] }), { podId: 'p1' })
  assert.deepEqual(seen, [{ image: 'i', env: { A: '1' }, setup: ['x'] }])
})

// The provisioner resolves at the pod id and finishes SSH + bootstrap in the background, so the
// launcher carries two hooks across that seam: the cursor's stamp (which must run before any
// pod-side work) and the failure sink (which is what fails the run when the background phase
// fails, instead of leaving it to time out). The launcher is the only place that holds the actum
// id, which is why the sink is bound here rather than passed down.
test('launch: threads the stamp hook through, and binds the failure sink to this run', async () => {
  const seen: Array<{
    onPodId?: (podId: string) => Promise<void>
    onLaunchFailed?: (err: unknown) => Promise<void>
  }> = []
  const failures: Array<{ actumId: string; err: unknown }> = []
  const launcher = new RemoteAitkLauncher({
    provisioner: { async provision(o) { seen.push(o); return { podId: 'pod-9' } } },
    resolver: makeDatasetResolver({ corpora: {} as Corporum }), r2: R2, statusUrl: 's', webhookUrl: 'w',
    onLaunchFailed: async (actumId, err) => { failures.push({ actumId, err }) },
  })

  const stamped: string[] = []
  await launcher.launch({
    actumId: 'act-7', jobId: 'j', dataset: MANIFEST, baseModel: 'klein-4b', triggerWord: 'koh', steps: 10,
    onPodId: async (podId: string) => { stamped.push(podId) },
  })

  await seen[0].onPodId!('pod-9')
  assert.deepEqual(stamped, ['pod-9'], 'the caller’s stamp hook reaches the provisioner unchanged')

  await seen[0].onLaunchFailed!(new Error('ssh never came up'))
  assert.equal(failures.length, 1)
  assert.equal(failures[0].actumId, 'act-7', 'the sink is bound to the actum this launch belongs to')
  assert.match(String((failures[0].err as Error).message), /ssh never came up/)
})

test('launch: with no failure sink configured, provisioning is still called (the hook is optional)', async () => {
  const h = harness()
  await h.launcher.launch({ actumId: 'a', jobId: 'j', dataset: MANIFEST, baseModel: 'klein-4b', triggerWord: 'koh', steps: 10 })
  assert.equal(h.calls.length, 1)
  assert.equal((h.calls[0] as { onLaunchFailed?: unknown }).onLaunchFailed, undefined)
})

test('securePodTrainingProvisioner: passes the stamp and failure hooks through to the client', async () => {
  const seen: Array<Record<string, unknown>> = []
  const client = {
    async launchTrainingPod(opts: {
      image: string; env: Record<string, string>; setup: string[]
      onPodId?: (podId: string) => Promise<void>
      onLaunchFailed?: (err: unknown) => Promise<void>
    }) { seen.push(opts); return { podId: 'p1' } },
  }
  const onPodId = async (): Promise<void> => {}
  const onLaunchFailed = async (): Promise<void> => {}
  await securePodTrainingProvisioner(client).provision({ image: 'i', env: {}, setup: [], onPodId, onLaunchFailed })
  assert.equal(seen[0].onPodId, onPodId)
  assert.equal(seen[0].onLaunchFailed, onLaunchFailed)
})
