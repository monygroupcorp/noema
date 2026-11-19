import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { isCivitaiUrl, civitaiAwareFetcher, CivitaiDownloadError } from '../../../src/crystal/civitaiAuth.js'
import type { MediaFetcher } from '../../../src/crystal/MediaFetcher.js'

// =============================================================================
// civitaiAuth — attaches CIVITAI_API_TOKEN as a Bearer header to a civitai.com
// request only, drops it on any redirect off that host, and turns a 401/403
// into a typed error that says whether a token was even attached. No network —
// `fetchFn` is injected.
// =============================================================================

interface Call { url: string; headers: Record<string, string> }

/** A fake `fetch` whose responses are scripted by host — records every call's headers. */
function fakeFetch(byUrl: Record<string, { status: number; headers?: Record<string, string>; body?: string }>) {
  const calls: Call[] = []
  const fn = (async (url: string, init?: RequestInit) => {
    const headers = Object.fromEntries(new Headers(init?.headers).entries())
    calls.push({ url, headers })
    const script = byUrl[url]
    if (!script) throw new Error(`fakeFetch: no script for ${url}`)
    return new Response(script.body ?? 'bytes', { status: script.status, headers: script.headers })
  }) as typeof fetch
  return { fn, calls }
}

function noStreamBase(): MediaFetcher {
  return { async fetch() { throw new Error('base.fetch should not be called for a civitai URL') } }
}

test('isCivitaiUrl: matches civitai.com and its subdomains only', () => {
  assert.equal(isCivitaiUrl('https://civitai.com/api/download/models/1'), true)
  assert.equal(isCivitaiUrl('https://image.civitai.com/x.png'), true)
  assert.equal(isCivitaiUrl('https://notcivitai.com/x'), false)
  assert.equal(isCivitaiUrl('https://huggingface.co/x'), false)
  assert.equal(isCivitaiUrl('not a url'), false)
})

test('fetch: attaches our Bearer token only to the civitai.com request', async () => {
  const { fn, calls } = fakeFetch({
    'https://civitai.com/api/download/models/1': { status: 200, body: 'weights' },
  })
  const fetcher = civitaiAwareFetcher(noStreamBase(), 'tok-123', fn)
  const bytes = await fetcher.fetch('https://civitai.com/api/download/models/1')
  assert.equal(bytes.toString(), 'weights')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].headers.authorization, 'Bearer tok-123')
})

test('fetch: a non-civitai URL passes through to the base fetcher untouched', async () => {
  let basedCalled: string | undefined
  const base: MediaFetcher = { async fetch(url) { basedCalled = url; return Buffer.from('from-base') } }
  const { fn, calls } = fakeFetch({})
  const fetcher = civitaiAwareFetcher(base, 'tok-123', fn)
  const bytes = await fetcher.fetch('https://huggingface.co/repo/resolve/main/x.safetensors')
  assert.equal(bytes.toString(), 'from-base')
  assert.equal(basedCalled, 'https://huggingface.co/repo/resolve/main/x.safetensors')
  assert.equal(calls.length, 0, 'the injected civitai fetchFn is never touched for a non-civitai host')
})

test('fetch: no token configured → no Authorization header is sent', async () => {
  const { fn, calls } = fakeFetch({
    'https://civitai.com/api/download/models/1': { status: 200, body: 'weights' },
  })
  const fetcher = civitaiAwareFetcher(noStreamBase(), undefined, fn)
  await fetcher.fetch('https://civitai.com/api/download/models/1')
  assert.equal(calls[0].headers.authorization, undefined)
})

