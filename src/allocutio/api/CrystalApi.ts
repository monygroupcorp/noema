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

import type { Phasis } from '../../types/progressus.js'
import type { Modorum } from '../../types/modus.js'
import type { Cursorum, ActumCompletor, Actorum } from '../../types/cursus.js'
import type { ActumInceptor } from '../../execution/ActumInceptor.js'
import type { ActumIndexStore } from '../../types/actumIndex.js'
import type { Consuetudinum, Appearance, Generatio } from '../../types/consuetudo.js'
import type { Signorum } from '../../types/significandi.js'
import type { Fundamentorum } from '../../types/fundamentum.js'
import type { Intellarum, IntellaContentRating } from '../../types/intelligendi.js'
import type { HospitiumStore } from '../../types/hospitium.js'
import type { MateriaStore } from '../../types/materia.js'
import type { Conductor } from '../../crystal/Conductor.js'
import type { TeePodProvisioner } from '../../crystal/TeePodProvisioner.js'
import type { MeEraser } from '../../crystal/MeEraser.js'
import type { ComputeStrategy, GpuClass, ModelRef } from '../../types/actum.js'
import type { Inceptio } from '../../types/cursus.js'
import type { Mandatorum } from '../../types/mandatum.js'
import type { ModoStore } from '../../types/modo.js'
import type { PromptMode } from '../../crystal/deriveSavedModus.js'
import type { DispatchDeps } from '../../execution/dispatchInceptio.js'
import type { CanonVerb } from '../../crystal/verbResolver.js'
import type { AssetPricer } from '../../crystal/AssetPricer.js'
import type { Collectionum, Tractus } from '../../types/collectio.js'
import type { Datasets } from '../../types/dataset.js'
import type { Corporum } from '../../types/corpus.js'
import type { FloorEntry, MuseSessions } from '../../types/museSession.js'
import type { Fragment } from '../../crystal/muse/taxonomy.js'
import type { KeptRoll, MuseSetup, Piece } from '../../crystal/muse/session.js'
import type { SteerProposal } from '../../crystal/muse/steer.js'
import type { Vestigiorum } from '../../types/vestigium.js'
import type { Editionum, ArtifactKind, EditioVisibility, EditioCustody } from '../../types/editio.js'
import type { Sodalitatum } from '../../types/sodalitas.js'
import type { Provinciarum } from '../../types/provincia.js'
import type { AnimaStore } from '../../types/anima.js'
import type { PublicationAdapter } from '../../crystal/PublicationAdapter.js'
import type { ModerationGate } from '../../crystal/ModerationGate.js'
import type { VerdictCache } from '../../crystal/VerdictCache.js'
import type { ScanFeeCharger } from '../../crystal/ScanFeeCharger.js'
import type { CsamReviewReporter } from '../../crystal/CsamReviewReporter.js'
import type { PromptGuard } from '../../crystal/PromptGuard.js'
import type { ModelImporter } from '../../crystal/ModelImporter.js'
import type { SecretWriter, SecretPresence, SecretProvider } from '../../types/secretum.js'
import type { CommercialVerdict } from '../../crystal/modelLicense.js'
import type { ThresholdBand, TripwireBandStore } from '../../crystal/licenseTripwire.js'
import type { Redituum } from '../../types/reditus.js'
import type { StripeGateway } from '../../api/webhooks/stripeWebhook.js'
import type { WideEventStore } from '../../analytics/WideEventStore.js'
import type { CollectioCursor } from '../../crystal/CollectioCursor.js'
import type { Tabularum } from '../../types/tabula.js'
import type { QuerelaStore } from '../../types/Querela.js'
import type { Depositorum, DepositumStatus } from '../../types/catena.js'
import type { PersonaStore } from '../../types/persona.js'
import { CrystalApiMuse } from './crystalApi/muse.js'

export { activityKindFor, activityDoorFor, normalizeCatalogSort, sortCatalog, applyAccountDefaults, dedupeByUrl } from './crystalApi/support.js'

/** Options for the owner's settled spend-history listing (`listRuns`). */
export interface ListRunsOpts {
  /** Opaque page cursor from a prior page; omit for the first page. */
  cursor?: string
  /** Page size (clamped 1..100; default 20). */
  limit?: number
}

/** Options for the owner's earnings read (`listEarnings`). Mirrors `ListRunsOpts`. */
export interface ListEarningsOpts {
  /** Opaque page cursor from a prior page; omit for the first page. */
  cursor?: string
  /** Page size (clamped 1..100; default 20). */
  limit?: number
}

