// =============================================================================
// mcpRouter — Express router mounting the MCP StreamableHTTP transport
// =============================================================================
//
// Stateless per-request: each request gets its own McpServer + transport.
// Auth is resolved OPTIONALLY — public tools (list_flows, describe_flow) work
// without credentials; run_flow / get_run enforce auth themselves inside the
// tool handlers.
// =============================================================================

import express, { type Router } from 'express'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'

import type { CrystalApi } from '../CrystalApi.js'
import type { AuctorKey } from '../../../flow/types.js'
import { credentialsFromHeaders, type ResolvedCaller } from '../IdentityResolver.js'
import { buildMcpServer } from './mcpServer.js'

export interface McpRouterDeps {
  api: CrystalApi
  identity: {
    /** Resolves the caller AND the limits its credential carries — `run_flow` admits spend, so
     *  the ceiling on a partner API key has to reach it here exactly as it reaches `POST /v1/runs`. */
    resolveCaller(creds: ReturnType<typeof credentialsFromHeaders>): Promise<ResolvedCaller>
  }
}

export function createMcpRouter(deps: McpRouterDeps): Router {
  const router = express.Router()

  const handle: express.RequestHandler = async (req, res) => {
    let auctor: AuctorKey | undefined
    let keyMaxImpetusPerRun: bigint | undefined
    try {
      const caller = await deps.identity.resolveCaller(credentialsFromHeaders(req.headers as Record<string, string | undefined>, req.body))
      auctor = caller.auctor
      keyMaxImpetusPerRun = caller.maxImpetusPerRun
    } catch {
      // Auth is optional here (public tools). A failure clears BOTH halves together — an
      // identity that did not resolve carries no ceiling to apply, and the spend-admitting
      // tools refuse an absent auctor anyway.
      auctor = undefined
      keyMaxImpetusPerRun = undefined
    }

    const server = buildMcpServer(deps.api, auctor, keyMaxImpetusPerRun)
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    })

    res.on('close', () => {
      void transport.close()
      void server.close()
    })

    try {
      await server.connect(transport)
      await transport.handleRequest(req, res, req.body)
    } catch {
      // Express 4 doesn't catch async rejections — without this the request hangs.
      if (!res.headersSent) {
        res.status(500).json({ error: { code: 'internal.error', message: 'MCP transport error' } })
      } else {
        res.end()
      }
    }
  }

  router.post('/', handle)
  router.get('/', handle)
  router.delete('/', handle)

  return router
}
