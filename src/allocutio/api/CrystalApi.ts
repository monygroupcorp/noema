// =============================================================================
// CrystalApi — the agent-shaped facade over the crystal ring
// =============================================================================
//
// One small class that an agent (or REST/MCP adapter) talks to. It does NOT
// re-implement execution: it composes the already-built foundation —
// `dispatchInceptio` (the verbatim initiate→dispatch core), `toRun` (the public
// Actum→Run projection), `describeFlow` (the JSON-Schema flow description), and
// the `Errors.*` request-error taxonomy. Verb resolution layers the owner-keyed
// Consuetudinum rebinds over the platform's CANON_VERBS table — the SAME
// precedence the Telegram CommandRouter uses, sharing the same constant.
//
// Construction takes the ring slices it needs (the "deps ring"); methods return
// the public projection types, never the internal Latin primitives.
// =============================================================================

import { randomUUID } from 'crypto'
import type { Modorum, Modus } from '../../types/modus.js'
import type { Cursorum, ActumCompletor, Actorum } from '../../types/cursus.js'
import type { ActumInceptor } from '../../execution/ActumInceptor.js'
import type { ActumIndexStore } from '../../types/actumIndex.js'
import type { Consuetudinum } from '../../types/consuetudo.js'
import type { Signorum } from '../../types/significandi.js'
import type { Fundamentorum } from '../../types/fundamentum.js'
import type { Intelligens, IntelligentiumStore, IntelligensGenus, Intellarum, Intella } from '../../types/intelligendi.js'
import type { HospitiumStore } from '../../types/hospitium.js'
import type { MateriaStore } from '../../types/materia.js'
import type { Conductor, StudioHandle, ConduceOpts } from '../../crystal/Conductor.js'
import type { TeeProvisioner } from '../../crystal/TeeProvisioner.js'
import type { AuctorKey } from '../../flow/types.js'
import type { Actum, ComputeStrategy, GpuClass, ModelRef } from '../../types/actum.js'
import type { Inceptio } from '../../types/cursus.js'

import { aggregateStatus, materiaStudioStatus } from '../lexicon/status/aggregate.js'
import type { ModoStore } from '../../types/modo.js'
import { deriveSavedModus, type PromptMode } from '../../crystal/deriveSavedModus.js'
import { dispatchInceptio, type DispatchDeps } from '../../execution/dispatchInceptio.js'
import { toRun, toCollection, toTeam, toEdition } from './runProjection.js'
import { describeFlow, type FlowDescription, type DescribableModus } from './aditusToJsonSchema.js'
import { Errors } from './errors.js'
import { CANON_VERBS } from '../../crystal/canonVerbs.js'
import { computeRecipient } from '../../arcanum/prover.js'
import { impetusForPodMs } from '../../ledger/rates.js'
import type { Run, Collection, Team, Edition, FeedItem } from './types.js'
import type { Collectio, Collectionum, Tractus } from '../../types/collectio.js'
import type { Editio, Editionum, ArtifactRef, ArtifactKind, EditioVisibility, EditioCustody, FeedFilter } from '../../types/editio.js'
import type { Sodalitas, Sodalitatum } from '../../types/sodalitas.js'
import type { AnimaStore, PublishingPrefs } from '../../types/anima.js'
import type { PublicationAdapter } from '../../crystal/PublicationAdapter.js'
import type { ModerationGate } from '../../crystal/ModerationGate.js'
import { permissiveModerationGate } from '../../crystal/ModerationGate.js'
import type { CollectioCursor } from '../../crystal/CollectioCursor.js'
import { provenanceHash } from '../../crystal/provenance.js'
import { rarityReport, type RarityReport } from '../../crystal/rarityReport.js'

const PLATFORM_ANIMA_ID = process.env.PLATFORM_ANIMA_ID ?? 'platform'

/** The ring slices CrystalApi composes. */
export interface CrystalApiDeps {
  inceptor: { initiate: ActumInceptor['initiate'] }
  modorum: Modorum
  cursorum: Cursorum
  completor: ActumCompletor
  actorum: Actorum
  /** The ledger — used to owner-scope `getRun` (a run is yours iff you own one of the
   *  signa it consumed) and to quote a run's cost. Identity-blind Actum → ownership lives here. */
  signorum: Signorum
  /** Compute-substrate registry — backs `listFundamenta` discovery. */
  fundamentorum: Fundamentorum
  /** Weight catalog — backs `listModels` discovery. */
  intelligendi: IntelligentiumStore
  /** Hosting + live-pod registries — back the `status` aggregation. */
  hospitia: HospitiumStore
  materiae: MateriaStore
  /** Studio-lifecycle anchor (ADR-0006) — backs `provisionStudio`/`listStudios`. Absent
   *  when no Procurator (provision-capable pod client) is wired → studio ops are unavailable. */
  conductor?: Conductor
  /** Fire-and-forget webhook poster (the `options.webhookUrl` seam). Absent → no webhook.
   *  Kept here (not in the crystal ring) so `fetch` stays out of `Conductor`. */
  notify?: (url: string, body: unknown) => void
  /** Optional per-AuctorKey aggregation index (passed through to dispatchInceptio). */
  actumIndex?: ActumIndexStore
  /** Session store — keys studios by their bound Modo id (the canonical studio handle)
   *  in `status`, so `/v1/me/status` and `/v1/studios` agree on `studioId` (ADR-0006). */
  modos?: ModoStore
  /** Optional owner-keyed verb→flow rebinds; falls through to CANON_VERBS when absent. */
  consuetudinum?: Consuetudinum
  /** Compositus engine (ADR-0008) — lets `invokeFlow` dispatch a compositus (spell)
   *  modus, not just atomics. Absent → compositus modi throw at dispatch. */
  compositusCursor?: DispatchDeps['compositusCursor']
  /** Collection store + fan-out cursor — back `collect`/`getCollection`/review.
   *  Absent → collection ops unavailable. */
  collectiones?: Collectionum
  collectioCursor?: Pick<CollectioCursor, 'start' | 'extend' | 'approveActum' | 'rejectAndRevive' | 'pause' | 'resume'>
  /** Team store — backs the team CRUD + team-owned collections. Absent → team ops unavailable. */
  sodalitatum?: Sodalitatum
  /** Publication store (Editio) — backs `publish`/`feed`/`retract`. Absent → publishing unavailable. */
  editiones?: Editionum
  /** Registered publication adapters, resolved by `destination` key (FeedAdapter, …). */
  publicationAdapters?: PublicationAdapter[]
  /** Trust-boundary →public moderation gate (CSAM/NCMEC). Absent → permissive placeholder. */
  moderationGate?: ModerationGate
  /** Identity store — reads `Anima.publicatio` to default a publish from the caller's prefs. */
  animae?: AnimaStore
  /** Model (Intella) registry — resolves + owner-scopes an `Intella` publish and is the
   *  reconciler's write seam (`setAccess`) for §5d. Absent → model publishing unavailable. */
  intellarum?: Intellarum
  /** Scheduler for the async →public settle (moderation + adapter publish). Absent →
   *  fire-and-forget. Tests inject a collecting scheduler to await the pipeline. */
  publishScheduler?: (task: () => Promise<void>) => void
  /** RunPod pod provisioner for TEE private compute sessions. Absent → local dev (manual runner). */
  teeProvisioner?: TeeProvisioner
}

/** Inputs to start a Collection (a Collectio): a base modus expanded over a Tractus[] grid. */
export interface CollectOpts {
  /** The flow expanded across the grid (atomic or a compositus pipeline). */
  modusId: string
  /** Target number of pieces to generate. */
  total: number
  /** The axes of variation. Each Tractus is one trait/parameter dimension. */
  tractus: Tractus[]
  /** Base aditus applied to every piece (e.g. `_basePrompt` with `{{axis}}` tokens). */
  aditusBase?: Record<string, unknown>
  /** Max concurrent pieces in flight. Default 3. */
  concurrentia?: number
  /** Optional human name. */
  nomen?: string
  /** Opt-in DNA uniqueness — no two pieces share a trait combination (see Collectio.dna). */
  dna?: boolean
  /**
   * Own this collection by a team (Sodalitas) instead of the individual caller.
   * The caller must be a member. Snapshots an equal-weight `owners` split from
   * the team's membership at creation.
   */
  teamId?: string
}

/** Inputs to publish an artifact (an Actum for #1) to a destination under a policy. */
export interface PublishOpts {
  /** The canonical artifact to put forth (referenced, never copied). */
  artifact: { kind: ArtifactKind; id: string }
  /** Adapter key. Defaults from the caller's prefs, then 'feed'. */
  destination?: string
  /** Public-exposure surface. Defaults from prefs, then 'feed' for the feed adapter else 'private'. */
  visibility?: EditioVisibility
  /** Who holds the bytes/metadata. Defaults from prefs, then 'ours'. */
  custody?: EditioCustody
  /** License tag — 'catalog' (our liability) | a BYO license id. Defaults: prefs, then
   *  'catalog' for platform-canonical artifacts, else unset. */
  license?: string
  /** Snapshot a rights split from a team (Sodalitas) the caller is a member of. */
  teamId?: string
  /** Explicit rights split (animaId → weight, Σ≈1). Mutually exclusive with `teamId`. */
  owners?: Array<{ animaId: string; weight: number }>
}