/** Options for the owner's activity read (`listActivity`). Mirrors `ListRunsOpts`. */
export interface ListActivityOpts {
  /** Opaque page cursor from a prior page; omit for the first page. */
  cursor?: string
  /** Page size (clamped 1..100; default 20). */
  limit?: number
}

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
  /** Standing-order store (Mandatorum). Present → a training run opens an order the user
   *  can point at, cancel, and be retried under (noema-310). Absent → no orders are opened
   *  and every run behaves exactly as it did before. */
  mandata?: Mandatorum
  /** Optional per-AuctorKey aggregation index (passed through to dispatchInceptio). */
  actumIndex?: ActumIndexStore
  /** Report store — read here only for the strike count behind a licence-terms suspension
   *  (`Modus.useTerms`). Absent → no caller is treated as suspended, and the acceptance check
   *  still runs. */
  querelae?: Pick<QuerelaStore, 'countViolations'>
  /** Session store — keys studios by their bound Modo id (the canonical studio handle)
   *  in `status`, so `/v1/me/status` and `/v1/studios` agree on `studioId` (ADR-0006). */
  modos?: ModoStore
  /** Optional owner-keyed verb→flow rebinds; falls through to CANON_VERBS when absent. */
  consuetudinum?: Consuetudinum
  /**
   * Private generation (noema-347) — the dedicated private-outputs store. Its presence is what
   * makes the `privateOutputs` preference settable at all: with no such bucket the toggle would
   * be a promise the deployment cannot keep, so the write is refused rather than silently
   * downgraded to the public bucket. It also presigns a marker back into a short-lived link on
   * an owner-scoped run read.
   */
  privateOutputs?: {
    store: { getSignedDownloadUrl(key: string, opts?: { expiresIn?: number }): Promise<string> }
    /** TTL (seconds) for a presigned read link. Default 900 (15 min). */
    presignTtlSeconds?: number
  }
  /**
   * Copying a private output OUT of the private bucket, for a publication (noema-347 phase 2).
   * `fetch` reads the bytes a `noema-private://` marker names; `store` is the PUBLIC outputs
   * bucket the copy is written to - a separate bucket, never a view of the private one.
   *
   * Absent, publishing a private output is REFUSED rather than re-hosted, exactly as it was in
   * phase 1: a deployment that cannot copy the bytes out must not pretend it published them.
   */
  publicationCopyOut?: {
    fetch(ref: string): Promise<Buffer>
    store: {
      put(key: string, bytes: Buffer, contentType: string): Promise<string>
      del(key: string): Promise<void>
    }
  }
  /** Compositus engine (ADR-0008) — lets `invokeFlow` dispatch a compositus (spell)
   *  modus, not just atomics. Absent → compositus modi throw at dispatch. */
  compositusCursor?: DispatchDeps['compositusCursor']
  /** The warm-pod line (`Vocator`). Present → a run that finds the economy pool empty
   *  waits in line instead of being refused, and both run reads report its place.
   *  Absent → an empty pool settles the run, as it did before the line existed. */
  vocator?: DispatchDeps['queue']
  /** Collection store + fan-out cursor — back `collect`/`getCollection`/review.
   *  Absent → collection ops unavailable. */
  collectiones?: Collectionum
  collectioCursor?: Pick<CollectioCursor, 'start' | 'extend' | 'approveActum' | 'rejectAndRevive' | 'pause' | 'resume' | 'cancelInFlight'>
  /** Dataset store — backs `listDatasets`/`listDatasetSummaries`/`getDataset`/`createDataset`,
   *  and resolves a run's declared dataset references for the calling anima.
   *  Absent → dataset ops unavailable, and a declared dataset reference is refused. */
  datasets?: Datasets
  /** Corpus store — resolves a run's declared corpus references (the training modus's dataset
   *  port) for the calling anima. Absent → a declared corpus reference is refused; an inline
   *  manifest, which names no stored record, is unaffected. */
  corpora?: Corporum
  /** Muse session store — backs the session spawn/read/steer/record surface.
   *  Absent → Muse session ops unavailable. */
  museSessions?: MuseSessions
  /** Trace store — resolves the calling identity's own embedding backlog for the embed
   *  sweep, which travels as values because an Actum is identity-blind (see
   *  `_stampEmbedSweep`). Absent → the sweep is refused rather than run unscoped. */
  vestigiorum?: Pick<Vestigiorum, 'backlog' | 'backlogCount'>
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

/** One item of a held editio's preview media — a sample url plus its prompt when known. */
export interface EditionPreviewItem {
  url: string
  prompt?: string
}

/** What `previewHeldEdition` returns — the same view the moderation gate resolved to make
 *  its hold decision, so a reviewer sees exactly what the gate saw. `items` is populated only
 *  when the artifact's output carries per-item metadata worth showing (e.g. an intella's
 *  sample prompts); `mediaUrls` alone is always present, even when `items` isn't. */
