// =============================================================================
// tools.test.ts — unit tests for MCP tool handler functions
// =============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { runFlowTool, getRunTool, listFlowsTool, describeFlowTool, quoteTool, listFundamentaTool, listModelsTool, saveFlowTool, bindTool, statusTool } from '../../../../../src/allocutio/api/mcp/tools.js'
import { ApiError } from '../../../../../src/allocutio/api/errors.js'
import type { CrystalApi } from '../../../../../src/allocutio/api/CrystalApi.js'
import type { AuctorKey } from '../../../../../src/flow/types.js'
import type { Run } from '../../../../../src/allocutio/api/types.js'

// ---------------------------------------------------------------------------
// Fake data
// ---------------------------------------------------------------------------

const auctor: AuctorKey = { animaId: 'a1' }

const fakeRun: Run = {
  id: 'run-1',
  status: 'complete',
  modusId: 'flux-schnell',
  exitus: { image: 'https://example.com/img.png' },
}

const fakeFlows = [
  { id: 'flux-schnell', nomen: 'FLUX Schnell', versio: '1.0.0' },
  { id: 'chatgpt', nomen: 'ChatGPT', versio: '1.0.0' },
]

const fakeSchema = {
  id: 'flux-schnell',
  input: { type: 'object', properties: { prompt: { type: 'string' } }, required: ['prompt'] },
  output: { type: 'object', properties: { image: { type: 'string' } } },
}

function makeFakeApi(overrides: Partial<{
  invokeFlow: CrystalApi['invokeFlow']
  getRun: CrystalApi['getRun']
  listFlows: CrystalApi['listFlows']
  describeFlow: CrystalApi['describeFlow']
  quote: CrystalApi['quote']
  listFundamenta: CrystalApi['listFundamenta']
  listModels: CrystalApi['listModels']
  saveFlow: CrystalApi['saveFlow']
  bind: CrystalApi['bind']
  status: CrystalApi['status']
}> = {}): CrystalApi {
  return {
    invokeFlow: overrides.invokeFlow ?? (async () => fakeRun),
    getRun: overrides.getRun ?? (async () => fakeRun),
    listFlows: overrides.listFlows ?? (async () => fakeFlows),
    describeFlow: overrides.describeFlow ?? (async () => fakeSchema as never),
    quote: overrides.quote ?? (async () => ({ impetus: '99' })),
    listFundamenta: overrides.listFundamenta ?? (async () => [
      { id: 'flux-comfyui', nomen: 'FLUX · ComfyUI', versio: '1.0.0', imageId: 'runpod/pytorch', imageVersion: '2.1.0' },
    ]),
    listModels: overrides.listModels ?? (async () => [
      { intellaId: 'flux-dev', nomen: 'FLUX Dev', genus: 'checkpoint', basis: 'flux' },
    ]),
    saveFlow: overrides.saveFlow ?? (async () => ({ id: 'my-flow' })),
    bind: overrides.bind ?? (async (_a, verb, modusId) => ({ verb, modusId })),
    status: overrides.status ?? (async () => ({
      balanceImpetus: '42',
      balanceUsd: 0,
      gens: [],
      studios: [],
      joinable: [],
      takenAt: new Date().toISOString(),
    })),
  } as unknown as CrystalApi
}

// ---------------------------------------------------------------------------
// runFlowTool
// ---------------------------------------------------------------------------

test('runFlowTool with auctor returns ok result with run', async () => {
  const api = makeFakeApi()
  const result = await runFlowTool(api, auctor, { modusId: 'flux-schnell', aditus: { prompt: 'hi' } })
  assert.equal(result.isError, undefined)
  assert.ok(result.content[0].text.includes('run-1'))
})

test('runFlowTool without auctor returns auth.missing error', async () => {
  const api = makeFakeApi()
  const result = await runFlowTool(api, undefined, { modusId: 'flux-schnell' })
  assert.equal(result.isError, true)
  assert.ok(result.content[0].text.includes('auth.missing'))
})

test('runFlowTool with api throwing ApiError returns that error', async () => {
  const api = makeFakeApi({
    invokeFlow: async () => { throw new ApiError('not_found.flow', "Flow 'x' not found", 404) },
  })
  const result = await runFlowTool(api, auctor, { modusId: 'x' })
  assert.equal(result.isError, true)
  assert.ok(result.content[0].text.includes('not_found.flow'))
})