/** Where to send a run: an explicit modusId OR a canon verb to resolve. */
export interface InvokeTarget {
  modusId?: string
  verb?: string
}

/** Per-run execution overrides. */
export interface InvokeOpts {
  pinnedModels?: ModelRef[]
  computeStrategy?: ComputeStrategy
  gpuClass?: GpuClass
  /** Hard spend cap (impetus). Admission refuses if the estimated reservation exceeds it. */
  maxImpetus?: bigint | string
  /** Target an existing warm studio (a Modo session) instead of cold-provisioning a pod. */
  studioId?: string
  /**
   * Override the `by` field on the Inceptio — used for anonymous paths (bursaToken,
   * arcanumProof) that bypass AuctorKey identity entirely.
   */
  by?: Inceptio['by']
}

/** A compact catalog summary of one runnable flow. */
export interface FlowSummary {
  id: string
  nomen: string
  versio: string
  categoria?: unknown
  /** Number of steps — present only for a compositus (spell). Absent = an atomic flow.
   *  Lets an agent tell a one-shot tool from a multi-step spell at the catalog level. */
  steps?: number
}

export class CrystalApi {
  constructor(private readonly deps: CrystalApiDeps) {}

  /**
   * Invoke a flow for an auctor and return its public Run projection.
   *
   * Target resolution: an explicit `modusId` wins; otherwise the `verb` is
   * resolved through the owner's Consuetudinum rebinds, falling back to the
   * platform CANON_VERBS table. Nothing resolved → `not_found.flow`.
   */
  async invokeFlow(
    auctor: AuctorKey,
    target: InvokeTarget,
    aditus: Record<string, unknown>,
    opts: InvokeOpts = {},
  ): Promise<Run> {
    const { inceptor, modorum, cursorum, completor, actumIndex, consuetudinum, compositusCursor } = this.deps

    let modusId: string | undefined
    if (target.modusId) {
      modusId = target.modusId
    } else if (target.verb) {
      modusId = (await consuetudinum?.resolve(auctor, target.verb)) ?? CANON_VERBS[target.verb]
    }
    if (!modusId) throw Errors.notFoundFlow(target.verb ?? '?')

    // Admission spend cap — refuse before dispatch if the upper-bound estimate exceeds
    // maxImpetus. (Mid-run enforcement — the watchdog — is a Phase-4b follow-up.)
    if (opts.maxImpetus !== undefined) {
      const est = await this._estimate(modusId, aditus)
      if (est > BigInt(opts.maxImpetus)) {
        throw Errors.capTooLow({ estimated: est.toString(), maxImpetus: String(opts.maxImpetus) })
      }
    }

    const inceptio: Inceptio = {
      modusId,
      aditus,
      by: opts.by ?? auctor,
      ...(opts.studioId ? { modoId: opts.studioId } : {}),
      ...(opts.pinnedModels?.length ? { pinnedModels: opts.pinnedModels } : {}),
      ...(opts.computeStrategy ? { computeStrategy: opts.computeStrategy } : {}),
      ...(opts.gpuClass ? { gpuClass: opts.gpuClass } : {}),
    }

    const { actum } = await dispatchInceptio(
      { inceptor, modorum, cursorum, completor, actumIndex, compositusCursor },
      inceptio,
    )
    return toRun(actum)
  }

  /**
   * Fetch a run by id and project it — OWNER-SCOPED. A caller may read a run only
   * if they own it (else `not_found.run`, never revealing that it exists). The Actum
   * is deliberately identity-blind, so ownership is checked against the ledger: the
   * run is yours iff you own one of the signa it consumed. Works for both `animaId`
   * and anon `commitment` (the arcanum signum the spend nullified is in your history),
   * preserving anonymity. Unknown id → `not_found.run`.
   */
  async getRun(auctor: AuctorKey, id: string): Promise<Run> {
    const a = await this.deps.actorum.findById(id)
    if (!a || !(await this._owns(auctor, a))) throw Errors.notFoundRun(id)
    return toRun(a)
  }

  /** A run is owned by an auctor iff:
   *  - bursaToken: the actum.bursaToken matches (no signa involved)
   *  - otherwise: a signum it consumed belongs to that auctor */
  private async _owns(auctor: AuctorKey, a: Actum): Promise<boolean> {
    if ('bursaToken' in auctor) {
      if (a.bursaToken === auctor.bursaToken) return true
      // A compositus parent (cost-free umbrella) carries no bursaToken of its own —
      // it's owned by whoever owns its child steps. Check them.
      if ((a.signaConsumed?.length ?? 0) === 0) {
        const kids = await this.deps.actorum.findByCompositum(a.id)
        if (kids.some(k => k.bursaToken === auctor.bursaToken)) return true
      }
      return false
    }
    if (await this.deps.signorum.ownsAny(auctor, a.signaConsumed ?? [])) return true
    // Compositus parent: no signa of its own (ADR-0008) → owned via its child steps' signa.
    if ((a.signaConsumed?.length ?? 0) === 0) {
      const kids = await this.deps.actorum.findByCompositum(a.id)
      const childSigna = kids.flatMap(k => k.signaConsumed ?? [])
      if (childSigna.length > 0 && await this.deps.signorum.ownsAny(auctor, childSigna)) return true
    }
    return false
  }

  // ── Collections (Collectio) ─────────────────────────────────────────────────

  /**
   * Start a Collection — create a `Collectio` (a base modus expanded over a
   * `Tractus[]` grid) and fan it out via the CollectioCursor. General-purpose:
   * NFT rarity/attributes/export ride on the same grid but are opt-in. Returns
   * the public Collection. The base modus may be atomic OR a compositus pipeline.
   */
  async collect(auctor: AuctorKey, opts: CollectOpts): Promise<Collection> {
    const { collectiones, collectioCursor } = this.deps
    if (!collectiones || !collectioCursor) throw Errors.notFoundCollection('collections')

    // The caller is always the concrete funding identity. A team overlay
    // (sodalitasId + a snapshotted owners split) layers shared ownership on top.
    const by = this._collectionBy(auctor)
    let sodalitasId: string | undefined
    let owners: Collectio['owners']
    if (opts.teamId !== undefined) {
      const team = await this._memberTeam(auctor, opts.teamId)
      sodalitasId = team.id
      // Snapshot an equal-weight split across the team's membership.
      owners = team.membra.map((animaId) => ({ animaId, weight: 1 / team.membra.length }))
    }

    // Validate the flow up front — a bogus modusId would otherwise create a
    // collection whose every piece fails at dispatch. (Mirrors invokeFlow/quote.)
    const modus = await this.deps.modorum.find(opts.modusId)
    if (!modus) throw Errors.notFoundFlow(opts.modusId)

    const aditusBase = opts.aditusBase ?? {}
    // Pin the provenance hash to the resolved flow version.
    const provenance = provenanceHash({
      modusId: opts.modusId,
      modusVersio: modus.versio,
      tractus: opts.tractus,
      aditusBase,
    })

    const collectio = await collectiones.create({
      ...(opts.nomen !== undefined ? { nomen: opts.nomen } : {}),
      modusId: opts.modusId,
      aditusBase,
      tractus: opts.tractus,
      numerus: opts.total,
      provenanceHash: provenance,
      by,
      ...(sodalitasId !== undefined ? { sodalitasId } : {}),
      ...(owners !== undefined ? { owners } : {}),
      concurrentia: opts.concurrentia ?? 3,
      ...(opts.dna !== undefined ? { dna: opts.dna } : {}),
      status: 'nascens',
    })
    await collectioCursor.start(collectio)
    return toCollection((await collectiones.find(collectio.id)) ?? collectio)
  }

  /** Fetch a Collection, owner-scoped. */
  async getCollection(auctor: AuctorKey, id: string): Promise<Collection> {
    return toCollection(await this._ownedCollection(auctor, id))
  }

  /**
   * The target-vs-realized rarity table for a Collection — what the creator
   * dialled in (normalized `TraitValor.rarity`) vs what was actually produced
   * (counted from the `_attributes` stamped on each completed piece). Drift is
   * expected at low N. Owner-scoped. Counts only successfully-produced,
   * non-rejected pieces.
   */
  async getCollectionRarity(auctor: AuctorKey, id: string): Promise<RarityReport> {
    const c = await this._ownedCollection(auctor, id)
    const pieces: Array<Array<{ trait_type: string; value: string }>> = []
    for (const actumId of c.acta) {
      const actum = await this.deps.actorum.findById(actumId)
      if (!actum || actum.status !== 'completus') continue
      if (actum.exitus?.reviewOutcome === 'rejected') continue
      const attrs = actum.aditus?._attributes
      if (Array.isArray(attrs)) pieces.push(attrs as Array<{ trait_type: string; value: string }>)
    }
    return rarityReport({ tractus: c.tractus, pieces })
  }

