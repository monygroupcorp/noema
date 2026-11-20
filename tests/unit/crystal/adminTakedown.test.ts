// adminRetractAllEditions — the admin abuse-takedown seam (minimax-h3-violation-takedown):
// a confirmed abuse-report violation pulls down every LIVE, non-private publication of the
// reported run's output, across every destination, not just the author's own. Unlike
// `retractEdition` this is NOT author-scoped (the caller filing the report is a stranger, not
// the publisher) and NOT single-editio (it sweeps `listByArtifact`).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { CrystalApi, type CrystalApiDeps } from '../../../src/allocutio/api/CrystalApi.js'
import { FeedAdapter } from '../../../src/crystal/FeedAdapter.js'
import { BucketAdapter } from '../../../src/crystal/BucketAdapter.js'
import { MintAdapter } from '../../../src/crystal/MintAdapter.js'
import type { ObjectStore } from '../../../src/crystal/R2Uploader.js'
import type { MediaFetcher } from '../../../src/crystal/MediaFetcher.js'
import type { Editio, Editiones, Editionum, ArtifactRef, FeedFilter } from '../../../src/types/editio.js'

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
    return [...this.store.values()].filter((e) => e.status === 'published' && e.visibility === vis)
  }
  async listHeld(): Promise<Editiones> { return [] }
  async create(input: Omit<Editio, 'id' | 'natum' | 'mutatum' | 'status'>) {
    const now = new Date()
    const e: Editio = { ...input, id: randomUUID(), status: 'pending', natum: now, mutatum: now }
    this.store.set(e.id, e)
    return e
  }
  async update(id: string, patch: Partial<Editio>) {
    const e = { ...this.store.get(id)!, ...patch, mutatum: new Date() }
    this.store.set(id, e)
    return e
  }
  async claimPending(): Promise<Editio | null> { return null }
  // Test seam: directly seed a settled Editio (bypassing publish()'s moderation/worker path —
  // this suite is about retraction, not publishing).
  seed(e: Omit<Editio, 'id' | 'natum' | 'mutatum'>): Editio {
    const now = new Date()
    const full: Editio = { ...e, id: randomUUID(), natum: now, mutatum: now }
    this.store.set(full.id, full)
    return full
  }
}

const ADMIN = { animaId: 'platform' }
const STRANGER = { animaId: 'some-reporter' }
const RUN = 'act-reported'
const REF: ArtifactRef = { kind: 'actum', id: RUN }

function makeApi() {
  const editiones = new MemEditionum()
  const puts: Array<{ key: string }> = []
  const dels: string[] = []
  const store: ObjectStore = {
    put: async (key: string, _bytes: Buffer, _contentType: string) => { puts.push({ key }); return `https://cdn/${key}` },
    del: async (key: string) => { dels.push(key) },
  }
  const fetcher: MediaFetcher = { fetch: async () => Buffer.from('x') }
  const api = new CrystalApi({
    editiones,
    publicationAdapters: [
      new FeedAdapter(),
      new BucketAdapter({ fetcher, store }),
      new MintAdapter(),
    ],
  } as unknown as CrystalApiDeps)
  return { api, editiones, dels }
}

test('adminRetractAllEditions: platform-admin only — a stranger is refused and nothing is retracted', async () => {
  const { api, editiones } = makeApi()
  const ed = editiones.seed({ artifactRef: REF, destination: 'feed', visibility: 'feed', custody: 'ours', by: { animaId: 'publisher' }, status: 'published', externalRef: 'feed:1' })
  await assert.rejects(() => api.adminRetractAllEditions(STRANGER, REF), /platform administrator/)
  assert.equal((await editiones.find(ed.id))?.status, 'published', 'untouched by the refused call')
})

