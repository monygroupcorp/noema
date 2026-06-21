import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { CrystalApi, type CrystalApiDeps } from '../../../src/allocutio/api/CrystalApi.js'
import { FeedAdapter } from '../../../src/crystal/FeedAdapter.js'
import { BucketAdapter } from '../../../src/crystal/BucketAdapter.js'
import type { ObjectStore } from '../../../src/crystal/R2Uploader.js'
import type { MediaFetcher } from '../../../src/crystal/MediaFetcher.js'
import type { ModerationGate } from '../../../src/crystal/ModerationGate.js'
import type { Editio, Editiones, Editionum, ArtifactRef, FeedFilter } from '../../../src/types/editio.js'

// =============================================================================
// Publishing spine — CrystalApi.publish() puts an Actum forth to the feed via
// the FeedAdapter, gated by an async moderation pass (pending → published).
// =============================================================================

/** In-memory Editionum for the test. */
class MemEditionum implements Editionum {
  store = new Map<string, Editio>()
  async find(id: string) { return this.store.get(id) ?? null }
  async listByArtifact(ref: ArtifactRef): Promise<Editiones> {
    return [...this.store.values()].filter((e) => e.artifactRef.kind === ref.kind && e.artifactRef.id === ref.id)
  }
  async listByAuthor(by: Editio['by']): Promise<Editiones> {
    return [...this.store.values()].filter((e) =>
      'animaId' in by ? 'animaId' in e.by && e.by.animaId === by.animaId
                      : 'commitment' in e.by && e.by.commitment === by.commitment)
  }
  async listFeed(filter?: FeedFilter): Promise<Editiones> {
    const vis = filter?.visibility ?? 'feed'
    let all = [...this.store.values()].filter((e) => e.status === 'published' && e.visibility === vis)
    if (filter?.destination !== undefined) all = all.filter((e) => e.destination === filter.destination)
    all.sort((a, b) => b.natum.getTime() - a.natum.getTime())
    if (filter?.limit !== undefined) all = all.slice(0, filter.limit)
    return all
  }
  async create(input: Omit<Editio, 'id' | 'natum' | 'mutatum' | 'status'>) {
    const now = new Date()
    const e: Editio = { ...input, id: randomUUID(), status: 'pending', natum: now, mutatum: now }
    this.store.set(e.id, e)
    return e
  }
  async update(id: string, patch: Partial<Pick<Editio, 'status' | 'externalRef' | 'visibility' | 'custody'>>) {
    const e = { ...this.store.get(id)!, ...patch, mutatum: new Date() }
    this.store.set(id, e)
    return e
  }
}

const OWNED_ACTUM = 'act-owned'

/** Minimal fakes: the caller owns OWNED_ACTUM (it has signa they own). */
function fakeActorum() {
  return {
    findById: async (id: string) =>
      id === OWNED_ACTUM
        ? ({ id, status: 'completus', exitus: { image: 'https://cdn/x.png' }, signaConsumed: ['s1'] } as unknown)
        : null,
  }
}
const fakeSignorum = { ownsAny: async () => true }

function makeApi(opts?: { gate?: ModerationGate; prefs?: Record<string, unknown> }) {
  const editiones = new MemEditionum()
  const tasks: Array<Promise<void>> = []
  const animae = {
    find: async (id: string) => (id === 'anima-1' && opts?.prefs ? ({ id, publicatio: opts.prefs }) : null),
  }
  // A fake R2 object store + fetcher so the BucketAdapter ('r2') is resolvable.
  const puts: Array<{ key: string }> = []
  const dels: string[] = []
  const store: ObjectStore = {
    async put(key) { puts.push({ key }); return `https://cdn/${key}` },
    async del(key) { dels.push(key) },
  }
  const fetcher: MediaFetcher = { async fetch(url) { return Buffer.from(`bytes:${url}`) } }
  const api = new CrystalApi({
    editiones,
    actorum: fakeActorum(),
    signorum: fakeSignorum,
    animae,
    publicationAdapters: [new FeedAdapter(), new BucketAdapter({ fetcher, store })],
    ...(opts?.gate ? { moderationGate: opts.gate } : {}),
    publishScheduler: (fn: () => Promise<void>) => { tasks.push(fn()) },
  } as unknown as CrystalApiDeps)
  return { api, editiones, puts, dels, flush: () => Promise.all(tasks) }
}

const anima1 = { animaId: 'anima-1' }

test('publish(): a feed publish returns pending, then settles to published via the FeedAdapter', async () => {
  const { api, flush } = makeApi()
  const ed = await api.publish(anima1, { artifact: { kind: 'actum', id: OWNED_ACTUM }, destination: 'feed' })

  // Public surface → returned pending, NOT yet published (never synchronous to public).
  assert.equal(ed.status, 'pending')
  assert.equal(ed.visibility, 'feed')
  assert.equal(ed.custody, 'ours')
  assert.equal(ed.externalRef, undefined)

  await flush()
  const feed = await api.feed()
  assert.equal(feed.length, 1)
  assert.equal(feed[0].artifact.id, OWNED_ACTUM)
  assert.deepEqual(feed[0].output, { image: 'https://cdn/x.png' }, 'feed item carries the actum exitus')
})

