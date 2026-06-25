import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import { HuggingFaceUploader, renderModelCard, type HfTransport, type LfsFile, type TextFile } from '../../../src/crystal/HfUploader.js'
import type { MediaFetcher } from '../../../src/crystal/MediaFetcher.js'
import type { ModelView, RegistryUploadRequest } from '../../../src/crystal/ModelPublishAdapter.js'

// =============================================================================
// HuggingFaceUploader — orchestration (ensure repo → digest → LFS → commit) over
// an injected HfTransport. The real HF HTTP (HfHttpTransport) is live-unverified
// and not exercised here.
// =============================================================================

const WEIGHTS = Buffer.from('safetensors-bytes-pretend-this-is-2GB')
const OID = createHash('sha256').update(WEIGHTS).digest('hex')

const MODEL: ModelView = {
  nomen: 'My LoRA', genus: 'lora', slug: 'my-lora', trigger: 'mld', familia: 'flux',
  sources: [{ provenance: 'miladystation', uri: 'https://cdn/models/ed-1/my-lora.safetensors' }],
}

/** A fetcher that streams the fixed WEIGHTS buffer. */
function fakeFetcher(): MediaFetcher & { streamed: string[] } {
  const streamed: string[] = []
  return {
    streamed,
    async fetch() { return WEIGHTS },
    async fetchStream(url) { streamed.push(url); return { body: Readable.from([WEIGHTS]) } },
  }
}

/** A transport that records every call and reports a known repo URL. */
function fakeTransport() {
  const calls = { ensureRepo: [] as Array<{ repoId: string; private: boolean }>, uploadLfs: [] as Array<{ oid: string; size: number }>, commit: [] as Array<{ repoId: string; lfsFiles: LfsFile[]; textFiles?: TextFile[] }> }
  const transport: HfTransport = {
    async ensureRepo(a) { calls.ensureRepo.push(a); return { url: `https://huggingface.co/${a.repoId}` } },
    async uploadLfs(a) { calls.uploadLfs.push({ oid: a.oid, size: a.size }); await a.fetchBody() /* drain to mimic the PUT */ },
    async commit(a) { calls.commit.push({ repoId: a.repoId, lfsFiles: a.lfsFiles, textFiles: a.textFiles }) },
  }
  return { transport, calls }
}

const req = (over: Partial<RegistryUploadRequest> = {}): RegistryUploadRequest =>
  ({ account: 'ms2stationthis', slug: 'my-lora', private: false, model: MODEL, ...over })

test('upload: ensures the repo, LFS-uploads the weights, commits, returns the repo URL', async () => {
  const { transport, calls } = fakeTransport()
  const uploader = new HuggingFaceUploader({ transport, fetcher: fakeFetcher() })
  const { externalRef } = await uploader.upload(req())

  assert.equal(externalRef, 'https://huggingface.co/ms2stationthis/my-lora')
  assert.deepEqual(calls.ensureRepo, [{ repoId: 'ms2stationthis/my-lora', private: false }])
  assert.equal(calls.uploadLfs.length, 1)
  assert.equal(calls.commit.length, 1)
})

test('upload: the LFS oid is the sha256 of the streamed bytes and size is the byte length', async () => {
  const { transport, calls } = fakeTransport()
  await new HuggingFaceUploader({ transport, fetcher: fakeFetcher() }).upload(req())
  assert.deepEqual(calls.uploadLfs[0], { oid: OID, size: WEIGHTS.length })
})

test('upload: commit references the LFS pointer + a generated README', async () => {
  const { transport, calls } = fakeTransport()
  await new HuggingFaceUploader({ transport, fetcher: fakeFetcher() }).upload(req())
  const commit = calls.commit[0]
  assert.deepEqual(commit.lfsFiles, [{ pathInRepo: 'my-lora.safetensors', oid: OID, size: WEIGHTS.length }])
  assert.equal(commit.textFiles?.[0].pathInRepo, 'README.md')
  assert.match(commit.textFiles![0].content, /My LoRA/)
})

