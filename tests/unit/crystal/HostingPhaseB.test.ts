import { test } from 'node:test'
import assert from 'node:assert/strict'

import { handleExecutionWebhook, type ExecutionWebhookDeps, type WebhookRequest } from '../../../src/api/webhooks/executionWebhook.js'
import { Nexus } from '../../../src/ledger/Nexus.js'
import { hostCutHook } from '../../../src/ledger/hooks/hostCut.js'
import { MemorySignorum } from '../../../src/ledger/MemorySignorum.js'
import { MemoryActorum } from '../../../src/execution/MemoryActorum.js'
import { ActumCompletor } from '../../../src/execution/ActumCompletor.js'
import type { Actum } from '../../../src/types/actum.js'
import type { Hospitium, HospitiumStore, HostKey } from '../../../src/types/hospitium.js'

// ── Fake HospitiumStore (in-memory; identity-bearing side-table, off-pod) ──────
class FakeHospitium implements HospitiumStore {
  private byMateria = new Map<string, Hospitium>()
  private nextId = 1

  async create(input: Omit<Hospitium, 'id'>): Promise<Hospitium> {
    const h: Hospitium = { id: `hosp-${this.nextId++}`, ...input }
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
    if (!cur) throw new Error(`Hospitium for materia '${materiaId}' not found`)
    const next = { ...cur, ...patch }
    this.byMateria.set(materiaId, next)
    return next
  }
}

const MATERIA_ID = 'materia-test-1'
const HOST_ANIMA = 'anima-host'
const GUEST_ANIMA = 'anima-guest'
const ADMIN_ANIMA = 'anima-admin'
const HOST_COMMITMENT = '0xabc123commitment'

interface ScenarioOpts {
  tier: 'owner' | 'admin' | 'guest' | undefined  // undefined = no executio stamp
  finalImpetus?: bigint
  baseImpetus?: bigint                            // actum reservation cap
  materiamId?: string
  hostKey?: HostKey | null                        // null = no Hospitium seeded
}

async function runScenario(opts: ScenarioOpts) {
  const actorum = new MemoryActorum()
  const signorum = new MemorySignorum()
  const hospitia = new FakeHospitium()
  const nexus = new Nexus()
  nexus.on('execution_spend', hostCutHook)

  const base = opts.baseImpetus ?? 1000n
  const actum: Actum = {
    id: 'actum-b-1',
    modusId: 'runmake.flux-schnell',
    modusVersiono: '1.0.0',
    impetus: base,                  // reservation cap
    signaConsumed: [],
    aditus: { prompt: 'a cat' },
    status: 'nascens',
    inceptum: new Date(),
    expirat: new Date(Date.now() + 60_000),
    externusJobId: 'job-phase-b-1',
    materiamId: opts.materiamId,
    executio: opts.tier
      ? { pricingTier: opts.tier, ...(opts.finalImpetus !== undefined ? { finalImpetus: opts.finalImpetus } : {}) }
      : undefined,
  }
  await actorum.create({ ...actum })

  if (opts.hostKey && opts.materiamId) {
    await hospitia.create({ materiaId: opts.materiamId, hostKey: opts.hostKey, inceptum: new Date() })
  }

  const completor = new ActumCompletor({ acta: actorum, signorum })

  const deps: ExecutionWebhookDeps = { actorum, completor, nexus, signorum, hospitia }
  const req: WebhookRequest = {
    body: { id: 'job-phase-b-1', status: 'COMPLETED', output: [], executionTime: 200_000 },
    rawBody: '',
  }
  const res = await handleExecutionWebhook(req, deps)
  assert.equal(res.status, 200)

  const stored = await actorum.findById(actum.id)
  return { stored: stored!, signorum }
}

// ── Scenario 1: Owner runs on their own pod ───────────────────────────────────
// Dispatch stamped tier=owner, finalImpetus = base. Host cut MUST NOT fire even
// though Hospitium identifies the same anima — modoHostAnimaId is only resolved
// for guest tier.
test('owner tier — no host-cut signum; impetus = base', async () => {
  const { stored, signorum } = await runScenario({
    tier: 'owner',
    finalImpetus: 200n,
    materiamId: MATERIA_ID,
    hostKey: { animaId: HOST_ANIMA },
  })
  assert.equal(stored.executio?.pricingTier, 'owner')
  assert.equal(stored.impetus, 200n)
  const hostSigna = await signorum.history({ animaId: HOST_ANIMA })
  assert.equal(hostSigna.length, 0, 'owner runs must not pay themselves')
})

