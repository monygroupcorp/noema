// Census — the host's continuous per-time cost reckoning (studio billing tick).
//
// Drives censere() (the per-Hospitium single-assessment path used by both the
// periodic ticker and phase-transition emissions). The full periodic loop is just
// `setInterval(censere over findActive())` — covered by exercising censere in
// isolation with controlled clocks.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { censere, type CensusDeps } from '../../../src/crystal/Census.js'
// Static, same-specifier import. A dynamic `await import()` of this module resolves to a SECOND
// module instance under tsx on Node 20 (what CI runs), so a listener registered on it never sees
// the emit Census.ts fires through its own static import. Node 26 dedupes them, which is why this
// only surfaced once the crystal globs actually expanded on 20. Prod runs compiled dist/, not tsx.
import { bus } from '../../../src/lib/bus.js'
import { Nexus } from '../../../src/ledger/Nexus.js'
import { studioSpendHook } from '../../../src/ledger/hooks/studioSpend.js'
import { MemorySignorum } from '../../../src/ledger/MemorySignorum.js'
import { MemoryModo } from '../../../src/execution/MemoryModo.js'
import { MemoryActorum } from '../../../src/execution/MemoryActorum.js'
import { ActumCompletor } from '../../../src/execution/ActumCompletor.js'
import type { Materia, MateriaStore, PodPolicy } from '../../../src/types/materia.js'
import type { Hospitium, HospitiumStore, HostKey } from '../../../src/types/hospitium.js'

// ── In-memory doubles ─────────────────────────────────────────────────────────
class FakeHospitium implements HospitiumStore {
  private byMateria = new Map<string, Hospitium>()
  private nextId = 1
  async create(input: Omit<Hospitium, 'id'>): Promise<Hospitium> {
    const h: Hospitium = { id: `h-${this.nextId++}`, ...input }
    if (!h.materiaId) throw new Error('FakeHospitium: this double keys by materiaId; create needs one')
    this.byMateria.set(h.materiaId, h)
    return h
  }
  async findByMateriaId(materiaId: string): Promise<Hospitium | null> {
    return this.byMateria.get(materiaId) ?? null
  }
  // Studio-binding half of the interface. This suite drives the billing tick, which
  // reads host records by materiaId only — these are unreached here, so they throw
  // rather than return a plausible default.
  async findByModoId(_modoId: string): Promise<Hospitium | null> {
    throw new Error('FakeHospitium.findByModoId: not implemented for this suite')
  }
  async bindMateria(_modoId: string, _materiaId: string): Promise<Hospitium> {
    throw new Error('FakeHospitium.bindMateria: not implemented for this suite')
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
  costPerHr?: number
}): CensusDeps & { hospitium: Hospitium; signorum: MemorySignorum; materiae: FakeMateriaStore } {
  const hostKey: HostKey = opts.hostKey ?? { animaId: HOST_ANIMA }
  const materiae = new FakeMateriaStore()
  const hospitia = new FakeHospitium()
  const signorum = new MemorySignorum()
  const nexus = new Nexus()
  nexus.on('studio_spend', studioSpendHook)

  const m: Materia = {
    id: MATERIA_ID, genus: 'runpod', externusId: 'pod-1', gpu: 'H100', vramGb: 80, ramGb: 200,
    impetusPerSecond: IMPETUS_PER_SECOND, status: opts.status ?? 'idle',
    ...(opts.costPerHr !== undefined ? { costPerHr: opts.costPerHr } : {}),
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
  const res = await censere(deps, h, new Date(h.inceptum.getTime() + 60_000))

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
  await censere(deps, (await deps.hospitia.findByMateriaId(MATERIA_ID))!, new Date(t0 + 60_000))
  await censere(deps, (await deps.hospitia.findByMateriaId(MATERIA_ID))!, new Date(t0 + 180_000))

  // First tick: 60s × 4 = 240; second: 120s × 4 = 480. Total 720.
  const after = (await deps.hospitia.findByMateriaId(MATERIA_ID))!
  assert.equal(after.costAccrued, 720n)
})

// ── 3. Balance-zero shortfall: clamps to available; engages drainOnly ────────
test('balance shortfall: clamps to available + sets Materia.drainOnly + emits bus event', async () => {
  const deps = makeDeps({ hostBalance: 100n })  // only 100 available; tick would ask 240
  await new Promise(r => setTimeout(r, 0))

  let drainEmitted = false
  bus.once('studio.draining', () => { drainEmitted = true })

  const h = (await deps.hospitia.findByMateriaId(MATERIA_ID))!
  const res = await censere(deps, h, new Date(h.inceptum.getTime() + 60_000))

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
  await censere(deps, h, new Date(h.inceptum.getTime() + 60_000))

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
  const res = await censere(deps, h, new Date(h.inceptum.getTime() + 60_000))

  assert.equal(res.charged, 0n)
  assert.equal((await deps.signorum.balance({ animaId: HOST_ANIMA })), 10_000n, 'balance untouched')
})

