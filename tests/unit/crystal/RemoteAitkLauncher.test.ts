// Slice E step 3 — RemoteAitkLauncher turns the high-level training inputs into a provisioned
// pod job: resolve dataset→manifest, SYNTHESISE the config (pod-side path), assemble the pod
// env, provision detached. Driven with a fake provisioner + a real resolver over an inline
// manifest — no pod, no SSH, no GPU. The provisioner's SSH/GPU work is the live seam (step 5).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { RemoteAitkLauncher, securePodTrainingProvisioner, POD_DATASET_DIR } from '../../../src/crystal/RemoteAitkLauncher.js'
import type { TrainingPodProvisioner } from '../../../src/crystal/RemoteAitkLauncher.js'
import { makeDatasetResolver } from '../../../src/crystal/datasetManifest.js'
import type { Corporum, Corpus, Corpora } from '../../../src/types/corpus.js'

const R2 = { endpoint: 'https://acc.r2.cloudflarestorage.com', accessKeyId: 'AK', secretAccessKey: 'SK', bucket: 'b', publicUrl: 'https://cdn.example' }

function harness() {
  const calls: Array<{ image: string; env: Record<string, string> }> = []
  const provisioner: TrainingPodProvisioner = { async provision(opts) { calls.push(opts); return { podId: 'pod-77' } } }
  const resolver = makeDatasetResolver({ corpora: {} as Corporum })   // inline-manifest path needs no store
  const launcher = new RemoteAitkLauncher({
    provisioner, resolver, image: 'monygroup/aitk-klein:1', r2: R2,
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
  assert.equal(h.calls[0].image, 'monygroup/aitk-klein:1')
  const env = h.calls[0].env

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
})

test('launch: gpuId defaults to 0 when omitted', async () => {
  const h = harness()
  await h.launcher.launch({ actumId: 'a', jobId: 'j', dataset: MANIFEST, baseModel: 'klein-4b', triggerWord: 'koh', steps: 10 })
  assert.equal(h.calls[0].env.AITK_GPU_IDS, '0')
})

test('launch: resolves a corpusId via the store (dataset ref, not just inline)', async () => {
  const calls: Array<{ image: string; env: Record<string, string> }> = []
  const provisioner: TrainingPodProvisioner = { async provision(opts) { calls.push(opts); return { podId: 'pod-9' } } }
  const corpus: Corpus = { id: 'c1', nomen: 'koh', genus: 'imagines', auctor: 'a1',
    exemplaria: [{ ref: 'https://r2/x.png', titulus: 'koh', genus: 'image/png' }], numerus: 1,
    status: 'validatus', natum: new Date(0), mutatum: new Date(0) }
  const corpora: Corporum = {
    async find(id) { return id === 'c1' ? corpus : null },
    async list() { return [] as Corpora }, async create() { throw new Error('x') }, async update() { throw new Error('x') },
  }
  const launcher = new RemoteAitkLauncher({
    provisioner, resolver: makeDatasetResolver({ corpora }), image: 'img:1', r2: R2,
    statusUrl: 's', webhookUrl: 'w',
  })
  await launcher.launch({ actumId: 'a', jobId: 'j', dataset: 'c1', baseModel: 'klein-4b', triggerWord: 'koh', steps: 10 })
  assert.deepEqual(JSON.parse(decode(calls[0].env.AITK_MANIFEST_B64)), [{ url: 'https://r2/x.png', caption: 'koh' }])
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
  const seen: Array<{ image: string; env: Record<string, string> }> = []
  const client = { async launchTrainingPod(opts: { image: string; env: Record<string, string> }) { seen.push(opts); return { podId: 'p1' } } }
  const prov = securePodTrainingProvisioner(client)
  assert.deepEqual(await prov.provision({ image: 'i', env: { A: '1' } }), { podId: 'p1' })
  assert.deepEqual(seen, [{ image: 'i', env: { A: '1' } }])
})
