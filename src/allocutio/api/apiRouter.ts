// =============================================================================
// apiRouter — the Express `/v1` HTTP surface over the crystal API facade.
// =============================================================================
//
// A thin, framework-bound shell. All substance — flow resolution, dispatch, run
// projection — lives in the already-built `CrystalApi` facade and the
// `IdentityResolver`. This file only: (1) maps HTTP request → credentials →
// `AuctorKey`, (2) calls the facade, (3) projects thrown `ApiError`s onto the
// wire (`status + { error }`). Structural `ApiFacade` / `Identity` interfaces
// keep it injectable so tests pass plain fakes (no real ring needed).
//
// Paths here are RELATIVE — the caller mounts this router at `/v1`.
// =============================================================================

import { createHmac, randomUUID } from 'node:crypto'

import express, { type Request, type Response, type Router } from 'express'

import type { Run, RunOrder, Collection, Team, Edition, EditionModerationDetail, FeedItem, Project, RunsPage, ActivityPage } from './types.js'
import type { AuctorKey } from '../../flow/types.js'
import type { FeedFilter } from '../../types/editio.js'
import type { InvokeTarget, InvokeOpts, ModelCard, SaveFlowOpts, StatusView, ProvisionStudioOpts, StudioView, ProvisionTeeSessionOpts, TeeSessionView, CollectOpts, PublishOpts, DepositConfig, DepositQuote, MyDeposit } from './CrystalApi.js'
import type { RarityReport } from '../../crystal/rarityReport.js'
import type { PackView } from '../../ledger/stripePacks.js'
import { ApiError, Errors } from './errors.js'
import { makeLogger } from '../../lib/logger.js'
import { credentialsFromHeaders, type Credentials, type ResolvedCaller } from './IdentityResolver.js'
import { API_CONTRACT } from './apiContract.js'
import { generateOpenApi } from './docgen.js'
import type { RunEventHub } from './RunEventHub.js'
import type { MeExporter } from '../../crystal/MeExporter.js'
import type { Tabula } from '../../types/tabula.js'
import type { Bursarum } from '../../types/bursa.js'
import type { PartnerStore } from '../../types/partner.js'
import { rotatePartnerApiKey, type MintPartnerApiKeyDeps } from '../../crystal/apiKeys.js'

const log = makeLogger('api:router')

// -----------------------------------------------------------------------------
// Error-seam observability (noema-163)
// -----------------------------------------------------------------------------
// Failures on this surface are logged; successes are not. The field set is
// deliberately minimal — "only as much as we need to log":
//
//   method · route TEMPLATE · status · error code · durationMs · requestId · callerHash?
//
// and, on 5xx only, the error message. Never emitted here: the populated path,
// request/response bodies, query-string values, `err.opts.details` (caller-shaped,
// can echo input), tokens of any kind, or a raw `animaId`.
//
// This is failure-only by design: there is no request log and no always-on line
// for a successful request, so the seam does not create a standing store.

/** Request-local state stamped by `auth()` and read by `wrap()`. */
interface SeamRequest extends Request {
  /** Keyed, truncated digest of the caller's `animaId`. Absent for anonymous/purse callers. */
  __callerHash?: string
  /** How the caller authenticated. Request-local only — not emitted on a log line. */
  __callerKind?: 'purse'
}

/**
 * HMAC-SHA256 (hex, truncated to 12 chars) of an `animaId`, keyed by `INTERNAL_SECRET`,
 * so a stdout log line cannot be reversed to an id by anyone who merely knows the id space.
 * Twelve chars is enough to correlate "the same caller hit this five times" and not enough
 * to serve as a durable identifier.
 *
 * Rotating `INTERNAL_SECRET` breaks correlation across the rotation. That is intended.
 *
 * Key absent (dev/test) -> `undefined`, and the field is omitted from the log line. There is
 * deliberately no fallback to a raw id or to an unkeyed digest.
 */
function hashCaller(animaId: string): string | undefined {
  const key = process.env.INTERNAL_SECRET
  if (!key) return undefined
  return createHmac('sha256', key).update(animaId).digest('hex').slice(0, 12)
}

/**
 * The mounted ROUTE TEMPLATE for the layer being dispatched — `/v1/runs/:id`, never
 * `/v1/runs/<a real run id>`. `req.baseUrl` is the mount point (`/v1`, and `/api/v1` for the
 * compat surface), so this stays correct without hardcoding either prefix.
 *
 * When Express has not set `req.route` (no matched route layer) the literal `'unknown'` is
 * emitted. It never falls back to `req.path`/`req.originalUrl`: those carry the populated
 * path, which is user data.
 */
function routeTemplate(req: Request): string {
  const path = (req.route as { path?: string } | undefined)?.path ?? ''
  return `${req.baseUrl}${typeof path === 'string' ? path : ''}` || 'unknown'
}

