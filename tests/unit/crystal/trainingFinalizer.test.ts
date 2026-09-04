// Slice B — training finality: a completed run hosts its LoRA in R2 + registers it as a
// private Intella, returning the exitus ids. Driven with a fake reader/store/writer — no
// filesystem, no R2, no Mongo.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeTrainingFinalizer, urlLoraReader, withLocalSamples } from '../../../src/crystal/trainingFinalizer.js'
import type { LoraReader, IntellaWriter } from '../../../src/crystal/trainingFinalizer.js'
import type { Uploader } from '../../../src/crystal/R2Uploader.js'
import type { MediaFetcher } from '../../../src/crystal/MediaFetcher.js'
import type { Intella } from '../../../src/types/intelligendi.js'
import type { Actum } from '../../../src/types/actum.js'
import type { AitkOutcome } from '../../../src/crystal/aitoolkitRunnerClient.js'

const actum = (aditus: Record<string, unknown>): Actum => ({ id: 'act-train', aditus } as unknown as Actum)
const completed = (lastStep = 600): AitkOutcome => ({ status: 'completed', lastStep })

function harness() {
  const puts: Array<{ key: string; bytes: Buffer; contentType: string }> = []
  const upserts: Intella[] = []
  const reader: LoraReader = async () => ({ bytes: Buffer.from('weights'), filename: 'milady.safetensors' })
  const store: Uploader = { async put(key, bytes, contentType) { puts.push({ key, bytes, contentType }); return `https://cdn/${key}` } }
  const intellae: IntellaWriter = { async upsert(intella) { upserts.push(intella) } }
  return { puts, upserts, reader, store, intellae }
}

test('completed run: hosts the LoRA bytes in R2, registers a private Intella, returns the ids', async () => {
  const h = harness()
  const finalize = makeTrainingFinalizer({ ...h, newId: () => 'lora-xyz', now: () => new Date(0) })

  const exitus = await finalize(
    actum({ jobId: 'job-1', triggerWord: 'mLady Style', familia: 'FLUX', baseIntellaId: 'flux-base', ownerAnimaId: 'anima-7', name: 'Milady' }),
    completed(600),
  )

  // exitus carries the ids the receipt + modus contract surface (+ the license verdict, below).
  assert.equal(exitus.trained, true)
  assert.equal(exitus.steps, 600)
  assert.equal(exitus.loraId, 'lora-xyz')
  assert.equal(exitus.loraUrl, 'https://cdn/models/lora-xyz/milady.safetensors')
  // no baseModel on this actum → license unverified → private-use-only note (fail-closed)
  assert.equal(exitus.commercialUse, 'unknown')
  assert.match(String(exitus.licenseNote), /Private use only/i)

  // hosted under models/<id>/<filename>, real bytes.
  assert.equal(h.puts.length, 1)
  assert.equal(h.puts[0].key, 'models/lora-xyz/milady.safetensors')
  assert.deepEqual(h.puts[0].bytes, Buffer.from('weights'))

  // registered as a private LoRA the trigger-map resolver can find (familia + trigger).
  assert.equal(h.upserts.length, 1)
  const i = h.upserts[0]
  assert.equal(i.id, 'lora-xyz')
  assert.equal(i.genus, 'lora')
  assert.equal(i.nomen, 'Milady')
  assert.equal(i.familia, 'flux')            // lowercased compat key
  assert.equal(i.trigger, 'mLady Style')
  assert.equal(i.slug, 'mlady-style')        // slugified
  assert.equal(i.dest, 'loras/mlady-style.safetensors')
  assert.equal(i.baseIntellaId, 'flux-base')
  assert.equal(i.ownerAnimaId, 'anima-7')
  assert.equal(i.access, 'private')          // never auto-public
  assert.equal(i.canonica, false)
  assert.deepEqual(i.sources, [{ provenance: 'miladystation', uri: exitus.loraUrl, format: 'safetensors' }])
})

