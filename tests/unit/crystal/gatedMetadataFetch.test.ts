// B3 — gated-origin metadata scrape: secretJsonFetcher attaches the owner's BYO token by host.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { secretJsonFetcher, importSecretProviderForUrl, type JsonFetcher } from '../../../src/crystal/modelImportResolver.js'

// A spy base fetcher that records the (url, opts) it was called with.
function spyFetcher(): JsonFetcher & { calls: Array<{ url: string; headers?: Record<string, string> }> } {
  const calls: Array<{ url: string; headers?: Record<string, string> }> = []
  return {
    calls,
    async fetchJson(url, opts) {
      calls.push({ url, ...(opts?.headers ? { headers: opts.headers } : {}) })
      return { ok: true }
    },
  }
}

test('importSecretProviderForUrl maps host → provider', () => {
  assert.equal(importSecretProviderForUrl('https://civitai.com/api/v1/models/1'), 'civitai')
  assert.equal(importSecretProviderForUrl('https://huggingface.co/api/models/x'), 'huggingface')
  assert.equal(importSecretProviderForUrl('https://example.com/x.safetensors'), null)
})

test('attaches Authorization: Bearer for a gated Civitai request when a token exists', async () => {
  const base = spyFetcher()
  const fetcher = secretJsonFetcher(base, async (p) => (p === 'civitai' ? 'civ-secret' : null))
  await fetcher.fetchJson('https://civitai.com/api/v1/models/92654')
  assert.equal(base.calls[0].headers?.Authorization, 'Bearer civ-secret')
})

test('attaches the HuggingFace token for an HF request', async () => {
  const base = spyFetcher()
  const fetcher = secretJsonFetcher(base, async (p) => (p === 'huggingface' ? 'hf-secret' : null))
  await fetcher.fetchJson('https://huggingface.co/api/models/foo/bar')
  assert.equal(base.calls[0].headers?.Authorization, 'Bearer hf-secret')
})

test('no token → passthrough with no auth header (auth-free origin still works)', async () => {
  const base = spyFetcher()
  const fetcher = secretJsonFetcher(base, async () => null)
  await fetcher.fetchJson('https://civitai.com/api/v1/models/1')
  assert.equal(base.calls[0].headers, undefined)
})

test('a non-provider host is never asked for a token and carries no auth header', async () => {
  const base = spyFetcher()
  let asked = false
  const fetcher = secretJsonFetcher(base, async () => { asked = true; return 'x' })
  await fetcher.fetchJson('https://example.com/model.safetensors')
  assert.equal(asked, false)
  assert.equal(base.calls[0].headers, undefined)
})