/** The slice of CrystalApi this router needs. Mirrors its method signatures. */
export interface ApiFacade {
  invokeFlow(
    auctor: AuctorKey,
    target: InvokeTarget,
    aditus: Record<string, unknown>,
    opts?: InvokeOpts,
  ): Promise<Run>
  getRun(auctor: AuctorKey, id: string): Promise<Run>
  /** Stop an in-flight run and settle it. Owner-scoped, idempotent; returns the terminal run. */
  cancelRun(auctor: AuctorKey, id: string): Promise<Run>
  /** The standing order behind a run, or null when it has none. */
  getRunOrder(auctor: AuctorKey, runId: string): Promise<RunOrder | null>
  /** Cancel that order. Idempotent; null when the run has no order. */
  revokeRunOrder(auctor: AuctorKey, runId: string): Promise<RunOrder | null>
  listRuns(auctor: AuctorKey, opts: import('./CrystalApi.js').ListRunsOpts): Promise<RunsPage>
  /** The caller's in-flight + settled runs as one newest-first projection, each with a door. */
  listActivity(auctor: AuctorKey, opts: import('./CrystalApi.js').ListActivityOpts): Promise<ActivityPage>
  listFlows(): Promise<unknown[]>
  describeFlow(id: string): Promise<unknown>
  quote(
    auctor: AuctorKey,
    target: InvokeTarget,
    aditus: Record<string, unknown>,
  ): Promise<{ impetus: string }>
  listFundamenta(): Promise<Array<{ id: string; nomen?: string; versio: string; runtime?: string; imageId: string; imageVersion: string; vramGb?: number }>>
  listModels(filter?: { genus?: string; basis?: string; fundamentumId?: string; trigger?: string; q?: string; limit?: number; includeAdult?: boolean; sort?: string }): Promise<ModelCard[]>
  depositConfig(): DepositConfig
  depositQuote(input: { chainId: number | string; token: string; amount: string }): Promise<DepositQuote>
  myDeposits(auctor: AuctorKey): Promise<MyDeposit[]>
  importModel(auctor: AuctorKey, opts: import('./CrystalApi.js').ImportModelOpts): Promise<ModelCard>
  listMyModels(auctor: AuctorKey): Promise<ModelCard[]>
  setModelLicense(auctor: AuctorKey, id: string, opts: import('./CrystalApi.js').SetModelLicenseOpts): Promise<ModelCard>
  revenueReport(auctor: AuctorKey): Promise<import('./CrystalApi.js').RevenueReport>
  cogsReport(auctor: AuctorKey): Promise<import('./CrystalApi.js').CogsReport>
  saveFlow(auctor: AuctorKey, opts: SaveFlowOpts): Promise<{ id: string }>
  bind(auctor: AuctorKey, verb: string, modusId: string): Promise<{ verb: string; modusId: string }>
  getMe(auctor: AuctorKey): Promise<import('./CrystalApi.js').MeView>
  eraseMe(auctor: AuctorKey): Promise<import('../../types/erasure.js').ErasureReceipt>
  recordAttestation(auctor: AuctorKey): Promise<{ attestedAt: number }>
  putSecret(auctor: AuctorKey, provider: string, token: string, idleDays?: number): Promise<import('./CrystalApi.js').SecretView>
  removeSecret(auctor: AuctorKey, provider: string): Promise<import('./CrystalApi.js').SecretView>
  setAppearance(auctor: AuctorKey, appearance: import('../../types/consuetudo.js').Appearance): Promise<import('../../types/consuetudo.js').Appearance>
  setGeneratio(auctor: AuctorKey, generatio: import('../../types/consuetudo.js').Generatio): Promise<import('../../types/consuetudo.js').Generatio>
  getAffines(auctor: AuctorKey, modusId: string): Promise<Record<string, unknown>>
  setAffines(auctor: AuctorKey, modusId: string, affines: Record<string, unknown>): Promise<Record<string, unknown>>
  status(auctor: AuctorKey): Promise<StatusView>
  provisionStudio(auctor: AuctorKey, opts: ProvisionStudioOpts): Promise<StudioView>
  getStudio(auctor: AuctorKey, studioId: string): Promise<StudioView>
  listStudios(auctor: AuctorKey): Promise<StudioView[]>
  releaseStudio(auctor: AuctorKey, studioId: string): Promise<StudioView>
  provisionTeeSession(auctor: AuctorKey, opts: ProvisionTeeSessionOpts): Promise<TeeSessionView>
  getTeeSession(auctor: AuctorKey, sessionId: string): Promise<TeeSessionView>
  endTeeSession(auctor: AuctorKey, sessionId: string): Promise<void>
  fetchTeeWglog(auctor: AuctorKey, sessionId: string, tail?: string): Promise<string | null>
  collect(auctor: AuctorKey, opts: CollectOpts): Promise<Collection>
  fireCollection(auctor: AuctorKey, id: string): Promise<Collection>
  patchCollectionTractus(auctor: AuctorKey, id: string, tractus: import('../../types/collectio.js').Tractus[]): Promise<Collection>
  patchCollectionDraft(auctor: AuctorKey, id: string, patch: { tractus?: import('../../types/collectio.js').Tractus[]; modusId?: string; numerus?: number }): Promise<Collection>
  getCollection(auctor: AuctorKey, id: string): Promise<Collection>
  getCollectionRarity(auctor: AuctorKey, id: string): Promise<RarityReport>
  extendCollection(auctor: AuctorKey, id: string, addCount: number): Promise<Collection>
  listCollections(auctor: AuctorKey): Promise<Collection[]>
  pauseCollection(auctor: AuctorKey, id: string): Promise<Collection>
  resumeCollection(auctor: AuctorKey, id: string): Promise<Collection>
  cancelCollection(auctor: AuctorKey, id: string): Promise<Collection>
  approveCollectionPiece(auctor: AuctorKey, id: string, actumId: string): Promise<void>
  rejectCollectionPiece(auctor: AuctorKey, id: string, actumId: string): Promise<void>
  listCollectionPieces(auctor: AuctorKey, id: string, review?: 'pending' | 'approved' | 'rejected' | 'all'): Promise<import('./types.js').CollectionPiece[]>
  listDatasets(auctor: AuctorKey, opts?: { cursor?: string; limit?: number }): Promise<{ datasets: import('../../types/dataset.js').Dataset[]; nextCursor?: string }>
  listDatasetSummaries(auctor: AuctorKey, opts?: { cursor?: string; limit?: number }): Promise<{ datasets: import('../../types/dataset.js').DatasetSummary[]; nextCursor?: string }>
  listPublicDatasets(opts?: { cursor?: string; limit?: number }): Promise<{ datasets: import('../../types/dataset.js').Dataset[]; nextCursor?: string }>
  getDataset(auctor: AuctorKey, id: string): Promise<import('../../types/dataset.js').Dataset>
  createDataset(auctor: AuctorKey, input: import('../../types/dataset.js').CreateDatasetInput): Promise<import('../../types/dataset.js').Dataset>
  addDatasetMedia(auctor: AuctorKey, datasetId: string, input: unknown): Promise<import('../../types/dataset.js').Dataset>
  addCaptionset(auctor: AuctorKey, datasetId: string, input: unknown): Promise<import('../../types/dataset.js').Dataset>
  setCaption(auctor: AuctorKey, datasetId: string, captionsetId: string, mediaId: string, caption: unknown): Promise<import('../../types/dataset.js').Dataset>
  setDatasetAccess(auctor: AuctorKey, datasetId: string, kind: 'public' | 'private'): Promise<import('../../types/dataset.js').Dataset>
  archiveDataset(auctor: AuctorKey, datasetId: string): Promise<import('../../types/dataset.js').Dataset>
  restoreDataset(auctor: AuctorKey, datasetId: string): Promise<import('../../types/dataset.js').Dataset>
  archiveDatasetMedia(auctor: AuctorKey, datasetId: string, mediaId: string): Promise<import('../../types/dataset.js').Dataset>
  restoreDatasetMedia(auctor: AuctorKey, datasetId: string, mediaId: string): Promise<import('../../types/dataset.js').Dataset>
  // --- Muse sessions (a dataset break-off with its own floor and piece ledger) ---
  spawnMuseSession(auctor: AuctorKey, datasetId: string): Promise<import('./CrystalApi.js').MuseSessionView>
  getMuseSession(auctor: AuctorKey, id: string): Promise<import('./CrystalApi.js').MuseSessionView>
  listMuseSessions(auctor: AuctorKey, datasetId: string): Promise<import('./CrystalApi.js').MuseSessionView[]>
  setMuseFragmentEnabled(auctor: AuctorKey, id: string, fragment: unknown, enabled: unknown): Promise<import('./CrystalApi.js').MuseSessionView>
  setMuseFragmentWeight(auctor: AuctorKey, id: string, fragment: unknown, weight: unknown): Promise<import('./CrystalApi.js').MuseSessionView>
  addMuseFragment(auctor: AuctorKey, id: string, fragment: unknown): Promise<import('./CrystalApi.js').MuseSessionView>
  /** Replaces the run setup wholesale. Spends nothing and fires nothing. */
  setMuseSetup(auctor: AuctorKey, id: string, setup: unknown): Promise<import('./CrystalApi.js').MuseSessionView>
  /** Returns a PROPOSAL and applies nothing — the floor moves through the routes above, on confirm. */
  steerMuseSession(auctor: AuctorKey, id: string, input: unknown): Promise<import('./CrystalApi.js').SteerProposalView>
  /** Appends one kept prompt to the session. Append-only; spends nothing and fires nothing. */
  keepMuseRoll(auctor: AuctorKey, id: string, roll: unknown): Promise<import('./CrystalApi.js').MuseSessionView>
  recordMusePiece(auctor: AuctorKey, id: string, piece: unknown): Promise<import('./CrystalApi.js').MuseSessionView>
  updateMusePiece(auctor: AuctorKey, id: string, runId: string, patch: unknown): Promise<import('./CrystalApi.js').MuseSessionView>
  saveMusePiece(auctor: AuctorKey, id: string, runId: string): Promise<import('./CrystalApi.js').MuseSessionView>
  promoteMuseSession(auctor: AuctorKey, id: string, input?: unknown): Promise<Collection>
  publish(auctor: AuctorKey, opts: PublishOpts): Promise<Edition>
  getEdition(auctor: AuctorKey, id: string): Promise<Edition>
  feed(filter?: FeedFilter): Promise<FeedItem[]>
  retractEdition(auctor: AuctorKey, id: string): Promise<Edition>
  listHeldEditions(auctor: AuctorKey): Promise<Edition[]>
  getEditionModeration(auctor: AuctorKey, id: string): Promise<EditionModerationDetail>
  previewHeldEdition(auctor: AuctorKey, id: string): Promise<import('./CrystalApi.js').EditionPreview>
  approveHeldEdition(auctor: AuctorKey, id: string): Promise<Edition>
  rejectHeldEdition(auctor: AuctorKey, id: string): Promise<Edition>
  confirmCsamAndReport(auctor: AuctorKey, id: string): Promise<Edition>
  createTeam(auctor: AuctorKey, opts: { nomen: string; members?: string[] }): Promise<Team>
  getTeam(auctor: AuctorKey, id: string): Promise<Team>
  listTeams(auctor: AuctorKey): Promise<Team[]>
  addTeamMember(auctor: AuctorKey, id: string, animaId: string): Promise<Team>
  removeTeamMember(auctor: AuctorKey, id: string, animaId: string): Promise<Team>
  listProjects(auctor: AuctorKey): Promise<Project[]>
  createProject(auctor: AuctorKey, opts: { name: string; desc?: string; glyph?: string; color?: string; teamId?: string }): Promise<Project>
  getProject(auctor: AuctorKey, id: string): Promise<Project>
  updateProject(auctor: AuctorKey, id: string, patch: { name?: string; desc?: string; glyph?: string; color?: string; teamId?: string | null }): Promise<Project>
  deleteProject(auctor: AuctorKey, id: string): Promise<void>
  fileAsset(auctor: AuctorKey, id: string, kind: string, assetId: string): Promise<Project>
  unfileAsset(auctor: AuctorKey, id: string, kind: string, assetId: string): Promise<Project>
  // --- Tabulae (canvas workspaces) ---
  listTabulae(auctor: AuctorKey): Promise<Tabula[]>
  createTabula(auctor: AuctorKey, opts: { nomen: string; descriptio?: string; visibilitas?: Tabula['visibilitas'] }): Promise<Tabula>
  getTabula(auctor: AuctorKey, id: string): Promise<Tabula>
  updateTabula(auctor: AuctorKey, id: string, patch: { nomen?: string; descriptio?: string; nodi?: Tabula['nodi']; vincula?: Tabula['vincula']; visibilitas?: Tabula['visibilitas'] }): Promise<Tabula>
  deleteTabula(auctor: AuctorKey, id: string): Promise<void>
  publishTabula(auctor: AuctorKey, id: string): Promise<{ modusId: string }>
  listMyFlows(auctor: AuctorKey): Promise<unknown[]>
  // --- Fiat funding rail (Stripe) ---
  /** PUBLIC display catalog (no auth) — the single source the pricing + Funding UIs render from. */
  listPacks(): PackView[]
  createCheckout(auctor: AuctorKey, opts: { packId: string; successUrl?: string; cancelUrl?: string }): Promise<{ url: string; sessionId: string }>
  handleStripeWebhook(input: { rawBody: string; signature?: string }): Promise<{ status: number; body: { received: boolean; credited?: string; message?: string } }>
}

/** The slice of IdentityResolver this router needs. */
export interface Identity {
  resolve(creds: Credentials): Promise<AuctorKey>
  /**
   * The same resolution, plus the limits the CREDENTIAL carries (a partner API key's per-run
   * spend ceiling). Required, not optional: the spend-admitting route reads it, and an identity
   * seam that could omit it would drop a ceiling silently — which is indistinguishable from a
   * key having none, and is the one failure mode a spend cap cannot tolerate.
   */
  resolveCaller(creds: Credentials): Promise<ResolvedCaller>
}

/**
 * Does this publish target a PUBLIC surface — the same feed/marketplace visibilities the
 * moderation gate keys on (`CrystalApi.publish`'s `isPublicSurface`, `CrystalApi.ts:1104`)?
 * Mirrors `CrystalApi.publish`'s destination→visibility default table (`CrystalApi.ts:827-839`)
 * so an omitted `destination`/`visibility` still resolves to its true default ('feed' is the
 * platform default destination, itself public) rather than silently skipping the cap. The one
 * approximation: it can't see the caller's stored `Anima.publicatio` prefs (router has no prefs
 * lookup), so a request that omits both fields AND whose account prefs override away from the
 * public 'feed' default is over-capped, never under-capped — the safe direction for a rate cap.
 */
function isPublicPublishTarget(destination: unknown, visibility: unknown): boolean {
  const dest = typeof destination === 'string' ? destination : 'feed'
  const vis = typeof visibility === 'string'
    ? visibility
    : dest === 'feed'
      ? 'feed'
      : (dest === 'mint' || dest === 'marketplace' || dest === 'gallery' || dest === 'arweave')
        ? 'marketplace'
        : 'private'
  return vis === 'feed' || vis === 'marketplace'
}

/** Owner key for the publish rate limiter — mirrors `CrystalApi._editionBy` (animaId | commitment;
 *  `publish` itself rejects a bare `bursaToken` caller, so there is no anon key to key by here). */
function publishOwnerKey(auctor: AuctorKey): string | undefined {
  if ('animaId' in auctor) return `anima:${auctor.animaId}`
  if ('commitment' in auctor) return `commitment:${auctor.commitment}`
  return undefined
}