test('runFlowTool with api throwing non-ApiError returns internal.error', async () => {
  const api = makeFakeApi({
    invokeFlow: async () => { throw new Error('unexpected boom') },
  })
  const result = await runFlowTool(api, auctor, { modusId: 'x' })
  assert.equal(result.isError, true)
  assert.ok(result.content[0].text.includes('internal.error'))
})

// ---------------------------------------------------------------------------
// getRunTool
// ---------------------------------------------------------------------------

test('getRunTool with auctor returns ok result with run', async () => {
  const api = makeFakeApi()
  const result = await getRunTool(api, auctor, { id: 'run-1' })
  assert.equal(result.isError, undefined)
  assert.ok(result.content[0].text.includes('run-1'))
})

test('getRunTool without auctor returns auth.missing error', async () => {
  const api = makeFakeApi()
  const result = await getRunTool(api, undefined, { id: 'run-1' })
  assert.equal(result.isError, true)
  assert.ok(result.content[0].text.includes('auth.missing'))
})

test('getRunTool with unknown id returns not_found.run', async () => {
  const api = makeFakeApi({
    getRun: async () => { throw new ApiError('not_found.run', "Run 'ghost' not found", 404) },
  })
  const result = await getRunTool(api, auctor, { id: 'ghost' })
  assert.equal(result.isError, true)
  assert.ok(result.content[0].text.includes('not_found.run'))
})

// ---------------------------------------------------------------------------
// listFlowsTool
// ---------------------------------------------------------------------------

test('listFlowsTool returns flows without requiring auctor', async () => {
  const api = makeFakeApi()
  const result = await listFlowsTool(api)
  assert.equal(result.isError, undefined)
  const parsed = JSON.parse(result.content[0].text)
  assert.ok(Array.isArray(parsed.flows))
  assert.equal(parsed.flows.length, 2)
  assert.equal(parsed.flows[0].id, 'flux-schnell')
})

// ---------------------------------------------------------------------------
// describeFlowTool
// ---------------------------------------------------------------------------

test('describeFlowTool returns schema for known flow', async () => {
  const api = makeFakeApi()
  const result = await describeFlowTool(api, { id: 'flux-schnell' })
  assert.equal(result.isError, undefined)
  const parsed = JSON.parse(result.content[0].text)
  assert.equal(parsed.id, 'flux-schnell')
  assert.ok(parsed.input)
})

test('describeFlowTool with unknown id returns not_found.flow error', async () => {
  const api = makeFakeApi({
    describeFlow: async () => { throw new ApiError('not_found.flow', "Flow 'unknown' not found", 404) },
  })
  const result = await describeFlowTool(api, { id: 'unknown' })
  assert.equal(result.isError, true)
  assert.ok(result.content[0].text.includes('not_found.flow'))
})

// ---------------------------------------------------------------------------
// quoteTool
// ---------------------------------------------------------------------------

test('quoteTool with auctor returns ok result with impetus', async () => {
  const api = makeFakeApi()
  const result = await quoteTool(api, auctor, { modusId: 'flux-schnell', aditus: { prompt: 'hi' } })
  assert.equal(result.isError, undefined)
  const parsed = JSON.parse(result.content[0].text)
  assert.equal(parsed.impetus, '99')
})

test('quoteTool without auctor returns auth.missing error', async () => {
  const api = makeFakeApi()
  const result = await quoteTool(api, undefined, { modusId: 'flux-schnell' })
  assert.equal(result.isError, true)
  assert.ok(result.content[0].text.includes('auth.missing'))
})

test('quoteTool propagates ApiError from api.quote', async () => {
  const api = makeFakeApi({
    quote: async () => { throw new ApiError('not_found.flow', "Flow 'x' not found", 404) },
  })
  const result = await quoteTool(api, auctor, { modusId: 'x' })
  assert.equal(result.isError, true)
  assert.ok(result.content[0].text.includes('not_found.flow'))
})

// ---------------------------------------------------------------------------
// listFundamentaTool
// ---------------------------------------------------------------------------

