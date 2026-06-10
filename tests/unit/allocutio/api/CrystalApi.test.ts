// =============================================================================
// CrystalApi — hermetic facade test
// =============================================================================
//
// Drives the REAL dispatchInceptio through faked ring slices: a fake inceptor
// (initiate → nascens Actum), a fake cursorum whose cursor.run returns a sync
// exitus, and a fake completor (complete → completus Actum with exitus). The
// facade composes these + the real toRun / describeFlow / Errors taxonomy.
// =============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { CrystalApi, type CrystalApiDeps } from '../../../../src/allocutio/api/CrystalApi.js'
import { ApiError } from '../../../../src/allocutio/api/errors.js'
import { MemoryConsuetudinum } from '../../../../src/crystal/MemoryConsuetudinum.js'
import type { Actum } from '../../../../src/types/actum.js'
import type { Modus } from '../../../../src/types/modus.js'
import type { Inceptio, Cursor } from '../../../../src/types/cursus.js'
import type { AuctorKey } from '../../../../src/flow/types.js'
import type { Fundamentum } from '../../../../src/types/fundamentum.js'
import type { Intelligens } from '../../../../src/types/intelligendi.js'

const auctor: AuctorKey = { animaId: 'anima-1' }

// ── A minimal canonical atomic modus factory ───────────────────────────────
function makeModus(id: string, over: Partial<Modus> = {}): Modus {
  return {
    id,
    nomen: id,
    genus: 'atomicus',
    versio: '1.0.0',
    contentHash: `sha256:${id}`,
    aditus: { prompt: { type: 'text', required: true } },
    exitus: { image: { type: 'image' } },
    ministerium: 'fake',
    canonica: true,
    natum: new Date('2026-01-01T00:00:00Z'),
    mutatum: new Date('2026-01-01T00:00:00Z'),
    ...over,
  }
}

// ── A nascens Actum from initiate ───────────────────────────────────────────
function nascens(inceptio: Inceptio): Actum {
  return {
    id: 'act-1',
    modusId: inceptio.modusId,
    modusVersiono: '1.0.0',
    impetus: 0n,
    signaConsumed: ['sig-1'],
    aditus: inceptio.aditus,
    status: 'nascens',
    inceptum: new Date('2026-06-10T00:00:00Z'),
  }
}

// ── Fake fundamenta ─────────────────────────────────────────────────────────
const fakeFundamenta: Fundamentum[] = [
  {
    id: 'flux-comfyui',
    nomen: 'FLUX · ComfyUI',
    versio: '1.0.0',
    imageId: 'runpod/pytorch',
    imageVersion: '2.1.0',
    runtime: 'ComfyUI',
    vramGb: 24,
    canonica: true,
    natum: new Date('2026-01-01'),
    mutatum: new Date('2026-01-01'),
  },
  {
    id: 'sd15-comfyui',
    nomen: 'SD 1.5 · ComfyUI',
    versio: '1.0.0',
    imageId: 'runpod/pytorch',
    imageVersion: '2.1.0',
    canonica: true,
    natum: new Date('2026-01-01'),
    mutatum: new Date('2026-01-01'),
  },
]

// ── Fake intelligendi ────────────────────────────────────────────────────────
function makeIntelligens(over: Partial<Intelligens>): Intelligens {
  return {
    id: 'intel-1',
    nomen: 'Test Model',
    genus: 'checkpoint',
    basis: 'flux',
    canonica: true,
    privacy: 'public',
    notae: [],
    locatio: 'r2://weights/test.safetensors',
    stellae: 0,
    natum: new Date('2026-01-01'),
    mutatum: new Date('2026-01-01'),
    ...over,
  }
}

const fakeIntelligentia: Intelligens[] = [
  makeIntelligens({ id: 'flux-dev', nomen: 'FLUX Dev', genus: 'checkpoint', basis: 'flux' }),
  makeIntelligens({ id: 'sd15-base', nomen: 'SD 1.5 Base', genus: 'checkpoint', basis: 'sd15' }),
  makeIntelligens({ id: 'flux-lora-1', nomen: 'Flux LoRA 1', genus: 'lora', basis: 'flux', verba: ['flux-portrait'] }),
]

