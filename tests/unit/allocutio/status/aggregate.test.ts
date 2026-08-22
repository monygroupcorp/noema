// Status aggregator integration — wires the real signorum/hospitia/materiae
// stores (memory variants where they exist, fakes mirroring Phase C tests
// elsewhere) and proves the StatusSnapshot is assembled correctly.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { aggregateStatus } from '../../../../src/allocutio/lexicon/status/aggregate.js'
import { MemorySignorum } from '../../../../src/ledger/MemorySignorum.js'
import { MemoryActorum } from '../../../../src/execution/MemoryActorum.js'
import { MemoryModorum } from '../../../../src/execution/MemoryModorum.js'
import type { Materia, MateriaStore, PodPolicy } from '../../../../src/types/materia.js'
import type { Hospitium, HospitiumStore, HostKey } from '../../../../src/types/hospitium.js'

// ── Doubles (mirroring Phase C tests' shape) ─────────────────────────────────
class FakeHospitium implements HospitiumStore {
  private byMateria = new Map<string, Hospitium>()
  private n = 1
  async create(input: Omit<Hospitium, 'id'>): Promise<Hospitium> {
    const h: Hospitium = { id: `h-${this.n++}`, ...input }
    // This double indexes by materiaId only; a studio record created before its pod parks
    // has none, and would be silently unfindable.
    if (!h.materiaId) throw new Error('FakeHospitium.create requires a materiaId')
    this.byMateria.set(h.materiaId, h); return h
  }
  async findByMateriaId(id: string): Promise<Hospitium | null> { return this.byMateria.get(id) ?? null }
  // Studio-keyed seams: no test here opens a studio, so these throw rather than return a
  // default that would let a future test pass without a real implementation.
  async findByModoId(_modoId: string): Promise<Hospitium | null> {
    throw new Error('FakeHospitium.findByModoId is not exercised by the status aggregator tests')
  }
  async bindMateria(_modoId: string, _materiaId: string): Promise<Hospitium> {
    throw new Error('FakeHospitium.bindMateria is not exercised by the status aggregator tests')
  }
  async findActive(): Promise<Hospitium[]> { return [...this.byMateria.values()].filter(h => !h.terminatum) }
  async update(id: string, patch: Partial<Pick<Hospitium, 'adminAnimaIds' | 'terminatum' | 'costAccrued' | 'lastBilledAt'>>): Promise<Hospitium> {
    const cur = this.byMateria.get(id); if (!cur) throw new Error('not found')
    const next = { ...cur, ...patch }; this.byMateria.set(id, next); return next
  }
}
class FakeMateriaStore implements MateriaStore {
  private byId = new Map<string, Materia>()
  add(m: Materia): void { this.byId.set(m.id, m) }
  async create(input: Omit<Materia, 'id'>): Promise<Materia> {
    const m = { ...input, id: `m-${this.byId.size + 1}` } as Materia
    this.byId.set(m.id, m); return m
  }
  async findById(id: string): Promise<Materia | null> { return this.byId.get(id) ?? null }
  async update(id: string, patch: Partial<Materia>): Promise<Materia> {
    const cur = this.byId.get(id); if (!cur) throw new Error('not found')
    const next = { ...cur, ...patch }; this.byId.set(id, next); return next
  }
  async findWarm(_: { imageRef?: string; podPolicy?: PodPolicy; shareToken?: string }): Promise<Materia | null> { return null }
  async findActive(): Promise<Materia[]> { return [...this.byId.values()] }
  async reapIdle(_: Date): Promise<Materia[]> { return [] }
}

const ALICE = { animaId: 'anima-alice' } satisfies HostKey

function makeDeps() {
  const signorum = new MemorySignorum()
  const actorum  = new MemoryActorum()
  const modorum  = new MemoryModorum()
  const hospitia = new FakeHospitium()
  const materiae = new FakeMateriaStore()
  return { signorum, actorum, modorum, hospitia, materiae }
}

// ── Tests ────────────────────────────────────────────────────────────────────

test('null auctorKey → empty snapshot', async () => {
  const deps = makeDeps()
  const snap = await aggregateStatus(deps, { auctorKey: null, inFlightActumIds: [] })
  assert.equal(snap.balanceImpetus, 0n)
  assert.deepEqual(snap.studios, [])
  assert.deepEqual(snap.gens, [])
})

