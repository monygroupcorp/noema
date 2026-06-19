import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { MemoryModorum } from '../../../src/execution/MemoryModorum.js'
import { MemoryActorum } from '../../../src/execution/MemoryActorum.js'
import { MemorySignorum } from '../../../src/ledger/MemorySignorum.js'
import { SimpleCursorum } from '../../../src/crystal/SimpleCursorum.js'
import { ActumInceptor } from '../../../src/execution/ActumInceptor.js'
import { CollectioCursor } from '../../../src/crystal/CollectioCursor.js'
import { CrystalApi, type CrystalApiDeps } from '../../../src/allocutio/api/CrystalApi.js'
import { dispatchInceptio, type DispatchDeps } from '../../../src/execution/dispatchInceptio.js'
import type { Cursor, CursorResult, ActumCompletor, Inceptio, Exitus } from '../../../src/types/cursus.js'
import type { Modus, Forma } from '../../../src/types/modus.js'
import type { Actum } from '../../../src/types/actum.js'
import type { Collectio, Collectionum, Collectiones, CollectioStatus } from '../../../src/types/collectio.js'

// =============================================================================
// Collectio launch surface — CrystalApi.collect() fans a base modus out over a
// Tractus[] grid and RUNS each piece (sync FakeCursor → inline completion).
// =============================================================================

function atomic(id: string, ministerium: string, aditus: Forma, exitus: Forma): Modus {
  return {
    id, nomen: id, genus: 'atomicus', versio: '1.0.0', contentHash: '',
    ministerium, aditus, exitus, canonica: true,
    natum: new Date('2026-06-19'), mutatum: new Date('2026-06-19'),
  }
}

/** A sync cursor that records every aditus it ran with. */
class FakeCursor implements Cursor {
  runs: Array<Record<string, unknown>> = []
  constructor(private readonly cost: bigint) {}
  async reserve(): Promise<bigint> { return this.cost }
  async run(actum: Actum): Promise<CursorResult> {
    this.runs.push(actum.aditus)
    return { kind: 'sync', exitus: { exitus: { image: `img-${actum.aditus._pieceIndex}` }, impetus: this.cost } }
  }
}

/** In-memory Collectionum for the test. */
class MemCollectionum implements Collectionum {
  store = new Map<string, Collectio>()
  async find(id: string) { return this.store.get(id) ?? null }
  async list(filter?: Partial<Pick<Collectio, 'status'>>): Promise<Collectiones> {
    const all = [...this.store.values()]
    return filter?.status ? all.filter(c => c.status === filter.status) : all
  }
  async listByStatus(status: CollectioStatus) { return [...this.store.values()].filter(c => c.status === status) }
  async create(c: Omit<Collectio, 'id' | 'natum' | 'acta' | 'completae' | 'fractae' | 'impetusTotal'>) {
    const full: Collectio = { ...c, id: randomUUID(), natum: new Date(), acta: [], completae: 0, fractae: 0, impetusTotal: 0n }
    this.store.set(full.id, full)
    return full
  }
  async update(id: string, patch: Partial<Collectio>) {
    const c = { ...this.store.get(id)!, ...patch }
    this.store.set(id, c)
    return c
  }
}

function makeApi() {
  const modorum = new MemoryModorum()
  const actorum = new MemoryActorum()
  const signorum = new MemorySignorum()
  const cursorum = new SimpleCursorum()
  const cursor = new FakeCursor(10n)
  cursorum.register('fake', cursor)

  const inceptor = new ActumInceptor({ modorum, cursorum, signorum, acta: actorum })
  const completor: ActumCompletor = {
    complete: async (a: Actum, r: Exitus) => {
      await signorum.settle(a.signaConsumed, r.impetus, a.id)
      return actorum.update(a.id, { status: 'completus', exitus: r.exitus, impetus: r.impetus, completum: new Date() })
    },
    fail: async (a: Actum, error: string) => actorum.update(a.id, { status: 'fractus', error }),
  }
  const deps: DispatchDeps = { inceptor, modorum, cursorum, completor }
  const collectiones = new MemCollectionum()
  const collectioCursor = new CollectioCursor((inc: Inceptio) => dispatchInceptio(deps, inc), collectiones, actorum, {})

  const api = new CrystalApi({ collectiones, collectioCursor } as unknown as CrystalApiDeps)
  return { api, modorum, actorum, signorum, cursor, collectiones }
}

test('collect(): fans a base modus over a 2-axis grid into N runs, each woven + run', async () => {
  const { api, modorum, signorum, cursor } = makeApi()
  await modorum.register(atomic('sd1-5', 'fake', { prompt: { type: 'text', required: true } }, { image: { type: 'image' } }))
  await signorum.issue({ animaId: 'anima-1', forma: 'minted', valor: 1000n, auctor: 'test' })

  const col = await api.collect({ animaId: 'anima-1' }, {
    modusId: 'sd1-5',
    total: 6,
    aditusBase: { _basePrompt: 'a {{color}} {{animal}}' },
    tractus: [
      { porta: 'color', label: 'Color', valores: [{ value: 'red', promptFragment: 'red' }, { value: 'blue', promptFragment: 'blue' }] },
      { porta: 'animal', label: 'Animal', valores: [{ value: 'cat' }, { value: 'dog' }] },
    ],
  })

  // Sync cursor → the whole collection runs inline during start().
  assert.equal(col.total, 6)
  assert.equal(col.completed, 6, 'all 6 pieces completed')
  assert.equal(col.status, 'complete')

  // Every piece actually ran (FakeCursor recorded 6 aditus), with a woven prompt + NFT attributes.
  assert.equal(cursor.runs.length, 6, 'cursor ran 6 pieces')
  for (const aditus of cursor.runs) {
    assert.match(String(aditus.prompt), /^a (red|blue) (cat|dog)$/, 'trait fragments woven into the prompt')
    assert.ok(Array.isArray(aditus._attributes), 'piece carries NFT-standard attributes (provenance)')
    assert.equal((aditus._attributes as unknown[]).length, 2, 'two trait axes recorded')
  }
})

test('collect(): owner-scoped — non-owner cannot fetch the collection', async () => {
  const { api, modorum, signorum } = makeApi()
  await modorum.register(atomic('sd1-5', 'fake', { prompt: { type: 'text', required: true } }, { image: { type: 'image' } }))
  await signorum.issue({ animaId: 'anima-1', forma: 'minted', valor: 1000n, auctor: 'test' })

  const col = await api.collect({ animaId: 'anima-1' }, {
    modusId: 'sd1-5', total: 2,
    aditusBase: { _basePrompt: 'a {{color}} thing' },
    tractus: [{ porta: 'color', valores: [{ value: 'red', promptFragment: 'red' }] }],
  })

  const got = await api.getCollection({ animaId: 'anima-1' }, col.id)
  assert.equal(got.id, col.id)
  await assert.rejects(
    () => api.getCollection({ animaId: 'someone-else' }, col.id),
    /not found/i,
  )
})