test('license inherits the base: schnell → commercially listable; dev → private-use-only (training UX)', async () => {
  const hSchnell = harness()
  const schnell = makeTrainingFinalizer({ ...hSchnell, newId: () => 'l1', now: () => new Date(0) })
  const sx = await schnell(actum({ triggerWord: 'x', baseModel: 'FLUX.1-schnell', ownerAnimaId: 'a' }), completed())
  assert.equal(sx.license, 'apache-2.0')
  assert.equal(sx.commercialUse, 'yes')
  assert.match(String(sx.licenseNote), /listable/i)
  // 'FLUX.1-schnell' is already a descriptive string, not a trainable-preset alias — resolveBasePreset
  // has nothing to resolve it TO, so it's classified (and recorded) as-is, unchanged.
  assert.equal(hSchnell.upserts[0].baseModel, 'FLUX.1-schnell')

  const h = harness()
  const dev = makeTrainingFinalizer({ ...h, newId: () => 'l2', now: () => new Date(0) })
  const dx = await dev(actum({ triggerWord: 'y', baseModel: 'FLUX.1-dev', ownerAnimaId: 'a' }), completed())
  assert.equal(dx.commercialUse, 'no')                       // NC base → NC derivative
  assert.match(String(dx.licenseNote), /Private use only/i)
  assert.equal(h.upserts[0].commercialUse, 'no')             // and recorded on the Intella for the gate
  assert.equal(h.upserts[0].baseModel, 'FLUX.1-dev')
})

test('card enrichment: persists trainingSteps (aditus steps wins), description, and retrain provenance', async () => {
  const h = harness()
  const finalize = makeTrainingFinalizer({ ...h, newId: () => 'lora-k', now: () => new Date(0) })

  await finalize(
    actum({
      triggerWord: 'drifella', baseModel: 'flux2-klein', steps: 1000,
      description: 'anthropomorphic cat collages', provenanceRepo: 'ms2stationthis/drifella', provenanceBase: 'FLUX.1-dev',
    }),
    completed(1000),
  )

  const i = h.upserts[0]
  assert.equal(i.trainingSteps, 1000)                                  // aditus steps, not just lastStep
  assert.equal(i.description, 'anthropomorphic cat collages')
  assert.deepEqual(i.provenance, { repo: 'ms2stationthis/drifella', base: 'FLUX.1-dev' })
  // baseModel is the RESOLVED training-time descriptor ('flux2-klein' alias → its preset's HF id),
  // a DIFFERENT statement from provenance.base (the external retrain lineage above) — and it's what
  // this run's own license was classified from, not the (unrelated, external) provenanceBase.
  assert.equal(i.baseModel, 'black-forest-labs/FLUX.2-klein-base-4B')
  assert.equal(i.license, 'apache-2.0')
  assert.equal(i.commercialUse, 'yes')
})

test('Intella.baseModel is set to the RESOLVED preset descriptor, not the raw training alias (spec §1b/§2)', async () => {
  const h = harness()
  const finalize = makeTrainingFinalizer({ ...h, newId: () => 'lora-base-a', now: () => new Date(0) })
  await finalize(actum({ triggerWord: 'brutalite', baseModel: 'klein-4b', ownerAnimaId: 'a' }), completed())
  const i = h.upserts[0]
  assert.equal(i.baseModel, 'black-forest-labs/FLUX.2-klein-base-4B')  // NOT the raw alias 'klein-4b'
  assert.equal(i.license, 'apache-2.0')
  assert.equal(i.commercialUse, 'yes')
})

test('license + baseModel for the krea2-raw preset', async () => {
  const h = harness()
  const finalize = makeTrainingFinalizer({ ...h, newId: () => 'lora-krea', now: () => new Date(0) })
  await finalize(actum({ triggerWord: 'x', baseModel: 'krea2-raw', ownerAnimaId: 'a' }), completed())
  const i = h.upserts[0]
  assert.equal(i.baseModel, 'krea/Krea-2-Raw')
  assert.equal(i.license, 'krea-community')       // conditional (Krea 2 Community, <$1M revenue)
  assert.equal(i.commercialUse, 'conditional')
})

test('license + baseModel for the zimage preset', async () => {
  const h = harness()
  const finalize = makeTrainingFinalizer({ ...h, newId: () => 'lora-zimage', now: () => new Date(0) })
  await finalize(actum({ triggerWord: 'x', baseModel: 'zimage', ownerAnimaId: 'a' }), completed())
  const i = h.upserts[0]
  assert.equal(i.baseModel, 'Tongyi-MAI/Z-Image')
  assert.equal(i.license, 'apache-2.0')
  assert.equal(i.commercialUse, 'yes')
})

