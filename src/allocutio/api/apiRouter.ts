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

import type { Run, Collection } from './types.js'
import type { AuctorKey } from '../../flow/types.js'
import type { InvokeTarget, InvokeOpts, ModelCard, SaveFlowOpts, StatusView, ProvisionStudioOpts, StudioView, ProvisionTeeSessionOpts, TeeSessionView, CollectOpts } from './CrystalApi.js'
import type { RarityReport } from '../../crystal/rarityReport.js'
import { ApiError, Errors } from './errors.js'
import { makeLogger } from '../../lib/logger.js'
import { credentialsFromHeaders, type Credentials } from './IdentityResolver.js'
import { API_CONTRACT } from './apiContract.js'
import { generateOpenApi } from './docgen.js'
import type { RunEventHub } from './RunEventHub.js'

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
  listFlows(): Promise<unknown[]>
  describeFlow(id: string): Promise<unknown>
  quote(
    auctor: AuctorKey,
    target: InvokeTarget,
    aditus: Record<string, unknown>,
  ): Promise<{ impetus: string }>
  listFundamenta(): Promise<Array<{ id: string; nomen?: string; versio: string; runtime?: string; imageId: string; imageVersion: string; vramGb?: number }>>
  listModels(filter?: { genus?: string; basis?: string; fundamentumId?: string; trigger?: string; q?: string; limit?: number }): Promise<ModelCard[]>
  saveFlow(auctor: AuctorKey, opts: SaveFlowOpts): Promise<{ id: string }>
  bind(auctor: AuctorKey, verb: string, modusId: string): Promise<{ verb: string; modusId: string }>
  status(auctor: AuctorKey): Promise<StatusView>
  provisionStudio(auctor: AuctorKey, opts: ProvisionStudioOpts): Promise<StudioView>
  getStudio(auctor: AuctorKey, studioId: string): Promise<StudioView>
  listStudios(auctor: AuctorKey): Promise<StudioView[]>
  provisionTeeSession(auctor: AuctorKey, opts: ProvisionTeeSessionOpts): Promise<TeeSessionView>
  getTeeSession(auctor: AuctorKey, sessionId: string): Promise<TeeSessionView>
  endTeeSession(auctor: AuctorKey, sessionId: string): Promise<void>
  collect(auctor: AuctorKey, opts: CollectOpts): Promise<Collection>
  getCollection(auctor: AuctorKey, id: string): Promise<Collection>
  getCollectionRarity(auctor: AuctorKey, id: string): Promise<RarityReport>
  listCollections(auctor: AuctorKey): Promise<Collection[]>
  pauseCollection(auctor: AuctorKey, id: string): Promise<Collection>
  resumeCollection(auctor: AuctorKey, id: string): Promise<Collection>
  cancelCollection(auctor: AuctorKey, id: string): Promise<Collection>
  approveCollectionPiece(auctor: AuctorKey, id: string, actumId: string): Promise<void>
  rejectCollectionPiece(auctor: AuctorKey, id: string, actumId: string): Promise<void>
}

/** The slice of IdentityResolver this router needs. */
export interface Identity {
  resolve(creds: Credentials): Promise<AuctorKey>
}

export function createApiRouter(deps: { api: ApiFacade; identity: Identity; hub?: RunEventHub }): Router {
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
    const { modusId, total, tractus, aditusBase, concurrentia, nomen, dna } = req.body ?? {}
    res.status(200).json({ collection: await api.collect(auctor, { modusId, total, tractus, aditusBase, concurrentia, nomen, dna }) })
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

  // GET /v1/sessions/tee/:id/wglog — proxy /debug/wglog from the pod over the platform.
  // Avoids CORS: browser calls this instead of fetching the RunPod URL directly.
  router.get(
    '/sessions/tee/:id/wglog',
    wrap(async (req, res) => {
      const auctor = await auth(req)
      const session = await api.getTeeSession(auctor, String(req.params.id))
      if (!session.proxyUrl) {
        res.status(404).json({ error: { code: 'not_found', message: 'session has no proxy URL yet' } })
        return
      }
      const httpBase = session.proxyUrl
        .replace(/^socks5\+wss:\/\//, 'https://')
        .replace(/^socks5\+ws:\/\//, 'http://')
        .replace(/\?.*$/, '')
        .replace(/\/$/, '')
      const tail = req.query.tail ? `?tail=${encodeURIComponent(String(req.query.tail))}` : ''
      const podRes = await fetch(httpBase + '/debug/wglog' + tail)
      const text = await podRes.text()
      res.setHeader('Content-Type', 'text/plain')
      res.send(text)
    }),
  )

  return router
}
