// Cursor-stamp-survives integration test.
//
// The five-scenario HostingPhaseB.test.ts seeds the actum with a pre-stamped
// executio. This test fills the gap: it drives RunPodCursor.run through a warm
// client whose onMetrics fires mid-run with pod-telemetry — proving the
// dispatch-stamped {pricingTier, finalImpetus} are NOT clobbered by the merge
// in the cursor's onMetrics callback. Without the merge, the guest surcharge
// silently disappears on every warm reuse — exactly the path Phase B exists to
// price.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { RunPodCursor, type RunPodClient, type ProvisioningContext } from '../../../src/crystal/RunPodCursor.js'
import { Praefectus } from '../../../src/crystal/Praefectus.js'
import { MemoryActorum } from '../../../src/execution/MemoryActorum.js'
import { MemoryModorum } from '../../../src/execution/MemoryModorum.js'
import { withTrace, makeTraceContext } from '../../../src/lib/trace.js'
import type { Actum, ActumExecutio } from '../../../src/types/actum.js'
import type { Materia, MateriaStore, PodPolicy } from '../../../src/types/materia.js'
import type { Hospitium, HospitiumStore, HostKey } from '../../../src/types/hospitium.js'
import type { Modus } from '../../../src/types/modus.js'

// ── In-test doubles ───────────────────────────────────────────────────────────
class StubMateriaStore implements MateriaStore {
  constructor(private readonly seeded: Materia[]) {}
  async findWarm(spec: { imageRef?: string; podPolicy?: PodPolicy; shareToken?: string }): Promise<Materia | null> {
    return this.seeded.find(m =>
      (!spec.imageRef || m.imageRef === spec.imageRef) &&
      m.status === 'idle',
    ) ?? null
  }
  // Unused stubs — the cursor's warm path only calls findWarm.
  async create(): Promise<Materia> { throw new Error('not used') }
  async update(): Promise<Materia> { throw new Error('not used') }
  async findById(id: string): Promise<Materia | null> { return this.seeded.find(m => m.id === id) ?? null }
  async findActive(): Promise<Materia[]> { return this.seeded }
  async reapIdle(): Promise<Materia[]> { return [] }
}

class FakeHospitium implements HospitiumStore {
  constructor(private readonly byMateria: Map<string, Hospitium>) {}
  async create(input: Omit<Hospitium, 'id'>): Promise<Hospitium> {
    const h: Hospitium = { id: 'hosp-x', ...input }
    this.byMateria.set(h.materiaId, h)
    return h
  }
  async findByMateriaId(materiaId: string): Promise<Hospitium | null> {
    return this.byMateria.get(materiaId) ?? null
  }
  async update(): Promise<Hospitium> { throw new Error('not used') }
}

/**
 * Warm client that fires onMetrics mid-submit — the same pattern WarmPodClient
 * uses (Object.assign into a local executio, push the full snapshot). If the
 * cursor overwrites instead of merging, the dispatch stamp dies here.
 */
class MetricsFiringWarmClient implements RunPodClient {
  public lastProvisioningContext?: ProvisioningContext
  async submit(params: {
    input: unknown
    webhook?: string
    provisioningContext?: ProvisioningContext
    onPodActive?: (podId: string) => Promise<void>
    onMetrics?: (e: ActumExecutio) => Promise<void>
  }): Promise<{ id: string }> {
    this.lastProvisioningContext = params.provisioningContext
    // Two reports, accumulating — exactly WarmPodClient's pattern.
    await params.onMetrics?.({ podId: 'pod-warm-1', coldStart: false })
    await params.onMetrics?.({ podId: 'pod-warm-1', coldStart: false, executionMs: 4_200 })
    return { id: 'job-x' }
  }
}

// ── Fixtures ──────────────────────────────────────────────────────────────────
const MATERIA: Materia = {
  id: 'materia-warm-1',
  genus: 'pod',
  externusId: 'pod-warm-1',
  gpu: 'H100-80GB',
  vramGb: 80,
  ramGb: 200,
  imageRef: 'stationthis/flux:v1',
  impetusPerSecond: 1n,
  status: 'idle',
  // bootCostImpetus / bootRecovered intentionally omitted — Phase C dropped
  // per-pod boot accounting; guest pricing now reads only WARM_SURCHARGE_IMPETUS.
}

