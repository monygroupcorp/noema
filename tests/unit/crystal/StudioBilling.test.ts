// Studio billing tick — the host's continuous per-time cost meter.
//
// Drives billOne() (the per-Hospitium single-tick path used by both the periodic
// ticker and phase-transition emissions). The full periodic loop is just
// `setInterval(billOne over findActive())` — covered by exercising billOne in
// isolation with controlled clocks.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { billOne, type StudioBillingDeps } from '../../../src/crystal/StudioBilling.js'
import { Nexus } from '../../../src/ledger/Nexus.js'
import { studioSpendHook } from '../../../src/ledger/hooks/studioSpend.js'
import { MemorySignorum } from '../../../src/ledger/MemorySignorum.js'
import type { Materia, MateriaStore, PodPolicy } from '../../../src/types/materia.js'
import type { Hospitium, HospitiumStore, HostKey } from '../../../src/types/hospitium.js'

// ── In-memory doubles ─────────────────────────────────────────────────────────
class FakeHospitium implements HospitiumStore {
  private byMateria = new Map<string, Hospitium>()
  private nextId = 1
  async create(input: Omit<Hospitium, 'id'>): Promise<Hospitium> {
    const h: Hospitium = { id: `h-${this.nextId++}`, ...input }
    this.byMateria.set(h.materiaId, h)
    return h
  }
  async findByMateriaId(materiaId: string): Promise<Hospitium | null> {
    return this.byMateria.get(materiaId) ?? null
  }
  async findActive(): Promise<Hospitium[]> {
    return [...this.byMateria.values()].filter(h => !h.terminatum)
  }
  async update(
    materiaId: string,
    patch: Partial<Pick<Hospitium, 'adminAnimaIds' | 'terminatum' | 'costAccrued' | 'lastBilledAt'>>,
  ): Promise<Hospitium> {
    const cur = this.byMateria.get(materiaId)
    if (!cur) throw new Error(`not found`)
    const next = { ...cur, ...patch }
    this.byMateria.set(materiaId, next)
    return next
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
    const cur = this.byId.get(id); if (!cur) throw new Error(`not found`)
    const next = { ...cur, ...patch }; this.byId.set(id, next); return next
  }
  async findWarm(_spec: { imageRef?: string; podPolicy?: PodPolicy; shareToken?: string }): Promise<Materia | null> { return null }
  async findActive(): Promise<Materia[]> { return [...this.byId.values()] }
  async reapIdle(_now: Date): Promise<Materia[]> { return [] }
}

// ── Fixtures ──────────────────────────────────────────────────────────────────
const HOST_ANIMA = 'anima-host'
const HOST_COMMITMENT = '0xabc'
const MATERIA_ID = 'mat-1'
const IMPETUS_PER_SECOND = 4n   // ≈ H100 @ $4/hr at the platform rate
const PLATFORM = process.env.PLATFORM_ANIMA_ID ?? 'platform'

function makeDeps(opts: {
  hostBalance: bigint
  hostKey?: HostKey
  status?: Materia['status']
}): StudioBillingDeps & { hospitium: Hospitium; signorum: MemorySignorum; materiae: FakeMateriaStore } {
  const hostKey: HostKey = opts.hostKey ?? { animaId: HOST_ANIMA }
  const materiae = new FakeMateriaStore()
  const hospitia = new FakeHospitium()
  const signorum = new MemorySignorum()
  const nexus = new Nexus()
  nexus.on('studio_spend', studioSpendHook)

  const m: Materia = {
    id: MATERIA_ID, genus: 'pod', externusId: 'pod-1', gpu: 'H100', vramGb: 80, ramGb: 200,
    impetusPerSecond: IMPETUS_PER_SECOND, status: opts.status ?? 'idle',
  }
  materiae.add(m)

  // Seed host balance
  if (opts.hostBalance > 0n && 'animaId' in hostKey) {
    void signorum.issue({ animaId: hostKey.animaId, forma: 'integer', valor: opts.hostBalance, auctor: 'test:seed' })
  }
  if (opts.hostBalance > 0n && 'commitment' in hostKey) {
    void signorum.issue({ forma: 'arcanum', valor: opts.hostBalance, auctor: 'test:seed', testis: hostKey.commitment })
  }

  // lastBilledAt = 60s ago → one tick worth of debt
  const inceptum = new Date(Date.now() - 60_000)
  const h: Hospitium = { id: 'h-1', materiaId: MATERIA_ID, hostKey, inceptum }
  void hospitia.create(h).then(() => {})

  return { hospitia, materiae, signorum, nexus, hospitium: h }
}

async function settled<T>(p: Promise<T>): Promise<T> { return await p }

