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
import { spicyModelFor, SPICY_MODEL_OVERRIDES } from '../../../../src/crystal/spicyRouting.js'
import type { Actum } from '../../../../src/types/actum.js'
import type { Modus } from '../../../../src/types/modus.js'
import type { Inceptio, Cursor } from '../../../../src/types/cursus.js'
import type { AuctorKey } from '../../../../src/flow/types.js'
import type { Fundamentum } from '../../../../src/types/fundamentum.js'
import type { Intelligens, Intella } from '../../../../src/types/intelligendi.js'
import type { StudioHandle } from '../../../../src/crystal/Conductor.js'
import type { Depositum } from '../../../../src/types/catena.js'
import type { Persona } from '../../../../src/types/persona.js'

const auctor: AuctorKey = { animaId: 'anima-1' }

// ── A minimal canonical atomic modus factory ───────────────────────────────
function makeModus(id: string, over: Partial<Modus> = {}): Modus {
  return {
    id,
    nomen: id,
    genus: 'atomicus',
    versio: '1.0.0',
    contentHash: `sha256:${id}`,
    // Declares the ports these tests actually submit. The run-submit boundary refuses a key the
    // resolved modus does not declare, so a double that under-declares would refuse its own
    // fixture; `model` is an optional port on the live modi that accept one.
    aditus: {
      prompt: { type: 'text', required: true },
      model: { type: 'text', required: false },
    },
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
    expirat: new Date('2026-06-10T01:00:00Z'),
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

// ── Klein-shaped fixtures — a Fundamentum carrying the family-bearing base
// weight, and a synthetic Modus (klein-shaped: no own intellae, fundamentumId
// FK to the Fundamentum) for the describeFlow familia-union tests below. ────
const fundFlux2Klein: Fundamentum = {
  id: 'flux2-klein-4b-comfyui',
  nomen: 'FLUX.2 Klein 4B · ComfyUI',
  versio: '1.1.0',
  imageId: 'runpod/pytorch',
  imageVersion: '2.1.0',
  runtime: 'ComfyUI',
  vramGb: 24,
  canonica: true,
  intellae: [{ id: 'flux2-klein-base', role: 'unet' }],
  natum: new Date('2026-01-01'),
  mutatum: new Date('2026-01-01'),
}

const fundWeightless: Fundamentum = {
  id: 'weightless-fund',
  nomen: 'Weightless substrate',
  versio: '1.0.0',
  imageId: 'runpod/pytorch',
  imageVersion: '2.1.0',
  canonica: true,
  natum: new Date('2026-01-01'),
  mutatum: new Date('2026-01-01'),
}

function makeIntella(over: Partial<Intella> = {}): Intella {
  return {
    id: 'flux2-klein-base',
    nomen: 'FLUX.2 Klein base',
    genus: 'model',
    architectura: 'dit',
    parametri: 4_000_000_000,
    sources: [],
    dest: 'unet/flux2-klein.safetensors',
    sizeGb: 8,
    versio: '1.0.0',
    canonica: true,
    familia: 'flux2',
    natum: new Date('2026-01-01'),
    ...over,
  }
}

// ── Fake intellarum (the store `listModels`/`listMyModels` read) ─────────────
const fakeIntellae: Intella[] = [
  makeIntella({ id: 'flux-dev', nomen: 'FLUX Dev', genus: 'model', familia: 'flux', canonica: true }),
  makeIntella({ id: 'sd15-base', nomen: 'SD 1.5 Base', genus: 'model', familia: 'sd15', canonica: true }),
  makeIntella({ id: 'flux-lora-1', nomen: 'Flux LoRA 1', genus: 'lora', familia: 'flux', trigger: 'flux-portrait', canonica: true }),
]

function makeFakeIntellarum(fixtures: Intella[] = fakeIntellae): CrystalApiDeps['intellarum'] {
  return ({
    find: async (id: string) => fixtures.find((i) => i.id === id) ?? null,
    list: async () => fixtures,
    canonical: async () => fixtures.filter((i) => i.canonica),
  } as unknown) as CrystalApiDeps['intellarum']
}

// ── Build the deps ring. Records the last modusId that was dispatched. ───────
function makeDeps(over: Partial<CrystalApiDeps> = {}): {
  deps: CrystalApiDeps
  dispatched: { modusId?: string; modoId?: string }
  modi: Record<string, Modus>
} {
  const dispatched: { modusId?: string; modoId?: string } = {}

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
        dispatched.modoId = inceptio.modoId
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
      findByCallbackNonce: async () => null,
      findByNullifier: async () => null,
      findExpired: async () => [],
      findInFlight: async () => [],
      findByCompositum: async () => [],
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
    intellarum: makeFakeIntellarum(),
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

test('invokeFlow refuses a prompt the CSAM prompt guard rejects (content.refused, no dispatch)', async () => {
  const { deps, dispatched } = makeDeps({
    promptGuard: { async check() { return { ok: false, reason: 'sexual content involving minors is prohibited' } } },
  })
  const api = new CrystalApi(deps)
  await assert.rejects(
    () => api.invokeFlow(auctor, { modusId: 'sd1-5' }, { prompt: 'anything' }),
    (err: unknown) => (err as { code?: string }).code === 'content.refused',
  )
  assert.equal(dispatched.modusId, undefined, 'nothing should have dispatched')
})

test('invokeFlow fails OPEN when the prompt guard itself throws (generation proceeds)', async () => {
  const { deps, dispatched } = makeDeps({
    promptGuard: { async check() { throw new Error('guard exploded') } },
  })
  const api = new CrystalApi(deps)
  const run = await api.invokeFlow(auctor, { modusId: 'sd1-5' }, { prompt: 'hi' })
  assert.equal(run.status, 'complete')
  assert.equal(dispatched.modusId, 'sd1-5', 'a guard error must not block generation')
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

// A cursorum whose `reserve` is counted — lets a test prove a refusal locked no signa.
function countingCursorum(counter: { reserves: number }): CrystalApiDeps['cursorum'] {
  return ({
    register: () => {},
    resolve: () => ({
      reserve: async () => { counter.reserves += 1; return 5n },
      run: async () => ({ kind: 'sync', exitus: { exitus: { image: 'x' }, impetus: 5n } }),
    }),
  } as unknown) as CrystalApiDeps['cursorum']
}

// A conductor that hosts exactly one studio for the caller — everything else is "not yours",
// which is what `Conductor.getStudio` returns on a hostKey mismatch.
function conductorHosting(studioId: string): CrystalApiDeps['conductor'] {
  return makeConductor({
    getStudio: async (id: string) => (id === studioId ? makeHandle({ studioId: id }) : null),
  }).conductor
}

test('invokeFlow with a studioId the caller hosts targets that studio (Inceptio.modoId)', async () => {
  const { deps, dispatched } = makeDeps({ conductor: conductorHosting('modo-123') })
  const api = new CrystalApi(deps)

  await api.invokeFlow(auctor, { modusId: 'sd1-5' }, { prompt: 'hi' }, { studioId: 'modo-123' })

  assert.equal(dispatched.modoId, 'modo-123', 'studioId routes to the Modo session')

  // No studioId → a cold (modoId-less) run.
  await api.invokeFlow(auctor, { modusId: 'sd1-5' }, { prompt: 'hi' })
  assert.equal(dispatched.modoId, undefined)
})

test('invokeFlow refuses a studioId the caller does not host — before any signa or actum', async () => {
  const counter = { reserves: 0 }
  const { deps, dispatched } = makeDeps({
    conductor: conductorHosting('modo-mine'),
    cursorum: countingCursorum(counter),
  })
  const api = new CrystalApi(deps)

  await assert.rejects(
    () => api.invokeFlow(auctor, { modusId: 'sd1-5' }, { prompt: 'hi' }, { studioId: 'modo-theirs' }),
    (e: unknown) => e instanceof ApiError && e.code === 'not_found.studio',
    'a studio the caller does not host is not_found, never bound',
  )

  assert.equal(dispatched.modusId, undefined, 'no actum was initiated')
  assert.equal(dispatched.modoId, undefined, 'no foreign Modo was bound')
  assert.equal(counter.reserves, 0, 'no signa were reserved')
})

test('invokeFlow with no studioId is unaffected by the ownership gate', async () => {
  const { deps, dispatched } = makeDeps()
  const api = new CrystalApi(deps)

  const run = await api.invokeFlow(auctor, { modusId: 'sd1-5' }, { prompt: 'hi' })

  assert.equal(run.status, 'complete', 'an ordinary cold run still dispatches with no conductor wired')
  assert.equal(dispatched.modusId, 'sd1-5')
  assert.equal(dispatched.modoId, undefined)
})

test('invokeFlow fails CLOSED on a studioId when no conductor is wired', async () => {
  const { deps, dispatched } = makeDeps()
  const api = new CrystalApi(deps)

  await assert.rejects(
    () => api.invokeFlow(auctor, { modusId: 'sd1-5' }, { prompt: 'hi' }, { studioId: 'modo-123' }),
    (e: unknown) => e instanceof ApiError && e.code === 'not_found.studio',
    'nothing can affirm ownership, so the studio is refused rather than bound',
  )
  assert.equal(dispatched.modusId, undefined, 'no actum was initiated')
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

test('listFlows returns canonical atomic flows AND compositus spells, excluding non-canonica', async () => {
  const { deps } = makeDeps()
  const api = new CrystalApi(deps)

  const flows = await api.listFlows()
  const ids = flows.map((f) => f.id).sort()

  // spell-x (compositus, canonica) IS now listed; community-y (canonica:false) is not.
  assert.deepEqual(ids, ['flux-schnell', 'sd1-5', 'spell-x', 'verb-bound'])
  const flux = flows.find((f) => f.id === 'flux-schnell')!
  assert.equal(flux.nomen, 'FLUX Schnell')
  assert.equal(flux.versio, '1.0.0')
  assert.equal(flux.steps, undefined, 'an atomic flow surfaces no step count')
  const spell = flows.find((f) => f.id === 'spell-x')!
  assert.equal(typeof spell.steps, 'number', 'a compositus surfaces its step count')
})

test('getRun: a cost-free compositus parent is owned via its child steps (ADR-0008)', async () => {
  // The parent (spell run) holds NO signa — the child step consumed the owner's 'sig-1'.
  const parent = nascens({ modusId: 'spell-x', aditus: {}, by: auctor })
  parent.signaConsumed = []  // cost-free umbrella — holds no signa of its own
  const child = { ...parent, id: `${parent.id}-step0`, signaConsumed: ['sig-1'], compositum: { parentId: parent.id, ordine: 0 } }
  const { deps } = makeDeps({
    actorum: ({
      findById: async (id: string) => (id === parent.id ? parent : null),
      findByCompositum: async (pid: string) => (pid === parent.id ? [child] : []),
      create: async () => { throw new Error('unused') },
      update: async () => { throw new Error('unused') },
      findByExternusJobId: async () => null,
      findByNullifier: async () => null,
      findExpired: async () => [],
      findInFlight: async () => [],
    } as unknown) as CrystalApiDeps['actorum'],
  })
  const api = new CrystalApi(deps)

  // Owner (owns sig-1, consumed by the child) can fetch the parent run.
  const run = await api.getRun(auctor, parent.id)
  assert.equal(run.id, parent.id)

  // A non-owner still cannot (no IDOR via the children).
  await assert.rejects(
    () => api.getRun({ animaId: 'someone-else' }, parent.id),
    (e: unknown) => e instanceof ApiError && e.code === 'not_found.run',
  )
})

// ── cancelRun (POST /v1/runs/:id/cancel) ────────────────────────────────────

/**
 * A run store + completor pair that actually settle, so a cancel is observable. The completor
 * double mirrors the real one's terminal guard (terminal in → the record back, untouched, no
 * second release), so idempotency is asserted against the same shape production has.
 */
function makeCancellableRun(status: Actum['status'] = 'agens') {
  const act: Actum = {
    ...nascens({ modusId: 'flux-schnell', aditus: {}, by: auctor }),
    id: 'act-live',
    status,
    ...(status === 'completus' ? { exitus: { image: 'x' }, impetus: 5n } : {}),
  }
  const failedWith: string[] = []
  const actorum = ({
    findById: async (id: string) => (id === act.id ? act : null),
    findByCompositum: async () => [],
    create: async () => { throw new Error('unused') },
    update: async () => { throw new Error('unused') },
    findByExternusJobId: async () => null,
    findByCallbackNonce: async () => null,
    findByNullifier: async () => null,
    findExpired: async () => [],
    findInFlight: async () => [],
  } as unknown) as CrystalApiDeps['actorum']
  const completor: CrystalApiDeps['completor'] = {
    complete: async (a: Actum) => a,
    fail: async (a: Actum, error: string) => {
      failedWith.push(error)
      if (act.status === 'completus' || act.status === 'fractus') return act
      act.status = 'fractus'
      act.error = error
      act.completum = new Date('2026-06-10T00:02:00Z')
      return act
    },
  }
  return { act, failedWith, actorum, completor }
}

test('cancelRun settles an in-flight run the caller owns through completor.fail', async () => {
  const { act, failedWith, actorum, completor } = makeCancellableRun('agens')
  const { deps } = makeDeps({ actorum, completor })
  const api = new CrystalApi(deps)

  const run = await api.cancelRun(auctor, 'act-live')

  assert.equal(failedWith.length, 1, 'settlement runs through the completor, not a second cancel path')
  assert.equal(act.status, 'fractus')
  assert.equal(run.id, 'act-live')
  assert.equal(run.status, 'failed', 'the terminal view comes back, the same projection GET /v1/runs/:id returns')
})

test('cancelRun refuses a stranger — not_found.run, never forbidden, and nothing is settled', async () => {
  const { act, failedWith, actorum, completor } = makeCancellableRun('agens')
  const { deps } = makeDeps({ actorum, completor })
  const api = new CrystalApi(deps)

  await assert.rejects(
    () => api.cancelRun({ animaId: 'someone-else' }, 'act-live'),
    (e: unknown) => e instanceof ApiError && e.code === 'not_found.run',
  )
  assert.equal(failedWith.length, 0, "a stranger's cancel must not reach settlement")
  assert.equal(act.status, 'agens', 'the run keeps running')

  // An unknown id is indistinguishable from an unowned one — run ids stay non-enumerable.
  await assert.rejects(
    () => api.cancelRun(auctor, 'ghost'),
    (e: unknown) => e instanceof ApiError && e.code === 'not_found.run',
  )
})

test('cancelRun is idempotent — a second cancel returns the same terminal view, no second settle', async () => {
  const { failedWith, actorum, completor } = makeCancellableRun('agens')
  const { deps } = makeDeps({ actorum, completor })
  const api = new CrystalApi(deps)

  const first = await api.cancelRun(auctor, 'act-live')
  const second = await api.cancelRun(auctor, 'act-live')

  assert.equal(first.status, 'failed')
  assert.deepEqual(second, first, 'the same terminal view, 200')
  assert.equal(failedWith.length, 1, 'the already-terminal run is not settled a second time')
})

test('cancelRun leaves a completed run untouched and returns it as it stands', async () => {
  const { act, failedWith, actorum, completor } = makeCancellableRun('completus')
  const { deps } = makeDeps({ actorum, completor })
  const api = new CrystalApi(deps)

  const run = await api.cancelRun(auctor, 'act-live')

  assert.equal(failedWith.length, 0, 'a settled run is never re-settled — nothing to refund')
  assert.equal(act.status, 'completus')
  assert.equal(run.status, 'complete')
  assert.deepEqual(run.exitus, { image: 'x' }, 'the outputs of a finished run survive a late cancel')
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

test('describeFlow derives familia from the linked Fundamentum when the Modus declares no own intellae (klein-shaped)', async () => {
  const { deps, modi } = makeDeps({
    fundamentorum: ({
      find: async (id: string) => [fundFlux2Klein, fundWeightless].find((f) => f.id === id) ?? null,
      register: async () => {},
      list: async () => [fundFlux2Klein, fundWeightless],
    } as unknown) as CrystalApiDeps['fundamentorum'],
    intellarum: ({
      find: async (id: string) => (id === 'flux2-klein-base' ? makeIntella() : null),
    } as unknown) as CrystalApiDeps['intellarum'],
  })
  // Klein-shaped: no own `intellae` (undefined), fundamentumId FK to a Fundamentum
  // that DOES carry the family-bearing base weight. `fundamentumId` rides on the
  // record beyond the Modus type the same way Essentia (which extends Modus) does
  // in production — describeFlow reads it via a runtime cast, not the Modus type.
  modi['klein-shaped'] = {
    ...makeModus('klein-shaped'),
    intellae: undefined,
    fundamentumId: 'flux2-klein-4b-comfyui',
  } as unknown as Modus
  const api = new CrystalApi(deps)

  const desc = await api.describeFlow('klein-shaped')
  assert.equal(desc.familia, 'flux2')
})

test('describeFlow leaves familia undefined when neither the Modus nor its linked Fundamentum carry intellae', async () => {
  const { deps, modi } = makeDeps({
    fundamentorum: ({
      find: async (id: string) => (id === 'weightless-fund' ? fundWeightless : null),
      register: async () => {},
      list: async () => [fundWeightless],
    } as unknown) as CrystalApiDeps['fundamentorum'],
    intellarum: ({
      find: async () => null,
    } as unknown) as CrystalApiDeps['intellarum'],
  })
  modi['no-family'] = {
    ...makeModus('no-family'),
    intellae: undefined,
    fundamentumId: 'weightless-fund',
  } as unknown as Modus
  const api = new CrystalApi(deps)

  const desc = await api.describeFlow('no-family')
  assert.equal(desc.familia, undefined)
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
  assert.equal(models[0].trigger, 'flux-portrait')
})

test('listModels free-text search via q', async () => {
  const { deps } = makeDeps()
  const api = new CrystalApi(deps)

  const models = await api.listModels({ q: 'FLUX Dev' } as never)
  assert.equal(models.length, 1)
  assert.equal(models[0].intellaId, 'flux-dev')
})

test('listModels free-text search via q matches a tag when nomen/description do not', async () => {
  const animeLora = makeIntella({
    id: 'anime-lora',
    nomen: 'Widened Style LoRA',
    genus: 'lora',
    familia: 'flux',
    canonica: true,
    tags: [{ tag: 'anime', source: 'curator' }],
  })
  const { deps } = makeDeps({ intellarum: makeFakeIntellarum([...fakeIntellae, animeLora]) })
  const api = new CrystalApi(deps)

  const models = await api.listModels({ q: 'anime' } as never)
  assert.equal(models.length, 1)
  assert.equal(models[0].intellaId, 'anime-lora')
})

test('listModels free-text search via q matches a sample prompt when nomen/description/tags do not', async () => {
  const sampledLora = makeIntella({
    id: 'sampled-lora',
    nomen: 'Sampled Style LoRA',
    genus: 'lora',
    familia: 'flux',
    canonica: true,
    samples: [{ url: 'https://example.com/sample.png', prompt: 'a low-poly retro game screenshot' }],
  })
  const { deps } = makeDeps({ intellarum: makeFakeIntellarum([...fakeIntellae, sampledLora]) })
  const api = new CrystalApi(deps)

  const models = await api.listModels({ q: 'low-poly retro' } as never)
  assert.equal(models.length, 1)
  assert.equal(models[0].intellaId, 'sampled-lora')
})

test('listModels never returns access/license/commercialUse (public catalog projection)', async () => {
  const { deps } = makeDeps()
  const api = new CrystalApi(deps)

  const models = await api.listModels()
  for (const m of models) {
    assert.equal('access' in m, false)
    assert.equal('license' in m, false)
    assert.equal('commercialUse' in m, false)
  }
})

test('listModels DOES return contentRating (catalog-visible, not stripped from the public projection)', async () => {
  const rated = makeIntella({
    id: 'rated-flux',
    nomen: 'Rated Flux',
    genus: 'model',
    familia: 'flux',
    canonica: true,
    contentRating: 'sfw',
  })
  const { deps } = makeDeps({ intellarum: makeFakeIntellarum([...fakeIntellae, rated]) })
  const api = new CrystalApi(deps)

  const models = await api.listModels()
  const m = models.find((x) => x.intellaId === 'rated-flux')!
  assert.ok(m, 'rated-flux present')
  assert.equal('contentRating' in m, true)
  assert.equal(m.contentRating, 'sfw')
})

test('listMyModels surfaces contentRating: untriaged on an imported (non-canonical) model', async () => {
  const imported = makeIntella({
    id: 'imported-lora',
    nomen: 'Imported LoRA',
    genus: 'lora',
    familia: 'flux',
    canonica: false,
    ownerAnimaId: 'anima-1',
    contentRating: 'untriaged',
  })
  const { deps } = makeDeps({ intellarum: makeFakeIntellarum([...fakeIntellae, imported]) })
  const api = new CrystalApi(deps)

  const models = await api.listMyModels(auctor)
  const m = models.find((x) => x.intellaId === 'imported-lora')!
  assert.ok(m, 'imported-lora present')
  assert.equal(m.contentRating, 'untriaged')
})

test('listModels surfaces a canonical public flux2 model by basis (klein-highlight regression)', async () => {
  const impresstation = makeIntella({
    id: 'impresstation',
    nomen: 'impresstation',
    genus: 'lora',
    familia: 'flux2',
    trigger: 'stationthis',
    canonica: true,
  })
  const { deps } = makeDeps({ intellarum: makeFakeIntellarum([...fakeIntellae, impresstation]) })
  const api = new CrystalApi(deps)

  const models = await api.listModels({ basis: 'flux2' } as never)
  assert.equal(models.length, 1)
  assert.equal(models[0].basis, 'flux2')
  assert.equal(models[0].trigger, 'stationthis')
})

test('listModels round-trips slug/defaultWeight/samples/tags', async () => {
  const widened = makeIntella({
    id: 'widened-lora',
    nomen: 'Widened LoRA',
    genus: 'lora',
    familia: 'flux',
    trigger: 'widened-trigger',
    canonica: true,
    slug: 'widened-lora',
    defaultWeight: 0.8,
    samples: [{ url: 'https://example.com/sample.png', prompt: 'a widened lora sample' }],
    tags: [{ tag: 'flux', source: 'catalog' }],
  })
  const { deps } = makeDeps({ intellarum: makeFakeIntellarum([...fakeIntellae, widened]) })
  const api = new CrystalApi(deps)

  const models = await api.listModels({ basis: 'flux' } as never)
  const m = models.find((x) => x.intellaId === 'widened-lora')!
  assert.ok(m, 'widened-lora present')
  assert.equal(m.slug, 'widened-lora')
  assert.equal(m.defaultWeight, 0.8)
  assert.deepEqual(m.samples, [{ url: 'https://example.com/sample.png', prompt: 'a widened lora sample' }])
  assert.deepEqual(m.tags, [{ tag: 'flux', source: 'catalog' }])
})

test('listModels trigger filter matches a single alias in a comma-joined trigger field', async () => {
  const multiAlias = makeIntella({
    id: 'multi-alias-lora',
    nomen: 'Multi Alias LoRA',
    genus: 'lora',
    familia: 'flux',
    trigger: 'milady,mld',
    canonica: true,
  })
  const { deps } = makeDeps({ intellarum: makeFakeIntellarum([...fakeIntellae, multiAlias]) })
  const api = new CrystalApi(deps)

  const hits = await api.listModels({ trigger: 'mld' } as never)
  assert.equal(hits.length, 1)
  assert.equal(hits[0].intellaId, 'multi-alias-lora')

  const misses = await api.listModels({ trigger: 'notanalias' } as never)
  assert.equal(misses.find((m) => m.intellaId === 'multi-alias-lora'), undefined)
})

// ── listModels(auctor) — owner-inclusive union (noema-116) ──────────────────
test('listModels with auctor finds the caller\'s own imported (non-canonical) model by trigger', async () => {
  const owned = makeIntella({
    id: 'valkyriesorder-lora',
    nomen: 'Valkyries Order',
    genus: 'lora',
    familia: 'flux',
    trigger: 'valkyriesorder',
    canonica: false,
    ownerAnimaId: 'anima-1',
  })
  const { deps } = makeDeps({ intellarum: makeFakeIntellarum([...fakeIntellae, owned]) })
  const api = new CrystalApi(deps)

  const byTrigger = await api.listModels({ trigger: 'valkyriesorder', auctor } as never)
  assert.equal(byTrigger.length, 1)
  assert.equal(byTrigger[0].intellaId, 'valkyriesorder-lora')

  const byQ = await api.listModels({ q: 'Valkyries', auctor } as never)
  assert.ok(byQ.some((m) => m.intellaId === 'valkyriesorder-lora'))
})

test('listModels with auctor does NOT surface a different owner\'s private import', async () => {
  const owned = makeIntella({
    id: 'valkyriesorder-lora',
    nomen: 'Valkyries Order',
    genus: 'lora',
    familia: 'flux',
    trigger: 'valkyriesorder',
    canonica: false,
    ownerAnimaId: 'anima-1',
  })
  const { deps } = makeDeps({ intellarum: makeFakeIntellarum([...fakeIntellae, owned]) })
  const api = new CrystalApi(deps)

  const otherAuctor: AuctorKey = { animaId: 'anima-2' }
  const hits = await api.listModels({ trigger: 'valkyriesorder', auctor: otherAuctor } as never)
  assert.equal(hits.find((m) => m.intellaId === 'valkyriesorder-lora'), undefined)
})

test('listModels with auctor leaves canonical results unchanged and does not duplicate an owned+canonical model', async () => {
  const ownedCanonical = makeIntella({
    id: 'flux-lora-1', // same id as an existing canonical fixture
    nomen: 'Flux LoRA 1',
    genus: 'lora',
    familia: 'flux',
    trigger: 'flux-portrait',
    canonica: true,
    ownerAnimaId: 'anima-1',
  })
  const { deps } = makeDeps({ intellarum: makeFakeIntellarum([...fakeIntellae.filter((i) => i.id !== 'flux-lora-1'), ownedCanonical]) })
  const api = new CrystalApi(deps)

  const hits = await api.listModels({ trigger: 'flux-portrait', auctor } as never)
  assert.equal(hits.length, 1, 'no duplicate when a model is both canonical and owned by the caller')
  assert.equal(hits[0].intellaId, 'flux-lora-1')
})

test('listModels without auctor is unchanged (public-only, canonical results identical)', async () => {
  const owned = makeIntella({
    id: 'valkyriesorder-lora',
    nomen: 'Valkyries Order',
    genus: 'lora',
    familia: 'flux',
    trigger: 'valkyriesorder',
    canonica: false,
    ownerAnimaId: 'anima-1',
  })
  const { deps } = makeDeps({ intellarum: makeFakeIntellarum([...fakeIntellae, owned]) })
  const api = new CrystalApi(deps)

  const models = await api.listModels()
  assert.equal(models.find((m) => m.intellaId === 'valkyriesorder-lora'), undefined)
  assert.equal(models.length, fakeIntellae.length)
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

// ── invokeFlow keyMaxImpetusPerRun — the ceiling the CREDENTIAL carries ────────
//
// `keyMaxImpetusPerRun` is minted onto a partner's API key; `maxImpetus` is what the request
// asked for. Admission applies the MINIMUM of the two, which is what makes the key's ceiling
// unbypassable — `min` can only tighten. Reservation is 5n throughout, as above.

test('invokeFlow: a key ceiling BELOW the reservation throws economy.cap_too_low', async () => {
  const { deps } = makeDeps()
  const api = new CrystalApi(deps)

  // reserve = 5n; key ceiling = 4n; the caller asked for no cap at all → refused.
  await assert.rejects(
    () => api.invokeFlow(auctor, { modusId: 'flux-schnell' }, { prompt: 'hi' }, { keyMaxImpetusPerRun: 4n }),
    (e: unknown) => {
      // The EXISTING cap contract, not a new one: same code, same status, same details keys.
      assert.ok(e instanceof ApiError)
      assert.equal(e.code, 'economy.cap_too_low')
      assert.equal(e.httpStatus, 422)
      assert.deepEqual(e.opts.details, { estimated: '5', maxImpetus: '4' })
      return true
    },
  )
})

test('invokeFlow: a key ceiling ABOVE the reservation succeeds', async () => {
  const { deps } = makeDeps()
  const api = new CrystalApi(deps)

  // reserve = 5n; key ceiling = 10n → admitted.
  const run = await api.invokeFlow(auctor, { modusId: 'flux-schnell' }, { prompt: 'hi' }, { keyMaxImpetusPerRun: 10n })
  assert.equal(run.status, 'complete')
})

test('invokeFlow: a caller maxImpetus ABOVE the key ceiling does NOT lift it', async () => {
  const { deps } = makeDeps()
  const api = new CrystalApi(deps)

  // reserve = 5n; the caller asks for 1_000_000n, the key allows 4n. If the caller's number won,
  // this run would be admitted and real money would move past the partner's own limit.
  await assert.rejects(
    () => api.invokeFlow(
      auctor,
      { modusId: 'flux-schnell' },
      { prompt: 'hi' },
      { maxImpetus: 1_000_000n, keyMaxImpetusPerRun: 4n },
    ),
    (e: unknown) => {
      assert.ok(e instanceof ApiError)
      assert.equal(e.code, 'economy.cap_too_low')
      // The KEY's ceiling is what bound the request, and it is what gets reported.
      assert.deepEqual(e.opts.details, { estimated: '5', maxImpetus: '4' })
      return true
    },
  )
})

test('invokeFlow: a caller maxImpetus BELOW the key ceiling still binds', async () => {
  const { deps } = makeDeps()
  const api = new CrystalApi(deps)

  // reserve = 5n; caller cap 4n, key ceiling 1_000_000n. The key's ceiling never LOOSENS a
  // tighter cap the caller set on itself — `min` runs in both directions.
  await assert.rejects(
    () => api.invokeFlow(
      auctor,
      { modusId: 'flux-schnell' },
      { prompt: 'hi' },
      { maxImpetus: 4n, keyMaxImpetusPerRun: 1_000_000n },
    ),
    (e: unknown) => {
      assert.ok(e instanceof ApiError)
      assert.equal(e.code, 'economy.cap_too_low')
      assert.deepEqual(e.opts.details, { estimated: '5', maxImpetus: '4' })
      return true
    },
  )
})

test('invokeFlow: a run inside BOTH caps is admitted', async () => {
  const { deps } = makeDeps()
  const api = new CrystalApi(deps)

  // reserve = 5n; caller cap 10n, key ceiling 1_000_000n → the tighter one is 10n, which admits.
  const run = await api.invokeFlow(
    auctor,
    { modusId: 'flux-schnell' },
    { prompt: 'hi' },
    { maxImpetus: 10n, keyMaxImpetusPerRun: 1_000_000n },
  )
  assert.equal(run.status, 'complete')
})

// ── The regression bar: a credential with NO ceiling behaves exactly as before ─
//
// This is the assertion that matters most on this change. Every existing API key, and every
// caller that authenticates any other way, resolves with `keyMaxImpetusPerRun` absent — and for
// them admission must be bit-for-bit the check it has always been.

test('invokeFlow: with no key ceiling, admission is unchanged in all three of its states', async () => {
  const { deps } = makeDeps()
  const api = new CrystalApi(deps)

  // 1. No cap of any kind → no estimate gate at all, exactly as before the field existed.
  const uncapped = await api.invokeFlow(auctor, { modusId: 'flux-schnell' }, { prompt: 'hi' })
  assert.equal(uncapped.status, 'complete')

  // 2. A caller cap above the reservation → admitted, unchanged.
  const capped = await api.invokeFlow(auctor, { modusId: 'flux-schnell' }, { prompt: 'hi' }, { maxImpetus: 10n })
  assert.equal(capped.status, 'complete')

  // 3. A caller cap below the reservation → the same refusal, with the same details body the
  //    pre-existing error carried (the caller's cap echoed as the caller wrote it).
  await assert.rejects(
    () => api.invokeFlow(auctor, { modusId: 'flux-schnell' }, { prompt: 'hi' }, { maxImpetus: '4' }),
    (e: unknown) => {
      assert.ok(e instanceof ApiError)
      assert.equal(e.code, 'economy.cap_too_low')
      assert.deepEqual(e.opts.details, { estimated: '5', maxImpetus: '4' })
      return true
    },
  )
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

test('status JSON-projects a studio-bearing snapshot — netImpetus (bigint) is stringified', async () => {
  // Regression: once a studio is host-attributed (ADR-0006 fix), buildStudios emits a
  // StudioEntry with a bigint `netImpetus`; the view must stay JSON-safe (res.json throws on bigint).
  const materia = { id: 'mat-1', gpu: 'NVIDIA GeForce RTX 4090', imageRef: 'img:1', status: 'idle', warmUntil: new Date('2026-06-10T01:00:00Z') }
  const { deps } = makeDeps({
    hospitia: ({
      findActive: async () => [{ id: 'h-1', materiaId: 'mat-1', hostKey: auctor, inceptum: new Date(), costAccrued: 5n }],
      findByMateriaId: async () => null,
    } as unknown) as CrystalApiDeps['hospitia'],
    materiae: ({ findById: async (id: string) => (id === 'mat-1' ? materia : null) } as unknown) as CrystalApiDeps['materiae'],
  })
  const api = new CrystalApi(deps)

  const view = await api.status(auctor)
  assert.equal(view.studios.length, 1, 'the host-attributed studio appears')
  assert.equal(typeof (view.studios[0] as { netImpetus: unknown }).netImpetus, 'string', 'netImpetus must be stringified')
  assert.doesNotThrow(() => JSON.stringify(view), 'the whole status view must be JSON-safe (no raw bigint)')
})

test('status keys a studio by its bound Modo id when modos is wired (matches /v1/studios)', async () => {
  const materia = { id: 'mat-1', gpu: 'RTX 4090', imageRef: 'img:1', status: 'idle', warmUntil: new Date('2026-06-10T01:00:00Z') }
  const { deps } = makeDeps({
    hospitia: ({
      findActive: async () => [{ id: 'h-1', materiaId: 'mat-1', hostKey: auctor, inceptum: new Date() }],
      findByMateriaId: async () => null,
    } as unknown) as CrystalApiDeps['hospitia'],
    materiae: ({ findById: async (id: string) => (id === 'mat-1' ? materia : null) } as unknown) as CrystalApiDeps['materiae'],
    modos: ({ findActive: async () => [{ id: 'modo-1', materiamId: 'mat-1', status: 'idle' }] } as unknown) as CrystalApiDeps['modos'],
  })
  const api = new CrystalApi(deps)

  const studio = (await api.status(auctor)).studios[0] as { studioId: string; materiaId: string }
  assert.equal(studio.studioId, 'modo-1', 'studioId is the Modo id — the canonical handle run-targeting uses')
  assert.equal(studio.materiaId, 'mat-1', 'the Materia id is still exposed for pod-level reference')
})

// ── provisionStudio / listStudios ─────────────────────────────────────────────

// A minimal StudioHandle (only the fields toStudioView projects).
function makeHandle(over: { studioId?: string } = {}): StudioHandle {
  return ({
    studioId: over.studioId ?? 'modo-abc',
    modo: { status: 'idle' },
    materia: {
      externusId: 'pod-xyz',
      gpu: 'RTX 4090',
      runtime: 'ComfyUI',
      imageRef: 'runpod/pytorch:2.1.0',
      impetusPerSecond: 2n,
      warmUntil: new Date('2026-06-10T01:00:00Z'),
    },
    provision: { podId: 'pod-xyz', provisionMs: 1234 },
  } as unknown) as StudioHandle
}

// A provisioning (pod-less) handle — what conducereAsync returns immediately.
function makeProvisioningHandle(over: { studioId?: string } = {}): StudioHandle {
  return ({ studioId: over.studioId ?? 'modo-abc', modo: { status: 'claiming' } } as unknown) as StudioHandle
}

// A fake conductor recording the budget it received (provisionStudio is async now).
function makeConductor(
  over: {
    conducereAsync?: (auctor: AuctorKey, opts: { budget: bigint }) => Promise<StudioHandle>
    find?: (auctor: AuctorKey) => Promise<StudioHandle[]>
    getStudio?: (studioId: string, auctor: AuctorKey) => Promise<StudioHandle | null>
    claudere?: (studioId: string, auctor: AuctorKey) => Promise<boolean>
  } = {},
): { conductor: CrystalApiDeps['conductor']; received: { budget?: bigint } } {
  const received: { budget?: bigint } = {}
  const conductor = ({
    conducereAsync: over.conducereAsync ?? (async (_a: AuctorKey, opts: { budget: bigint }) => {
      received.budget = opts.budget
      return makeProvisioningHandle()
    }),
    find: over.find ?? (async () => []),
    getStudio: over.getStudio ?? (async () => null),
    claudere: over.claudere ?? (async () => false),
  } as unknown) as CrystalApiDeps['conductor']
  return { conductor, received }
}

// A fake signorum with balance + sessionBudget (the studio path needs both).
function studioSignorum(over: { balance?: bigint; sessionBudget?: bigint } = {}): CrystalApiDeps['signorum'] {
  return ({
    ownsAny: async () => false,
    balance: async () => over.balance ?? 100n,
    sessionBudget: async () => over.sessionBudget ?? 0n,
    history: async () => [],
  } as unknown) as CrystalApiDeps['signorum']
}

test('provisionStudio returns a provisioning handle immediately (async — pod boots in background)', async () => {
  const { conductor, received } = makeConductor()
  const { deps } = makeDeps({ conductor, signorum: studioSignorum({ balance: 100n }) })
  const api = new CrystalApi(deps)

  const view = await api.provisionStudio(auctor, {})

  assert.equal(view.studioId, 'modo-abc')
  assert.equal(view.status, 'provisioning', 'born provisioning — observe via getStudio')
  assert.equal(view.podId, undefined, 'no pod bound yet')
  // budget = balance (no maxImpetus), projected bigint→string
  assert.equal(view.budgetImpetus, '100')
  assert.equal(received.budget, 100n)
  assert.doesNotThrow(() => JSON.stringify(view), 'JSON-safe')
})

test('provisionStudio without a conductor throws internal.unavailable; listStudios returns []', async () => {
  const { deps } = makeDeps()
  const api = new CrystalApi(deps)

  await assert.rejects(
    () => api.provisionStudio(auctor, {}),
    (e: unknown) => e instanceof ApiError && e.code === 'internal.unavailable',
  )
  assert.deepEqual(await api.listStudios(auctor), [])
})

test('provisionStudio with an unknown fundamentumId throws not_found.fundamentum', async () => {
  const { conductor } = makeConductor()
  const { deps } = makeDeps({ conductor, signorum: studioSignorum() })
  const api = new CrystalApi(deps)

  await assert.rejects(
    () => api.provisionStudio(auctor, { fundamentumId: 'ghost-substrate' }),
    (e: unknown) => e instanceof ApiError && e.code === 'not_found.fundamentum',
  )
})

test('provisionStudio with a zero balance and no maxImpetus throws economy.insufficient_signa', async () => {
  const { conductor } = makeConductor()
  const { deps } = makeDeps({ conductor, signorum: studioSignorum({ balance: 0n }) })
  const api = new CrystalApi(deps)

  await assert.rejects(
    () => api.provisionStudio(auctor, {}),
    (e: unknown) => e instanceof ApiError && e.code === 'economy.insufficient_signa',
  )
})

test('getStudio is owner-scoped — returns the caller\'s studio, not_found.studio for a stranger', async () => {
  const { conductor } = makeConductor({
    getStudio: async (id) => (id === 'modo-x' ? makeHandle({ studioId: 'modo-x' }) : null),
  })
  const { deps } = makeDeps({ conductor, signorum: studioSignorum({ sessionBudget: 50n }) })
  const api = new CrystalApi(deps)

  const view = await api.getStudio(auctor, 'modo-x')
  assert.equal(view.studioId, 'modo-x')
  assert.equal(view.budgetImpetus, '50', 'budget from signorum.sessionBudget')
  await assert.rejects(
    () => api.getStudio(auctor, 'nope'),
    (e: unknown) => e instanceof ApiError && e.code === 'not_found.studio',
  )
})

test('provisionStudio threads maxImpetus as the session budget', async () => {
  const { conductor, received } = makeConductor()
  const { deps } = makeDeps({ conductor, signorum: studioSignorum({ balance: 100n }) })
  const api = new CrystalApi(deps)

  const view = await api.provisionStudio(auctor, { maxImpetus: 42n })
  assert.equal(received.budget, 42n, 'maxImpetus is the session budget passed to conducereAsync')
  assert.equal(view.budgetImpetus, '42')
})

test('listStudios maps conductor.find handles with per-studio sessionBudget', async () => {
  const { conductor } = makeConductor({
    find: async () => [makeHandle({ studioId: 'modo-1' }), makeHandle({ studioId: 'modo-2' })],
  })
  const { deps } = makeDeps({ conductor, signorum: studioSignorum({ sessionBudget: 77n }) })
  const api = new CrystalApi(deps)

  const studios = await api.listStudios(auctor)
  assert.equal(studios.length, 2)
  assert.deepEqual(studios.map((s) => s.studioId).sort(), ['modo-1', 'modo-2'])
  assert.equal(studios[0].budgetImpetus, '77', 'budget comes from signorum.sessionBudget')
})

// ── releaseStudio ──────────────────────────────────────────────────────────────

test('releaseStudio terminates the lease and returns a terminal view, 200', async () => {
  const claims: Array<{ studioId: string }> = []
  const { conductor } = makeConductor({
    claudere: async (studioId) => { claims.push({ studioId }); return true },
  })
  const { deps } = makeDeps({ conductor, signorum: studioSignorum({ sessionBudget: 30n }) })
  const api = new CrystalApi(deps)

  const view = await api.releaseStudio(auctor, 'modo-x')
  assert.equal(view.studioId, 'modo-x')
  assert.equal(view.status, 'terminated')
  assert.equal(view.budgetImpetus, '30')
  assert.deepEqual(claims, [{ studioId: 'modo-x' }])
})

test('releaseStudio is idempotent — a second DELETE returns the same terminal view, 200, no double-settle', async () => {
  let calls = 0
  const { conductor } = makeConductor({
    claudere: async () => { calls++; return true },
  })
  const { deps } = makeDeps({ conductor, signorum: studioSignorum({ sessionBudget: 30n }) })
  const api = new CrystalApi(deps)

  const first = await api.releaseStudio(auctor, 'modo-x')
  const second = await api.releaseStudio(auctor, 'modo-x')
  assert.equal(first.status, 'terminated')
  assert.equal(second.status, 'terminated')
  assert.equal(calls, 2, 'claudere itself is the idempotency guard — safe to call twice')
})

test('releaseStudio refuses a stranger — not_found.studio, no existence leak', async () => {
  const { conductor } = makeConductor({ claudere: async () => false })
  const { deps } = makeDeps({ conductor, signorum: studioSignorum() })
  const api = new CrystalApi(deps)

  await assert.rejects(
    () => api.releaseStudio(auctor, 'modo-x'),
    (e: unknown) => e instanceof ApiError && e.code === 'not_found.studio',
  )
})

test('releaseStudio without a conductor throws not_found.studio', async () => {
  const { deps } = makeDeps()
  const api = new CrystalApi(deps)

  await assert.rejects(
    () => api.releaseStudio(auctor, 'modo-x'),
    (e: unknown) => e instanceof ApiError && e.code === 'not_found.studio',
  )
})

// ── myDeposits (GET /v1/deposit/mine — the deposit-attribution fix) ──────────────

function makePersona(over: Partial<Persona> = {}): Persona {
  return {
    id: over.id ?? 'persona-1',
    activeAnimaId: over.activeAnimaId ?? 'anima-1',
    animaIds: over.animaIds ?? [over.activeAnimaId ?? 'anima-1'],
    genus: over.genus ?? 'web',
    externusId: over.externusId ?? '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    status: over.status ?? 'active',
    natum: over.natum ?? new Date('2026-01-01T00:00:00Z'),
    visum: over.visum ?? new Date('2026-01-01T00:00:00Z'),
  }
}

function makeDepositum(over: Partial<Depositum> = {}): Depositum {
  return {
    id: over.id ?? 'dep-1',
    chainId: over.chainId ?? 1,
    transactioHash: over.transactioHash ?? '0xhash1',
    ab: over.ab ?? '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    ad: over.ad ?? '0xvault',
    valor: over.valor ?? 1000000000000000n,
    confirmationes: over.confirmationes ?? 12,
    status: over.status ?? 'confirmatum',
    natum: over.natum ?? new Date('2026-07-01T00:00:00Z'),
    ...(over.animaId !== undefined ? { animaId: over.animaId } : {}),
  }
}

test('myDeposits returns [] for a commitment/purse auctor — no personae possible for an anon caller', async () => {
  const { deps } = makeDeps({
    personae: { findByAnimaId: async () => { throw new Error('must not be called for a non-animaId auctor') } },
    deposita: { list: async () => { throw new Error('must not be called for a non-animaId auctor') } },
  })
  const api = new CrystalApi(deps)

  assert.deepEqual(await api.myDeposits({ commitment: 'c1' }), [])
})

test('myDeposits returns [] when deposita/personae are not wired', async () => {
  const { deps } = makeDeps()
  const api = new CrystalApi(deps)

  assert.deepEqual(await api.myDeposits(auctor), [])
})

test('myDeposits is owner-scoped — a stranger with no linked wallets sees nothing, even though deposits exist', async () => {
  const { deps } = makeDeps({
    personae: { findByAnimaId: async (animaId) => (animaId === 'anima-1' ? [makePersona()] : []) },
    deposita: { list: async () => [makeDepositum({ id: 'dep-1', ab: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' })] },
  })
  const api = new CrystalApi(deps)

  const stranger = await api.myDeposits({ animaId: 'anima-2' })
  assert.deepEqual(stranger, [])

  const owner = await api.myDeposits(auctor)
  assert.equal(owner.length, 1)
  assert.equal(owner[0].id, 'dep-1')
})

test('myDeposits filters by the caller\'s linked wallet address (case-insensitive), not by animaId alone — surfaces a pre-link parked deposit too', async () => {
  const { deps } = makeDeps({
    personae: { findByAnimaId: async () => [makePersona({ externusId: '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' })] },
    deposita: {
      list: async () => [
        // Mine — uppercase on-chain casing, no animaId yet (parked before the wallet was linked).
        makeDepositum({ id: 'mine-parked', ab: '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', natum: new Date('2026-07-01T00:00:00Z') }),
        // Mine — already attributed + newer.
        makeDepositum({ id: 'mine-credited', ab: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', animaId: 'anima-1', status: 'processatum', natum: new Date('2026-07-05T00:00:00Z') }),
        // A stranger's deposit — must never appear.
        makeDepositum({ id: 'not-mine', ab: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' }),
      ],
    },
  })
  const api = new CrystalApi(deps)

  const result = await api.myDeposits(auctor)
  assert.deepEqual(result.map(d => d.id), ['mine-credited', 'mine-parked'], 'newest first; excludes the stranger row')
  assert.equal(result[0].status, 'processatum')
  assert.equal(result[1].status, 'confirmatum')
})

test('myDeposits ignores a persona whose active anima has since moved elsewhere', async () => {
  const { deps } = makeDeps({
    personae: { findByAnimaId: async () => [makePersona({ activeAnimaId: 'anima-9' })] }, // moved away
    deposita: { list: async () => [makeDepositum({ ab: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' })] },
  })
  const api = new CrystalApi(deps)

  assert.deepEqual(await api.myDeposits(auctor), [])
})

// =============================================================================
// Spicy mode (noema-091) — attestation gate, adult-model filter, alt-model seam,
// and the unconditional PromptGuard invariant. All at the CrystalApi facade layer
// (the gate/filters live here, not in the raw MemoryConsuetudinum store).
// =============================================================================

const anonAuctor: AuctorKey = { commitment: 'anon-1' }

test('setGeneratio REJECTS spicyMode:true with no attestation on file (named + anon), auth.forbidden', async () => {
  for (const who of [auctor, anonAuctor]) {
    const consuetudinum = new MemoryConsuetudinum()
    const { deps } = makeDeps({ consuetudinum })
    const api = new CrystalApi(deps)
    await assert.rejects(
      () => api.setGeneratio(who, { spicyMode: true }),
      (err: unknown) => err instanceof ApiError && err.code === 'auth.forbidden',
      `no attestation ⇒ spicy cannot enable for ${JSON.stringify(who)}`,
    )
    // Nothing spicy was persisted.
    assert.notEqual((await consuetudinum.resolveGeneratio(who))?.spicyMode, true)
  }
})

test('recordAttestation then setGeneratio(spicyMode:true) SUCCEEDS (named + anon)', async () => {
  for (const who of [auctor, anonAuctor]) {
    const consuetudinum = new MemoryConsuetudinum()
    const { deps } = makeDeps({ consuetudinum })
    const api = new CrystalApi(deps)
    const att = await api.recordAttestation(who)
    assert.equal(typeof att.attestedAt, 'number')
    assert.ok(att.attestedAt > 0)
    const g = await api.setGeneratio(who, { spicyMode: true })
    assert.equal(g.spicyMode, true, `attested ⇒ spicy enables for ${JSON.stringify(who)}`)
    assert.deepEqual((await consuetudinum.resolveGeneratio(who))?.ageAttestation, att)
  }
})

test('setGeneratio preserves a recorded attestation across a Preferences replace that omits it', async () => {
  const consuetudinum = new MemoryConsuetudinum()
  const { deps } = makeDeps({ consuetudinum })
  const api = new CrystalApi(deps)
  await api.recordAttestation(auctor)
  // A later Preferences PUT with only style must NOT erase the attestation, and spicy must still enable.
  const g1 = await api.setGeneratio(auctor, { style: 'cinematic' })
  assert.ok(g1.ageAttestation, 'attestation preserved across a wholesale replace')
  const g2 = await api.setGeneratio(auctor, { spicyMode: true })
  assert.equal(g2.spicyMode, true, 'preserved attestation still satisfies the enable gate')
})

test('recordAttestation preserves other Generatio fields', async () => {
  const consuetudinum = new MemoryConsuetudinum()
  const { deps } = makeDeps({ consuetudinum })
  const api = new CrystalApi(deps)
  await consuetudinum.setGeneratio(auctor, { style: 'cinematic', negativePrompt: 'blurry' })
  await api.recordAttestation(auctor)
  const g = await consuetudinum.resolveGeneratio(auctor)
  assert.equal(g?.style, 'cinematic')
  assert.equal(g?.negativePrompt, 'blurry')
  assert.ok(g?.ageAttestation)
})

// ── Lever (a): adult-model catalog filter ──────────────────────────────────────
const ratedIntellae: Intella[] = [
  makeIntella({ id: 'm-untriaged', nomen: 'Untriaged', genus: 'model', familia: 'flux', canonica: true, contentRating: 'untriaged' }),
  makeIntella({ id: 'm-sfw', nomen: 'SFW', genus: 'model', familia: 'flux', canonica: true, contentRating: 'sfw' }),
  makeIntella({ id: 'm-suggestive', nomen: 'Suggestive', genus: 'model', familia: 'flux', canonica: true, contentRating: 'suggestive' }),
  makeIntella({ id: 'm-explicit', nomen: 'Explicit', genus: 'model', familia: 'flux', canonica: true, contentRating: 'explicit' }),
  makeIntella({ id: 'm-unrated', nomen: 'Unrated', genus: 'model', familia: 'flux', canonica: true }),
]

test('listModels OFF (default) EXCLUDES {suggestive, explicit}; includes {untriaged, sfw, unrated}', async () => {
  const { deps } = makeDeps({ intellarum: makeFakeIntellarum(ratedIntellae) })
  const api = new CrystalApi(deps)
  const ids = (await api.listModels({})).map((m) => m.intellaId).sort()
  assert.deepEqual(ids, ['m-sfw', 'm-unrated', 'm-untriaged'])
})

test('listModels ON (includeAdult) INCLUDES all four rating buckets', async () => {
  const { deps } = makeDeps({ intellarum: makeFakeIntellarum(ratedIntellae) })
  const api = new CrystalApi(deps)
  const ids = (await api.listModels({ includeAdult: true })).map((m) => m.intellaId).sort()
  assert.deepEqual(ids, ['m-explicit', 'm-sfw', 'm-suggestive', 'm-unrated', 'm-untriaged'])
})

// ── Lever (b): alt-model routing seam ships EMPTY (a strict no-op) ──────────────
test('spicyRouting ships an EMPTY map — every verb resolves to no override (OFF and empty-map no-op)', () => {
  assert.equal(Object.keys(SPICY_MODEL_OVERRIDES).length, 0, 'shipped empty, per operator Q3')
  for (const id of ['modus.openrouter-chat', 'modus.chatgpt', 'flux-schnell', 'sd1-5', 'verb-bound']) {
    assert.equal(spicyModelFor(id), undefined, `${id} has no override ⇒ normal routing`)
  }
})

test('invokeFlow leaves aditus.model UNTOUCHED when spicyMode is on but the map is empty', async () => {
  const consuetudinum = new MemoryConsuetudinum()
  await consuetudinum.setGeneratio(auctor, { spicyMode: true, ageAttestation: { attestedAt: 1 } })
  const captured: Record<string, unknown>[] = []
  const { deps } = makeDeps({
    consuetudinum,
    inceptor: {
      initiate: async (inceptio: Inceptio) => {
        captured.push(inceptio.aditus)
        return nascens(inceptio)
      },
    },
  })
  const api = new CrystalApi(deps)
  await api.invokeFlow(auctor, { modusId: 'sd1-5' }, { prompt: 'hi', model: 'caller-model' })
  assert.equal(captured.length, 1)
  // Empty map ⇒ our lever-(b) block never fires ⇒ the caller's model passes through unchanged.
  assert.equal(captured[0].model, 'caller-model')
})

// ── Hard invariant: PromptGuard runs UNCONDITIONALLY, spicy or not ─────────────
test('PromptGuard.check is invoked on every invokeFlow regardless of spicyMode', async () => {
  // spicy OFF
  {
    let calls = 0
    const { deps } = makeDeps({ promptGuard: { async check() { calls++; return { ok: true } } } })
    const api = new CrystalApi(deps)
    await api.invokeFlow(auctor, { modusId: 'sd1-5' }, { prompt: 'hi' })
    assert.equal(calls, 1, 'guard runs when spicy is OFF')
  }
  // spicy ON (attested)
  {
    let calls = 0
    const consuetudinum = new MemoryConsuetudinum()
    await consuetudinum.setGeneratio(auctor, { spicyMode: true, ageAttestation: { attestedAt: 1 } })
    const { deps } = makeDeps({ consuetudinum, promptGuard: { async check() { calls++; return { ok: true } } } })
    const api = new CrystalApi(deps)
    await api.invokeFlow(auctor, { modusId: 'sd1-5' }, { prompt: 'hi' })
    assert.equal(calls, 1, 'guard still runs when spicy is ON — no spicyMode gate on the moderation path')
  }
})
