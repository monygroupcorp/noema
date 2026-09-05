import { test } from 'node:test'
import assert from 'node:assert/strict'

import { handleExecutionWebhook, type ExecutionWebhookDeps, type WebhookRequest } from '../../../src/api/webhooks/executionWebhook.js'
import { Nexus } from '../../../src/ledger/Nexus.js'
import { hostCutHook } from '../../../src/ledger/hooks/hostCut.js'
import { WARM_SURCHARGE_IMPETUS } from '../../../src/ledger/rates.js'
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

// Reported cost for every scenario: the webhook derives it from executionTime,
// so 200_000 ms of pod wall-clock is a measured cost of 200 impetus.
const REPORTED_MS = 200_000
const MEASURED = 200n

interface ScenarioOpts {
  tier: 'owner' | 'admin' | 'guest' | undefined  // undefined = no executio stamp
  reservation?: bigint                            // actum reservation cap
  materiamId?: string
  hostKey?: HostKey | null                        // null = no Hospitium seeded
}

async function runScenario(opts: ScenarioOpts) {
  const actorum = new MemoryActorum()
  const signorum = new MemorySignorum()
  const hospitia = new FakeHospitium()
  const nexus = new Nexus()
  nexus.on('execution_spend', hostCutHook)

  const reservation = opts.reservation ?? 1000n
  const actum: Actum = {
    id: 'actum-b-1',
    modusId: 'flux-schnell',
    modusVersiono: '1.0.0',
    impetus: reservation,           // reservation cap
    signaConsumed: [],
    aditus: { prompt: 'a cat' },
    status: 'nascens',
    inceptum: new Date(),
    expirat: new Date(Date.now() + 60_000),
    externusJobId: 'job-phase-b-1',
    materiamId: opts.materiamId,
    // Dispatch stamps the TIER only — the amounts are derived from the measured
    // cost at completion.
    executio: opts.tier ? { pricingTier: opts.tier } : undefined,
  }
  await actorum.create({ ...actum })

  if (opts.hostKey && opts.materiamId) {
    await hospitia.create({ materiaId: opts.materiamId, hostKey: opts.hostKey, inceptum: new Date() })
  }

  // The completor is the one `execution_spend` emitter, on every rail — so the bus
  // and the host side-table are wired HERE, not onto the webhook. The webhook's job
  // is to deliver the completion; the payout is settled where the run is settled.
  const completor = new ActumCompletor({ acta: actorum, signorum, nexus, hospitia })

  const deps: ExecutionWebhookDeps = { actorum, completor }
  const req: WebhookRequest = {
    body: { id: 'job-phase-b-1', status: 'COMPLETED', output: [], executionTime: REPORTED_MS },
    rawBody: '',
  }
  const res = await handleExecutionWebhook(req, deps)
  assert.equal(res.status, 200)

  const stored = await actorum.findById(actum.id)
  return { stored: stored!, signorum }
}

// ── Scenario 1: Owner runs on their own pod ───────────────────────────────────
// Dispatch stamped tier=owner. Host cut MUST NOT fire even though Hospitium
// identifies the same anima — modoHostAnimaId is only resolved for guest tier.
// The owner settles at the measured cost, with no surcharge.
test('owner tier — no host-cut signum; impetus = the measured cost', async () => {
  const { stored, signorum } = await runScenario({
    tier: 'owner',
    materiamId: MATERIA_ID,
    hostKey: { animaId: HOST_ANIMA },
  })
  assert.equal(stored.executio?.pricingTier, 'owner')
  assert.equal(stored.impetus, MEASURED)
  const hostSigna = await signorum.history({ animaId: HOST_ANIMA })
  assert.equal(hostSigna.length, 0, 'owner runs must not pay themselves')
})