test('adminRetractAllEditions: retracts every live, non-private publication across destinations', async () => {
  const { api, editiones, dels } = makeApi()
  const feedEd = editiones.seed({ artifactRef: REF, destination: 'feed', visibility: 'feed', custody: 'ours', by: { animaId: 'publisher' }, status: 'published', externalRef: 'feed:1' })
  let bucketEd = editiones.seed({ artifactRef: REF, destination: 'r2', visibility: 'unlisted', custody: 'ours', by: { animaId: 'publisher' }, status: 'published', externalRef: 'placeholder' })
  // BucketAdapter's retract recomputes the object key from `externalRef` under its `editiones/`
  // prefix — key it by the editio's OWN id, the same convention `publish()` uses.
  bucketEd = await editiones.update(bucketEd.id, { externalRef: `https://cdn/editiones/${bucketEd.id}.png` })

  const result = await api.adminRetractAllEditions(ADMIN, REF)

  assert.deepEqual(result.skipped, [])
  assert.deepEqual(result.retracted.sort(), [bucketEd.id, feedEd.id].sort())
  assert.equal((await editiones.find(feedEd.id))?.status, 'retracted')
  assert.equal((await editiones.find(bucketEd.id))?.status, 'retracted')
  assert.deepEqual(dels, [`editiones/${bucketEd.id}.png`], 'the hosted bytes were deleted, not just the record flipped')
})

test('adminRetractAllEditions: a private-visibility editio is left alone — it was never public access', async () => {
  const { api, editiones } = makeApi()
  const privateEd = editiones.seed({ artifactRef: REF, destination: 'r2', visibility: 'private', custody: 'ours', by: { animaId: 'publisher' }, status: 'published', externalRef: 'https://cdn/x.png' })

  const result = await api.adminRetractAllEditions(ADMIN, REF)

  assert.deepEqual(result.retracted, [])
  assert.equal((await editiones.find(privateEd.id))?.status, 'published', 'private editions are owner-only — not this takedown\'s target')
})

test('adminRetractAllEditions: a permanent mint is reported in `skipped`, not thrown, and the rest still retracts', async () => {
  const { api, editiones } = makeApi()
  const mintEd = editiones.seed({ artifactRef: REF, destination: 'mint', visibility: 'marketplace', custody: 'ours', by: { animaId: 'publisher' }, status: 'published', externalRef: 'token:1' })
  const feedEd = editiones.seed({ artifactRef: REF, destination: 'feed', visibility: 'feed', custody: 'ours', by: { animaId: 'publisher' }, status: 'published', externalRef: 'feed:1' })

  const result = await api.adminRetractAllEditions(ADMIN, REF)

  assert.deepEqual(result.retracted, [feedEd.id])
  assert.deepEqual(result.skipped, [{ id: mintEd.id, destination: 'mint', reason: 'permanent' }])
  assert.equal((await editiones.find(mintEd.id))?.status, 'published', 'a permanent mint stays live — this is what the admin is told, not hidden')
  assert.equal((await editiones.find(feedEd.id))?.status, 'retracted')
})

test('adminRetractAllEditions: already-retracted, pending, rejected and failed editiones are untouched', async () => {
  const { api, editiones } = makeApi()
  const retracted = editiones.seed({ artifactRef: REF, destination: 'feed', visibility: 'feed', custody: 'ours', by: { animaId: 'p' }, status: 'retracted', externalRef: 'feed:1' })
  const pending = editiones.seed({ artifactRef: REF, destination: 'feed', visibility: 'feed', custody: 'ours', by: { animaId: 'p' } , status: 'pending' })
  const rejected = editiones.seed({ artifactRef: REF, destination: 'feed', visibility: 'feed', custody: 'ours', by: { animaId: 'p' }, status: 'rejected' })
  const failed = editiones.seed({ artifactRef: REF, destination: 'feed', visibility: 'feed', custody: 'ours', by: { animaId: 'p' }, status: 'failed' })

  const result = await api.adminRetractAllEditions(ADMIN, REF)

  assert.deepEqual(result.retracted, [])
  assert.deepEqual(result.skipped, [])
  for (const e of [retracted, pending, rejected, failed]) {
    assert.equal((await editiones.find(e.id))?.status, e.status, `${e.id} must not change`)
  }
})

test('adminRetractAllEditions: only the named artifact\'s editiones are touched', async () => {
  const { api, editiones } = makeApi()
  const theirs = editiones.seed({ artifactRef: { kind: 'actum', id: 'some-other-run' }, destination: 'feed', visibility: 'feed', custody: 'ours', by: { animaId: 'p' }, status: 'published', externalRef: 'feed:9' })

  const result = await api.adminRetractAllEditions(ADMIN, REF)

  assert.deepEqual(result.retracted, [])
  assert.equal((await editiones.find(theirs.id))?.status, 'published')
})
