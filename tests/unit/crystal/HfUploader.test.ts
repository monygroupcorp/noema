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

test('renderModelCard: includes the name and trigger', () => {
  const card = renderModelCard(MODEL)
  assert.match(card, /# My LoRA/)
  assert.match(card, /mld/)
})