export function createApiRouter(deps: {
  api: ApiFacade
  identity: Identity
  hub?: RunEventHub
  exporter?: MeExporter
  erasureEnabled?: boolean
  /** ANON_PURSE_ENABLED (noema-131) — when false (v1 default), an `x-bursa-token` spend is
   *  accepted ONLY for a SOUND owned purse (`owner` set, identified-funded); an ownerless
   *  (arcanum/forgeable-dev-key) or unknown bursa is refused 503. Flip true post-ceremony. */
  anonPurseEnabled?: boolean
  /** Bursa store — used ONLY to resolve `owner` at the spend chokepoint for the gate above. */
  bursarium?: Bursarum
  /** B2B partner directory (an approved Anima — see types/partner.ts). Backs `GET /v1/me/partner`
   *  ONLY — this router never creates/mutates a Partner record (that is the admin approval
   *  route's job, on a different surface entirely). Omitted → the route answers 503
   *  `internal.unavailable`, never a silent 404 (a deployment with no store wired is not the
   *  same fact as "this caller isn't a partner"). */
  partners?: PartnerStore
  /** Backs `POST /v1/me/partner/api-key` — self-serve issue/rotate, gated the same as
   *  `GET /v1/me/partner` (must have an active Partner record first). Omitted → 503, same
   *  reasoning as `partners` above. */
  apiKeys?: MintPartnerApiKeyDeps
  /** Optional per-route rate-limit middleware (index.ts wires express-rate-limit; tests omit). */
  rateLimiters?: {
    /** Guards PUBLIC publishes (feed/marketplace — the moderation gate's surfaces) so the
     *  held-review queue can't be flooded faster than a human can clear it. Keyed by owner,
     *  NOT IP (see `publishOwnerKey` below — the router stamps the key onto the request before
     *  invoking this). Private/unlisted publishes never hit it. */
    publish?: express.RequestHandler
  }
}): Router {
  const { api, identity } = deps
  const router = express.Router()

  /**
   * Async route wrapper: a thrown `ApiError` → its `httpStatus` + `{ error }`
   * body; anything else → 500 `internal.error`.
   *
   * Both branches emit exactly one structured log line (noema-163). A request that
   * succeeds emits nothing. Status codes and response bodies are unchanged by the
   * logging — the wire contract is set solely by `ApiError.httpStatus`/`toBody()`.
   *
   * Every wrapped response carries an `x-request-id` header matching the `requestId`
   * on the log line. Because the populated path is deliberately not logged, that header
   * is how a user-reported failure is matched to its line.
   */
  const wrap = (fn: (req: Request, res: Response) => Promise<void>) =>
    async (req: Request, res: Response): Promise<void> => {
      const startedAt = Date.now()
      const requestId = randomUUID()
      // Set before `fn` runs so it survives a thrown error and reaches the error response.
      if (!res.headersSent) res.setHeader('x-request-id', requestId)
      try {
        await fn(req, res)
      } catch (err) {
        const durationMs = Date.now() - startedAt
        const route = routeTemplate(req)
        const callerHash = (req as SeamRequest).__callerHash
        const caller = callerHash ? { callerHash } : {}
        if (err instanceof ApiError) {
          const base = {
            method: req.method,
            route,
            status: err.httpStatus,
            code: err.code,
            durationMs,
            requestId,
            ...caller,
          }
          if (err.httpStatus >= 500) {
            // A deliberate 5xx (fail-closed gates included) is an operator-facing condition,
            // so the message is carried. `opts.details` is not: it is caller-shaped.
            log.error('api error', { ...base, message: err.message })
          } else {
            // 4xx carries the code and nothing else from the error — the message can quote
            // caller input. `warn`, not `error`: 401s on public routes are ordinary traffic.
            log.warn('api error', base)
          }
          res.status(err.httpStatus).json({ error: err.toBody() })
        } else {
          // Unexpected — log it (otherwise the masked `internal.error` is invisible in the logs).
          // The stack is ours, not user content, so it is kept.
          log.error('unhandled API error', {
            method: req.method,
            route,
            durationMs,
            requestId,
            ...caller,
            error: String((err as Error)?.stack ?? err),
          })
          res.status(500).json({ error: Errors.internal().toBody() })
        }
      }
    }

  /** Resolve the caller's identity from the request, or throw an ApiError.
   *  bursaToken in body or x-bursa-token header short-circuits to anonymous bursa identity.
   *
   *  ANON_PURSE gate (noema-131): the ownerless (arcanum/forgeable-dev-key) bursa spend path is
   *  a money path that must NOT carry real value in v1. When the flag is off we resolve the bursa
   *  and inspect `owner`: an OWNED purse (§7, identified funder) spends unchanged; an ownerless or
   *  unknown/nonexistent bursa is refused 503 (fail-closed — the dev key can forge these). When the
   *  flag is on, the short-circuit is unchanged (post-ceremony restore is a one-flag flip). */
  const authCaller = async (req: Request): Promise<ResolvedCaller> => {
    const seam = req as SeamRequest
    const bursaToken = req.body?.bursaToken ?? (req.headers['x-bursa-token'] as string | undefined)
    if (bursaToken) {
      if (!deps.anonPurseEnabled) {
        const bursa = deps.bursarium ? await deps.bursarium.findByToken(bursaToken) : null
        if (!bursa?.owner) {
          throw new ApiError('purse.disabled', 'anonymous purse coming soon', 503)
        }
      }
      // A `bursaToken` is a bearer credential. No log field is ever derived from it —
      // not hashed, not truncated. The caller stays unattributed on the log line.
      seam.__callerHash = undefined
      seam.__callerKind = 'purse'
      return { auctor: { bursaToken } }
    }
    const caller = await identity.resolveCaller(
      credentialsFromHeaders(req.headers as Record<string, string | undefined>, req.body),
    )
    // The single place identity is resolved — stamp the keyed digest here so the error
    // seam can attribute a failure without ever seeing the raw id.
    seam.__callerHash = 'animaId' in caller.auctor ? hashCaller(caller.auctor.animaId) : undefined
    return caller
  }

  /** The identity-only view of `authCaller`, for every route that does not admit spend. */
  const auth = async (req: Request): Promise<AuctorKey> => (await authCaller(req)).auctor

  /** Best-effort spicyMode read for the PUBLIC catalog (noema-091): an authenticated caller with
   *  spicyMode on (which required a recorded 18+ attestation to persist) may see `contentRating`-adult
   *  models; an anonymous/unauthenticated browse stays SFW — the safe default. NEVER throws — a
   *  missing/invalid credential resolves to `false`, so `/v1/models` remains a working no-auth route. */
  const callerSpicyMode = async (req: Request): Promise<boolean> => {
    try {
      const me = await api.getMe(await auth(req))
      return me.generatio?.spicyMode === true
    } catch {
      return false
    }
  }

  // POST /v1/runs — invoke a flow.
  router.post(
    '/runs',
    wrap(async (req, res) => {
      const { modusId, verb, aditus, pinnedModels, computeStrategy, gpuClass, maxImpetus, studioId } = req.body ?? {}
      // Spend admission, so this route resolves the FULL caller: a partner API key can carry its
      // own per-run ceiling, and `invokeFlow` applies it as a floor under the body's `maxImpetus`.
      // `keyMaxImpetusPerRun` is deliberately absent from the destructure above — it comes from
      // the resolved credential and there is no body field that can set or raise it.
      const { auctor, maxImpetusPerRun } = await authCaller(req)
      const by = 'bursaToken' in auctor ? auctor : undefined
      const run = await api.invokeFlow(
        auctor,
        { modusId, verb },
        aditus ?? {},
        {
          pinnedModels, computeStrategy, gpuClass,
          ...(maxImpetus !== undefined ? { maxImpetus } : {}),
          ...(maxImpetusPerRun !== undefined ? { keyMaxImpetusPerRun: maxImpetusPerRun } : {}),
          ...(studioId ? { studioId } : {}),
          ...(by ? { by } : {}),
        },
      )
      const webhookUrl = req.body?.options?.webhookUrl
      if (deps.hub && typeof webhookUrl === 'string' && webhookUrl.length > 0) {
        deps.hub.setWebhook(run.id, webhookUrl)
      }
      res.status(200).json({ run })
    }),
  )

  // GET /v1/payments/packs — the PUBLIC credit-pack catalog for display (pricing page + Funding).
  // No auth (pricing is public), read-only, no money mutation. This is the single DISPLAY source of
  // truth, sourced from `stripePacks.PACKS`; the charged amount stays server-authoritative by packId.
  router.get('/payments/packs', wrap(async (_req, res) => {
    res.json({ packs: api.listPacks() })
  }))

  // POST /v1/payments/checkout — an IDENTIFIED caller buys a credit pack (Stripe Checkout).
  // Returns the hosted-checkout URL to redirect to. A fiat pack can only fund an identified
  // account (a card de-anonymizes) — an anon/bursa caller is rejected by the facade.
  router.post(
    '/payments/checkout',
    wrap(async (req, res) => {
      const auctor = await auth(req)
      const { packId, successUrl, cancelUrl } = req.body ?? {}
      const out = await api.createCheckout(auctor, {
        packId,
        ...(typeof successUrl === 'string' ? { successUrl } : {}),
        ...(typeof cancelUrl === 'string' ? { cancelUrl } : {}),
      })
      res.status(200).json(out)
    }),
  )

  // POST /v1/payments/stripe/webhook — Stripe → server. NO client auth: it is gated by the
  // `stripe-signature` HMAC (verified in the facade). Uses the raw body captured by the global
  // express.json `verify` hook — a re-serialized body would break signature verification.
  router.post('/payments/stripe/webhook', async (req, res): Promise<void> => {
    const rawBody = (req as { rawBody?: string }).rawBody ?? JSON.stringify(req.body ?? {})
    const signature = req.headers['stripe-signature'] as string | undefined
    try {
      const result = await api.handleStripeWebhook({ rawBody, ...(signature ? { signature } : {}) })
      res.status(result.status).json(result.body)
    } catch (err) {
      if (err instanceof ApiError) {
        res.status(err.httpStatus).json({ error: err.toBody() })
      } else {
        log.error('unhandled stripe webhook error', { error: String((err as Error)?.stack ?? err) })
        res.status(500).json({ error: Errors.internal().toBody() })
      }
    }
  })

  // GET /v1/runs/:id/stream — SSE stream of run events.
  router.get('/runs/:id/stream', async (req, res): Promise<void> => {
    // Auth + run fetch BEFORE setting SSE headers so errors can be JSON.
    let auctor: AuctorKey
    try {
      auctor = await auth(req)
    } catch (err) {
      if (err instanceof ApiError) {
        res.status(err.httpStatus).json({ error: err.toBody() })
      } else {
        res.status(500).json({ error: Errors.internal().toBody() })
      }
      return
    }
    if (!deps.hub) {
      res.status(501).json({ error: { code: 'internal.error', message: 'streaming unavailable' } })
      return
    }

    const id = String(req.params.id)
    let run: Run
    try {
      run = await api.getRun(auctor, id)   // owner-scoped: 404 if the run isn't yours
    } catch (err) {
      if (err instanceof ApiError) {
        res.status(err.httpStatus).json({ error: err.toBody() })
      } else {
        res.status(500).json({ error: Errors.internal().toBody() })
      }
      return
    }

    // Switch to SSE mode — no JSON errors past this point.
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    if (typeof (res as any).flushHeaders === 'function') (res as any).flushHeaders()

    // Initial snapshot frame. `getRun` now returns the owner-detail Run shape (aditus,
    // pinnedModels, modusVersion) — the stream stays lean/progress-only, so explicitly
    // pick only the pre-existing fields rather than forwarding the full detailed object.
    const snapshot: Run = {
      id: run.id,
      status: run.status,
      modusId: run.modusId,
      ...(run.exitus !== undefined ? { exitus: run.exitus } : {}),
      ...(run.failure !== undefined ? { failure: run.failure } : {}),
      ...(run.cost !== undefined ? { cost: run.cost } : {}),
      ...(run.createdAt !== undefined ? { createdAt: run.createdAt } : {}),
      ...(run.resumeCheckpoint !== undefined ? { resumeCheckpoint: run.resumeCheckpoint } : {}),
    }
    res.write('data: ' + JSON.stringify({ kind: 'snapshot', run: snapshot }) + '\n\n')

    // Replay buffered events.
    for (const ev of deps.hub.recentFor(id)) {
      res.write('data: ' + JSON.stringify(ev) + '\n\n')
    }

    // Live subscription.
    const off = deps.hub.subscribe(id, ev => {
      res.write('data: ' + JSON.stringify(ev) + '\n\n')
      if (ev.terminal) res.end()
    })

    req.on('close', off)
  })

  // GET /v1/runs/:id — fetch a run (owner-scoped — you only see your own runs).
  router.get(
    '/runs/:id',
    wrap(async (req, res) => {
      const auctor = await auth(req)
      res.json({ run: await api.getRun(auctor, String(req.params.id)) })
    }),
  )

  // POST /v1/runs/:id/cancel — stop a run the caller owns and settle it (nothing is charged).
  // A POST verb-suffix, not DELETE: the run record is not removed, it reaches its terminal
  // state and stays readable — the same shape `POST /v1/collectiones/:id/cancel` uses for the
  // same act. Owner-scoped from the resolved caller (a run id is an address, not a capability):
  // a stranger gets not_found.run, never forbidden, so ids stay non-enumerable. Idempotent —
  // cancelling an already-terminal run returns the same terminal view, 200, exactly as a
  // double-DELETE of a studio does.
  router.post(
    '/runs/:id/cancel',
    wrap(async (req, res) => {
      const auctor = await auth(req)
      res.json({ run: await api.cancelRun(auctor, String(req.params.id)) })
    }),
  )

  // GET /v1/runs/:id/order — the standing order behind a run (owner-scoped through the run).
  // `{ order: null }` when there is none, which is every run that is not a training run.
  router.get(
    '/runs/:id/order',
    wrap(async (req, res) => {
      const auctor = await auth(req)
      res.json({ order: await api.getRunOrder(auctor, String(req.params.id)) })
    }),
  )

  // POST /v1/runs/:id/order/revoke — cancel that order. The owner comes from the resolved
  // caller and never from the body: a run id is an address, not a capability.
  router.post(
    '/runs/:id/order/revoke',
    wrap(async (req, res) => {
      const auctor = await auth(req)
      res.json({ order: await api.revokeRunOrder(auctor, String(req.params.id)) })
    }),
  )

  // GET /v1/openapi.json — the live, self-describing contract (no auth). Generated
  // from the same API_CONTRACT the committed docs + drift-check use, so it can't lag.
  const OPENAPI = generateOpenApi(API_CONTRACT)
  router.get('/openapi.json', (_req, res) => { res.json(OPENAPI) })

  // POST /v1/runs/quote — cost estimate without dispatching (auth required).
  router.post(
    '/runs/quote',
    wrap(async (req, res) => {
      const auctor = await auth(req)
      const { modusId, verb, aditus } = req.body ?? {}
      res.json(await api.quote(auctor, { modusId, verb }, aditus ?? {}))
    }),
  )

  // ── Collections (Collectio) — a base modus expanded over a Tractus[] grid ──────
  // POST /v1/collectiones — create + start a Collection.
  router.post('/collectiones', wrap(async (req, res) => {
    const auctor = await auth(req)
    const { modusId, total, tractus, aditusBase, concurrentia, nomen, descriptio, dna, reviewEnabled, draft, teamId } = req.body ?? {}
    res.status(200).json({ collection: await api.collect(auctor, { modusId, total, tractus, aditusBase, concurrentia, nomen, descriptio, dna, reviewEnabled, draft, teamId }) })
  }))

  // PATCH /v1/collectiones/:id/tractus — edit a DRAFT's trait axes/values/rules, and (since a
  // draft may now be created without them) its base flow + supply. The garden/rules authoring
  // write. Re-derives provenance; frozen once fired. Omitted fields are left untouched.
  router.patch('/collectiones/:id/tractus', wrap(async (req, res) => {
    const { tractus, modusId, numerus } = req.body ?? {}
    res.json({ collection: await api.patchCollectionDraft(await auth(req), String(req.params.id), {
      ...(tractus !== undefined ? { tractus } : {}),
      ...(modusId !== undefined ? { modusId: String(modusId) } : {}),
      ...(numerus !== undefined ? { numerus: Number(numerus) } : {}),
    }) })
  }))

  // POST /v1/collectiones/:id/fire — freeze a DRAFT's tractus and start the run (funder-only).
  router.post('/collectiones/:id/fire', wrap(async (req, res) => {
    res.json({ collection: await api.fireCollection(await auth(req), String(req.params.id)) })
  }))

  // GET /v1/collectiones — list the caller's collections (owner-scoped).
  router.get('/collectiones', wrap(async (req, res) => {
    res.json({ collections: await api.listCollections(await auth(req)) })
  }))

  // GET /v1/collectiones/:id — fetch one (owner-scoped: 404 if not yours).
  router.get('/collectiones/:id', wrap(async (req, res) => {
    res.json({ collection: await api.getCollection(await auth(req), String(req.params.id)) })
  }))

  // GET /v1/collectiones/:id/rarity — imagined-vs-realized rarity table (owner-scoped).
  router.get('/collectiones/:id/rarity', wrap(async (req, res) => {
    res.json({ rarity: await api.getCollectionRarity(await auth(req), String(req.params.id)) })
  }))

  // GET /v1/collectiones/:id/pieces — the curation queue. ?review=pending|approved|rejected|all (default pending).
  router.get('/collectiones/:id/pieces', wrap(async (req, res) => {
    const r = String(req.query.review ?? 'pending')
    const review = (['pending', 'approved', 'rejected', 'all'].includes(r) ? r : 'pending') as 'pending' | 'approved' | 'rejected' | 'all'
    res.json({ pieces: await api.listCollectionPieces(await auth(req), String(req.params.id), review) })
  }))

  // POST /v1/collectiones/:id/extend — raise the target + fire another batch (incremental batches).
  router.post('/collectiones/:id/extend', wrap(async (req, res) => {
    const auctor = await auth(req)
    const addCount = Number((req.body ?? {}).count)
    res.json({ collection: await api.extendCollection(auctor, String(req.params.id), addCount) })
  }))

  // POST /v1/collectiones/:id/{pause,resume,cancel}.
  router.post('/collectiones/:id/pause', wrap(async (req, res) => {
    res.json({ collection: await api.pauseCollection(await auth(req), String(req.params.id)) })
  }))
  router.post('/collectiones/:id/resume', wrap(async (req, res) => {
    res.json({ collection: await api.resumeCollection(await auth(req), String(req.params.id)) })
  }))
  router.post('/collectiones/:id/cancel', wrap(async (req, res) => {
    res.json({ collection: await api.cancelCollection(await auth(req), String(req.params.id)) })
  }))

  // POST /v1/collectiones/:id/pieces/:actumId/{approve,reject} — review (approve / reject-and-reroll).
  router.post('/collectiones/:id/pieces/:actumId/approve', wrap(async (req, res) => {
    await api.approveCollectionPiece(await auth(req), String(req.params.id), String(req.params.actumId))
    res.status(200).json({ ok: true })
  }))
  router.post('/collectiones/:id/pieces/:actumId/reject', wrap(async (req, res) => {
    await api.rejectCollectionPiece(await auth(req), String(req.params.id), String(req.params.actumId))
    res.status(200).json({ ok: true })
  }))

  // ── Publishing (Editio) — put a canonical artifact forth to a destination ──────
  // POST /v1/editiones — publish an artifact (an Actum for #1). Public surfaces
  // (feed/marketplace) return a `pending` Edition (async moderation → published).
  router.post('/editiones', wrap(async (req, res) => {
    const auctor = await auth(req)
    const { artifact, destination, visibility, custody, license, teamId, owners } = req.body ?? {}
    // Public-publish volume cap (noema-119): held-review only stays clearable by a human if
    // inflow is bounded. Private/unlisted publishes never hit the review queue, so they're
    // never rate-limited here — only feed/marketplace targets are.
    const publishLimiter = deps.rateLimiters?.publish
    const ownerKey = publishLimiter ? publishOwnerKey(auctor) : undefined
    if (publishLimiter && ownerKey && isPublicPublishTarget(destination, visibility)) {
      (req as Request & { publishOwnerKey?: string }).publishOwnerKey = ownerKey
      const passed = await new Promise<boolean>((resolve) => {
        publishLimiter(req, res, (err?: unknown) => resolve(!err))
      })
      if (!passed || res.headersSent) return
    }
    res.status(200).json({ edition: await api.publish(auctor, { artifact, destination, visibility, custody, license, teamId, owners }) })
  }))

  // GET /v1/editiones/review — the human-review queue (spec §4): editions the moderation
  // gate HELD. Author sees their own held items; the platform admin sees all. MUST be
  // declared before '/editiones/:id' so the literal path isn't captured as an id.
  router.get('/editiones/review', wrap(async (req, res) => {
    res.json({ editions: await api.listHeldEditions(await auth(req)) })
  }))

  // GET /v1/editiones/:id — one publication (author-scoped). Polled to watch an async
  // settle land: pending → published (with the `externalRef`, e.g. an archive ZIP url).
  router.get('/editiones/:id', wrap(async (req, res) => {
    res.json({ edition: await api.getEdition(await auth(req), String(req.params.id)) })
  }))

  // GET /v1/editiones/:id/moderation — the moderation gate's RAW verdict for one
  // publication (spec: moderation-reject-reason). PLATFORM-ADMIN ONLY. Reaches any
  // Editio by id regardless of status — the companion to `/editiones/review` for a
  // TERMINAL rejected item, which has no queue entry to inspect.
  router.get('/editiones/:id/moderation', wrap(async (req, res) => {
    res.json(await api.getEditionModeration(await auth(req), String(req.params.id)))
  }))

  // POST /v1/editiones/:id/retract — unpublish where the destination allows it (author-scoped).
  router.post('/editiones/:id/retract', wrap(async (req, res) => {
    res.json({ edition: await api.retractEdition(await auth(req), String(req.params.id)) })
  }))

  // GET /v1/editiones/:id/preview — the media a reviewer needs to adjudicate a HELD
  // publication (spec publish-review-visibility.md §2): resolves the SAME view the
  // moderation gate used to make its hold decision, for ANY artifact kind — not just an
  // `actum` generation run. PLATFORM-ADMIN ONLY, same gate as approve/reject/confirm-csam;
  // never exposes preview urls to a non-admin caller, author included.
  router.get('/editiones/:id/preview', wrap(async (req, res) => {
    res.json(await api.previewHeldEdition(await auth(req), String(req.params.id)))
  }))

  // POST /v1/editiones/:id/approve — clear a moderation HOLD → the item re-settles and
  // publishes (spec §4). PLATFORM-ADMIN ONLY (an author cannot clear their own hold).
  router.post('/editiones/:id/approve', wrap(async (req, res) => {
    res.json({ edition: await api.approveHeldEdition(await auth(req), String(req.params.id)) })
  }))

  // POST /v1/editiones/:id/reject — decline a held publication → terminal 'rejected'
  // (spec §4). PLATFORM-ADMIN ONLY. Never files a report (that is a separate human action).
  router.post('/editiones/:id/reject', wrap(async (req, res) => {
    res.json({ edition: await api.rejectHeldEdition(await auth(req), String(req.params.id)) })
  }))

  // POST /v1/editiones/:id/confirm-csam — reviewer affirmatively confirms a held item is
  // CSAM → reject + file the NCMEC report (spec §4). PLATFORM-ADMIN ONLY. This is the ONLY
  // review action that reports; the report is a legal duty on human confirmation (§2258A).
  router.post('/editiones/:id/confirm-csam', wrap(async (req, res) => {
    res.json({ edition: await api.confirmCsamAndReport(await auth(req), String(req.params.id)) })
  }))

  // GET /v1/feed — the public feed (NO auth): published, public-surface editions, newest first.
  router.get('/feed', wrap(async (req, res) => {
    const { visibility, destination, limit, author } = req.query
    const filter: FeedFilter = {
      ...(typeof visibility === 'string' ? { visibility: visibility as FeedFilter['visibility'] } : {}),
      ...(typeof destination === 'string' ? { destination } : {}),
      // `?author=<animaId>` scopes the feed to one creator/agent (still public-clamped).
      ...(typeof author === 'string' && author ? { author: { animaId: author } } : {}),
      ...(typeof limit === 'string' && Number.isFinite(Number(limit)) ? { limit: Number(limit) } : {}),
    }
    res.json({ feed: await api.feed(filter) })
  }))

  // ── Teams (Sodalitas) — a fellowship of Animae that co-owns work ────────────────
  // POST /v1/teams — create a team (the caller is the founder + first member).
  router.post('/teams', wrap(async (req, res) => {
    const { nomen, members } = req.body ?? {}
    res.status(200).json({ team: await api.createTeam(await auth(req), { nomen, members }) })
  }))

  // GET /v1/teams — list the caller's teams (member-scoped).
  router.get('/teams', wrap(async (req, res) => {
    res.json({ teams: await api.listTeams(await auth(req)) })
  }))

  // GET /v1/teams/:id — fetch one (member-scoped: 404 if not a member).
  router.get('/teams/:id', wrap(async (req, res) => {
    res.json({ team: await api.getTeam(await auth(req), String(req.params.id)) })
  }))

  // POST /v1/teams/:id/members — add a member { animaId }. Member-scoped.
  router.post('/teams/:id/members', wrap(async (req, res) => {
    const animaId = String((req.body ?? {}).animaId)
    res.json({ team: await api.addTeamMember(await auth(req), String(req.params.id), animaId) })
  }))

  // DELETE /v1/teams/:id/members/:animaId — remove a member (not the founder). Member-scoped.
  router.delete('/teams/:id/members/:animaId', wrap(async (req, res) => {
    res.json({ team: await api.removeTeamMember(await auth(req), String(req.params.id), String(req.params.animaId)) })
  }))

  // ── Projects (Provincia) — an account-owned workspace lens ──────────────────────
  // GET /v1/me/projects — the projects the caller may read: their own UNION the ones shared
  // with a Sodalitas they belong to (`Provincia.sodalitasId`). Identified callers only.
  router.get('/me/projects', wrap(async (req, res) => {
    res.json({ projects: await api.listProjects(await auth(req)) })
  }))

  // POST /v1/me/projects — create a project { name, desc?, glyph?, color?, teamId? }.
  router.post('/me/projects', wrap(async (req, res) => {
    const { name, desc, glyph, color, teamId } = req.body ?? {}
    res.status(201).json({ project: await api.createProject(await auth(req), { name, desc, glyph, color, teamId }) })
  }))

  // GET /v1/me/projects/:id — fetch one project the caller may read: the owner, or a member of
  // the team it is shared with (404 for anyone else — not_found, never forbidden).
  router.get('/me/projects/:id', wrap(async (req, res) => {
    res.json({ project: await api.getProject(await auth(req), String(req.params.id)) })
  }))

  // PATCH /v1/me/projects/:id — patch metadata { name?, desc?, glyph?, color?, teamId? }.
  router.patch('/me/projects/:id', wrap(async (req, res) => {
    const { name, desc, glyph, color, teamId } = req.body ?? {}
    res.json({ project: await api.updateProject(await auth(req), String(req.params.id), { name, desc, glyph, color, teamId }) })
  }))

  // DELETE /v1/me/projects/:id — delete a project (filed assets untouched).
  router.delete('/me/projects/:id', wrap(async (req, res) => {
    await api.deleteProject(await auth(req), String(req.params.id))
    res.status(204).end()
  }))

  // POST /v1/me/projects/:id/holdings — file an asset { kind: dataset|model|collection, assetId }.
  // Owner or team member (the additive verb). A holding is a reference, not a grant: it does not
  // change who may read the asset it names.
  router.post('/me/projects/:id/holdings', wrap(async (req, res) => {
    const { kind, assetId } = req.body ?? {}
    res.json({ project: await api.fileAsset(await auth(req), String(req.params.id), String(kind), String(assetId)) })
  }))

  // DELETE /v1/me/projects/:id/holdings/:kind/:assetId — unfile an asset from a project.
  // Owner-only: the overlay widens what is added to the lens, never what is removed from it.
  router.delete('/me/projects/:id/holdings/:kind/:assetId', wrap(async (req, res) => {
    res.json({ project: await api.unfileAsset(await auth(req), String(req.params.id), String(req.params.kind), String(req.params.assetId)) })
  }))

  // GET /v1/tabulae — list the caller's own canvas workspaces. Owner-scoped (auth required;
  // anon commitment/purse callers own their own drafts too).
  router.get('/tabulae', wrap(async (req, res) => {
    res.json({ tabulae: await api.listTabulae(await auth(req)) })
  }))

  // POST /v1/tabulae — create a new draft Tabula owned by the caller.
  router.post('/tabulae', wrap(async (req, res) => {
    const { nomen, descriptio, visibilitas } = req.body ?? {}
    const tabula = await api.createTabula(await auth(req), { nomen, ...(descriptio !== undefined ? { descriptio } : {}), ...(visibilitas !== undefined ? { visibilitas } : {}) })
    res.status(201).json({ tabula })
  }))

  // GET /v1/tabulae/:id — fetch one owned Tabula (404 for a stranger, same as unknown id).
  router.get('/tabulae/:id', wrap(async (req, res) => {
    res.json({ tabula: await api.getTabula(await auth(req), String(req.params.id)) })
  }))

  // PUT /v1/tabulae/:id — patch a Tabula's graph/metadata. Owner-only.
  router.put('/tabulae/:id', wrap(async (req, res) => {
    const { nomen, descriptio, nodi, vincula, visibilitas } = req.body ?? {}
    const patch: Record<string, unknown> = {}
    if (nomen !== undefined) patch.nomen = nomen
    if (descriptio !== undefined) patch.descriptio = descriptio
    if (nodi !== undefined) patch.nodi = nodi
    if (vincula !== undefined) patch.vincula = vincula
    if (visibilitas !== undefined) patch.visibilitas = visibilitas
    res.json({ tabula: await api.updateTabula(await auth(req), String(req.params.id), patch) })
  }))

  // DELETE /v1/tabulae/:id — delete a Tabula outright. Owner-only.
  router.delete('/tabulae/:id', wrap(async (req, res) => {
    await api.deleteTabula(await auth(req), String(req.params.id))
    res.status(200).json({ ok: true })
  }))

  // POST /v1/tabulae/:id/publish — compile the canvas graph into a compositus Modus and
  // register it, immediately runnable via POST /v1/runs.
  router.post('/tabulae/:id/publish', wrap(async (req, res) => {
    res.status(200).json(await api.publishTabula(await auth(req), String(req.params.id)))
  }))

  // GET /v1/me/flows — the caller's own registered flows (owner-scoped discovery for the
  // canvas node picker), the public catalog's `?mine` twin (`GET /v1/flows` stays canonical-
  // only; smaller diff than making that route auth-aware).
  router.get('/me/flows', wrap(async (req, res) => {
    res.json({ flows: await api.listMyFlows(await auth(req)) })
  }))

  // GET /v1/fundamenta — list compute substrates (public).
  router.get(
    '/fundamenta',
    wrap(async (_req, res) => {
      res.json({ fundamenta: await api.listFundamenta() })
    }),
  )

  // GET /v1/models — filterable model catalog (public).
  router.get(
    '/models',
    wrap(async (req, res) => {
      const { genus, basis, fundamentumId, trigger, q, limit, sort } = req.query as Record<string, string | undefined>
      const filter: { genus?: string; basis?: string; fundamentumId?: string; trigger?: string; q?: string; limit?: number; includeAdult?: boolean; sort?: string } = {}
      if (genus !== undefined) filter.genus = genus
      if (basis !== undefined) filter.basis = basis
      if (fundamentumId !== undefined) filter.fundamentumId = fundamentumId
      if (trigger !== undefined) filter.trigger = trigger
      if (q !== undefined) filter.q = q
      if (limit !== undefined) filter.limit = Number(limit)
      // `?sort=newest|name|genus` — ordering, applied server-side before the limit slice.
      // Passed through verbatim; CrystalApi normalises an unrecognised value to the default.
      if (sort !== undefined) filter.sort = sort
      // Adult-rated ({suggestive, explicit}) models are catalog-hidden unless the caller has spicyMode
      // on (noema-091). Derived from the caller's persisted toggle — NOT a client-supplied query param —
      // so it can't be spoofed; anonymous browse stays SFW.
      if (await callerSpicyMode(req)) filter.includeAdult = true
      res.json({ models: await api.listModels(filter) })
    }),
  )

  // GET /v1/deposit/config — static config for the buy-points/deposit UI (address, rate, chains).
  // Public, no auth.
  router.get('/deposit/config', wrap(async (_req, res) => {
    res.json(api.depositConfig())
  }))

  // POST /v1/deposit/quote — how many impetus points `amount` base units of `token` buys, now.
  // Public, no auth (informational; the webhook credit at deposit time is authoritative and equal).
  // Body: { chainId, token, amount }  — amount = raw base units (wei / token-decimals), string.
  router.post('/deposit/quote', wrap(async (req, res) => {
    const { chainId, token, amount } = req.body ?? {}
    res.json(await api.depositQuote({ chainId, token: String(token ?? ''), amount: String(amount ?? '') }))
  }))

  // GET /v1/deposit/mine — the caller's OWN deposits, scoped to their linked wallets (auth
  // required). Powers the settle-watch UI's real depositum status. Owner-scoped by construction
  // in CrystalApi.myDeposits — a stranger's animaId never resolves another caller's wallets.
  router.get('/deposit/mine', wrap(async (req, res) => {
    const auctor = await auth(req)
    res.json({ deposits: await api.myDeposits(auctor) })
  }))

  // POST /v1/models/import — import a model/LoRA by URL as a PRIVATE, owner-scoped model
  // (Civitai/HF/direct). Usable in the importer's flows at once; never on the public
  // catalogue until a separate `publish` promotion passes moderation.
  router.post('/models/import', wrap(async (req, res) => {
    const auctor = await auth(req)
    const { url, genus } = req.body ?? {}
    res.status(200).json({ model: await api.importModel(auctor, { url, genus }) })
  }))

  // GET /v1/me/models — the caller's own private models (imports + trained), newest first.
  // The public GET /v1/models catalog is canonical-only, so this is where an owner sees theirs.
  router.get('/me/models', wrap(async (req, res) => {
    res.json({ models: await api.listMyModels(await auth(req)) })
  }))

  // PUT /v1/models/:id/license — ADMIN license clearance/backfill (platform-admin only). Set an
  // explicit { license, commercialUse } or { reclassify: true } to re-derive from the base string.
  router.put('/models/:id/license', wrap(async (req, res) => {
    const auctor = await auth(req)
    const { license, commercialUse, reclassify } = req.body ?? {}
    res.json({ model: await api.setModelLicense(auctor, String(req.params.id), { license, commercialUse, reclassify }) })
  }))

  // GET /v1/admin/revenue — ADMIN revenue report (platform-admin only): company-wide trailing-12mo
  // USD revenue vs the tightest active conditional-license cap (the tripwire, ADR-0012/0013 §5).
  router.get('/admin/revenue', wrap(async (req, res) => {
    res.json(await api.revenueReport(await auth(req)))
  }))

  // GET /v1/admin/cogs — ADMIN COGS report (platform-admin only): trailing-window rollup of
  // per-job costUsd off wide_events — the read-only pair to /admin/revenue.
  router.get('/admin/cogs', wrap(async (req, res) => {
    res.json(await api.cogsReport(await auth(req)))
  }))

  // GET /v1/flows — public flow discovery (no auth).
  router.get(
    '/flows',
    wrap(async (_req, res) => {
      res.json({ flows: await api.listFlows() })
    }),
  )

  // GET /v1/flows/:id — describe one flow's JSON-Schema (no auth).
  router.get(
    '/flows/:id',
    wrap(async (req, res) => {
      res.json(await api.describeFlow(String(req.params.id)))
    }),
  )

  // POST /v1/flows — save a reusable owner-keyed flow (auth required).
  router.post(
    '/flows',
    wrap(async (req, res) => {
      const auctor = await auth(req)
      res.status(201).json(await api.saveFlow(auctor, req.body ?? {}))
    }),
  )

  // PUT /v1/me/bindings/:verb — rebind a canon verb to a flow (auth required).
  router.put(
    '/me/bindings/:verb',
    wrap(async (req, res) => {
      const auctor = await auth(req)
      res.json(await api.bind(auctor, String(req.params.verb), req.body?.modusId))
    }),
  )

  // GET /v1/me/status — the caller's account snapshot (auth required).
  router.get(
    '/me/status',
    wrap(async (req, res) => {
      const auctor = await auth(req)
      res.json(await api.status(auctor))
    }),
  )

  // GET /v1/me/partner — the caller's B2B Partner record, if any. A "partner" is simply an
  // ordinary Anima a platform admin has approved (types/partner.ts) — no on-chain agent/treasury
  // lookup. This is the partner dashboard's access gate: 404 when the caller has no Partner
  // record, or has one but it was revoked (indistinguishable from the caller's side — "you don't
  // have partner access" either way); 503 when this deployment has no PartnerStore wired at all.
  // Auth resolves FIRST, same as every other /me/* route, so an unauthenticated caller always
  // gets 401 regardless of whether the store is configured.
  router.get('/me/partner', wrap(async (req, res) => {
    const auctor = await auth(req)
    if (!deps.partners) throw Errors.partnerDirectoryUnavailable()
    const partner = 'animaId' in auctor ? await deps.partners.find(auctor.animaId) : null
    if (!partner || partner.status === 'revoked') throw Errors.notFoundPartner()
    res.status(200).json(partner)
  }))

  // POST /v1/me/partner/api-key — self-serve issue-or-rotate. NOT reachable from the admin
  // approval surface (partnerAdminRouter.ts) on purpose: the admin approving a request is
  // frequently not the partner, so the raw key belongs here, in the hands of whoever can
  // actually authenticate as the approved account, never in an admin's approval response.
  // Each call retires every key this route previously issued (rotatePartnerApiKey — a real
  // rotation, not an accumulation of live keys) and returns a fresh one, shown ONCE — this
  // response is the only time it is ever retrievable; only its hash is stored afterward.
  router.post('/me/partner/api-key', wrap(async (req, res) => {
    const auctor = await auth(req)
    if (!deps.partners) throw Errors.partnerDirectoryUnavailable()
    if (!deps.apiKeys) throw Errors.partnerDirectoryUnavailable()
    const partner = 'animaId' in auctor ? await deps.partners.find(auctor.animaId) : null
    if (!partner || partner.status === 'revoked') throw Errors.notFoundPartner()
    const apiKey = await rotatePartnerApiKey(deps.apiKeys, (auctor as { animaId: string }).animaId)
    res.status(200).json({ apiKey })
  }))

  // GET /v1/me/runs — the caller's SETTLED spend history: per-run cost (+ derived USD),
  // settledAt, and a lifetime running total. Owner-scoped, cursor-paginated, newest first.
  // `?status=settled` is the only supported filter (completus-only — a refunded failed run
  // is not spend); `?cursor=` pages, `?limit=` sizes (1..100, default 20).
  router.get('/me/runs', wrap(async (req, res) => {
    const auctor = await auth(req)
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined
    const rawLimit = typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined
    const limit = rawLimit !== undefined && Number.isFinite(rawLimit) ? rawLimit : undefined
    res.json(await api.listRuns(auctor, { ...(cursor ? { cursor } : {}), ...(limit !== undefined ? { limit } : {}) }))
  }))

  // GET /v1/me/activity — the caller's ACTIVITY: in-flight runs and settled runs in ONE
  // owner-scoped, newest-first projection, each row carrying its kind and a door to the
  // artifact it produced. Read-only — composed from the run index's existing in-flight and
  // settled listings. `?cursor=` pages settled history (in-flight rows ride the first page);
  // `?limit=` sizes (1..100, default 20).
  router.get('/me/activity', wrap(async (req, res) => {
    const auctor = await auth(req)
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined
    const rawLimit = typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined
    const limit = rawLimit !== undefined && Number.isFinite(rawLimit) ? rawLimit : undefined
    res.json(await api.listActivity(auctor, { ...(cursor ? { cursor } : {}), ...(limit !== undefined ? { limit } : {}) }))
  }))

  // GET /v1/data/datasets — the caller's datasets as the THIN `DatasetSummary[]` projection
  // (the training-run picker's contract — matches this route's pre-existing client call in
  // `lib/api.ts:listDatasets()`, unchanged: `{ datasets: DatasetSummary[] }`). Scoped to what
  // the caller may read — their own datasets UNION those shared with a Sodalitas they belong
  // to — and cursor-paginated like `GET /v1/me/runs`.
  router.get('/data/datasets', wrap(async (req, res) => {
    const auctor = await auth(req)
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined
    const rawLimit = typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined
    const limit = rawLimit !== undefined && Number.isFinite(rawLimit) ? rawLimit : undefined
    res.json(await api.listDatasetSummaries(auctor, { ...(cursor ? { cursor } : {}), ...(limit !== undefined ? { limit } : {}) }))
  }))

  // GET /v1/data/datasets/full — the caller's datasets as the FULL rich `Dataset[]` shape
  // (custody, modality, captionsets, versions) — `Datasets.tsx`'s live listing. Kept as a
  // separate route from the summary above so the existing `listDatasets()` client contract
  // stays untouched; same own-plus-team scoping, cursor-paginated identically.
  router.get('/data/datasets/full', wrap(async (req, res) => {
    const auctor = await auth(req)
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined
    const rawLimit = typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined
    const limit = rawLimit !== undefined && Number.isFinite(rawLimit) ? rawLimit : undefined
    res.json(await api.listDatasets(auctor, { ...(cursor ? { cursor } : {}), ...(limit !== undefined ? { limit } : {}) }))
  }))

  // GET /v1/data/datasets/public — the public dataset catalog: every `access.kind === 'public'`
  // dataset, scoped to nobody in particular. PUBLIC, no auth — mirrors `GET /v1/models`'s
  // catalog precedent, browsing what the platform publishes should not require an account.
  // Registered BEFORE `GET /v1/data/datasets/:id` below so Express matches this literal path
  // first; were the order reversed, `:id` would swallow `public` as an id.
  router.get('/data/datasets/public', wrap(async (req, res) => {
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined
    const rawLimit = typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined
    const limit = rawLimit !== undefined && Number.isFinite(rawLimit) ? rawLimit : undefined
    res.json(await api.listPublicDatasets({ ...(cursor ? { cursor } : {}), ...(limit !== undefined ? { limit } : {}) }))
  }))

  // GET /v1/data/datasets/:id — the single-dataset read `getDataset` has always backed with no
  // route of its own; every screen instead fetched the caller's own full list and found the id
  // client-side, which is fine for a dataset the caller owns but can never resolve one they
  // don't (a public dataset someone else made). This is that missing route: owner, team member,
  // or `access.kind === 'public'` — same three-way gate `getDataset` already resolves through.
  // Still auth-required (unlike the catalog list above) — every OTHER dataset route is, and
  // loosening that is a separate call, not a side effect of adding this one.
  router.get('/data/datasets/:id', wrap(async (req, res) => {
    const auctor = await auth(req)
    res.json({ dataset: await api.getDataset(auctor, String(req.params.id)) })
  }))

  // POST /v1/data/datasets — create a Dataset via either v1 ingestion path (Q2): a
  // `source: 'upload'` body (media already dropped via `POST /storage/uploads/sign`) or a
  // `source: 'generation'` body (media seeded from the caller's own completed Acta) — or with
  // NO media at all, by omitting `source`, leaving the dataset to be filled through the append
  // route below. The discriminant is validated server-side (CrystalApi.createDataset); a
  // `source` naming neither path 400s, as does one naming a path with nothing supplied for it.
  // An optional `teamId` shares the dataset with a Sodalitas the caller is
  // a member of (validated through the same `_memberTeam` seam projects and collections use);
  // it is stored as `Dataset.sodalitasId`.
  router.post('/data/datasets', wrap(async (req, res) => {
    const auctor = await auth(req)
    res.status(201).json({ dataset: await api.createDataset(auctor, req.body ?? {}) })
  }))

  // POST /v1/data/datasets/:id/media — contribute media to a dataset the caller owns OR is a
  // member of the team it is shared with. Same discriminated ingestion body as
  // `POST /v1/data/datasets` and the same minting path, so a dataset grows the way it was
  // seeded — and every named Actum must still be the CALLER'S OWN and completed, so a member
  // contributes their own generations and never someone else's. Each item records `addedBy`.
  // Append-only: nothing here removes, replaces or reorders media, and the response carries the
  // new `DatasetVersion` plus every captionset's recomputed coverage. The caller comes from
  // `auth(req)` and nowhere else; a non-member's dataset id 404s.
  router.post('/data/datasets/:id/media', wrap(async (req, res) => {
    const auctor = await auth(req)
    res.status(201).json({ dataset: await api.addDatasetMedia(auctor, String(req.params.id), req.body ?? {}) })
  }))

  // POST /v1/data/datasets/:id/captionsets — attach a captionset (its caption text keyed by
  // media id) to a dataset the caller owns or is a team member of. A captionset already
  // carrying the same id is replaced, so re-running a caption pass does not accumulate
  // duplicates. The caller comes from `auth(req)` and nowhere else; a non-member's dataset
  // id 404s.
  router.post('/data/datasets/:id/captionsets', wrap(async (req, res) => {
    const auctor = await auth(req)
    res.status(201).json({ dataset: await api.addCaptionset(auctor, String(req.params.id), req.body ?? {}) })
  }))

  // PATCH /v1/data/datasets/:id/captionsets/:captionsetId/captions/:mediaId — edit one caption
  // of one captionset on a dataset the caller owns or is a team member of (captionsets are
  // editable after generation). Coverage is recomputed server-side from the captions actually
  // present. The caller comes from `auth(req)`.
  router.patch('/data/datasets/:id/captionsets/:captionsetId/captions/:mediaId', wrap(async (req, res) => {
    const auctor = await auth(req)
    const body = (req.body ?? {}) as { caption?: unknown }
    const dataset = await api.setCaption(auctor, String(req.params.id), String(req.params.captionsetId), String(req.params.mediaId), body.caption)
    res.status(200).json({ dataset })
  }))

  // POST /v1/data/datasets/:id/access — publish or unpublish a dataset the caller OWNS.
  // Owner-only, same reasoning as archive below: the team overlay adds readers and
  // contributors, not a second principal who decides the set's public face. Body: { kind:
  // 'public' | 'private' }. Making a set public grants READ only (GET /v1/data/datasets/public,
  // GET /v1/data/datasets/:id, spawning a Muse session) — appending media, attaching or editing
  // a captionset still require ownership or team membership regardless. Reversible in either
  // direction; a stranger's dataset id 404s.
  router.post('/data/datasets/:id/access', wrap(async (req, res) => {
    const auctor = await auth(req)
    const kind = (req.body ?? {}) as { kind?: unknown }
    if (kind.kind !== 'public' && kind.kind !== 'private') {
      throw Errors.inputMalformed("kind must be 'public' or 'private'")
    }
    res.status(200).json({ dataset: await api.setDatasetAccess(auctor, String(req.params.id), kind.kind) })
  }))

  // POST /v1/data/datasets/:id/archive — archive a dataset the caller OWNS. Owner-only, and
  // deliberately narrower than the read/contribute gate above: the team overlay adds readers
  // and contributors, not a second principal who may retire the owner's set. It leaves both
  // list routes and every picker built on them, and becomes unusable from them. It is NOT
  // erased: `GET` still resolves it, so a Muse session's mother dataset, a session dataset
  // behind a saved piece, and a past run's lineage all keep resolving. Reversible through
  // `/restore`. Idempotent. The owner comes from `auth(req)` and nowhere else; a stranger's
  // dataset id 404s.
  router.post('/data/datasets/:id/archive', wrap(async (req, res) => {
    const auctor = await auth(req)
    res.status(200).json({ dataset: await api.archiveDataset(auctor, String(req.params.id)) })
  }))

  // POST /v1/data/datasets/:id/restore — return an archived dataset to both list routes.
  // Owner-only, like the archive it undoes. Idempotent on a dataset that is already live.
  // Owner from `auth(req)`.
  router.post('/data/datasets/:id/restore', wrap(async (req, res) => {
    const auctor = await auth(req)
    res.status(200).json({ dataset: await api.restoreDataset(auctor, String(req.params.id)) })
  }))

  // POST /v1/data/datasets/:id/media/:mediaId/archive — archive ONE media item on a dataset
  // the caller OWNS (owner-only, for the same reason the dataset archive is). The item leaves
  // the working set (the caption manifest, the decompose,
  // the summary count, Muse's fragment pool) and every captionset's coverage is recomputed
  // against the media that is left. The item itself stays on the record — caption maps and
  // fragments are keyed on its id. Reversible through `/restore`. Owner from `auth(req)`; a
  // media id naming no item on the dataset is a 400.
  router.post('/data/datasets/:id/media/:mediaId/archive', wrap(async (req, res) => {
    const auctor = await auth(req)
    const dataset = await api.archiveDatasetMedia(auctor, String(req.params.id), String(req.params.mediaId))
    res.status(200).json({ dataset })
  }))

  // POST /v1/data/datasets/:id/media/:mediaId/restore — return one archived media item to the
  // working set, recomputing every captionset's coverage against it. Owner-only, like the
  // archive it undoes. Owner from `auth(req)`.
  router.post('/data/datasets/:id/media/:mediaId/restore', wrap(async (req, res) => {
    const auctor = await auth(req)
    const dataset = await api.restoreDatasetMedia(auctor, String(req.params.id), String(req.params.mediaId))
    res.status(200).json({ dataset })
  }))

  // ── Muse sessions ─────────────────────────────────────────────────────────
  //
  // A session is a break-off of a dataset: it copies the dataset's fragments and
  // works from its own copies, so nothing a session does reaches the mother. The
  // operations here are the whole surface — spawn, list, read, turn a fragment off
  // or on, weight a fragment, record a piece with its lineage, and change what the
  // session says about a piece already recorded.
  //
  // Every one of them is owner-scoped from `auth(req)` and from nowhere else. No
  // route takes an owner, an anima id, or any other scope value from the request:
  // a session belonging to another account is reported as not found, exactly as an
  // id that never existed is.

  // POST /v1/data/muse/sessions — break a session off a dataset the caller owns.
  // Fragments are pooled dataset-wide across every media item, not from one item.
  router.post('/data/muse/sessions', wrap(async (req, res) => {
    const auctor = await auth(req)
    const body = (req.body ?? {}) as { datasetId?: unknown }
    const datasetId = typeof body.datasetId === 'string' ? body.datasetId : ''
    res.status(201).json({ session: await api.spawnMuseSession(auctor, datasetId) })
  }))

  // GET /v1/data/muse/sessions?datasetId=… — the caller's own sessions off one dataset,
  // most recently changed first. This is how a session is found again after a reload:
  // the route a session is worked in carries the dataset, so without a server-side
  // lookup a returning client can only spawn a new session and lose the old one. The
  // owner comes from `auth(req)`; `datasetId` selects the mother and nothing else.
  router.get('/data/muse/sessions', wrap(async (req, res) => {
    const auctor = await auth(req)
    const datasetId = typeof req.query.datasetId === 'string' ? req.query.datasetId : ''
    res.json({ sessions: await api.listMuseSessions(auctor, datasetId) })
  }))

  // GET /v1/data/muse/sessions/:id — the caller's own session: its floor and its ledger.
  router.get('/data/muse/sessions/:id', wrap(async (req, res) => {
    const auctor = await auth(req)
    res.json({ session: await api.getMuseSession(auctor, String(req.params.id)) })
  }))

  // PATCH /v1/data/muse/sessions/:id/floor/enabled — take a fragment out of the draw,
  // or put it back. The fragment is named in the BODY by `{ category, text }`, not in
  // the path: a fragment's identity is `category:text`, which is free text and is not
  // safe to carry as a path segment.
  router.patch('/data/muse/sessions/:id/floor/enabled', wrap(async (req, res) => {
    const auctor = await auth(req)
    const body = (req.body ?? {}) as { category?: unknown; text?: unknown; enabled?: unknown }
    const session = await api.setMuseFragmentEnabled(auctor, String(req.params.id), body, body.enabled)
    res.json({ session })
  }))

  // PATCH /v1/data/muse/sessions/:id/floor/weight — weight a fragment against its
  // pool-mates. Clamped server-side to the sampler's bounds.
  router.patch('/data/muse/sessions/:id/floor/weight', wrap(async (req, res) => {
    const auctor = await auth(req)
    const body = (req.body ?? {}) as { category?: unknown; text?: unknown; weight?: unknown }
    const session = await api.setMuseFragmentWeight(auctor, String(req.params.id), body, body.weight)
    res.json({ session })
  }))

  // POST /v1/data/muse/sessions/:id/floor/fragments — put a fragment the user wrote on
  // the floor, in the draw at even odds. The un-metered way to widen a floor: a piece is
  // assembled from fragments already on the floor, so re-entering one reweights the floor
  // without widening it, and nothing else short of decomposing more source images puts a
  // phrase there that was not there before. Nothing is spent — no model, no key, no quote.
  // The fragment is named in the BODY by `{ category, text }` for the same reason the two
  // PATCHes above are: that identity is free text.
  router.post('/data/muse/sessions/:id/floor/fragments', wrap(async (req, res) => {
    const auctor = await auth(req)
    const body = (req.body ?? {}) as { category?: unknown; text?: unknown }
    res.status(201).json({ session: await api.addMuseFragment(auctor, String(req.params.id), body) })
  }))

  // PATCH /v1/data/muse/sessions/:id/setup — what the session fires its draw THROUGH:
  // the flow, the run shape, the model stack and the standing affix. Stored so that a
  // reload comes back to the engine the user assembled rather than to the screen's
  // defaults, which is the same server-side-and-owner-scoped rule the floor already
  // follows. Replaces the setup wholesale — a setup is one picture of what is about to
  // fire, and a merge would leave a model on the stack after it was taken off.
  //
  // NOTHING IS SPENT and nothing is fired: no run, no quote, no model call. The body
  // carries DATA ONLY; the owner is `auth(req)` and the session is the path's.
  //
  // The infinite-mode acknowledgement is NOT part of a setup and cannot be written
  // through here — a body carrying one is stored without it, so a resume is never
  // pre-consented to a run that has no count to stop it.
  router.patch('/data/muse/sessions/:id/setup', wrap(async (req, res) => {
    const auctor = await auth(req)
    const session = await api.setMuseSetup(auctor, String(req.params.id), req.body ?? {})
    res.json({ session })
  }))

  // POST /v1/data/muse/sessions/:id/steer — interpret a short instruction against the
  // session's floor and return a PROPOSAL. Nothing is applied here: the response is what the
  // consent sheet is rendered from, every pill in it is vetoable, and the floor moves only
  // when the user confirms and the app calls the two floor routes above. The session is
  // resolved for the authenticated caller and its floor is passed INLINE into the run — the
  // interpreter never receives a session id and reads no session. Metered: one chat call.
  router.post('/data/muse/sessions/:id/steer', wrap(async (req, res) => {
    const auctor = await auth(req)
    const body = (req.body ?? {}) as { instruction?: unknown }
    res.json(await api.steerMuseSession(auctor, String(req.params.id), body))
  }))

  // POST /v1/data/muse/sessions/:id/kept — keep one rolled prompt against the session.
  // Rolling is free and a roll in progress is uncommitted work, so a report and the edits
  // made to it stay in the client; KEEPING is the explicit act and is what gets a server
  // home. Append-only: keeping the same prompt twice stores it twice, and there is no
  // route here that removes one. NOTHING IS SPENT and nothing is fired — the body carries
  // a prompt and its paid/free verdict, the owner is `auth(req)`, and the session is the
  // path's.
  router.post('/data/muse/sessions/:id/kept', wrap(async (req, res) => {
    const auctor = await auth(req)
    const body = (req.body ?? {}) as { prompt?: unknown; paid?: unknown }
    res.status(201).json({ session: await api.keepMuseRoll(auctor, String(req.params.id), body) })
  }))

  // POST /v1/data/muse/sessions/:id/pieces — append a piece to the session's ledger with
  // the fragments that produced it. The lineage is recorded now because it is not
  // recoverable later: the floor moves and the fragment list is rebuilt.
  router.post('/data/muse/sessions/:id/pieces', wrap(async (req, res) => {
    const auctor = await auth(req)
    res.status(201).json({ session: await api.recordMusePiece(auctor, String(req.params.id), req.body ?? {}) })
  }))

  // PATCH /v1/data/muse/sessions/:id/pieces/:runId — change what the session says about a
  // piece already in its ledger: its reaction, its dismissal, or both. A reaction is given
  // after the piece exists, so it cannot ride the record call; this is the route that
  // reaches a recorded piece. Lineage, run and roll index are fixed at record time and are
  // not patchable here.
  router.patch('/data/muse/sessions/:id/pieces/:runId', wrap(async (req, res) => {
    const auctor = await auth(req)
    const session = await api.updateMusePiece(auctor, String(req.params.id), String(req.params.runId), req.body ?? {})
    res.json({ session })
  }))

  // POST /v1/data/muse/sessions/:id/pieces/:runId/save — put a piece back into the set. Its
  // media joins the session's OWN dataset (minted on the first save, appended to after that)
  // carrying the lineage that produced it as that item's fragments; the mother dataset is
  // never written. NOTHING IS SPENT and no job runs: a generated piece was composed from
  // fragments, so its recorded lineage is already its tagging and a save is a set insertion
  // rather than a caption or decompose pass. The body is empty — the piece names its run, and
  // the media url is resolved server-side from that run. Owner from `auth(req)`.
  router.post('/data/muse/sessions/:id/pieces/:runId/save', wrap(async (req, res) => {
    const auctor = await auth(req)
    const session = await api.saveMusePiece(auctor, String(req.params.id), String(req.params.runId))
    res.status(201).json({ session })
  }))

  // POST /v1/data/muse/sessions/:id/promote — the session becomes a DRAFT collection: its
  // enabled floor becomes the trait grid, its flow and its standing affix and model triggers
  // become the base the grid expands. The session is read and never written, so it survives
  // the promotion unchanged. NOTHING IS SPENT: a draft is not dispatched, and the supply,
  // review policy and DNA rule the session cannot supply are finished in the collection
  // funnel, where firing enforces completeness.
  //
  // The body carries at most a `nomen`, and a name is a label. Every reference the new
  // collection holds — its flow, its grid, its funding identity — is derived server-side
  // from the session the authenticated caller owns; nothing in the body can name an owner,
  // a team or a grid.
  router.post('/data/muse/sessions/:id/promote', wrap(async (req, res) => {
    const auctor = await auth(req)
    const body = (req.body ?? {}) as { nomen?: unknown }
    const collection = await api.promoteMuseSession(auctor, String(req.params.id), { nomen: body.nomen })
    res.status(201).json({ collection })
  }))

  // GET /v1/me — the caller's account settings: appearance + generation defaults + bindings.
  router.get('/me', wrap(async (req, res) => {
    res.json(await api.getMe(await auth(req)))
  }))

  // POST /v1/me/export — GDPR self-export: assemble the CALLER'S OWN data into a downloadable
  // JSON bundle and return a short-lived, unguessable signed GET URL to it. Strictly self-scoped
  // (the assembler only ever queries the caller's own owner key). 503 when R2 isn't configured.
  router.post('/me/export', wrap(async (req, res) => {
    if (!deps.exporter) {
      res.status(503).json({ error: { code: 'internal.error', message: 'account export unavailable' } })
      return
    }
    const auctor = await auth(req)
    res.status(200).json(await deps.exporter.exportForCaller(auctor))
  }))

  // DELETE /v1/me — GDPR Art. 17 right-to-erasure (noema-025). Pseudonymize-and-tombstones the
  // CALLER'S OWN account (self-only: auth = the caller's key, so a caller can never erase another
  // owner). Auth resolves FIRST (noema-178): an unauthenticated caller gets the standard `401`
  // and never learns the feature-state. Only once authenticated is the `ERASURE_ENABLED` flag
  // checked (default OFF, counsel-gated in production): flag off → `501 Not Implemented`. Returns
  // a TRUTHFUL receipt when enabled — it reports the retained-anonymized financial ledger, never
  // "everything deleted". Destructive + irreversible: the frontend fronts it with a
  // typed-confirmation gate.
  router.delete('/me', wrap(async (req, res) => {
    const auctor = await auth(req)
    if (!deps.erasureEnabled) {
      throw Errors.erasureNotImplemented()
    }
    res.status(200).json(await api.eraseMe(auctor))
  }))

  // PUT /v1/me/appearance — replace the caller's presentation skin (Profile).
  router.put('/me/appearance', wrap(async (req, res) => {
    res.json({ appearance: await api.setAppearance(await auth(req), req.body ?? {}) })
  }))

  // PUT /v1/me/generatio — replace the caller's cross-cutting generation defaults (Preferences).
  router.put('/me/generatio', wrap(async (req, res) => {
    res.json({ generatio: await api.setGeneratio(await auth(req), req.body ?? {}) })
  }))

  // POST /v1/me/attestation — record the caller's one-time 18+ self-attestation (noema-091). A
  // self-declared click-through fact (NOT KYC/ID verification); required on file before spicyMode may
  // be enabled. Anon-capable (keyed by AuctorKey — anon Bursa/commitment and named Anima both work).
  router.post('/me/attestation', wrap(async (req, res) => {
    res.status(200).json({ attestation: await api.recordAttestation(await auth(req)) })
  }))

  // PUT/DELETE /v1/me/secrets/:provider — connect/disconnect a BYO gated-origin credential
  // (Civitai/HF token). Auth required (identified OR anonymous purse). The token is sealed at
  // rest at once and NEVER echoed back; a purse caller receives a deanonymization warning.
  router.put('/me/secrets/:provider', wrap(async (req, res) => {
    const auctor = await auth(req)
    const { token, idleDays } = req.body ?? {}
    res.json(await api.putSecret(auctor, String(req.params.provider), token, idleDays))
  }))
  router.delete('/me/secrets/:provider', wrap(async (req, res) => {
    const auctor = await auth(req)
    res.json(await api.removeSecret(auctor, String(req.params.provider)))
  }))

  // GET/PUT /v1/me/affines/:modusId — the caller's per-flow input defaults.
  router.get('/me/affines/:modusId', wrap(async (req, res) => {
    res.json({ affines: await api.getAffines(await auth(req), String(req.params.modusId)) })
  }))
  router.put('/me/affines/:modusId', wrap(async (req, res) => {
    res.json({ affines: await api.setAffines(await auth(req), String(req.params.modusId), (req.body ?? {}).affines ?? {}) })
  }))

  // POST /v1/studios — lease a hosted studio (auth required). Returns a `provisioning`
  // handle immediately; the pod boots in the background (observe via GET /v1/studios/:id
  // or the optional webhookUrl). maxImpetus IS the session budget — Census drain-
  // terminates the studio at the ceiling (the watchdog).
  router.post(
    '/studios',
    wrap(async (req, res) => {
      const auctor = await auth(req)
      const { fundamentumId, models, warmMs, maxImpetus, runtime } = req.body ?? {}
      const webhookUrl = req.body?.options?.webhookUrl ?? req.body?.webhookUrl
      const studio = await api.provisionStudio(auctor, {
        ...(fundamentumId ? { fundamentumId } : {}),
        ...(Array.isArray(models) ? { models } : {}),
        ...(warmMs !== undefined ? { warmMs } : {}),
        ...(maxImpetus !== undefined ? { maxImpetus } : {}),
        ...(runtime ? { runtime } : {}),
        ...(typeof webhookUrl === 'string' && webhookUrl ? { webhookUrl } : {}),
      })
      res.status(201).json({ studio })
    }),
  )

  // GET /v1/studios — the caller's LIVE studios (auth required): in-flight and warm ones,
  // not closed sessions or reaped pods. A studio that has since gone terminal drops off this
  // list but stays readable by id below.
  router.get(
    '/studios',
    wrap(async (req, res) => {
      const auctor = await auth(req)
      res.json({ studios: await api.listStudios(auctor) })
    }),
  )

  // GET /v1/studios/:id — one of the caller's studios (owner-scoped; poll for ready).
  // Ownership is the only gate: a studio the caller hosts reads back in every state,
  // terminal included, so an id they are shown elsewhere (GET /v1/me/status, and the
  // terminal view DELETE returns) is one they can address here. A stranger's read is
  // `not_found.studio`, never `forbidden` — same convention as DELETE below.
  router.get(
    '/studios/:id',
    wrap(async (req, res) => {
      const auctor = await auth(req)
      res.json({ studio: await api.getStudio(auctor, String(req.params.id)) })
    }),
  )

  // DELETE /v1/studios/:id — end the lease deliberately (owner-scoped, idempotent):
  // terminate the pod, close the session. Double-DELETE returns the same terminal
  // view, 200; a stranger's DELETE gets not_found.studio.
  router.delete(
    '/studios/:id',
    wrap(async (req, res) => {
      const auctor = await auth(req)
      res.json({ studio: await api.releaseStudio(auctor, String(req.params.id)) })
    }),
  )

  // POST /v1/sessions/tee — provision a private compute session. Returns immediately with
  // status='provisioning'; poll GET /v1/sessions/tee/:id until status='ready', then use
  // serverPublicKey + endpoint to configure WASM WireGuard in the browser.
  router.post(
    '/sessions/tee',
    wrap(async (req, res) => {
      const auctor = await auth(req)
      const { gpuClass, maxImpetus, wgClientPublicKey } = req.body ?? {}
      if (!wgClientPublicKey) {
        res.status(400).json({ error: { code: 'bad_request', message: 'wgClientPublicKey is required' } })
        return
      }
      const session = await api.provisionTeeSession(auctor, {
        ...(gpuClass ? { gpuClass } : {}),
        ...(maxImpetus !== undefined ? { maxImpetus } : {}),
        wgClientPublicKey,
      })
      res.status(201).json({ session })
    }),
  )

  // GET /v1/sessions/tee/:id — poll session status. When status='ready', response includes
  // serverPublicKey, endpoint, and tunnelIp for WireGuard client configuration.
  router.get(
    '/sessions/tee/:id',
    wrap(async (req, res) => {
      const auctor = await auth(req)
      res.json({ session: await api.getTeeSession(auctor, String(req.params.id)) })
    }),
  )

  // DELETE /v1/sessions/tee/:id — end session and terminate the RunPod pod.
  router.delete(
    '/sessions/tee/:id',
    wrap(async (req, res) => {
      const auctor = await auth(req)
      await api.endTeeSession(auctor, String(req.params.id))
      res.status(204).end()
    }),
  )

  // GET /v1/sessions/tee/:id/wglog — proxy the pod's token-gated /debug/wglog over the
  // platform. Avoids CORS, and the per-session runner token (which the pod requires
  // since the debug endpoints were gated) stays server-side.
  router.get(
    '/sessions/tee/:id/wglog',
    wrap(async (req, res) => {
      const auctor = await auth(req)
      const text = await api.fetchTeeWglog(auctor, String(req.params.id),
        req.query.tail ? String(req.query.tail) : undefined)
      if (text === null) {
        res.status(404).json({ error: { code: 'not_found', message: 'session has no proxy URL yet' } })
        return
      }
      res.setHeader('Content-Type', 'text/plain')
      res.send(text)
    }),
  )

  return router
}
