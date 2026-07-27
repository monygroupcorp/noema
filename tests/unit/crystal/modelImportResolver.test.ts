// modelImportResolver: origin nsfw-signal capture (noema-090). Civitai's model-level `nsfw`/
// `nsfwLevel` must be preserved raw/unmapped into `origin.meta` — not dropped, not translated
// into `IntellaContentRating`. Hermetic: a fake JsonFetcher over fixture Civitai payloads.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveImport } from '../../../src/crystal/modelImportResolver.js'
import type { JsonFetcher } from '../../../src/crystal/modelImportResolver.js'

function civitaiFixture(extra: Record<string, unknown> = {}) {
  return {
    id: 12345,
    name: 'Test Checkpoint',
    type: 'Checkpoint',
    creator: { username: 'someartist' },
    modelVersions: [
      {
        id: 999,
        name: 'v1.0',
        baseModel: 'SD 1.5',
        files: [{ name: 'test-checkpoint.safetensors', downloadUrl: 'https://civitai.com/api/download/models/999' }],
      },
    ],
    ...extra,
  }
}

const jsonOf = (payload: unknown): JsonFetcher => ({ async fetchJson() { return payload } })

test('resolveImport (Civitai): captures raw nsfw/nsfwLevel into origin.meta, unmapped', async () => {
  const fixture = civitaiFixture({ nsfw: true, nsfwLevel: 4 })
  const resolved = await resolveImport('https://civitai.com/models/12345', { json: jsonOf(fixture) })
  assert.equal(resolved.origin.meta?.originNsfw, true)
  assert.equal(resolved.origin.meta?.originNsfwLevel, 4)
})

test('resolveImport (Civitai): no nsfw/nsfwLevel on origin → no originNsfw/originNsfwLevel keys (no undefined leaking)', async () => {
  const fixture = civitaiFixture()
  const resolved = await resolveImport('https://civitai.com/models/12345', { json: jsonOf(fixture) })
  assert.equal('originNsfw' in (resolved.origin.meta ?? {}), false)
  assert.equal('originNsfwLevel' in (resolved.origin.meta ?? {}), false)
})