const MODUS: Modus = {
  id: 'm.test',
  nomen: 'Test',
  genus: 'atomicus',
  versio: '1.0.0',
  contentHash: 'h',
  aditus: {},
  exitus: {},
  canonica: true,
  auctor: 'anima-author',
  natum: new Date(),
  mutatum: new Date(),
}

function makeActum(): Actum {
  return {
    id: 'actum-x',
    modusId: 'm.test',
    modusVersiono: '1.0.0',
    impetus: 1000n,             // reservation cap
    signaConsumed: [],
    aditus: { prompt: 'a cat' },
    status: 'nascens',
    inceptum: new Date(),
    expirat: new Date(Date.now() + 60_000),
  }
}

async function runCursor(opts: { runnerAnimaId: string; hostAnimaId: string }) {
  const actorum = new MemoryActorum()
  const modorum = new MemoryModorum()
  await modorum.register({ ...MODUS })

  const materiae = new StubMateriaStore([MATERIA])
  const praefectus = new Praefectus(materiae)

  const hospMap = new Map<string, Hospitium>()
  hospMap.set(MATERIA.id, {
    id: 'h-1', materiaId: MATERIA.id,
    hostKey: { animaId: opts.hostAnimaId } as HostKey,
    inceptum: new Date(),
  })
  const hospitia = new FakeHospitium(hospMap)

  const warmClient = new MetricsFiringWarmClient()
  const coldClient: RunPodClient = { async submit() { throw new Error('cold path must not run in this test') } }

  const cursor = new RunPodCursor(
    coldClient,
    async (_m, _a) => ({ hash: 'h', input: { ok: true } }),
    modorum,
    actorum,
    {
      webhookUrl: 'http://localhost/none',
      praefectus,
      warmFactory: () => warmClient,
      imageRefOf: () => MATERIA.imageRef!,
      hospitia,
    },
  )

  const actum = makeActum()
  await actorum.create({ ...actum })

  await withTrace(
    makeTraceContext({ animaId: opts.runnerAnimaId, actumId: actum.id }),
    () => cursor.run(actum),
  )
  return { stored: (await actorum.findById(actum.id))!, warmClient }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('warm-path guest: dispatch stamp survives onMetrics merges', async () => {
  const { stored, warmClient } = await runCursor({
    runnerAnimaId: 'anima-guest',
    hostAnimaId:   'anima-host',
  })

  // Routing: the cursor handed off to the warm client with the runner's hostKey
  // and the materia id stamped on the actum.
  assert.deepEqual(warmClient.lastProvisioningContext?.hostKey, { animaId: 'anima-guest' })
  assert.equal(stored.materiamId, MATERIA.id)

  // Dispatch stamp survives both onMetrics reports.
  assert.equal(stored.executio?.pricingTier, 'guest')
  assert.equal(stored.executio?.baseImpetus, 1000n, 'base stashed alongside final')
  assert.equal(stored.executio?.finalImpetus, 1000n + 80n, 'base + WARM_SURCHARGE_IMPETUS')

  // Pod-telemetry merged in too — proof the merge actually merges, not just
  // preserves. The latest onMetrics snapshot wins on the keys it sets.
  assert.equal(stored.executio?.podId, 'pod-warm-1')
  assert.equal(stored.executio?.coldStart, false)
  assert.equal(stored.executio?.executionMs, 4_200)
})

test('warm-path owner: dispatch stamps owner; finalImpetus = base (no surcharge)', async () => {
  const { stored } = await runCursor({
    runnerAnimaId: 'anima-host',
    hostAnimaId:   'anima-host',          // same identity → owner tier
  })
  assert.equal(stored.executio?.pricingTier, 'owner')
  assert.equal(stored.executio?.finalImpetus, 1000n, 'owner pays base only')
  assert.equal(stored.executio?.executionMs, 4_200, 'telemetry still merged in')
})