  /** List the caller's Collections. */
  async listCollections(auctor: AuctorKey): Promise<Collection[]> {
    const all = (await this.deps.collectiones?.list()) ?? []
    // Resolve the caller's team ids ONCE (not one lookup per collection).
    const teamIds =
      'animaId' in auctor && this.deps.sodalitatum
        ? new Set((await this.deps.sodalitatum.listByMember(auctor.animaId)).map((t) => t.id))
        : new Set<string>()
    return all.filter((c) => this._ownsCollectionWith(auctor, c, teamIds)).map(toCollection)
  }

  /** Synchronous ownership check given a precomputed set of the caller's team ids. */
  private _ownsCollectionWith(auctor: AuctorKey, c: Collectio, teamIds: Set<string>): boolean {
    if (this._isFunder(auctor, c)) return true
    return c.sodalitasId !== undefined && teamIds.has(c.sodalitasId)
  }

  /**
   * Extend a Collection's target by `addCount` and dispatch the new pieces —
   * the incremental-batch primitive (fire a batch, review, fire more toward a
   * larger goal over time). Re-opens a completed Collection. Owner-scoped.
   */
  async extendCollection(auctor: AuctorKey, id: string, addCount: number): Promise<Collection> {
    const c = await this._ownedCollection(auctor, id)
    // Extending dispatches new pieces funded by the collection's `by` (the
    // creator). Only that funder may extend — otherwise a team member could
    // spend the creator's balance. Pooled-funding extend arrives with the team
    // ledger (deferred).
    if (!this._isFunder(auctor, c)) {
      throw Errors.authForbidden('only the collection funder can extend it (team-pooled funding is not yet available)')
    }
    await this.deps.collectioCursor?.extend(id, addCount)
    return toCollection((await this.deps.collectiones!.find(id))!)
  }

  /** Whether the caller is the concrete funding identity of a collection (its `by`). */
  private _isFunder(auctor: AuctorKey, c: Collectio): boolean {
    if ('animaId' in auctor && 'animaId' in c.by) return c.by.animaId === auctor.animaId
    if ('commitment' in auctor && 'commitment' in c.by) return c.by.commitment === auctor.commitment
    return false
  }

  /** Pause dispatching new pieces (in-flight finish). Owner-scoped. */
  async pauseCollection(auctor: AuctorKey, id: string): Promise<Collection> {
    const c = await this._ownedCollection(auctor, id)
    await this.deps.collectioCursor?.pause(id)
    return toCollection(c)
  }

  /** Resume dispatching after a pause. Owner-scoped. */
  async resumeCollection(auctor: AuctorKey, id: string): Promise<Collection> {
    const c = await this._ownedCollection(auctor, id)
    await this.deps.collectioCursor?.resume(id)
    return toCollection(c)
  }

  /** Cancel a Collection — stop dispatching + mark cancellata. Owner-scoped. */
  async cancelCollection(auctor: AuctorKey, id: string): Promise<Collection> {
    await this._ownedCollection(auctor, id)
    await this.deps.collectioCursor?.pause(id)
    return toCollection(await this.deps.collectiones!.update(id, { status: 'cancellata' }))
  }

  /** Review: approve a pending piece (it counts toward the collection). Owner-scoped. */
  async approveCollectionPiece(auctor: AuctorKey, id: string, actumId: string): Promise<void> {
    await this._ownedCollection(auctor, id)
    await this.deps.collectioCursor?.approveActum(id, actumId)
  }

  /** Review: reject a pending piece and reroll it with a fresh seed. Owner-scoped. */
  async rejectCollectionPiece(auctor: AuctorKey, id: string, actumId: string): Promise<void> {
    await this._ownedCollection(auctor, id)
    await this.deps.collectioCursor?.rejectAndRevive(id, actumId)
  }

  // ── Publishing (Editio) ─────────────────────────────────────────────────────

  /**
   * Publish an artifact — put a canonical `Actum`/`Intella`/`Collectio` forth to a
   * destination (an adapter, keyed by `destination`) under a visibility/custody/
   * rights policy. Creates an `Editio` (a publication record; the artifact is only
   * referenced, never copied) and settles it:
   *   - PUBLIC surfaces (`feed`/`marketplace`) go `pending` → async moderation
   *     scan → `published` | `rejected`. NEVER a synchronous publish to public.
   *   - private/unlisted publish synchronously (no moderation gate).
   * Unspecified fields default from the caller's `Anima.publicatio` prefs. Returns
   * the public Edition (pending for a public surface; settled otherwise).
   */
  async publish(auctor: AuctorKey, opts: PublishOpts): Promise<Edition> {
    const editiones = this.deps.editiones
    if (!editiones) throw Errors.notFoundEdition('publishing')

    const by = this._editionBy(auctor)
    const prefs = await this._publishingPrefs(auctor)
    const destination = opts.destination ?? prefs?.defaultDestination ?? 'feed'
    // Validate the destination up front (mirrors collect validating the modus).
    this._resolveAdapter(destination)
    // Default visibility by destination: the feed/on-chain/market destinations are
    // inherently PUBLIC surfaces (so a mint/list runs through the moderation gate),
    // everything else is private. Explicit opts/prefs still win.
    const visibility = opts.visibility ?? prefs?.defaultVisibility ??
      (destination === 'feed' ? 'feed'
        : destination === 'mint' || destination === 'marketplace' ? 'marketplace'
        : 'private')
    const custody = opts.custody ?? prefs?.defaultCustody ?? 'ours'

    // A model (Intella) has a binary resolvability (public/private), not a media
    // surface — it never belongs in the image feed/marketplace (those render an
    // Actum's media). Keep models on private/unlisted; reconcile maps that to access.
    if (opts.artifact.kind === 'intella' && (visibility === 'feed' || visibility === 'marketplace')) {
      throw Errors.inputMalformed("a model publishes to 'private' or 'unlisted', not the media feed/marketplace")
    }

    // The caller must own the artifact they are putting forth. Resolves the artifact
    // (model / collection) so the freeze + license below reuse it — one read, not two.
    const ref: ArtifactRef = { kind: opts.artifact.kind, id: opts.artifact.id }
    const owned = await this._assertOwnsArtifact(auctor, ref)

    // Freeze boundary (#5, spec §4e): a Collectio put on-chain or to a marketplace
    // must be COMPLETE — you cannot freeze the canon of a drop that is still minting
    // pieces. (Mutable team/collection above the freeze, immutable drop below it.)
    if (owned.collectio && (destination === 'mint' || destination === 'marketplace') && owned.collectio.status !== 'completa') {
      throw Errors.inputMalformed('a collection must be complete before it can be minted or listed')
    }

    // Rights split (snapshotted on the Editio — the canonical "who earns" record):
    // an explicit weighted split, an equal-weight snapshot of a team's membership,
    // or — for a Collectio with no explicit split — the collection's own owners[]
    // re-snapshotted at freeze (the §4e "frozen drop below" rule).
    if (opts.owners !== undefined && opts.teamId !== undefined) {
      throw Errors.inputMalformed('provide either owners or teamId, not both')
    }
    let owners: Editio['owners']
    if (opts.owners !== undefined) {
      owners = this._validateOwners(opts.owners)
    } else if (opts.teamId !== undefined) {
      const team = await this._memberTeam(auctor, opts.teamId)
      owners = team.membra.map((animaId) => ({ animaId, weight: 1 / team.membra.length }))
    } else if (owned.collectio?.owners?.length) {
      owners = this._validateOwners(owned.collectio.owners)
    }

    // License tag (the compliance catalog/BYO line): explicit, then prefs, then
    // 'catalog' for a platform-canonical artifact (our license/liability), else unset.
    const license = opts.license ?? prefs?.defaultLicense ?? (owned.intella?.canonica ? 'catalog' : undefined)

    const editio = await editiones.create({
      artifactRef: ref,
      destination,
      visibility,
      custody,
      by,
      ...(owners !== undefined ? { owners } : {}),
      ...(license !== undefined ? { license } : {}),
    })

    if (visibility === 'feed' || visibility === 'marketplace') {
      // Public surface — never block the ack on the scan; settle asynchronously.
      this._publishScheduler()(() => this._settlePublication(editio.id))
      return toEdition(editio)
    }
    // Private/unlisted — no moderation gate; settle inline.
    await this._settlePublication(editio.id)
    return toEdition((await editiones.find(editio.id)) ?? editio)
  }

