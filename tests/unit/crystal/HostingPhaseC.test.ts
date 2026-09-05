// Phase C end-to-end — the ambassador-economics matrix.
//
// hostCutHook (taxes baseImpetus only) AND hospitiumHook (HOST_BONUS_RATE %
// of WARM_SURCHARGE_IMPETUS) both fire on `execution_spend`, both branch on
// the HostKey discriminant. Two payout streams to the host on every guest gen;
// identified hosts collect `reward` signa, commitment hosts collect `arcanum`
// signa via the existing Signorum.balance({commitment}) rail with no animaId.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { handleExecutionWebhook, type ExecutionWebhookDeps, type WebhookRequest } from '../../../src/api/webhooks/executionWebhook.js'
import { Nexus } from '../../../src/ledger/Nexus.js'
import { hostCutHook } from '../../../src/ledger/hooks/hostCut.js'
import { hospitiumHook } from '../../../src/ledger/hooks/hospitium.js'
import { MemorySignorum } from '../../../src/ledger/MemorySignorum.js'
import { MemoryActorum } from '../../../src/execution/MemoryActorum.js'
import { ActumCompletor } from '../../../src/execution/ActumCompletor.js'
import { WARM_SURCHARGE_IMPETUS, HOST_BONUS_RATE } from '../../../src/ledger/rates.js'
import type { Actum } from '../../../src/types/actum.js'
import type { Hospitium, HospitiumStore, HostKey } from '../../../src/types/hospitium.js'

// ── Fake HospitiumStore (mirrors Phase B test) ────────────────────────────────
class FakeHospitium implements HospitiumStore {
  private byMateria = new Map<string, Hospitium>()
  private nextId = 1
  async create(input: Omit<Hospitium, 'id'>): Promise<Hospitium> {
    const h: Hospitium = { id: `hosp-${this.nextId++}`, ...input }
    if (!h.materiaId) throw new Error('FakeHospitium: this double keys by materiaId; create needs one')
    this.byMateria.set(h.materiaId, h)
    return h
  }
  async findByMateriaId(materiaId: string): Promise<Hospitium | null> {
    return this.byMateria.get(materiaId) ?? null
  }
  // Studio-binding half of the interface — this suite only exercises pod-keyed host
  // records, so these are unreached here and throw rather than return a plausible default.
  async findByModoId(_modoId: string): Promise<Hospitium | null> {
    throw new Error('FakeHospitium.findByModoId: not implemented for this suite')
  }
  async bindMateria(_modoId: string, _materiaId: string): Promise<Hospitium> {
    throw new Error('FakeHospitium.bindMateria: not implemented for this suite')
  }
  async findActive(): Promise<Hospitium[]> {
    return [...this.byMateria.values()].filter(h => !h.terminatum)
  }
  async update(materiaId: string, patch: Partial<Pick<Hospitium, 'adminAnimaIds' | 'terminatum' | 'costAccrued' | 'lastBilledAt'>>): Promise<Hospitium> {
    const cur = this.byMateria.get(materiaId)
    if (!cur) throw new Error(`not found`)
    const next = { ...cur, ...patch }
    this.byMateria.set(materiaId, next)
    return next
  }
}

const MATERIA_ID = 'materia-c-1'
const HOST_ANIMA = 'anima-host'
const GUEST_ANIMA = 'anima-guest'
const HOST_COMMITMENT = '0xabc123commitment'

const EXPECTED_HOSPITIUM_VALOR = (WARM_SURCHARGE_IMPETUS * HOST_BONUS_RATE) / 100n  // 64n on defaults
const BASE = 200n  // guest baseImpetus across all scenarios
const HOST_CUT_VALOR = (BASE * 20n) / 100n  // 40n

interface ScenarioOpts {
  tier: 'owner' | 'admin' | 'guest' | undefined
  hostKey?: HostKey | null
  baseImpetus?: bigint
}

async function runScenario(opts: ScenarioOpts) {
  const actorum = new MemoryActorum()
  const signorum = new MemorySignorum()
  const hospitia = new FakeHospitium()
  const nexus = new Nexus()
  nexus.on('execution_spend', hostCutHook)
  nexus.on('execution_spend', hospitiumHook)

  const base = opts.baseImpetus ?? BASE
  const finalImpetus = opts.tier === 'guest' ? base + WARM_SURCHARGE_IMPETUS : base
  const actum: Actum = {
    id: 'actum-c-1',
    modusId: 'm.x',
    modusVersiono: '1.0.0',
    impetus: finalImpetus,  // reservation must cover final spend
    signaConsumed: [],
    aditus: { prompt: 'x' },
    status: 'nascens',
    inceptum: new Date(),
    expirat: new Date(Date.now() + 60_000),
    externusJobId: 'job-c-1',
    materiamId: MATERIA_ID,
    executio: opts.tier
      ? { pricingTier: opts.tier, baseImpetus: base, finalImpetus }
      : undefined,
  }
  await actorum.create({ ...actum })

  if (opts.hostKey) {
    await hospitia.create({ materiaId: MATERIA_ID, hostKey: opts.hostKey, inceptum: new Date() })
  }

  // The completor is the one `execution_spend` emitter, on every rail — so the bus
  // and the host side-table are wired HERE, not onto the webhook. The webhook's job
  // is to deliver the completion; the payout is settled where the run is settled.
  const completor = new ActumCompletor({ acta: actorum, signorum, nexus, hospitia })
  const deps: ExecutionWebhookDeps = { actorum, completor }
  const req: WebhookRequest = {
    body: { id: 'job-c-1', status: 'COMPLETED', output: [], executionTime: Number(base) * 1000 },
    rawBody: '',
  }
  const res = await handleExecutionWebhook(req, deps)
  assert.equal(res.status, 200)
  return { signorum, stored: (await actorum.findById(actum.id))! }
}