// ── Scenario 2: Admin runs on host's pod (group-chat at-cost) ─────────────────
test('admin tier — no host-cut signum; impetus = the measured cost', async () => {
  const { stored, signorum } = await runScenario({
    tier: 'admin',
    materiamId: MATERIA_ID,
    hostKey: { animaId: HOST_ANIMA },
  })
  assert.equal(stored.executio?.pricingTier, 'admin')
  assert.equal(stored.impetus, MEASURED)
  const hostSigna = await signorum.history({ animaId: HOST_ANIMA })
  assert.equal(hostSigna.length, 0, 'admin at-cost runs must not pay host')
})

// ── Scenario 3: Guest runs on identified host's pod ───────────────────────────
// Settles at the measured cost + the flat warm surcharge. hostCutHook fires on
// the measured base (not the surcharge, which hospitiumHook compensates
// separately): reward signum on the host anima with valor = 20% × 200 = 40.
test('guest, identified host — reward signum to host, valor = 20% × measured base', async () => {
  const { stored, signorum } = await runScenario({
    tier: 'guest',
    materiamId: MATERIA_ID,
    hostKey: { animaId: HOST_ANIMA },
  })
  assert.equal(stored.executio?.pricingTier, 'guest')
  assert.equal(stored.impetus, MEASURED + WARM_SURCHARGE_IMPETUS, 'measured cost + surcharge')

  const hostSigna = await signorum.history({ animaId: HOST_ANIMA })
  assert.equal(hostSigna.length, 1)
  assert.equal(hostSigna[0].forma, 'reward')
  assert.equal(hostSigna[0].valor, (MEASURED * 20n) / 100n, '20% × 200 = 40')
  assert.equal(hostSigna[0].auctor, 'nexus:hostCut')

  // Guest anima never receives a host-cut (sanity)
  const guestSigna = await signorum.history({ animaId: GUEST_ANIMA })
  assert.equal(guestSigna.length, 0)
})

// ── Scenario 4: Guest runs on anonymous (arcanum-commitment) host's pod ───────
// Surcharged identically. hostCutHook MUST NOT emit a signum at
// this layer: Phase B execution_spend only carries animaId. (Phase C will widen
// the payload to a full HostKey so commitment-hosts also earn.) The actum still
// settles surcharged — the boot recovery flows back via a separate Phase C hook.
test('guest, anonymous host — spend surcharged; no host-cut signum yet', async () => {
  const { stored, signorum } = await runScenario({
    tier: 'guest',
    materiamId: MATERIA_ID,
    hostKey: { commitment: HOST_COMMITMENT },
  })
  assert.equal(stored.executio?.pricingTier, 'guest')
  assert.equal(stored.impetus, MEASURED + WARM_SURCHARGE_IMPETUS,
    'commitment-host still collects surcharge in the spend')

  // No animaId on the host → nothing on the host anima rail
  const hostSigna = await signorum.history({ animaId: HOST_ANIMA })
  assert.equal(hostSigna.length, 0, 'anonymous host gets no animaId-rail payout in Phase B')
})

// ── Scenario 5: No Hospitium (legacy pod, predates the hosting layer) ─────────
// Webhook lookup returns null. hostCutHook receives undefined modoHostAnimaId.
test('no Hospitium — no host-cut signum; settle proceeds on the measured cost', async () => {
  const { stored, signorum } = await runScenario({
    tier: 'guest',
    materiamId: MATERIA_ID,
    hostKey: null,                 // no Hospitium seeded
  })
  assert.equal(stored.impetus, MEASURED + WARM_SURCHARGE_IMPETUS)
  const hostSigna = await signorum.history({ animaId: HOST_ANIMA })
  assert.equal(hostSigna.length, 0)
})

// ── Sanity: the settled total is capped at the reservation ───────────────────
// Guard against an arithmetic regression where the surcharge would let a guest
// run settle above the locked reservation. Completor must clamp.
test('reservation cap — settles at the reservation when measured + surcharge exceeds it', async () => {
  const { stored } = await runScenario({
    tier: 'guest',
    reservation: 220n,             // measured 200 + surcharge 80 = 280 > 220
    materiamId: MATERIA_ID,
    hostKey: { animaId: HOST_ANIMA },
  })
  assert.equal(stored.impetus, 220n, 'completor caps at actum.impetus reservation')
})