  /** The public feed — published, public-surface Editiones, newest first. NOT
   *  owner-scoped (the feed is public). Each item carries the referenced artifact's
   *  produced output so a client can render it without a second fetch. */
  async feed(filter?: FeedFilter): Promise<FeedItem[]> {
    const editiones = this.deps.editiones
    if (!editiones) return []
    // The feed is a PUBLIC surface — clamp to public visibilities so a caller can
    // never enumerate private/unlisted editions via `?visibility=…` (only 'feed'
    // and 'marketplace' are public; everything else collapses to 'feed').
    const visibility = filter?.visibility === 'marketplace' ? 'marketplace' : 'feed'
    const items = await editiones.listFeed({ ...filter, visibility })
    const out: FeedItem[] = []
    for (const e of items) {
      const output = await this._artifactOutput(e.artifactRef)
      out.push({
        editionId: e.id,
        artifact: { kind: e.artifactRef.kind, id: e.artifactRef.id },
        ...(output !== undefined ? { output } : {}),
        createdAt: e.natum.toISOString(),
      })
    }
    return out
  }

  /** Retract a publication where the destination allows it (feed/bucket = revocable;
   *  mint = permanent → 403). Author-scoped: only the publishing identity may retract. */
  async retractEdition(auctor: AuctorKey, id: string): Promise<Edition> {
    const editiones = this.deps.editiones
    if (!editiones) throw Errors.notFoundEdition(id)
    const e = await editiones.find(id)
    if (!e || !this._isEditionAuthor(auctor, e)) throw Errors.notFoundEdition(id)
    const adapter = this._resolveAdapter(e.destination)
    if (!adapter.retract) throw Errors.authForbidden(`'${e.destination}' publications cannot be retracted (permanent)`)
    await adapter.retract(e)
    const updated = await editiones.update(id, { status: 'retracted' })
    await this._reconcile(updated)
    return toEdition(updated)
  }

  /** Run the moderation gate (public surfaces only) then the adapter publish,
   *  recording the outcome on the Editio. Pending → published | rejected | failed. */
  private async _settlePublication(editioId: string): Promise<void> {
    const editiones = this.deps.editiones
    if (!editiones) return
    const e = await editiones.find(editioId)
    if (!e || e.status !== 'pending') return

    const artifact = { ref: e.artifactRef, output: await this._artifactOutput(e.artifactRef), editioId: e.id }
    if (e.visibility === 'feed' || e.visibility === 'marketplace') {
      const verdict = await this._moderationGate().scan(artifact)
      if (!verdict.ok) {
        await editiones.update(editioId, { status: 'rejected' })
        return
      }
    }
    try {
      const adapter = this._resolveAdapter(e.destination)
      const custodyTarget = await this._custodyTarget(e)
      const { externalRef } = await adapter.publish(artifact, {
        visibility: e.visibility,
        custody: e.custody,
        ...(e.owners !== undefined ? { owners: e.owners } : {}),
        ...(e.license !== undefined ? { license: e.license } : {}),
        ...(custodyTarget !== undefined ? { custodyTarget } : {}),
      })
      const published = await editiones.update(editioId, { status: 'published', externalRef })
      await this._reconcile(published)
    } catch {
      await editiones.update(editioId, { status: 'failed' })
    }
  }

  /**
   * §5d reconciler seam — `Editio` OWNS visibility/custody/rights; `Intella.access`
   * (and the Collectio public projection) DERIVE from it. DECISION: write-through
   * here (not an event hook) — the single place a publish/retract settles is the
   * single place the derived flag updates, so the two cannot drift. Only `intella`
   * artifacts have a derived flag; `actum`/`collectio` are a safe no-op. Intella
   * publishing is build-order #3 — this is its documented attachment point.
   */
  private async _reconcile(editio: Editio): Promise<void> {
    if (editio.artifactRef.kind !== 'intella') return
    // A model's resolvability DERIVES from its Editio: published-public → 'public'
    // (anyone can resolve it by trigger), retracted/private → 'private'. The royalty
    // payee (§5e) is the model's own `auctor`, which a public publish does not change
    // — making it resolvable IS the same decision as who earns when it is used.
    const isPublic = editio.status === 'published' && editio.visibility !== 'private'
    await this.deps.intellarum?.setAccess?.(editio.artifactRef.id, isPublic ? 'public' : 'private')
  }

  /** The BYO custody target (account) for a `custody:'theirs'` model publish, from the
   *  author's prefs — HuggingFace/Civitai account by destination. Undefined otherwise. */
  private async _custodyTarget(e: Editio): Promise<{ account?: string } | undefined> {
    if (e.custody !== 'theirs') return undefined
    const prefs = await this._publishingPrefs(e.by)
    const account = e.destination === 'civitai' ? prefs?.civitaiAccount : prefs?.huggingFaceAccount
    return account ? { account } : undefined
  }

  /** Resolve a registered publication adapter by key, or 404. */
  private _resolveAdapter(key: string): PublicationAdapter {
    const adapter = this.deps.publicationAdapters?.find((a) => a.key === key)
    if (!adapter) throw Errors.notFoundAdapter(key)
    return adapter
  }

  /** The →public moderation gate, or the permissive placeholder if none is wired. */
  private _moderationGate(): ModerationGate {
    return this.deps.moderationGate ?? permissiveModerationGate
  }

  /** The async-settle scheduler, or fire-and-forget if none is wired. */
  private _publishScheduler(): (task: () => Promise<void>) => void {
    return this.deps.publishScheduler ?? ((task) => { void task().catch(() => {}) })
  }

  /** An Editio owns by `{animaId}|{commitment}` only — bursaToken has no persistent owner. */
  private _editionBy(auctor: AuctorKey): Editio['by'] {
    if ('animaId' in auctor) return { animaId: auctor.animaId }
    if ('commitment' in auctor) return { commitment: auctor.commitment }
    throw Errors.authForbidden('Publishing requires an identified or commitment account')
  }

  private _isEditionAuthor(auctor: AuctorKey, e: Editio): boolean {
    if ('animaId' in auctor && 'animaId' in e.by) return e.by.animaId === auctor.animaId
    if ('commitment' in auctor && 'commitment' in e.by) return e.by.commitment === auctor.commitment
    return false
  }

  /** The caller's per-identity publishing prefs (identified callers only). */
  private async _publishingPrefs(auctor: AuctorKey): Promise<PublishingPrefs | undefined> {
    if (!('animaId' in auctor) || !this.deps.animae) return undefined
    return (await this.deps.animae.find(auctor.animaId))?.publicatio
  }

  /** Verify the caller owns the artifact being published, or throw not-found. Returns
   *  the resolved artifact for the kinds the caller reuses (an Intella for the license
   *  default, a Collectio for the freeze boundary); `{}` for an Actum. */
  private async _assertOwnsArtifact(auctor: AuctorKey, ref: ArtifactRef): Promise<{ intella?: Intella; collectio?: Collectio }> {
    if (ref.kind === 'actum') {
      const a = await this.deps.actorum.findById(ref.id)
      if (!a || !(await this._owns(auctor, a))) throw Errors.notFoundRun(ref.id)
      return {}
    }
    if (ref.kind === 'collectio') {
      // throws not_found.collection if absent / not owned
      return { collectio: await this._ownedCollection(auctor, ref.id) }
    }
    // Intella (model): owned by its `ownerAnimaId` (private LoRAs) or `auctor`.
    // Platform-canonical models have neither set to a user → not user-publishable.
    const intella = await this._ownedIntella(auctor, ref.id)
    if (!intella) throw Errors.notFoundModel(ref.id)
    return { intella }
  }

  /** Validate an explicit rights split: non-empty, positive weights summing to ~1. */
  private _validateOwners(owners: Array<{ animaId: string; weight: number }>): Editio['owners'] {
    if (owners.length === 0) throw Errors.inputMalformed('owners must be non-empty')
    let sum = 0
    for (const o of owners) {
      if (!o.animaId) throw Errors.inputMalformed('each owner needs an animaId')
      if (!(o.weight > 0)) throw Errors.inputMalformed('each owner weight must be > 0')
      sum += o.weight
    }
    if (Math.abs(sum - 1) > 1e-6) throw Errors.inputMalformed(`owner weights must sum to 1 (got ${sum})`)
    return owners
  }

  /** Resolve an Intella the caller owns, or null. Models lacking the store are unavailable. */
  private async _ownedIntella(auctor: AuctorKey, id: string): Promise<Intella | null> {
    if (!('animaId' in auctor) || !this.deps.intellarum) return null
    const intella = await this.deps.intellarum.find(id)
    if (!intella) return null
    const owns = intella.ownerAnimaId === auctor.animaId || intella.auctor === auctor.animaId
    return owns ? intella : null
  }

