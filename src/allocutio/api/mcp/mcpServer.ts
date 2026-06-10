// =============================================================================
// buildMcpServer — wires CrystalApi tools + resources into an McpServer
// =============================================================================

import { z } from 'zod'
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'

import type { CrystalApi } from '../CrystalApi.js'
import type { AuctorKey } from '../../../flow/types.js'
import {
  runFlowTool,
  getRunTool,
  listFlowsTool,
  describeFlowTool,
} from './tools.js'

export function buildMcpServer(api: CrystalApi, auctor: AuctorKey | undefined): McpServer {
  const server = new McpServer({ name: 'noema-crystal', version: 'v1' })

  // ── Tools ─────────────────────────────────────────────────────────────────

  server.registerTool(
    'run_flow',
    {
      description:
        'Invoke a flow — provide modusId or a verb + aditus (see describe_flow); returns a run handle (poll get_run).',
      inputSchema: {
        modusId: z.string().optional(),
        verb: z.string().optional(),
        aditus: z.record(z.string(), z.unknown()).optional(),
        pinnedModels: z.array(z.unknown()).optional(),
        computeStrategy: z.string().optional(),
        gpuClass: z.string().optional(),
      },
    },
    (args) => runFlowTool(api, auctor, args),
  )

  server.registerTool(
    'get_run',
    {
      description: 'Fetch the current state of a run by its id.',
      inputSchema: { id: z.string() },
    },
    (args) => getRunTool(api, auctor, args),
  )

  server.registerTool(
    'list_flows',
    {
      description: 'List all runnable flows in the catalog.',
      inputSchema: {},
    },
    (_args) => listFlowsTool(api),
  )

  server.registerTool(
    'describe_flow',
    {
      description: 'Describe one flow — returns its JSON-Schema input/output.',
      inputSchema: { id: z.string() },
    },
    (args) => describeFlowTool(api, args),
  )

  // ── Resources ─────────────────────────────────────────────────────────────

  server.registerResource(
    'flows',
    'crystal://flows',
    { description: 'List of runnable flows' },
    async (uri) => ({
      contents: [{ uri: uri.href, text: JSON.stringify(await api.listFlows()) }],
    }),
  )

  const flowTemplate = new ResourceTemplate('crystal://flows/{id}', { list: undefined })
  server.registerResource(
    'flow',
    flowTemplate,
    { description: 'Schema for a single flow' },
    async (uri, variables) => {
      const id = String(variables.id)
      try {
        const schema = await api.describeFlow(id)
        return { contents: [{ uri: uri.href, text: JSON.stringify(schema) }] }
      } catch (e) {
        return {
          contents: [
            { uri: uri.href, text: JSON.stringify({ error: String(e) }) },
          ],
        }
      }
    },
  )

  return server
}
