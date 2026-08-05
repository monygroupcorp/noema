// =============================================================================
// MCP tool handler logic — pure async functions over CrystalApi
// =============================================================================
//
// Each function maps directly to one MCP tool. They are extracted here (not
// inlined in the server registration) so they can be unit-tested without any
// transport plumbing.
//
// A function accepting `auctor` enforces auth itself so that the router can
// always resolve auth optionally and let public tools (list, describe) proceed
// unauthenticated.
// =============================================================================

import type { CrystalApi, SaveFlowOpts, CollectOpts, ListRunsOpts } from '../CrystalApi.js'
import type { AuctorKey } from '../../../flow/types.js'
import type { IntelligensGenus } from '../../../types/intelligendi.js'
import { ApiError } from '../errors.js'

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export type McpResult = {
  content: { type: 'text'; text: string }[]
  isError?: boolean
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function ok(x: unknown): McpResult {
  return { content: [{ type: 'text', text: JSON.stringify(x, null, 2) }] }
}

export function errResult(code: string, message: string): McpResult {
  return {
    isError: true,
    content: [{ type: 'text', text: `${code}: ${message}` }],
  }
}

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

export interface RunFlowArgs {
  modusId?: string
  verb?: string
  aditus?: Record<string, unknown>
  pinnedModels?: unknown[]
  computeStrategy?: string
  gpuClass?: string
  maxImpetus?: string
  studioId?: string
}

export async function runFlowTool(
  api: CrystalApi,
  auctor: AuctorKey | undefined,
  args: RunFlowArgs,
): Promise<McpResult> {
  if (!auctor) return errResult('auth.missing', 'authentication required')
  try {
    const run = await api.invokeFlow(
      auctor,
      { modusId: args.modusId, verb: args.verb },
      args.aditus ?? {},
      {
        pinnedModels: args.pinnedModels as never,
        computeStrategy: args.computeStrategy as never,
        gpuClass: args.gpuClass as never,
        ...(args.maxImpetus !== undefined ? { maxImpetus: args.maxImpetus } : {}),
        ...(args.studioId ? { studioId: args.studioId } : {}),
      },
    )
    return ok({ run })
  } catch (e) {
    if (e instanceof ApiError) return errResult(e.code, e.message)
    return errResult('internal.error', String(e))
  }
}

export async function getRunTool(
  api: CrystalApi,
  auctor: AuctorKey | undefined,
  args: { id: string },
): Promise<McpResult> {
  if (!auctor) return errResult('auth.missing', 'authentication required')
  try {
    return ok({ run: await api.getRun(auctor, args.id) })
  } catch (e) {
    if (e instanceof ApiError) return errResult(e.code, e.message)
    return errResult('internal.error', String(e))
  }
}

/** The owner's settled spend history — owner-scoped (see `CrystalApi.listRuns`), cursor-paginated,
 *  newest first, plus a lifetime running total. Thin wrapper mirroring `getRunTool`/`statusTool`. */
export async function listRunsTool(
  api: CrystalApi,
  auctor: AuctorKey | undefined,
  args: ListRunsOpts = {},
): Promise<McpResult> {
  if (!auctor) return errResult('auth.missing', 'authentication required')
  try {
    return ok(await api.listRuns(auctor, args))
  } catch (e) {
    if (e instanceof ApiError) return errResult(e.code, e.message)
    return errResult('internal.error', String(e))
  }
}

export async function listFlowsTool(api: CrystalApi): Promise<McpResult> {
  try {
    return ok({ flows: await api.listFlows() })
  } catch (e) {
    if (e instanceof ApiError) return errResult(e.code, e.message)
    return errResult('internal.error', String(e))
  }
}

export async function describeFlowTool(
  api: CrystalApi,
  args: { id: string },
): Promise<McpResult> {
  try {
    return ok(await api.describeFlow(args.id))
  } catch (e) {
    if (e instanceof ApiError) return errResult(e.code, e.message)
    return errResult('internal.error', String(e))
  }
}

export async function quoteTool(
  api: CrystalApi,
  auctor: AuctorKey | undefined,
  args: { modusId?: string; verb?: string; aditus?: Record<string, unknown> },
): Promise<McpResult> {
  if (!auctor) return errResult('auth.missing', 'authentication required')
  try {
    return ok(await api.quote(auctor, { modusId: args.modusId, verb: args.verb }, args.aditus ?? {}))
  } catch (e) {
    if (e instanceof ApiError) return errResult(e.code, e.message)
    return errResult('internal.error', String(e))
  }
}

export async function listFundamentaTool(api: CrystalApi): Promise<McpResult> {
  try {
    return ok({ fundamenta: await api.listFundamenta() })
  } catch (e) {
    if (e instanceof ApiError) return errResult(e.code, e.message)
    return errResult('internal.error', String(e))
  }
}

export async function listModelsTool(
  api: CrystalApi,
  args: { genus?: string; basis?: string; fundamentumId?: string; trigger?: string; q?: string; limit?: number },
): Promise<McpResult> {
  try {
    return ok({ models: await api.listModels({ ...args, genus: args.genus as IntelligensGenus | undefined }) })
  } catch (e) {
    if (e instanceof ApiError) return errResult(e.code, e.message)
    return errResult('internal.error', String(e))
  }
}

export async function saveFlowTool(
  api: CrystalApi,
  auctor: AuctorKey | undefined,
  args: SaveFlowOpts,
): Promise<McpResult> {
  if (!auctor) return errResult('auth.missing', 'authentication required')
  try {
    return ok(await api.saveFlow(auctor, args))
  } catch (e) {
    if (e instanceof ApiError) return errResult(e.code, e.message)
    return errResult('internal.error', String(e))
  }
}

export async function bindTool(
  api: CrystalApi,
  auctor: AuctorKey | undefined,
  args: { verb: string; modusId: string },
): Promise<McpResult> {
  if (!auctor) return errResult('auth.missing', 'authentication required')
  try {
    return ok(await api.bind(auctor, args.verb, args.modusId))
  } catch (e) {
    if (e instanceof ApiError) return errResult(e.code, e.message)
    return errResult('internal.error', String(e))
  }
}

export async function statusTool(
  api: CrystalApi,
  auctor: AuctorKey | undefined,
): Promise<McpResult> {
  if (!auctor) return errResult('auth.missing', 'authentication required')
  try {
    return ok(await api.status(auctor))
  } catch (e) {
    if (e instanceof ApiError) return errResult(e.code, e.message)
    return errResult('internal.error', String(e))
  }
}

export interface ProvisionStudioArgs {
  fundamentumId?: string
  models?: string[]
  warmMs?: number
  maxImpetus?: string | number
  runtime?: string
}

export async function provisionStudioTool(
  api: CrystalApi,
  auctor: AuctorKey | undefined,
  args: ProvisionStudioArgs,
): Promise<McpResult> {
  if (!auctor) return errResult('auth.missing', 'authentication required')
  try {
    return ok({ studio: await api.provisionStudio(auctor, args) })
  } catch (e) {
    if (e instanceof ApiError) return errResult(e.code, e.message)
    return errResult('internal.error', String(e))
  }
}

// ---------------------------------------------------------------------------
// Collections (Collectio) — a base modus expanded over a Tractus[] grid
// ---------------------------------------------------------------------------

export async function collectTool(
  api: CrystalApi,
  auctor: AuctorKey | undefined,
  args: CollectOpts,
): Promise<McpResult> {
  if (!auctor) return errResult('auth.missing', 'authentication required')
  try {
    return ok({ collection: await api.collect(auctor, args) })
  } catch (e) {
    if (e instanceof ApiError) return errResult(e.code, e.message)
    return errResult('internal.error', String(e))
  }
}

export async function getCollectionTool(
  api: CrystalApi,
  auctor: AuctorKey | undefined,
  args: { id: string },
): Promise<McpResult> {
  if (!auctor) return errResult('auth.missing', 'authentication required')
  try {
    return ok({ collection: await api.getCollection(auctor, args.id) })
  } catch (e) {
    if (e instanceof ApiError) return errResult(e.code, e.message)
    return errResult('internal.error', String(e))
  }
}

export async function listCollectionsTool(
  api: CrystalApi,
  auctor: AuctorKey | undefined,
): Promise<McpResult> {
  if (!auctor) return errResult('auth.missing', 'authentication required')
  try {
    return ok({ collections: await api.listCollections(auctor) })
  } catch (e) {
    if (e instanceof ApiError) return errResult(e.code, e.message)
    return errResult('internal.error', String(e))
  }
}

export async function getStudioTool(
  api: CrystalApi,
  auctor: AuctorKey | undefined,
  args: { id: string },
): Promise<McpResult> {
  if (!auctor) return errResult('auth.missing', 'authentication required')
  try {
    return ok({ studio: await api.getStudio(auctor, args.id) })
  } catch (e) {
    if (e instanceof ApiError) return errResult(e.code, e.message)
    return errResult('internal.error', String(e))
  }
}

export async function listStudiosTool(
  api: CrystalApi,
  auctor: AuctorKey | undefined,
): Promise<McpResult> {
  if (!auctor) return errResult('auth.missing', 'authentication required')
  try {
    return ok({ studios: await api.listStudios(auctor) })
  } catch (e) {
    if (e instanceof ApiError) return errResult(e.code, e.message)
    return errResult('internal.error', String(e))
  }
}