// ── 1. Happy path: 60s tick on a solvent host ─────────────────────────────────
test('60s tick on solvent host: debits impetusPerSecond × 60; updates Hospitium', async () => {
  const deps = makeDeps({ hostBalance: 10_000n })
  await new Promise(r => setTimeout(r, 0))  // let hospitia.create resolve

  const h = (await deps.hospitia.findByMateriaId(MATERIA_ID))!
  const res = await billOne(deps, h, new Date(h.inceptum.getTime() + 60_000))

  assert.equal(res.requested, 60n * IMPETUS_PER_SECOND, '60s × 4 = 240')
  assert.equal(res.charged, res.requested, 'fully covered by balance')
  assert.equal(res.drainEngaged, false)

  // Host balance went down by exactly charged
  const hostBalance = await deps.signorum.balance({ animaId: HOST_ANIMA })
  assert.equal(hostBalance, 10_000n - res.charged)

  // Platform got the credit
  const platformBalance = await deps.signorum.balance({ animaId: PLATFORM })
  assert.equal(platformBalance, res.charged)

  // Hospitium tracks the cost + last billed instant
  const after = (await deps.hospitia.findByMateriaId(MATERIA_ID))!
  assert.equal(after.costAccrued, res.charged)
  assert.ok(after.lastBilledAt && after.lastBilledAt.getTime() > h.inceptum.getTime())
})

// ── 2. Two consecutive ticks accumulate (restart-resilient lastBilledAt) ─────
test('successive ticks accumulate via lastBilledAt — no skipped windows', async () => {
  const deps = makeDeps({ hostBalance: 10_000n })
  await new Promise(r => setTimeout(r, 0))

  const t0 = (await deps.hospitia.findByMateriaId(MATERIA_ID))!.inceptum.getTime()
  await billOne(deps, (await deps.hospitia.findByMateriaId(MATERIA_ID))!, new Date(t0 + 60_000))
  await billOne(deps, (await deps.hospitia.findByMateriaId(MATERIA_ID))!, new Date(t0 + 180_000))

  // First tick: 60s × 4 = 240; second: 120s × 4 = 480. Total 720.
  const after = (await deps.hospitia.findByMateriaId(MATERIA_ID))!
  assert.equal(after.costAccrued, 720n)
})

// ── 3. Balance-zero shortfall: clamps to available; engages drainOnly ────────
test('balance shortfall: clamps to available + sets Materia.drainOnly + emits bus event', async () => {
  const deps = makeDeps({ hostBalance: 100n })  // only 100 available; tick would ask 240
  await new Promise(r => setTimeout(r, 0))

  let drainEmitted = false
  const { bus } = await import('../../../src/lib/bus.js')
  bus.once('studio.draining', () => { drainEmitted = true })

  const h = (await deps.hospitia.findByMateriaId(MATERIA_ID))!
  const res = await billOne(deps, h, new Date(h.inceptum.getTime() + 60_000))

  assert.equal(res.requested, 240n)
  assert.equal(res.charged, 100n, 'clamped to available balance')
  assert.equal(res.drainEngaged, true)

  // Materia is now flagged drainOnly
  const m = await deps.materiae.findById(MATERIA_ID)
  assert.equal(m?.drainOnly, true)

  // Bus event fired
  assert.equal(drainEmitted, true)
})

// ── 4. Anonymous (commitment) host — arcanum debit, no animaId on debit signum
test('commitment host: arcanum debit signum on host, no animaId leak', async () => {
  const deps = makeDeps({
    hostBalance: 10_000n,
    hostKey: { commitment: HOST_COMMITMENT },
  })
  await new Promise(r => setTimeout(r, 0))

  const h = (await deps.hospitia.findByMateriaId(MATERIA_ID))!
  await billOne(deps, h, new Date(h.inceptum.getTime() + 60_000))

  const arcanumSigna = await deps.signorum.history({ commitment: HOST_COMMITMENT })
  // Seed signum + debit signum = 2; debit is the negative-valor one
  const debit = arcanumSigna.find(s => s.auctor === 'nexus:studioSpend')!
  assert.equal(debit.forma, 'arcanum')
  assert.equal(debit.animaId, undefined, 'arcanum signum NEVER carries animaId')
  assert.equal(debit.testis, HOST_COMMITMENT)
  assert.equal(debit.valor, -240n, 'negative-valor debit')

  // Balance reduced by the debit
  const balance = await deps.signorum.balance({ commitment: HOST_COMMITMENT })
  assert.equal(balance, 10_000n - 240n)
})

// ── 5. Terminated studio is skipped ──────────────────────────────────────────
test('terminated studio is not billed', async () => {
  const deps = makeDeps({ hostBalance: 10_000n, status: 'terminated' })
  await new Promise(r => setTimeout(r, 0))

  const h = (await deps.hospitia.findByMateriaId(MATERIA_ID))!
  const res = await billOne(deps, h, new Date(h.inceptum.getTime() + 60_000))

  assert.equal(res.charged, 0n)
  assert.equal((await deps.signorum.balance({ animaId: HOST_ANIMA })), 10_000n, 'balance untouched')
})

// ── 6. Zero elapsed seconds → no-op idempotency ──────────────────────────────
test('zero elapsed seconds: idempotent no-op (covers phase-transition retries)', async () => {
  const deps = makeDeps({ hostBalance: 10_000n })
  await new Promise(r => setTimeout(r, 0))

  const h = (await deps.hospitia.findByMateriaId(MATERIA_ID))!
  // billOne at the same instant as lastBilledAt (inceptum here)
  const res = await billOne(deps, h, new Date(h.inceptum.getTime()))

  assert.equal(res.charged, 0n)
  assert.equal((await deps.signorum.balance({ animaId: HOST_ANIMA })), 10_000n)
})