// ── 6. Zero elapsed seconds → no-op idempotency ──────────────────────────────
test('zero elapsed seconds: idempotent no-op (covers phase-transition retries)', async () => {
  const deps = makeDeps({ hostBalance: 10_000n })
  await new Promise(r => setTimeout(r, 0))

  const h = (await deps.hospitia.findByMateriaId(MATERIA_ID))!
  // censere at the same instant as lastBilledAt (inceptum here)
  const res = await censere(deps, h, new Date(h.inceptum.getTime()))

  assert.equal(res.charged, 0n)
  assert.equal((await deps.signorum.balance({ animaId: HOST_ANIMA })), 10_000n)
})

// ── 7. maxImpetus watchdog: budget exhaustion drains the studio ──────────────
// When a `modos` store is wired, Census ALSO enforces the studio's budget tessera:
// total accrued spend (warm-time costAccrued + run impetusAccrued) crossing the
// authorized sessionBudget drains the studio — independent of the host's balance.
async function makeBudgetDeps(opts: {
  budget: bigint
  impetusAccrued: bigint
  impetusPerSecond?: bigint
  hostBalance?: bigint
}): Promise<CensusDeps & { modo: { id: string }; materiae: FakeMateriaStore }> {
  const materiae = new FakeMateriaStore()
  const hospitia = new FakeHospitium()
  const signorum = new MemorySignorum()
  const modos = new MemoryModo()
  const nexus = new Nexus()
  nexus.on('studio_spend', studioSpendHook)

  const m: Materia = {
    id: MATERIA_ID, genus: 'runpod', externusId: 'pod-1', gpu: 'H100', vramGb: 80, ramGb: 200,
    impetusPerSecond: opts.impetusPerSecond ?? 1n, status: 'idle',
  }
  materiae.add(m)

  // Solvent host so the balance-shortfall trigger never fires — isolate the budget path.
  void signorum.issue({ animaId: HOST_ANIMA, forma: 'integer', valor: opts.hostBalance ?? 1_000_000n, auctor: 'test:seed' })

  // A bound session with prior run impetus + a budget tessera for it.
  const modo = await modos.create({ status: 'idle', materiamId: MATERIA_ID, impetusAccrued: opts.impetusAccrued, acta: [], idleWarmthSec: 300 })
  await signorum.issue({ forma: 'tessera', valor: opts.budget, auctor: 'system:session', testis: 'tess-1', modoId: modo.id })

  const inceptum = new Date(Date.now() - 60_000)
  await hospitia.create({ materiaId: MATERIA_ID, hostKey: { animaId: HOST_ANIMA }, inceptum })

  return { hospitia, materiae, signorum, nexus, modos, modo }
}

test('budget watchdog: accrued spend crossing the tessera budget engages drain', async () => {
  // budget 100; prior run impetus 50; this tick adds 60 warm-time → 110 ≥ 100 → drain.
  const deps = await makeBudgetDeps({ budget: 100n, impetusAccrued: 50n })
  const h = (await deps.hospitia.findByMateriaId(MATERIA_ID))!

  let drainEmitted = false
  bus.once('studio.draining', () => { drainEmitted = true })

  const res = await censere(deps, h, new Date(h.inceptum.getTime() + 60_000))

  assert.equal(res.charged, 60n, 'host balance fully covered the warm-time ask')
  assert.equal(res.drainEngaged, true, 'budget exhaustion drained the studio')
  assert.equal((await deps.materiae.findById(MATERIA_ID))?.drainOnly, true)
  assert.equal(drainEmitted, true)
})

test('budget watchdog: spend under the budget does NOT drain', async () => {
  // budget 10_000; prior 50 + 60 this tick = 110 ≪ budget → no drain.
  const deps = await makeBudgetDeps({ budget: 10_000n, impetusAccrued: 50n })
  const h = (await deps.hospitia.findByMateriaId(MATERIA_ID))!
  const res = await censere(deps, h, new Date(h.inceptum.getTime() + 60_000))
  assert.equal(res.drainEngaged, false)
  assert.equal((await deps.materiae.findById(MATERIA_ID))?.drainOnly, undefined)
})

