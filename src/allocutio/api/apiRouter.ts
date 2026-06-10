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

import type { Run } from './types.js'
import type { AuctorKey } from '../../flow/types.js'
import type { InvokeTarget, InvokeOpts } from './CrystalApi.js'
import { ApiError, Errors } from './errors.js'
import { credentialsFromHeaders, type Credentials } from './IdentityResolver.js'
import { API_CONTRACT } from './apiContract.js'
import { generateOpenApi } from './docgen.js'

/** The slice of CrystalApi this router needs. Mirrors its method signatures. */
export interface ApiFacade {
  invokeFlow(
    auctor: AuctorKey,
    target: InvokeTarget,
    aditus: Record<string, unknown>,
    opts?: InvokeOpts,
  ): Promise<Run>
  getRun(id: string): Promise<Run>
  listFlows(): Promise<unknown[]>
  describeFlow(id: string): Promise<unknown>
}

/** The slice of IdentityResolver this router needs. */
export interface Identity {
  resolve(creds: Credentials): Promise<AuctorKey>
}

export function createApiRouter(deps: { api: ApiFacade; identity: Identity }): Router {
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
          res.status(500).json({ error: Errors.internal().toBody() })
        }
      }
    }

  /** Resolve the caller's identity from the request, or throw an ApiError. */
  const auth = (req: Request): Promise<AuctorKey> =>
    identity.resolve(
      credentialsFromHeaders(req.headers as Record<string, string | undefined>, req.body),
    )

  // POST /v1/runs — invoke a flow.
  router.post(
    '/runs',
    wrap(async (req, res) => {
      const auctor = await auth(req)
      const { modusId, verb, aditus, pinnedModels, computeStrategy, gpuClass } = req.body ?? {}
      const run = await api.invokeFlow(
        auctor,
        { modusId, verb },
        aditus ?? {},
        { pinnedModels, computeStrategy, gpuClass },
      )
      res.status(200).json({ run })
    }),
  )

  // GET /v1/runs/:id — fetch a run (requires a caller identity).
  router.get(
    '/runs/:id',
    wrap(async (req, res) => {
      await auth(req)
      res.json({ run: await api.getRun(String(req.params.id)) })
    }),
  )

  // GET /v1/openapi.json — the live, self-describing contract (no auth). Generated
  // from the same API_CONTRACT the committed docs + drift-check use, so it can't lag.
  const OPENAPI = generateOpenApi(API_CONTRACT)
  router.get('/openapi.json', (_req, res) => { res.json(OPENAPI) })

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

  return router
}
