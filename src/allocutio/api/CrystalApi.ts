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
import { bus } from '../../lib/bus.js'
import { normalizeProgressus, shouldPersist, rollupPhaseDurations } from '../../execution/progressus.js'
import type { Progressus, Phasis } from '../../types/progressus.js'
import type { Modorum, Modus } from '../../types/modus.js'
import type { Cursorum, ActumCompletor, Actorum } from '../../types/cursus.js'
import type { ActumInceptor } from '../../execution/ActumInceptor.js'
import type { ActumIndexStore } from '../../types/actumIndex.js'
import type { Consuetudinum, Appearance, Generatio } from '../../types/consuetudo.js'
import type { Signorum } from '../../types/significandi.js'
import type { Fundamentorum } from '../../types/fundamentum.js'
import type { Intelligens, IntelligensGenus, Intellarum, Intella, IntellaContentRating } from '../../types/intelligendi.js'
import type { HospitiumStore } from '../../types/hospitium.js'
import type { MateriaStore } from '../../types/materia.js'
import type { Conductor, StudioHandle, ConduceOpts } from '../../crystal/Conductor.js'
import type { TeePodProvisioner } from '../../crystal/TeePodProvisioner.js'
import type { AuctorKey } from '../../flow/types.js'
import type { MeEraser } from '../../crystal/MeEraser.js'
import type { ErasureReceipt } from '../../types/erasure.js'
import type { Actum, ComputeStrategy, GpuClass, ModelRef } from '../../types/actum.js'
import type { Inceptio } from '../../types/cursus.js'

import { aggregateStatus, materiaStudioStatus } from '../lexicon/status/aggregate.js'
import type { ModoStore } from '../../types/modo.js'
import { deriveSavedModus, type PromptMode } from '../../crystal/deriveSavedModus.js'
import { dispatchInceptio, type DispatchDeps } from '../../execution/dispatchInceptio.js'
import { toRun, toRunDetail, toSettledRun, toCollection, toTeam, toEdition, toProject } from './runProjection.js'
import { describeFlow, type FlowDescription, type DescribableModus } from './aditusToJsonSchema.js'
import { Errors, ApiError } from './errors.js'
import { v4 as uuidv4 } from 'uuid'
import { CANON_VERBS } from '../../crystal/canonVerbs.js'
import { resolveCanonVerb, type CanonVerb } from '../../crystal/verbResolver.js'
import { resolvePinnedModel, type PinnedInput } from '../../crystal/pinnedModelResolver.js'
import { computeRecipient } from '../../arcanum/prover.js'
import { impetusForPodMs, usdMicroToImpetus, IMPETUS_USD_RATE } from '../../ledger/rates.js'
import { fundingBps, applyFundingBps, DEFAULT_FUNDING_BPS } from '../../ledger/depositFunding.js'
import type { AssetPricer } from '../../crystal/AssetPricer.js'
import type { Run, Collection, CollectionPiece, Team, Edition, FeedItem, Project, RunsPage } from './types.js'

/** Options for the owner's settled spend-history listing (`listRuns`). */
export interface ListRunsOpts {
  /** Opaque page cursor from a prior page; omit for the first page. */
  cursor?: string
  /** Page size (clamped 1..100; default 20). */
  limit?: number
}
import type { Collectio, Collectionum, Tractus } from '../../types/collectio.js'
import type { CreateDatasetInput, Dataset, DatasetSummary, Datasets } from '../../types/dataset.js'
import type { Editio, Editionum, ArtifactRef, ArtifactKind, EditioVisibility, EditioCustody, FeedFilter } from '../../types/editio.js'
import type { Sodalitas, Sodalitatum } from '../../types/sodalitas.js'
import type { Provincia, ProvinciaResKind, Provinciarum } from '../../types/provincia.js'
import type { AnimaStore, PublishingPrefs } from '../../types/anima.js'
import type { PublicationAdapter } from '../../crystal/PublicationAdapter.js'
import type { ModerationGate } from '../../crystal/ModerationGate.js'
import { denyModerationGate } from '../../crystal/ModerationGate.js'
import type { VerdictCache } from '../../crystal/VerdictCache.js'
import { contentKey, toCachedVerdict, fromCachedVerdict } from '../../crystal/VerdictCache.js'
import type { ScanFeeCharger } from '../../crystal/ScanFeeCharger.js'
import type { CsamReviewReporter } from '../../crystal/CsamReviewReporter.js'
import { allMediaUrls } from '../../crystal/BucketAdapter.js'
import { makeLogger } from '../../lib/logger.js'
import type { PromptGuard, PromptVerdict } from '../../crystal/PromptGuard.js'
import { permissivePromptGuard } from '../../crystal/PromptGuard.js'
import { spicyModelFor } from '../../crystal/spicyRouting.js'
import type { ModelImporter } from '../../crystal/ModelImporter.js'
import { ModelImportError, SecretRequiredError } from '../../crystal/modelImportResolver.js'
import type { SecretWriter, SecretPresence, SecretProvider } from '../../types/secretum.js'
import { isSecretProvider, SECRET_PROVIDERS, DEFAULT_SECRET_IDLE_DAYS } from '../../types/secretum.js'
import { ownerKeyOf } from '../../crystal/ownerKey.js'
import { isCatalogEligible, classifyModelLicense, activeConditionalLicenses, bindingCapUsd, type CommercialVerdict } from '../../crystal/modelLicense.js'
import { band, bindingCapMicroUsd, type ThresholdBand, type TripwireBandStore } from '../../crystal/licenseTripwire.js'
import type { Redituum } from '../../types/reditus.js'
import { handleStripeCheckout, handleStripeWebhook, type StripeGateway, type StripeWebhookResult } from '../../api/webhooks/stripeWebhook.js'
import { stripeConfigFromEnv, makeStripeGateway } from '../../api/webhooks/stripeGateway.js'
import { packViews, type PackView } from '../../ledger/stripePacks.js'
import type { WideEventStore } from '../../analytics/WideEventStore.js'
import type { CollectioCursor } from '../../crystal/CollectioCursor.js'
import { provenanceHash } from '../../crystal/provenance.js'
import { rarityReport, type RarityReport } from '../../crystal/rarityReport.js'
import type { Tabula, Tabulae, Tabularum } from '../../types/tabula.js'
import { compileTabula, TabulaCompileError } from '../../crystal/compileTabula.js'
import { hashModus } from '../../crystal/hashModus.js'
import type { Depositorum, DepositumStatus } from '../../types/catena.js'
import type { PersonaStore } from '../../types/persona.js'
import { normalizeAddress } from '../../crystal/walletAuth.js'

const log = makeLogger('crystal-api')
const PLATFORM_ANIMA_ID = process.env.PLATFORM_ANIMA_ID ?? 'platform'
/** How long a provisioned TEE session may sit without /runner/ready before the
 *  watchdog fails it and kills the pod. Covers the confidential-CVM multi-minute
 *  boot and up to 3 RunPod WS-probe re-provision rounds (~5 min each). */
const TEE_READY_WATCHDOG_MS = Number(process.env.TEE_READY_WATCHDOG_MS ?? 20 * 60_000)

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
  /** Dataset store — backs `listDatasets`/`listDatasetSummaries`/`getDataset`/`createDataset`.
   *  Absent → dataset ops unavailable. */
  datasets?: Datasets
  /** Team store — backs the team CRUD + team-owned collections. Absent → team ops unavailable. */
  sodalitatum?: Sodalitatum
  /** Project store (Provincia) — backs the account-scoped project CRUD + holdings. Absent → project ops unavailable. */
  provinciarum?: Provinciarum
  /** Workspace store (Tabula, ADR-0008 follow-up) — backs the canvas CRUD + publish-to-Modus
   *  compile. Absent → tabula ops unavailable. */
  tabulae?: Tabularum
  /** Publication store (Editio) — backs `publish`/`feed`/`retract`. Absent → publishing unavailable. */
  editiones?: Editionum
  /** Registered publication adapters, resolved by `destination` key (FeedAdapter, …). */
  publicationAdapters?: PublicationAdapter[]
  /** Trust-boundary →public moderation gate (CSAM/NCMEC). Absent → permissive placeholder. */
  moderationGate?: ModerationGate
  /** Content-addressed verdict cache (spec §7) — identical re-publishes reuse the gate
   *  verdict (no re-scan, no re-charge). Absent → every public publish scans afresh. */
  verdictCache?: VerdictCache
  /** Per-scan fee charger (spec §7) — forwards the paid-classifier cost to the publisher
   *  on a billable, non-cached scan. Absent → no fee (the config-knob default). */
  scanFeeCharger?: ScanFeeCharger
  /** Reviewer-confirmed-CSAM NCMEC report seam (spec §4) — filed by `confirmCsamAndReport`
   *  when an admin affirmatively confirms a held item is CSAM. Absent → the confirm action
   *  still rejects but logs LOUDLY that no report was filed (never a silent miss). */
  csamReviewReporter?: CsamReviewReporter
  /** Input-side CSAM prompt guard (generation boundary, fail-open). Absent → permissive. */
  promptGuard?: PromptGuard
  /** Identity store — reads `Anima.publicatio` to default a publish from the caller's prefs. */
  animae?: AnimaStore
  /** GDPR Art. 17 erasure orchestrator (noema-025) — backs `eraseMe` (DELETE /v1/me). Absent →
   *  erasure unavailable (the endpoint 503s / the deployment ships the flag off). */
  eraser?: MeEraser
  /** Model (Intella) registry — resolves + owner-scopes an `Intella` publish and is the
   *  reconciler's write seam (`setAccess`) for §5d. Absent → model publishing unavailable. */
  intellarum?: Intellarum
  /** Import-by-URL service (Civitai/HF/direct → private Intella). Absent → import unavailable. */
  modelImporter?: ModelImporter
  /** BYO-secret WRITE slice (`put`/`remove` only — NEVER `resolve`; ASYMMETRY contract in
   *  types/secretum.ts). Backs `PUT/DELETE /v1/me/secrets/:provider`. Absent → secrets 501. */
  secretWriter?: SecretWriter
  /** BYO-secret presence (`has` only). Backs `getMe.secrets`. Absent → all 'absent'. */
  secretPresence?: SecretPresence
  /** Pod provisioner for TEE private compute sessions — RunPod (TeeProvisioner) or the
   *  confidential-CVM backend (ConfidentialPodClient), picked in container.ts.
   *  Absent → local dev (manual runner). */
  teeProvisioner?: TeePodProvisioner
  /** Per-asset USD FMV oracle — backs `depositQuote`. THE SAME instance the deposit webhook uses,
   *  so a quote's `pointsQuoted` equals what the webhook credits. Absent → deposit quote 503. */
  pricer?: AssetPricer
  /** The CreditVault deposit address, echoed in the quote/config so the UI knows where to send. */
  depositAddress?: string
  /** The deposit store — backs `myDeposits` (owner-scoped: filtered to the caller's linked
   *  wallets). Absent → `myDeposits` returns []. */
  deposita?: Pick<Depositorum, 'list'>
  /** Persona store — resolves the caller's linked `'web'` wallet addresses for `myDeposits`.
   *  Absent → `myDeposits` returns []. */
  personae?: Pick<PersonaStore, 'findByAnimaId'>
  /** USD revenue book — backs the admin `revenueReport` (the trailing-12mo rollup + license tripwire)
   *  AND the fiat funding rail (`handleStripeWebhook` books a peer fiat `Reditus` via `record`).
   *  Absent → the report + fiat rail are unavailable. */
  redituum?: Pick<Redituum, 'trailingUsdRevenue' | 'record' | 'reverse' | 'findByChargeRef'>
  /** The license-tripwire's persisted band — surfaced in `revenueReport` so the admin sees the
   *  last edge-triggered band alongside the live figure. Absent → lastBand omitted. */
  tripwireBand?: Pick<TripwireBandStore, 'last'>
  /** Wide-event COGS rollup — backs the admin `cogsReport` (trailing-window spend + job count,
   *  the read-only pair to `revenueReport`). Absent → the report is unavailable. */
  costReport?: Pick<WideEventStore, 'sumCostUsd'>
  /** Fiat rail (Stripe) gateway override — tests inject a fake. Absent → built from env
   *  (`STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET`); unconfigured env → the rail reports 503.
   *  Idempotency needs no injected store: it is the DURABLE unique partial indexes on
   *  `Signum.testis` (auctor:'stripe:purchase') + `Reditus.chargeRef` (origo:'fiat'). */
  stripe?: StripeGateway
}

/** Inputs to start a Collection (a Collectio): a base modus expanded over a Tractus[] grid.
 *
 *  `modusId` / `total` / `tractus` are REQUIRED for an immediate (non-draft) collect — that
 *  path dispatches and spends, and its strictness is unchanged. They may be omitted only when
 *  `draft` is true: a draft is a naming act, and it learns its flow, supply and grid later via
 *  `patchCollectionDraft`. `fireCollection` refuses a draft that is still missing any of them. */