  /** The payload an adapter is handed for an artifact: an Actum's exitus media, or a
   *  model's publishable view (sources + naming) for the registry adapters. */
  private async _artifactOutput(ref: ArtifactRef): Promise<Record<string, unknown> | undefined> {
    if (ref.kind === 'actum') return (await this.deps.actorum.findById(ref.id))?.exitus
    if (ref.kind === 'intella') {
      const m = await this.deps.intellarum?.find(ref.id)
      if (!m) return undefined
      return {
        nomen: m.nomen, genus: m.genus, sources: m.sources,
        ...(m.slug !== undefined ? { slug: m.slug } : {}),
        ...(m.trigger !== undefined ? { trigger: m.trigger } : {}),
        ...(m.familia !== undefined ? { familia: m.familia } : {}),
        ...(m.auctor !== undefined ? { auctor: m.auctor } : {}),
      }
    }
    if (ref.kind === 'collectio') {
      // The freeze manifest the mint/marketplace adapters content-address (§4e):
      // the generative provenance + the drop size. Ownership is on the policy.
      const c = await this.deps.collectiones?.find(ref.id)
      if (!c) return undefined
      return {
        provenanceHash: c.provenanceHash,
        numerus: c.numerus,
        ...(c.nomen !== undefined ? { nomen: c.nomen } : {}),
      }
    }
    return undefined
  }

  // ── Teams (Sodalitas) ───────────────────────────────────────────────────────

  /**
   * Create a team — a Sodalitas the caller founds and is the first member of.
   * `members` are additional Anima ids to seed (the caller is always included).
   * Teams require an identified (animaId) caller.
   */
  async createTeam(auctor: AuctorKey, opts: { nomen: string; members?: string[] }): Promise<Team> {
    const animaId = this._teamAnimaId(auctor)
    const store = this._teamStore()
    const membra = [...new Set([animaId, ...(opts.members ?? [])])]
    return toTeam(await store.create({ nomen: opts.nomen, auctor: animaId, membra }))
  }

  /** Fetch a team — members-only. */
  async getTeam(auctor: AuctorKey, id: string): Promise<Team> {
    return toTeam(await this._memberTeam(auctor, id))
  }

  /** List the caller's teams (every Sodalitas they are a member of). */
  async listTeams(auctor: AuctorKey): Promise<Team[]> {
    const animaId = this._teamAnimaId(auctor)
    return (await this._teamStore().listByMember(animaId)).map(toTeam)
  }

  /** Add a member to a team — members-only. Idempotent. */
  async addTeamMember(auctor: AuctorKey, id: string, animaId: string): Promise<Team> {
    const team = await this._memberTeam(auctor, id)
    if (team.membra.includes(animaId)) return toTeam(team)
    return toTeam(await this._teamStore().update(id, { membra: [...team.membra, animaId] }))
  }

  /** Remove a member from a team — members-only. The `auctor` (founder) cannot be removed. */
  async removeTeamMember(auctor: AuctorKey, id: string, animaId: string): Promise<Team> {
    const team = await this._memberTeam(auctor, id)
    if (animaId === team.auctor) throw Errors.authForbidden('the team founder cannot be removed')
    return toTeam(await this._teamStore().update(id, { membra: team.membra.filter((m) => m !== animaId) }))
  }

  private _teamStore(): Sodalitatum {
    const store = this.deps.sodalitatum
    if (!store) throw Errors.notFoundTeam('teams')
    return store
  }

  /** Teams are animaId-keyed — anonymous (commitment/bursa) callers cannot own or join them. */
  private _teamAnimaId(auctor: AuctorKey): string {
    if ('animaId' in auctor) return auctor.animaId
    throw Errors.authForbidden('teams require an identified account')
  }

  /** Resolve a team the caller is a member of, or 404. */
  private async _memberTeam(auctor: AuctorKey, id: string): Promise<Sodalitas> {
    const animaId = this._teamAnimaId(auctor)
    const team = await this._teamStore().find(id)
    if (!team || !team.membra.includes(animaId)) throw Errors.notFoundTeam(id)
    return team
  }

  /** A Collectio owns by `{animaId}|{commitment}` only — bursaToken/proof have no persistent owner record. */
  private _collectionBy(auctor: AuctorKey): Collectio['by'] {
    if ('animaId' in auctor) return { animaId: auctor.animaId }
    if ('commitment' in auctor) return { commitment: auctor.commitment }
    throw Errors.authForbidden('Collections require an identified or commitment account')
  }

  private async _ownsCollection(auctor: AuctorKey, c: Collectio): Promise<boolean> {
    // Direct owner (the funding identity).
    if (this._isFunder(auctor, c)) return true
    // Team overlay: every member of the Sodalitas owns it.
    if ('animaId' in auctor && c.sodalitasId !== undefined) {
      const team = await this.deps.sodalitatum?.find(c.sodalitasId)
      return team?.membra.includes(auctor.animaId) ?? false
    }
    return false
  }

  private async _ownedCollection(auctor: AuctorKey, id: string): Promise<Collectio> {
    const c = await this.deps.collectiones?.find(id)
    if (!c || !(await this._ownsCollection(auctor, c))) throw Errors.notFoundCollection(id)
    return c
  }

  /** List the canonical flows (atomic + compositus spells) as compact summaries. */
  async listFlows(): Promise<FlowSummary[]> {
    const modi = await this.deps.modorum.list({ canonica: true })
    return modi.map((m) => {
      // `categoria` is an optional catalog tag not on the core Modus type — read it
      // off whatever the registry carries without widening the primitive.
      const categoria = (m as { categoria?: unknown }).categoria
      return {
        id: m.id,
        nomen: m.nomen,
        versio: m.versio,
        ...(categoria !== undefined ? { categoria } : {}),
        ...(m.genus === 'compositus' ? { steps: m.gradus?.length ?? 0 } : {}),
      }
    })
  }

  /** Describe one flow's JSON-Schema input/output. Unknown id → `not_found.flow`. */
  async describeFlow(id: string): Promise<FlowDescription> {
    const m = await this.deps.modorum.find(id)
    if (!m) throw Errors.notFoundFlow(id)
    // Modus carries every field describeFlow reads; the cast supplies the
    // index-signature DescribableModus declares for its passthrough meta.
    return describeFlow(m as unknown as DescribableModus)
  }

  /**
   * Quote a run's cost WITHOUT dispatching — the upper-bound reservation the cursor
   * declares for this modus + aditus (side-effect-free; `run().impetus ≤ reserve()`).
   * Exact for fixed-cost flows, an upper bound for duration-based pod flows.
   */
  async quote(auctor: AuctorKey, target: InvokeTarget, aditus: Record<string, unknown>): Promise<{ impetus: string; recipient: string }> {
    let modusId: string | undefined = target.modusId
    if (!modusId && target.verb) {
      modusId = (await this.deps.consuetudinum?.resolve(auctor, target.verb)) ?? CANON_VERBS[target.verb]
    }
    if (!modusId) throw Errors.notFoundFlow(target.verb ?? '?')
    return {
      impetus:   (await this._estimate(modusId, aditus)).toString(),
      recipient: computeRecipient(modusId, aditus),
    }
  }

  /**
   * The cursor's read-only upper-bound reservation for a modus + aditus.
   *
   * A compositus (spell) has no cursor of its own — its estimate is the SUM of its
   * steps' reservations (ADR-0008). Per-step aditus is bound by name from the cast
   * inputs only; values that a step would receive via `ligamina` (a prior step's
   * exitus) aren't known until run time, so this is an estimate, not a guarantee —
   * which is the right contract for a storefront price (cold-start / GPU-fit make
   * every upfront number an approximation).
   */
  private async _estimate(modusId: string, aditus: Record<string, unknown>): Promise<bigint> {
    const modus = await this.deps.modorum.find(modusId)
    if (!modus) throw Errors.notFoundFlow(modusId)

    if (modus.genus === 'compositus') {
      let total = 0n
      for (const g of modus.gradus ?? []) {
        const child = await this.deps.modorum.find(g.modusId)
        if (!child) continue  // validated for real at dispatch; a missing child just doesn't add cost here
        const childAditus: Record<string, unknown> = {}
        for (const key of Object.keys(child.aditus)) {
          if (key in aditus) childAditus[key] = aditus[key]
        }
        total += await this.deps.cursorum.resolve(child).reserve(child, childAditus)
      }
      return total
    }

    return this.deps.cursorum.resolve(modus).reserve(modus, aditus)
  }

  /** List the canonical compute substrates (fundamenta) an agent can arm a studio on. */
  async listFundamenta(): Promise<Array<{ id: string; nomen?: string; versio: string; runtime?: string; imageId: string; imageVersion: string; vramGb?: number }>> {
    const funds = await this.deps.fundamentorum.list({ canonica: true })
    return funds.map((f) => ({
      id: f.id, versio: f.versio, imageId: f.imageId, imageVersion: f.imageVersion,
      ...(f.nomen ? { nomen: f.nomen } : {}),
      ...(f.runtime ? { runtime: f.runtime } : {}),
      ...(f.vramGb !== undefined ? { vramGb: f.vramGb } : {}),
    }))
  }

