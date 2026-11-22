import { test, before, after, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { subscribeActivity, getActivitySnapshot } from '../../../src/platforms/web/app/src/lib/api/activity.js'

// The shared activity poll (api/activity.ts) backs /status's two bands and the rail's badge.
// Its snapshot carries `loaded` so a caller can tell "not fetched yet" from "fetched, zero
// rows" — but a failed FIRST fetch used to leave `loaded` false forever, since the catch kept
// silently waiting for the next tick. /status read that as "Loading your activity…" for as
// long as the tab stayed open on a server that had already answered, badly (D-62). The fix
// marks the first failure as its own resolved state (`loaded: true, error: true`) rather than
// leaving the caller waiting on a read that already came back.

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

let unsubscribe: (() => void) | null = null
afterEach(() => { unsubscribe?.(); unsubscribe = null })

test('a first fetch that fails still resolves loaded, as a distinct error state', async () => {
  globalThis.fetch = (async () => { throw new Error('network down') }) as typeof fetch
  await new Promise<void>((resolve) => {
    unsubscribe = subscribeActivity(() => {
      const snap = getActivitySnapshot()
      if (snap.loaded) resolve()
    })
  })
  const snap = getActivitySnapshot()
  assert.equal(snap.loaded, true)
  assert.equal(snap.error, true)
  assert.deepEqual(snap.rows, [])
})
