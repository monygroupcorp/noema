import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import {
  manualReviewGate,
  permissiveModerationGate,
  denyModerationGate,
  selectModerationGate,
  type ModerationGate,
} from '../../../src/crystal/ModerationGate.js'
import type { PublishArtifact } from '../../../src/crystal/PublicationAdapter.js'
import { CrystalApi, type CrystalApiDeps } from '../../../src/allocutio/api/CrystalApi.js'
import { PublicationWorker } from '../../../src/crystal/PublicationWorker.js'
import { FeedAdapter } from '../../../src/crystal/FeedAdapter.js'
import type { Editio, Editiones, Editionum, ArtifactRef, FeedFilter } from '../../../src/types/editio.js'

// =============================================================================
// noema-118 — interim MANUAL-REVIEW moderation posture.
//
// `manualReviewGate` HOLDS every public publish for the existing admin review queue
// (never auto-publishes, never auto-rejects, never files a NCMEC report on its own).
// `selectModerationGate` encodes the fail-closed precedence:
//   private > manual (MODERATION_MANUAL_REVIEW) > permissive (MODERATION_ALLOW_UNSCANNED) > deny.
// This file proves the novel logic + that a real public publish routes to HELD and that
// the existing admin approve/reject adjudication still lands, with the default staying
// fail-closed deny.
// =============================================================================

const anyArtifact = {} as PublishArtifact

// ---------------------------------------------------------------------------
// 1. The gate itself: HOLD for everything, and NOTHING else.
// ---------------------------------------------------------------------------
test('manualReviewGate: every artifact is HELD (ok:false, hold:true) — never approved, never a plain reject', async () => {
  for (const a of [{} , { output: { image: 'https://cdn/a.png' } }, { output: {} }]) {
    const v = await manualReviewGate.scan(a as unknown as PublishArtifact)
    assert.equal(v.ok, false, 'a manual-review gate NEVER auto-approves')
    assert.equal((v as { hold?: boolean }).hold, true, 'the refusal is a HOLD (routes to the review queue), not a terminal reject')
    assert.equal(typeof (v as { reason?: string }).reason, 'string')
    // A hold is not a CSAM verdict and never bills a paid classifier (nothing ran).
    assert.notEqual((v as { billable?: boolean }).billable, true)
  }
})

// ---------------------------------------------------------------------------
// 2. Precedence — fail-closed, all combinations.
// ---------------------------------------------------------------------------
const realPrivate: ModerationGate = { async scan() { return { ok: true } } }

test('selectModerationGate: private scanner wins over both flags', () => {
  for (const manualReview of [true, false]) {
    for (const allowUnscanned of [true, false]) {
      const sel = selectModerationGate({ privateGate: realPrivate, manualReview, allowUnscanned })
      assert.equal(sel.mode, 'private')
      assert.equal(sel.gate, realPrivate)
    }
  }
})

test('selectModerationGate: MODERATION_MANUAL_REVIEW ranks above permissive/deny (below private)', () => {
  // manual beats permissive even when both flags are set
  const both = selectModerationGate({ privateGate: null, manualReview: true, allowUnscanned: true })
  assert.equal(both.mode, 'manual')
  assert.equal(both.gate, manualReviewGate)

  const manualOnly = selectModerationGate({ privateGate: null, manualReview: true, allowUnscanned: false })
  assert.equal(manualOnly.mode, 'manual')
  assert.equal(manualOnly.gate, manualReviewGate)
})

test('selectModerationGate: permissive only under MODERATION_ALLOW_UNSCANNED (no private, no manual)', () => {
  const sel = selectModerationGate({ privateGate: null, manualReview: false, allowUnscanned: true })
  assert.equal(sel.mode, 'permissive')
  assert.equal(sel.gate, permissiveModerationGate)
})

test('selectModerationGate: DEFAULT is fail-closed deny — no private gate, neither flag', () => {
  const sel = selectModerationGate({ privateGate: null, manualReview: false, allowUnscanned: false })
  assert.equal(sel.mode, 'deny')
  assert.equal(sel.gate, denyModerationGate)
})

// ---------------------------------------------------------------------------
// 3. End-to-end held-routing through the real CrystalApi settle path.
// ---------------------------------------------------------------------------