export interface CollectOpts {
  /** The flow expanded across the grid (atomic or a compositus pipeline). Draft-optional. */
  modusId?: string
  /** Target number of pieces to generate. Draft-optional (defaults to 0 on a draft). */
  total?: number
  /** The axes of variation. Each Tractus is one trait/parameter dimension. Draft-optional. */
  tractus?: Tractus[]
  /** Base aditus applied to every piece (e.g. `_basePrompt` with `{{axis}}` tokens). */
  aditusBase?: Record<string, unknown>
  /** Max concurrent pieces in flight. Default 3. */
  concurrentia?: number
  /** Optional human name. */
  nomen?: string
  /** Optional working note on what this collection is. */
  descriptio?: string
  /** Opt-in DNA uniqueness — no two pieces share a trait combination (see Collectio.dna). */
  dna?: boolean
  /** Hold every completed piece for review before it counts (see Collectio.reviewEnabled).
   *  Omit → the platform default applies. */
  reviewEnabled?: boolean
  /** Create as a DRAFT — author tractus (garden/rules) without firing. The run is
   *  started later by `fireCollection`. Omit/false → create + fire in one shot. */
  draft?: boolean
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

/** Inputs to import a model by URL (Civitai/HF/direct → a private Intella). */
export interface ImportModelOpts {
  /** Civitai page/`?modelVersionId`, HuggingFace repo, or a direct `.safetensors`/`.ckpt` URL. */
  url: string
  /** genus for a direct-file URL where the origin can't be scraped to infer it. Default 'lora'. */
  genus?: 'lora' | 'model'
}

/** Admin inputs to clear/backfill a model's license (going-public review). */
export interface SetModelLicenseOpts {
  /** Explicit license id to record (e.g. 'apache-2.0', 'stability-community'). */
  license?: string
  /** Explicit commercial-catalog verdict — the operator's clearance decision. */
  commercialUse?: CommercialVerdict
  /** Re-derive license + verdict from the model's recorded base string (bulk-fix legacy). */
  reclassify?: boolean
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
  /** Flow-level routing line — what this flow is for and when to pick it over its
   *  siblings (`Modus.descriptio`). Lets the concierge/router disambiguate flows that
   *  share a categoria (e.g. the text-to-image family). Absent when the flow sets none. */
  descriptio?: string
  categoria?: unknown
  /** Number of steps — present only for a compositus (spell). Absent = an atomic flow.
   *  Lets an agent tell a one-shot tool from a multi-step spell at the catalog level. */
  steps?: number
  /** The flow's canon verb, derived at query time from its aditus/exitus ports via
   *  `resolveCanonVerb` (noema-054) — lets a future concierge/classifier read what
   *  kind of modus each flow is without a stored/hashed taxonomy field. */
  modusGenus: CanonVerb
}

/** Port keys a flow may use for its negative prompt (first present one is filled). */
const NEGATIVE_PORT_KEYS = ['negative_prompt', 'negativePrompt', 'negative']

/** The gated ADULT `contentRating` set (noema-091). {suggestive, explicit} are hidden from the model
 *  catalog unless the caller has spicyMode on; {untriaged, sfw} (and unrated) are always visible. */
const ADULT_CONTENT_RATINGS: ReadonlySet<IntellaContentRating> = new Set<IntellaContentRating>(['suggestive', 'explicit'])

/**
 * Layer the owner's account-level defaults under the cast-time aditus:
 * cast-time input > affines (per-modus) > generatio (cross-cutting) > modus defaults.
 * Only DECLARED ports (`modus.aditus`) are filled — a stale default never injects an
 * unknown input. `style` augments (prepends to) the final prompt rather than overriding it.
 */
export function applyAccountDefaults(
  ports: Record<string, unknown>,
  aditus: Record<string, unknown>,
  affines: Record<string, unknown> | undefined,
  generatio: Generatio | undefined,
): Record<string, unknown> {
  const account: Record<string, unknown> = {}
  // generatio (lowest account tier): fill a negative-prompt port if the flow has one.
  if (generatio?.negativePrompt) {
    const key = NEGATIVE_PORT_KEYS.find((k) => k in ports)
    if (key) account[key] = generatio.negativePrompt
  }
  // affines override generatio within the account tier — declared ports only.
  if (affines) {
    for (const [k, v] of Object.entries(affines)) if (k in ports) account[k] = v
  }
  // ── Lever (c): spicy-aware default-negative seam (noema-091) ────────────────
  // A future PLATFORM-injected SFW-forcing default negative (distinct from the user's OWN
  // `generatio.negativePrompt` handled above) would be assembled HERE, and MUST be relaxed/skipped
  // when spicy mode is on. Tracked `src/` has NO such platform default today, so this is a present-day
  // NO-OP against tracked code — a platform SFW default, if any, lives in the gitignored
  // `src/private/compliance/` layer this item cannot see or verify. The gate is structured now so any
  // future default is born spicy-aware; nothing is invented here to then "relax".
  if (generatio?.spicyMode !== true) {
    // (no tracked platform SFW-forcing default negative to inject yet — see the noema-091 PR notes)
  }
  // Cast-time input wins over every account default.
  const out = { ...account, ...aditus }
  // Default style prepends to the resolved prompt (augments, does not override).
  if (generatio?.style && typeof out.prompt === 'string' && out.prompt.length > 0) {
    out.prompt = `${generatio.style}, ${out.prompt}`
  }
  return out
}

export class CrystalApi {
  constructor(private readonly deps: CrystalApiDeps) {}

  /**
   * Dispute-freeze spend guard (noema-082, Q3). Rejects a user-initiated SPEND when the caller's
   * anima is frozen by a pending chargeback. Only identified callers carry the flag — anonymous
   * (commitment) and bearer (bursaToken) auctors are freeze-blind (there is no anima to freeze), and
   * a deployment without an `animae` store simply skips the check. LOGIN never routes through here.
   */
  private async _assertNotDisputeFrozen(auctor: AuctorKey): Promise<void> {
    if (!('animaId' in auctor) || !this.deps.animae) return
    const anima = await this.deps.animae.find(auctor.animaId)
    if (anima?.disputeFrozen) {
      throw Errors.authForbidden('This account is frozen pending review of a payment dispute. Spending is paused until the dispute is resolved.')
    }
  }

  /**
   * GDPR Art. 17 right-to-erasure (noema-025) — pseudonymize-and-tombstone the CALLER'S OWN
   * account. Self-only by construction: erases exactly the authenticated `auctor`'s animaId, so a
   * caller can never erase another owner (admin-erase is out of scope). Only an IDENTIFIED soul
   * can be erased — anon (`commitment`/`bursaToken`) callers hold no identified PII, so this is a
   * 403 for them. Delegates the irreversible act to the dedicated, reviewable `MeEraser`; the
   * financial ledger + ZK set are untouched (see MeEraser). Wired only when erasure is enabled.
   */
  async eraseMe(auctor: AuctorKey): Promise<ErasureReceipt> {
    if (!this.deps.eraser) throw Errors.internal('account erasure unavailable')
    if (!('animaId' in auctor)) {
      throw Errors.authForbidden('Only a signed-in account can be erased.')
    }
    return this.deps.eraser.erase(auctor.animaId)
  }

  /**
   * Invoke a flow for an auctor and return its public Run projection.
   *
   * Target resolution: an explicit `modusId` wins; otherwise the `verb` is
   * resolved through the owner's Consuetudinum rebinds, falling back to the
   * platform CANON_VERBS table. Nothing resolved → `not_found.flow`.
   */
  /**
   * Normalize pinned-model tokens (id | slug | trigger, or already-shaped `ModelRef`s) into
   * canonical `ModelRef`s the Compiler can resolve, enforcing access. The single chokepoint for
   * BOTH the run path (`invokeFlow`, below) and the concierge's pre-GO resolvability check
   * (ConciergeAgent) — "the concierge never offers GO on a config that can't compile". An
   * unresolvable token → `Errors.modelNotResolved` (422, not a 500); a private model the caller
   * doesn't own → `Errors.modelForbidden` (403). (noema-113)
   */
  async resolvePinnedModels(auctor: AuctorKey, pinned: readonly PinnedInput[]): Promise<ModelRef[]> {
    if (pinned.length === 0) return []
    const store = this.deps.intellarum
    if (!store) {
      // No registry wired (minimal deployment / dev double): can only accept already-shaped refs;
      // a bare string can't be resolved here (and must not reach the Compiler as `{id: undefined}`).
      return pinned.map((p) => {
        if (typeof p !== 'string' && p && p.id) return p
        throw Errors.modelNotResolved(typeof p === 'string' ? p : String((p as ModelRef)?.id))
      })
    }
    const ownerKey = ownerKeyOf(auctor)
    const out: ModelRef[] = []
    for (const input of pinned) {
      const res = await resolvePinnedModel(store, input, ownerKey)
      if (!res.ok) {
        throw res.reason === 'forbidden' ? Errors.modelForbidden(res.token) : Errors.modelNotResolved(res.token)
      }
      out.push(res.ref)
    }
    return out
  }

  async invokeFlow(
    auctor: AuctorKey,
    target: InvokeTarget,
    aditus: Record<string, unknown>,
    opts: InvokeOpts = {},
  ): Promise<Run> {
    const { inceptor, modorum, cursorum, completor, actumIndex, consuetudinum, compositusCursor } = this.deps

    // Dispute freeze (noema-082, Q3): an anima frozen by a chargeback (`charge.dispute.created`)
    // cannot initiate a generation SPEND (value outflow) while the dispute is held for review. This
    // is the run-spend chokepoint (the peer chokepoint is owned-purse mint in purseRouter). LOGIN and
    // value-inflow are untouched; only identified callers carry the flag (anon/bursa paths are freeze
    // -blind, and `reserve` stays freeze-blind by design so system paths are unaffected).
    await this._assertNotDisputeFrozen(auctor)

    let modusId: string | undefined
    if (target.modusId) {
      modusId = target.modusId
    } else if (target.verb) {
      modusId = (await consuetudinum?.resolve(auctor, target.verb)) ?? CANON_VERBS[target.verb]
    }
    if (!modusId) throw Errors.notFoundFlow(target.verb ?? '?')

    // Account-level defaults (Consuetudinum), applied UNDER the cast-time aditus:
    //   cast-time input > affines (per-modus) > generatio (cross-cutting) > modus defaults.
    // Only DECLARED ports are filled, so a stale default can never inject an unknown input.
    let effectiveAditus = aditus
    let generatio: Generatio | undefined
    if (consuetudinum) {
      const [affines, resolvedGeneratio] = await Promise.all([
        consuetudinum.resolveAffines(auctor, modusId),
        consuetudinum.resolveGeneratio(auctor),
      ])
      generatio = resolvedGeneratio
      if (affines || generatio) {
        const ports = (await modorum.find(modusId))?.aditus ?? {}
        effectiveAditus = applyAccountDefaults(ports, aditus, affines, generatio)
      }
    }

    // ── Lever (b): spicy alt-model routing (noema-091) ──────────────────────────
    // When spicyMode is ON and the resolved modus has a mapped willing/uncensored OpenRouter model,
    // repoint `aditus.model` BEFORE it reaches ApiCursor's `aditus.model ?? spec.defaultModel` seam.
    // SHIPPED with an EMPTY map (`crystal/spicyRouting`): no modus resolves to an override, so this is
    // a strict no-op until the operator populates it. Keyed on modusId AND gated on `spicyMode === true`
    // (which itself required a recorded 18+ attestation to persist). This NEVER touches the moderation
    // path: the PromptGuard below runs on the effective aditus UNCONDITIONALLY, spicy or not.
    if (generatio?.spicyMode === true) {
      const spicyModel = spicyModelFor(modusId)
      if (spicyModel !== undefined) effectiveAditus = { ...effectiveAditus, model: spicyModel }
    }

    // Input CSAM guard — refuse a prompt that solicits CSAM before we spend anything.
    // Runs on the EFFECTIVE aditus (post account-defaults, incl. affixes) so an injected
    // default can't smuggle content past it. FAIL-OPEN: a guard implementation error must
    // not break generation (the publish-time ModerationGate is the fail-closed backstop),
    // so only an explicit `ok:false` refuses; a throw inside the guard is swallowed.
    let promptVerdict: PromptVerdict = { ok: true }
    try {
      promptVerdict = await this._promptGuard().check(effectiveAditus)
    } catch { /* fail-open: guard error → allow */ }
    if (!promptVerdict.ok) throw Errors.contentRefused(promptVerdict.reason)

    // Admission spend cap — refuse before dispatch if the upper-bound estimate exceeds
    // maxImpetus. Estimate the EFFECTIVE aditus (post account-defaults) — the same inputs
    // that will run — so an affine bumping a cost driver (steps/count/resolution) is capped.
    if (opts.maxImpetus !== undefined) {
      const est = await this._estimate(modusId, effectiveAditus)
      if (est > BigInt(opts.maxImpetus)) {
        throw Errors.capTooLow({ estimated: est.toString(), maxImpetus: String(opts.maxImpetus) })
      }
    }

    // Normalize pinned models (noema-113): the concierge proposes bare id|slug|trigger strings; the
    // run path threads them as typed `ModelRef[]` straight into the Compiler, which resolves by `id`.
    // Coerce each to a canonical `ModelRef{id}` HERE — the single run chokepoint every caller passes
    // through — so an unregistered/forbidden pin fails fast with a clear non-500 error instead of the
    // Compiler's misleading `No URL for model 'undefined'` on a paid dispatch.
    const pinnedModels = opts.pinnedModels?.length
      ? await this.resolvePinnedModels(auctor, opts.pinnedModels)
      : undefined

    const inceptio: Inceptio = {
      modusId,
      aditus: effectiveAditus,
      by: opts.by ?? auctor,
      ...(opts.studioId ? { modoId: opts.studioId } : {}),
      ...(pinnedModels?.length ? { pinnedModels } : {}),
      ...(opts.computeStrategy ? { computeStrategy: opts.computeStrategy } : {}),
      ...(opts.gpuClass ? { gpuClass: opts.gpuClass } : {}),
    }

    const { actum } = await dispatchInceptio(
      { inceptor, modorum, cursorum, completor, actumIndex, compositusCursor },
      inceptio,
    )
    return toRunDetail(actum)
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
    return toRunDetail(a)
  }