test('fetch: follows a redirect and DROPS the Authorization header once off civitai.com', async () => {
  const { fn, calls } = fakeFetch({
    'https://civitai.com/api/download/models/1': {
      status: 302,
      headers: { location: 'https://cdn.example.com/signed/weights.safetensors' },
    },
    'https://cdn.example.com/signed/weights.safetensors': { status: 200, body: 'weights' },
  })
  const fetcher = civitaiAwareFetcher(noStreamBase(), 'tok-123', fn)
  const bytes = await fetcher.fetch('https://civitai.com/api/download/models/1')
  assert.equal(bytes.toString(), 'weights')
  assert.equal(calls.length, 2)
  assert.equal(calls[0].headers.authorization, 'Bearer tok-123', 'the first hop (civitai itself) carries the token')
  assert.equal(calls[1].headers.authorization, undefined, 'the redirect target (a different host) never sees our token')
})

test('fetch: civitai 401 with no token configured → CivitaiDownloadError naming the missing token', async () => {
  const { fn } = fakeFetch({ 'https://civitai.com/api/download/models/1': { status: 401 } })
  const fetcher = civitaiAwareFetcher(noStreamBase(), undefined, fn)
  await assert.rejects(
    () => fetcher.fetch('https://civitai.com/api/download/models/1'),
    (err: unknown) => {
      assert.ok(err instanceof CivitaiDownloadError)
      assert.equal(err.status, 401)
      assert.match(err.message, /no CIVITAI_API_TOKEN is configured/)
      return true
    },
  )
})

test('fetch: civitai 403 with a token configured → CivitaiDownloadError naming the rejection', async () => {
  const { fn } = fakeFetch({ 'https://civitai.com/api/download/models/1': { status: 403 } })
  const fetcher = civitaiAwareFetcher(noStreamBase(), 'tok-123', fn)
  await assert.rejects(
    () => fetcher.fetch('https://civitai.com/api/download/models/1'),
    (err: unknown) => {
      assert.ok(err instanceof CivitaiDownloadError)
      assert.equal(err.status, 403)
      assert.match(err.message, /rejected our download token/)
      return true
    },
  )
})

test('fetch: the error message never contains the token', async () => {
  const { fn } = fakeFetch({ 'https://civitai.com/api/download/models/1?x=1': { status: 403 } })
  const fetcher = civitaiAwareFetcher(noStreamBase(), 'super-secret-token', fn)
  await assert.rejects(
    () => fetcher.fetch('https://civitai.com/api/download/models/1?x=1'),
    (err: unknown) => {
      assert.ok(err instanceof Error)
      assert.doesNotMatch(err.message, /super-secret-token/)
      return true
    },
  )
})

test('fetchStream: present only when the base fetcher supports streaming', () => {
  const withoutStream = civitaiAwareFetcher(noStreamBase(), 'tok', fakeFetch({}).fn)
  assert.equal(withoutStream.fetchStream, undefined, 'a caller branching on fetchStream truthiness must see the SAME capability as base')

  const streamingBase: MediaFetcher = {
    async fetch() { return Buffer.from('x') },
    async fetchStream() { return { body: Readable.from([Buffer.from('x')]) } },
  }
  const withStream = civitaiAwareFetcher(streamingBase, 'tok', fakeFetch({}).fn)
  assert.equal(typeof withStream.fetchStream, 'function')
})

test('fetchStream: attaches our Bearer token to a civitai.com stream request and reads the body', async () => {
  const { fn, calls } = fakeFetch({
    'https://civitai.com/api/download/models/1': { status: 200, body: 'stream-bytes' },
  })
  const streamingBase: MediaFetcher = {
    async fetch() { throw new Error('should not buffer-fetch') },
    async fetchStream() { throw new Error('base.fetchStream should not be called for a civitai URL') },
  }
  const fetcher = civitaiAwareFetcher(streamingBase, 'tok-123', fn)
  const { body } = await fetcher.fetchStream!('https://civitai.com/api/download/models/1')
  const chunks: Buffer[] = []
  for await (const chunk of body) chunks.push(chunk as Buffer)
  assert.equal(Buffer.concat(chunks).toString(), 'stream-bytes')
  assert.equal(calls[0].headers.authorization, 'Bearer tok-123')
})
