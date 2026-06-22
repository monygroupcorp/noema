import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PublicationWorker } from '../../../src/crystal/PublicationWorker.js'
import type { Editio } from '../../../src/types/editio.js'

// =============================================================================
// PublicationWorker — drains pending Editiones off the store (the durable queue)
// via an atomic claim/lease. Restart-safe: a lapsed lease is reclaimed.
// =============================================================================

let seq = 0
function pending(id: string): Editio {
  return {
    id, artifactRef: { kind: 'actum', id: `a-${id}` }, destination: 'feed',
    visibility: 'feed', custody: 'ours', by: { animaId: 'x' },
    status: 'pending', natum: new Date(Date.now() + seq++), mutatum: new Date(),
  }
}

/** Minimal store with the same claim/lease semantics as MongoEditionum. */
class FakeStore {
  rows = new Map<string, Editio>()
  add(e: Editio) { this.rows.set(e.id, e); return e }
  async claimPending(now: Date, leaseMs: number): Promise<Editio | null> {
    const c = [...this.rows.values()]
      .filter((e) => e.status === 'pending' && (!e.leasedUntil || e.leasedUntil.getTime() <= now.getTime()))
      .sort((a, b) => a.natum.getTime() - b.natum.getTime())[0]
    if (!c) return null
    const u: Editio = { ...c, leasedUntil: new Date(now.getTime() + leaseMs), attempts: (c.attempts ?? 0) + 1 }
    this.rows.set(u.id, u)
    return u
  }
  async update(id: string, patch: Partial<Editio>): Promise<Editio> {
    const u = { ...this.rows.get(id)!, ...patch } as Editio
    this.rows.set(id, u)
    return u
  }
}

test('drainOnce: settles every pending publication exactly once', async () => {
  const store = new FakeStore()
  store.add(pending('e1')); store.add(pending('e2')); store.add(pending('e3'))
  const settled: string[] = []
  const worker = new PublicationWorker({
    editiones: store,
    settle: async (id) => { settled.push(id); await store.update(id, { status: 'published' }) },
  })
  await worker.drainOnce()
  assert.deepEqual(settled.sort(), ['e1', 'e2', 'e3'])
  assert.equal([...store.rows.values()].every((e) => e.status === 'published'), true)
})

test('drainOnce: a settle that throws leaves the row pending; it retries after the lease lapses', async () => {
  const store = new FakeStore()
  store.add(pending('e1'))
  let calls = 0
  const worker = new PublicationWorker({
    editiones: store,
    leaseMs: 60_000,
    settle: async (id) => { calls++; if (calls === 1) throw new Error('boom'); await store.update(id, { status: 'published' }) },
  })
  await worker.drainOnce()  // attempt 1 throws → still pending, lease live (not retried this pass)
  assert.equal(store.rows.get('e1')!.status, 'pending')
  assert.equal(calls, 1)
  // Simulate the lease lapsing (a worker crash / time passing), then drain again.
  await store.update('e1', { leasedUntil: new Date(Date.now() - 1) })
  await worker.drainOnce()  // reclaimed → attempt 2 succeeds
  assert.equal(store.rows.get('e1')!.status, 'published')
  assert.equal(calls, 2)
})

test('drainOnce: a publication is marked failed after exceeding maxAttempts', async () => {
  const store = new FakeStore()
  store.add(pending('e1'))
  const worker = new PublicationWorker({
    editiones: store,
    leaseMs: 0,
    maxAttempts: 2,
    settle: async () => { throw new Error('always fails') },
  })
  await worker.drainOnce() // attempt 1 (throws → pending)
  await worker.drainOnce() // attempt 2 (throws → pending)
  await worker.drainOnce() // claim bumps attempts to 3 > 2 → failed
  assert.equal(store.rows.get('e1')!.status, 'failed')
})

test('drainOnce: a live lease blocks re-claim (no double-settle within the lease)', async () => {
  const store = new FakeStore()
  store.add(pending('e1'))
  let settles = 0
  const worker = new PublicationWorker({
    editiones: store,
    leaseMs: 60_000, // long lease
    // settle never reaches a terminal status, so the row stays pending-but-leased
    settle: async () => { settles++ },
  })
  await worker.drainOnce()
  await worker.drainOnce() // lease still live → nothing to claim
  assert.equal(settles, 1, 'the leased row is not re-claimed while its lease is live')
})

test('drainOnce: claims nothing when the store is empty', async () => {
  const worker = new PublicationWorker({ editiones: new FakeStore(), settle: async () => { throw new Error('should not be called') } })
  await worker.drainOnce()
})