  /**
   * The filterable model catalog (the agent twin of the bot's picker): by `genus`
   * (lora/checkpoint/…), `basis` (the base family a weight is for), `fundamentumId`
   * (resolved to the substrate's base family), `trigger` (a LoRA trigger word, matched
   * against `verba`), and `q` (free text via the store's search). Each result is a
   * card so the agent can decide, not just enumerate.
   */
  async listModels(filter: { genus?: IntelligensGenus; basis?: string; fundamentumId?: string; trigger?: string; q?: string; limit?: number } = {}): Promise<ModelCard[]> {
    let basis = filter.basis
    if (!basis && filter.fundamentumId) {
      const f = await this.deps.fundamentorum.find(filter.fundamentumId).catch(() => null)
      if (f) {
        for (const w of f.intellae ?? []) {
          const wi = await this.deps.intelligendi.find(w.id).catch(() => null)
          if (wi?.basis) { basis = wi.basis; break }
        }
      }
    }
    const q = filter.q?.trim()
    // Free-text → the store's search; otherwise the structured filter. Apply the
    // remaining constraints in-memory (search isn't field-filtered).
    const base = q
      ? await this.deps.intelligendi.search(q)
      : await this.deps.intelligendi.list({ canonica: true, ...(filter.genus ? { genus: filter.genus } : {}), ...(basis ? { basis } : {}) })
    const trig = filter.trigger?.trim().toLowerCase()
    const hits = base.filter((i) => {
      if (filter.genus && i.genus !== filter.genus) return false
      if (basis && i.basis !== basis) return false
      if (trig && !(i.verba ?? []).some((v) => v.toLowerCase() === trig)) return false
      return true
    })
    const limited = filter.limit ? hits.slice(0, filter.limit) : hits
    return limited.map(toModelCard)
  }

  /**
   * Save a reusable, owner-keyed flow — the agent twin of the bot's Save-as. Derive a
   * new Modus from a base (an owned run via `fromRun`, or an explicit `modusId`), baking
   * the captured `aditus` as input defaults + folding pinned LoRAs + prompt affixes. The
   * chosen name yields a global-unique slug (collision → `conflict.slug_taken`).
   */
  async saveFlow(auctor: AuctorKey, opts: SaveFlowOpts): Promise<{ id: string }> {
    if ('bursaToken' in auctor) throw Errors.authForbidden('Bursa tokens cannot own saved flows')
    let baseModusId = opts.modusId
    let aditus = opts.aditus ?? {}
    let pinned = opts.pinnedModels
    if (opts.fromRun) {
      const a = await this.deps.actorum.findById(opts.fromRun)
      if (!a || !(await this._owns(auctor, a))) throw Errors.notFoundRun(opts.fromRun)
      baseModusId = a.modusId
      if (opts.aditus === undefined) aditus = a.aditus ?? {}
      if (pinned === undefined && a.pinnedModels) pinned = a.pinnedModels.map((m) => ({ id: m.id }))
    }
    if (!baseModusId) throw Errors.inputMalformed('saveFlow needs fromRun or modusId')
    const base = await this.deps.modorum.find(baseModusId)
    if (!base) throw Errors.notFoundFlow(baseModusId)

    const slug = slugify(opts.name)
    if (!slug) throw Errors.inputMalformed('name produces an empty slug')
    if (await this.deps.modorum.find(slug)) throw Errors.conflictSlug(slug)

    const derived = deriveSavedModus(base, {
      slug, name: opts.name, owner: auctor, aditus,
      promptMode: opts.promptMode ?? 'open',
      ...(opts.affix?.prefix ? { promptPraefixum: opts.affix.prefix } : {}),
      ...(opts.affix?.suffix ? { promptSuffixum: opts.affix.suffix } : {}),
      ...(pinned ? { pinned } : {}),
    })
    await this.deps.modorum.register(derived)
    return { id: derived.id }
  }

  /** Rebind one of the caller's canon verbs to a flow (owner-keyed Consuetudinum). */
  async bind(auctor: AuctorKey, verb: string, modusId: string): Promise<{ verb: string; modusId: string }> {
    if ('bursaToken' in auctor) throw Errors.authForbidden('Bursa tokens cannot rebind verbs')
    if (!this.deps.consuetudinum) throw Errors.internal('verb binding not configured')
    if (!(verb in CANON_VERBS)) throw Errors.inputMalformed(`'${verb}' is not a rebindable verb`)
    if (!(await this.deps.modorum.find(modusId))) throw Errors.notFoundFlow(modusId)
    await this.deps.consuetudinum.bind(auctor, verb, modusId)
    return { verb, modusId }
  }

  /** The caller's account snapshot — balance, in-flight gens, studios (JSON-projected). */
  async status(auctor: AuctorKey): Promise<StatusView> {
    const snap = await aggregateStatus(
      {
        signorum: this.deps.signorum, hospitia: this.deps.hospitia, materiae: this.deps.materiae,
        actorum: this.deps.actorum, modorum: this.deps.modorum,
        ...(this.deps.actumIndex ? { actumIndex: this.deps.actumIndex } : {}),
        ...(this.deps.modos ? { modos: this.deps.modos } : {}),
      },
      { auctorKey: auctor, inFlightActumIds: [] },
    )
    return {
      balanceImpetus: snap.balanceImpetus.toString(),
      balanceUsd: snap.balanceUsd,
      gens: snap.gens,
      // StudioEntry carries a bigint (`netImpetus`) — stringify it so the whole view
      // is JSON-safe (res.json/JSON.stringify throw on a raw bigint).
      studios: snap.studios.map((s) => ({ ...s, netImpetus: s.netImpetus.toString() })),
      joinable: snap.joinable,
      takenAt: snap.takenAt.toISOString(),
    }
  }

  /**
   * Lease a hosted studio for the caller (the agent twin of the bot's `/arm` Start) —
   * the `Conductor` provisions a warm pod, binds it to the caller (Hospitium), installs
   * the loadout, and opens a budgeted `Modo` session. Returns the studio handle; its
   * `studioId` is what `POST /v1/runs { studioId }` targets.
   *
   * The `maxImpetus` cap IS the session budget (the tessera): `Census` drain-terminates
   * the studio once accrued spend crosses it (the watchdog). Absent → the caller's full
   * balance is the budget. A zero budget is refused (`economy.insufficient_signa`).
   */
  async provisionStudio(auctor: AuctorKey, opts: ProvisionStudioOpts = {}): Promise<StudioView> {
    if ('bursaToken' in auctor) throw Errors.authForbidden('Bursa tokens cannot provision studios')
    if (!this.deps.conductor) throw Errors.studioUnavailable()

    // A fundamentum (when given) supplies the runtime + must resolve (no opaque ids).
    let runtime = opts.runtime
    if (opts.fundamentumId) {
      const f = await this.deps.fundamentorum.find(opts.fundamentumId).catch(() => null)
      if (!f) throw Errors.notFoundFundamentum(opts.fundamentumId)
      runtime = runtime ?? f.runtime
    }

    const balance = await this.deps.signorum.balance(auctor)
    const budget = opts.maxImpetus !== undefined ? BigInt(opts.maxImpetus) : balance
    if (budget <= 0n) throw Errors.insufficientSigna({ available: balance.toString() })

    // ASYNC handle: returns a `provisioning` studio immediately; the pod boots in the
    // background (observe via getStudio/listStudios, or the optional webhook on ready/failed).
    const conduceOpts: ConduceOpts = {
      budget,
      ...(opts.models?.length ? { models: opts.models } : {}),
      ...(opts.warmMs !== undefined ? { warmMs: opts.warmMs } : {}),
      ...(runtime ? { runtime } : {}),
    }
    const webhookUrl = opts.webhookUrl
    const onSettled = (webhookUrl && this.deps.notify)
      ? (settled: StudioHandle | null) =>
          this.deps.notify!(webhookUrl, { studio: settled ? toStudioView(settled, budget) : { studioId: null, status: 'failed' } })
      : undefined
    const handle = await this.deps.conductor.conducereAsync(auctor, conduceOpts, onSettled)
    return toStudioView(handle, budget)
  }

  /** One of the caller's studios by id — owner-scoped (a stranger gets `not_found.studio`,
   *  no leak). Works for an in-flight (provisioning) studio too. */
  async getStudio(auctor: AuctorKey, studioId: string): Promise<StudioView> {
    if (!this.deps.conductor) throw Errors.notFoundStudio(studioId)
    const handle = await this.deps.conductor.getStudio(studioId, auctor)
    if (!handle) throw Errors.notFoundStudio(studioId)
    return toStudioView(handle, await this.deps.signorum.sessionBudget(studioId).catch(() => 0n))
  }