test('repro artifacts: persists samples (paired with prompts), datasetItems, and a repo-relative configYaml', async () => {
  const h = harness()
  const finalize = makeTrainingFinalizer({ ...h, newId: () => 'lora-r', now: () => new Date(0) })
  const manifest = JSON.stringify([{ url: 'https://cdn/img0.png', caption: 'a koh' }, { url: 'https://cdn/img1.png' }])

  await finalize(
    actum({ triggerWord: 'koh', baseModel: 'klein-4b', steps: 1000, dataset: manifest }),
    { status: 'completed', lastStep: 1000, sampleUrls: ['https://cdn/s0.jpg', 'https://cdn/s1.jpg'] },
  )

  const i = h.upserts[0]
  assert.equal(i.samples?.length, 2)
  assert.equal(i.samples?.[0].url, 'https://cdn/s0.jpg')
  assert.match(i.samples?.[0].prompt ?? '', /koh/)                 // DEFAULT_SAMPLE_PROMPTS, trigger-substituted, by index
  assert.deepEqual(i.datasetItems, [{ url: 'https://cdn/img0.png', caption: 'a koh' }, { url: 'https://cdn/img1.png' }])
  assert.match(i.configYaml ?? '', /folder_path: "dataset"/)       // repo-relative for reproduction
  assert.match(i.configYaml ?? '', /arch: "flux2_klein_4b"/)
  // klein-4b resolves to Apache-2.0 (docs/spec/model-base-provenance.md) — the exact input the
  // fallback-chain bug shipped with 13 untested cases (spec §1b/§5).
  assert.equal(i.license, 'apache-2.0')
  assert.equal(i.commercialUse, 'yes')
})

test('samples pair with dataset-derived samplePrompts (aditus), [trigger]-substituted, by index', async () => {
  const h = harness()
  const finalize = makeTrainingFinalizer({ ...h, newId: () => 'lora-sp', now: () => new Date(0) })
  await finalize(
    actum({ triggerWord: 'koh', baseModel: 'klein-4b', steps: 1000,
      samplePrompts: JSON.stringify(['[trigger], a koh on a roof', '[trigger], a koh in the rain']) }),
    { status: 'completed', lastStep: 1000, sampleUrls: ['https://cdn/s0.jpg', 'https://cdn/s1.jpg'] },
  )
  const i = h.upserts[0]
  assert.equal(i.samples?.[0].prompt, 'koh, a koh on a roof')      // dataset caption, not the generic default
  assert.equal(i.samples?.[1].prompt, 'koh, a koh in the rain')
  assert.equal(i.license, 'apache-2.0')
  assert.equal(i.commercialUse, 'yes')
})

test('cleanup: a remote completion sweeps the intermediate checkpoint + redundant pod-final (keeps samples)', async () => {
  const h = harness()
  const deleted: string[] = []
  const store = { ...h.store, async del(key: string) { deleted.push(key) } }
  const fetcher: MediaFetcher = { async fetch() { return Buffer.from('w') } }
  const finalize = makeTrainingFinalizer({ ...h, store, reader: urlLoraReader(fetcher), newId: () => 'lid', now: () => new Date(0) })

  await finalize(
    actum({ jobId: 'koh', triggerWord: 'koh', baseModel: 'klein-4b', steps: 1000 }),
    { status: 'completed', lastStep: 1000, outputUrl: 'https://cdn/training/koh/koh.safetensors' },
  )

  assert.deepEqual(deleted, ['training/koh/checkpoint.safetensors', 'training/koh/koh.safetensors'])
  assert.equal(h.upserts[0].license, 'apache-2.0')
  assert.equal(h.upserts[0].commercialUse, 'yes')
})

test('cleanup: the LOCAL path (no outputUrl) sweeps nothing', async () => {
  const h = harness()
  const deleted: string[] = []
  const store = { ...h.store, async del(key: string) { deleted.push(key) } }
  await makeTrainingFinalizer({ ...h, store, newId: () => 'lid2', now: () => new Date(0) })(
    actum({ jobId: 'koh', triggerWord: 'koh', baseModel: 'klein-4b', steps: 250 }), completed(250),
  )
  assert.deepEqual(deleted, [])
  assert.equal(h.upserts[0].license, 'apache-2.0')
  assert.equal(h.upserts[0].commercialUse, 'yes')
})