// ── Scenario 2: Admin runs on host's pod (group-chat at-cost) ─────────────────
test('admin tier — no host-cut signum; impetus = base', async () => {
  const { stored, signorum } = await runScenario({
    tier: 'admin',
    finalImpetus: 200n,
    materiamId: MATERIA_ID,
    hostKey: { animaId: HOST_ANIMA },
  })
  assert.equal(stored.executio?.pricingTier, 'admin')
  assert.equal(stored.impetus, 200n)
  const hostSigna = await signorum.history({ animaId: HOST_ANIMA })
  assert.equal(hostSigna.length, 0, 'admin at-cost runs must not pay host')
})

// ── Scenario 3: Guest runs on identified host's pod ───────────────────────────
// finalImpetus = base + bootShare (240 = 200 + 40). hostCutHook fires; reward
// signum lands on the host anima with valor = 20% × 240 = 48.
test('guest, identified host — reward signum to host, valor = 20% × finalImpetus', async () => {
  const { stored, signorum } = await runScenario({
    tier: 'guest',
    finalImpetus: 240n,                  // 200 base + 40 boot share
    materiamId: MATERIA_ID,
    hostKey: { animaId: HOST_ANIMA },
  })
  assert.equal(stored.executio?.pricingTier, 'guest')
  assert.equal(stored.impetus, 240n, 'finalImpetus drives settled spend')

  const hostSigna = await signorum.history({ animaId: HOST_ANIMA })
  assert.equal(hostSigna.length, 1)
  assert.equal(hostSigna[0].forma, 'reward')
  assert.equal(hostSigna[0].valor, 48n, '20% × 240 = 48')
  assert.equal(hostSigna[0].auctor, 'nexus:hostCut')

  // Guest anima never receives a host-cut (sanity)
  const guestSigna = await signorum.history({ animaId: GUEST_ANIMA })
  assert.equal(guestSigna.length, 0)
})

// ── Scenario 4: Guest runs on anonymous (arcanum-commitment) host's pod ───────
// finalImpetus surcharged identically. hostCutHook MUST NOT emit a signum at
// this layer: Phase B execution_spend only carries animaId. (Phase C will widen
// the payload to a full HostKey so commitment-hosts also earn.) The actum still
// settles at 240 — the boot recovery flows back via a separate Phase C hook.
test('guest, anonymous host — finalImpetus surcharged; no host-cut signum yet', async () => {
  const { stored, signorum } = await runScenario({
    tier: 'guest',
    finalImpetus: 240n,
    materiamId: MATERIA_ID,
    hostKey: { commitment: HOST_COMMITMENT },
  })
  assert.equal(stored.executio?.pricingTier, 'guest')
  assert.equal(stored.impetus, 240n, 'commitment-host still collects surcharge in the spend')

  // No animaId on the host → nothing on the host anima rail
  const hostSigna = await signorum.history({ animaId: HOST_ANIMA })
  assert.equal(hostSigna.length, 0, 'anonymous host gets no animaId-rail payout in Phase B')
})

// ── Scenario 5: No Hospitium (legacy pod, predates the hosting layer) ─────────
// Webhook lookup returns null. hostCutHook receives undefined modoHostAnimaId.
test('no Hospitium — no host-cut signum; settle proceeds at finalImpetus or report', async () => {
  const { stored, signorum } = await runScenario({
    tier: 'guest',
    finalImpetus: 200n,
    materiamId: MATERIA_ID,
    hostKey: null,                 // no Hospitium seeded
  })
  assert.equal(stored.impetus, 200n)
  const hostSigna = await signorum.history({ animaId: HOST_ANIMA })
  assert.equal(hostSigna.length, 0)
})

// ── Sanity: dispatched finalImpetus is capped at the reservation ──────────────
// Guard against an arithmetic regression where a too-large bootShare would let
// a guest run settle above the locked reservation. Completor must clamp.
test('finalImpetus cap — settles at reservation when dispatched exceeds it', async () => {
  const { stored } = await runScenario({
    tier: 'guest',
    baseImpetus: 220n,             // reservation
    finalImpetus: 500n,            // dispatch decision (bug or extreme bootShare)
    materiamId: MATERIA_ID,
    hostKey: { animaId: HOST_ANIMA },
  })
  assert.equal(stored.impetus, 220n, 'completor caps at actum.impetus reservation')
})