// ── Build the deps ring. Records the last modusId that was dispatched. ───────
function makeDeps(over: Partial<CrystalApiDeps> = {}): {
  deps: CrystalApiDeps
  dispatched: { modusId?: string }
  modi: Record<string, Modus>
} {
  const dispatched: { modusId?: string } = {}

  const modi: Record<string, Modus> = {
    'flux-schnell': makeModus('flux-schnell', { nomen: 'FLUX Schnell' }),
    'sd1-5': makeModus('sd1-5'),
    'verb-bound': makeModus('verb-bound'),
    // a non-canonical / non-atomic entry that listFlows must EXCLUDE
    'spell-x': makeModus('spell-x', { genus: 'compositus', ministerium: undefined }),
    'community-y': makeModus('community-y', { canonica: false }),
  }

  const completedFor = (act: Actum): Actum => ({
    ...act,
    status: 'completus',
    exitus: { image: 'x' },
    impetus: 5n,
    completum: new Date('2026-06-10T00:01:00Z'),
  })

  const cursor: Cursor = {
    reserve: async () => 5n,
    run: async () => ({ kind: 'sync', exitus: { exitus: { image: 'x' }, impetus: 5n } }),
  }

  const deps: CrystalApiDeps = {
    inceptor: {
      initiate: async (inceptio: Inceptio) => {
        dispatched.modusId = inceptio.modusId
        return nascens(inceptio)
      },
    },
    modorum: {
      find: async (id: string) => modi[id] ?? null,
      register: async () => {},
      list: async (filter) =>
        Object.values(modi).filter(
          (m) =>
            (filter?.genus === undefined || m.genus === filter.genus) &&
            (filter?.canonica === undefined || m.canonica === filter.canonica),
        ),
      update: async () => { throw new Error('unused') },
    },
    cursorum: {
      register: () => {},
      resolve: () => cursor,
    },
    completor: {
      complete: async (act: Actum) => completedFor(act),
      fail: async (act: Actum) => act,
    },
    actorum: {
      create: async () => { throw new Error('unused') },
      update: async () => { throw new Error('unused') },
      findById: async (id: string) =>
        id === 'act-known' ? completedFor(nascens({ modusId: 'flux-schnell', aditus: {}, by: auctor })) : null,
      findByExternusJobId: async () => null,
      findByNullifier: async () => null,
      findExpired: async () => [],
      findInFlight: async () => [],
    },
    // The owner (`auctor`) owns signum 'sig-1'; any other identity owns nothing.
    signorum: ({
      ownsAny: async (by: AuctorKey, ids: string[]) =>
        'animaId' in by && by.animaId === 'anima-1' && ids.includes('sig-1'),
      balance: async () => 0n,
      history: async () => [],
    } as unknown) as CrystalApiDeps['signorum'],
    fundamentorum: ({
      find: async (id: string) => fakeFundamenta.find((f) => f.id === id) ?? null,
      register: async () => {},
      list: async () => fakeFundamenta,
    } as unknown) as CrystalApiDeps['fundamentorum'],
    intelligendi: ({
      find: async (id: string) => fakeIntelligentia.find((i) => i.id === id) ?? null,
      list: async (filter?: { genus?: string; basis?: string; canonica?: boolean }) =>
        fakeIntelligentia.filter((i) => {
          if (filter?.genus && i.genus !== filter.genus) return false
          if (filter?.basis && i.basis !== filter.basis) return false
          if (filter?.canonica !== undefined && i.canonica !== filter.canonica) return false
          return true
        }),
      search: async (q: string) =>
        fakeIntelligentia.filter((i) =>
          i.nomen.toLowerCase().includes(q.toLowerCase()) ||
          (i.descriptio ?? '').toLowerCase().includes(q.toLowerCase()),
        ),
      create: async () => { throw new Error('unused') },
      update: async () => { throw new Error('unused') },
    } as unknown) as CrystalApiDeps['intelligendi'],
    hospitia: ({
      findActive: async () => [],
      findByMateriaId: async () => null,
    } as unknown) as CrystalApiDeps['hospitia'],
    materiae: ({
      findById: async () => null,
    } as unknown) as CrystalApiDeps['materiae'],
    ...over,
  }

  return { deps, dispatched, modi }
}