test('listFundamentaTool returns fundamenta without requiring auctor', async () => {
  const api = makeFakeApi()
  const result = await listFundamentaTool(api)
  assert.equal(result.isError, undefined)
  const parsed = JSON.parse(result.content[0].text)
  assert.ok(Array.isArray(parsed.fundamenta))
  assert.equal(parsed.fundamenta.length, 1)
  assert.equal(parsed.fundamenta[0].id, 'flux-comfyui')
})

// ---------------------------------------------------------------------------
// listModelsTool
// ---------------------------------------------------------------------------

test('listModelsTool returns models without requiring auctor', async () => {
  const api = makeFakeApi()
  const result = await listModelsTool(api, {})
  assert.equal(result.isError, undefined)
  const parsed = JSON.parse(result.content[0].text)
  assert.ok(Array.isArray(parsed.models))
  assert.equal(parsed.models.length, 1)
  assert.equal(parsed.models[0].intellaId, 'flux-dev')
})

test('listModelsTool passes filter args through to api.listModels', async () => {
  let capturedArgs: unknown
  const api = makeFakeApi({
    listModels: async (args) => { capturedArgs = args; return [] },
  })
  await listModelsTool(api, { genus: 'lora', basis: 'flux' })
  assert.deepEqual(capturedArgs, { genus: 'lora', basis: 'flux' })
})

// ---------------------------------------------------------------------------
// saveFlowTool
// ---------------------------------------------------------------------------

test('saveFlowTool with auctor returns ok result with id', async () => {
  const api = makeFakeApi()
  const result = await saveFlowTool(api, auctor, { name: 'My Flow', modusId: 'flux-schnell' })
  assert.equal(result.isError, undefined)
  const parsed = JSON.parse(result.content[0].text)
  assert.equal(parsed.id, 'my-flow')
})

test('saveFlowTool without auctor returns auth.missing error', async () => {
  const api = makeFakeApi()
  const result = await saveFlowTool(api, undefined, { name: 'My Flow', modusId: 'flux-schnell' })
  assert.equal(result.isError, true)
  assert.ok(result.content[0].text.includes('auth.missing'))
})

test('saveFlowTool propagates ApiError from api.saveFlow', async () => {
  const api = makeFakeApi({
    saveFlow: async () => { throw new ApiError('conflict.slug_taken', "The slug 'x' is already taken", 409) },
  })
  const result = await saveFlowTool(api, auctor, { name: 'x', modusId: 'flux-schnell' })
  assert.equal(result.isError, true)
  assert.ok(result.content[0].text.includes('conflict.slug_taken'))
})

// ---------------------------------------------------------------------------
// bindTool
// ---------------------------------------------------------------------------

test('bindTool with auctor returns ok result with verb and modusId', async () => {
  const api = makeFakeApi()
  const result = await bindTool(api, auctor, { verb: 'make', modusId: 'flux-schnell' })
  assert.equal(result.isError, undefined)
  const parsed = JSON.parse(result.content[0].text)
  assert.equal(parsed.verb, 'make')
  assert.equal(parsed.modusId, 'flux-schnell')
})

test('bindTool without auctor returns auth.missing error', async () => {
  const api = makeFakeApi()
  const result = await bindTool(api, undefined, { verb: 'make', modusId: 'flux-schnell' })
  assert.equal(result.isError, true)
  assert.ok(result.content[0].text.includes('auth.missing'))
})

test('bindTool propagates ApiError from api.bind', async () => {
  const api = makeFakeApi({
    bind: async () => { throw new ApiError('input.malformed', "'nope' is not a rebindable verb", 400) },
  })
  const result = await bindTool(api, auctor, { verb: 'nope', modusId: 'flux-schnell' })
  assert.equal(result.isError, true)
  assert.ok(result.content[0].text.includes('input.malformed'))
})

// ---------------------------------------------------------------------------
// statusTool
// ---------------------------------------------------------------------------

test('statusTool with auctor returns ok result with balanceImpetus', async () => {
  const api = makeFakeApi()
  const result = await statusTool(api, auctor)
  assert.equal(result.isError, undefined)
  const parsed = JSON.parse(result.content[0].text)
  assert.equal(parsed.balanceImpetus, '42')
})

test('statusTool without auctor returns auth.missing error', async () => {
  const api = makeFakeApi()
  const result = await statusTool(api, undefined)
  assert.equal(result.isError, true)
  assert.ok(result.content[0].text.includes('auth.missing'))
})
