// =============================================================================
// Declared owned-resource references are resolved at EVERY dispatch entry point
// =============================================================================
//
// `Porta.owned` declares that an aditus port names a stored, owner-bearing record, and the
// reference has to be resolved where the caller is still known: an Actum is identity-blind
// (ADR-0002), so a cursor reading the port has no caller left to scope it against.
//
// The REST run route resolved its references already. Two other facades turn a request into
// an `Inceptio` and reach `dispatchInceptio` by their own door, and these tests pin both:
//
//   the execute flow   — `/run <slug>` casts any canonical atomic modus, three of which take
//                        such a reference, with the value typed by the caster.
//   the collection     — `collect` stores an `aditusBase` that is spread into every piece the
//                        fan-out later dispatches, under the collection's FUNDER rather than
//                        the caller who wrote the base; and a flow change re-reads that stored
//                        base through a different set of declared ports.
//
// The properties each test holds to are the run route's, unchanged: refuse above dispatch so
// nothing is reserved and no actum exists; name the port and never the value, so ids stay
// non-enumerable; fail closed when the store cannot be reached; and cost nothing at all for a
// modus that declares no reference.
// =============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { ExecuteFlow, type ExecuteFlowDeps } from '../../../src/flow/flows/ExecuteFlow.js'
import type { FlowContext, Step, Resolution } from '../../../src/flow/types.js'
import { CrystalApi, type CrystalApiDeps } from '../../../src/allocutio/api/CrystalApi.js'
import { ApiError } from '../../../src/allocutio/api/errors.js'
import { CANONICAL_MODI } from '../../../src/crystal/seeds/modi.js'
import type { Modus, AuctorKey } from '../../../src/types/modus.js'
import type { Actum } from '../../../src/types/actum.js'
import type { Dataset, Datasets } from '../../../src/types/dataset.js'
import type { Collectio, Collectiones, Collectionum, CollectioStatus } from '../../../src/types/collectio.js'
import type { OwnedResourceStores } from '../../../src/execution/ownedAditusGuard.js'

const CAPTION = 'modus.dataset-caption'
const MINE: AuctorKey = { animaId: 'anima-mine' }
const OTHER_OWNER = 'anima-other'

/** Reached only if the check let the cast through — the sentinel the run-route suite uses. */
const REACHED_DISPATCH = 'reached-dispatch'

function seed(id: string): Modus {
  const found = CANONICAL_MODI.find(m => m.id === id)
  assert.ok(found, `seed ${id} is present`)
  return found
}

/** A modus that declares no reference at all — the no-op arm of every test below. */
function plainModus(id = 'modus.plain'): Modus {
  return {
    id, nomen: id, genus: 'atomicus', versio: '1.0.0', contentHash: `sha256:${id}`,
    aditus: { prompt: { type: 'text', required: true } },
    exitus: { image: { type: 'image' } },
    ministerium: 'fake', canonica: true,
    natum: new Date(0), mutatum: new Date(0),
  }
}

function dataset(id: string, owner: string): Dataset {
  return {
    id, owner, name: 'a set', modality: 'image', custody: 'remote',
    media: [], captionsets: [], versions: [],
    natum: new Date(0), mutatum: new Date(0),
  } as unknown as Dataset
}

/** `findOwned` only — the one seam a declared reference resolves through. */
function datasetStore(records: Dataset[]): Datasets {
  return {
    async findOwned(id: string, owner: string) {
      const d = records.find(r => r.id === id)
      return d && d.owner === owner ? d : null
    },
  } as unknown as Datasets
}

function storesFor(records: Dataset[]): OwnedResourceStores {
  return { datasets: datasetStore(records) }
}

// ── The execute flow (`/run`) ───────────────────────────────────────────────

interface FlowHarness {
  flow: ExecuteFlow
  /** True once the dispatch core was reached — i.e. the cast was NOT refused. */
  reached: () => boolean
}

