import type { Modus } from '../../../types/modus.js'
import type { Intella } from '../../../types/intelligendi.js'
import type { StudioHandle } from '../../../crystal/Conductor.js'
import type { AuctorKey } from '../../../flow/types.js'
import type { Actum } from '../../../types/actum.js'
import { Errors, ApiError } from '../errors.js'
import { isPrivateMarker, privateKeyOf } from '../../../crystal/MediaFetcher.js'
import type { Run, ActivityRow } from '../types.js'
import type { Collectio } from '../../../types/collectio.js'
import { parseManifest } from '../../../crystal/datasetManifest.js'
import { ownedAditusVerdict, type OwnedResourceStores } from '../../../execution/ownedAditusGuard.js'
import type { Sodalitas, Sodalitatum } from '../../../types/sodalitas.js'
import type { ModerationGate } from '../../../crystal/ModerationGate.js'
import { denyModerationGate } from '../../../crystal/ModerationGate.js'
import type { PromptGuard } from '../../../crystal/PromptGuard.js'
import { permissivePromptGuard } from '../../../crystal/PromptGuard.js'
import { ownerKeyOf } from '../../../crystal/ownerKey.js'
import type { GrantSafeguards } from '../../../crystal/modelLicense.js'
import { licenseUseTerms } from '../../../crystal/modelLicense.js'
import { useTermsVerdict } from '../../../crystal/useTerms.js'
import type { CrystalApiDeps } from '../CrystalApi.js'
import { PLATFORM_ANIMA_ID, PRIVATE_PRESIGN_TTL_SECONDS, CANCELLED_BY_OWNER } from './support.js'

/** The ring slices, and the ownership, spend and admin guards every other layer reaches through. */
export abstract class CrystalApiCore {
  constructor(protected readonly deps: CrystalApiDeps) {}

  /**
   * Dispute-freeze spend guard (noema-082, Q3). Rejects a user-initiated SPEND when the caller's
   * anima is frozen by a pending chargeback. Only identified callers carry the flag — anonymous
   * (commitment) and bearer (bursaToken) auctors are freeze-blind (there is no anima to freeze), and
   * a deployment without an `animae` store simply skips the check. LOGIN never routes through here.
   */
  protected async _assertNotDisputeFrozen(auctor: AuctorKey): Promise<void> {
    if (!('animaId' in auctor) || !this.deps.animae) return
    const anima = await this.deps.animae.find(auctor.animaId)
    if (anima?.disputeFrozen) {
      throw Errors.authForbidden('This account is frozen pending review of a payment dispute. Spending is paused until the dispute is resolved.')
    }
  }

  /** The licence-grant safeguards this instance runs: a strike count for suspending repeat
   *  violators (`querelae`) and the acceptance record `_assertUseTerms` reads (`consuetudinum`).
   *  Without either, a model held under a conditional grant stays off the public catalog. */
  protected _grantSafeguards(): GrantSafeguards {
    return { strikes: this.deps.querelae !== undefined, termsGate: this.deps.consuetudinum !== undefined }
  }

  /** Refuse a run of a flow whose licence terms the caller has not accepted, or is suspended
   *  under. See the call site in `invokeFlow`; `fireCollection` asks the same of its flow. */
  protected async _assertUseTerms(auctor: AuctorKey, modus: Pick<Modus, 'useTerms' | 'gradus' | 'fonte' | 'intellae'> | null): Promise<void> {
    const verdict = await useTermsVerdict({
      modus,
      find: (id) => this.deps.modorum.find(id),
      findIntellaUseTerms: async (id) => licenseUseTerms((await this.deps.intellarum?.find(id))?.license),
      accepted: async () => (await this.deps.consuetudinum?.resolveGeneratio(auctor))?.termsAccepted,
      ...(this.deps.querelae
        ? { strikes: (id: string) => this.deps.querelae!.countViolations(ownerKeyOf(auctor), id) }
        : {}),
    })
    if (verdict.ok) return
    if (verdict.reason === 'required') throw Errors.termsRequired(verdict.terms)
    if (verdict.reason === 'suspended') throw Errors.termsSuspended(verdict.terms)
    // A declaration this deployment has no published text for cannot be accepted, so the flow
    // cannot run.
    throw Errors.termsUnknown(verdict.termsId)
  }

  /**
   * Stamp a run's place in the warm-pod line onto its projection, when it is in one.
   *
   * Read live rather than stored: a place is a position among other people's runs and
   * changes when THEY move, so a copy written onto the actum would be stale the moment
   * anything ahead of it dispatched. A settled run is never in a line, so it is not asked
   * about; and a store that cannot answer leaves the field absent rather than guessing.
   */
  protected async _attachActivityQueuePlace(row: ActivityRow, actum: Actum): Promise<void> {
    if (!this.deps.vocator) return
    if (actum.status === 'completus' || actum.status === 'fractus') return
    const at = await this.deps.vocator.place(actum.id).catch(() => null)
    if (at) row.queue = at
  }