  /**
   * List the caller's SETTLED spend history — owner-scoped, cursor-paginated, newest first,
   * plus a lifetime running total (`GET /v1/me/runs`).
   *
   * OWNERSHIP: the settled index is keyed by the owner (`animaId` OR anon `commitment`), so
   * the store's `listSettled(auctor, …)` is inherently owner-scoped — the SAME identity-blind
   * primitive `/status` uses to list in-flight gens (`findFor(auctorKey)`). There is no
   * list-by-`_owns` (Actum carries no identity column — the whole reason this index exists);
   * `_owns` is for single-run fetch (`getRun`), not listing. A bursaToken caller gets an empty
   * page (those runs are never indexed). SETTLED = `completus` only — a refunded `fractus` run
   * is not spend and was pruned at settlement.
   *
   * Degrades to an empty page when the wired index lacks the settled-history methods (dev/in-
   * memory doubles that don't retain).
   */
  async listRuns(auctor: AuctorKey, opts: ListRunsOpts = {}): Promise<RunsPage> {
    const index = this.deps.actumIndex
    if (!index?.listSettled || !index.sumSettledImpetus) {
      return { runs: [], runningTotal: { impetus: '0', usd: 0 } }
    }
    const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 20) || 20, 1), 100)
    const [page, totalImpetus] = await Promise.all([
      index.listSettled(auctor, { limit, ...(opts.cursor ? { cursor: opts.cursor } : {}) }),
      index.sumSettledImpetus(auctor),
    ])
    return {
      runs: page.entries.map(toSettledRun),
      ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
      runningTotal: { impetus: totalImpetus, usd: Number(totalImpetus) * IMPETUS_USD_RATE },
    }
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
    // Dispute freeze (noema-082, freeze-boundary v2 2026-07-22): the ENTIRE Collections path is a
    // user-initiated credit outflow — a non-draft collect dispatches (spends) immediately, and a
    // draft is fired later. Gated at the top alongside invokeFlow (run spend) and owned-purse mint.
    await this._assertNotDisputeFrozen(auctor)
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

    // A DRAFT may not know its flow yet (creating a collection is a naming act — the flow,
    // supply and grid are authored afterwards). An ABSENT flow on a draft is not a bogus flow,
    // so validation is skipped and the collection is left flowless (`''`) with no provenance.
    // Everything else — including a draft that DID name a flow, and every non-draft — keeps the
    // original strictness: a bogus/missing modusId would otherwise create a collection whose
    // every piece fails at dispatch. (Mirrors invokeFlow/quote.)
    const isDraft = !!opts.draft
    const modusId = opts.modusId ?? ''
    const tractus = opts.tractus ?? []
    const aditusBase = opts.aditusBase ?? {}

    let provenance = ''
    if (!isDraft || opts.modusId !== undefined) {
      const modus = await this.deps.modorum.find(modusId)
      if (!modus) throw Errors.notFoundFlow(modusId)
      // Pin the provenance hash to the resolved flow version.
      provenance = provenanceHash({ modusId, modusVersio: modus.versio, tractus, aditusBase })
    }

    const collectio = await collectiones.create({
      ...(opts.nomen !== undefined ? { nomen: opts.nomen } : {}),
      ...(opts.descriptio !== undefined ? { descriptio: opts.descriptio } : {}),
      modusId,
      aditusBase,
      tractus,
      numerus: opts.total ?? 0,
      provenanceHash: provenance,
      by,
      ...(sodalitasId !== undefined ? { sodalitasId } : {}),
      ...(owners !== undefined ? { owners } : {}),
      concurrentia: opts.concurrentia ?? 3,
      ...(opts.dna !== undefined ? { dna: opts.dna } : {}),
      ...(opts.reviewEnabled !== undefined ? { reviewEnabled: opts.reviewEnabled } : {}),
      // Draft = authored but not fired; tractus stays editable until fireCollection.
      status: opts.draft ? 'draft' : 'nascens',
    })
    // A draft is NOT dispatched — the caller authors tractus, then fires it.
    if (!opts.draft) await collectioCursor.start(collectio)
    return toCollection((await collectiones.find(collectio.id)) ?? collectio)
  }

  /**
   * Fire a DRAFT collection — freeze its tractus and start the run. Re-derives the
   * provenance hash from the current tractus + the flow's live version (pinning
   * exactly what executes), then dispatches. Owner-scoped + funder-only (it spends).
   * Idempotent-guarded: only a `draft` may be fired.
   */
  async fireCollection(auctor: AuctorKey, id: string): Promise<Collection> {
    // Dispute freeze (noema-082, freeze-boundary v2): firing a draft dispatches the run — a spend.
    await this._assertNotDisputeFrozen(auctor)
    const { collectiones, collectioCursor } = this.deps
    if (!collectiones || !collectioCursor) throw Errors.notFoundCollection('collections')
    const c = await this._ownedCollection(auctor, id)
    if (!this._isFunder(auctor, c)) {
      throw Errors.authForbidden('only the collection funder can fire it')
    }
    if (c.status !== 'draft') throw Errors.inputMalformed('only a draft collection can be fired')

    // Creating a collection is free and may leave the generative config unset — so firing is
    // where completeness is enforced. Without these, an unfinished draft would not "fail to
    // fire", it would dispatch garbage: a flowless run, a zero-piece run, or a grid with no
    // axis of variation. Each missing piece gets its own message so the UI can say what to fix.
    if (!c.modusId) throw Errors.notFoundFlow('(none chosen yet)')
    if (!(c.numerus > 0)) throw Errors.inputMalformed('this collection has no supply yet — set how many pieces to generate before firing')
    if (c.tractus.length === 0) throw Errors.inputMalformed('this collection has no traits yet — add at least one axis of variation before firing')

    // Re-pin provenance to the flow version at fire time (the config that actually runs).
    const modus = await this.deps.modorum.find(c.modusId)
    const provenance = provenanceHash({
      modusId: c.modusId,
      modusVersio: modus?.versio,
      tractus: c.tractus,
      aditusBase: c.aditusBase,
    })
    const fired = await collectiones.update(id, { provenanceHash: provenance, status: 'nascens' })
    await collectioCursor.start(fired)
    return toCollection((await collectiones.find(id)) ?? fired)
  }

  /**
   * The DRAFT-authoring write: set a draft's base flow, supply and/or trait grid, and
   * re-derive its provenance hash — the content-address MUST change when the flow, the grid,
   * a weight, an exclude, or a tag changes. Frozen once fired. Owner-scoped.
   *
   * `collect` may now create a draft that knows none of these (create is a naming act), so this
   * is where a draft learns them. A flowless draft still content-addresses to `''` — there is
   * nothing to hash until a flow is chosen.
   */
  async patchCollectionDraft(
    auctor: AuctorKey,
    id: string,
    patch: { tractus?: Tractus[]; modusId?: string; numerus?: number },
  ): Promise<Collection> {
    const { collectiones } = this.deps
    if (!collectiones) throw Errors.notFoundCollection('collections')
    const c = await this._ownedCollection(auctor, id)
    if (c.status !== 'draft') throw Errors.inputMalformed('a collection’s tractus is frozen once it is fired')

    const modusId = patch.modusId ?? c.modusId
    const tractus = patch.tractus ?? c.tractus
    const modus = modusId ? await this.deps.modorum.find(modusId) : null
    // Only a NEWLY-named flow is validated — an already-stored one keeps the pre-existing
    // lenient behaviour (an unresolvable modus simply pins an undefined version).
    if (patch.modusId !== undefined && !modus) throw Errors.notFoundFlow(patch.modusId)
    const provenance = modusId
      ? provenanceHash({ modusId, modusVersio: modus?.versio, tractus, aditusBase: c.aditusBase })
      : ''

    return toCollection(await collectiones.update(id, {
      tractus,
      provenanceHash: provenance,
      ...(patch.modusId !== undefined ? { modusId } : {}),
      ...(patch.numerus !== undefined ? { numerus: patch.numerus } : {}),
    }))
  }

  /** Replace a DRAFT collection's tractus. Thin alias over the draft-authoring write. */
  async patchCollectionTractus(auctor: AuctorKey, id: string, tractus: Tractus[]): Promise<Collection> {
    return this.patchCollectionDraft(auctor, id, { tractus })
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

  /**
   * List a Collection's generated pieces for the curation queue — each completed
   * Actum's media + stamped attributes + review state. Filtered by `review`
   * (default 'pending', the review use case; 'all' returns every completed piece).
   * Owner-scoped.
   */
  async listCollectionPieces(
    auctor: AuctorKey,
    id: string,
    review: 'pending' | 'approved' | 'rejected' | 'all' = 'pending',
  ): Promise<CollectionPiece[]> {
    const c = await this._ownedCollection(auctor, id)
    const out: CollectionPiece[] = []
    for (const actumId of c.acta) {
      const actum = await this.deps.actorum.findById(actumId)
      if (!actum || actum.status !== 'completus') continue
      const outcome = (actum.exitus?.reviewOutcome as CollectionPiece['review'] | undefined) ?? 'none'
      if (review !== 'all' && outcome !== review) continue
      const attrs = actum.aditus?._attributes
      out.push({
        actumId,
        review: outcome,
        output: actum.exitus,
        ...(Array.isArray(attrs) ? { attributes: attrs as CollectionPiece['attributes'] } : {}),
      })
    }
    return out
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
    // Dispute freeze (noema-082, freeze-boundary v2): extend raises a collection's funded piece
    // count (numerus + addCount) and dispatches those NEW pieces — new user-initiated outflow, the
    // same collectioCursor-dispatch mechanism resume/fire use. Gated per the ruling's "principle is
    // total" standing instruction for any FURTHER discovered outflow chokepoint (noted for review).
    await this._assertNotDisputeFrozen(auctor)
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

  /** Pause dispatching new pieces (in-flight finish). Persisted — survives a restart. Owner-scoped. */
  async pauseCollection(auctor: AuctorKey, id: string): Promise<Collection> {
    const c = await this._ownedCollection(auctor, id)
    await this.deps.collectioCursor?.pause(id)
    return toCollection((await this.deps.collectiones!.find(id)) ?? c)
  }

  /** Resume dispatching after a pause. Owner-scoped. */
  async resumeCollection(auctor: AuctorKey, id: string): Promise<Collection> {
    // Dispute freeze (noema-082, freeze-boundary v2): resume triggers new spends. After a dispute
    // resolves the operator lifts the flag first, then resume works.
    await this._assertNotDisputeFrozen(auctor)
    const c = await this._ownedCollection(auctor, id)
    await this.deps.collectioCursor?.resume(id)
    return toCollection((await this.deps.collectiones!.find(id)) ?? c)
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

    // License gate (compliance): the public catalog is a COMMERCIAL surface, so a model may only be
    // PROMOTED there (visibility !== 'private') if its license clears commercial use. `familia` can't
    // carry this — FLUX schnell (Apache ✅) and dev (Non-Commercial ❌) are both 'flux' — so it keys
    // on the model's recorded `commercialUse` verdict (set at import/training via modelLicense.ts).
    // `isCatalogEligible` is the policy: 'yes' + 'conditional' pass (we track revenue against the
    // conditional caps); 'no'/'unknown' are refused pending an ADMIN license clearance (setModelLicense
    // backfill). A model with NO recorded verdict (undefined) is not gated here (legacy). Private/
    // personal use is never blocked — this is listing, not use (spec/model-import.md).
    if (ref.kind === 'intella' && visibility !== 'private' && owned.intella?.commercialUse && !isCatalogEligible(owned.intella.commercialUse)) {
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
    const updated = await editiones.update(id, { status: 'retracted' })
    await this._reconcile(updated)
    return toEdition(updated)
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
  private async _settlePublication(editioId: string): Promise<void> {
    const editiones = this.deps.editiones
    if (!editiones) return
    const e = await editiones.find(editioId)
    if (!e || e.status !== 'pending') return

    const artifact = { ref: e.artifactRef, output: await this._artifactOutput(e.artifactRef), editioId: e.id, by: e.by }
    // The curation/CSAM gate runs before anything goes live for (a) a public media surface
    // (feed/marketplace) and (b) a PUBLIC MODEL PROMOTION — an intella becoming resolvable on
    // the shared catalogue (visibility !== 'private'). A model has no media surface, so its
    // "public" is catalogue resolvability; listing it publicly passes the same ModerationGate
    // over its preview samples (spec/model-import.md §"Curation review"). Private model
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
      let verdict: import('../../crystal/ModerationGate.js').ModerationVerdict | null = cached ? fromCachedVerdict(cached) : null

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
        if (verdict.hold) {
          // HOLD for human review: NOT a reject, NOT a report. Stays `pending`, but the
          // worker's claim skips reviewOutcome:'pending' so it won't re-scan — it waits
          // for an admin to approve (→ re-settle, gate bypassed) or reject.
          await editiones.update(editioId, { reviewOutcome: 'pending' })
          return
        }
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

  /** Whether an adapter is registered (without throwing) — gates the `both` mirror. */
  private _hasAdapter(key: string): boolean {
    return this.deps.publicationAdapters?.some((a) => a.key === key) ?? false
  }

  /** Whether the caller has a BYO account configured for a model registry destination. */
  private _hasBYOAccount(destination: string, prefs?: PublishingPrefs): boolean {
    return destination === 'civitai' ? !!prefs?.civitaiAccount : !!prefs?.huggingFaceAccount
  }

  /** The →public moderation gate. Defaults to DENY (fail-closed) when none is wired:
   *  an unconfigured CSAM gate must never approve public content. The container wires
   *  the permissive gate only under an explicit MODERATION_ALLOW_UNSCANNED opt-in. */
  private _moderationGate(): ModerationGate {
    return this.deps.moderationGate ?? denyModerationGate
  }

  /** Input CSAM prompt guard. Defaults PERMISSIVE (fail-open) — the fail-closed line is
   *  the publish-time ModerationGate; an unconfigured guard must not block generation. */
  private _promptGuard(): PromptGuard {
    return this.deps.promptGuard ?? permissivePromptGuard
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

  // ── Projects (Provincia) — an account-owned workspace lens ────────────────────

  /**
   * Create a project the caller owns. Projects require an identified (animaId)
   * caller — the account IS the ownership boundary (there is no anon project).
   * If `teamId` is given the caller must be a member of that team.
   */
  async createProject(
    auctor: AuctorKey,
    opts: { name: string; desc?: string; glyph?: string; color?: string; teamId?: string },
  ): Promise<Project> {
    const animaId = this._projectAnimaId(auctor)
    if (opts.teamId !== undefined) await this._memberTeam(auctor, opts.teamId)
    const ornatus = ornatusOf(opts)
    const created = await this._projectStore().create({
      animaId,
      nomen: opts.name,
      ...(opts.desc !== undefined ? { descriptio: opts.desc } : {}),
      ...(ornatus !== undefined ? { ornatus } : {}),
      datasetIds: [], modelIds: [], collectionIds: [],
      ...(opts.teamId !== undefined ? { sodalitasId: opts.teamId } : {}),
    })
    return toProject(created)
  }

  /** List the projects the caller owns. */
  async listProjects(auctor: AuctorKey): Promise<Project[]> {
    const animaId = this._projectAnimaId(auctor)
    return (await this._projectStore().listByOwner(animaId)).map(toProject)
  }

  /** Fetch one owned project, or 404. */
  async getProject(auctor: AuctorKey, id: string): Promise<Project> {
    return toProject(await this._ownedProject(auctor, id))
  }

  /** Patch a project's metadata (name/desc/glyph/color/teamId). Owner-only. */
  async updateProject(
    auctor: AuctorKey,
    id: string,
    patch: { name?: string; desc?: string; glyph?: string; color?: string; teamId?: string | null },
  ): Promise<Project> {
    const project = await this._ownedProject(auctor, id)
    if (patch.teamId != null) await this._memberTeam(auctor, patch.teamId)
    const ornatus = ornatusOf(patch, project.ornatus)
    const next = await this._projectStore().update(id, {
      ...(patch.name !== undefined ? { nomen: patch.name } : {}),
      ...(patch.desc !== undefined ? { descriptio: patch.desc } : {}),
      ...(ornatus !== undefined ? { ornatus } : {}),
      // teamId: null clears the reference; a string sets it; undefined leaves it.
      ...(patch.teamId === null ? { sodalitasId: undefined } : patch.teamId !== undefined ? { sodalitasId: patch.teamId } : {}),
    })
    return toProject(next)
  }

  /** Delete a project. Owner-only. Filed assets are untouched (holdings are references). */
  async deleteProject(auctor: AuctorKey, id: string): Promise<void> {
    await this._ownedProject(auctor, id)
    await this._projectStore().remove(id)
  }

  /** File an asset reference into a project's holdings (idempotent). Owner-only. */
  async fileAsset(auctor: AuctorKey, id: string, kind: string, assetId: string): Promise<Project> {
    if (!assetId) throw Errors.inputMalformed('assetId is required')
    const field = HOLDING_FIELD[resKind(kind)]
    const project = await this._ownedProject(auctor, id)
    if (project[field].includes(assetId)) return toProject(project)
    return toProject(await this._projectStore().update(id, { [field]: [...project[field], assetId] }))
  }

  /** Remove an asset reference from a project's holdings (idempotent). Owner-only. */
  async unfileAsset(auctor: AuctorKey, id: string, kind: string, assetId: string): Promise<Project> {
    const field = HOLDING_FIELD[resKind(kind)]
    const project = await this._ownedProject(auctor, id)
    if (!project[field].includes(assetId)) return toProject(project)
    return toProject(await this._projectStore().update(id, { [field]: project[field].filter((x) => x !== assetId) }))
  }

  // ── Tabulae (canvas workspaces, ADR-0008 follow-up) ──────────────────────────

  /** List the caller's own Tabulae (drafts + published), newest-saved first. */
  async listTabulae(auctor: AuctorKey): Promise<Tabulae> {
    const all = await this._tabulaeStore().list({ auctor })
    return all.slice().sort((a, b) => b.mutatum.getTime() - a.mutatum.getTime())
  }

  /** Create a new draft Tabula owned by the caller. */
  async createTabula(auctor: AuctorKey, opts: { nomen: string; descriptio?: string; visibilitas?: Tabula['visibilitas'] }): Promise<Tabula> {
    if (!opts.nomen?.trim()) throw Errors.inputMalformed('nomen is required')
    return this._tabulaeStore().create({
      nomen: opts.nomen,
      ...(opts.descriptio !== undefined ? { descriptio: opts.descriptio } : {}),
      auctor,
      status: 'draft',
      visibilitas: opts.visibilitas ?? 'privata',
    })
  }

  /** Fetch one owned Tabula, or 404 (a stranger gets the same 404 as a nonexistent id). */
  async getTabula(auctor: AuctorKey, id: string): Promise<Tabula> {
    return this._ownedTabula(auctor, id)
  }

  /** Patch a Tabula's graph/metadata. Owner-only. */
  async updateTabula(
    auctor: AuctorKey,
    id: string,
    patch: { nomen?: string; descriptio?: string; nodi?: Tabula['nodi']; vincula?: Tabula['vincula']; visibilitas?: Tabula['visibilitas'] },
  ): Promise<Tabula> {
    await this._ownedTabula(auctor, id)
    return this._tabulaeStore().update(id, patch)
  }

  /** Delete a Tabula outright. Owner-only. */
  async deleteTabula(auctor: AuctorKey, id: string): Promise<void> {
    await this._ownedTabula(auctor, id)
    await this._tabulaeStore().remove(id)
  }

  /**
   * Publish a Tabula: compile its canvas graph into a compositus Modus and register it
   * (Modorum), owner-keyed, `canonica: false`. Republishing the same Tabula bumps `versio`
   * on the SAME modus id (the Tabula's published identity is stable across edits).
   */
  async publishTabula(auctor: AuctorKey, id: string): Promise<{ modusId: string }> {
    const tabula = await this._ownedTabula(auctor, id)
    let compiled
    try {
      compiled = await compileTabula(tabula, (modusId) => this.deps.modorum.find(modusId))
    } catch (err) {
      if (err instanceof TabulaCompileError) {
        throw Errors.tabulaGraphInvalid(err.message, { code: err.code, ...(err.vinculumId ? { vinculumId: err.vinculumId } : {}) })
      }
      throw err
    }

    const modusId = tabula.modusId ?? tabula.id
    const previous = await this.deps.modorum.find(modusId)
    const versio = previous ? this._bumpVersio(previous.versio) : '1.0.0'
    const now = new Date()
    const modus: Modus = {
      id: modusId,
      nomen: tabula.nomen,
      genus: 'compositus',
      versio,
      contentHash: '',
      aditus: compiled.aditus,
      exitus: compiled.exitus,
      gradus: compiled.gradus,
      auctor,
      canonica: false,
      natum: previous?.natum ?? now,
      mutatum: now,
    }
    modus.contentHash = hashModus(modus)
    await this.deps.modorum.register(modus)
    await this._tabulaeStore().update(id, { modusId, status: 'published' })
    return { modusId }
  }

  /** List the flows (atomic + compositus) the caller owns — the picker's "mine" filter, the
   *  smaller-diff twin of `GET /v1/flows` (spec: "either extend with ?mine=1 or filter the
   *  registry list" — this is the filter route, owner-scoped like `/me/models`). */
  async listMyFlows(auctor: AuctorKey): Promise<FlowSummary[]> {
    const modi = await this.deps.modorum.list({ auctor })
    return modi.map((m) => {
      const categoria = (m as { categoria?: unknown }).categoria
      return {
        id: m.id,
        nomen: m.nomen,
        versio: m.versio,
        ...(m.descriptio !== undefined ? { descriptio: m.descriptio } : {}),
        ...(categoria !== undefined ? { categoria } : {}),
        ...(m.genus === 'compositus' ? { steps: m.gradus?.length ?? 0 } : {}),
        modusGenus: resolveCanonVerb(m),
      }
    })
  }

  // ── Datasets (T4) ────────────────────────────────────────────────────────

  private _datasetsStore(): Datasets {
    const store = this.deps.datasets
    if (!store) throw new ApiError('not_found.dataset', 'datasets unavailable', 404)
    return store
  }

  /** Datasets are animaId-keyed like Provincia — anonymous (commitment/bursa) callers
   *  cannot own one (mirrors `_projectAnimaId`). */
  private _datasetOwner(auctor: AuctorKey): string {
    if ('animaId' in auctor) return auctor.animaId
    throw Errors.authForbidden('datasets require an identified account')
  }

  /** Pull every http(s) URL value out of an Actum's opaque `exitus` — the generic v1
   *  heuristic for "the media this run produced" (exitus has no fixed cross-modus
   *  schema; `additionalProperties: true` in apiContract.ts's RunSchema). */
  private _urlsFromExitus(exitus: Record<string, unknown> | undefined): string[] {
    const urls: string[] = []
    const visit = (v: unknown): void => {
      if (typeof v === 'string' && /^https?:\/\//.test(v)) urls.push(v)
      else if (Array.isArray(v)) v.forEach(visit)
      else if (v && typeof v === 'object') Object.values(v).forEach(visit)
    }
    visit(exitus)
    return urls
  }

  /** List the full `Dataset[]` for the caller — owner-scoped, cursor-paginated
   *  (mirrors `GET /v1/me/runs`'s `?cursor=`/`?limit=` precedent). */
  async listDatasets(auctor: AuctorKey, opts: { cursor?: string; limit?: number } = {}): Promise<{ datasets: Dataset[]; nextCursor?: string }> {
    const owner = this._datasetOwner(auctor)
    const { entries, nextCursor } = await this._datasetsStore().list({ owner, ...opts })
    return { datasets: entries, ...(nextCursor ? { nextCursor } : {}) }
  }

  /** List the thin `DatasetSummary[]` projection for the caller — the training-run
   *  picker's consumer. Same store, same owner-scoping, projected down. */
  async listDatasetSummaries(auctor: AuctorKey, opts: { cursor?: string; limit?: number } = {}): Promise<{ datasets: DatasetSummary[]; nextCursor?: string }> {
    const owner = this._datasetOwner(auctor)
    const { entries, nextCursor } = await this._datasetsStore().listSummaries({ owner, ...opts })
    return { datasets: entries, ...(nextCursor ? { nextCursor } : {}) }
  }

  /** Resolve a Dataset the caller owns, or 404 (stranger gets not_found, not forbidden —
   *  mirrors `_ownedTabula`/`_ownedProject`). */
  async getDataset(auctor: AuctorKey, id: string): Promise<Dataset> {
    const owner = this._datasetOwner(auctor)
    const d = await this._datasetsStore().find(id)
    if (!d || d.owner !== owner) throw new ApiError('not_found.dataset', `Dataset '${id}' not found`, 404)
    return d
  }

  /** Create a Dataset from either v1 ingestion path (Q2): `upload` (already-signed R2
   *  media URLs from `POST /storage/uploads/sign`) or `generation` (media resolved from
   *  the caller's own completed Acta). Rejects a body matching neither shape. */
  async createDataset(auctor: AuctorKey, input: CreateDatasetInput): Promise<Dataset> {
    const owner = this._datasetOwner(auctor)
    const store = this._datasetsStore()
    const now = new Date()

    if (!input || (input.source !== 'upload' && input.source !== 'generation')) {
      throw Errors.inputMalformed("source must be 'upload' or 'generation'")
    }
    if (typeof input.name !== 'string' || !input.name.trim()) {
      throw Errors.inputMalformed('name is required')
    }
    const modality = input.modality
    if (!modality || !['image', 'video', 'audio', '3d'].includes(modality)) {
      throw Errors.inputMalformed("modality must be one of 'image' | 'video' | 'audio' | '3d'")
    }

    let media: Dataset['media']
    if (input.source === 'upload') {
      if (!Array.isArray(input.mediaUrls) || input.mediaUrls.length === 0) {
        throw Errors.inputMalformed('mediaUrls is required and must be non-empty for an upload dataset')
      }
      media = input.mediaUrls.map((url) => ({ id: uuidv4(), url, source: 'upload' as const, addedAt: now }))
    } else {
      if (!Array.isArray(input.actumIds) || input.actumIds.length === 0) {
        throw Errors.inputMalformed('actumIds is required and must be non-empty for a generation-seeded dataset')
      }
      const acta = await Promise.all(input.actumIds.map((id) => this.deps.actorum.findById(id)))
      media = []
      for (let i = 0; i < acta.length; i++) {
        const actum = acta[i]
        const actumId = input.actumIds[i]
        if (!actum || !(await this._owns(auctor, actum))) throw Errors.notFoundRun(actumId)
        if (actum.status !== 'completus') throw Errors.inputMalformed(`Actum '${actumId}' has not completed`)
        const urls = this._urlsFromExitus(actum.exitus)
        for (const url of urls) media.push({ id: uuidv4(), url, source: 'generation' as const, actumId, addedAt: now })
      }
      if (media.length === 0) throw Errors.inputMalformed('none of the referenced Acta produced usable media')
    }

    return store.create({
      owner,
      name: input.name,
      modality,
      custody: input.custody ?? 'local',
      media,
      captionsets: [],
      versions: [{ v: '1.0.0', count: media.length, when: now }],
    })
  }

  private _tabulaeStore(): Tabularum {
    const store = this.deps.tabulae
    if (!store) throw Errors.notFoundTabula('tabulae')
    return store
  }

  /** Resolve a Tabula the caller owns, or 404 (stranger gets not_found, not forbidden). */
  private async _ownedTabula(auctor: AuctorKey, id: string): Promise<Tabula> {
    const tabula = await this._tabulaeStore().find(id)
    if (!tabula || ownerKeyOf(tabula.auctor) !== ownerKeyOf(auctor)) throw Errors.notFoundTabula(id)
    return tabula
  }

  /** Bump the patch component of a semver-ish `x.y.z` string. Falls back to '1.0.0' if unparseable. */
  private _bumpVersio(v: string): string {
    const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v)
    if (!m) return '1.0.0'
    return `${m[1]}.${m[2]}.${Number(m[3]) + 1}`
  }

  private _projectStore(): Provinciarum {
    const store = this.deps.provinciarum
    if (!store) throw Errors.notFoundProject('projects')
    return store
  }

  /** Projects are animaId-keyed — anonymous (commitment/bursa) callers cannot own one. */
  private _projectAnimaId(auctor: AuctorKey): string {
    if ('animaId' in auctor) return auctor.animaId
    throw Errors.authForbidden('projects require an identified account')
  }

  /** Resolve a project the caller owns, or 404. */
  private async _ownedProject(auctor: AuctorKey, id: string): Promise<Provincia> {
    const animaId = this._projectAnimaId(auctor)
    const project = await this._projectStore().find(id)
    if (!project || project.animaId !== animaId) throw Errors.notFoundProject(id)
    return project
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
        ...(m.descriptio !== undefined ? { descriptio: m.descriptio } : {}),
        ...(categoria !== undefined ? { categoria } : {}),
        ...(m.genus === 'compositus' ? { steps: m.gradus?.length ?? 0 } : {}),
        modusGenus: resolveCanonVerb(m),
      }
    })
  }

  /** Describe one flow's JSON-Schema input/output. Unknown id → `not_found.flow`. */
  async describeFlow(id: string): Promise<FlowDescription> {
    const m = await this.deps.modorum.find(id)
    if (!m) throw Errors.notFoundFlow(id)
    // Modus carries every field describeFlow reads; the cast supplies the
    // index-signature DescribableModus declares for its passthrough meta.
    const description = describeFlow(m as unknown as DescribableModus)
    // `familia` — read-only, additive: derive the flow's model family from its FULL
    // weight manifest — the linked Fundamentum's base weights UNION the flow's own
    // extra weights (`Modus.intellae`) — mirroring Compiler.ts's `_manifestRefs`
    // union (Compiler.ts:446-453) without touching Compiler.ts or any trigger-
    // resolution logic. Atomic image-gen essentiae (e.g. klein) declare no `intellae`
    // of their own; their family-bearing base weights live entirely on the Fundamentum,
    // so reading `Modus.intellae` alone silently under-reports for most flows. First
    // non-empty distinct `familia` across the unioned weights wins (base-first, same
    // precedence as `_manifestRefs`). No weights, no registry, or no family on any
    // weight → leave `familia` undefined (safe default: no highlight for that flow).
    const fundamentumId = (m as { fundamentumId?: string }).fundamentumId
    const fundamentumVersio = (m as { fundamentumVersio?: string }).fundamentumVersio
    const fundamentum = fundamentumId
      ? await this.deps.fundamentorum.find(fundamentumId, fundamentumVersio).catch(() => null)
      : null
    const ownIntellae = (m as { intellae?: Array<{ id: string; role: string }> }).intellae ?? []
    const intellae = [...(fundamentum?.intellae ?? []), ...ownIntellae]
      .filter((w, i, all) => all.findIndex(o => o.id === w.id) === i)
    if (intellae.length > 0 && this.deps.intellarum) {
      for (const w of intellae) {
        const intella = await this.deps.intellarum.find(w.id).catch(() => null)
        if (intella?.familia) { description.familia = intella.familia; break }
      }
    }
    return description
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
   * Static config for the buy-points/deposit UI: where to send, the canonical points/USD rate,
   * the default funding rate, and the supported chains. No auth, no oracle call.
   */
  depositConfig(): DepositConfig {
    return {
      depositAddress: this.deps.depositAddress ?? '',
      pointsPerUsd: Number(usdMicroToImpetus(1_000_000n)),        // 1 USD (1e6 µUSD) → impetus ≈ 2967
      defaultFundingRatePct: Number(DEFAULT_FUNDING_BPS) / 100,   // 70
      chains: [{ chainId: 1, name: 'ethereum' }, { chainId: 8453, name: 'base' }],
    }
  }

  /**
   * The PUBLIC credit-pack catalog for DISPLAY (pricing page + Funding). Sourced from the single
   * server-authoritative `stripePacks.PACKS` constant — the one source of truth so a pack-number
   * change there updates every surface. Read-only, no auth, no money mutation: `credits = impetus/10`
   * is a display figure; the CHARGED/credited amount stays keyed by `packId` on the server (webhook
   * credits `PACKS[packId].impetus`), never anything derived from this view.
   */
  listPacks(): PackView[] {
    return packViews()
  }

  /**
   * Quote a deposit: how many impetus points `amount` base units of `token` would buy, right now.
   * INFORMATIONAL — the webhook re-prices and credits authoritatively at deposit time. It reuses the
   * exact same pricer + funding + rate as `alchemyWebhook.creditImpetus`, so `pointsQuoted` equals
   * what the webhook credits for the same input (asserted in tests). Gas is NOT deducted (the webhook
   * doesn't either — see creditImpetus doc); a UI may show network fee as a separate informational line.
   */
  async depositQuote(input: { chainId: number | string; token: string; amount: string }): Promise<DepositQuote> {
    const pricer = this.deps.pricer
    if (!pricer) throw Errors.depositUnavailable()

    const token = String(input.token ?? '')
    if (!/^0x[0-9a-fA-F]{40}$/.test(token)) throw Errors.inputMalformed('token must be a 20-byte hex address (0x000…000 for native ETH)')
    let amountRaw: bigint
    try { amountRaw = BigInt(input.amount) } catch { throw Errors.inputMalformed('amount must be an integer string of base units (wei for ETH, token-decimals for ERC-20)') }
    if (amountRaw <= 0n) throw Errors.inputMalformed('amount must be a positive integer of base units')

    const grossMicroUsd = await pricer.usdFmv(input.chainId, token, amountRaw)
    if (grossMicroUsd === null || grossMicroUsd <= 0n) throw Errors.priceUnavailable()

    const bps = fundingBps(token)
    const points = usdMicroToImpetus(applyFundingBps(grossMicroUsd, bps))
    return {
      chainId: input.chainId,
      token,
      amountRaw: amountRaw.toString(),
      grossUsd: microUsdToStr(grossMicroUsd),
      grossUsdMicro: grossMicroUsd.toString(),
      fundingRatePct: Number(bps) / 100,
      pointsQuoted: points.toString(),
      depositAddress: this.deps.depositAddress ?? '',
    }
  }

  /**
   * The caller's OWN on-chain deposits — scoped to their linked (`'web'`-genus, active) wallet
   * addresses. Powers the settle-watch UI (real depositum status instead of hoping the balance
   * moves). Owner-scoped by construction: a stranger's `animaId` resolves a disjoint wallet set,
   * so this NEVER returns another account's rows (spec `docs/handoff/2026-07-10-deposit-attribution-seam.md`
   * §Fix 4). An anon/purse `AuctorKey` ({commitment}/{bursaToken}) has no personae → always [].
   *
   * `Depositorum.list()` has no payer/wallet filter (its interface is out of this item's scope) —
   * so we filter in-process by `ab` (the sending address, lowercased) against the caller's linked
   * set. This ALSO surfaces deposits that predate the wallet link (parked `confirmatum`, never
   * animaId-attributed at receipt time), which a filter on `Depositum.animaId` alone would miss.
   */
  async myDeposits(auctor: AuctorKey): Promise<MyDeposit[]> {
    if (!('animaId' in auctor)) return []
    if (!this.deps.deposita || !this.deps.personae) return []

    const personae = await this.deps.personae.findByAnimaId(auctor.animaId)
    const wallets = new Set(
      personae
        .filter(p => p.genus === 'web' && p.activeAnimaId === auctor.animaId)
        .map(p => normalizeAddress(p.externusId))
        .filter((a): a is string => a !== null),
    )
    if (wallets.size === 0) return []

    const all = await this.deps.deposita.list()
    return all
      .filter(d => wallets.has(d.ab.toLowerCase()))
      .sort((a, b) => b.natum.getTime() - a.natum.getTime())
      .map(d => ({
        id: d.id,
        chainId: d.chainId,
        txHash: d.transactioHash,
        valor: d.valor.toString(),
        status: d.status,
        natum: d.natum.toISOString(),
      }))
  }

  // ── Fiat funding rail (Stripe) ──────────────────────────────────────────────

  private _stripeGateway: StripeGateway | null | undefined

  /** The live Stripe gateway: the injected dep, else built from env, else `null` (unconfigured). */
  private resolveStripeGateway(): StripeGateway | null {
    if (this._stripeGateway === undefined) {
      if (this.deps.stripe) {
        this._stripeGateway = this.deps.stripe
      } else {
        const config = stripeConfigFromEnv()
        this._stripeGateway = config ? makeStripeGateway(config) : null
      }
    }
    return this._stripeGateway
  }

  /**
   * Create a Stripe Checkout Session for a credit pack. IDENTIFIED-ONLY — a fiat pack cannot
   * fund an anonymous purse (a card de-anonymizes by construction). Returns the hosted-checkout
   * URL. The pack's USD price + packId are server-set, so crediting is server-authoritative
   * regardless of anything the client sends (the webhook credits `PACKS[packId].impetus`).
   */
  async createCheckout(
    auctor: AuctorKey,
    opts: { packId: string; successUrl?: string; cancelUrl?: string },
  ): Promise<{ url: string; sessionId: string }> {
    const gateway = this.resolveStripeGateway()
    if (!gateway) throw Errors.paymentsUnavailable()
    const animaId = 'animaId' in auctor ? auctor.animaId : undefined
    const result = await handleStripeCheckout(
      {
        packId: opts.packId,
        animaId,
        ...(opts.successUrl ? { successUrl: opts.successUrl } : {}),
        ...(opts.cancelUrl ? { cancelUrl: opts.cancelUrl } : {}),
      },
      { gateway },
    )
    if (!result.ok) throw new ApiError(result.code, result.message, result.status)
    return { url: result.url, sessionId: result.sessionId }
  }

  /**
   * Handle a Stripe webhook delivery — signature-gated + idempotent per payment. Returns the
   * HTTP status + body for the router. A bad signature or a non-completed/malformed event is a
   * 400 (never a credit); a redelivery of an already-credited payment is a no-op that replays
   * the original outcome. Throws only for a deployment that has no fiat rail configured (503).
   */
  async handleStripeWebhook(input: { rawBody: string; signature?: string }): Promise<StripeWebhookResult> {
    const gateway = this.resolveStripeGateway()
    if (!gateway || !this.deps.redituum || !this.deps.animae) throw Errors.paymentsUnavailable()
    return handleStripeWebhook(
      { rawBody: input.rawBody, ...(input.signature ? { signature: input.signature } : {}) },
      {
        signorum: this.deps.signorum,
        redituum: this.deps.redituum,
        animae: this.deps.animae,
        gateway,
      },
    )
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
   * (resolved to the substrate's base family), `trigger` (a LoRA trigger word), and
   * `q` (free text, matched in-memory against nomen/description). Sourced from the
   * populated `intellarum` registry's `canonical()` set — the public catalog
   * projection (no `access`/`license`/`commercialUse`). Each result is a card so the
   * agent can decide, not just enumerate.
   *
   * `auctor` (optional): when passed, the search base is the UNION of the public
   * `canonical()` set and that caller's own privately-held models (the same owner
   * scoping `listMyModels` uses), deduped by intella id, then filtered by the exact
   * same q/genus/basis/trigger/includeAdult predicate below — so canonical and owned
   * results are matched identically. Omitting `auctor` preserves today's public-only
   * behavior for every existing caller (noema-116).
   */
  async listModels(filter: { genus?: IntelligensGenus; basis?: string; fundamentumId?: string; trigger?: string; q?: string; limit?: number; includeAdult?: boolean; auctor?: AuctorKey } = {}): Promise<ModelCard[]> {
    if (!this.deps.intellarum) return []
    const registry = this.deps.intellarum
    let basis = filter.basis
    if (!basis && filter.fundamentumId) {
      const f = await this.deps.fundamentorum.find(filter.fundamentumId).catch(() => null)
      if (f) {
        for (const w of f.intellae ?? []) {
          const wi = await registry.find(w.id).catch(() => null)
          if (wi?.familia) { basis = wi.familia; break }
        }
      }
    }
    const canonical = await registry.canonical()
    let pool = canonical
    if (filter.auctor) {
      const ownerKey = ownerKeyOf(filter.auctor)
      const owned = registry.listByOwner
        ? await registry.listByOwner(ownerKey)
        : (await registry.list()).filter((i) => i.ownerKey === ownerKey || `anima:${i.ownerAnimaId}` === ownerKey)
      const seen = new Set(pool.map((i) => i.id))
      pool = [...pool, ...owned.filter((i) => !seen.has(i.id))]
    }
    const q = filter.q?.trim()
    // `Intellarum` has no free-text search — filter the pool in-memory for `q`
    // (nomen/description/tags/sample-prompt substring match), same as the old intelligendi
    // store's search() did, widened to also reach style signal carried in tags and samples.
    const base = q
      ? pool.filter((i) =>
          i.nomen.toLowerCase().includes(q.toLowerCase()) ||
          (i.description ?? '').toLowerCase().includes(q.toLowerCase()) ||
          (i.tags ?? []).some((t) => t.tag.toLowerCase().includes(q.toLowerCase())) ||
          (i.samples ?? []).some((s) => (s.prompt ?? '').toLowerCase().includes(q.toLowerCase())),
        )
      : pool
    const trig = filter.trigger?.trim().toLowerCase()
    const hits = base.filter((i) => {
      if (filter.genus && i.genus !== filter.genus) return false
      if (basis && i.familia !== basis) return false
      if (trig) {
        const aliases = (i.trigger ?? '').split(',').map((t) => t.trim().toLowerCase()).filter(Boolean)
        if (!aliases.includes(trig)) return false
      }
      // Adult-content partition (noema-091, on noema-090's `contentRating`). The gated adult set is
      // {suggestive, explicit} (R-and-above, Civitai-analogous) — hidden from the catalog UNLESS the
      // caller has spicyMode on (`includeAdult`, which itself required a recorded 18+ attestation).
      // {untriaged, sfw} (and unrated) are ALWAYS visible, to everyone incl. anon. OFF (the default,
      // `includeAdult` falsy) EXCLUDES the adult set everywhere `listModels` feeds selection — the safe
      // default. Harmless today (0 seeds rated adult); the correct gate for when models get rated.
      if (!filter.includeAdult && i.contentRating !== undefined && ADULT_CONTENT_RATINGS.has(i.contentRating)) return false
      return true
    })
    const limited = filter.limit ? hits.slice(0, filter.limit) : hits
    return limited.map((i) => {
      const { access: _access, license: _license, commercialUse: _commercialUse, ...card } = toModelCardFromIntella(i)
      return card
    })
  }

  /**
   * Import a model/LoRA by URL (Civitai page/`?modelVersionId`, HuggingFace repo, or a
   * direct `.safetensors`/`.ckpt` link) as a PRIVATE, owner-scoped Intella — usable in
   * the importer's flows at once (spec/model-import.md Tier 1). The importer scrapes the
   * origin metadata, CSAM-scans any preview media (fail-closed), mirrors the weights into
   * OUR R2 bucket (auth-free `sources[0]`), and registers `access:'private'`,
   * `canonica:false`, `ownerAnimaId` — so `buildAccessOrClauses` resolves it ONLY for the
   * owner and it never appears on the public catalogue. Appearing publicly is a separate,
   * user-invoked `publish` (an `intella`-kind Editio through `ModerationGate`).
   *
   * Identified callers only — a private model needs a durable owner (`animaId`).
   */
  async importModel(auctor: AuctorKey, opts: ImportModelOpts): Promise<ModelCard> {
    const importer = this.deps.modelImporter
    if (!importer) throw Errors.notFoundModel('import')
    if (typeof opts.url !== 'string' || !opts.url.trim()) throw Errors.inputMalformed('a model URL is required')
    // Anon-capable: a Bursa purse is a valid owner (imports must be Bursa-possible). The generic
    // ownerKey scopes ownership; ownerAnimaId is populated only when the caller is an anima.
    try {
      const intella = await importer.import({
        url: opts.url.trim(),
        ownerKey: ownerKeyOf(auctor),
        ...('animaId' in auctor ? { ownerAnimaId: auctor.animaId } : {}),
        ...(opts.genus ? { genus: opts.genus } : {}),
      })
      return {
        intellaId: intella.id,
        nomen: intella.nomen,
        genus: intella.genus,
        ...(intella.familia ? { basis: intella.familia } : {}),
        ...(intella.trigger ? { trigger: intella.trigger } : {}),
        ...(intella.description ? { description: intella.description } : {}),
      }
    } catch (err) {
      // A gated origin with no connected secret → typed `secret.required` (frontend deep-links to
      // connect it). Checked before the generic branch — SecretRequiredError extends ModelImportError.
      if (err instanceof SecretRequiredError) throw Errors.secretRequired(err.provider, err.message)
      if (err instanceof ModelImportError) throw Errors.inputMalformed(err.message)
      throw err
    }
  }

  /**
   * List the caller's OWN privately-held models — imports + trained LoRAs — newest first. The
   * public `listModels` catalog is `canonica:true` only, so a private import (owner-scoped in the
   * `Intellarum` registry) is otherwise invisible; this is where an importer sees + manages what
   * they brought in. Anon-capable: a Bursa purse owns its imports (keyed by ownerKey).
   */
  async listMyModels(auctor: AuctorKey): Promise<ModelCard[]> {
    if (!this.deps.intellarum) return []
    const registry = this.deps.intellarum
    const ownerKey = ownerKeyOf(auctor)
    const models = registry.listByOwner
      ? await registry.listByOwner(ownerKey)
      : (await registry.list()).filter((i) => i.ownerKey === ownerKey || `anima:${i.ownerAnimaId}` === ownerKey)
    return models.map(toModelCardFromIntella)
  }

  /**
   * ADMIN license backfill/clearance (going-public review). Sets a model's `license` +
   * `commercialUse` so the public-catalog gate treats it correctly — for a legacy/unclassified
   * import, a misclassification, or a model we've cleared by taking out a commercial license.
   * Two modes: an explicit clearance ({ license, commercialUse }) — the operator's decision, e.g.
   * marking an SD3 model `'yes'` once we hold the Stability license — or `reclassify:true`, which
   * re-derives the verdict from the model's recorded base string (`provenance.base`) via the same
   * classifier (bulk-fix models imported before license classification existed). Platform-admin only.
   */
  async setModelLicense(auctor: AuctorKey, id: string, opts: SetModelLicenseOpts): Promise<ModelCard> {
    this._assertPlatformAdmin(auctor)
    const registry = this.deps.intellarum
    if (!registry?.setLicense) throw Errors.notFoundModel(id)
    let { license, commercialUse } = opts
    if (opts.reclassify) {
      const m = await registry.find(id)
      if (!m) throw Errors.notFoundModel(id)
      // Re-derive from the model's recorded base via the shared classifier (provenance.base > nomen
      // > familia) — the SAME path the backfill sweep runs, so admin + sweep never disagree.
      ;({ license, commercialUse } = classifyModelLicense(m))
    }
    if (license === undefined && commercialUse === undefined) {
      throw Errors.inputMalformed('provide license and/or commercialUse, or reclassify:true')
    }
    const updated = await registry.setLicense(id, {
      ...(license !== undefined ? { license } : {}),
      ...(commercialUse !== undefined ? { commercialUse } : {}),
    })
    if (!updated) throw Errors.notFoundModel(id)
    return toModelCardFromIntella(updated)
  }

  /**
   * ADMIN revenue report (platform-admin only) — the conditional-license tripwire, surfaced for the
   * accounting view (ADR-0013 §5, spec step 3). Reads the company-wide trailing-12-month USD revenue
   * rollup `R`, finds the conditional licenses currently reachable in the public catalog + their
   * tightest binding cap (ADR-0012), classifies the LIVE band, and echoes the last edge-triggered
   * band the scheduled evaluator persisted. READ-ONLY: it neither persists a new band nor fires the
   * alert seam — that is `evaluateTripwire`'s job on its cadence. This is the "what's our number"
   * report a human reads, not the safety valve.
   */
  async revenueReport(auctor: AuctorKey, now: Date = new Date()): Promise<RevenueReport> {
    this._assertPlatformAdmin(auctor)
    const redituum = this.deps.redituum
    if (!redituum) throw Errors.reportUnavailable()
    const R = await redituum.trailingUsdRevenue(now)
    const models = this.deps.intellarum ? await this.deps.intellarum.list() : []
    const licenses = activeConditionalLicenses(models)
    const capUsd = bindingCapUsd(licenses)
    const liveBand = band(R, bindingCapMicroUsd(licenses))
    const last = await this.deps.tripwireBand?.last()
    return {
      asOf: now.toISOString(),
      trailingUsdRevenueMicro: R.toString(),
      trailingUsdRevenue: microUsdToStr(R),
      band: liveBand,
      bindingCapUsd: capUsd,
      activeConditionalLicenses: licenses,
      lastAlertedBand: last?.band ?? null,
    }
  }

  /**
   * ADMIN COGS report (platform-admin only) — the read-only pair to `revenueReport`: a
   * trailing-window rollup of per-job `costUsd` off `wide_events` (admin workspace, credits-only
   * scope — no payout/disbursement/tax). Uses the SAME trailing-12mo window as `revenueReport`
   * for a like-for-like pairing. A single scalar + count in v1 — no per-gpuType/per-model split.
   */
  async cogsReport(auctor: AuctorKey, now: Date = new Date()): Promise<CogsReport> {
    this._assertPlatformAdmin(auctor)
    const costReport = this.deps.costReport
    if (!costReport) throw Errors.reportUnavailable()
    const since = new Date(now)
    since.setFullYear(since.getFullYear() - 1)
    const { costUsd, count } = await costReport.sumCostUsd(since)
    return {
      asOf: now.toISOString(),
      sinceIso: since.toISOString(),
      costUsd,
      count,
    }
  }

  /** Platform-admin gate: only the platform identity (PLATFORM_ANIMA_ID) may perform the op. */
  private _assertPlatformAdmin(auctor: AuctorKey): void {
    if (!('animaId' in auctor) || auctor.animaId !== PLATFORM_ANIMA_ID) {
      throw Errors.authForbidden('this operation is restricted to the platform administrator')
    }
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

  // ── Account settings (Consuetudinum, owner-keyed / anon-capable) ─────────────

  /** The caller's owner-keyed account settings — appearance (Profile) + generation
   *  defaults (Preferences) + verb→flow bindings. All optional (unset → undefined). */
  async getMe(auctor: AuctorKey): Promise<MeView> {
    const c = this.deps.consuetudinum
    const secrets = await this.secretPresenceView(auctor)
    // Availability tracks the WRITE seam, not presence — an unconfigured store 500s on connect, so the
    // panel can hide/disable proactively instead of waiting for the first failed PUT (F3).
    const secretsAvailable = !!this.deps.secretWriter
    // Platform-admin flag — the SAME identity check that gates the moderation review actions
    // (`_assertPlatformAdmin`). Surfaced so the web app can reveal the feed-review surface + its
    // approve/reject controls only to the reviewer; it is `true` only on the platform's own session.
    const admin = 'animaId' in auctor && auctor.animaId === PLATFORM_ANIMA_ID
    if (!c) return { bindings: [], secrets, secretsAvailable, admin }
    const [appearance, generatio, bindings] = await Promise.all([
      c.resolveAppearance(auctor), c.resolveGeneratio(auctor), c.listBindings(auctor),
    ])
    return {
      ...(appearance !== undefined ? { appearance } : {}),
      ...(generatio !== undefined ? { generatio } : {}),
      bindings,
      secrets,
      secretsAvailable,
      admin,
    }
  }

  /** Public appearance-by-owner projection — the visual branding (avatar/banner/accent/
   *  look) any embedder may read to theme a widget. Unlike `getMe` this is NOT self-
   *  scoped: it exposes ONLY the `Appearance` (all visual, no secrets/prefs/bindings),
   *  keyed by any owner. Backs the per-agent widget skin (an agent's own `{animaId}`). */
  async publicAppearance(owner: AuctorKey): Promise<Appearance | undefined> {
    return this.deps.consuetudinum?.resolveAppearance(owner)
  }

  /** Per-provider connect state for `getMe`. Uses the `has`-only presence view (no plaintext).
   *  Absent store → every provider 'absent'. */
  private async secretPresenceView(auctor: AuctorKey): Promise<Record<SecretProvider, 'connected' | 'absent'>> {
    const p = this.deps.secretPresence
    const ownerKey = ownerKeyOf(auctor)
    const entries = await Promise.all(
      SECRET_PROVIDERS.map(async provider =>
        [provider, p && (await p.has(ownerKey, provider)) ? 'connected' : 'absent'] as const),
    )
    return Object.fromEntries(entries) as Record<SecretProvider, 'connected' | 'absent'>
  }

  // ── BYO secrets (Secretarium, owner-keyed / anon-capable) ────────────────────

  /**
   * Connect the caller's BYO gated-origin credential for `provider`. The token is sealed at
   * rest at once and NEVER echoed back. `idleDays` (default 90) sets the idle-expiry window.
   * Anon-capable: a Bursa purse is a valid owner (§ownerKeyOf) — but a BYO token is bound to a
   * NAMED third-party account, so a purse caller gets a deanonymization `warning` to render.
   */
  async putSecret(auctor: AuctorKey, provider: string, token: string, idleDays?: number): Promise<SecretView> {
    const w = this.deps.secretWriter
    if (!w) throw Errors.internal('BYO secrets are not available on this deployment')
    if (!isSecretProvider(provider)) throw Errors.inputMalformed(`unknown secret provider '${provider}'`)
    if (typeof token !== 'string' || !token.trim()) throw Errors.inputMalformed('a token is required')
    const days = Number.isFinite(idleDays) && (idleDays as number) > 0 ? Math.floor(idleDays as number) : DEFAULT_SECRET_IDLE_DAYS
    const { expiresAt } = await w.put(ownerKeyOf(auctor), provider, token.trim(), days)
    return {
      provider,
      status: 'connected',
      expiresAt: expiresAt.toISOString(),
      ...('bursaToken' in auctor || 'commitment' in auctor ? { warning: DEANON_WARNING } : {}),
    }
  }

  /** Disconnect the caller's BYO credential for `provider`. Idempotent (absent → still 'absent'). */
  async removeSecret(auctor: AuctorKey, provider: string): Promise<SecretView> {
    const w = this.deps.secretWriter
    if (!w) throw Errors.internal('BYO secrets are not available on this deployment')
    if (!isSecretProvider(provider)) throw Errors.inputMalformed(`unknown secret provider '${provider}'`)
    await w.remove(ownerKeyOf(auctor), provider)
    return { provider, status: 'absent' }
  }

  /** Replace the caller's presentation skin (Profile). */
  async setAppearance(auctor: AuctorKey, appearance: Appearance): Promise<Appearance> {
    if (!this.deps.consuetudinum) throw Errors.internal('account settings not configured')
    await this.deps.consuetudinum.setAppearance(auctor, appearance)
    return appearance
  }

  /** Replace the caller's cross-cutting generation defaults (Preferences).
   *
   *  Spicy gate (noema-091): enabling `spicyMode` requires a one-time 18+ attestation ON FILE for this
   *  identity (anon or named alike) — no attestation ⇒ `spicyMode: true` cannot be persisted. The
   *  attestation is a durable, write-once fact recorded via `recordAttestation` (POST /v1/me/attestation);
   *  because this PUT replaces the whole Generatio, a recorded attestation is PRESERVED across a
   *  Preferences save that omits it, so the gate reads the persisted attestation and a later save can't
   *  silently erase it. */
  async setGeneratio(auctor: AuctorKey, generatio: Generatio): Promise<Generatio> {
    if (!this.deps.consuetudinum) throw Errors.internal('account settings not configured')
    const existing = await this.deps.consuetudinum.resolveGeneratio(auctor)
    const merged: Generatio = { ...generatio }
    // Preserve a durable, previously-recorded 18+ attestation across a wholesale Preferences replace.
    if (merged.ageAttestation === undefined && existing?.ageAttestation) {
      merged.ageAttestation = existing.ageAttestation
    }
    // No attestation on file ⇒ spicyMode cannot be enabled (for anon or named callers alike).
    if (merged.spicyMode === true && !merged.ageAttestation) {
      throw Errors.authForbidden('Enabling spicy mode requires a recorded 18+ age attestation.')
    }
    await this.deps.consuetudinum.setGeneratio(auctor, merged)
    return merged
  }

  /** Record the caller's one-time 18+ self-attestation (noema-091) — a self-declared click-through
   *  fact, NOT KYC/ID verification. Written onto the anon-capable Generatio record keyed by the caller's
   *  AuctorKey (so it works for anon Bursa/commitment and named Anima callers alike), preserving every
   *  other Generatio field. Required on file before `spicyMode` may be enabled (see `setGeneratio`).
   *  Re-attesting simply refreshes the timestamp. */
  async recordAttestation(auctor: AuctorKey): Promise<{ attestedAt: number }> {
    if (!this.deps.consuetudinum) throw Errors.internal('account settings not configured')
    const existing = (await this.deps.consuetudinum.resolveGeneratio(auctor)) ?? {}
    const ageAttestation = { attestedAt: Date.now() }
    await this.deps.consuetudinum.setGeneratio(auctor, { ...existing, ageAttestation })
    return ageAttestation
  }

  /** The caller's per-modus input defaults (affines) for one flow. */
  async getAffines(auctor: AuctorKey, modusId: string): Promise<Record<string, unknown>> {
    return (await this.deps.consuetudinum?.resolveAffines(auctor, modusId)) ?? {}
  }

  /** Replace the caller's per-modus input defaults (affines) for one flow. */
  async setAffines(auctor: AuctorKey, modusId: string, affines: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!this.deps.consuetudinum) throw Errors.internal('account settings not configured')
    if (!(await this.deps.modorum.find(modusId))) throw Errors.notFoundFlow(modusId)
    await this.deps.consuetudinum.setAffines(auctor, modusId, affines)
    return affines
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

    // Dispute freeze (noema-082, freeze-boundary v2): provisioning a studio commits the anima's
    // balance as a compute budget and boots a pod that debits it over time (studioSpendHook mints
    // negative-valor `nexus:studioSpend` signa on the caller). That is a user-initiated credit
    // outflow, so it must be blocked while the anima is frozen by a pending chargeback — otherwise a
    // disputing fraudster drains the disputed balance on GPU compute before the chargeback resolves.
    await this._assertNotDisputeFrozen(auctor)

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

  /**
   * End a lease deliberately — the owner says "I'm done, stop the meter." Owner-scoped
   * + idempotent: wires `Conductor.claudere` (terminate pod, close session/materia/
   * hospitium — already covers cancel-in-flight too). A stranger's DELETE never leaks
   * existence (`not_found.studio`); releasing an already-terminated studio returns the
   * same terminal view, 200 (double-click safe) — `claudere`'s own guard makes this
   * safe to call twice, no second settle path invoked.
   */
  async releaseStudio(auctor: AuctorKey, studioId: string): Promise<StudioView> {
    if (!this.deps.conductor) throw Errors.notFoundStudio(studioId)
    const ok = await this.deps.conductor.claudere(studioId, auctor)
    if (!ok) throw Errors.notFoundStudio(studioId)
    const budget = await this.deps.signorum.sessionBudget(studioId).catch(() => 0n)
    return { studioId, status: 'terminated', budgetImpetus: budget.toString() }
  }

  // ── TEE private compute sessions ─────────────────────────────────────────────

  private readonly teeSessions = new Map<string, TeeSession>()

  async provisionTeeSession(auctor: AuctorKey, opts: ProvisionTeeSessionOpts): Promise<TeeSessionView> {
    if ('bursaToken' in auctor) throw Errors.authForbidden('Bursa tokens cannot provision TEE sessions')

    // Dispute freeze (noema-082, freeze-boundary v2): a TEE session commits the anima's balance as a
    // compute budget and boots a pod that debits it over time (the `tee:spend` path). Same
    // user-initiated outflow as provisionStudio — gate it while frozen so a disputed balance can't be
    // consumed on private-compute GPU time before the chargeback resolves.
    await this._assertNotDisputeFrozen(auctor)

    const balance = await this.deps.signorum.balance(auctor)
    const budget = opts.maxImpetus !== undefined ? BigInt(opts.maxImpetus) : balance
    if (budget <= 0n) throw Errors.insufficientSigna({ available: balance.toString() })

    const sessionId = randomUUID()
    // Per-session secret injected into the pod; the runner echoes it on every callback
    // and spoofed /runner/* posts (which can move real pod billing) are dropped.
    // Local dev (no provisioner) skips it — a manually started runner can't know it.
    const runnerToken = this.deps.teeProvisioner ? randomUUID() : undefined
    this.teeSessions.set(sessionId, {
      sessionId,
      auctor,
      status: 'provisioning',
      phase: 'provisioning',
      gpuClass: opts.gpuClass,
      budgetImpetus: budget,
      wgClientPublicKey: opts.wgClientPublicKey,
      ...(runnerToken ? { runnerToken } : {}),
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
      // handleRunnerReady picks the correct provisioner ingress instead of the localhost fallback.
      this.deps.teeProvisioner.provision(sessionId, opts.wgClientPublicKey, (podId) => {
        const s = this.teeSessions.get(sessionId)
        if (s) s.podId = podId
      }, runnerToken).then(result => {
        const s = this.teeSessions.get(sessionId)
        if (!s) return
        if (s.status === 'ended') {
          // Session ended (user DELETE / watchdog) while the pod was still being created —
          // nothing else will ever terminate the fresh pod.
          console.warn('[tee] session ended during provision — terminating fresh pod', { sessionId, podId: result.podId })
          this.deps.teeProvisioner!.terminate(result.podId).catch(() => {})
          return
        }
        s.podId = result.podId
        if (result.costPerHrUsd !== undefined) s.costPerHrUsd = result.costPerHrUsd
      }).catch(err => {
        const s = this.teeSessions.get(sessionId)
        if (s) { s.status = 'ended'; s.phase = 'failed'; s.error = String(err) }
        console.error('[tee] pod provision failed', { sessionId, err: String(err) })
      })

      // Ready watchdog: the pod can reach 'running' and then die guest-side (IMDS miss,
      // runner crash) without ever calling /runner/ready — no heartbeat means budget
      // enforcement never engages, so the pod would bill forever. If the session is
      // still 'provisioning' at the deadline, fail it and kill the pod. Generous window:
      // covers the CVM multi-minute boot AND up to 3 RunPod WS-probe re-provisions.
      const watchdog = setTimeout(() => {
        const s = this.teeSessions.get(sessionId)
        if (!s || s.status !== 'provisioning') return
        s.status = 'ended'
        s.phase = 'failed'
        s.error = 'runner never became ready — pod terminated'
        console.error('[tee] ready watchdog fired — terminating pod', { sessionId, podId: s.podId })
        if (s.podId) {
          this.deps.teeProvisioner!.terminate(s.podId).catch(err =>
            console.warn('[tee] watchdog pod terminate failed', { sessionId, podId: s.podId, err: String(err) }))
        }
      }, TEE_READY_WATCHDOG_MS)
      watchdog.unref?.()
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

  /**
   * Proxy the pod's token-gated `/debug/wglog` over the platform (avoids CORS; the
   * per-session runner token never reaches the browser). Owner-scoped. Null when the
   * session has no reachable proxy URL yet.
   */
  async fetchTeeWglog(auctor: AuctorKey, sessionId: string, tail?: string): Promise<string | null> {
    const session = this.teeSessions.get(sessionId)
    if (!session || !_auctorMatch(session.auctor, auctor)) throw Errors.notFoundStudio(sessionId)
    if (!session.proxyUrl) return null
    const httpBase = session.proxyUrl
      .replace(/^socks5\+wss:\/\//, 'https://')
      .replace(/^socks5\+ws:\/\//, 'http://')
      .replace(/\?.*$/, '')
      .replace(/\/$/, '')
    const qs = tail ? `?tail=${encodeURIComponent(tail)}` : ''
    const res = await fetch(httpBase + '/debug/wglog' + qs, {
      ...(session.runnerToken ? { headers: { 'Authorization': `Bearer ${session.runnerToken}` } } : {}),
    })
    return res.text()
  }

  /**
   * Callbacks that can move a live pod's billing must carry the per-session token the
   * pod was provisioned with. Sessions without one (local dev) skip the check.
   *
   * Grace + ratchet (deploy-order decoupling): a runner image published before the token
   * existed never echoes it, so a tokenless callback is TOLERATED — the same exposure as
   * before the token shipped (unguessable UUID sessionId) — until the pod proves it knows
   * the token once; from then on the session is strict. A present-but-wrong token is
   * always dropped. Remove the grace path once only token-echoing tee-runner images exist.
   */
  private _runnerTokenOk(session: TeeSession, token: string | undefined, kind: string): boolean {
    if (!session.runnerToken) return true   // local dev — no token was issued
    if (token === session.runnerToken) {
      session.runnerTokenConfirmed = true
      return true
    }
    if (token === undefined && !session.runnerTokenConfirmed) {
      console.warn('[tee] tokenless runner callback tolerated (legacy runner image — rebuild tee-runner to enforce)', { sessionId: session.sessionId, kind })
      return true
    }
    console.warn('[tee] runner callback with bad token — dropped', { sessionId: session.sessionId, kind })
    return false
  }

  async handleRunnerReady(signal: RunnerReadySignal): Promise<void> {
    console.info('[tee] runner ready', { sessionId: signal.sessionId, wgKey: signal.wgPublicKey?.slice(0, 12) })
    if (signal.wgServerLog) console.info('[tee] wg-server.log at ready:\n' + signal.wgServerLog)
    const session = this.teeSessions.get(signal.sessionId)
    if (!session) {
      console.warn('[tee] runner ready: no session found', { sessionId: signal.sessionId })
      return
    }
    if (!this._runnerTokenOk(session, signal.runnerToken, 'ready')) return
    if (session.status === 'ended') {
      // Ready from a pod whose session already ended (user DELETE / watchdog) — don't
      // resurrect the session; make sure the live pod dies.
      console.warn('[tee] ready on an ended session — terminating pod', { sessionId: signal.sessionId, podId: session.podId })
      if (session.podId && this.deps.teeProvisioner) {
        await this.deps.teeProvisioner.terminate(session.podId).catch(() => {})
      }
      return
    }

    session.serverPublicKey = signal.wgPublicKey
    session.tunnelIp = '10.13.0.2'
    // The secure-tunnel handshake is the TEE-only `attesting` phase (spec §6b): WG key
    // exchange just landed; the WS-upgrade probe below completes it. The runner advances
    // the phase from here (loading/warming) once the browser pushes work over the tunnel.
    session.phase = 'attesting'

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
          session.phase = 'failed'
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
        }, session.runnerToken).then(result => {
          const s = this.teeSessions.get(signal.sessionId)
          if (!s) return
          if (s.status === 'ended') {
            console.warn('[tee] session ended during re-provision — terminating fresh pod', { sessionId: signal.sessionId, podId: result.podId })
            this.deps.teeProvisioner!.terminate(result.podId).catch(() => {})
            return
          }
          s.podId = result.podId
          if (result.costPerHrUsd !== undefined) s.costPerHrUsd = result.costPerHrUsd
        }).catch(err => {
          const s = this.teeSessions.get(signal.sessionId)
          if (s) { s.status = 'ended'; s.phase = 'failed'; s.error = String(err) }
        })
        return
      }
    }

    // Browser-facing tunnel ingress is the provisioner's to define (RunPod proxy URL /
    // owned confidential-CVM ingress); null → runner self-reports (community cloud, local dev).
    const ingress = session.podId ? this.deps.teeProvisioner?.ingress(session.podId) ?? null : null
    if (ingress) {
      session.proxyUrl = ingress.proxyUrl
      session.endpoint = ingress.endpoint
    } else {
      const host = signal.endpoint.split(':')[0]
      session.proxyUrl = `socks5+ws://${host}:8080?bind=true&gost=true`
      session.endpoint = signal.endpoint
    }

    session.status = 'ready'
  }

  async handleRunnerHeartbeat(signal: RunnerHeartbeatSignal): Promise<{ continue: boolean }> {
    const session = this.teeSessions.get(signal.sessionId)
    if (!session) return { continue: false }
    if (!this._runnerTokenOk(session, signal.runnerToken, 'heartbeat')) return { continue: false }
    session.gpuHours = signal.gpuHours
    const { continue: ok } = await this._billTeeHours(session, signal.gpuHours)
    if (!ok) {
      session.status = 'ended'
      session.phase = 'failed'
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
    if (!this._runnerTokenOk(session, signal.runnerToken, 'ended')) return
    // A pod we killed for a failed WS probe posts a clean 'ended' on its way down — while
    // its replacement is still provisioning. Marking the session ended here would destroy
    // the transparent retry (seen live 2026-07-03: sessions died at probe attempt 1 on
    // strip-Upgrade hosts). The replacement's ready — or the watchdog — owns the session's
    // fate; ignore the corpse's sign-off.
    if (session.status === 'provisioning' && session.wsProbeAttempts > 0 && signal.status === 'ended') {
      console.info('[tee] ignoring clean ended from a probe-killed pod — re-provision in flight', { sessionId: signal.sessionId })
      return
    }
    console.info('[tee] runner ended', { sessionId: signal.sessionId, status: signal.status, podId: session.podId })
    session.gpuHours = signal.gpuHours
    await this._billTeeHours(session, signal.gpuHours)
    session.status = 'ended'
    // Clean lifespan exit → `done`; budget-kill or crash → `failed` (spec §6b terminal).
    session.phase = signal.status === 'ended' ? 'done' : 'failed'
    if (!session.error) session.error = signal.status === 'terminated' ? 'session budget exhausted' : 'runner exited unexpectedly'
    if (session.podId && this.deps.teeProvisioner) {
      await this.deps.teeProvisioner.terminate(session.podId).catch(err =>
        console.warn('[tee] pod terminate failed on runner ended', { podId: session.podId, err: String(err) })
      )
    }
  }

  /**
   * The universal status sink (spec §4) — `POST /runner/status`. ONE channel every
   * runner speaks: it carries a Progressus AND returns `{continue}` (subsuming the
   * heartbeat). Lenient by contract — `normalizeProgressus` never throws, so an
   * off-cadence base image is never rejected.
   *
   * For a report bound to an `actumId`: append it to the Actum's persisted timeline
   * (coalesced — transitions + messages + terminals only, never per-tick progress),
   * and on a terminal report roll the timeline up into `phaseDurations`. Always emit
   * the typed `actum.progressus` bus event (the single status channel since #6e retired
   * the `actum.stage` shim). A `sessionId`-bound report (no actumId — the
   * arm Actum that owns warm-session cold-start isn't minted yet, spec §9) reflects the
   * latest phase onto the live TEE session (surfaced on `TeeSessionView.phase`) and returns
   * `continue:false` once that session has ended; full timeline persistence lands when the
   * arm Actum exists.
   */
  async reportProgressus(signal: ProgressusSignal): Promise<{ continue: boolean }> {
    const progressus = normalizeProgressus(signal.progressus ?? signal)
    const { actumId, sessionId } = signal

    const actum = actumId ? await this.deps.actorum.findById(actumId) : undefined
    if (!actum) {
      // No Actum to bind to. A `sessionId`-bound report is the TEE warm session (spec §6b):
      // the arm Actum that would own its cold-start isn't minted yet (§9), so we reflect the
      // latest phase as live session status — the browser polls it during the cold-start wait.
      // A `fractus`/ended session tells the runner to bail (replacing the heartbeat's role).
      const session = sessionId ? this.teeSessions.get(sessionId) : undefined
      if (session) {
        if (!this._runnerTokenOk(session, signal.runnerToken, 'status')) return { continue: true }
        session.phase = progressus.phase
        return { continue: session.status !== 'ended' }
      }
      return { continue: true }
    }

    await this._persistAndEmit(actum, progressus)

    // A cancelled/failed Actum tells the runner to bail; otherwise keep going.
    return { continue: actum.status !== 'fractus' }
  }

  /**
   * In-process status recorder (spec §6a) — the seam `comfyrunnerClient` + the cold-start
   * pod clients route their typed `Progressus` through, since they live in the crystal rail
   * (constructed before this API). Persists the timeline (coalesced) + emits the typed
   * `actum.progressus` event. Wired at startup via `registerProgressusRecorder` (index.ts).
   */
  async recordProgressus(actumId: string, progressus: Progressus): Promise<void> {
    const actum = await this.deps.actorum.findById(actumId)
    if (!actum) return
    await this._persistAndEmit(actum, progressus)
  }

  /**
   * Append a Progressus to the Actum's timeline (coalesced — transitions + messages +
   * terminals only, never per-tick progress; §7), roll up `phaseDurations` on a terminal,
   * and emit the typed `actum.progressus` bus event. Shared by the HTTP sink
   * (`reportProgressus`) and the in-process recorder (`recordProgressus`).
   */
  private async _persistAndEmit(actum: Actum, progressus: Progressus): Promise<void> {
    // Read-modify-write of the timeline array — safe because a runner posts SEQUENTIALLY
    // (the base-image contract is "emit, await {continue}"; comfyrunner awaits each record),
    // so reports for one Actum never race. If a runner ever fans out concurrent posts,
    // switch the append to an atomic $push.
    const last = actum.progressus?.at(-1)
    const patch: Partial<Pick<Actum, 'progressus' | 'phaseDurations' | 'resumeCheckpoint'>> = {}
    if (shouldPersist(last, progressus)) {
      const timeline = [...(actum.progressus ?? []), progressus]
      patch.progressus = timeline
      if (progressus.phase === 'done' || progressus.phase === 'failed') {
        patch.phaseDurations = rollupPhaseDurations(timeline)
      }
    }
    // The rescued-checkpoint anchor is captured ALWAYS — even when the report itself is a
    // per-tick `executing` the timeline coalesces away — so the resume anchor survives a hard kill.
    if (progressus.checkpoint?.url) patch.resumeCheckpoint = progressus.checkpoint
    if (Object.keys(patch).length > 0) await this.deps.actorum.update(actum.id, patch)
    bus.emit('actum.progressus', { actumId: actum.id, progressus })
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

/** The caller's owner-keyed account settings (GET /v1/me) — appearance + generation
 *  defaults + verb→flow bindings. All optional; anon-capable. */
/** Static config for the buy-points/deposit UI (`GET /v1/deposit/config`). */
export interface DepositConfig {
  /** The CreditVault address to send deposits to (same on mainnet + Base). */
  depositAddress: string
  /** Canonical impetus points per 1 USD (≈ 2967 at $0.000337/point) — informational. */
  pointsPerUsd: number
  /** Default funding rate as a percent (70 = 70% of USD value converts to points). */
  defaultFundingRatePct: number
  chains: Array<{ chainId: number; name: string }>
}

/** A deposit quote (`POST /v1/deposit/quote`) — informational; the webhook credit is authoritative. */
export interface DepositQuote {
  chainId: number | string
  token: string
  /** Echoed raw base units (wei / token-decimals) that were quoted. */
  amountRaw: string
  /** Gross USD FMV, formatted (e.g. "3.000000") — what we recognize as revenue. */
  grossUsd: string
  /** Exact gross USD FMV in micro-USD (bigint string) — for precise client math. */
  grossUsdMicro: string
  /** The per-asset funding rate applied, as a percent (e.g. 70). */
  fundingRatePct: number
  /** Impetus points the user would be credited — EQUALS what the webhook credits for this input. */
  pointsQuoted: string
  depositAddress: string
}

/** One of the caller's own deposits (`GET /v1/deposit/mine`) — owner-scoped, real status. */
export interface MyDeposit {
  id: string
  chainId: number | string
  /** On-chain transaction hash. */
  txHash: string
  /** Amount in base units (wei for ETH, token-decimals for ERC-20), as a string. */
  valor: string
  /** `detectum` (seen, not yet confirmed) · `confirmatum` (confirmed, awaiting/parked credit) ·
   *  `processatum` (credited — a Signum was issued) · `fractum` (processing failed). */
  status: DepositumStatus
  /** ISO timestamp the deposit was first detected. */
  natum: string
}

/**
 * Admin revenue report (`GET /v1/admin/revenue`) — the conditional-license tripwire, surfaced. The
 * company-wide trailing-12-month USD revenue vs the tightest active conditional cap (ADR-0012/0013 §5).
 */
export interface RevenueReport {
  /** ISO timestamp the trailing window was computed against. */
  asOf: string
  /** Trailing-12mo USD revenue in micro-USD (bigint string) — exact, for client math. */
  trailingUsdRevenueMicro: string
  /** Trailing-12mo USD revenue, formatted (e.g. "12345.670000"). */
  trailingUsdRevenue: string
  /** LIVE band of revenue against the binding cap: clear <75% · watch ≥75% · warn ≥90% · breach ≥100%. */
  band: ThresholdBand
  /** The tightest active conditional cap in whole USD, or null when dormant (no conditional model catalog-active). */
  bindingCapUsd: number | null
  /** The distinct conditional license ids currently reachable in the public catalog. */
  activeConditionalLicenses: string[]
  /** The last band the scheduled evaluator alerted/persisted, or null before its first run. */
  lastAlertedBand: ThresholdBand | null
}

/**
 * Admin COGS report (`GET /v1/admin/cogs`) — the read-only pair to `RevenueReport`: a
 * trailing-window rollup of per-job `costUsd` off `wide_events`. Single scalar + count in v1.
 */
export interface CogsReport {
  /** ISO timestamp the trailing window was computed against. */
  asOf: string
  /** ISO timestamp the trailing window's cutoff (same window `revenueReport` uses). */
  sinceIso: string
  /** Trailing-window COGS, whole USD (pod compute spend, per-job `costUsd` summed). */
  costUsd: number
  /** Job count in the trailing window (includes jobs with no cost telemetry, counted at 0). */
  count: number
}

export interface MeView {
  appearance?: Appearance
  generatio?: Generatio
  bindings: Array<{ verb: string; modusId: string }>
  /** BYO gated-origin credential connect state, per provider. */
  secrets: Record<SecretProvider, 'connected' | 'absent'>
  /** Whether this deployment can store BYO secrets at all (a secret store is wired). `false` →
   *  `SECRETA_MASTER_KEY` is unset and `PUT/DELETE /v1/me/secrets` will 500; the UI hides/disables
   *  the panel proactively rather than only learning on a failed connect. Distinct from every
   *  provider being `absent` (which just means "wired but nothing connected"). */
  secretsAvailable: boolean
  /** Whether this caller is the platform administrator (the moderation reviewer). Gates the
   *  web app's feed-review surface + its approve/reject/confirm-csam controls. Server-authoritative
   *  — the same check `_assertPlatformAdmin` enforces, so the UI never diverges from what the API
   *  will permit. `true` only on the platform's own session; every normal account sees `false`. */
  admin: boolean
}

/** Result of connecting/disconnecting a BYO secret (`PUT/DELETE /v1/me/secrets/:provider`).
 *  The token is NEVER included. */
export interface SecretView {
  provider: SecretProvider
  status: 'connected' | 'absent'
  /** Idle-expiry deadline (ISO) — present when connected. */
  expiresAt?: string
  /** Deanonymization caution shown to anonymous (purse/commitment) callers. */
  warning?: string
}

/** Shown to an anonymous caller connecting a BYO token — linking a named third-party account
 *  to an anonymous purse is a self-inflicted correlation. Their choice; we surface it. */
const DEANON_WARNING =
  'Connecting a Civitai/HuggingFace token links your account there to this anonymous session on ' +
  'our backend. This weakens your anonymity. Use a token scoped to only what you need, and rotate it regularly.'

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

/** Build a Provincia `ornatus` (glyph/color) from create/patch input, over an existing one.
 *  Returns undefined when nothing is set (so an empty object is never persisted). */
function ornatusOf(
  input: { glyph?: string; color?: string },
  base?: { glyph?: string; color?: string },
): { glyph?: string; color?: string } | undefined {
  const glyph = input.glyph ?? base?.glyph
  const color = input.color ?? base?.color
  if (glyph === undefined && color === undefined) return undefined
  return { ...(glyph !== undefined ? { glyph } : {}), ...(color !== undefined ? { color } : {}) }
}

/** Which flat holding list each asset kind writes to. */
const HOLDING_FIELD: Record<ProvinciaResKind, 'datasetIds' | 'modelIds' | 'collectionIds'> = {
  dataset: 'datasetIds',
  model: 'modelIds',
  collection: 'collectionIds',
}

/** Narrow an untrusted `kind` string to a ProvinciaResKind, or 400. */
function resKind(kind: string): ProvinciaResKind {
  if (kind === 'dataset' || kind === 'model' || kind === 'collection') return kind
  throw Errors.inputMalformed(`unknown holding kind '${kind}' (expected dataset|model|collection)`)
}

/** micro-USD (bigint) → a fixed "D.dddddd" USD string (6 dp), exact, no float. */
function microUsdToStr(micro: bigint): string {
  const whole = micro / 1_000_000n
  const frac = (micro % 1_000_000n).toString().padStart(6, '0')
  return `${whole}.${frac}`
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
  /** Resolvability of an owner's own model — 'private' (owner-only) | 'public' (on the catalog).
   *  Present on the owner-scoped `listMyModels`; absent on the public catalog projection. */
  access?: 'public' | 'private'
  /** License id (e.g. 'apache-2.0', 'flux-1-dev-nc'). Owner/admin views. */
  license?: string
  /** Commercial-catalog verdict — whether this model may be promoted publicly. Owner/admin views. */
  commercialUse?: 'yes' | 'no' | 'conditional' | 'unknown'
  /** Adult-content classification (spec: docs/spec/intella-schema.md §9). Catalog-visible —
   *  NOT stripped from the public projection (unlike `access`/`license`/`commercialUse`). */
  contentRating?: IntellaContentRating
  /** The ComfyUI LoRA filename token for explicit `<lora:slug:weight>` syntax (LoRA only). */
  slug?: string
  /** Recommended application weight when the caller does not specify one (LoRA only). */
  defaultWeight?: number
  /** Preview samples: image URL + the prompt it was rendered from. */
  samples?: Array<{ url: string; prompt?: string }>
  /** Discovery/classification tags. */
  tags?: Array<{ tag: string; source?: string }>
}

/** Project an `Intella` (the load/resolve registry record) to a `ModelCard` — the owner-scoped
 *  `listMyModels` view. `basis` = the compat `familia`; `access` surfaces public/private status. */
function toModelCardFromIntella(i: Intella): ModelCard {
  return {
    intellaId: i.id,
    nomen: i.nomen || i.id,
    genus: i.genus,
    ...(i.familia ? { basis: i.familia } : {}),
    ...(i.trigger ? { trigger: i.trigger } : {}),
    ...(i.description ? { description: i.description } : {}),
    access: i.access ?? (i.canonica ? 'public' : 'private'),
    ...(i.license ? { license: i.license } : {}),
    ...(i.commercialUse ? { commercialUse: i.commercialUse } : {}),
    ...(i.contentRating ? { contentRating: i.contentRating } : {}),
    ...(i.slug ? { slug: i.slug } : {}),
    ...(i.defaultWeight !== undefined ? { defaultWeight: i.defaultWeight } : {}),
    ...(i.samples?.length ? { samples: i.samples } : {}),
    ...(i.tags?.length ? { tags: i.tags } : {}),
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
  /**
   * The latest fine-grained `Phasis` (spec §6b) — `provisioning` → `attesting` (tunnel
   * handshake) → the runner's own `pulling`/`downloading`/`loading`/`warming` → `done`/
   * `failed`. The coarse `status` gates the tunnel UI; `phase` is the live cold-start
   * progress the browser shows while polling. This is the latest report, NOT a persisted
   * timeline — the warm session has no Actum yet (spec §9), so there's nothing to roll up.
   */
  phase?: Phasis
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
  /** Per-session secret injected at provision — required when the session has one. */
  runnerToken?: string
}

export interface RunnerHeartbeatSignal {
  sessionId: string
  gpuHours: number
  status: string
  runnerToken?: string
}

export interface RunnerEndedSignal {
  sessionId: string
  gpuHours: number
  status: string
  runnerToken?: string
}

/**
 * The `POST /runner/status` envelope (spec §4). `v` is the schema version (lenient —
 * tolerated, not enforced). `actumId` binds the report to a run's timeline;
 * `sessionId` is the warm-session form (persistence deferred to the arm Actum, §9).
 * `progressus` is the raw report — `reportProgressus` normalizes it (and tolerates a
 * legacy flat `{ step }` body where the whole signal IS the report).
 */
export interface ProgressusSignal {
  v?: number
  actumId?: string
  sessionId?: string
  progressus?: unknown
  /** Legacy TEE stub field — `{ sessionId, step }` — folded in by normalizeProgressus. */
  step?: string
  /** Per-session secret — enforced on the sessionId-bound (TEE) branch only. */
  runnerToken?: string
}

interface TeeSession {
  sessionId: string
  auctor: AuctorKey
  status: 'provisioning' | 'ready' | 'ended'
  /** Latest fine-grained phase (spec §6b) — live cold-start progress, not a persisted timeline. */
  phase?: Phasis
  error?: string
  gpuClass?: string
  budgetImpetus: bigint
  wgClientPublicKey: string
  /** Per-session secret the pod echoes on callbacks. NEVER surfaced on TeeSessionView. */
  runnerToken?: string
  /** Set once the pod echoed the right token — ratchets the session to strict enforcement. */
  runnerTokenConfirmed?: boolean
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
    ...(s.phase ? { phase: s.phase } : {}),
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