  /** The caller's live studios (the agent twin of the bulletin's studio list). Empty when
   *  no provisioning rail is wired. Includes in-flight (provisioning) studios. */
  async listStudios(auctor: AuctorKey): Promise<StudioView[]> {
    if (!this.deps.conductor) return []
    const handles = await this.deps.conductor.find(auctor)
    return Promise.all(handles.map(async (h) =>
      toStudioView(h, await this.deps.signorum.sessionBudget(h.studioId).catch(() => 0n))))
  }

  // ── TEE private compute sessions ─────────────────────────────────────────────

  private readonly teeSessions = new Map<string, TeeSession>()

  async provisionTeeSession(auctor: AuctorKey, opts: ProvisionTeeSessionOpts): Promise<TeeSessionView> {
    if ('bursaToken' in auctor) throw Errors.authForbidden('Bursa tokens cannot provision TEE sessions')
    const balance = await this.deps.signorum.balance(auctor)
    const budget = opts.maxImpetus !== undefined ? BigInt(opts.maxImpetus) : balance
    if (budget <= 0n) throw Errors.insufficientSigna({ available: balance.toString() })

    const sessionId = randomUUID()
    this.teeSessions.set(sessionId, {
      sessionId,
      auctor,
      status: 'provisioning',
      gpuClass: opts.gpuClass,
      budgetImpetus: budget,
      wgClientPublicKey: opts.wgClientPublicKey,
      ...(opts.costPerHrUsd !== undefined ? { costPerHrUsd: opts.costPerHrUsd } : {}),
      wsProbeAttempts: 0,
      lastBilledGpuHours: 0,
      spentImpetus: 0n,
      createdAt: new Date(),
    })

    if (this.deps.teeProvisioner) {
      // Fire-and-forget: pod boot is async; session transitions to 'ready' via /runner/ready callback.
      // onPodCreated sets podId immediately after _startPod() so that when the runner/ready callback
      // arrives (while _waitForRuntime is still polling), session.podId is already set and
      // handleRunnerReady picks the correct RunPod proxy URL instead of the localhost fallback.
      this.deps.teeProvisioner.provision(sessionId, opts.wgClientPublicKey, (podId) => {
        const s = this.teeSessions.get(sessionId)
        if (s) s.podId = podId
      }).then(result => {
        const s = this.teeSessions.get(sessionId)
        if (!s) return
        s.podId = result.podId
        if (result.costPerHrUsd !== undefined) s.costPerHrUsd = result.costPerHrUsd
      }).catch(err => {
        const s = this.teeSessions.get(sessionId)
        if (s) { s.status = 'ended'; s.error = String(err) }
        console.error('[tee] pod provision failed', { sessionId, err: String(err) })
      })
    }
    // Without teeProvisioner (local dev): start runner.py manually with SESSION_ID matching sessionId.

    return toTeeSessionView(this.teeSessions.get(sessionId)!)
  }

  async getTeeSession(auctor: AuctorKey, sessionId: string): Promise<TeeSessionView> {
    const session = this.teeSessions.get(sessionId)
    if (!session || !_auctorMatch(session.auctor, auctor)) throw Errors.notFoundStudio(sessionId)
    return toTeeSessionView(session)
  }

  async endTeeSession(auctor: AuctorKey, sessionId: string): Promise<void> {
    const session = this.teeSessions.get(sessionId)
    if (!session || !_auctorMatch(session.auctor, auctor)) throw Errors.notFoundStudio(sessionId)
    session.status = 'ended'
    if (session.podId && this.deps.teeProvisioner) {
      await this.deps.teeProvisioner.terminate(session.podId).catch(err =>
        console.warn('[tee] pod terminate failed', { sessionId, podId: session.podId, err: String(err) })
      )
    }
  }

  async handleRunnerReady(signal: RunnerReadySignal): Promise<void> {
    console.info('[tee] runner ready', { sessionId: signal.sessionId, wgKey: signal.wgPublicKey?.slice(0, 12) })
    if (signal.wgServerLog) console.info('[tee] wg-server.log at ready:\n' + signal.wgServerLog)
    const session = this.teeSessions.get(signal.sessionId)
    if (!session) {
      console.warn('[tee] runner ready: no session found', { sessionId: signal.sessionId })
      return
    }

    session.serverPublicKey = signal.wgPublicKey
    session.tunnelIp = '10.13.0.2'

    if (session.podId && this.deps.teeProvisioner) {
      // SECURE RunPod pod: probe the WS upgrade path before marking the session ready.
      // Some RunPod hosts route through nginx that strips the Upgrade header — the browser
      // would get a 1006 immediately. Gate 'ready' on the probe so the browser only ever
      // sees sessions with confirmed WS connectivity.
      const wsOk = await this.deps.teeProvisioner.probeWSUpgrade(session.podId)
      if (!wsOk) {
        const badPodId = session.podId
        session.wsProbeAttempts += 1
        if (session.wsProbeAttempts >= 3) {
          console.error('[tee] WS probe failed 3 times — giving up', { sessionId: signal.sessionId })
          session.status = 'ended'
          session.error = 'no GPU with working proxy found after 3 attempts — please try again later'
          await this.deps.teeProvisioner.terminate(badPodId).catch(() => {})
          return
        }
        console.warn('[tee] WS probe failed — re-provisioning', { podId: badPodId, attempt: session.wsProbeAttempts, sessionId: signal.sessionId })
        session.podId = undefined
        await this.deps.teeProvisioner.terminate(badPodId).catch(() => {})
        // Keep session in 'provisioning' — spin a new pod transparently.
        this.deps.teeProvisioner.provision(signal.sessionId, session.wgClientPublicKey, (podId) => {
          const s = this.teeSessions.get(signal.sessionId)
          if (s) s.podId = podId
        }).then(result => {
          const s = this.teeSessions.get(signal.sessionId)
          if (s) { s.podId = result.podId; if (result.costPerHrUsd !== undefined) s.costPerHrUsd = result.costPerHrUsd }
        }).catch(err => {
          const s = this.teeSessions.get(signal.sessionId)
          if (s) { s.status = 'ended'; s.error = String(err) }
        })
        return
      }
      // SECURE RunPod pod: no raw public IP. RunPod proxies WSS → socksgo on port 8080.
      // ?gost&insecureudp: force GostUDPTun (CmdGostUDPTun 0xF3) and allow UDP through
      // the WSS tunnel. wss:// sets IsTLS()=true which disables UDP by default; InsecureUDP
      // overrides that. UDP is tunneled inside the WSS stream — no plaintext exposure.
      session.proxyUrl = `socks5+wss://${session.podId}-8080.proxy.runpod.net/?gost&insecureudp`
      session.endpoint = '127.0.0.1:51820'
    } else {
      // Community cloud or local dev: runner self-reports its public endpoint.
      const host = signal.endpoint.split(':')[0]
      session.proxyUrl = `socks5+ws://${host}:8080?bind=true&gost=true`
      session.endpoint = signal.endpoint
    }

    session.status = 'ready'
  }

  async handleRunnerHeartbeat(signal: RunnerHeartbeatSignal): Promise<{ continue: boolean }> {
    const session = this.teeSessions.get(signal.sessionId)
    if (!session) return { continue: false }
    session.gpuHours = signal.gpuHours
    const { continue: ok } = await this._billTeeHours(session, signal.gpuHours)
    if (!ok) {
      session.status = 'ended'
      session.error = 'session budget exhausted'
      console.warn('[tee] budget exhausted — ending session and terminating pod', { sessionId: signal.sessionId, podId: session.podId })
      if (session.podId && this.deps.teeProvisioner) {
        await this.deps.teeProvisioner.terminate(session.podId).catch(err =>
          console.warn('[tee] pod terminate failed on budget exhaustion', { podId: session.podId, err: String(err) })
        )
      }
    }
    return { continue: ok }
  }

  async handleRunnerEnded(signal: RunnerEndedSignal): Promise<void> {
    const session = this.teeSessions.get(signal.sessionId)
    if (!session) return
    console.info('[tee] runner ended', { sessionId: signal.sessionId, status: signal.status, podId: session.podId })
    session.gpuHours = signal.gpuHours
    await this._billTeeHours(session, signal.gpuHours)
    session.status = 'ended'
    if (!session.error) session.error = signal.status === 'terminated' ? 'session budget exhausted' : 'runner exited unexpectedly'
    if (session.podId && this.deps.teeProvisioner) {
      await this.deps.teeProvisioner.terminate(session.podId).catch(err =>
        console.warn('[tee] pod terminate failed on runner ended', { podId: session.podId, err: String(err) })
      )
    }
  }