  protected async _attachQueuePlace(run: Run, actum: Actum): Promise<void> {
    if (!this.deps.vocator) return
    if (actum.status === 'completus' || actum.status === 'fractus') return
    const at = await this.deps.vocator.place(actum.id).catch(() => null)
    if (at) run.queue = at
  }

  /**
   * THE cancellation of one run: `completor.fail` with the owner-cancel cause — the pod is
   * killed, the reservation is released rather than charged, and the run lands `fractus`.
   *
   * Every cancel surface comes through here, so "cancel a run" has one expression and one
   * recorded cause whether the caller stopped a single run or the collection that owns it.
   * There is no status pre-check inside: `fail` re-reads the record and returns it untouched
   * when it is already terminal, so a run that settled in the meantime comes back as it
   * stands and is neither re-released nor re-caused.
   */
  protected async _settleCancelled(a: Actum): Promise<Actum> {
    return this.deps.completor.fail(a, CANCELLED_BY_OWNER)
  }

  /** Read a run by id and cancel it, returning it as it stands once settled — the settlement
   *  the collection cancel sweep hands to the cursor, per piece. Null when the record is gone. */
  protected async _settleCancelledById(actumId: string): Promise<Actum | null> {
    const a = await this.deps.actorum.findById(actumId)
    if (!a) return null
    return this._settleCancelled(a)
  }

  /**
   * Resolve every `noema-private://` marker in a run's exitus into a short-lived presigned GET.
   *
   * CALLED ONLY behind an ownership check — this hands out a working, if expiring, link to a
   * private object, so the caller must already have been established as the run's owner. There
   * is deliberately no second key-shape check here: ownership IS the gate, and a redundant
   * owner-hash-prefix comparison would only mask a failure of the real one.
   *
   * A marker we cannot presign (no store configured, or the store refuses) is left as-is: an
   * opaque, non-fetchable string. Degrading to a marker is correct; degrading to a public URL
   * would not be.
   */
  protected async _presignPrivateExitus(exitus: Record<string, unknown>): Promise<Record<string, unknown>> {
    const entries = Object.entries(exitus)
    if (!entries.some(([, v]) => isPrivateMarker(v))) return exitus
    const out: Record<string, unknown> = { ...exitus }
    for (const [k, v] of entries) {
      const signed = await this._presignPrivateRef(v)
      if (signed) out[k] = signed
    }
    return out
  }

  /**
   * Presign ONE private-output marker into a short-lived GET, or `undefined` when the value is
   * not a marker, no private-outputs store is configured, or the store refuses.
   *
   * The single place a marker becomes a link. Both resolution seams — a run's `exitus`
   * (`_presignPrivateExitus`) and a dataset's media (`_resolveDatasetMedia`) — go through it, so
   * they cannot diverge on TTL, on failure handling, or on what counts as a marker. `undefined`
   * means "leave the stored value alone": the caller keeps the opaque marker rather than
   * substituting anything fetchable.
   */
  protected async _presignPrivateRef(value: unknown): Promise<string | undefined> {
    const cfg = this.deps.privateOutputs
    const key = isPrivateMarker(value) ? privateKeyOf(value) : undefined
    if (!cfg || key === undefined) return undefined
    const expiresIn = cfg.presignTtlSeconds ?? PRIVATE_PRESIGN_TTL_SECONDS
    return (await cfg.store.getSignedDownloadUrl(key, { expiresIn }).catch(() => null)) ?? undefined
  }

