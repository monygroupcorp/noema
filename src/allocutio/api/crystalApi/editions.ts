import type { Intella } from '../../../types/intelligendi.js'
import type { AuctorKey } from '../../../flow/types.js'
import { toEdition } from '../runProjection.js'
import { Errors, ApiError } from '../errors.js'
import { isPrivateMarker, withResolvedPrivateMarkers } from '../../../crystal/MediaFetcher.js'
import type { Edition, EditionModerationDetail, FeedItem } from '../types.js'
import type { Collectio } from '../../../types/collectio.js'
import type { Editio, ArtifactRef, EditioCustody, FeedFilter, EditioFailure } from '../../../types/editio.js'
import type { PublishingPrefs } from '../../../types/anima.js'
import type { PublicationAdapter } from '../../../crystal/PublicationAdapter.js'
import { contentKey, toCachedVerdict, fromCachedVerdict } from '../../../crystal/VerdictCache.js'
import { allMediaUrls, mediaTypeFor } from '../../../crystal/BucketAdapter.js'
import { CivitaiDownloadError } from '../../../crystal/civitaiAuth.js'
import { isCatalogEligible } from '../../../crystal/modelLicense.js'
import type { PublishOpts, EditionPreview, AdminTakedownResult } from '../CrystalApi.js'
import { log, PLATFORM_ANIMA_ID, PUBLICATION_COPY_PREFIX } from './support.js'
import { CrystalApiDatasets } from './datasets.js'

/** Editions: publishing, the feed, moderation review and retraction. */
export abstract class CrystalApiEditions extends CrystalApiDatasets {
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
    // Dispute freeze (noema-082, freeze-boundary v2): publishing incurs a `publish:scanFee` debit —
    // a user-initiated outflow. It burns rather than extracts the disputed balance (the lesser case),
    // but the freeze principle is total, so gate it too while the anima is frozen. Checked first,
    // before any other work, mirroring invokeFlow's top-of-method freeze gate.
    await this._assertNotDisputeFrozen(auctor)

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
        // mint/marketplace list on-chain/at a venue; `gallery` hosts publicly-readable
        // tokenURIs; `arweave` graduates them to permanent public storage — all PUBLIC
        // surfaces, so they run the moderation gate.
        : destination === 'mint' || destination === 'marketplace' || destination === 'gallery' || destination === 'arweave' ? 'marketplace'
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

    // Private generation (noema-347): a private output is refused here rather than re-hosted.
    // Publishing one means copying the bytes OUT of the private bucket into a public surface —
    // a deliberate act with its own consent moment, which lands in a later phase. Until then the
    // honest answer is a refusal, not a quiet republish of media the caller marked private.
    await this._assertPublishableOutput(ref)

    // License gate (compliance): the public catalog is a COMMERCIAL surface, so a model may only be
    // PROMOTED there (visibility !== 'private') if its license clears commercial use. `familia` can't
    // carry this — FLUX schnell (Apache ✅) and dev (Non-Commercial ❌) are both 'flux' — so it keys
    // on the model's recorded `commercialUse` verdict (set at import/training via modelLicense.ts).
    // `isCatalogEligible` is the policy: 'yes' + 'conditional' pass (we track revenue against the
    // conditional caps); 'no'/'unknown' are refused pending an ADMIN license clearance (setModelLicense
    // backfill). A model with NO recorded verdict (undefined) is not gated here (legacy). Private/
    // personal use is never blocked — this is listing, not use (`docs/spec/model-import.md`).
    if (ref.kind === 'intella' && visibility !== 'private' && owned.intella?.commercialUse && !isCatalogEligible(owned.intella.commercialUse, owned.intella.license, this._grantSafeguards())) {
      throw Errors.licenseRestricted(
        `this model cannot be promoted to the public catalog under its license (${owned.intella.license ?? 'unknown'}, commercial use: ${owned.intella.commercialUse}). It remains usable privately; an admin can clear it after license review.`,
      )
    }

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

    // `custody:'both'` finality (#4): one call publishes a model to an EXTERNAL
    // registry AND mirrors its weights into OUR R2 bucket — so we retain/serve it
    // ourselves regardless of the external host. The external Editio takes a concrete
    // custody ('theirs' when the caller has a BYO account for that registry, else our
    // org); the bucket mirror is a SECOND publication ('r2', custody 'ours'). Each is
    // its own durable, worker-settled record (the spine stays one-Editio-one-destination).
    const externalCustody: EditioCustody =
      custody === 'both' ? (this._hasBYOAccount(destination, prefs) ? 'theirs' : 'ours') : custody
    const mirrorToBucket =
      custody === 'both' && ref.kind === 'intella' && destination !== 'r2' && this._hasAdapter('r2')

