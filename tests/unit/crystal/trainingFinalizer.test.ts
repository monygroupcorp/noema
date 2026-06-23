// Slice B — training finality: a completed run hosts its LoRA in R2 + registers it as a
// private Intella, returning the exitus ids. Driven with a fake reader/store/writer — no
// filesystem, no R2, no Mongo.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeTrainingFinalizer, urlLoraReader } from '../../../src/crystal/trainingFinalizer.js'
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

  // exitus carries the ids the receipt + modus contract surface.
  assert.deepEqual(exitus, { trained: true, steps: 600, loraId: 'lora-xyz', loraUrl: 'https://cdn/models/lora-xyz/milady.safetensors' })

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
  assert.deepEqual(exitus, { trained: true, steps: 800, loraId: 'lora-r', loraUrl: 'https://cdn/models/lora-r/milady.safetensors' })
  assert.equal(h.upserts[0].familia, 'flux')
  assert.equal(h.upserts[0].ownerAnimaId, 'anima-2')
})

test('urlLoraReader throws when the remote outcome carries no outputUrl', async () => {
  const fetcher: MediaFetcher = { async fetch() { return Buffer.from('x') } }
  await assert.rejects(() => urlLoraReader(fetcher)('job', { status: 'completed', lastStep: 1 }), /no outputUrl/)
})