test('balance: reads signorum + converts to USD', async () => {
  const deps = makeDeps()
  await deps.signorum.issue({ animaId: ALICE.animaId, forma: 'integer', valor: 1_000n, auctor: 'test' })
  const snap = await aggregateStatus(deps, { auctorKey: ALICE, inFlightActumIds: [] })
  assert.equal(snap.balanceImpetus, 1_000n)
  // 1000 × 0.000337 = 0.337
  assert.ok(Math.abs(snap.balanceUsd - 0.337) < 1e-9)
})

test('studios: filters Hospitia by hostKey; maps Materia.status → StudioEntry.status', async () => {
  const deps = makeDeps()
  deps.materiae.add({
    id: 'mat-1', genus: 'runpod', externusId: 'p-1', gpu: 'NVIDIA H100', vramGb: 80, ramGb: 200,
    impetusPerSecond: 4n, status: 'idle', imageRef: 'noema/flux-v1:abc',
    warmUntil: new Date(Date.now() + 30_000),
  })
  deps.materiae.add({
    id: 'mat-2', genus: 'runpod', externusId: 'p-2', gpu: 'NVIDIA RTX 4090', vramGb: 24, ramGb: 32,
    impetusPerSecond: 1n, status: 'active', imageRef: 'noema/sdxl:1',
  })
  // Alice hosts mat-1; some other anima hosts mat-2.
  await deps.hospitia.create({ materiaId: 'mat-1', hostKey: ALICE, inceptum: new Date(), costAccrued: 50n })
  await deps.hospitia.create({ materiaId: 'mat-2', hostKey: { animaId: 'anima-bob' }, inceptum: new Date() })

  const snap = await aggregateStatus(deps, { auctorKey: ALICE, inFlightActumIds: [] })
  assert.equal(snap.studios.length, 1, 'only alice\'s studio in her status')
  assert.equal(snap.studios[0].studioId, 'mat-1')
  assert.equal(snap.studios[0].status, 'idle')
  assert.equal(snap.studios[0].label, 'flux-v1 on H100')
  assert.equal(snap.studios[0].netImpetus, -50n, 'v1: net = -costAccrued (per-studio earnings TBD)')
})

test('studios: drainOnly → draining status (overrides Materia.status)', async () => {
  const deps = makeDeps()
  deps.materiae.add({
    id: 'mat-1', genus: 'runpod', externusId: 'p-1', gpu: 'H100', vramGb: 80, ramGb: 200,
    impetusPerSecond: 4n, status: 'idle', drainOnly: true,
  })
  await deps.hospitia.create({ materiaId: 'mat-1', hostKey: ALICE, inceptum: new Date() })
  const snap = await aggregateStatus(deps, { auctorKey: ALICE, inFlightActumIds: [] })
  assert.equal(snap.studios[0].status, 'draining')
})

test('gens: nascens + agens included; completus filtered out', async () => {
  const deps = makeDeps()
  await deps.modorum.register({
    id: 'm.flux', nomen: 'Flux Schnell', genus: 'atomicus', versio: '1.0.0',
    contentHash: 'h', aditus: {}, exitus: {}, canonica: true,
    auctor: { animaId: 'anima-author' }, natum: new Date(), mutatum: new Date(),
  })
  // Three actums: queued, running, completed
  for (const [id, status] of [['a-q', 'nascens'], ['a-r', 'agens'], ['a-d', 'completus']] as const) {
    await deps.actorum.create({
      id, modusId: 'm.flux', modusVersiono: '1.0.0', impetus: 100n, signaConsumed: [],
      aditus: {}, status, expirat: new Date(Date.now() + 60_000),
    })
  }
  const snap = await aggregateStatus(deps, {
    auctorKey: ALICE,
    inFlightActumIds: ['a-q', 'a-r', 'a-d'],
  })
  assert.equal(snap.gens.length, 2, 'only active (nascens + agens) gens surface')
  const ids = snap.gens.map(g => g.actumId).sort()
  assert.deepEqual(ids, ['a-q', 'a-r'])
  // modusLabel resolved from modorum
  assert.equal(snap.gens[0].modusLabel, 'Flux Schnell')
})

test('takenAt: respects injected clock', async () => {
  const deps = makeDeps()
  const fixed = new Date('2026-01-01T00:00:00Z')
  const snap = await aggregateStatus(deps, { auctorKey: ALICE, inFlightActumIds: [], now: () => fixed })
  assert.equal(snap.takenAt.getTime(), fixed.getTime())
})

