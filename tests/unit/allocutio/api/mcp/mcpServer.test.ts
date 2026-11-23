// =============================================================================
// mcpServer.test.ts — real MCP protocol via in-memory transport
// =============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'

import { buildMcpServer } from '../../../../../src/allocutio/api/mcp/mcpServer.js'
import type { CrystalApi } from '../../../../../src/allocutio/api/CrystalApi.js'
import type { AuctorKey } from '../../../../../src/flow/types.js'
import type { Run } from '../../../../../src/allocutio/api/types.js'
import type { PartnerUsageStore } from '../../../../../src/types/partnerUsage.js'

// ---------------------------------------------------------------------------
// Fake API
// ---------------------------------------------------------------------------

const fakeRun: Run = {
  id: 'run-42',
  status: 'pending',
  modusId: 'flux-schnell',
}

const fakeFlows = [
  { id: 'flux-schnell', nomen: 'FLUX Schnell', versio: '1.0.0' },
  { id: 'chatgpt', nomen: 'ChatGPT', versio: '1.0.0' },
]

const fakeSchema = {
  id: 'flux-schnell',
  nomen: 'FLUX Schnell',
  versio: '1.0.0',
  input: {
    type: 'object',
    properties: { prompt: { type: 'string' } },
    required: ['prompt'],
  },
  output: { type: 'object', properties: { image: { type: 'string' } } },
}

const fakeApi: CrystalApi = {
  invokeFlow: async () => fakeRun,
  getRun: async () => fakeRun,
  listFlows: async () => fakeFlows,
  describeFlow: async (id: string) => {
    if (id !== 'flux-schnell') throw Object.assign(new Error(`not found`), { code: 'not_found.flow' })
    return fakeSchema as never
  },
  saveFlow: async () => ({ id: 'my-flow' }),
  bind: async (_a: unknown, verb: string, modusId: string) => ({ verb, modusId }),
  status: async () => ({
    balanceImpetus: '0',
    balanceUsd: 0,
    gens: [],
    studios: [],
    joinable: [],
    takenAt: new Date().toISOString(),
  }),
  collect: async (_a: unknown, opts: { modusId: string; total: number }) => ({
    id: 'coll-7',
    status: 'pending',
    modusId: opts.modusId,
    total: opts.total,
    completed: 0,
    failed: 0,
  }),
} as unknown as CrystalApi

const auctor: AuctorKey = { animaId: 'a1' }

// ---------------------------------------------------------------------------
// Helper: create a connected client+server pair
// ---------------------------------------------------------------------------