/** In-memory Editionum (trimmed from publish.test.ts) — the store IS the queue. */
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
  async update(id: string, patch: Partial<Pick<Editio, 'status' | 'externalRef' | 'visibility' | 'custody' | 'reviewOutcome' | 'leasedUntil' | 'moderation'>>) {
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
const anima1 = { animaId: 'anima-1' }
const admin = { animaId: 'platform' } // PLATFORM_ANIMA_ID default (env unset in the hermetic suite)

function makeApi() {
  const editiones = new MemEditionum()
  const actorum = {
    findById: async (id: string) =>
      id === OWNED_ACTUM
        ? ({ id, status: 'completus', exitus: { image: 'https://cdn/x.png' }, signaConsumed: ['s1'] } as unknown)
        : null,
  }
  const signorum = { ownsAny: async () => true }
  // A spy reporter: the gate/hold/approve/reject path must NEVER file a NCMEC report on its own.
  const csamReviewReporterCalls: string[] = []
  const csamReviewReporter = { report: async (id: string) => { csamReviewReporterCalls.push(id) } }
  const api = new CrystalApi({
    editiones,
    actorum,
    signorum,
    publicationAdapters: [new FeedAdapter()],
    moderationGate: manualReviewGate,
    csamReviewReporter,
  } as unknown as CrystalApiDeps)
  const worker = new PublicationWorker({ editiones, settle: (id) => api.settlePublication(id), leaseMs: 60_000 })
  return { api, editiones, csamReviewReporterCalls, flush: () => worker.drainOnce() }
}

test('manualReviewGate: a public feed publish is HELD (never published, never rejected) and lands in the admin queue', async () => {
  const { api, editiones, csamReviewReporterCalls, flush } = makeApi()
  const ed = await api.publish(anima1, { artifact: { kind: 'actum', id: OWNED_ACTUM }, destination: 'feed' })
  await flush()

  const held = await editiones.find(ed.id)
  assert.equal(held?.reviewOutcome, 'pending', 'the publish is HELD for review')
  assert.notEqual(held?.status, 'published', 'a held publish never auto-goes-live')
  assert.notEqual(held?.status, 'rejected', 'a HOLD is not a reject')
  assert.equal((await api.feed()).length, 0, 'held content is not on the public feed')

  // Admin sees it in the review queue; the author sees their own.
  assert.equal((await api.listHeldEditions(admin)).length, 1)
  assert.equal((await api.listHeldEditions(anima1)).length, 1)

  // The gate itself filed NO NCMEC report (§0-A — report is the reviewer's explicit confirm-csam).
  assert.deepEqual(csamReviewReporterCalls, [])
})

test('manualReviewGate: admin APPROVE clears the hold → the content publishes to the feed', async () => {
  const { api, editiones, csamReviewReporterCalls, flush } = makeApi()
  const ed = await api.publish(anima1, { artifact: { kind: 'actum', id: OWNED_ACTUM }, destination: 'feed' })
  await flush() // → held

  await api.approveHeldEdition(admin, ed.id)
  await flush() // worker re-settles with the gate bypassed

  const done = await editiones.find(ed.id)
  assert.equal(done?.status, 'published')
  assert.equal(done?.reviewOutcome, 'approved')
  assert.equal((await api.feed()).length, 1, 'the approved edition is now on the feed')
  assert.deepEqual(csamReviewReporterCalls, [], 'approval never reports')
})

test('manualReviewGate: admin REJECT is terminal (rejected, never on the feed) and files NO report', async () => {
  const { api, editiones, csamReviewReporterCalls, flush } = makeApi()
  const ed = await api.publish(anima1, { artifact: { kind: 'actum', id: OWNED_ACTUM }, destination: 'feed' })
  await flush() // → held

  await api.rejectHeldEdition(admin, ed.id)
  await flush()

  const done = await editiones.find(ed.id)
  assert.equal(done?.status, 'rejected')
  assert.equal(done?.reviewOutcome, 'rejected')
  assert.equal((await api.feed()).length, 0)
  assert.deepEqual(csamReviewReporterCalls, [], 'a plain reject NEVER files a NCMEC report (§0-A)')
})

test('manualReviewGate: approve/reject are PLATFORM-ADMIN only — a non-admin author cannot clear their own hold', async () => {
  const { api, flush } = makeApi()
  const ed = await api.publish(anima1, { artifact: { kind: 'actum', id: OWNED_ACTUM }, destination: 'feed' })
  await flush()
  await assert.rejects(() => api.approveHeldEdition(anima1, ed.id))
  await assert.rejects(() => api.rejectHeldEdition(anima1, ed.id))
})