  private async _billTeeHours(session: TeeSession, currentGpuHours: number): Promise<{ continue: boolean }> {
    if (process.env.TEE_BILLING_DISABLED === 'true') return { continue: true }
    const deltaHours = currentGpuHours - session.lastBilledGpuHours
    if (deltaHours <= 0) return { continue: true }
    if (!session.costPerHrUsd) return { continue: true }   // no rate yet — provisioner hasn't set it

    const requested = impetusForPodMs(deltaHours * 3_600_000, session.costPerHrUsd)
    const remaining = session.budgetImpetus - session.spentImpetus
    const charged = requested > remaining ? remaining : requested

    if (charged > 0n) {
      const auctor = session.auctor
      const debit = 'animaId' in auctor
        ? { animaId: auctor.animaId, forma: 'integer' as const, valor: -charged, auctor: 'tee:spend', testis: session.sessionId }
        : { forma: 'arcanum' as const, valor: -charged, auctor: 'tee:spend', testis: (auctor as { commitment: string }).commitment }
      const credit = { animaId: PLATFORM_ANIMA_ID, forma: 'reward' as const, valor: charged, auctor: 'tee:spend', testis: session.sessionId }
      await this.deps.signorum.createMany([debit, credit])
      session.lastBilledGpuHours = currentGpuHours
      session.spentImpetus += charged
    }

    return { continue: charged >= requested }
  }
}

/** Inputs for `saveFlow`. Source the base from an owned run OR an explicit flow id. */
export interface SaveFlowOpts {
  fromRun?: string
  modusId?: string
  name: string
  aditus?: Record<string, unknown>
  promptMode?: PromptMode
  affix?: { prefix?: string; suffix?: string }
  pinnedModels?: Array<{ id: string }>
}

/** JSON-safe projection of a StatusSnapshot (bigint→string, Date→ISO). */
export interface StatusView {
  balanceImpetus: string
  balanceUsd: number
  gens: unknown[]
  studios: unknown[]
  joinable: unknown[]
  takenAt: string
}

/** Inputs for `provisionStudio`. Everything optional — the simplest call leases a default
 *  studio capped at the caller's balance; each knob is opt-in (north-star). */
export interface ProvisionStudioOpts {
  /** Compute substrate to arm on — resolved to its runtime (enumerable via `listFundamenta`). */
  fundamentumId?: string
  /** Models (intellaId) to install live onto the studio (enumerable via `listModels`). */
  models?: string[]
  /** How long to hold the studio warm (ms). */
  warmMs?: number
  /** Hard spend cap = the session budget (the tessera). Census drains the studio at the cap.
   *  Omitted → the caller's full balance. */
  maxImpetus?: bigint | string | number
  /** Override the on-pod runtime explicitly (else inherited from the fundamentum). */
  runtime?: string
  /** Fire-and-forget completion webhook — POSTed `{ studio }` once the studio is ready
   *  (or `{ studio: { status: 'failed' } }` if provisioning failed). Optional sugar over
   *  the poll path (`GET /v1/studios/:id`). */
  webhookUrl?: string
}

/** JSON-safe projection of a leased/live studio (bigint→string, Date→ISO). */
export interface StudioView {
  /** The studio's id — what `POST /v1/runs { studioId }` targets (a Modo id). */
  studioId: string
  podId?: string
  /** Pod-derived liveness: idle | running | provisioning | draining | terminated. */
  status: string
  gpu?: string
  runtime?: string
  imageRef?: string
  warmUntil?: string
  /** The authorized session budget (impetus) — the `maxImpetus` cap. */
  budgetImpetus: string
  /** The pod's real hourly USD cost — the source of truth for warm-time billing. */
  costPerHr?: number
  /** Coarse burn-rate hint (impetus/sec). Billing is per-window from `costPerHr`;
   *  this rounds up, so prefer `costPerHr` for an accurate rate. */
  impetusPerSecond?: string
}

function toStudioView(h: StudioHandle, budget: bigint): StudioView {
  const m = h.materia
  // No pod yet (async provisioning): status comes from the session (Modo) — `claiming`/
  // `warming` → `provisioning`; the pod fields are absent until it binds.
  if (!m) {
    return { studioId: h.studioId, status: modoStudioStatus(h.modo), budgetImpetus: budget.toString() }
  }
  return {
    studioId: h.studioId,
    ...(m.externusId ? { podId: m.externusId } : {}),
    // Once bound, liveness is the pod's (Materia) truth, not the Modo's — a reaped pod
    // leaves a stale-`idle` Modo. Shared mapping with /v1/me/status so both agree.
    status: materiaStudioStatus(m),
    ...(m.gpu ? { gpu: m.gpu } : {}),
    ...(m.runtime ? { runtime: m.runtime } : {}),
    ...(m.imageRef ? { imageRef: m.imageRef } : {}),
    ...(m.warmUntil ? { warmUntil: new Date(m.warmUntil).toISOString() } : {}),
    budgetImpetus: budget.toString(),
    ...(m.costPerHr !== undefined ? { costPerHr: m.costPerHr } : {}),
    ...(m.impetusPerSecond !== undefined ? { impetusPerSecond: m.impetusPerSecond.toString() } : {}),
  }
}

/** Map a Modo's session status to the studio-facing vocabulary (the pre-pod, async case). */
function modoStudioStatus(modo: { status: string }): string {
  return modo.status === 'terminated' ? 'terminated'
    : (modo.status === 'claiming' || modo.status === 'warming') ? 'provisioning'
    : 'idle'
}

/** name → global-unique slug candidate (lowercase, dash-joined alnum). */
function slugify(name: string): string {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

/** A model catalog card — enough for an agent to decide, not just enumerate. */
export interface ModelCard {
  intellaId: string
  nomen: string
  genus: string
  basis?: string
  trigger?: string
  description?: string
}

function toModelCard(i: Intelligens): ModelCard {
  const trigger = i.verba && i.verba.length ? i.verba.join(', ') : undefined
  return {
    intellaId: i.id,
    nomen: i.nomen || i.id,
    genus: i.genus,
    ...(i.basis ? { basis: i.basis } : {}),
    ...(trigger ? { trigger } : {}),
    ...(i.descriptio ? { description: i.descriptio } : {}),
  }
}

// ── TEE types ─────────────────────────────────────────────────────────────────

export interface ProvisionTeeSessionOpts {
  gpuClass?: string
  maxImpetus?: bigint | string
  wgClientPublicKey: string
  /** Actual pod cost in USD/hr from the provider API — required for billing. Set by TeeProvisioner in Phase 3. */
  costPerHrUsd?: number
}

export interface TeeSessionView {
  sessionId: string
  status: 'provisioning' | 'ready' | 'ended'
  error?: string
  serverPublicKey?: string
  endpoint?: string      // WireGuard UDP endpoint (ip:port)
  proxyUrl?: string      // gost SOCKS5+WS URL for the browser WASM tunnel
  tunnelIp?: string
  gpuHours?: number
}

export interface RunnerReadySignal {
  sessionId: string
  endpoint: string
  wgPublicKey: string
  attestation?: string
  wgServerLog?: string
}

export interface RunnerHeartbeatSignal {
  sessionId: string
  gpuHours: number
  status: string
}

export interface RunnerEndedSignal {
  sessionId: string
  gpuHours: number
  status: string
}

interface TeeSession {
  sessionId: string
  auctor: AuctorKey
  status: 'provisioning' | 'ready' | 'ended'
  error?: string
  gpuClass?: string
  budgetImpetus: bigint
  wgClientPublicKey: string
  podId?: string
  wsProbeAttempts: number
  serverPublicKey?: string
  endpoint?: string
  proxyUrl?: string
  tunnelIp?: string
  gpuHours?: number
  /** USD/hr from the provider — populated by TeeProvisioner at pod boot. Absent during local dev; billing skips. */
  costPerHrUsd?: number
  lastBilledGpuHours: number
  spentImpetus: bigint
  createdAt: Date
}

function toTeeSessionView(s: TeeSession): TeeSessionView {
  return {
    sessionId: s.sessionId,
    status: s.status,
    ...(s.error ? { error: s.error } : {}),
    ...(s.serverPublicKey ? { serverPublicKey: s.serverPublicKey } : {}),
    ...(s.endpoint ? { endpoint: s.endpoint } : {}),
    ...(s.proxyUrl ? { proxyUrl: s.proxyUrl } : {}),
    ...(s.tunnelIp ? { tunnelIp: s.tunnelIp } : {}),
    ...(s.gpuHours !== undefined ? { gpuHours: s.gpuHours } : {}),
  }
}

function _auctorMatch(a: AuctorKey, b: AuctorKey): boolean {
  if ('animaId' in a && 'animaId' in b) return a.animaId === b.animaId
  if ('commitment' in a && 'commitment' in b) return a.commitment === b.commitment
  return false
}
