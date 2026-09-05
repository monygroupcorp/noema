// =============================================================================
// The run screen's gating read counts in flight, it does not walk the run.
// =============================================================================
//
// `/collections/:id/run` shows "Loading…" until `GET /v1/collectiones/:id` answers, then polls
// it every 2.5 seconds. That read stamps `inFlight`, and it used to derive the number by
// fetching every actum of the collection one at a time — so the cost of drawing the screen
// scaled with the size of the run it was drawing, and the biggest runs took the longest to
// stop saying "Loading…".
//
// These tests pin the number to one store call, and pin that a store without the counting read
// still gets the right answer from the per-actum fallback.
//
// Hermetic: in-memory stores. No DB, no network.
// =============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { CrystalApi, type CrystalApiDeps } from '../../../src/allocutio/api/CrystalApi.js'
import type { Actum, ActumStatus } from '../../../src/types/actum.js'
import type { Collectio, Collectiones, Collectionum, CollectioStatus } from '../../../src/types/collectio.js'
import type { AuctorKey } from '../../../src/flow/types.js'

const owner: AuctorKey = { animaId: 'anima-owner' }

/** A run of `n` pieces, the first `live` of them still dispatching. */
function acta(n: number, live: number): Actum[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `actum-${i}`,
    status: (i < live ? 'agens' : 'completus') as ActumStatus,
  }) as Actum)
}

function makeCollectionum(): Collectionum & { store: Map<string, Collectio> } {
  const store = new Map<string, Collectio>()
  return {
    store,
    async find(id: string) { return store.get(id) ?? null },
    async list(filter?: Partial<Pick<Collectio, 'status'>>): Promise<Collectiones> {
      const all = [...store.values()]
      return filter?.status ? all.filter((c) => c.status === filter.status) : all
    },
    async listByStatus(status: CollectioStatus) {
      return [...store.values()].filter((c) => c.status === status)
    },
    async create(input) {
      const c = { ...input, id: randomUUID(), natum: new Date(), acta: [], completae: 0, fractae: 0, pendentes: 0, reiectae: 0, impetusTotal: 0n } as Collectio
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

/**
 * An actum store that records what was asked of it. `counting: false` drops
 * `countByIdsWithStatus` entirely — the store shape the fallback exists for.
 */
function makeActorum(records: Actum[], counting = true) {
  const byId = new Map(records.map((a) => [a.id, a]))
  const calls = { findById: 0, count: 0 }
  const base = {
    calls,
    async findById(id: string) { calls.findById++; return byId.get(id) ?? null },
  }
  if (!counting) return base
  return {
    ...base,
    async countByIdsWithStatus(ids: string[], statuses: ActumStatus[]) {
      calls.count++
      const wanted = new Set<string>(statuses)
      return ids.filter((id) => { const a = byId.get(id); return a !== undefined && wanted.has(a.status) }).length
    },
  }
}

/** A fired collection of `n` pieces owned by `owner`, with `live` still dispatching. */
async function firedRun(n: number, live: number, counting = true) {
  const collectiones = makeCollectionum()
  const records = acta(n, live)
  const actorum = makeActorum(records, counting)
  const deps = { collectiones, actorum, animae: { async find(id: string) { return { id } } } } as unknown as CrystalApiDeps
  const api = new CrystalApi(deps)
  const c = await collectiones.create({
    modusId: 'flow', aditusBase: {}, tractus: [], numerus: n, provenanceHash: 'sha256:x',
    by: { animaId: 'anima-owner' }, concurrentia: 1, status: 'agens',
  } as Parameters<Collectionum['create']>[0])
  await collectiones.update(c.id, { acta: records.map((a) => a.id) })
  return { api, id: c.id, actorum }
}

test('getCollection counts in flight with ONE store call, whatever the size of the run', async () => {
  const { api, id, actorum } = await firedRun(500, 7)

  const view = await api.getCollection(owner, id)

  assert.equal(view.inFlight, 7)
  assert.equal(actorum.calls.count, 1, 'one counting query')
  assert.equal(actorum.calls.findById, 0, 'and not one read per piece')
})

test('a store with no counting read still reports the right number, piece by piece', async () => {
  const { api, id, actorum } = await firedRun(12, 5, false)

  const view = await api.getCollection(owner, id)

  assert.equal(view.inFlight, 5)
  assert.equal(actorum.calls.findById, 12, 'the fallback walks the run')
})

test('a collection with no pieces yet reports none in flight without asking the store', async () => {
  const { api, id, actorum } = await firedRun(0, 0)

  assert.equal((await api.getCollection(owner, id)).inFlight, 0)
  assert.equal(actorum.calls.count, 0)
  assert.equal(actorum.calls.findById, 0)
})
