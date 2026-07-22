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

import express, { type Request, type Response, type Router } from 'express'

import type { Run, Collection, Team, Edition, FeedItem, Project, RunsPage } from './types.js'
import type { AuctorKey } from '../../flow/types.js'
import type { FeedFilter } from '../../types/editio.js'
import type { InvokeTarget, InvokeOpts, ModelCard, SaveFlowOpts, StatusView, ProvisionStudioOpts, StudioView, ProvisionTeeSessionOpts, TeeSessionView, CollectOpts, PublishOpts, DepositConfig, DepositQuote, MyDeposit } from './CrystalApi.js'
import type { RarityReport } from '../../crystal/rarityReport.js'
import { ApiError, Errors } from './errors.js'
import { makeLogger } from '../../lib/logger.js'
import { credentialsFromHeaders, type Credentials } from './IdentityResolver.js'
import { API_CONTRACT } from './apiContract.js'
import { generateOpenApi } from './docgen.js'
import type { RunEventHub } from './RunEventHub.js'
import type { MeExporter } from '../../crystal/MeExporter.js'
import type { Tabula } from '../../types/tabula.js'

const log = makeLogger('api:router')

/** The slice of CrystalApi this router needs. Mirrors its method signatures. */
export interface ApiFacade {
  invokeFlow(
    auctor: AuctorKey,
    target: InvokeTarget,
    aditus: Record<string, unknown>,
    opts?: InvokeOpts,
  ): Promise<Run>
  getRun(auctor: AuctorKey, id: string): Promise<Run>
  listRuns(auctor: AuctorKey, opts: import('./CrystalApi.js').ListRunsOpts): Promise<RunsPage>
  listFlows(): Promise<unknown[]>
  describeFlow(id: string): Promise<unknown>
  quote(
    auctor: AuctorKey,
    target: InvokeTarget,
    aditus: Record<string, unknown>,
  ): Promise<{ impetus: string }>
  listFundamenta(): Promise<Array<{ id: string; nomen?: string; versio: string; runtime?: string; imageId: string; imageVersion: string; vramGb?: number }>>
  listModels(filter?: { genus?: string; basis?: string; fundamentumId?: string; trigger?: string; q?: string; limit?: number }): Promise<ModelCard[]>
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
  getDataset(auctor: AuctorKey, id: string): Promise<import('../../types/dataset.js').Dataset>
  createDataset(auctor: AuctorKey, input: import('../../types/dataset.js').CreateDatasetInput): Promise<import('../../types/dataset.js').Dataset>
  publish(auctor: AuctorKey, opts: PublishOpts): Promise<Edition>
  getEdition(auctor: AuctorKey, id: string): Promise<Edition>
  feed(filter?: FeedFilter): Promise<FeedItem[]>
  retractEdition(auctor: AuctorKey, id: string): Promise<Edition>
  listHeldEditions(auctor: AuctorKey): Promise<Edition[]>
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
  createCheckout(auctor: AuctorKey, opts: { packId: string; successUrl?: string; cancelUrl?: string }): Promise<{ url: string; sessionId: string }>
  handleStripeWebhook(input: { rawBody: string; signature?: string }): Promise<{ status: number; body: { received: boolean; credited?: string; message?: string } }>
}

/** The slice of IdentityResolver this router needs. */
export interface Identity {
  resolve(creds: Credentials): Promise<AuctorKey>
}

