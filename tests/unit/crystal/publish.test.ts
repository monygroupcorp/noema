import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { CrystalApi, type CrystalApiDeps } from '../../../src/allocutio/api/CrystalApi.js'
import { PublicationWorker } from '../../../src/crystal/PublicationWorker.js'
import { FeedAdapter } from '../../../src/crystal/FeedAdapter.js'
import { BucketAdapter } from '../../../src/crystal/BucketAdapter.js'
import { ModelPublishAdapter, huggingFaceRegistry, civitaiRegistry } from '../../../src/crystal/ModelPublishAdapter.js'
import { MintAdapter, MarketplaceAdapter } from '../../../src/crystal/MintAdapter.js'
import type { ObjectStore } from '../../../src/crystal/R2Uploader.js'
import type { Collectio } from '../../../src/types/collectio.js'
import type { MediaFetcher } from '../../../src/crystal/MediaFetcher.js'
import { type ModerationGate, permissiveModerationGate } from '../../../src/crystal/ModerationGate.js'
import type { Intella } from '../../../src/types/intelligendi.js'
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
  async listHeld(by?: Editio['by']): Promise<Editiones> {
    return [...this.store.values()].filter((e) =>
      e.reviewOutcome === 'pending' && (by === undefined ||
        ('animaId' in by ? 'animaId' in e.by && e.by.animaId === by.animaId
                         : 'commitment' in e.by && e.by.commitment === by.commitment)))
  }
  async update(id: string, patch: Partial<Pick<Editio, 'status' | 'externalRef' | 'visibility' | 'custody' | 'reviewOutcome' | 'leasedUntil'>>) {
    const e = { ...this.store.get(id)!, ...patch, mutatum: new Date() }
    this.store.set(id, e)
    return e
  }
  async claimPending(now: Date, leaseMs: number): Promise<Editio | null> {
    const claimable = [...this.store.values()]
      .filter((e) => e.status === 'pending' && e.reviewOutcome !== 'pending' && (!e.leasedUntil || e.leasedUntil.getTime() <= now.getTime()))
      .sort((a, b) => a.natum.getTime() - b.natum.getTime())[0]
    if (!claimable) return null
    const updated: Editio = { ...claimable, leasedUntil: new Date(now.getTime() + leaseMs), attempts: (claimable.attempts ?? 0) + 1, mutatum: new Date() }
    this.store.set(updated.id, updated)
    return updated
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

// gate defaults to an approving scanner (the configured go-live posture); pass an
// explicit gate to test a verdict, or noGate:true to exercise CrystalApi's fail-closed default.
function makeApi(opts?: { gate?: ModerationGate; noGate?: boolean; prefs?: Record<string, unknown>; verdictCache?: unknown; scanFeeCharger?: unknown; csamReviewReporter?: unknown }) {
  const editiones = new MemEditionum()
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
  // A fake Intella store: one model the caller (anima-1) owns + a setAccess spy.
  const models = new Map<string, Intella>([
    ['lora-1', { id: 'lora-1', nomen: 'My LoRA', genus: 'lora', slug: 'my-lora', trigger: 'mld', familia: 'flux', ownerAnimaId: 'anima-1', access: 'private', canonica: false, sources: [{ provenance: 'miladystation', uri: 'https://x/lora.safetensors' }] } as unknown as Intella],
    ['canon-1', { id: 'canon-1', nomen: 'Canon Model', genus: 'lora', slug: 'canon', familia: 'flux', auctor: 'anima-1', canonica: true, sources: [{ provenance: 'miladystation', uri: 'https://x/c.safetensors' }] } as unknown as Intella],
    // A NON-COMMERCIAL import (FLUX.1-dev derivative) the caller owns — usable privately, but
    // barred from the public (commercial) catalog by the license gate.
    ['lora-nc', { id: 'lora-nc', nomen: 'NC LoRA', genus: 'lora', slug: 'nc', familia: 'flux', ownerAnimaId: 'anima-1', access: 'private', canonica: false, license: 'flux-1-dev-nc', commercialUse: 'no', sources: [{ provenance: 'civitai', uri: 'https://civitai/nc' }] } as unknown as Intella],
    // A commercially-clear import (schnell/Apache).
    ['lora-ok', { id: 'lora-ok', nomen: 'OK LoRA', genus: 'lora', slug: 'ok', familia: 'flux', ownerAnimaId: 'anima-1', access: 'private', canonica: false, license: 'apache-2.0', commercialUse: 'yes', sources: [{ provenance: 'civitai', uri: 'https://civitai/ok' }] } as unknown as Intella],
    // A CONDITIONAL import (Krea 2 / SD3 — allowed under-threshold): promotes.
    ['lora-cond', { id: 'lora-cond', nomen: 'Cond LoRA', genus: 'lora', slug: 'cond', familia: 'krea2', ownerAnimaId: 'anima-1', access: 'private', canonica: false, license: 'krea-community', commercialUse: 'conditional', provenance: { repo: 'civitai:5', base: 'Krea 2' }, sources: [{ provenance: 'civitai', uri: 'https://civitai/cond' }] } as unknown as Intella],
    // The `brutalite` shape (docs/spec/model-base-provenance.md): a klein-4B LoRA trained before
    // the base-provenance fix, so it carries no `baseModel` — only `familia:'flux2'`, no
    // `provenance`, and `nomen` = the trigger word (matches nothing in BASE_TABLE). It was
    // MANUALLY cleared to the correct license through a different admin route (bypassing
    // reclassify, which can't derive it). `classifyModelLicense` would still recompute 'unknown'
    // for it — the reclassify guard must leave the manually-cleared value alone.
    ['lora-manual', { id: 'lora-manual', nomen: 'brutalite', genus: 'lora', slug: 'brutalite', familia: 'flux2', ownerAnimaId: 'anima-1', access: 'private', canonica: false, license: 'apache-2.0', commercialUse: 'yes', sources: [{ provenance: 'miladystation', uri: 'https://x/brutalite.safetensors' }] } as unknown as Intella],
  ])
  // A fake Collectio store: one COMPLETE owned drop (with a team owners[] split) and
  // one still AGENS (in-flight) — both funded by anima-1.
  const collections = new Map<string, Collectio>([
    ['col-done', { id: 'col-done', nomen: 'Done Drop', status: 'completa', provenanceHash: 'sha256:done', numerus: 100, by: { animaId: 'anima-1' }, owners: [{ animaId: 'anima-1', weight: 0.5 }, { animaId: 'anima-2', weight: 0.5 }] } as unknown as Collectio],
    ['col-busy', { id: 'col-busy', nomen: 'Busy Drop', status: 'agens', provenanceHash: 'sha256:busy', numerus: 100, by: { animaId: 'anima-1' } } as unknown as Collectio],
  ])
  const collectiones = { find: async (id: string) => collections.get(id) ?? null }
  const accessCalls: Array<{ id: string; access: 'public' | 'private' }> = []
  const setLicenseCalls: Array<{ id: string; patch: { license?: string; commercialUse?: string } }> = []
  const intellarum = {
    find: async (id: string) => models.get(id) ?? null,
    setAccess: async (id: string, access: 'public' | 'private') => {
      accessCalls.push({ id, access })
      const m = models.get(id); if (m) (m as { access?: string }).access = access
      return m ?? null
    },
    addSource: async (id: string, source: { provenance: string; uri: string }) => {
      const m = models.get(id); if (!m) return null
      m.sources = [source as never, ...m.sources.filter((s) => s.uri !== source.uri)]
      return m
    },
    removeSource: async (id: string, uri: string) => {
      const m = models.get(id); if (!m) return null
      m.sources = m.sources.filter((s) => s.uri !== uri)
      return m
    },
    setLicense: async (id: string, patch: { license?: string; commercialUse?: string }) => {
      setLicenseCalls.push({ id, patch })
      const m = models.get(id); if (!m) return null
      Object.assign(m as object, patch)
      return m
    },
  }
  const api = new CrystalApi({
    editiones,
    actorum: fakeActorum(),
    signorum: fakeSignorum,
    animae,
    intellarum,
    collectiones,
    publicationAdapters: [
      new FeedAdapter(),
      new BucketAdapter({ fetcher, store }),
      new ModelPublishAdapter(huggingFaceRegistry('ms2stationthis')),
      new ModelPublishAdapter(civitaiRegistry()),
      new MintAdapter(),
      new MarketplaceAdapter({ base: 'https://noema.art/market' }),
    ],
    ...(opts?.noGate ? {} : { moderationGate: opts?.gate ?? permissiveModerationGate }),
    ...(opts?.verdictCache ? { verdictCache: opts.verdictCache } : {}),
    ...(opts?.scanFeeCharger ? { scanFeeCharger: opts.scanFeeCharger } : {}),
    ...(opts?.csamReviewReporter ? { csamReviewReporter: opts.csamReviewReporter } : {}),
  } as unknown as CrystalApiDeps)
  // The durable worker drives every settle (publish() only enqueues a pending Editio).
  // `flush` drains it deterministically — the test analogue of the in-process loop.
  const worker = new PublicationWorker({ editiones, settle: (id) => api.settlePublication(id), leaseMs: 60_000 })
  return { api, editiones, puts, dels, models, collections, accessCalls, setLicenseCalls, flush: () => worker.drainOnce() }
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

test('publish(): with NO gate wired, a public publish fails CLOSED → rejected, never on the feed', async () => {
  // The safety-critical default: an unconfigured CSAM gate must not approve public content.
  const { api, editiones, flush } = makeApi({ noGate: true }); // CrystalApi default → denyModerationGate
  const ed = await api.publish(anima1, { artifact: { kind: 'actum', id: OWNED_ACTUM }, destination: 'feed' });
  await flush();
  assert.equal((await editiones.find(ed.id))?.status, 'rejected');
  assert.equal((await api.feed()).length, 0);
});

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

test('publish(): a private publish settles via the worker with no moderation gate', async () => {
  const { api, editiones, flush } = makeApi()
  const ed = await api.publish(anima1, { artifact: { kind: 'actum', id: OWNED_ACTUM }, destination: 'feed', visibility: 'private' })
  assert.equal(ed.status, 'pending', 'publish() only enqueues — the worker settles')
  await flush()
  const stored = await editiones.find(ed.id)
  assert.equal(stored?.status, 'published')
  assert.match(stored?.externalRef ?? '', /^feed:/)
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

test('publish(): an unlisted bucket publish hosts the bytes via the worker (no moderation gate)', async () => {
  const { api, editiones, puts, flush } = makeApi()
  const ed = await api.publish(anima1, { artifact: { kind: 'actum', id: OWNED_ACTUM }, destination: 'r2', visibility: 'unlisted' })
  assert.equal(ed.status, 'pending')
  await flush()

  assert.equal(ed.custody, 'ours')
  assert.equal(puts.length, 1)
  assert.equal(puts[0].key, `editiones/${ed.id}.png`, 'hosted under the publication id')
  assert.equal((await editiones.find(ed.id))?.status, 'published')
  assert.equal((await editiones.find(ed.id))?.externalRef, `https://cdn/editiones/${ed.id}.png`)
  assert.equal((await api.feed()).length, 0, 'unlisted never appears in the public feed')
})

test('retractEdition(): retracting a bucket publish deletes the hosted bytes', async () => {
  const { api, dels, flush } = makeApi()
  const ed = await api.publish(anima1, { artifact: { kind: 'actum', id: OWNED_ACTUM }, destination: 'r2', visibility: 'unlisted' })
  await flush()
  const retracted = await api.retractEdition(anima1, ed.id)
  assert.equal(retracted.status, 'retracted')
  assert.deepEqual(dels, [`editiones/${ed.id}.png`], 'the hosted object was deleted')
})

test('publish(): a model publishes to HuggingFace (custody ours) and becomes resolvable (access public)', async () => {
  const { api, models, accessCalls, editiones, flush } = makeApi()
  const ed = await api.publish(anima1, { artifact: { kind: 'intella', id: 'lora-1' }, destination: 'huggingface', visibility: 'unlisted' })
  await flush()

  const stored = await editiones.find(ed.id)
  assert.equal(stored?.status, 'published')
  assert.equal(stored?.externalRef, 'https://huggingface.co/ms2stationthis/my-lora')
  // §5d reconciler: an unlisted (non-private) model publish flips access → public.
  assert.deepEqual(accessCalls, [{ id: 'lora-1', access: 'public' }])
  assert.equal((models.get('lora-1') as { access?: string }).access, 'public')
})

test('publish(): a non-commercially-licensed model cannot be promoted to the public catalog (license gate)', async () => {
  const { api, models, accessCalls } = makeApi()
  await assert.rejects(
    () => api.publish(anima1, { artifact: { kind: 'intella', id: 'lora-nc' }, destination: 'huggingface', visibility: 'unlisted' }),
    (e: unknown) => (e as { code?: string }).code === 'license.restricted',
  )
  assert.deepEqual(accessCalls, [], 'a license-barred model never flips to public')
  assert.equal((models.get('lora-nc') as { access?: string }).access, 'private')
})

test('publish(): commercial-clear AND conditional models promote; a PRIVATE publish of an NC model is allowed', async () => {
  const { api, flush } = makeApi()
  // commercial-clear (apache) → promotes
  const ok = await api.publish(anima1, { artifact: { kind: 'intella', id: 'lora-ok' }, destination: 'huggingface', visibility: 'unlisted' })
  await flush()
  assert.equal(ok.visibility, 'unlisted')
  // conditional (Krea <$1M) → also promotes (we track revenue against the cap)
  const cond = await api.publish(anima1, { artifact: { kind: 'intella', id: 'lora-cond' }, destination: 'huggingface', visibility: 'unlisted' })
  assert.equal(cond.visibility, 'unlisted')
  // the NC model is still fine to publish PRIVATELY (personal use / our-bucket custody, not the catalog)
  const priv = await api.publish(anima1, { artifact: { kind: 'intella', id: 'lora-nc' }, destination: 'r2', visibility: 'private' })
  assert.equal(priv.visibility, 'private')
})

test('setModelLicense(): admin clears an NC model → it then promotes; non-admin is refused', async () => {
  const admin = { animaId: process.env.PLATFORM_ANIMA_ID ?? 'platform' }
  const { api, models } = makeApi()

  // non-admin cannot clear
  await assert.rejects(
    () => api.setModelLicense(anima1, 'lora-nc', { commercialUse: 'yes' }),
    (e: unknown) => (e as { code?: string }).code === 'auth.forbidden',
  )

  // admin clears the NC model (e.g. a held commercial license) → verdict flips, gate now passes
  const card = await api.setModelLicense(admin, 'lora-nc', { license: 'bfl-commercial', commercialUse: 'yes' })
  assert.equal(card.commercialUse, 'yes')
  assert.equal((models.get('lora-nc') as { commercialUse?: string }).commercialUse, 'yes')
  const promoted = await api.publish(anima1, { artifact: { kind: 'intella', id: 'lora-nc' }, destination: 'huggingface', visibility: 'unlisted' })
  assert.equal(promoted.visibility, 'unlisted')
})

test('setModelLicense(): reclassify re-derives the verdict from the recorded base string', async () => {
  const admin = { animaId: process.env.PLATFORM_ANIMA_ID ?? 'platform' }
  const { api, models } = makeApi()
  // lora-cond has provenance.base 'Krea 2' → reclassify → krea-community / conditional
  const card = await api.setModelLicense(admin, 'lora-cond', { reclassify: true })
  assert.equal(card.license, 'krea-community')
  assert.equal(card.commercialUse, 'conditional')
  assert.equal((models.get('lora-cond') as { license?: string }).license, 'krea-community')
})

test('setModelLicense(): reclassify never downgrades an already-classified record to unknown', async () => {
  // The real incident this guards against: an admin manually clears/corrects a model's license
  // through a different route (bypassing reclassify, because reclassify itself can't derive the
  // right answer for it — the exact `brutalite` shape, `lora-manual` here). Clicking "reclassify"
  // on that SAME model must not silently wipe the correct value back to 'unknown', because the
  // classifier still has no way to derive it — there was never a better answer to fall back to.
  const admin = { animaId: process.env.PLATFORM_ANIMA_ID ?? 'platform' }
  const { api, models, setLicenseCalls } = makeApi()

  const before = models.get('lora-manual') as { license?: string; commercialUse?: string }
  assert.equal(before.license, 'apache-2.0')

  const card = await api.setModelLicense(admin, 'lora-manual', { reclassify: true })

  // The stored, manually-cleared value survives untouched — not silently downgraded.
  assert.equal(card.license, 'apache-2.0')
  assert.equal(card.commercialUse, 'yes')
  const after = models.get('lora-manual') as { license?: string; commercialUse?: string }
  assert.equal(after.license, 'apache-2.0')
  assert.equal(after.commercialUse, 'yes')
  // The guard short-circuits BEFORE writing — registry.setLicense is never called with 'unknown'.
  assert.deepEqual(setLicenseCalls, [])
})

test('publish(): a public model promotion is gated — a denied scan rejects it, access stays private', async () => {
  // The curation gate (`docs/spec/model-import.md` §"Curation review"): promoting a private import to
  // the public catalogue runs the ModerationGate over its preview samples, fail-closed. A denial
  // rejects the Editio and never flips the model to resolvable-public.
  const gate: ModerationGate = { async scan() { return { ok: false, reason: 'nsfw on the front page' } } }
  const { api, models, accessCalls, editiones, flush } = makeApi({ gate })
  const ed = await api.publish(anima1, { artifact: { kind: 'intella', id: 'lora-1' }, destination: 'huggingface', visibility: 'unlisted' })
  await flush()

  assert.equal((await editiones.find(ed.id))?.status, 'rejected')
  assert.deepEqual(accessCalls, [], 'a rejected promotion never touches access')
  assert.equal((models.get('lora-1') as { access?: string }).access, 'private')
})

test('publish(): a model to Civitai under the caller BYO account (custody theirs, from prefs)', async () => {
  const { api, editiones, flush } = makeApi({ prefs: { defaultDestination: 'civitai', defaultCustody: 'theirs', defaultVisibility: 'unlisted', civitaiAccount: 'mony' } })
  const ed = await api.publish(anima1, { artifact: { kind: 'intella', id: 'lora-1' } })
  assert.equal(ed.destination, 'civitai')
  assert.equal(ed.custody, 'theirs')
  await flush()
  assert.equal((await editiones.find(ed.id))?.externalRef, 'https://civitai.com/user/mony?model=my-lora')
})

test('publish(): a model cannot go to the media feed/marketplace', async () => {
  const { api } = makeApi()
  await assert.rejects(
    () => api.publish(anima1, { artifact: { kind: 'intella', id: 'lora-1' }, destination: 'huggingface', visibility: 'feed' }),
    /not the media feed/,
  )
})

test('publish(): rejects a model the caller does not own', async () => {
  const { api } = makeApi()
  await assert.rejects(
    () => api.publish({ animaId: 'not-the-owner' }, { artifact: { kind: 'intella', id: 'lora-1' }, destination: 'huggingface', visibility: 'unlisted' }),
    /not found/i,
  )
})

test('retractEdition(): retracting a model publish revokes resolvability (access private)', async () => {
  const { api, models, accessCalls, flush } = makeApi()
  const ed = await api.publish(anima1, { artifact: { kind: 'intella', id: 'lora-1' }, destination: 'huggingface', visibility: 'unlisted' })
  await flush()
  accessCalls.length = 0
  await api.retractEdition(anima1, ed.id)
  assert.deepEqual(accessCalls, [{ id: 'lora-1', access: 'private' }])
  assert.equal((models.get('lora-1') as { access?: string }).access, 'private')
})

// ── Rights / license / splits (#4) ──────────────────────────────────────────

test('publish(): snapshots an explicit weighted owners split onto the Editio', async () => {
  const { api } = makeApi()
  const owners = [{ animaId: 'anima-1', weight: 0.6 }, { animaId: 'anima-2', weight: 0.4 }]
  const ed = await api.publish(anima1, { artifact: { kind: 'actum', id: OWNED_ACTUM }, destination: 'feed', owners })
  assert.deepEqual(ed.owners, owners)
})

test('publish(): rejects owners that do not sum to 1', async () => {
  const { api } = makeApi()
  await assert.rejects(
    () => api.publish(anima1, { artifact: { kind: 'actum', id: OWNED_ACTUM }, destination: 'feed', owners: [{ animaId: 'a', weight: 0.3 }, { animaId: 'b', weight: 0.3 }] }),
    /sum to 1/,
  )
})

test('publish(): rejects both owners and teamId together', async () => {
  const { api } = makeApi()
  await assert.rejects(
    () => api.publish(anima1, { artifact: { kind: 'actum', id: OWNED_ACTUM }, destination: 'feed', owners: [{ animaId: 'a', weight: 1 }], teamId: 't1' }),
    /either owners or teamId/,
  )
})

test('publish(): a platform-canonical model defaults to the catalog license', async () => {
  const { api } = makeApi()
  const ed = await api.publish(anima1, { artifact: { kind: 'intella', id: 'canon-1' }, destination: 'huggingface', visibility: 'unlisted' })
  assert.equal(ed.license, 'catalog')
})

test('publish(): license falls back to the caller prefs, and an explicit license wins', async () => {
  const withPref = makeApi({ prefs: { defaultLicense: 'cc-by-4.0' } })
  const a = await withPref.api.publish(anima1, { artifact: { kind: 'actum', id: OWNED_ACTUM }, destination: 'feed' })
  assert.equal(a.license, 'cc-by-4.0')

  const explicit = makeApi({ prefs: { defaultLicense: 'cc-by-4.0' } })
  const b = await explicit.api.publish(anima1, { artifact: { kind: 'actum', id: OWNED_ACTUM }, destination: 'feed', license: 'mit' })
  assert.equal(b.license, 'mit')
})

test('publish(): rejects an artifact the caller does not own', async () => {
  const { api } = makeApi()
  await assert.rejects(
    () => api.publish(anima1, { artifact: { kind: 'actum', id: 'not-mine' } }),
    /not found/i,
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

// ── Training finality: a model hosted in OUR bucket (custody ours) ───────────

test('publish(): a model to r2 hosts its weights in our bucket + makes it resolvable from there', async () => {
  const { api, editiones, puts, models, flush } = makeApi()
  const ed = await api.publish(anima1, { artifact: { kind: 'intella', id: 'lora-1' }, destination: 'r2', visibility: 'private' })
  await flush()

  // The weight file was really moved into our bucket, keyed per-publication.
  assert.equal((await editiones.find(ed.id))?.status, 'published')
  assert.equal(puts.length, 1)
  assert.equal(puts[0].key, `models/${ed.id}/lora.safetensors`, 'hosted under the model prefix + filename')
  assert.equal((await editiones.find(ed.id))?.externalRef, `https://cdn/models/${ed.id}/lora.safetensors`)

  // The model now resolves FROM our bucket: a miladystation source at index 0.
  const m = models.get('lora-1')!
  assert.equal(m.sources[0].provenance, 'miladystation')
  assert.equal(m.sources[0].uri, `https://cdn/models/${ed.id}/lora.safetensors`)
})

test('publish(): a private our-bucket model stays private (resolvable only by its owner)', async () => {
  const { api, accessCalls, flush } = makeApi()
  await api.publish(anima1, { artifact: { kind: 'intella', id: 'lora-1' }, destination: 'r2', visibility: 'private' })
  await flush()
  assert.deepEqual(accessCalls, [{ id: 'lora-1', access: 'private' }])
})

test('retractEdition(): retracting an our-bucket model deletes the weights + drops the source', async () => {
  const { api, dels, models, flush } = makeApi()
  const ed = await api.publish(anima1, { artifact: { kind: 'intella', id: 'lora-1' }, destination: 'r2', visibility: 'unlisted' })
  await flush()
  const hosted = `https://cdn/models/${ed.id}/lora.safetensors`
  assert.ok(models.get('lora-1')!.sources.some((s) => s.uri === hosted))

  await api.retractEdition(anima1, ed.id)
  assert.deepEqual(dels, [`models/${ed.id}/lora.safetensors`], 'the hosted weights were deleted')
  assert.ok(!models.get('lora-1')!.sources.some((s) => s.uri === hosted), 'the our-bucket source was removed')
})

// ── custody:'both' one-call finality (#4): registry + our-bucket mirror ──────

test("publish(): custody 'both' publishes to the registry AND mirrors weights to our bucket", async () => {
  const { api, editiones, puts, models, flush } = makeApi()
  const ed = await api.publish(anima1, { artifact: { kind: 'intella', id: 'lora-1' }, destination: 'huggingface', visibility: 'unlisted', custody: 'both' })
  assert.equal(ed.destination, 'huggingface')
  assert.equal(ed.custody, 'ours', 'no BYO account → the external copy goes to our org')

  // One call → two durable publications for the one model: the registry + an r2 mirror.
  const all = await editiones.listByArtifact({ kind: 'intella', id: 'lora-1' })
  assert.equal(all.length, 2)
  assert.deepEqual(all.map((e) => e.destination).sort(), ['huggingface', 'r2'])
  const r2Id = all.find((e) => e.destination === 'r2')!.id
  const hfId = all.find((e) => e.destination === 'huggingface')!.id

  await flush()
  // Registry handle projected + the bucket mirror really hosted the weights + made it resolvable from us.
  assert.equal((await editiones.find(hfId))?.externalRef, 'https://huggingface.co/ms2stationthis/my-lora')
  assert.match((await editiones.find(r2Id))?.externalRef ?? '', /^https:\/\/cdn\/models\//)
  assert.equal(puts.length, 1, 'the weights were hosted in our bucket once')
  assert.equal(models.get('lora-1')!.sources[0].provenance, 'miladystation')
})

test("publish(): custody 'both' with a BYO account sends the registry copy to theirs", async () => {
  const { api } = makeApi({ prefs: { huggingFaceAccount: 'alice' } })
  const ed = await api.publish(anima1, { artifact: { kind: 'intella', id: 'lora-1' }, destination: 'huggingface', visibility: 'unlisted', custody: 'both' })
  assert.equal(ed.custody, 'theirs', 'a BYO HF account → the external copy goes to their account')
})

// ── Collection / mint (#5) ───────────────────────────────────────────────────

test('publish(): minting a complete collection freezes its canon + owners onto the mint', async () => {
  const { api, editiones, flush } = makeApi()
  const ed = await api.publish(anima1, { artifact: { kind: 'collectio', id: 'col-done' }, destination: 'mint' })

  // 'mint' is a public surface → defaults to marketplace visibility → gated (pending).
  assert.equal(ed.visibility, 'marketplace')
  assert.equal(ed.status, 'pending')
  // The collection's own owners[] are re-snapshotted onto the Editio at freeze.
  assert.deepEqual(ed.owners, [{ animaId: 'anima-1', weight: 0.5 }, { animaId: 'anima-2', weight: 0.5 }])

  await flush()
  const stored = await editiones.find(ed.id)
  assert.equal(stored?.status, 'published')
  assert.match(stored?.externalRef ?? '', /^mint:evm:[0-9a-f]{64}$/)
})

test('publish(): an in-flight collection cannot be minted (freeze boundary)', async () => {
  const { api } = makeApi()
  await assert.rejects(
    () => api.publish(anima1, { artifact: { kind: 'collectio', id: 'col-busy' }, destination: 'mint' }),
    /must be complete/,
  )
})

test('retractEdition(): a mint is permanent — it cannot be retracted', async () => {
  const { api, editiones, flush } = makeApi()
  const ed = await api.publish(anima1, { artifact: { kind: 'collectio', id: 'col-done' }, destination: 'mint' })
  await flush()
  assert.equal((await editiones.find(ed.id))?.status, 'published')
  await assert.rejects(() => api.retractEdition(anima1, ed.id), /permanent/)
})

test('publish(): a marketplace listing is revocable and keyed by the publication id', async () => {
  const { api, editiones, flush } = makeApi()
  const ed = await api.publish(anima1, { artifact: { kind: 'collectio', id: 'col-done' }, destination: 'marketplace' })
  await flush()
  const stored = await editiones.find(ed.id)
  assert.equal(stored?.externalRef, `https://noema.art/market/listing/${ed.id}`)

  const retracted = await api.retractEdition(anima1, ed.id)
  assert.equal(retracted.status, 'retracted')
})

test('publish(): an explicit owners split overrides the collection freeze default', async () => {
  const { api } = makeApi()
  const owners = [{ animaId: 'anima-1', weight: 1 }]
  const ed = await api.publish(anima1, { artifact: { kind: 'collectio', id: 'col-done' }, destination: 'mint', owners })
  assert.deepEqual(ed.owners, owners)
})

// =============================================================================
// A2 — human-review surface (spec §4). A gate that HOLDS (the pre-Thorn NSFW
// router escalation) routes the publication to the review queue instead of the
// feed or a terminal reject; an admin approves (→ publishes) or rejects.
// =============================================================================

const admin = { animaId: 'platform' } // PLATFORM_ANIMA_ID default (unset in test env)
const anima2 = { animaId: 'anima-2' }

/** A gate that HOLDS every scan (like the pre-Thorn router escalation), counting calls. */
function holdGate(): { gate: ModerationGate; calls: () => number } {
  let n = 0
  return { gate: { async scan() { n++; return { ok: false, hold: true, reason: 'flagged for human review' } } }, calls: () => n }
}

test('A2 hold: a held publish lands in review — pending, not on the feed, no report', async () => {
  const { gate } = holdGate()
  const { api, editiones, flush } = makeApi({ gate })
  const ed = await api.publish(anima1, { artifact: { kind: 'actum', id: OWNED_ACTUM }, destination: 'feed' })
  await flush()

  const stored = await editiones.find(ed.id)
  assert.equal(stored?.status, 'pending', 'a hold stays pending, NOT rejected')
  assert.equal(stored?.reviewOutcome, 'pending', 'held for human review')
  assert.equal((await api.feed()).length, 0, 'a held item is never on the feed')
})

test('A2 hold: the worker SKIPS a held item — no re-scan loop', async () => {
  const held = holdGate()
  const { api, flush } = makeApi({ gate: held.gate })
  await api.publish(anima1, { artifact: { kind: 'actum', id: OWNED_ACTUM }, destination: 'feed' })
  await flush()
  assert.equal(held.calls(), 1, 'scanned once → held')
  await flush(); await flush()
  assert.equal(held.calls(), 1, 'claimPending skips reviewOutcome:pending — the gate never re-runs')
})

test('A2 review queue: author sees only their OWN held items; admin sees all', async () => {
  const { gate } = holdGate()
  const { api, flush } = makeApi({ gate })
  const mine = await api.publish(anima1, { artifact: { kind: 'actum', id: OWNED_ACTUM }, destination: 'feed' })
  await flush()

  const asAuthor = await api.listHeldEditions(anima1)
  assert.equal(asAuthor.length, 1)
  assert.equal(asAuthor[0].id, mine.id)
  assert.equal(asAuthor[0].reviewOutcome, 'pending')

  assert.equal((await api.listHeldEditions(anima2)).length, 0, 'another author sees none of it')
  assert.equal((await api.listHeldEditions(admin)).length, 1, 'admin queue sees all held')
})

test('A2 approve: an admin approval clears the hold → the item re-settles and publishes (gate bypassed)', async () => {
  const held = holdGate()
  const { api, editiones, flush } = makeApi({ gate: held.gate })
  const ed = await api.publish(anima1, { artifact: { kind: 'actum', id: OWNED_ACTUM }, destination: 'feed' })
  await flush()
  assert.equal(held.calls(), 1)

  const approved = await api.approveHeldEdition(admin, ed.id)
  assert.equal(approved.reviewOutcome, 'approved')

  await flush()
  assert.equal((await editiones.find(ed.id))?.status, 'published', 'approved → publishes')
  assert.equal(held.calls(), 1, 'the gate is BYPASSED on the approved re-settle (no re-scan)')
  assert.equal((await api.feed()).length, 1, 'now on the feed')
})

test('A2 reject: an admin rejection is terminal — rejected, never on the feed', async () => {
  const { gate } = holdGate()
  const { api, editiones, flush } = makeApi({ gate })
  const ed = await api.publish(anima1, { artifact: { kind: 'actum', id: OWNED_ACTUM }, destination: 'feed' })
  await flush()

  const rejected = await api.rejectHeldEdition(admin, ed.id)
  assert.equal(rejected.status, 'rejected')
  assert.equal(rejected.reviewOutcome, 'rejected')

  await flush()
  assert.equal((await editiones.find(ed.id))?.status, 'rejected', 'stays rejected (terminal)')
  assert.equal((await api.feed()).length, 0)
})

test('A2 authority: an AUTHOR cannot approve or reject their own held content (admin-only)', async () => {
  const { gate } = holdGate()
  const { api, flush } = makeApi({ gate })
  const ed = await api.publish(anima1, { artifact: { kind: 'actum', id: OWNED_ACTUM }, destination: 'feed' })
  await flush()

  await assert.rejects(() => api.approveHeldEdition(anima1, ed.id), /platform administrator/)
  await assert.rejects(() => api.rejectHeldEdition(anima1, ed.id), /platform administrator/)
})

test('A2 reject/approve guard: only a pending-review Editio can be adjudicated', async () => {
  const { api, flush } = makeApi() // permissive gate → publishes straight through (no hold)
  const ed = await api.publish(anima1, { artifact: { kind: 'actum', id: OWNED_ACTUM }, destination: 'feed' })
  await flush()
  // Not held → approving/rejecting it is a not-found (nothing to adjudicate).
  await assert.rejects(() => api.approveHeldEdition(admin, ed.id))
  await assert.rejects(() => api.rejectHeldEdition(admin, ed.id))
})

// =============================================================================
// A4 — cost forwarding (spec §7): the content-addressed verdict cache (identical
// re-publish reuses the verdict, no re-scan) + the billable-gated scan fee.
// =============================================================================

import type { VerdictCache, CachedVerdict } from '../../../src/crystal/VerdictCache.js'
import type { ScanFeeCharger } from '../../../src/crystal/ScanFeeCharger.js'

function memCache(): VerdictCache & { store: Map<string, CachedVerdict> } {
  const store = new Map<string, CachedVerdict>()
  return { store, async get(k) { return store.get(k) ?? null }, async put(v) { store.set(v.key, v) } }
}
function countingCharger(): { charger: ScanFeeCharger; charges: Array<{ editioId: string }> } {
  const charges: Array<{ editioId: string }> = []
  return { charger: { async charge(_by, editioId) { charges.push({ editioId }) } }, charges }
}

/** A gate that counts scans and reports the scan as billable (a paid classifier ran). */
function billableGate(): { gate: ModerationGate; calls: () => number } {
  let n = 0
  return { gate: { async scan() { n++; return { ok: true, billable: true } } }, calls: () => n }
}

test('A4 cache: an identical re-publish REUSES the verdict — no re-scan, no re-charge', async () => {
  const cache = memCache()
  const charger = countingCharger()
  const g = billableGate()
  const { api, flush } = makeApi({ gate: g.gate, verdictCache: cache, scanFeeCharger: charger.charger })

  // First publish of the actum → scans once, caches, charges the billable fee.
  const first = await api.publish(anima1, { artifact: { kind: 'actum', id: OWNED_ACTUM }, destination: 'feed' })
  await flush()
  assert.equal(g.calls(), 1)
  assert.equal(charger.charges.length, 1)
  assert.equal(charger.charges[0].editioId, first.id)
  assert.equal(cache.store.size, 1, 'the verdict was cached by content key')

  // Re-publish the SAME artifact (identical media) → cache hit: no scan, no charge.
  await api.publish(anima1, { artifact: { kind: 'actum', id: OWNED_ACTUM }, destination: 'marketplace' })
  await flush()
  assert.equal(g.calls(), 1, 'identical content is not re-scanned (cache hit)')
  assert.equal(charger.charges.length, 1, 'identical content is not re-charged')
  assert.equal((await api.feed({ visibility: 'feed' })).length, 1)
})

test('A4 fee: a non-billable scan (no paid classifier) is NOT charged', async () => {
  const charger = countingCharger()
  // permissive gate returns { ok: true } with no `billable` → nothing was paid for.
  const { api, flush } = makeApi({ gate: permissiveModerationGate, scanFeeCharger: charger.charger })
  await api.publish(anima1, { artifact: { kind: 'actum', id: OWNED_ACTUM }, destination: 'feed' })
  await flush()
  assert.equal(charger.charges.length, 0, 'no paid classifier ran → no fee (spec §7)')
})

test('A4 fee: a fee-charger failure does NOT block the publish', async () => {
  const g = billableGate()
  const throwingCharger: ScanFeeCharger = { async charge() { throw new Error('ledger down') } }
  const { api, editiones, flush } = makeApi({ gate: g.gate, scanFeeCharger: throwingCharger })
  const ed = await api.publish(anima1, { artifact: { kind: 'actum', id: OWNED_ACTUM }, destination: 'feed' })
  await flush()
  assert.equal((await editiones.find(ed.id))?.status, 'published', 'the safe publish stands despite the fee failure')
})

test('A4 cache: a cached REJECT blocks an identical re-publish without re-scanning', async () => {
  const cache = memCache()
  let scans = 0
  const rejectGate: ModerationGate = { async scan() { scans++; return { ok: false, reason: 'nope' } } }
  const { api, editiones, flush } = makeApi({ gate: rejectGate, verdictCache: cache })
  const a = await api.publish(anima1, { artifact: { kind: 'actum', id: OWNED_ACTUM }, destination: 'feed' })
  await flush()
  assert.equal((await editiones.find(a.id))?.status, 'rejected')
  assert.equal(scans, 1)
  const b = await api.publish(anima1, { artifact: { kind: 'actum', id: OWNED_ACTUM }, destination: 'marketplace' })
  await flush()
  assert.equal((await editiones.find(b.id))?.status, 'rejected', 'reused the cached reject')
  assert.equal(scans, 1, 'identical rejected content is not re-scanned')
})

// =============================================================================
// Human-review CONFIRM-AND-REPORT (spec §4) — the Thorn-independent adjudicator.
// A reviewer confirming CSAM rejects the item AND files the NCMEC report; a plain
// reject never reports (§0-A). Admin-only.
// =============================================================================

import type { CsamReviewReporter, ReviewedCsamReport } from '../../../src/crystal/CsamReviewReporter.js'

function spyReporter(): { reporter: CsamReviewReporter; reports: ReviewedCsamReport[] } {
  const reports: ReviewedCsamReport[] = []
  return { reporter: { async reportConfirmed(r) { reports.push(r); return { reportId: 'ncmec:1', reportIds: ['ncmec:1'], submitted: false } } }, reports }
}

test('confirm-CSAM: admin confirmation rejects the held item AND files a report', async () => {
  const spy = spyReporter()
  const { gate } = holdGate()
  const { api, editiones, flush } = makeApi({ gate, csamReviewReporter: spy.reporter })
  const ed = await api.publish(anima1, { artifact: { kind: 'actum', id: OWNED_ACTUM }, destination: 'feed' })
  await flush() // → held (reviewOutcome pending)

  const out = await api.confirmCsamAndReport(admin, ed.id)
  assert.equal(out.status, 'rejected')
  assert.equal(out.reviewOutcome, 'rejected')
  assert.equal((await editiones.find(ed.id))?.status, 'rejected')
  assert.equal(spy.reports.length, 1, 'a report was filed')
  assert.equal(spy.reports[0].editioId, ed.id)
  assert.deepEqual(spy.reports[0].artifact, { kind: 'actum', id: OWNED_ACTUM })
  assert.deepEqual(spy.reports[0].uploader, { animaId: 'anima-1' })
  assert.equal(spy.reports[0].reviewedBy, 'platform')
  assert.ok(spy.reports[0].urls.length >= 1, 'the confirmed media urls are included')
})

test('confirm-CSAM: a plain reject files NO report (only confirm does)', async () => {
  const spy = spyReporter()
  const { gate } = holdGate()
  const { api, flush } = makeApi({ gate, csamReviewReporter: spy.reporter })
  const ed = await api.publish(anima1, { artifact: { kind: 'actum', id: OWNED_ACTUM }, destination: 'feed' })
  await flush()
  await api.rejectHeldEdition(admin, ed.id)
  assert.equal(spy.reports.length, 0, 'reject must never file a report (§0-A)')
})

test('confirm-CSAM: platform-admin only; an author cannot confirm', async () => {
  const { gate } = holdGate()
  const { api, flush } = makeApi({ gate, csamReviewReporter: spyReporter().reporter })
  const ed = await api.publish(anima1, { artifact: { kind: 'actum', id: OWNED_ACTUM }, destination: 'feed' })
  await flush()
  await assert.rejects(() => api.confirmCsamAndReport(anima1, ed.id), /platform administrator/)
})

test('confirm-CSAM: no reporter configured → still rejects (fail-safe), no throw', async () => {
  const { gate } = holdGate()
  const { api, editiones, flush } = makeApi({ gate }) // no csamReviewReporter
  const ed = await api.publish(anima1, { artifact: { kind: 'actum', id: OWNED_ACTUM }, destination: 'feed' })
  await flush()
  const out = await api.confirmCsamAndReport(admin, ed.id)
  assert.equal(out.status, 'rejected', 'content is rejected even when no reporter is wired')
  assert.equal((await editiones.find(ed.id))?.status, 'rejected')
})