test('withLocalSamples: collects the END-OF-RUN previews (max step, by prompt index), hosts them, feeds sampleUrls', async () => {
  const { mkdtemp, mkdir, writeFile } = await import('node:fs/promises')
  const { join } = await import('node:path')
  const { tmpdir } = await import('node:os')
  const out = await mkdtemp(join(tmpdir(), 'aitk-'))
  const samples = join(out, 'job9', 'samples')
  await mkdir(samples, { recursive: true })
  // step-0 noise + the real end-of-run set at step 1000, prompts 0..2 (out of filename order).
  for (const n of ['111__000000000_0.jpg', '111__000000000_1.jpg',
                   '777__000001000_2.jpg', '222__000001000_0.jpg', '555__000001000_1.png']) {
    await writeFile(join(samples, n), Buffer.from(n))
  }
  const seen: Array<{ outcome: AitkOutcome }> = []
  const put: string[] = []
  const store = { async put(key: string) { put.push(key); return `https://cdn/${key}` } }
  const inner: import('../../../src/crystal/trainingFinalizer.js').TrainingFinalize =
    async (_a, outcome) => { seen.push({ outcome }); return { ok: true } }

  await withLocalSamples(inner, { outputDir: out, store })(
    actum({ jobId: 'job9' }), { status: 'completed', lastStep: 1000 },
  )

  // only the step-1000 set, ordered by prompt index 0,1,2 — step-0 images dropped.
  assert.deepEqual(put, [
    'training/job9/samples/000.jpg', 'training/job9/samples/001.png', 'training/job9/samples/002.jpg',
  ])
  assert.deepEqual(seen[0].outcome.sampleUrls, [
    'https://cdn/training/job9/samples/000.jpg',
    'https://cdn/training/job9/samples/001.png',
    'https://cdn/training/job9/samples/002.jpg',
  ])
})

test('withLocalSamples: no-op when the outcome already carries samples (remote path) or has no samples dir', async () => {
  const seen: AitkOutcome[] = []
  const store = { async put() { throw new Error('should not upload') } }
  const inner: import('../../../src/crystal/trainingFinalizer.js').TrainingFinalize =
    async (_a, outcome) => { seen.push(outcome); return {} }
  const wrap = withLocalSamples(inner, { outputDir: '/nonexistent', store })

  await wrap(actum({ jobId: 'r' }), { status: 'completed', lastStep: 1, sampleUrls: ['https://cdn/s.jpg'] }) // remote
  await wrap(actum({ jobId: 'r' }), { status: 'completed', lastStep: 1 })                                    // no dir → []
  assert.deepEqual(seen[0].sampleUrls, ['https://cdn/s.jpg'])  // untouched
  assert.equal(seen[1].sampleUrls, undefined)                  // stayed bare, finality still ran
})

test('repro artifacts: no samples/dataset on a bare run leaves the fields unset', async () => {
  const h = harness()
  await makeTrainingFinalizer({ ...h, newId: () => 'lora-b', now: () => new Date(0) })(
    actum({ triggerWord: 'koh', baseModel: 'klein-4b', steps: 250 }), completed(250),
  )
  assert.equal(h.upserts[0].samples, undefined)
  assert.equal(h.upserts[0].datasetItems, undefined)
  assert.equal(h.upserts[0].license, 'apache-2.0')
})

test('slug override: publishes under a name that differs from the invocation trigger', async () => {
  const h = harness()
  const finalize = makeTrainingFinalizer({ ...h, newId: () => 'lora-s', now: () => new Date(0) })

  await finalize(
    actum({ triggerWord: '333', slug: '333flux-klein', baseModel: 'klein-4b', steps: 4000 }),
    completed(4000),
  )

  const i = h.upserts[0]
  assert.equal(i.trigger, '333')                 // /make invocation word unchanged
  assert.equal(i.slug, '333flux-klein')          // repo name + dest stem use the override
  assert.equal(i.dest, 'loras/333flux-klein.safetensors')
  assert.equal(i.license, 'apache-2.0')
})

test('card enrichment: omits provenance when no source repo is given', async () => {
  const h = harness()
  await makeTrainingFinalizer({ ...h, newId: () => 'lora-n', now: () => new Date(0) })(
    actum({ triggerWord: 'koh', baseModel: 'klein-4b', steps: 250 }), completed(250),
  )
  assert.equal(h.upserts[0].provenance, undefined)
  assert.equal(h.upserts[0].trainingSteps, 250)
  assert.equal(h.upserts[0].license, 'apache-2.0')
})

