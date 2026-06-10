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

// ── Build the deps ring. Records the last modusId that was dispatched. ───────
function makeDeps(over: Partial<CrystalApiDeps> = {}): {
  deps: CrystalApiDeps
  dispatched: { modusId?: string }
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
      history: async (by: AuctorKey) =>
        'animaId' in by && by.animaId === 'anima-1' ? [{ id: 'sig-1' }] : [],
    } as unknown) as CrystalApiDeps['signorum'],
    ...over,
  }

  return { deps, dispatched }
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
  const anonDeps = { ...deps, signorum: ({ history: async () => [{ id: 'sig-1' }] } as unknown) as CrystalApiDeps['signorum'] }
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