export function createApiRouter(deps: { api: ApiFacade; identity: Identity; hub?: RunEventHub; exporter?: MeExporter }): Router {
  const { api, identity } = deps
  const router = express.Router()

  /**
   * Async route wrapper: a thrown `ApiError` → its `httpStatus` + `{ error }`
   * body; anything else → 500 `internal.error`.
   */
  const wrap = (fn: (req: Request, res: Response) => Promise<void>) =>
    async (req: Request, res: Response): Promise<void> => {
      try {
        await fn(req, res)
      } catch (err) {
        if (err instanceof ApiError) {
          res.status(err.httpStatus).json({ error: err.toBody() })
        } else {
          // Unexpected — log it (otherwise the masked `internal.error` is invisible in the logs).
          log.error('unhandled API error', { method: req.method, path: req.path, error: String((err as Error)?.stack ?? err) })
          res.status(500).json({ error: Errors.internal().toBody() })
        }
      }
    }

  /** Resolve the caller's identity from the request, or throw an ApiError.
   *  bursaToken in body or x-bursa-token header short-circuits to anonymous bursa identity. */
  const auth = (req: Request): Promise<AuctorKey> => {
    const bursaToken = req.body?.bursaToken ?? (req.headers['x-bursa-token'] as string | undefined)
    if (bursaToken) return Promise.resolve({ bursaToken })
    return identity.resolve(
      credentialsFromHeaders(req.headers as Record<string, string | undefined>, req.body),
    )
  }

  // POST /v1/runs — invoke a flow.
  router.post(
    '/runs',
    wrap(async (req, res) => {
      const { modusId, verb, aditus, pinnedModels, computeStrategy, gpuClass, maxImpetus, studioId } = req.body ?? {}
      const auctor = await auth(req)
      const by = 'bursaToken' in auctor ? auctor : undefined
      const run = await api.invokeFlow(
        auctor,
        { modusId, verb },
        aditus ?? {},
        { pinnedModels, computeStrategy, gpuClass, ...(maxImpetus !== undefined ? { maxImpetus } : {}), ...(studioId ? { studioId } : {}), ...(by ? { by } : {}) },
      )
      const webhookUrl = req.body?.options?.webhookUrl
      if (deps.hub && typeof webhookUrl === 'string' && webhookUrl.length > 0) {
        deps.hub.setWebhook(run.id, webhookUrl)
      }
      res.status(200).json({ run })
    }),
  )

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

    // Initial snapshot frame.
    res.write('data: ' + JSON.stringify({ kind: 'snapshot', run }) + '\n\n')

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
    const { modusId, total, tractus, aditusBase, concurrentia, nomen, dna, reviewEnabled, draft, teamId } = req.body ?? {}
    res.status(200).json({ collection: await api.collect(auctor, { modusId, total, tractus, aditusBase, concurrentia, nomen, dna, reviewEnabled, draft, teamId }) })
  }))

  // PATCH /v1/collectiones/:id/tractus — edit a DRAFT's trait axes/values/rules
  // (the garden + rules authoring write). Re-derives provenance; frozen once fired.
  router.patch('/collectiones/:id/tractus', wrap(async (req, res) => {
    const { tractus } = req.body ?? {}
    res.json({ collection: await api.patchCollectionTractus(await auth(req), String(req.params.id), tractus) })
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

  // POST /v1/editiones/:id/retract — unpublish where the destination allows it (author-scoped).
  router.post('/editiones/:id/retract', wrap(async (req, res) => {
    res.json({ edition: await api.retractEdition(await auth(req), String(req.params.id)) })
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
  // GET /v1/me/projects — list the caller's projects (owner-scoped, identified only).
  router.get('/me/projects', wrap(async (req, res) => {
    res.json({ projects: await api.listProjects(await auth(req)) })
  }))

  // POST /v1/me/projects — create a project { name, desc?, glyph?, color?, teamId? }.
  router.post('/me/projects', wrap(async (req, res) => {
    const { name, desc, glyph, color, teamId } = req.body ?? {}
    res.status(201).json({ project: await api.createProject(await auth(req), { name, desc, glyph, color, teamId }) })
  }))

  // GET /v1/me/projects/:id — fetch one owned project (404 if not the owner).
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
  router.post('/me/projects/:id/holdings', wrap(async (req, res) => {
    const { kind, assetId } = req.body ?? {}
    res.json({ project: await api.fileAsset(await auth(req), String(req.params.id), String(kind), String(assetId)) })
  }))

  // DELETE /v1/me/projects/:id/holdings/:kind/:assetId — unfile an asset from a project.
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
      const { genus, basis, fundamentumId, trigger, q, limit } = req.query as Record<string, string | undefined>
      const filter: { genus?: string; basis?: string; fundamentumId?: string; trigger?: string; q?: string; limit?: number } = {}
      if (genus !== undefined) filter.genus = genus
      if (basis !== undefined) filter.basis = basis
      if (fundamentumId !== undefined) filter.fundamentumId = fundamentumId
      if (trigger !== undefined) filter.trigger = trigger
      if (q !== undefined) filter.q = q
      if (limit !== undefined) filter.limit = Number(limit)
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

  // GET /v1/data/datasets — the caller's datasets as the THIN `DatasetSummary[]` projection
  // (the training-run picker's contract — matches this route's pre-existing client call in
  // `lib/api.ts:listDatasets()`, unchanged: `{ datasets: DatasetSummary[] }`). Owner-scoped,
  // cursor-paginated like `GET /v1/me/runs`.
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
  // stays untouched; owner-scoped, cursor-paginated identically.
  router.get('/data/datasets/full', wrap(async (req, res) => {
    const auctor = await auth(req)
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined
    const rawLimit = typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined
    const limit = rawLimit !== undefined && Number.isFinite(rawLimit) ? rawLimit : undefined
    res.json(await api.listDatasets(auctor, { ...(cursor ? { cursor } : {}), ...(limit !== undefined ? { limit } : {}) }))
  }))

  // POST /v1/data/datasets — create a Dataset via either v1 ingestion path (Q2): a
  // `source: 'upload'` body (media already dropped via `POST /storage/uploads/sign`) or a
  // `source: 'generation'` body (media seeded from the caller's own completed Acta). The
  // discriminant is validated server-side (CrystalApi.createDataset); a body matching
  // neither shape 400s.
  router.post('/data/datasets', wrap(async (req, res) => {
    const auctor = await auth(req)
    res.status(201).json({ dataset: await api.createDataset(auctor, req.body ?? {}) })
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

  // PUT /v1/me/appearance — replace the caller's presentation skin (Profile).
  router.put('/me/appearance', wrap(async (req, res) => {
    res.json({ appearance: await api.setAppearance(await auth(req), req.body ?? {}) })
  }))

  // PUT /v1/me/generatio — replace the caller's cross-cutting generation defaults (Preferences).
  router.put('/me/generatio', wrap(async (req, res) => {
    res.json({ generatio: await api.setGeneratio(await auth(req), req.body ?? {}) })
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

  // GET /v1/studios — the caller's live studios (auth required).
  router.get(
    '/studios',
    wrap(async (req, res) => {
      const auctor = await auth(req)
      res.json({ studios: await api.listStudios(auctor) })
    }),
  )

  // GET /v1/studios/:id — one of the caller's studios (owner-scoped; poll for ready).
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