  /** A run is owned by an auctor iff:
   *  - bursaToken: the actum.bursaToken matches (no signa involved)
   *  - otherwise: a signum it consumed belongs to that auctor */
  protected async _owns(auctor: AuctorKey, a: Actum): Promise<boolean> {
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

  /** Whether the caller is the concrete funding identity of a collection (its `by`). */
  protected _isFunder(auctor: AuctorKey, c: Collectio): boolean {
    if ('animaId' in auctor && 'animaId' in c.by) return c.by.animaId === auctor.animaId
    if ('commitment' in auctor && 'commitment' in c.by) return c.by.commitment === auctor.commitment
    return false
  }

  /** The →public moderation gate. Defaults to DENY (fail-closed) when none is wired:
   *  an unconfigured CSAM gate must never approve public content. The container wires
   *  the permissive gate only under an explicit MODERATION_ALLOW_UNSCANNED opt-in. */
  protected _moderationGate(): ModerationGate {
    return this.deps.moderationGate ?? denyModerationGate
  }

  /** Input CSAM prompt guard. Defaults PERMISSIVE (fail-open) — the fail-closed line is
   *  the publish-time ModerationGate; an unconfigured guard must not block generation. */
  protected _promptGuard(): PromptGuard {
    return this.deps.promptGuard ?? permissivePromptGuard
  }

  /** Resolve an Intella the caller owns, or null. Models lacking the store are unavailable. */
  protected async _ownedIntella(auctor: AuctorKey, id: string): Promise<Intella | null> {
    if (!('animaId' in auctor) || !this.deps.intellarum) return null
    const intella = await this.deps.intellarum.find(id)
    if (!intella) return null
    const owns = intella.ownerAnimaId === auctor.animaId || intella.auctor === auctor.animaId
    return owns ? intella : null
  }

  protected _teamStore(): Sodalitatum {
    const store = this.deps.sodalitatum
    if (!store) throw Errors.notFoundTeam('teams')
    return store
  }

  /** Teams are animaId-keyed — anonymous (commitment/bursa) callers cannot own or join them. */
  protected _teamAnimaId(auctor: AuctorKey): string {
    if ('animaId' in auctor) return auctor.animaId
    throw Errors.authForbidden('teams require an identified account')
  }

  /** Resolve a team the caller is a member of, or 404. */
  protected async _memberTeam(auctor: AuctorKey, id: string): Promise<Sodalitas> {
    const animaId = this._teamAnimaId(auctor)
    const team = await this._teamStore().find(id)
    if (!team || !team.membra.includes(animaId)) throw Errors.notFoundTeam(id)
    return team
  }

  /**
   * The ids of the teams this caller is a member of — the read half of the `sodalitasId`
   * overlay, resolved ONCE per list call rather than once per row (`listCollections`'
   * precedent). Resolved from the AUTHENTICATED caller, never from a request parameter.
   *
   * Empty for an anonymous caller and for a deployment with no team store wired: with no team
   * ids, every seam that consults it reads exactly what it read before the overlay existed.
   *
   * ONE helper for every overlay that needs it (datasets and projects both), because "the teams
   * this caller belongs to" is one question with one answer — a second per-noun copy would be a
   * second place for the two to disagree about what membership means.
   */
  protected async _callerTeamIds(auctor: AuctorKey): Promise<string[]> {
    if (!('animaId' in auctor) || !this.deps.sodalitatum) return []
    return (await this.deps.sodalitatum.listByMember(auctor.animaId)).map((t) => t.id)
  }

  /**
   * Resolve a studio session the caller hosts, or 404 (a stranger gets `not_found.studio`, not
   * `forbidden`, so session ids stay non-enumerable — the same convention `getStudio`/`releaseStudio`
   * follow). The Conductor owns the comparison (`hostKeyMatches` covers both `animaId` and anon
   * `commitment` auctors); this is a single reuse of that seam, not a second implementation.
   * Fail-closed: with no conductor wired there is nothing that can affirm ownership, so a requested
   * studio is refused rather than allowed through.
   */
  /**
   * Refuse a run whose aditus names a stored resource this caller may not name.
   *
   * The modus declares which ports are references (`Porta.owned`); each is resolved through a
   * store read whose access predicate is IN THE QUERY and whose owner is closed over here, so
   * a record the caller may not name is never loaded and there is no fetched record for a
   * comparison to be skipped on. A reference that does not resolve fails the request as bad
   * INPUT (`input.invalid_aditus`, 422) naming only the port: the caller learns the value was
   * not usable, never whether an id exists behind it, so ids stay non-enumerable — the same
   * property `_ownedStudio`'s `not_found.studio` refusal preserves.
   *
   * THE TEAM OVERLAY, RESOLVED AT DISPATCH. A dataset reference resolves for the owner OR for a
   * member of the team the dataset is shared with (ADR-0014 question 2, ruled by rth
   * 2026-08-31). The caller's team ids come from `_callerTeamIds` — the same helper the read
   * path uses, from the same authenticated caller — and are CLOSED OVER in the lookup below.
   * They never reach the Actum and are never threaded through execution: an Actum is
   * identity-blind by design, so this call is the whole of the gate. Membership is read live at
   * this moment and never snapshotted, so a member removed from the team cannot start a new run
   * against the dataset; runs already dispatched are unaffected, which is the same property the
   * read path has.
   *
   * FAIL CLOSED. Datasets and corpora both key their owner on an `animaId`, so an anonymous
   * (commitment/bursa) caller can never resolve one and every reference they name is refused;
   * a deployment with no store wired cannot affirm access and refuses for the same reason. With
   * no team store wired `_callerTeamIds` is empty, and an empty set of team ids is owner-only —
   * so the overlay adds nothing it cannot affirm. The one value that is not a reference passes
   * through untouched: an inline manifest on a corpus port is content the caller supplied, not a
   * name for someone's record.
   *
   * DATASETS ONLY. The corpus lookup is unchanged: `Corpus` carries no `sodalitasId`, so there
   * is no team overlay on it to honour and the ruling says nothing about one.
   *
   * Declared ports ONLY. Nothing else in the aditus is read, rewritten or stripped, so the
   * internal channels that ride an aditus (`_attributes`, `__capability`) are untouched.
   */
  protected async _assertOwnedAditus(
    auctor: AuctorKey,
    modus: Modus | null,
    values: Record<string, unknown>,
  ): Promise<void> {
    const verdict = await ownedAditusVerdict(this._ownedResourceStores(), auctor, modus, values)
    if (!verdict.ok) throw Errors.invalidAditus({ field: verdict.field })
  }

  /**
   * The stores an owned reference resolves through, in the shape the shared guard takes. Named
   * once here because three entry points need the same set: the run route, and the two collection
   * writes that fix what a later dispatch will name.
   */
  protected _ownedResourceStores(): OwnedResourceStores {
    return {
      ...(this.deps.datasets ? { datasets: this.deps.datasets } : {}),
      ...(this.deps.corpora ? { corpora: this.deps.corpora } : {}),
      ...(this.deps.sodalitatum ? { sodalitatum: this.deps.sodalitatum } : {}),
      inline: raw => parseManifest(raw) !== null,
    }
  }

  /** Binding a run asks the LIVENESS question, so this keeps `getStudio`'s default (live-only)
   *  predicate: a terminated session or a reaped pod is refused as `not_found.studio` and a run
   *  is never bound to a dead studio. Reading a studio (`getStudio` above) asks a different
   *  question and answers it separately. */
  protected async _ownedStudio(auctor: AuctorKey, studioId: string): Promise<StudioHandle> {
    if (!this.deps.conductor) throw Errors.notFoundStudio(studioId)
    const handle = await this.deps.conductor.getStudio(studioId, auctor)
    if (!handle) throw Errors.notFoundStudio(studioId)
    return handle
  }

  /** A Collectio owns by `{animaId}|{commitment}` only — bursaToken/proof have no persistent owner record. */
  protected _collectionBy(auctor: AuctorKey): Collectio['by'] {
    if ('animaId' in auctor) return { animaId: auctor.animaId }
    if ('commitment' in auctor) return { commitment: auctor.commitment }
    throw Errors.authForbidden('Collections require an identified or commitment account')
  }

  protected async _ownsCollection(auctor: AuctorKey, c: Collectio): Promise<boolean> {
    // Direct owner (the funding identity).
    if (this._isFunder(auctor, c)) return true
    // Team overlay: every member of the Sodalitas owns it.
    if ('animaId' in auctor && c.sodalitasId !== undefined) {
      const team = await this.deps.sodalitatum?.find(c.sodalitasId)
      return team?.membra.includes(auctor.animaId) ?? false
    }
    return false
  }

  protected async _ownedCollection(auctor: AuctorKey, id: string): Promise<Collectio> {
    const c = await this.deps.collectiones?.find(id)
    if (!c || !(await this._ownsCollection(auctor, c))) throw Errors.notFoundCollection(id)
    return c
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
  protected async _estimate(modusId: string, aditus: Record<string, unknown>): Promise<bigint> {
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
        total += await this._resolveCursor(child).reserve(child, childAditus)
      }
      return total
    }

    return this._resolveCursor(modus).reserve(modus, aditus)
  }

  /** `cursorum.resolve` throws a plain `Error` when a modus's `ministerium` has no `Cursor`
   *  registered (a deployment-configuration gap, e.g. a missing provider API key) — translate
   *  that into a handled 503 rather than letting it fall through as an unhandled 500. */
  protected _resolveCursor(modus: Modus) {
    try {
      return this.deps.cursorum.resolve(modus)
    } catch (err) {
      if (err instanceof ApiError) throw err
      throw Errors.ministeriumUnavailable(modus.ministerium)
    }
  }

  /** Platform-admin gate: only the platform identity (PLATFORM_ANIMA_ID) may perform the op. */
  protected _assertPlatformAdmin(auctor: AuctorKey): void {
    if (!('animaId' in auctor) || auctor.animaId !== PLATFORM_ANIMA_ID) {
      throw Errors.authForbidden('this operation is restricted to the platform administrator')
    }
  }
}
