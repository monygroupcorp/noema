// =============================================================================
// apiContract — the single declarative source of truth for the `/v1` surface.
// =============================================================================
//
// ONE source of truth (this file) → everything else is GENERATED from it:
// the OpenAPI document, the markdown reference, the served `GET /v1/openapi.json`.
// Hand-maintaining parallel copies is forbidden; a CI drift-check
// (`gen:api-docs` + `git diff --exit-code`) fails the build if the committed
// docs diverge from what this contract produces.
//
// Pure data — no behaviour, no I/O. The route handlers in `apiRouter.ts` are the
// runtime implementation of the operations described here; this file is their
// machine-readable description. Keep the two in lock-step: a route added/changed
// without updating this contract (and regenerating docs) breaks the gate.
//
// The DYNAMIC catalog (which flows/models exist) is deliberately NOT here — that
// is discovered live via `GET /v1/flows` / `GET /v1/flows/:id`. This contract
// describes only the STATIC surface: which operations exist + their I/O shapes.
//
// The data itself lives in `apiContract/` — one file per resource domain (runs,
// flows, datasets, muse, …) — and is recombined below in the exact order the
// surface used to declare it. Split for size, not for shape: nothing here
// changes what a caller sees.
// =============================================================================

export type { JsonSchema, QueryParamSpec, RouteSpec, ErrorCodeSpec, ApiContract } from './apiContract/types'

import type { ApiContract } from './apiContract/types'
import { RunSchema, runsCoreRoutes } from './apiContract/runs'
import { systemRoutes } from './apiContract/system'
import { flowsAndQuoteRoutes, flowManageRoutes, myFlowsRoute } from './apiContract/flows'
import { fundamentaRoutes, modelsRoutes, modelAdminRoutes } from './apiContract/fundamentaModels'
import { depositPaymentsRoutes } from './apiContract/economy'
import { meStatusActivityRoutes } from './apiContract/meStatusActivity'
import { datasetsRoutes } from './apiContract/datasets'
import { museRoutes } from './apiContract/muse'
import { meProfileRoutes } from './apiContract/meProfile'
import { studiosRoutes } from './apiContract/studios'
import { collectionsRoutes } from './apiContract/collections'
import { editionsFeedRoutes } from './apiContract/editionsFeed'
import { teamsRoutes } from './apiContract/teams'
import { projectsRoutes } from './apiContract/projects'
import { tabulaeRoutes } from './apiContract/tabulae'
import { ErrorEnvelopeSchema, API_ERROR_CODES } from './apiContract/errors'

export const API_CONTRACT: ApiContract = {
  version: 'v1',
  routes: [
    ...runsCoreRoutes,
    ...systemRoutes,
    ...flowsAndQuoteRoutes,
    ...fundamentaRoutes,
    ...modelsRoutes,
    ...depositPaymentsRoutes,
    ...modelAdminRoutes,
    ...flowManageRoutes,
    ...meStatusActivityRoutes,
    ...datasetsRoutes,
    ...museRoutes,
    ...meProfileRoutes,
    ...studiosRoutes,
    ...collectionsRoutes,
    ...editionsFeedRoutes,
    ...teamsRoutes,
    ...projectsRoutes,
    ...tabulaeRoutes,
    ...myFlowsRoute,
  ],
  errorCodes: API_ERROR_CODES,
}

// Schemas exported for the doc generator to reference by name in OpenAPI components.
export const SCHEMAS = {
  Run: RunSchema,
  Error: ErrorEnvelopeSchema,
} as const