export interface EditionPreview {
  mediaUrls: string[]
  items?: EditionPreviewItem[]
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
  /**
   * A per-run spend ceiling carried by the CREDENTIAL the request authenticated with — an API
   * key minted with `maxImpetusPerRun` — rather than asked for by the request.
   *
   * It binds as a FLOOR under `maxImpetus`: admission uses the MINIMUM of the two, so a caller
   * can tighten its own run below the key's ceiling but can never raise it by sending a larger
   * `maxImpetus`. That only holds because routers set this from the RESOLVED IDENTITY and never
   * from a request body — the field is not part of the run-submit payload, and adding it there
   * would hand the bearer the pen on their own limit.
   *
   * Absent for every credential that carries no ceiling, which is the shape every caller had
   * before this existed: admission then behaves exactly as it always has.
   */
  keyMaxImpetusPerRun?: bigint
  /** Target an existing warm studio (a Modo session) instead of cold-provisioning a pod. */
  studioId?: string
  /**
   * Override the `by` field on the Inceptio — used for anonymous paths (bursaToken,
   * arcanumProof) that bypass AuctorKey identity entirely.
   */
  by?: Inceptio['by']
  /**
   * Set when this invocation IS an attempt on an existing standing order (a Mandatum
   * firing). Suppresses opening a second order for the same request — the order that
   * fired is the one that records the attempt.
   */
  mandatumId?: string
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

/** Orderings the public model catalog accepts. `newest` is the default and the shape the store
 *  already returns (`natum` descending); anything unrecognised falls back to it — browse surfaces
 *  degrade, they do not error. */
export type CatalogSort = 'newest' | 'name' | 'genus'

/**
 * The facade itself. Its methods are declared across the layer classes in `./crystalApi/`,
 * each of which extends the one below it, so a layer reaches only helpers declared beneath it:
 *
 *   CrystalApiCore         ./crystalApi/core.ts
 *   CrystalApiRuns         ./crystalApi/runs.ts
 *   CrystalApiWorkspace    ./crystalApi/workspace.ts
 *   CrystalApiCollections  ./crystalApi/collections.ts
 *   CrystalApiDatasets     ./crystalApi/datasets.ts
 *   CrystalApiEditions     ./crystalApi/editions.ts
 *   CrystalApiAccount      ./crystalApi/account.ts
 *   CrystalApiCompute      ./crystalApi/compute.ts
 *   CrystalApiMuse         ./crystalApi/muse.ts
 */
export class CrystalApi extends CrystalApiMuse {}

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
/**
 * The wire projection of a stored Muse session.
 *
 * The floor is an ENTRY ARRAY, not the domain `SteerState` Map: a Map serialises
 * to `{}` through JSON, so the sampler's own type cannot be the wire type.
 */
export interface MuseSessionView {
  id: string
  owner: string
  /** The dataset this session broke off from. Never written to by the session. */
  motherDatasetId: string
  /** The session's own dataset, holding the pieces saved out of it. Absent until the first save. */
  sessionDatasetId?: string
  /** Every fragment on the floor, in display order. Session-owned copies. */
  fragments: Fragment[]
  /** Per-fragment floor state, keyed by fragment identity. */
  floor: FloorEntry[]
  /** Every piece the session recorded, with the lineage that produced it. */
  pieces: Piece[]
  /**
   * What the session fires its draw through: the flow, the run shape, the model stack
   * and the standing affix. Absent until a setup is committed. It never carries the
   * infinite-mode acknowledgement — that is consent for one sitting and the shape has
   * no field for it.
   */
  setup?: MuseSetup
  /**
   * The rolls the user kept, in the order they kept them. Always present — a session
   * that has kept none projects an empty list, so a client never has to tell an absent
   * field from an empty one.
   */
  keptRolls: KeptRoll[]
  natum: Date
  mutatum: Date
}

/**
 * The wire projection of one steer — a proposal, and only a proposal.
 *
 * Nothing on this shape has been applied to anything. It is the consent sheet's
 * source: each elimination and each addition is a pill the user may veto, and the
 * floor moves only through the floor routes once they confirm. It is not stored
 * anywhere — a proposal lives for the length of the sheet.
 */
export interface SteerProposalView {
  proposal: SteerProposal
}

export interface StatusView {
  balanceImpetus: string
  balanceUsd: number
  /** Impetus currently locked against the caller's own in-flight runs. See `StatusSnapshot.heldImpetus`. */
  heldImpetus: string
  heldUsd: number
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
  /** The caller's anima id — present for any identified caller (password, wallet, telegram,
   *  federated). Absent for an anonymous/purse caller (`{ commitment }` or `{ bursaToken }`). */
  animaId?: string
  /** The caller's fiat username, when they authenticated with a `'password'` persona. Resolved
   *  through the same persona lookup `POST /v1/auth/register` writes it to — never a second path
   *  that could disagree. Absent for a wallet-only, telegram-only, or anonymous/purse caller; a
   *  missing username is not an error. */
  username?: string
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
  /** Spendable impetus balance, serialised as a string — read from the same source
   *  `GET /v1/me/status` reports, so the two endpoints can never disagree. */
  balanceImpetus: string
  /** USD-equivalent balance (informational). Same source as `GET /v1/me/status`. */
  balanceUsd: number
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
