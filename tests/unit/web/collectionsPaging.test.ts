import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { listAllCollections } from '../../../src/platforms/web/app/src/lib/api.js'

// `GET /v1/collectiones` is paged, and the two screens that list collections want the whole
// set. `listAllCollections` is the walk that reconciles those, so what it must never do is
// stop early on a full store — or spin forever on a server that keeps handing back a cursor.

const store = new Map<string, string>()
const fakeLocalStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, String(v)) },
  removeItem: (k: string) => { store.delete(k) },
  clear: () => { store.clear() },
  key: () => null,
  length: 0,
}

const realFetch = globalThis.fetch
const realLocal = (globalThis as { localStorage?: unknown }).localStorage
const realCrypto = globalThis.crypto

before(() => {
  ;(globalThis as { localStorage?: unknown }).localStorage = fakeLocalStorage
  if (!realCrypto) (globalThis as { crypto?: unknown }).crypto = { getRandomValues: (b: Uint8Array) => b }
})
after(() => {
  globalThis.fetch = realFetch
  ;(globalThis as { localStorage?: unknown }).localStorage = realLocal
  ;(globalThis as { crypto?: unknown }).crypto = realCrypto
})


/** Serves a fixed script of pages and records the URL each request asked for. */
function serve(pages: Array<{ collections: Array<{ id: string }>; nextCursor?: string }>): string[] {
  const urls: string[] = []
  let i = 0
  globalThis.fetch = (async (url: unknown) => {
    urls.push(String(url))
    const body = pages[Math.min(i++, pages.length - 1)]
    return { ok: true, status: 200, json: async () => body } as unknown as Response
  }) as typeof fetch
  return urls
}

test('listAllCollections walks every page and keeps the store order', async () => {
  const urls = serve([
    { collections: [{ id: 'c3' }, { id: 'c2' }], nextCursor: 'cur-1' },
    { collections: [{ id: 'c1' }] },
  ])
  const all = await listAllCollections()
  assert.deepEqual(all.map((c) => c.id), ['c3', 'c2', 'c1'])
  assert.equal(urls.length, 2)
  assert.ok(!urls[0]!.includes('cursor='), 'the first page asks for no cursor')
  assert.ok(urls[1]!.includes('cursor=cur-1'), 'the second page carries the first page\'s cursor')
})

test('listAllCollections stops when the server repeats a cursor', async () => {
  // A server that answers every request with the same cursor would otherwise spin this forever.
  const urls = serve([{ collections: [{ id: 'c1' }], nextCursor: 'same' }])
  const all = await listAllCollections()
  assert.deepEqual(all.map((c) => c.id), ['c1', 'c1'])
  assert.equal(urls.length, 2, 'the repeated cursor is followed once, then the walk ends')
})

test('listAllCollections stops on an empty page that still carries a cursor', async () => {
  const urls = serve([{ collections: [], nextCursor: 'cur-1' }])
  assert.deepEqual(await listAllCollections(), [])
  assert.equal(urls.length, 1)
})