    const editio = await editiones.create({
      artifactRef: ref,
      destination,
      visibility,
      custody: externalCustody,
      by,
      ...(owners !== undefined ? { owners } : {}),
      ...(license !== undefined ? { license } : {}),
    })

    if (mirrorToBucket) {
      await editiones.create({
        artifactRef: ref,
        destination: 'r2',
        visibility,
        custody: 'ours',
        by,
        ...(owners !== undefined ? { owners } : {}),
        ...(license !== undefined ? { license } : {}),
      })
    }

    // Durable settle: every publication is drained by the PublicationWorker, which
    // claims `pending` rows off the store (the store IS the queue). We return the
    // pending Editio immediately and never settle inline — so a restart can't orphan
    // it and heavy work (a model weight upload) never blocks this call. The worker
    // runs the moderation gate (public surfaces) → the adapter → the reconciler.
    return toEdition(editio)
  }

  /** Settle one pending publication — claimed and invoked by the `PublicationWorker`.
   *  Idempotent: a no-op unless the Editio is still `pending` (see `_settlePublication`). */
  async settlePublication(editioId: string): Promise<void> {
    await this._settlePublication(editioId)
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
      // A publication that copied a private output out renders ITS copy — the artifact's own
      // exitus still holds markers no reader outside the owner can fetch.
      const output = e.hostedOutput ?? await this._artifactOutput(e.artifactRef)
      out.push({
        editionId: e.id,
        artifact: { kind: e.artifactRef.kind, id: e.artifactRef.id },
        ...(output !== undefined ? { output } : {}),
        createdAt: e.natum.toISOString(),
      })
    }
    return out
  }

  /** Fetch one publication. Author-scoped: only the publishing identity may read it
   *  (an archive's `externalRef` is a private download url). Polled to watch a pending
   *  settle land — an async archive ZIP build finishing, a public surface being gated. */
  async getEdition(auctor: AuctorKey, id: string): Promise<Edition> {
    const editiones = this.deps.editiones
    if (!editiones) throw Errors.notFoundEdition(id)
    const e = await editiones.find(id)
    if (!e || !this._isEditionAuthor(auctor, e)) throw Errors.notFoundEdition(id)
    return toEdition(e)
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
    await this._dropHostedOutput(e)
    const updated = await editiones.update(id, { status: 'retracted' })
    await this._reconcile(updated)
    return toEdition(updated)
  }

  /**
   * ADMIN TAKEDOWN (minimax-h3-violation-takedown): pull down every LIVE, non-private
   * publication of one artifact — what a confirmed abuse-report violation (querelaAdminRouter)
   * acts on. Unlike `retractEdition`, this is NOT author-scoped (an abuse report is filed
   * by a stranger, not the publisher) and it acts on EVERY Editio of the artifact across
   * every destination, not one. PLATFORM-ADMIN ONLY.
   *
   * `private`-visibility Editiones are left alone — they were never the public access a
   * violation takes away, only the owner could ever reach them. A destination with no
   * `retract` (mint: permanent) or one that no longer resolves to a registered adapter is
   * recorded in `skipped` rather than thrown — one unreachable surface must not stop the
   * rest of the takedown, and the admin still sees exactly what is still live.
   */
  async adminRetractAllEditions(auctor: AuctorKey, ref: ArtifactRef): Promise<AdminTakedownResult> {
    this._assertPlatformAdmin(auctor)
    const editiones = this.deps.editiones
    const result: AdminTakedownResult = { retracted: [], skipped: [] }
    if (!editiones) return result
    const all = await editiones.listByArtifact(ref)
    for (const e of all) {
      if (e.status !== 'published' || e.visibility === 'private') continue
      let adapter: PublicationAdapter
      try {
        adapter = this._resolveAdapter(e.destination)
      } catch {
        log.error('admin takedown: destination adapter not registered — publication left live', { editioId: e.id, destination: e.destination, artifactRef: ref })
        result.skipped.push({ id: e.id, destination: e.destination, reason: 'adapter_unavailable' })
        continue
      }
      if (!adapter.retract) {
        log.error('admin takedown: destination is permanent — cannot retract, publication left live', { editioId: e.id, destination: e.destination, artifactRef: ref })
        result.skipped.push({ id: e.id, destination: e.destination, reason: 'permanent' })
        continue
      }
      await adapter.retract(e)
      await this._dropHostedOutput(e)
      const updated = await editiones.update(e.id, { status: 'retracted' })
      await this._reconcile(updated)
      result.retracted.push(e.id)
    }
    return result
  }

  /**
   * The review queue (spec §4): publications the moderation gate HELD
   * (`reviewOutcome:'pending'`) for a human to adjudicate. An author sees their OWN
   * held items (transparency: "your publish is under review"); the platform admin sees
   * ALL of them (the reviewer's queue). Adjudication itself is admin-only (below).
   */
  async listHeldEditions(auctor: AuctorKey): Promise<Edition[]> {
    const editiones = this.deps.editiones
    if (!editiones) return []
    const isAdmin = 'animaId' in auctor && auctor.animaId === PLATFORM_ANIMA_ID
    const held = await editiones.listHeld(isAdmin ? undefined : this._editionBy(auctor))
    return held.map(toEdition)
  }

  /**
   * The caller's OWN publications of one artifact, newest first.
   *
   * `listHeldEditions` is the review queue, so it holds `reviewOutcome:'pending'` and
   * nothing else. That makes a hold recoverable on a later visit but leaves every
   * TERMINAL outcome unreadable to the author the moment the session that filed it ends:
   * a gate refusal (the default posture refuses every public publish, since the gate is
   * fail-closed until a scanner is configured) and a publication that is already live
   * both read as "never put forth". So the publisher was shown the refusal reason once
   * and never again, and was offered the publish control back for an artifact that was
   * refused — or already hosted — which files a second edition behind the first.
   *
   * Author-scoped on the edition's own `by`, the same identity test as `getEdition`: the
   * artifact id is not a capability here, and a caller asking about someone else's
   * artifact gets the empty list, indistinguishable from an artifact nobody published.
   *
   * `Editionum.listByArtifact` promises no order, so the ordering is applied here rather
   * than assumed — the newest publication of an artifact is the one that describes it.
   */
  async listMyEditions(auctor: AuctorKey, ref: ArtifactRef): Promise<Edition[]> {
    const editiones = this.deps.editiones
    if (!editiones) return []
    const all = await editiones.listByArtifact(ref)
    return all
      .filter((e) => this._isEditionAuthor(auctor, e))
      .sort((a, b) => b.natum.getTime() - a.natum.getTime())
      .map(toEdition)
  }

  /**
   * Admin-only raw moderation-verdict read (docs/spec/moderation-reject-reason.md §3(a)).
   * `listHeldEditions` only surfaces items still `reviewOutcome:'pending'` — a TERMINAL
   * `rejected` Editio has no queue entry to inspect, so a reviewer asking "why was X
   * rejected" had nothing to look at. This reaches any Editio by id regardless of status,
   * PLATFORM-ADMIN ONLY: `verdict.reason` is the classifier's raw text, which may describe
   * detection internals not meant for the rejected author to read verbatim (the author-
   * facing surface is the generic `Edition.moderationNote` from `toEdition`, not this).
   * `moderation` is null when the Editio was never held or rejected by the gate.
   */
  async getEditionModeration(auctor: AuctorKey, id: string): Promise<EditionModerationDetail> {
    this._assertPlatformAdmin(auctor)
    const editiones = this.deps.editiones
    if (!editiones) throw Errors.notFoundEdition(id)
    const e = await editiones.find(id)
    if (!e) throw Errors.notFoundEdition(id)
    return {
      id: e.id,
      status: e.status,
      ...(e.reviewOutcome !== undefined ? { reviewOutcome: e.reviewOutcome } : {}),
      moderation: e.moderation ?? null,
    }
  }

  /**
   * PREVIEW a held publication's media (docs/spec/publish-review-visibility.md §2): resolves
   * the SAME view the moderation gate itself used to make its hold decision —
   * `_artifactOutput` → `allMediaUrls` — for ANY artifact kind the editio references, not just
   * an `actum` generation run. This is what closes the "reviewer adjudicates a model hold
   * blind" gap: an `intella` promotion's sample images are otherwise invisible on this screen.
   * PLATFORM-ADMIN ONLY — the SAME gate `approveHeldEdition`/`rejectHeldEdition` use, so a
   * held item's preview urls are never exposed to a non-admin caller (the author included).
   * Only a `reviewOutcome:'pending'` Editio has a preview; anything else 404s, same contract
   * as approve/reject.
   */
  async previewHeldEdition(auctor: AuctorKey, id: string): Promise<EditionPreview> {
    this._assertPlatformAdmin(auctor)
    const editiones = this.deps.editiones
    if (!editiones) throw Errors.notFoundEdition(id)
    const e = await editiones.find(id)
    if (!e || e.reviewOutcome !== 'pending') throw Errors.notFoundEdition(id)
    const output = await this._artifactOutput(e.artifactRef)
    // A HELD publication has not been copied out yet — the copy is only made once the gate has
    // passed — so a private output is still a marker here, and a marker renders as nothing. The
    // reviewer is the one person who must see it to decide, so presign it for them, under the
    // platform-admin gate this method already stands behind.
    const mediaUrls: string[] = []
    for (const url of allMediaUrls(output)) mediaUrls.push(await this._presignPrivateRef(url) ?? url)
    // Richer per-item metadata when the output carries it (an intella's `samples[]` — see
    // `_artifactOutput`'s `intella` branch, each entry `{ url, pathInRepo, prompt? }`).
    // Kind-agnostic on purpose: any future artifact output shaped as `samples: {url,prompt?}[]`
    // gets the same richer preview for free, no new branch needed here.
    const samples = output?.samples
    const items = Array.isArray(samples)
      ? samples
          .filter((s): s is { url: string; prompt?: string } => !!s && typeof s === 'object' && typeof (s as { url?: unknown }).url === 'string')
          .map((s) => ({ url: s.url, ...(s.prompt ? { prompt: s.prompt } : {}) }))
      : undefined
    return { mediaUrls, ...(items && items.length > 0 ? { items } : {}) }
  }

  /**
   * APPROVE a held publication (spec §4) → clears the hold (`reviewOutcome:'approved'`);
   * the worker re-settles it with the gate BYPASSED, so it publishes. PLATFORM-ADMIN
   * ONLY — an author must never clear their own possibly-CSAM hold (that would defeat
   * the review). Only a `reviewOutcome:'pending'` Editio can be approved.
   */
  async approveHeldEdition(auctor: AuctorKey, id: string): Promise<Edition> {
    this._assertPlatformAdmin(auctor)
    const editiones = this.deps.editiones
    if (!editiones) throw Errors.notFoundEdition(id)
    const e = await editiones.find(id)
    if (!e || e.reviewOutcome !== 'pending') throw Errors.notFoundEdition(id)
    // Clear the settle lease the worker stamped on the scan that held it, so the worker
    // reclaims it on the next pass immediately (not after the ~5-min lease lapses) and
    // re-settles with the gate bypassed → publishes.
    const updated = await editiones.update(id, { reviewOutcome: 'approved', leasedUntil: new Date(0) })
    return toEdition(updated)
  }

  /**
   * REJECT a held publication (spec §4) → terminal `status:'rejected'`. PLATFORM-ADMIN
   * ONLY. Rejection itself files NO NCMEC report — a confirmed-CSAM report is a separate,
   * explicit human action through the private deferred reporter, NEVER automatic (§0-A).
   */
  async rejectHeldEdition(auctor: AuctorKey, id: string): Promise<Edition> {
    this._assertPlatformAdmin(auctor)
    const editiones = this.deps.editiones
    if (!editiones) throw Errors.notFoundEdition(id)
    const e = await editiones.find(id)
    if (!e || e.reviewOutcome !== 'pending') throw Errors.notFoundEdition(id)
    const updated = await editiones.update(id, { status: 'rejected', reviewOutcome: 'rejected' })
    return toEdition(updated)
  }

  /**
   * CONFIRM a held publication as CSAM (spec §4) — the human-review path's terminal
   * action, and the thing that makes review a Thorn-INDEPENDENT adjudicator. PLATFORM-
   * ADMIN ONLY. It (1) REJECTS the content (never goes live) and (2) files a NCMEC
   * CyberTipline report via the injected `csamReviewReporter` — an EXPLICIT human
   * confirmation is "actual knowledge" (18 U.S.C. §2258A), so the report is a duty, not
   * an option. This is the ONLY path that reports from review; a plain `reject` never
   * reports (§0-A). A report failure does NOT un-reject — the content stays rejected and
   * the failure is logged LOUDLY (a lost report is investigable; live unsafe content is not).
   *
   * NOTE: with the deferred reporter, the report is ASSEMBLED + PRESERVED but not
   * LIVE-submitted to NCMEC until an ESP account exists (Track B2/C4). `submitted` in the
   * result reflects that.
   */
  async confirmCsamAndReport(auctor: AuctorKey, id: string): Promise<Edition> {
    this._assertPlatformAdmin(auctor)
    const editiones = this.deps.editiones
    if (!editiones) throw Errors.notFoundEdition(id)
    const e = await editiones.find(id)
    if (!e || e.reviewOutcome !== 'pending') throw Errors.notFoundEdition(id)

    // Reject FIRST — the content must not go live regardless of the report outcome.
    const updated = await editiones.update(id, { status: 'rejected', reviewOutcome: 'rejected' })

    const reporter = this.deps.csamReviewReporter
    if (!reporter) {
      log.error('confirmCsamAndReport: content REJECTED but NO CsamReviewReporter configured — the mandated NCMEC report was NOT filed. Configure the compliance module + ESP.', { editioId: e.id })
      return toEdition(updated)
    }
    try {
      const urls = allMediaUrls(await this._artifactOutput(e.artifactRef))
      const out = await reporter.reportConfirmed({
        editioId: e.id,
        artifact: { kind: e.artifactRef.kind, id: e.artifactRef.id },
        uploader: e.by,
        urls,
        reviewedBy: 'animaId' in auctor ? auctor.animaId : PLATFORM_ANIMA_ID,
        confirmedAt: new Date().toISOString(),
      })
      log.warn('CSAM confirmed by reviewer — CyberTipline report assembled', { editioId: e.id, reportIds: out.reportIds, submitted: out.submitted })
    } catch (err) {
      // Content stays rejected; a report loss is a loud, investigable event.
      log.error('confirmCsamAndReport: report FAILED — content still rejected, report may be lost — investigate immediately', { editioId: e.id, error: err instanceof Error ? err.message : String(err) })
    }
    return toEdition(updated)
  }

  /** Run the moderation gate (public surfaces only) then the adapter publish,
   *  recording the outcome on the Editio. Pending → published | rejected | failed. */
  /**
   * Refuse to publish a private output only where this deployment cannot copy it out.
   *
   * Phase 1 of private generation refused EVERY private publication; phase 2 copies the bytes
   * into the public bucket at settle instead (`_copyOutPrivateOutput`), so the refusal narrows
   * to the one case that is still a promise we cannot keep: no copy-out store is wired, and the
   * publication would either fail at its destination or hand a marker to a surface that renders
   * it verbatim. Fail closed there rather than publish something unreadable.
   *
   * Guards the whole publication lane: the synchronous `publish` entry (where the caller sees the
   * typed refusal) and the durable settle below (where a row that predates this guard, or one
   * whose run went private after the fact, is failed rather than sent on).
   */
  protected async _assertPublishableOutput(ref: ArtifactRef): Promise<void> {
    if (this.deps.publicationCopyOut) return
    const output = await this._artifactOutput(ref)
    if (this._privateRefsIn(output).length === 0) return
    throw new ApiError(
      'internal.unavailable',
      'Publishing a private output is not available on this deployment. Turn off private generation and run it again to publish.',
      503,
      { retryable: false },
    )
  }

  /**
   * Every `noema-private://` marker an artifact's produced output carries, deduped.
   *
   * Scans the same media shapes the moderation gate hashes, so a marker inside a list
   * (`images[]`, an intella's `samples[]`) counts exactly like a top-level one — the phase-1
   * check looked only at top-level values and so missed a multi-image run.
   */
  protected _privateRefsIn(output?: Record<string, unknown>): string[] {
    return allMediaUrls(output).filter(isPrivateMarker)
  }

  /**
   * Copy every private output an artifact carries into the PUBLIC bucket under this
   * publication's own key, and return the output with each marker replaced by the copy's URL.
   *
   * This is what publishing a private output means. Nothing is moved and the run is not
   * changed — the private object stays where it is and the run's `exitus` keeps its markers —
   * but this one publication gets a public copy that the destination adapter, the feed and
   * `retract` all work on. Throws if any copy fails, so a publication never goes live
   * half-copied, with some markers still in it.
   */
  protected async _copyOutPrivateOutput(
    editioId: string,
    output: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const copyOut = this.deps.publicationCopyOut
    if (!copyOut) throw new Error('publication copy-out is not configured')
    const resolved = new Map<string, string>()
    for (const marker of this._privateRefsIn(output)) {
      const { contentType, ext } = mediaTypeFor(marker)
      const bytes = await copyOut.fetch(marker)
      const key = `${PUBLICATION_COPY_PREFIX}/${editioId}/${resolved.size}.${ext}`
      resolved.set(marker, await copyOut.store.put(key, bytes, contentType))
    }
    return withResolvedPrivateMarkers(output, resolved)
  }

  /**
   * Delete this publication's public copy of a private output.
   *
   * Retracting a publication that copied private bytes out has to take those bytes back out
   * too, or "private" only ever held until the first publish. A delete that fails is logged
   * loudly and does NOT fail the retract — the publication is already down; a stranded object
   * is a cleanup job, not a reason to leave the post up.
   */
  protected async _dropHostedOutput(e: Editio): Promise<void> {
    const copyOut = this.deps.publicationCopyOut
    if (!copyOut || !e.hostedOutput) return
    const marker = `/${PUBLICATION_COPY_PREFIX}/${e.id}/`
    for (const url of allMediaUrls(e.hostedOutput)) {
      const at = url.indexOf(marker)
      if (at < 0) continue
      const key = `${PUBLICATION_COPY_PREFIX}/${e.id}/${url.slice(at + marker.length)}`
      await copyOut.store.del(key).catch((err: unknown) => {
        log.error('retract: the public copy of a private output was NOT deleted — it is still readable', {
          editioId: e.id, key, error: err instanceof Error ? err.message : String(err),
        })
      })
    }
  }

  protected async _settlePublication(editioId: string): Promise<void> {
    const editiones = this.deps.editiones
    if (!editiones) return
    const e = await editiones.find(editioId)
    if (!e || e.status !== 'pending') return

    // A settle re-entered after a reviewer's approval may already own its copy of a private
    // output; use that rather than the artifact's markers, so an approve → re-settle never
    // copies the same bytes into a second public object.
    const output0 = e.hostedOutput ?? await this._artifactOutput(e.artifactRef)
    const artifact = { ref: e.artifactRef, output: output0, editioId: e.id, by: e.by }
    // Belt to `publish`'s braces: a pending row carrying a private output on a deployment that
    // cannot copy one out never reaches an adapter.
    if (this._privateRefsIn(artifact.output).length > 0 && !this.deps.publicationCopyOut) {
      await editiones.update(editioId, { status: 'failed' })
      return
    }
    // The curation/CSAM gate runs before anything goes live for (a) a public media surface
    // (feed/marketplace) and (b) a PUBLIC MODEL PROMOTION — an intella becoming resolvable on
    // the shared catalogue (visibility !== 'private'). A model has no media surface, so its
    // "public" is catalogue resolvability; listing it publicly passes the same ModerationGate
    // over its preview samples (`docs/spec/model-import.md` §"Curation review"). Private model
    // publishing (a private R2 mirror, visibility 'private') is unaffected — personal use is
    // never gated here (its import-time CSAM scan already ran).
    const isPublicSurface = e.visibility === 'feed' || e.visibility === 'marketplace'
    const isModelPromotion = e.artifactRef.kind === 'intella' && e.visibility !== 'private'
    // A prior human APPROVAL bypasses the gate — a reviewer already adjudicated this
    // exact publication (spec §4); re-scanning would just HOLD it again in a loop.
    if ((isPublicSurface || isModelPromotion) && e.reviewOutcome !== 'approved') {
      // Content-addressed verdict cache (spec §7): an identical re-publish REUSES the
      // prior verdict — no re-scan, and (below) no re-charge. Keyed on the artifact's
      // media urls, computed without re-fetching bytes.
      const key = this.deps.verdictCache ? contentKey(artifact.output) : null
      const cached = key && this.deps.verdictCache ? await this.deps.verdictCache.get(key) : null
      let verdict: import('../../../crystal/ModerationGate.js').ModerationVerdict | null = cached ? fromCachedVerdict(cached) : null

      if (!verdict) {
        // Cache miss (or no cache): run the gate, cache the verdict, and forward the
        // per-scan fee ONLY when the paid classifier actually ran (billable, spec §7).
        verdict = await this._moderationGate().scan(artifact)
        if (key && this.deps.verdictCache) {
          await this.deps.verdictCache.put(toCachedVerdict(key, verdict, new Date().toISOString()))
        }
        if (verdict.billable && this.deps.scanFeeCharger) {
          // Best-effort: a fee failure must NOT block or alter the publish decision.
          try { await this.deps.scanFeeCharger.charge(e.by, e.id) }
          catch { /* logged inside the charger; the safe publish outcome stands */ }
        }
      }

      if (!verdict.ok) {
        // Persist the gate's verdict on the Editio itself — HOLD is not actually better
        // off than REJECT here (docs/spec/moderation-reject-reason.md §1): neither branch
        // used to write `verdict.reason` anywhere, so a rejected item had NO recoverable
        // signal for why. Written on BOTH branches, alongside the existing status write.
        const moderation = {
          reason: verdict.reason,
          ...(verdict.category !== undefined ? { category: verdict.category } : {}),
          ...(verdict.hold ? { hold: true } : {}),
          scannedAt: new Date().toISOString(),
        }
        if (verdict.hold) {
          // HOLD for human review: NOT a reject, NOT a report. Stays `pending`, but the
          // worker's claim skips reviewOutcome:'pending' so it won't re-scan — it waits
          // for an admin to approve (→ re-settle, gate bypassed) or reject.
          log.warn('publication HELD by moderation gate', { editioId: e.id, artifactRef: e.artifactRef, reason: verdict.reason, hold: true })
          await editiones.update(editioId, { reviewOutcome: 'pending', moderation })
          return
        }
        log.warn('publication REJECTED by moderation gate', { editioId: e.id, artifactRef: e.artifactRef, reason: verdict.reason, hold: false })
        await editiones.update(editioId, { status: 'rejected', moderation })
        return
      }
    }
    // The copy-out (private generation, noema-347 phase 2), deliberately HERE: after the gate,
    // before the adapter. The gate reads a marker directly (the MediaFetcher resolves one to
    // bytes), so a hold or a rejection is decided without a single private byte reaching a
    // public bucket; only a publication that has cleared the gate gets its public copy.
    let output = artifact.output
    if (this._privateRefsIn(output).length > 0) {
      try {
        output = await this._copyOutPrivateOutput(e.id, output as Record<string, unknown>)
      } catch (err) {
        log.error('publish: copying a private output into the public bucket FAILED — the publication is not live', {
          editioId: e.id, error: err instanceof Error ? err.message : String(err),
        })
        await editiones.update(editioId, { status: 'failed' })
        return
      }
      // Recorded before the adapter runs: the bytes are already public, so a crash between here
      // and the adapter must not leave an object nothing can find again to delete.
      await editiones.update(editioId, { hostedOutput: output })
    }

    try {
      const adapter = this._resolveAdapter(e.destination)
      const custodyTarget = await this._custodyTarget(e)
      const { externalRef } = await adapter.publish({ ...artifact, output }, {
        visibility: e.visibility,
        custody: e.custody,
        ...(e.owners !== undefined ? { owners: e.owners } : {}),
        ...(e.license !== undefined ? { license: e.license } : {}),
        ...(custodyTarget !== undefined ? { custodyTarget } : {}),
      })
      const published = await editiones.update(editioId, { status: 'published', externalRef })
      await this._reconcile(published)
    } catch (err) {
      // Never silent (civitai-import-with-key): an adapter throw used to vanish into a bare
      // `status:'failed'` with no trace anywhere — not in a log, not on the record. Logged for
      // an operator, and the reason is recorded on the Editio itself (admin-only `failure.reason`;
      // the author sees only `Edition.failureNote`'s closed, generic form — `toEdition`).
      const reason = err instanceof Error ? err.message : String(err)
      log.error('publish: adapter threw — publication failed', { editioId, destination: e.destination, error: reason })
      const category: EditioFailure['category'] = err instanceof CivitaiDownloadError ? 'origin_auth' : 'adapter'
      await editiones.update(editioId, {
        status: 'failed',
        failure: { category, reason, failedAt: new Date().toISOString() },
      })
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
  protected async _reconcile(editio: Editio): Promise<void> {
    if (editio.artifactRef.kind !== 'intella') return
    // A model's resolvability DERIVES from its Editio: published-public → 'public'
    // (anyone can resolve it by trigger), retracted/private → 'private'. The royalty
    // payee (§5e) is the model's own `auctor`, which a public publish does not change
    // — making it resolvable IS the same decision as who earns when it is used.
    const isPublic = editio.status === 'published' && editio.visibility !== 'private'
    await this.deps.intellarum?.setAccess?.(editio.artifactRef.id, isPublic ? 'public' : 'private')

    // Our-bucket custody (training finality): when a model's WEIGHTS are hosted in
    // OUR R2 (destination 'r2', custody ours), make it resolvable FROM there —
    // prepend the hosted URL as the highest-priority `miladystation` source so the
    // pod downloads from us, not a flaky external host. Retract removes it. (Other
    // destinations return a registry URL that points at no real upload yet, §10 —
    // never registered as a source.)
    if (editio.destination === 'r2' && editio.externalRef) {
      if (editio.status === 'published') {
        await this.deps.intellarum?.addSource?.(editio.artifactRef.id, { provenance: 'miladystation', uri: editio.externalRef })
      } else if (editio.status === 'retracted') {
        await this.deps.intellarum?.removeSource?.(editio.artifactRef.id, editio.externalRef)
      }
    }
  }

  /** The BYO custody target (account) for a `custody:'theirs'` model publish, from the
   *  author's prefs — HuggingFace/Civitai account by destination. Undefined otherwise. */
  protected async _custodyTarget(e: Editio): Promise<{ account?: string } | undefined> {
    if (e.custody !== 'theirs') return undefined
    const prefs = await this._publishingPrefs(e.by)
    const account = e.destination === 'civitai' ? prefs?.civitaiAccount : prefs?.huggingFaceAccount
    return account ? { account } : undefined
  }

  /** Resolve a registered publication adapter by key, or 404. */
  protected _resolveAdapter(key: string): PublicationAdapter {
    const adapter = this.deps.publicationAdapters?.find((a) => a.key === key)
    if (!adapter) throw Errors.notFoundAdapter(key)
    return adapter
  }

  /** Whether an adapter is registered (without throwing) — gates the `both` mirror. */
  protected _hasAdapter(key: string): boolean {
    return this.deps.publicationAdapters?.some((a) => a.key === key) ?? false
  }

  /** Whether the caller has a BYO account configured for a model registry destination. */
  protected _hasBYOAccount(destination: string, prefs?: PublishingPrefs): boolean {
    return destination === 'civitai' ? !!prefs?.civitaiAccount : !!prefs?.huggingFaceAccount
  }

  /** An Editio owns by `{animaId}|{commitment}` only — bursaToken has no persistent owner. */
  protected _editionBy(auctor: AuctorKey): Editio['by'] {
    if ('animaId' in auctor) return { animaId: auctor.animaId }
    if ('commitment' in auctor) return { commitment: auctor.commitment }
    throw Errors.authForbidden('Publishing requires an identified or commitment account')
  }

  protected _isEditionAuthor(auctor: AuctorKey, e: Editio): boolean {
    if ('animaId' in auctor && 'animaId' in e.by) return e.by.animaId === auctor.animaId
    if ('commitment' in auctor && 'commitment' in e.by) return e.by.commitment === auctor.commitment
    return false
  }

  /** The caller's per-identity publishing prefs (identified callers only). */
  protected async _publishingPrefs(auctor: AuctorKey): Promise<PublishingPrefs | undefined> {
    if (!('animaId' in auctor) || !this.deps.animae) return undefined
    return (await this.deps.animae.find(auctor.animaId))?.publicatio
  }

  /** Verify the caller owns the artifact being published, or throw not-found. Returns
   *  the resolved artifact for the kinds the caller reuses (an Intella for the license
   *  default, a Collectio for the freeze boundary); `{}` for an Actum. */
  protected async _assertOwnsArtifact(auctor: AuctorKey, ref: ArtifactRef): Promise<{ intella?: Intella; collectio?: Collectio }> {
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
  protected _validateOwners(owners: Array<{ animaId: string; weight: number }>): Editio['owners'] {
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

  /** The payload an adapter is handed for an artifact: an Actum's exitus media, or a
   *  model's publishable view (sources + naming) for the registry adapters. */
  protected async _artifactOutput(ref: ArtifactRef): Promise<Record<string, unknown> | undefined> {
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
        // Model-card enrichment (carried through to ModelView for the registry card).
        ...(m.description !== undefined ? { description: m.description } : {}),
        ...(m.trainingSteps !== undefined ? { trainingSteps: m.trainingSteps } : {}),
        ...(m.provenance !== undefined ? { provenance: m.provenance } : {}),
        // Repro artifacts: the Intella holds durable preview/dataset URLs; the publisher needs a
        // repo path per sample image, derived here by index (samples/sample_NNN.jpg).
        ...(m.samples?.length
          ? { samples: m.samples.map((s, i) => ({ url: s.url, pathInRepo: `samples/sample_${String(i).padStart(3, '0')}.jpg`, ...(s.prompt ? { prompt: s.prompt } : {}) })) }
          : {}),
        ...(m.datasetItems?.length ? { datasetItems: m.datasetItems } : {}),
        ...(m.configYaml !== undefined ? { configYaml: m.configYaml } : {}),
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
}