test('invokeFlow by canon verb resolves CANON_VERBS default and returns a complete Run', async () => {
  const { deps, dispatched } = makeDeps()
  const api = new CrystalApi(deps)

  const run = await api.invokeFlow(auctor, { verb: 'make' }, { prompt: 'hi' })

  assert.equal(dispatched.modusId, 'flux-schnell')
  assert.equal(run.modusId, 'flux-schnell')
  assert.equal(run.status, 'complete')
  assert.deepEqual(run.exitus, { image: 'x' })
})

test('a consuetudinum-bound verb overrides the CANON default', async () => {
  const consuetudinum = new MemoryConsuetudinum()
  await consuetudinum.bind(auctor, 'make', 'verb-bound')
  const { deps, dispatched } = makeDeps({ consuetudinum })
  const api = new CrystalApi(deps)

  const run = await api.invokeFlow(auctor, { verb: 'make' }, { prompt: 'hi' })

  assert.equal(dispatched.modusId, 'verb-bound')
  assert.equal(run.modusId, 'verb-bound')
})

test('invokeFlow by explicit modusId uses it directly', async () => {
  const { deps, dispatched } = makeDeps()
  const api = new CrystalApi(deps)

  const run = await api.invokeFlow(auctor, { modusId: 'sd1-5' }, { prompt: 'hi' })

  assert.equal(dispatched.modusId, 'sd1-5')
  assert.equal(run.modusId, 'sd1-5')
})

test('invokeFlow with an unresolvable verb throws not_found.flow', async () => {
  const { deps } = makeDeps()
  const api = new CrystalApi(deps)

  await assert.rejects(
    () => api.invokeFlow(auctor, { verb: 'nope' }, {}),
    (e: unknown) => e instanceof ApiError && e.code === 'not_found.flow',
  )
})

test('getRun (owner-scoped) projects the owner\'s run; unknown id throws not_found.run', async () => {
  const { deps } = makeDeps()
  const api = new CrystalApi(deps)

  const run = await api.getRun(auctor, 'act-known')
  assert.equal(run.status, 'complete')
  assert.deepEqual(run.exitus, { image: 'x' })

  await assert.rejects(
    () => api.getRun(auctor, 'ghost'),
    (e: unknown) => e instanceof ApiError && e.code === 'not_found.run',
  )
})

test('getRun is owner-scoped: a non-owner gets not_found.run (no IDOR), even for a real run', async () => {
  const { deps } = makeDeps()
  const api = new CrystalApi(deps)
  // 'act-known' is real + complete, but this auctor owns none of its signa.
  await assert.rejects(
    () => api.getRun({ animaId: 'someone-else' }, 'act-known'),
    (e: unknown) => e instanceof ApiError && e.code === 'not_found.run',
  )
  // An anonymous commitment owner that DOES own the consumed signum can read it.
  const anonDeps = { ...deps, signorum: ({ ownsAny: async (_by: AuctorKey, ids: string[]) => ids.includes('sig-1') } as unknown) as CrystalApiDeps['signorum'] }
  const anonRun = await new CrystalApi(anonDeps).getRun({ commitment: 'c-1' }, 'act-known')
  assert.equal(anonRun.status, 'complete')
})

test('listFlows returns only atomicus + canonica flows', async () => {
  const { deps } = makeDeps()
  const api = new CrystalApi(deps)

  const flows = await api.listFlows()
  const ids = flows.map((f) => f.id).sort()

  assert.deepEqual(ids, ['flux-schnell', 'sd1-5', 'verb-bound'])
  const flux = flows.find((f) => f.id === 'flux-schnell')!
  assert.equal(flux.nomen, 'FLUX Schnell')
  assert.equal(flux.versio, '1.0.0')
})