async function makeClient(
  auctorArg?: AuctorKey | null,
  partnerUsage?: Pick<PartnerUsageStore, 'record'>,
  keyPrefix?: string,
) {
  const resolvedAuctor: AuctorKey | undefined = auctorArg === null ? undefined : (auctorArg ?? auctor)
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const server = buildMcpServer(fakeApi, resolvedAuctor, undefined, undefined, partnerUsage, keyPrefix)
  await server.connect(serverTransport)
  const client = new Client({ name: 'test', version: '1' })
  await client.connect(clientTransport)
  return { client, server }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// The MCP SDK types a tool result's `content` as `unknown` (the wire schema is open).
// Every read here wants the same shape, so it is narrowed in one place.
function textBlocks(result: unknown): Array<{ type: string; text: string }> {
  return (result as { content: Array<{ type: string; text: string }> }).content
}

test('listTools returns all 16 tool names', async () => {
  const { client } = await makeClient()
  const { tools } = await client.listTools()
  const names = tools.map((t) => t.name).sort()
  assert.deepEqual(names, ['bind', 'collect', 'describe_flow', 'get_collection', 'get_run', 'get_studio', 'list_collections', 'list_flows', 'list_fundamenta', 'list_models', 'list_studios', 'provision_studio', 'quote', 'run_flow', 'save_flow', 'status'])
})

test('list_flows tool returns the flow catalog', async () => {
  const { client } = await makeClient()
  const result = await client.callTool({ name: 'list_flows', arguments: {} })
  assert.ok(Array.isArray(result.content))
  const text = textBlocks(result)[0].text
  const parsed = JSON.parse(text)
  assert.ok(Array.isArray(parsed.flows))
  assert.equal(parsed.flows.length, 2)
  assert.equal(parsed.flows[0].id, 'flux-schnell')
})

test('describe_flow tool returns flow schema', async () => {
  const { client } = await makeClient()
  const result = await client.callTool({ name: 'describe_flow', arguments: { id: 'flux-schnell' } })
  const text = textBlocks(result)[0].text
  const parsed = JSON.parse(text)
  assert.equal(parsed.id, 'flux-schnell')
  assert.ok(parsed.input)
})

test('run_flow tool returns run handle when authenticated', async () => {
  const { client } = await makeClient(auctor)
  const result = await client.callTool({ name: 'run_flow', arguments: { modusId: 'flux-schnell', aditus: { prompt: 'test' } } })
  const text = textBlocks(result)[0].text
  const parsed = JSON.parse(text)
  assert.equal(parsed.run.id, 'run-42')
})

test('run_flow tool returns auth.missing when no auctor', async () => {
  const { client } = await makeClient(null)
  const result = await client.callTool({ name: 'run_flow', arguments: { modusId: 'flux-schnell' } })
  assert.equal(result.isError, true)
  const text = textBlocks(result)[0].text
  assert.ok(text.includes('auth.missing'))
})

test('run_flow tool meters a partner-key call the same way POST /v1/runs does', async () => {
  const recorded: unknown[] = []
  const partnerUsage: Pick<PartnerUsageStore, 'record'> = {
    record: async (entry) => { recorded.push(entry) },
  }
  const { client } = await makeClient(auctor, partnerUsage, 'pk_live_abc')
  await client.callTool({ name: 'run_flow', arguments: { modusId: 'flux-schnell', aditus: { prompt: 'test' } } })
  assert.equal(recorded.length, 1)
  const entry = recorded[0] as { actumId: string; animaId: string; keyPrefix: string; modusId: string }
  assert.equal(entry.actumId, fakeRun.id)
  assert.equal(entry.animaId, auctor.animaId)
  assert.equal(entry.keyPrefix, 'pk_live_abc')
  assert.equal(entry.modusId, fakeRun.modusId)
})

test('run_flow tool does not meter when no keyPrefix is present (non-partner credential)', async () => {
  const recorded: unknown[] = []
  const partnerUsage: Pick<PartnerUsageStore, 'record'> = {
    record: async (entry) => { recorded.push(entry) },
  }
  const { client } = await makeClient(auctor, partnerUsage, undefined)
  await client.callTool({ name: 'run_flow', arguments: { modusId: 'flux-schnell', aditus: { prompt: 'test' } } })
  assert.equal(recorded.length, 0)
})

test('collect tool starts a collection when authenticated', async () => {
  const { client } = await makeClient(auctor)
  const result = await client.callTool({
    name: 'collect',
    arguments: {
      modusId: 'flux-schnell',
      total: 4,
      tractus: [{ porta: 'color', valores: [{ value: 'red' }, { value: 'blue' }] }],
      aditusBase: { _basePrompt: 'a {{color}} cat' },
    },
  })
  const text = textBlocks(result)[0].text
  const parsed = JSON.parse(text)
  assert.equal(parsed.collection.id, 'coll-7')
  assert.equal(parsed.collection.total, 4)
})

test('collect tool returns auth.missing when no auctor', async () => {
  const { client } = await makeClient(null)
  const result = await client.callTool({ name: 'collect', arguments: { modusId: 'flux-schnell', total: 1, tractus: [] } })
  assert.equal(result.isError, true)
  const text = textBlocks(result)[0].text
  assert.ok(text.includes('auth.missing'))
})

test('collect tool refuses a partner-key caller — Collections are not metered yet', async () => {
  const { client } = await makeClient(auctor, undefined, 'pk_live_abc')
  const result = await client.callTool({
    name: 'collect',
    arguments: { modusId: 'flux-schnell', total: 4, tractus: [{ porta: 'color', valores: [{ value: 'red' }] }] },
  })
  assert.equal(result.isError, true)
  const text = textBlocks(result)[0].text
  assert.ok(text.includes('partner.unmetered_surface'), text)
})

test('collect tool is unaffected for a session caller (no keyPrefix)', async () => {
  const { client } = await makeClient(auctor, undefined, undefined)
  const result = await client.callTool({
    name: 'collect',
    arguments: { modusId: 'flux-schnell', total: 4, tractus: [{ porta: 'color', valores: [{ value: 'red' }] }] },
  })
  assert.equal(result.isError, undefined)
})

test('crystal://flows resource returns the flow catalog', async () => {
  const { client } = await makeClient()
  const result = await client.readResource({ uri: 'crystal://flows' })
  assert.ok(Array.isArray(result.contents))
  assert.equal(result.contents[0].uri, 'crystal://flows')
  const parsed = JSON.parse((result.contents[0] as { text: string }).text)
  assert.ok(Array.isArray(parsed))
  assert.equal(parsed.length, 2)
})