test('gens: when actumIndex is wired, aggregator pulls user gens from the index', async () => {
  const deps = makeDeps()
  await deps.modorum.register({
    id: 'm.flux', nomen: 'Flux', genus: 'atomicus', versio: '1.0.0',
    contentHash: 'h', aditus: {}, exitus: {}, canonica: true,
    auctor: { animaId: 'a' }, natum: new Date(), mutatum: new Date(),
  })
  await deps.actorum.create({
    id: 'act-from-index', modusId: 'm.flux', modusVersiono: '1.0.0',
    impetus: 100n, signaConsumed: [], aditus: {}, status: 'agens',
    expirat: new Date(Date.now() + 60_000),
  })
  const { MemoryActumIndex } = await import('../../../../src/execution/MemoryActumIndex.js')
  const actumIndex = new MemoryActumIndex()
  await actumIndex.record({
    animaId: ALICE.animaId, actumId: 'act-from-index', modusId: 'm.flux', createdAt: new Date(),
  })
  // inFlightActumIds is empty — the aggregator must consult the index.
  const snap = await aggregateStatus(
    { ...deps, actumIndex },
    { auctorKey: ALICE, inFlightActumIds: [] },
  )
  assert.equal(snap.gens.length, 1)
  assert.equal(snap.gens[0].actumId, 'act-from-index')
})

test('gens: anonymous (commitment) runs index + show on /status', async () => {
  const deps = makeDeps()
  const COMMIT = { commitment: '0xanon' } as const
  await deps.modorum.register({
    id: 'm.flux', nomen: 'Flux', genus: 'atomicus', versio: '1.0.0',
    contentHash: 'h', aditus: {}, exitus: {}, canonica: true,
    auctor: { animaId: 'a' }, natum: new Date(), mutatum: new Date(),
  })
  await deps.actorum.create({
    id: 'act-anon', modusId: 'm.flux', modusVersiono: '1.0.0',
    impetus: 100n, signaConsumed: [], aditus: {}, status: 'nascens',
    expirat: new Date(Date.now() + 60_000),
  })
  const { MemoryActumIndex } = await import('../../../../src/execution/MemoryActumIndex.js')
  const actumIndex = new MemoryActumIndex()
  await actumIndex.record({
    commitment: COMMIT.commitment, actumId: 'act-anon', modusId: 'm.flux', createdAt: new Date(),
  })
  const snap = await aggregateStatus(
    { ...deps, actumIndex },
    { auctorKey: COMMIT, inFlightActumIds: [] },
  )
  assert.equal(snap.gens.length, 1, 'commitment-side gens populate /status')
  assert.equal(snap.gens[0].actumId, 'act-anon')
})

test('studios: per-studio earnings sum signa with contextId === materiaId', async () => {
  const deps = makeDeps()
  deps.materiae.add({
    id: 'mat-1', genus: 'runpod', externusId: 'p-1', gpu: 'H100', vramGb: 80, ramGb: 200,
    impetusPerSecond: 4n, status: 'idle', imageRef: 'noema/flux-v1:abc',
  })
  await deps.hospitia.create({ materiaId: 'mat-1', hostKey: ALICE, inceptum: new Date(), costAccrued: 50n })
  // Seed: 40 hostCut on mat-1, 64 hospitium on mat-1, 100 hostCut on another studio (must be excluded).
  await deps.signorum.issue({ animaId: ALICE.animaId, forma: 'reward', valor: 40n,  auctor: 'nexus:hostCut',   contextId: 'mat-1'     })
  await deps.signorum.issue({ animaId: ALICE.animaId, forma: 'reward', valor: 64n,  auctor: 'nexus:hospitium', contextId: 'mat-1'     })
  await deps.signorum.issue({ animaId: ALICE.animaId, forma: 'reward', valor: 100n, auctor: 'nexus:hostCut',   contextId: 'mat-other' })

  const snap = await aggregateStatus(deps, { auctorKey: ALICE, inFlightActumIds: [] })
  assert.equal(snap.studios.length, 1)
  // earnings(mat-1) = 40 + 64 = 104;  net = 104 − costAccrued(50) = 54
  assert.equal(snap.studios[0].netImpetus, 54n)
  assert.equal(snap.studios[0].guestsToday, 1, 'one hostCut signum on mat-1 = one guest served')
})