test('describeFlow returns a schema with an input', async () => {
  const { deps } = makeDeps()
  const api = new CrystalApi(deps)

  const desc = await api.describeFlow('flux-schnell')
  assert.equal(desc.id, 'flux-schnell')
  assert.equal(desc.input.type, 'object')
  assert.ok(desc.input.properties.prompt)
  assert.deepEqual(desc.input.required, ['prompt'])

  await assert.rejects(
    () => api.describeFlow('ghost'),
    (e: unknown) => e instanceof ApiError && e.code === 'not_found.flow',
  )
})

// ── quote ────────────────────────────────────────────────────────────────────

test('quote returns { impetus } as a string (cursor.reserve = 5n)', async () => {
  const { deps } = makeDeps()
  const api = new CrystalApi(deps)

  const result = await api.quote(auctor, { modusId: 'flux-schnell' }, { prompt: 'hi' })
  assert.equal(result.impetus, '5')
})

test('quote by verb resolves through CANON_VERBS', async () => {
  const { deps } = makeDeps()
  const api = new CrystalApi(deps)

  const result = await api.quote(auctor, { verb: 'make' }, { prompt: 'hi' })
  assert.equal(result.impetus, '5')
})

test('quote with an unknown verb throws not_found.flow', async () => {
  const { deps } = makeDeps()
  const api = new CrystalApi(deps)

  await assert.rejects(
    () => api.quote(auctor, { verb: 'no-such-verb' }, {}),
    (e: unknown) => e instanceof ApiError && e.code === 'not_found.flow',
  )
})

// ── listFundamenta ───────────────────────────────────────────────────────────

test('listFundamenta maps fields correctly', async () => {
  const { deps } = makeDeps()
  const api = new CrystalApi(deps)

  const funds = await api.listFundamenta()
  assert.equal(funds.length, 2)

  const flux = funds.find((f) => f.id === 'flux-comfyui')!
  assert.ok(flux, 'flux-comfyui present')
  assert.equal(flux.nomen, 'FLUX · ComfyUI')
  assert.equal(flux.versio, '1.0.0')
  assert.equal(flux.imageId, 'runpod/pytorch')
  assert.equal(flux.runtime, 'ComfyUI')
  assert.equal(flux.vramGb, 24)

  // optional fields absent when not set
  const sd = funds.find((f) => f.id === 'sd15-comfyui')!
  assert.ok(sd, 'sd15-comfyui present')
  assert.equal(sd.runtime, undefined)
  assert.equal(sd.vramGb, undefined)
})

// ── listModels ───────────────────────────────────────────────────────────────

test('listModels returns all models unfiltered', async () => {
  const { deps } = makeDeps()
  const api = new CrystalApi(deps)

  const models = await api.listModels()
  assert.equal(models.length, 3)
})

test('listModels filters by genus', async () => {
  const { deps } = makeDeps()
  const api = new CrystalApi(deps)

  const models = await api.listModels({ genus: 'lora' } as never)
  assert.equal(models.length, 1)
  assert.equal(models[0].intellaId, 'flux-lora-1')
  assert.equal(models[0].genus, 'lora')
})

test('listModels filters by basis', async () => {
  const { deps } = makeDeps()
  const api = new CrystalApi(deps)

  const models = await api.listModels({ basis: 'sd15' } as never)
  assert.equal(models.length, 1)
  assert.equal(models[0].intellaId, 'sd15-base')
})

test('listModels filters by trigger word', async () => {
  const { deps } = makeDeps()
  const api = new CrystalApi(deps)

  const models = await api.listModels({ trigger: 'flux-portrait' } as never)
  assert.equal(models.length, 1)
  assert.equal(models[0].intellaId, 'flux-lora-1')
  assert.ok(models[0].trigger?.includes('flux-portrait'))
})

test('listModels free-text search via q', async () => {
  const { deps } = makeDeps()
  const api = new CrystalApi(deps)

  const models = await api.listModels({ q: 'FLUX Dev' } as never)
  assert.equal(models.length, 1)
  assert.equal(models[0].intellaId, 'flux-dev')
})

// ── invokeFlow maxImpetus cap ─────────────────────────────────────────────────

