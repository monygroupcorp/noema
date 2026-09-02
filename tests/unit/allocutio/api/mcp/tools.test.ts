// =============================================================================
// tools.test.ts — unit tests for MCP tool handler functions
// =============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { runFlowTool, getRunTool, listFlowsTool, describeFlowTool, quoteTool, listFundamentaTool, listModelsTool, saveFlowTool, bindTool, statusTool, provisionStudioTool, getStudioTool, listStudiosTool, listDatasetsTool, getDatasetTool, listActivityTool, listMuseSessionsTool, getMuseSessionTool } from '../../../../../src/allocutio/api/mcp/tools.js'
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

const fakeRunDetail: Run = {
  ...fakeRun,
  aditus: { prompt: 'a cat', seed: 42 },
  pinnedModels: [{ role: 'checkpoint', modelId: 'flux-dev' } as any],
  modusVersion: '1.0.0',
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

const fakeDatasetSummaries = { datasets: [{ id: 'ds-1', name: 'a dataset', images: 12 }] }

const fakeDataset = {
  id: 'ds-1',
  owner: 'a1',
  name: 'a dataset',
  modality: 'image',
  custody: 'owned',
  media: [{ id: 'm-1', url: 'https://example.com/m-1.png', source: 'upload', addedAt: new Date() }],
  captionsets: [{ id: 'cs-1', name: 'wd14', method: 'wd14', coverage: '1/1', captions: { 'm-1': 'a cat' } }],
  versions: [],
  natum: new Date(),
  mutatum: new Date(),
} as any

const fakeActivityPage = {
  activity: [{ actumId: 'act-1', kind: 'generation', modusId: 'flux-schnell', status: 'running' }],
}

const fakeMuseSession = {
  id: 'muse-1',
  owner: 'a1',
  motherDatasetId: 'ds-1',
  fragments: [],
  floor: [],
  pieces: [],
  keptRolls: [],
  natum: new Date(),
  mutatum: new Date(),
} as any

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
  provisionStudio: CrystalApi['provisionStudio']
  getStudio: CrystalApi['getStudio']
  listStudios: CrystalApi['listStudios']
  listDatasetSummaries: CrystalApi['listDatasetSummaries']
  getDataset: CrystalApi['getDataset']
  listActivity: CrystalApi['listActivity']
  listMuseSessions: CrystalApi['listMuseSessions']
  getMuseSession: CrystalApi['getMuseSession']
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
    provisionStudio: overrides.provisionStudio ?? (async () => ({ studioId: 'modo-1', status: 'provisioning', budgetImpetus: '100' })),
    getStudio: overrides.getStudio ?? (async (_a, id) => ({ studioId: id, status: 'idle', budgetImpetus: '100' })),
    listStudios: overrides.listStudios ?? (async () => [{ studioId: 'modo-1', status: 'idle', budgetImpetus: '100' }]),
    listDatasetSummaries: overrides.listDatasetSummaries ?? (async () => fakeDatasetSummaries),
    getDataset: overrides.getDataset ?? (async () => fakeDataset),
    listActivity: overrides.listActivity ?? (async () => fakeActivityPage),
    listMuseSessions: overrides.listMuseSessions ?? (async () => [fakeMuseSession]),
    getMuseSession: overrides.getMuseSession ?? (async () => fakeMuseSession),
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

test('runFlowTool threads the credential ceiling into invokeFlow', async () => {
  // `run_flow` is `invokeFlow` by another door. A partner key capped per run over REST has to be
  // capped per run over MCP too, or the cap is one route away from being nothing.
  let seen: any
  const api = makeFakeApi({
    invokeFlow: async (_a: unknown, _t: unknown, _ad: unknown, opts: unknown) => { seen = opts; return fakeRunDetail },
  } as any)
  const result = await runFlowTool(api, auctor, { modusId: 'flux-schnell', aditus: { prompt: 'hi' } }, 250000n)
  assert.equal(result.isError, undefined)
  assert.equal(seen.keyMaxImpetusPerRun, 250000n)
})

test('runFlowTool: a maxImpetus ARGUMENT cannot replace the credential ceiling', async () => {
  // The tool's own args are written by the caller, so a `maxImpetus` arg is a request, not a
  // limit. Both reach `invokeFlow`, which takes the tighter of the two.
  let seen: any
  const api = makeFakeApi({
    invokeFlow: async (_a: unknown, _t: unknown, _ad: unknown, opts: unknown) => { seen = opts; return fakeRunDetail },
  } as any)
  await runFlowTool(api, auctor, { modusId: 'flux-schnell', maxImpetus: '999999999' }, 4n)
  assert.equal(seen.maxImpetus, '999999999')
  assert.equal(seen.keyMaxImpetusPerRun, 4n)
})

test('runFlowTool with no credential ceiling sends none — the pre-existing shape', async () => {
  let seen: any
  const api = makeFakeApi({
    invokeFlow: async (_a: unknown, _t: unknown, _ad: unknown, opts: unknown) => { seen = opts; return fakeRunDetail },
  } as any)
  await runFlowTool(api, auctor, { modusId: 'flux-schnell' })
  assert.equal('keyMaxImpetusPerRun' in seen, false)
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

test('getRunTool surfaces aditus, pinnedModels, and modusVersion for parity with the HTTP path', async () => {
  const api = makeFakeApi({ getRun: async () => fakeRunDetail })
  const result = await getRunTool(api, auctor, { id: 'run-1' })
  assert.equal(result.isError, undefined)
  const parsed = JSON.parse(result.content[0].text)
  assert.deepEqual(parsed.run.aditus, { prompt: 'a cat', seed: 42 })
  assert.deepEqual(parsed.run.pinnedModels, [{ role: 'checkpoint', modelId: 'flux-dev' }])
  assert.equal(parsed.run.modusVersion, '1.0.0')
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

// ---------------------------------------------------------------------------
// provisionStudioTool
// ---------------------------------------------------------------------------

test('provisionStudioTool with auctor returns ok result with studio', async () => {
  const api = makeFakeApi()
  const result = await provisionStudioTool(api, auctor, {})
  assert.equal(result.isError, undefined)
  const parsed = JSON.parse(result.content[0].text)
  assert.equal(parsed.studio.studioId, 'modo-1')
  assert.equal(parsed.studio.budgetImpetus, '100')
})

test('provisionStudioTool without auctor returns auth.missing error', async () => {
  const api = makeFakeApi()
  const result = await provisionStudioTool(api, undefined, {})
  assert.equal(result.isError, true)
  assert.ok(result.content[0].text.includes('auth.missing'))
})

test('provisionStudioTool propagates ApiError from api.provisionStudio', async () => {
  const api = makeFakeApi({
    provisionStudio: async () => { throw new ApiError('capacity.no_pods', 'No GPU capacity available to provision a studio', 503) },
  })
  const result = await provisionStudioTool(api, auctor, {})
  assert.equal(result.isError, true)
  assert.ok(result.content[0].text.includes('capacity.no_pods'))
})

test('getStudioTool with auctor returns ok result with the studio', async () => {
  const api = makeFakeApi()
  const result = await getStudioTool(api, auctor, { id: 'modo-9' })
  assert.equal(result.isError, undefined)
  assert.equal(JSON.parse(result.content[0].text).studio.studioId, 'modo-9')
})

test('getStudioTool without auctor returns auth.missing error', async () => {
  const result = await getStudioTool(makeFakeApi(), undefined, { id: 'modo-9' })
  assert.equal(result.isError, true)
  assert.ok(result.content[0].text.includes('auth.missing'))
})

test('getStudioTool propagates not_found.studio', async () => {
  const api = makeFakeApi({ getStudio: async () => { throw new ApiError('not_found.studio', 'Studio not found', 404) } })
  const result = await getStudioTool(api, auctor, { id: 'ghost' })
  assert.equal(result.isError, true)
  assert.ok(result.content[0].text.includes('not_found.studio'))
})

// ---------------------------------------------------------------------------
// listStudiosTool
// ---------------------------------------------------------------------------

test('listStudiosTool with auctor returns ok result with studios', async () => {
  const api = makeFakeApi()
  const result = await listStudiosTool(api, auctor)
  assert.equal(result.isError, undefined)
  const parsed = JSON.parse(result.content[0].text)
  assert.ok(Array.isArray(parsed.studios))
  assert.equal(parsed.studios.length, 1)
  assert.equal(parsed.studios[0].studioId, 'modo-1')
})

test('listStudiosTool without auctor returns auth.missing error', async () => {
  const api = makeFakeApi()
  const result = await listStudiosTool(api, undefined)
  assert.equal(result.isError, true)
  assert.ok(result.content[0].text.includes('auth.missing'))
})

test('listStudiosTool propagates ApiError from api.listStudios', async () => {
  const api = makeFakeApi({
    listStudios: async () => { throw new ApiError('internal.unavailable', 'Studio provisioning is not available on this deployment', 503) },
  })
  const result = await listStudiosTool(api, auctor)
  assert.equal(result.isError, true)
  assert.ok(result.content[0].text.includes('internal.unavailable'))
})

// ---------------------------------------------------------------------------
// listDatasetsTool / getDatasetTool / listActivityTool / listMuseSessionsTool /
// getMuseSessionTool — noema-368, SEE rung 3
// ---------------------------------------------------------------------------

test('listDatasetsTool with auctor returns ok result with datasets', async () => {
  const api = makeFakeApi()
  const result = await listDatasetsTool(api, auctor, {})
  assert.equal(result.isError, undefined)
  const parsed = JSON.parse(result.content[0].text)
  assert.equal(parsed.datasets.length, 1)
  assert.equal(parsed.datasets[0].id, 'ds-1')
})

test('listDatasetsTool without auctor returns auth.missing error', async () => {
  const result = await listDatasetsTool(makeFakeApi(), undefined, {})
  assert.equal(result.isError, true)
  assert.ok(result.content[0].text.includes('auth.missing'))
})

test('listDatasetsTool propagates ApiError from api.listDatasetSummaries', async () => {
  const api = makeFakeApi({
    listDatasetSummaries: async () => { throw new ApiError('internal.error', 'store unavailable', 503) },
  })
  const result = await listDatasetsTool(api, auctor, {})
  assert.equal(result.isError, true)
  assert.ok(result.content[0].text.includes('internal.error'))
})

test('getDatasetTool with auctor returns ok result with the dataset', async () => {
  const api = makeFakeApi()
  const result = await getDatasetTool(api, auctor, { id: 'ds-1' })
  assert.equal(result.isError, undefined)
  const parsed = JSON.parse(result.content[0].text)
  assert.equal(parsed.dataset.id, 'ds-1')
  assert.equal(parsed.dataset.media.length, 1)
  assert.equal(parsed.dataset.captionsets[0].captions['m-1'], 'a cat')
})

test('getDatasetTool without auctor returns auth.missing error', async () => {
  const result = await getDatasetTool(makeFakeApi(), undefined, { id: 'ds-1' })
  assert.equal(result.isError, true)
  assert.ok(result.content[0].text.includes('auth.missing'))
})

test('getDatasetTool propagates not_found.dataset', async () => {
  const api = makeFakeApi({ getDataset: async () => { throw new ApiError('not_found.dataset', 'Dataset not found', 404) } })
  const result = await getDatasetTool(api, auctor, { id: 'ghost' })
  assert.equal(result.isError, true)
  assert.ok(result.content[0].text.includes('not_found.dataset'))
})

test('getDatasetTool caps a large media list and marks it truncated', async () => {
  const bigMedia = Array.from({ length: 40 }, (_, i) => ({
    id: `m-${i}`,
    url: `https://example.com/m-${i}.png`,
    source: 'upload',
    addedAt: new Date(),
  }))
  const api = makeFakeApi({ getDataset: async () => ({ ...fakeDataset, media: bigMedia }) })
  const result = await getDatasetTool(api, auctor, { id: 'ds-1' })
  const parsed = JSON.parse(result.content[0].text)
  assert.equal(parsed.dataset.media.length, 25)
  assert.equal(parsed.dataset.mediaTruncated, true)
  assert.equal(parsed.dataset.mediaCount, 40)
})

test('getDatasetTool caps a large caption set and marks it truncated', async () => {
  const bigCaptions: Record<string, string> = {}
  for (let i = 0; i < 40; i++) bigCaptions[`m-${i}`] = `caption ${i}`
  const api = makeFakeApi({
    getDataset: async () => ({ ...fakeDataset, captionsets: [{ ...fakeDataset.captionsets[0], captions: bigCaptions }] }),
  })
  const result = await getDatasetTool(api, auctor, { id: 'ds-1' })
  const parsed = JSON.parse(result.content[0].text)
  assert.equal(Object.keys(parsed.dataset.captionsets[0].captions).length, 25)
  assert.equal(parsed.dataset.captionsets[0].captionsTruncated, true)
  assert.equal(parsed.dataset.captionsets[0].captionCount, 40)
})

test('listActivityTool with auctor returns ok result with activity', async () => {
  const api = makeFakeApi()
  const result = await listActivityTool(api, auctor, {})
  assert.equal(result.isError, undefined)
  const parsed = JSON.parse(result.content[0].text)
  assert.equal(parsed.activity.length, 1)
  assert.equal(parsed.activity[0].status, 'running')
})

test('listActivityTool without auctor returns auth.missing error', async () => {
  const result = await listActivityTool(makeFakeApi(), undefined, {})
  assert.equal(result.isError, true)
  assert.ok(result.content[0].text.includes('auth.missing'))
})

test('listActivityTool propagates ApiError from api.listActivity', async () => {
  const api = makeFakeApi({
    listActivity: async () => { throw new ApiError('internal.error', 'index unavailable', 503) },
  })
  const result = await listActivityTool(api, auctor, {})
  assert.equal(result.isError, true)
  assert.ok(result.content[0].text.includes('internal.error'))
})

test('listMuseSessionsTool with auctor returns ok result with sessions', async () => {
  const api = makeFakeApi()
  const result = await listMuseSessionsTool(api, auctor, { datasetId: 'ds-1' })
  assert.equal(result.isError, undefined)
  const parsed = JSON.parse(result.content[0].text)
  assert.equal(parsed.sessions.length, 1)
  assert.equal(parsed.sessions[0].id, 'muse-1')
})

test('listMuseSessionsTool without auctor returns auth.missing error', async () => {
  const result = await listMuseSessionsTool(makeFakeApi(), undefined, { datasetId: 'ds-1' })
  assert.equal(result.isError, true)
  assert.ok(result.content[0].text.includes('auth.missing'))
})

test('listMuseSessionsTool propagates ApiError from api.listMuseSessions', async () => {
  const api = makeFakeApi({
    listMuseSessions: async () => { throw new ApiError('inputMalformed', 'datasetId is required', 400) },
  })
  const result = await listMuseSessionsTool(api, auctor, { datasetId: '' })
  assert.equal(result.isError, true)
})

test('getMuseSessionTool with auctor returns ok result with the session', async () => {
  const api = makeFakeApi()
  const result = await getMuseSessionTool(api, auctor, { id: 'muse-1' })
  assert.equal(result.isError, undefined)
  assert.equal(JSON.parse(result.content[0].text).session.id, 'muse-1')
})

test('getMuseSessionTool without auctor returns auth.missing error', async () => {
  const result = await getMuseSessionTool(makeFakeApi(), undefined, { id: 'muse-1' })
  assert.equal(result.isError, true)
  assert.ok(result.content[0].text.includes('auth.missing'))
})

test('getMuseSessionTool propagates not_found.muse_session', async () => {
  const api = makeFakeApi({
    getMuseSession: async () => { throw new ApiError('not_found.muse_session', 'Muse session not found', 404) },
  })
  const result = await getMuseSessionTool(api, auctor, { id: 'ghost' })
  assert.equal(result.isError, true)
  assert.ok(result.content[0].text.includes('not_found.muse_session'))
})