function flowHarness(modus: Modus, ownedResources?: OwnedResourceStores): FlowHarness {
  let reached = false
  const deps = {
    modorum: { async find() { return modus } },
    signorum: { async balance() { return 10_000n } },
    cursorum: { resolve: () => ({ async reserve() { return 100n } }) },
    inceptor: {
      async initiate(): Promise<Actum> {
        reached = true
        throw new Error(REACHED_DISPATCH)
      },
    },
    actorum: {}, completor: {},
    ...(ownedResources ? { ownedResources } : {}),
  } as unknown as ExecuteFlowDeps
  return { flow: new ExecuteFlow(deps), reached: () => reached }
}

function ctxFor(modus: Modus, aditus: Record<string, unknown>): FlowContext {
  return {
    intent: 'execute',
    state: { modusId: modus.id, step: 'CONFIGURE', aditus, browsePageIndex: 0 },
    identity: MINE,
    platform: 'telegram',
    platformUserId: 'user-1',
    platformChatId: 'chat-1',
  } as unknown as FlowContext
}

/** Tap Execute on a filled card — the submit path `/run` reaches. */
async function castIt(h: FlowHarness, modus: Modus, aditus: Record<string, unknown>): Promise<Step | Resolution> {
  return h.flow.handle(ctxFor(modus, aditus), { kind: 'action', actionId: 'execute' })
}

function assertRefusedNaming(result: Step | Resolution, port: string): void {
  assert.ok('primitives' in result, 'a refusal renders a step, not a resolution')
  const detail = result.primitives[0]
  assert.equal(detail.kind, 'Detail')
  if (detail.kind !== 'Detail') return
  assert.ok(detail.content.includes(port), `names the port (${port})`)
  assert.ok(!detail.content.includes('anima-'), 'never names an owner')
}

test('execute flow: a foreign dataset reference is refused, and nothing is dispatched', async () => {
  const h = flowHarness(seed(CAPTION), storesFor([dataset('ds-theirs', OTHER_OWNER)]))

  const result = await castIt(h, seed(CAPTION), { dataset: 'ds-theirs' })

  assertRefusedNaming(result, 'dataset')
  assert.equal(h.reached(), false, 'refused above dispatch: no reservation, no actum, no pod')
})

test('execute flow: an id that resolves to nothing is refused the same way — no existence oracle', async () => {
  const h = flowHarness(seed(CAPTION), storesFor([dataset('ds-mine', 'anima-mine')]))

  const absent = await castIt(h, seed(CAPTION), { dataset: 'ds-does-not-exist' })
  const foreign = await castIt(h, seed(CAPTION), { dataset: 'ds-theirs' })

  assert.ok('primitives' in absent && 'primitives' in foreign)
  assert.deepEqual(absent.primitives, foreign.primitives, 'absent and foreign are indistinguishable')
})

test('execute flow: the caster’s own dataset casts exactly as before', async () => {
  const h = flowHarness(seed(CAPTION), storesFor([dataset('ds-mine', 'anima-mine')]))

  await assert.rejects(
    () => castIt(h, seed(CAPTION), { dataset: 'ds-mine' }),
    (err: unknown) => err instanceof Error && err.message === REACHED_DISPATCH,
  )
  assert.equal(h.reached(), true, 'an owned reference reaches dispatch unchanged')
})

test('execute flow: fails closed — no store wired refuses a declared reference', async () => {
  const h = flowHarness(seed(CAPTION))

  const result = await castIt(h, seed(CAPTION), { dataset: 'ds-mine' })

  assertRefusedNaming(result, 'dataset')
  assert.equal(h.reached(), false, 'a deployment that cannot resolve the store cannot affirm access')
})

test('execute flow: a modus that declares no reference is untouched, with no store wired at all', async () => {
  const plain = plainModus()
  const h = flowHarness(plain)

  await assert.rejects(
    () => castIt(h, plain, { prompt: 'a cat' }),
    (err: unknown) => err instanceof Error && err.message === REACHED_DISPATCH,
  )
  assert.equal(h.reached(), true, 'the check costs nothing for a modus that names no record')
})

