import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BatchTriage } from '../../../src/crystal/BatchTriage.js'
import type { TriageScore, TriageStore } from '../../../src/types/triage.js'
import type { SexualContentRouter } from '../../../src/crystal/SexualContentRouter.js'
import type { MediaFetcher } from '../../../src/crystal/MediaFetcher.js'

// =============================================================================
// BatchTriage — the offline corpus read (spec §5). Fake router + fetcher +
// in-memory store → fully hermetic. Invariant: it MEASURES (scores into a store
// separate from Editio); it never publishes, never reports.
// =============================================================================

const fetcher: MediaFetcher = { async fetch(url) { return Buffer.from(`bytes:${url}`) } }

/** A router that flags urls by predicate; optional throw set. */
function fakeRouter(sexual: (url: string) => boolean, throwOn = new Set<string>()): SexualContentRouter {
  return {
    async route(item) {
      if (throwOn.has(item.url)) throw new Error('router down')
      const s = sexual(item.url)
      return { sexual: s, confidence: s ? 0.9 : 0.05, ageSignal: 'unknown', source: 'fake' }
    },
  }
}

/** A tiny in-memory TriageStore. */
function memStore(): TriageStore & { all: Map<string, TriageScore> } {
  const all = new Map<string, TriageScore>()
  return {
    all,
    async put(s) { all.set(s.id, s) },
    async getByUrl(url) { return [...all.values()].find((s) => s.url === url) ?? null },
    async listByActum(actumId) { return [...all.values()].filter((s) => s.actumId === actumId) },
    async listFlagged(opts) {
      let out = [...all.values()].filter((s) => s.sexual)
      if (opts?.pendingOnly) out = out.filter((s) => s.reviewOutcome === undefined || s.reviewOutcome === 'pending')
      out.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))
      return opts?.limit !== undefined ? out.slice(0, opts.limit) : out
    },
    async stats() {
      const scanned = all.size
      const flagged = [...all.values()].filter((s) => s.sexual).length
      return { scanned, flagged, flagRate: scanned === 0 ? 0 : flagged / scanned }
    },
  }
}

const clock = () => new Date('2026-07-02T00:00:00.000Z')

test('scores a set of items, flags only the sexual ones, records into the store', async () => {
  const store = memStore()
  const bt = new BatchTriage({ fetcher, router: fakeRouter((u) => u.includes('nsfw')), store, now: clock })
  const summary = await bt.runItems([
    { actumId: 'a1', url: 'https://x/landscape.png' },
    { actumId: 'a1', url: 'https://x/nsfw.png' },
    { actumId: 'a2', url: 'https://x/portrait.png' },
  ])
  assert.deepEqual(summary, { scanned: 3, flagged: 1, skipped: 0, errors: 0, flagRate: 1 / 3 })
  assert.equal(store.all.size, 3)
  const flagged = await store.listFlagged()
  assert.equal(flagged.length, 1)
  assert.equal(flagged[0].url, 'https://x/nsfw.png')
  assert.equal(flagged[0].actumId, 'a1')
  assert.equal(flagged[0].sexual, true)
  assert.equal(flagged[0].scannedAt, '2026-07-02T00:00:00.000Z')
  assert.ok(flagged[0].sha256, 'records the scored-bytes digest')
})

test('resumable: a url already scored is SKIPPED (not re-fetched/re-scored)', async () => {
  const store = memStore()
  let fetches = 0
  const countingFetcher: MediaFetcher = { async fetch(url) { fetches++; return Buffer.from(url) } }
  const bt = new BatchTriage({ fetcher: countingFetcher, router: fakeRouter(() => false), store, now: clock })

  await bt.runItems([{ actumId: 'a1', url: 'https://x/1.png' }])
  assert.equal(fetches, 1)
  const again = await bt.runItems([
    { actumId: 'a1', url: 'https://x/1.png' }, // already scored → skip
    { actumId: 'a1', url: 'https://x/2.png' }, // new → scan
  ])
  assert.equal(again.scanned, 1)
  assert.equal(again.skipped, 1)
  assert.equal(fetches, 2, 'the already-scored url was not fetched again')
})

test('force: re-scores even already-scored urls', async () => {
  const store = memStore()
  const bt = new BatchTriage({ fetcher, router: fakeRouter(() => true), store, now: clock })
  await bt.runItems([{ actumId: 'a1', url: 'https://x/1.png' }])
  const forced = await bt.runItems([{ actumId: 'a1', url: 'https://x/1.png' }], { force: true })
  assert.equal(forced.scanned, 1)
  assert.equal(forced.skipped, 0)
})

test('tolerates gaps: a fetch error and a router error are counted, not fatal', async () => {
  const store = memStore()
  const errFetcher: MediaFetcher = { async fetch(url) { if (url.includes('gone')) throw new Error('404'); return Buffer.from(url) } }
  const bt = new BatchTriage({ fetcher: errFetcher, router: fakeRouter((u) => true, new Set(['https://x/boom.png'])), store, now: clock })
  const summary = await bt.runItems([
    { actumId: 'a1', url: 'https://x/ok.png' },
    { actumId: 'a1', url: 'https://x/gone.png' },  // fetch error
    { actumId: 'a1', url: 'https://x/boom.png' },  // router error
  ])
  assert.equal(summary.scanned, 1)
  assert.equal(summary.errors, 2)
  assert.equal(store.all.size, 1, 'errored items are counted but not recorded')
})

test('stats: the read reports flagged volume + flag-rate over the whole store', async () => {
  const store = memStore()
  const bt = new BatchTriage({ fetcher, router: fakeRouter((u) => u.includes('x')), store, now: clock })
  await bt.runItems([
    { actumId: 'a1', url: 'https://h/xa.png' },
    { actumId: 'a1', url: 'https://h/xb.png' },
    { actumId: 'a2', url: 'https://h/clean.png' },
  ])
  const s = await store.stats()
  assert.equal(s.scanned, 3)
  assert.equal(s.flagged, 2)
  assert.equal(s.flagRate, 2 / 3)
})

test('runActa: enumerates an Actum’s produced media via allMediaUrls', async () => {
  const store = memStore()
  const acta: Record<string, { id: string; exitus: Record<string, unknown> }> = {
    'act-1': { id: 'act-1', exitus: { image: 'https://x/one.png' } },
    'act-2': { id: 'act-2', exitus: { samples: [{ url: 'https://x/two.png' }, { url: 'https://x/three.png' }] } },
  }
  const actorum = { findById: async (id: string) => (acta[id] as unknown as import('../../../src/types/actum.js').Actum) ?? null }
  const bt = new BatchTriage({ fetcher, router: fakeRouter((u) => u.includes('two')), store, actorum, now: clock })
  const summary = await bt.runActa(['act-1', 'act-2', 'act-missing'])
  assert.equal(summary.scanned, 3, 'one + two media urls across the two found acta')
  assert.equal(summary.flagged, 1)
  assert.equal((await store.listByActum('act-2')).length, 2)
})

test('runActa without an actorum throws (it needs one to enumerate media)', async () => {
  const store = memStore()
  const bt = new BatchTriage({ fetcher, router: fakeRouter(() => false), store, now: clock })
  await assert.rejects(() => bt.runActa(['a1']), /requires an actorum/)
})