test('publish(): the moderation gate rejects → status rejected, never reaches the feed', async () => {
  const gate: ModerationGate = { async scan() { return { ok: false, reason: 'nope' } } }
  const { api, editiones, flush } = makeApi({ gate })
  const ed = await api.publish(anima1, { artifact: { kind: 'actum', id: OWNED_ACTUM }, destination: 'feed' })
  await flush()

  const stored = await editiones.find(ed.id)
  assert.equal(stored?.status, 'rejected')
  assert.equal(stored?.externalRef, undefined)
  assert.equal((await api.feed()).length, 0)
})

test('publish(): defaults destination + visibility from the caller Anima prefs', async () => {
  const { api, flush } = makeApi({ prefs: { defaultDestination: 'feed', defaultVisibility: 'feed' } })
  const ed = await api.publish(anima1, { artifact: { kind: 'actum', id: OWNED_ACTUM } })
  assert.equal(ed.destination, 'feed')
  assert.equal(ed.visibility, 'feed')
  await flush()
  assert.equal((await api.feed()).length, 1)
})

test('publish(): a private publish settles synchronously with no moderation gate', async () => {
  const { api } = makeApi()
  const ed = await api.publish(anima1, { artifact: { kind: 'actum', id: OWNED_ACTUM }, destination: 'feed', visibility: 'private' })
  assert.equal(ed.status, 'published', 'private surface publishes inline')
  assert.match(ed.externalRef ?? '', /^feed:/)
  assert.equal((await api.feed()).length, 0, 'private editions never appear in the feed')
})

test('feed(): clamps to public surfaces — a private edition is never enumerable via ?visibility=private', async () => {
  const { api } = makeApi()
  // A published-but-private edition exists in the store.
  await api.publish(anima1, { artifact: { kind: 'actum', id: OWNED_ACTUM }, destination: 'feed', visibility: 'private' })
  // Asking the public feed for private editions must NOT leak it.
  assert.equal((await api.feed({ visibility: 'private' })).length, 0)
  assert.equal((await api.feed({ visibility: 'unlisted' })).length, 0)
})

test('publish(): an unlisted bucket publish hosts the bytes synchronously (no moderation gate)', async () => {
  const { api, editiones, puts } = makeApi()
  const ed = await api.publish(anima1, { artifact: { kind: 'actum', id: OWNED_ACTUM }, destination: 'r2', visibility: 'unlisted' })

  assert.equal(ed.status, 'published', 'unlisted settles inline — never gated')
  assert.equal(ed.custody, 'ours')
  assert.equal(puts.length, 1)
  assert.equal(puts[0].key, `editiones/${ed.id}.png`, 'hosted under the publication id')
  assert.equal((await editiones.find(ed.id))?.externalRef, `https://cdn/editiones/${ed.id}.png`)
  assert.equal((await api.feed()).length, 0, 'unlisted never appears in the public feed')
})

test('retractEdition(): retracting a bucket publish deletes the hosted bytes', async () => {
  const { api, dels } = makeApi()
  const ed = await api.publish(anima1, { artifact: { kind: 'actum', id: OWNED_ACTUM }, destination: 'r2', visibility: 'unlisted' })
  const retracted = await api.retractEdition(anima1, ed.id)
  assert.equal(retracted.status, 'retracted')
  assert.deepEqual(dels, [`editiones/${ed.id}.png`], 'the hosted object was deleted')
})

test('publish(): rejects an artifact the caller does not own', async () => {
  const { api } = makeApi()
  await assert.rejects(
    () => api.publish(anima1, { artifact: { kind: 'actum', id: 'not-mine' } }),
    /not found/i,
  )
})

test('publish(): intella publishing is not yet supported (build-order #3)', async () => {
  const { api } = makeApi()
  await assert.rejects(
    () => api.publish(anima1, { artifact: { kind: 'intella', id: 'lora-1' }, destination: 'feed' }),
    /not yet supported/i,
  )
})

test('retractEdition(): a published feed edition is retracted and leaves the feed', async () => {
  const { api, flush } = makeApi()
  const ed = await api.publish(anima1, { artifact: { kind: 'actum', id: OWNED_ACTUM }, destination: 'feed' })
  await flush()
  assert.equal((await api.feed()).length, 1)

  const retracted = await api.retractEdition(anima1, ed.id)
  assert.equal(retracted.status, 'retracted')
  assert.equal((await api.feed()).length, 0)
})

test('retractEdition(): only the publishing author may retract', async () => {
  const { api, flush } = makeApi()
  const ed = await api.publish(anima1, { artifact: { kind: 'actum', id: OWNED_ACTUM }, destination: 'feed' })
  await flush()
  await assert.rejects(
    () => api.retractEdition({ animaId: 'someone-else' }, ed.id),
    /not found/i,
  )
})