// ── The collection (`collect`, and a post-hoc flow change) ──────────────────

function collectionum(): Collectionum & { store: Map<string, Collectio> } {
  const store = new Map<string, Collectio>()
  return {
    store,
    async find(id: string) { return store.get(id) ?? null },
    async list(filter?: Partial<Pick<Collectio, 'status'>>): Promise<Collectiones> {
      const all = [...store.values()]
      return filter?.status ? all.filter(c => c.status === filter.status) : all
    },
    async listByStatus(status: CollectioStatus) {
      return [...store.values()].filter(c => c.status === status)
    },
    async create(input) {
      const c = {
        ...input, id: randomUUID(), natum: new Date(),
        acta: [], completae: 0, fractae: 0, pendentes: 0, reiectae: 0, impetusTotal: 0n,
      } as Collectio
      store.set(c.id, c)
      return c
    },
    async update(id: string, patch) {
      const existing = store.get(id)
      if (!existing) throw new Error(`Collectio '${id}' not found`)
      const updated = { ...existing, ...patch } as Collectio
      store.set(id, updated)
      return updated
    },
  }
}

function collectionApi(flows: Modus[], records: Dataset[]) {
  const collectiones = collectionum()
  const started: string[] = []
  const deps = {
    collectiones,
    collectioCursor: { async start(c: Collectio) { started.push(c.id) } },
    modorum: { async find(id: string) { return flows.find(m => m.id === id) ?? null } },
    animae: { async find() { return { id: 'anima-mine' } } },
    datasets: datasetStore(records),
  } as unknown as CrystalApiDeps
  return { api: new CrystalApi(deps), collectiones, started }
}

async function assertRefusedField(fn: () => Promise<unknown>, field: string): Promise<void> {
  await assert.rejects(fn, (err: unknown) => {
    assert.ok(err instanceof ApiError, 'refused as a request error, not a 500')
    assert.equal(err.code, 'input.invalid_aditus')
    assert.equal((err.toBody().details as { field?: string } | undefined)?.field, field)
    return true
  })
}

test('collect: an aditusBase naming a foreign dataset is refused, and no collection is created', async () => {
  const { api, collectiones, started } = collectionApi(
    [seed(CAPTION)], [dataset('ds-theirs', OTHER_OWNER)],
  )

  await assertRefusedField(
    () => api.collect(MINE, { modusId: CAPTION, aditusBase: { dataset: 'ds-theirs' }, total: 5 }),
    'dataset',
  )
  assert.equal(collectiones.store.size, 0, 'nothing was stored for a later tick to dispatch')
  assert.deepEqual(started, [], 'the fan-out never started')
})

test('collect: the caller’s own dataset in the aditusBase is stored and dispatched as before', async () => {
  const { api, collectiones, started } = collectionApi(
    [seed(CAPTION)], [dataset('ds-mine', 'anima-mine')],
  )

  const c = await api.collect(MINE, { modusId: CAPTION, aditusBase: { dataset: 'ds-mine' }, total: 5 })

  assert.equal(collectiones.store.size, 1)
  assert.deepEqual(started, [c.id], 'an owned reference fans out unchanged')
})

test('collect: a draft with no flow yet stores its base, and the flow change is what settles the reference', async () => {
  const { api, collectiones } = collectionApi(
    [seed(CAPTION), plainModus()], [dataset('ds-theirs', OTHER_OWNER)],
  )

  // A flowless draft declares no ports, so there is nothing to resolve yet.
  const draft = await api.collect(MINE, { draft: true, aditusBase: { dataset: 'ds-theirs' } })
  assert.equal(collectiones.store.size, 1, 'the draft is created')

  // Naming a flow re-reads that same stored base through the new flow's declared ports.
  await assertRefusedField(
    () => api.patchCollectionDraft(MINE, draft.id, { modusId: CAPTION }),
    'dataset',
  )
  assert.equal(collectiones.store.get(draft.id)?.modusId, '', 'the flow change did not land')
})
