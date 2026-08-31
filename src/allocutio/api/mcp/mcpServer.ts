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
  quoteTool,
  listFundamentaTool,
  listModelsTool,
  saveFlowTool,
  bindTool,
  statusTool,
  provisionStudioTool,
  getStudioTool,
  listStudiosTool,
  collectTool,
  getCollectionTool,
  listCollectionsTool,
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
        maxImpetus: z.string().optional(),
        studioId: z.string().optional(),
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

  server.registerTool(
    'quote',
    {
      description:
        "Estimate a run's cost (impetus) without dispatching — call before invoke to budget.",
      inputSchema: {
        modusId: z.string().optional(),
        verb: z.string().optional(),
        aditus: z.record(z.string(), z.unknown()).optional(),
      },
    },
    (args) => quoteTool(api, auctor, args),
  )

  server.registerTool(
    'list_fundamenta',
    {
      description: 'List all available compute substrates (fundamenta) the platform can run flows on.',
      inputSchema: {},
    },
    (_args) => listFundamentaTool(api),
  )

  server.registerTool(
    'list_models',
    {
      description: 'Browse the model weight catalog — filter by genus, basis, fundamentum, trigger word, or free text.',
      inputSchema: {
        genus: z.string().optional(),
        basis: z.string().optional(),
        fundamentumId: z.string().optional(),
        trigger: z.string().optional(),
        q: z.string().optional(),
        limit: z.number().optional(),
      },
    },
    (args) => listModelsTool(api, args),
  )

  server.registerTool(
    'save_flow',
    {
      description: 'Save a reusable owner-keyed flow from an owned run (fromRun) or a base flow (modusId).',
      inputSchema: {
        fromRun: z.string().optional(),
        modusId: z.string().optional(),
        name: z.string(),
        aditus: z.record(z.string(), z.unknown()).optional(),
        promptMode: z.enum(['open', 'pinned']).optional(),
        affix: z.object({ prefix: z.string().optional(), suffix: z.string().optional() }).optional(),
        pinnedModels: z.array(z.object({ id: z.string() })).optional(),
      },
    },
    (args) => saveFlowTool(api, auctor, args),
  )

  server.registerTool(
    'bind',
    {
      description: 'Rebind a canon verb (make, chat) to a specific flow for the authenticated caller.',
      inputSchema: {
        verb: z.string(),
        modusId: z.string(),
      },
    },
    (args) => bindTool(api, auctor, args),
  )

  server.registerTool(
    'status',
    {
      description: "Return the authenticated caller's account snapshot — balance, in-flight gens, and studios.",
      inputSchema: {},
    },
    (_args) => statusTool(api, auctor),
  )

  server.registerTool(
    'provision_studio',
    {
      description: 'Lease a hosted warm studio (a persistent GPU session) for fast, repeated runs. ' +
        'Returns a studioId to pass as run_flow.studioId. maxImpetus is the session budget — the ' +
        'studio drain-terminates at the cap. Discover fundamentumId via list_fundamenta, models via list_models.',
      inputSchema: {
        fundamentumId: z.string().optional(),
        models: z.array(z.string()).optional(),
        warmMs: z.number().optional(),
        maxImpetus: z.union([z.string(), z.number()]).optional(),
        runtime: z.string().optional(),
      },
    },
    (args) => provisionStudioTool(api, auctor, args),
  )

  server.registerTool(
    'get_studio',
    {
      description: 'Fetch one of your studios by id — poll its status (provisioning → idle) after provision_studio. Owner-scoped: a studio you host reads back in every state, terminated included, so an id me_status reports is addressable here.',
      inputSchema: { id: z.string() },
    },
    (args) => getStudioTool(api, auctor, args),
  )

  server.registerTool(
    'list_studios',
    {
      description: "List the authenticated caller's live hosted studios (studioId, status, budget, burn rate).",
      inputSchema: {},
    },
    (_args) => listStudiosTool(api, auctor),
  )

  // ── Collections (Collectio) ─────────────────────────────────────────────────

  const traitValorSchema = z.object({
    value: z.unknown(),
    label: z.string().optional(),
    rarity: z.number().optional(),
    promptFragment: z.string().optional(),
    excludes: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
  })

  server.registerTool(
    'collect',
    {
      description:
        'Start a Collection — expand one flow (modusId, atomic or a compositus pipeline) over a ' +
        "Tractus[] parameter grid into `total` pieces. Each Tractus is one axis of variation (porta + " +
        'valores); aditusBase is applied to every piece (use `_basePrompt` with `{{porta}}` tokens). ' +
        'Returns a Collection handle (poll get_collection).',
      inputSchema: {
        modusId: z.string(),
        total: z.number(),
        tractus: z.array(
          z.object({
            porta: z.string(),
            label: z.string().optional(),
            valores: z.array(traitValorSchema),
          }),
        ),
        aditusBase: z.record(z.string(), z.unknown()).optional(),
        concurrentia: z.number().optional(),
        nomen: z.string().optional(),
      },
    },
    (args) => collectTool(api, auctor, args),
  )

  server.registerTool(
    'get_collection',
    {
      description: 'Fetch a Collection by id — progress (completed/failed/total), status, cost. Owner-scoped.',
      inputSchema: { id: z.string() },
    },
    (args) => getCollectionTool(api, auctor, args),
  )

  server.registerTool(
    'list_collections',
    {
      description: "List the authenticated caller's Collections.",
      inputSchema: {},
    },
    (_args) => listCollectionsTool(api, auctor),
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

  server.registerResource(
    'fundamenta',
    'crystal://fundamenta',
    { description: 'List of compute substrates (fundamenta) the platform supports' },
    async (uri) => ({
      contents: [{ uri: uri.href, text: JSON.stringify(await api.listFundamenta()) }],
    }),
  )

  server.registerResource(
    'models',
    'crystal://models',
    { description: 'Full unfiltered model weight catalog' },
    async (uri) => ({
      contents: [{ uri: uri.href, text: JSON.stringify(await api.listModels()) }],
    }),
  )

  return server
}