test('invokeFlow with maxImpetus BELOW the reservation throws economy.cap_too_low', async () => {
  const { deps } = makeDeps()
  const api = new CrystalApi(deps)

  // reserve = 5n; cap = 4 → should throw
  await assert.rejects(
    () => api.invokeFlow(auctor, { modusId: 'flux-schnell' }, { prompt: 'hi' }, { maxImpetus: 4n }),
    (e: unknown) => e instanceof ApiError && e.code === 'economy.cap_too_low',
  )
})

test('invokeFlow with maxImpetus ABOVE the reservation succeeds', async () => {
  const { deps } = makeDeps()
  const api = new CrystalApi(deps)

  // reserve = 5n; cap = 10 → should succeed
  const run = await api.invokeFlow(auctor, { modusId: 'flux-schnell' }, { prompt: 'hi' }, { maxImpetus: 10n })
  assert.equal(run.status, 'complete')
})

// ── saveFlow ──────────────────────────────────────────────────────────────────

test('saveFlow from modusId registers a derived flow and returns its slug id', async () => {
  const { deps, modi } = makeDeps()
  let registered: unknown
  deps.modorum.register = async (m) => { registered = m; modi[m.id] = m }
  const api = new CrystalApi(deps)

  const result = await api.saveFlow(auctor, { modusId: 'flux-schnell', name: 'My Flow' })
  assert.equal(result.id, 'my-flow')
  assert.ok(registered, 'modorum.register was called')
  assert.equal((registered as { id: string }).id, 'my-flow')
})

test('saveFlow with a name whose slug is already taken throws conflict.slug_taken', async () => {
  const { deps } = makeDeps()
  const api = new CrystalApi(deps)

  // 'flux-schnell' slug is already in the registry
  await assert.rejects(
    () => api.saveFlow(auctor, { modusId: 'flux-schnell', name: 'flux-schnell' }),
    (e: unknown) => e instanceof ApiError && e.code === 'conflict.slug_taken',
  )
})

test('saveFlow fromRun that the auctor does not own throws not_found.run', async () => {
  const { deps } = makeDeps()
  const api = new CrystalApi(deps)

  await assert.rejects(
    () => api.saveFlow({ animaId: 'someone-else' }, { fromRun: 'act-known', name: 'My Flow' }),
    (e: unknown) => e instanceof ApiError && e.code === 'not_found.run',
  )
})

// ── bind ──────────────────────────────────────────────────────────────────────

test('bind with an unknown verb throws input.malformed', async () => {
  const { deps } = makeDeps({ consuetudinum: new (await import('../../../../src/crystal/MemoryConsuetudinum.js')).MemoryConsuetudinum() })
  const api = new CrystalApi(deps)

  await assert.rejects(
    () => api.bind(auctor, 'nope', 'flux-schnell'),
    (e: unknown) => e instanceof ApiError && e.code === 'input.malformed',
  )
})

test('bind happy path returns { verb, modusId }', async () => {
  const { deps } = makeDeps({ consuetudinum: new (await import('../../../../src/crystal/MemoryConsuetudinum.js')).MemoryConsuetudinum() })
  const api = new CrystalApi(deps)

  const result = await api.bind(auctor, 'make', 'flux-schnell')
  assert.equal(result.verb, 'make')
  assert.equal(result.modusId, 'flux-schnell')
})

// ── status ────────────────────────────────────────────────────────────────────

test('status returns a JSON-safe view with balanceImpetus as a string', async () => {
  const { deps } = makeDeps()
  const api = new CrystalApi(deps)

  const view = await api.status(auctor)
  assert.equal(typeof view.balanceImpetus, 'string', 'balanceImpetus must be a string')
  assert.equal(typeof view.balanceUsd, 'number', 'balanceUsd must be a number')
  assert.ok(Array.isArray(view.gens), 'gens must be an array')
  assert.ok(Array.isArray(view.studios), 'studios must be an array')
  assert.ok(Array.isArray(view.joinable), 'joinable must be an array')
  assert.ok(typeof view.takenAt === 'string', 'takenAt must be a string')
})