// ── 1. Guest, identified host — TWO reward signa lands on host's anima ────────
test('guest + identified host → reward signa from BOTH hostCut and hospitium', async () => {
  const { signorum, stored } = await runScenario({
    tier: 'guest',
    hostKey: { animaId: HOST_ANIMA },
  })
  assert.equal(stored.impetus, BASE + WARM_SURCHARGE_IMPETUS)

  const signa = await signorum.history({ animaId: HOST_ANIMA })
  const byAuctor = Object.fromEntries(signa.map(s => [s.auctor, s]))
  assert.ok(byAuctor['nexus:hostCut'], 'hostCut signum present')
  assert.equal(byAuctor['nexus:hostCut'].forma, 'reward')
  assert.equal(byAuctor['nexus:hostCut'].valor, HOST_CUT_VALOR, '20% × base')

  assert.ok(byAuctor['nexus:hospitium'], 'hospitium signum present')
  assert.equal(byAuctor['nexus:hospitium'].forma, 'reward')
  assert.equal(byAuctor['nexus:hospitium'].valor, EXPECTED_HOSPITIUM_VALOR, '80% × WARM_SURCHARGE_IMPETUS')

  // No animaId leak to guest
  const guestSigna = await signorum.history({ animaId: GUEST_ANIMA })
  assert.equal(guestSigna.length, 0)
})

// ── 2. Guest, commitment host — TWO arcanum signa, animaId UNSET, testis set ─
test('guest + commitment host → arcanum signa from BOTH hooks, no animaId leak', async () => {
  const { signorum } = await runScenario({
    tier: 'guest',
    hostKey: { commitment: HOST_COMMITMENT },
  })

  const signa = await signorum.history({ commitment: HOST_COMMITMENT })
  const byAuctor = Object.fromEntries(signa.map(s => [s.auctor, s]))

  assert.ok(byAuctor['nexus:hostCut'])
  assert.equal(byAuctor['nexus:hostCut'].forma, 'arcanum')
  assert.equal(byAuctor['nexus:hostCut'].animaId, undefined, 'arcanum signum NEVER carries animaId')
  assert.equal(byAuctor['nexus:hostCut'].testis, HOST_COMMITMENT)
  assert.equal(byAuctor['nexus:hostCut'].valor, HOST_CUT_VALOR)

  assert.ok(byAuctor['nexus:hospitium'])
  assert.equal(byAuctor['nexus:hospitium'].forma, 'arcanum')
  assert.equal(byAuctor['nexus:hospitium'].animaId, undefined)
  assert.equal(byAuctor['nexus:hospitium'].testis, HOST_COMMITMENT)
  assert.equal(byAuctor['nexus:hospitium'].valor, EXPECTED_HOSPITIUM_VALOR)
})

// ── 3. Owner — no host-bound signa fire ──────────────────────────────────────
test('owner tier → neither hostCut nor hospitium fires', async () => {
  const { signorum, stored } = await runScenario({
    tier: 'owner',
    hostKey: { animaId: HOST_ANIMA },
  })
  assert.equal(stored.impetus, BASE, 'owner pays base, no surcharge')
  const hostSigna = await signorum.history({ animaId: HOST_ANIMA })
  assert.equal(hostSigna.length, 0, 'owner runs do not pay themselves')
})

// ── 4. Admin — no host-bound signa fire ──────────────────────────────────────
test('admin tier → neither hostCut nor hospitium fires', async () => {
  const { signorum, stored } = await runScenario({
    tier: 'admin',
    hostKey: { animaId: HOST_ANIMA },
  })
  assert.equal(stored.impetus, BASE, 'admin pays base, no surcharge')
  const hostSigna = await signorum.history({ animaId: HOST_ANIMA })
  assert.equal(hostSigna.length, 0)
})

// ── 5. No Hospitium (legacy pod) — no host-bound signa fire ──────────────────
test('no Hospitium → modoHostKey unresolved, neither host-bound hook fires', async () => {
  const { signorum } = await runScenario({
    tier: 'guest',
    hostKey: null,  // no Hospitium seeded
  })
  const hostSigna = await signorum.history({ animaId: HOST_ANIMA })
  assert.equal(hostSigna.length, 0)
})

// ── 6. Balance proof — identified host's total earnings on a guest gen ───────
test('Signorum.balance({animaId}) reflects both host-bound signa', async () => {
  const { signorum } = await runScenario({
    tier: 'guest',
    hostKey: { animaId: HOST_ANIMA },
  })
  const balance = await signorum.balance({ animaId: HOST_ANIMA })
  assert.equal(balance, HOST_CUT_VALOR + EXPECTED_HOSPITIUM_VALOR, '40 (hostCut) + 64 (hospitium) = 104')
})

// ── 7. Balance proof — commitment host's total earnings on a guest gen ───────
test('Signorum.balance({commitment}) reflects both host-bound arcanum signa', async () => {
  const { signorum } = await runScenario({
    tier: 'guest',
    hostKey: { commitment: HOST_COMMITMENT },
  })
  const balance = await signorum.balance({ commitment: HOST_COMMITMENT })
  assert.equal(balance, HOST_CUT_VALOR + EXPECTED_HOSPITIUM_VALOR,
    'anonymous host earns the same total as identified — privacy without economic penalty')
})