test('an owner-less run still hosts + records an (archival) Intella, slugging the jobId', async () => {
  // No ownerAnimaId → the private record is owner-less, so /make can't yet resolve it
  // (access gating admits a private LoRA only for its owner). It's still hosted + recorded.
  const h = harness()
  const finalize = makeTrainingFinalizer({ ...h, newId: () => 'lora-1' })
  const exitus = await finalize(actum({ jobId: 'stationthis_klein4b' }), completed(60))

  assert.equal(exitus.loraId, 'lora-1')
  assert.equal(h.puts.length, 1)             // weights hosted regardless
  const i = h.upserts[0]
  assert.equal(i.slug, 'stationthis-klein4b')
  assert.equal(i.nomen, 'stationthis_klein4b')
  assert.equal(i.trigger, undefined)         // omitted, not empty-string
  assert.equal(i.familia, undefined)         // omitted — no aditus familia/baseModel
  assert.equal(i.ownerAnimaId, undefined)
  assert.equal(i.access, 'private')
})

test('urlLoraReader (remote path): fetches the pod-uploaded LoRA, re-hosts it, registers the Intella', async () => {
  const fetched: string[] = []
  const fetcher: MediaFetcher = { async fetch(url) { fetched.push(url); return Buffer.from(`bytes:${url}`) } }
  const h = harness()
  const finalize = makeTrainingFinalizer({ ...h, reader: urlLoraReader(fetcher), newId: () => 'lora-r' })

  const podUrl = 'https://pod-bucket/outputs/run-9/milady.safetensors?sig=abc'
  const exitus = await finalize(
    actum({ triggerWord: 'milady', familia: 'flux', ownerAnimaId: 'anima-2' }),
    { status: 'completed', lastStep: 800, outputUrl: podUrl },
  )

  assert.deepEqual(fetched, [podUrl])                                   // pulled from the pod's R2 URL
  assert.equal(h.puts[0].key, 'models/lora-r/milady.safetensors')      // re-hosted to OUR durable key
  assert.deepEqual(h.puts[0].bytes, Buffer.from(`bytes:${podUrl}`))
  assert.equal(exitus.trained, true)
  assert.equal(exitus.steps, 800)
  assert.equal(exitus.loraId, 'lora-r')
  assert.equal(exitus.loraUrl, 'https://cdn/models/lora-r/milady.safetensors')
  assert.equal(h.upserts[0].familia, 'flux')
  assert.equal(h.upserts[0].ownerAnimaId, 'anima-2')
})

test('urlLoraReader throws when the remote outcome carries no outputUrl', async () => {
  const fetcher: MediaFetcher = { async fetch() { return Buffer.from('x') } }
  await assert.rejects(() => urlLoraReader(fetcher)('job', { status: 'completed', lastStep: 1 }), /no outputUrl/)
})

test('a kontext base stamps familia "kontext" — its own compat key, not the flux stack it sits on', async () => {
  const h = harness()
  const finalize = makeTrainingFinalizer({ ...h, newId: () => 'l-kontext', now: () => new Date(0) })
  await finalize(actum({ triggerWord: 'edit', baseModel: 'flux-kontext-dev', ownerAnimaId: 'a' }), completed())
  // `Intella.familia` says what the LoRA IS; which studios TAKE it is the substrate's directed
  // `acceptsFamiliae` declaration. Stamping 'flux' here would offer it in every flux studio.
  assert.equal(h.upserts[0].familia, 'kontext')
})

test('an explicitly-supplied familia is canonicalised, not written through as an alias', async () => {
  const h = harness()
  const finalize = makeTrainingFinalizer({ ...h, newId: () => 'l-alias', now: () => new Date(0) })
  await finalize(actum({ triggerWord: 'x', familia: ' Krea-Turbo ', baseModel: 'krea2-raw', ownerAnimaId: 'a' }), completed())
  // triggerMap matches familia by EXACT equality, so an alias reaching the field is unresolvable.
  assert.equal(h.upserts[0].familia, 'krea2')
})

test('an explicit familia still WINS over the baseModel, and an already-canonical one is unchanged', async () => {
  const h = harness()
  const finalize = makeTrainingFinalizer({ ...h, newId: () => 'l-explicit', now: () => new Date(0) })
  await finalize(actum({ triggerWord: 'x', familia: 'kontext', baseModel: 'klein-4b', ownerAnimaId: 'a' }), completed())
  assert.equal(h.upserts[0].familia, 'kontext', 'canonicalisation is idempotent and does not override the choice')
})
