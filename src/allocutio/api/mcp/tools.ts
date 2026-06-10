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

import type { CrystalApi } from '../CrystalApi.js'
import type { AuctorKey } from '../../../flow/types.js'
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
    return ok({ run: await api.getRun(args.id) })
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