test('upload: commits sample + dataset images via LFS, with captions/config/README inline', async () => {
  const { transport, calls } = fakeTransport()
  const model: ModelView = {
    ...MODEL,
    samples: [{ url: 'https://cdn/s0.jpg', pathInRepo: 'samples/sample_000.jpg', prompt: 'mld, a portrait' }],
    datasetItems: [{ url: 'https://cdn/d0.png', caption: 'a thing' }, { url: 'https://cdn/d1.webp' }],
    configYaml: 'job: extension\n',
  }
  await new HuggingFaceUploader({ transport, fetcher: fakeFetcher() }).upload(req({ model }))

  const commit = calls.commit[0]
  // weights + every image go via LFS, in order
  assert.deepEqual(commit.lfsFiles.map((f) => f.pathInRepo),
    ['my-lora.safetensors', 'samples/sample_000.jpg', 'dataset/0000.png', 'dataset/0001.webp'])
  // captions (only the one with a caption) + config + README go inline
  assert.deepEqual((commit.textFiles ?? []).map((f) => f.pathInRepo),
    ['dataset/0000.txt', 'config.yaml', 'README.md'])
  const readme = commit.textFiles!.find((f) => f.pathInRepo === 'README.md')!.content
  assert.match(readme, /## Sample Outputs/)
  assert.match(readme, /## Reproduction/)
})

test('upload: streams the source twice (digest pass + PUT pass), never buffering', async () => {
  const fetcher = fakeFetcher()
  const { transport } = fakeTransport()
  await new HuggingFaceUploader({ transport, fetcher }).upload(req())
  assert.equal(fetcher.streamed.length, 2, 'one stream for the digest, one for the upload PUT')
})

test('upload: threads the private flag and the BYO account into the repo id', async () => {
  const { transport, calls } = fakeTransport()
  await new HuggingFaceUploader({ transport, fetcher: fakeFetcher() }).upload(req({ account: 'alice', private: true }))
  assert.deepEqual(calls.ensureRepo, [{ repoId: 'alice/my-lora', private: true }])
})

test('upload: a model with no weight source throws', async () => {
  const { transport } = fakeTransport()
  const uploader = new HuggingFaceUploader({ transport, fetcher: fakeFetcher() })
  await assert.rejects(() => uploader.upload(req({ model: { ...MODEL, sources: [] } })), /no weight source/)
})

test('renderModelCard: frontmatter + body, name and trigger', () => {
  const card = renderModelCard(MODEL)
  assert.match(card, /^---\n/)                                  // YAML frontmatter
  assert.match(card, /# My LoRA/)
  assert.match(card, /instance_prompt: "mld"/)                  // quoted so numeric-looking triggers stay strings
  assert.match(card, /\*\*Trigger word:\*\* `mld`/)
  assert.match(card, /## Usage \(Diffusers\)/)
  assert.match(card, /## Training Details/)
})

test('renderModelCard: klein familia derives klein base facts + Flux2Pipeline + apache-2.0', () => {
  const card = renderModelCard({ ...MODEL, familia: 'flux2-klein', trainingSteps: 4000 }, 'ms2stationthis/my-lora-klein')
  assert.match(card, /license: apache-2.0/)
  assert.match(card, /base_model: black-forest-labs\/FLUX\.2-klein-base-4B/)
  assert.match(card, /training_steps: 4000/)
  assert.match(card, /from diffusers import Flux2Pipeline/)
  assert.match(card, /load_lora_weights\("ms2stationthis\/my-lora-klein"\)/)
  assert.match(card, /\*\*Steps:\*\* 4000/)
})

test('renderModelCard: provenance backlink + sample gallery when present', () => {
  const card = renderModelCard({
    ...MODEL, familia: 'flux2-klein',
    provenance: { repo: 'ms2stationthis/drifella', base: 'FLUX.1-dev' },
    samples: [{ url: 'https://cdn/s0.jpg', pathInRepo: 'samples/sample_000.jpg', prompt: 'mld, a portrait' }],
  })
  assert.match(card, /Retrained onto FLUX\.2 \[klein\] 4B from \[ms2stationthis\/drifella\]/)
  assert.match(card, /## Sample Outputs/)
  assert.match(card, /!\[sample\]\(samples\/sample_000\.jpg\)/)
  // widget frontmatter → HF preview thumbnail
  assert.match(card, /widget:\n- text: "mld, a portrait"\n {2}output:\n {4}url: samples\/sample_000\.jpg/)
})

test('renderModelCard: a long multi-line dataset caption is one-lined + clipped in the grid (and widget)', () => {
  const long = 'mld, ' + 'This is a photograph with a grainy filter.\n\nThe subject faces right | pipe.'.repeat(4)
  const card = renderModelCard({ ...MODEL, familia: 'flux2-klein',
    samples: [{ url: 'https://cdn/s0.jpg', pathInRepo: 'samples/sample_000.jpg', prompt: long }] })
  const galleryLine = card.split('\n').find(l => l.includes('*mld'))!
  const caption = galleryLine.match(/\*(.+)\*/)![1]                     // the italic caption text in the cell
  assert.ok(galleryLine.length < 140 && caption.endsWith('…'))          // single line, clipped + truncated
  assert.ok(!caption.includes('|'))                                     // inner pipes escaped → table not broken
})

test('renderModelCard: unknown familia falls back to FLUX.1 [dev] facts', () => {
  const card = renderModelCard({ ...MODEL, familia: undefined })
  assert.match(card, /base_model: black-forest-labs\/FLUX\.1-dev/)
  assert.match(card, /from diffusers import FluxPipeline/)
})