test('budget watchdog: no modos store wired → budget is not enforced (balance-only)', async () => {
  // Same over-budget numbers, but omit `modos` → Census ignores the tessera entirely.
  const full = await makeBudgetDeps({ budget: 100n, impetusAccrued: 50n })
  const { modos: _drop, modo: _m, ...balanceOnly } = full
  const h = (await full.hospitia.findByMateriaId(MATERIA_ID))!
  const res = await censere(balanceOnly as CensusDeps, h, new Date(h.inceptum.getTime() + 60_000))
  assert.equal(res.drainEngaged, false, 'no modos → no budget drain')
})

// The budget the watchdog enforces is spent against the LEDGER, so the run spend it
// weighs has to be the ledger's SETTLED figure — not the cursor's metered one. This
// drives a real run through a real ActumCompletor into the session the watchdog then
// reads, and picks a budget that only the settled figure crosses: if the guard were
// still weighing the pre-settlement figure, the studio would run on past its budget.
test('budget watchdog: the decision weighs the ledger-settled run spend, not the metered one', async () => {
  const REPORTED = 60n          // what the cursor metered for the run
  const TICK = 60n              // this tick's warm-time charge (1 impetus/s × 60 s)
  // Sits above metered + tick and at/below settled + tick, so the two figures give
  // OPPOSITE answers and the assertion below can only pass on the settled one.
  const BUDGET = 180n

  const deps = await makeBudgetDeps({ budget: BUDGET, impetusAccrued: 0n })

  // A guest-tier run in this session: the warm surcharge puts the settled amount
  // above the metered one. Reservation is generous so the cap does not also bind.
  const acta = new MemoryActorum()
  const signum = await deps.signorum.issue({
    animaId: 'anima-runner', forma: 'integer', valor: 10_000n, auctor: 'test:seed',
  })
  const actum = await acta.create({
    id: 'actum-budget-1', modusId: 'mod-1', modusVersiono: '1.0.0',
    impetus: 10_000n, signaConsumed: [signum.id], aditus: {}, status: 'agens',
    expirat: new Date(Date.now() + 60_000),
    modoId: deps.modo.id,
    executio: { pricingTier: 'guest' },
  })
  await deps.signorum.lock([signum.id], actum.id)

  const completor = new ActumCompletor({ acta, signorum: deps.signorum, modos: deps.modos! })
  const completed = await completor.complete(
    actum, { exitus: {}, impetus: REPORTED, duratio: 60_000 },
  )
  const settled = completed.impetus

  // The premise, stated against the ledger's own number rather than re-derived: the
  // two candidate figures fall on opposite sides of this budget.
  assert.ok(REPORTED + TICK < BUDGET, 'the metered figure would NOT have crossed the budget')
  assert.ok(settled + TICK >= BUDGET, 'the settled figure DOES cross it')
  assert.equal((await deps.modos!.findById(deps.modo.id))!.impetusAccrued, settled)

  const h = (await deps.hospitia.findByMateriaId(MATERIA_ID))!
  const res = await censere(deps, h, new Date(h.inceptum.getTime() + 60_000))

  assert.equal(res.charged, TICK, 'the warm-time tick billed as expected')
  assert.equal(res.drainEngaged, true, 'the budget decision used the settled run spend')
})

// ── 8. Per-window billing from costPerHr (fidelity — rounds once, not per-second)
test('costPerHr present: bills the elapsed window once (no per-second ceil skew)', async () => {
  // $4/hr H100, 60s tick: 60_000 × 4 / 3_600_000 = $0.0667 → ceil(/0.000337) = 198 pts.
  // The legacy per-second path would over-charge: 60 × impetusPerSecond(4) = 240.
  const deps = makeDeps({ hostBalance: 1_000_000n, costPerHr: 4.0 })
  await new Promise(r => setTimeout(r, 0))
  const h = (await deps.hospitia.findByMateriaId(MATERIA_ID))!
  const res = await censere(deps, h, new Date(h.inceptum.getTime() + 60_000))
  assert.equal(res.requested, 198n, 'per-window charge from real cost')
  assert.equal(res.charged, 198n)
})

test('no costPerHr (legacy pod): falls back to the per-second impetusPerSecond rate', async () => {
  const deps = makeDeps({ hostBalance: 1_000_000n })   // no costPerHr
  await new Promise(r => setTimeout(r, 0))
  const h = (await deps.hospitia.findByMateriaId(MATERIA_ID))!
  const res = await censere(deps, h, new Date(h.inceptum.getTime() + 60_000))
  assert.equal(res.requested, 60n * IMPETUS_PER_SECOND, 'legacy fallback: 60 × 4 = 240')
})
