import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Actum } from '../../../src/types/actum.js'
import type { Signum } from '../../../src/types/significandi.js'
import type { Exitus, Actorum } from '../../../src/types/cursus.js'
import type { Nexus } from '../../../src/types/nexus.js'
import type { Vestigiorum } from '../../../src/types/vestigium.js'
import type { DeploymentumStore } from '../../../src/types/deploymentum.js'
import type { Intella, Intellarum } from '../../../src/types/intelligendi.js'
import { ActumCompletor } from '../../../src/execution/ActumCompletor.js'
import { WARM_SURCHARGE_IMPETUS } from '../../../src/ledger/rates.js'
import { MemoryVestigiorum } from '../../../src/rag/MemoryVestigiorum.js'

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

function makeActum(overrides: Partial<Actum> = {}): Actum {
  return {
    id: 'act-1', modusId: 'mod-1', modusVersiono: '1.0.0',
    impetus: 100n, signaConsumed: ['sig-a', 'sig-b'],
    aditus: {}, status: 'nascens', inceptum: new Date(),
    expirat: new Date(Date.now() + 60_000),
    ...overrides,
  }
}

function makeRunResult(overrides: Partial<Exitus> = {}): Exitus {
  return { exitus: { url: 'https://example.com/out.png' }, impetus: 80n, duratio: 5000, ...overrides }
}

/**
 * A member the fake does not model. It throws rather than returning a plausible default:
 * a stub that quietly answers `null`/`[]` is a new way for a test to pass while lying.
 */
function unmodelled(fake: string, name: string) {
  return async (): Promise<never> => {
    throw new Error(`${fake} fake: ${name}() is not modelled`)
  }
}

function makeActa(actum: Actum): Actorum & { latest: Actum } {
  let latest = { ...actum }
  return {
    get latest() { return latest },
    create: async (a) => { latest = { ...a, inceptum: new Date() }; return latest },
    update: async (_id, patch) => { Object.assign(latest, patch); return latest },
    findById: async () => latest,
    findByExternusJobId: unmodelled('Actorum', 'findByExternusJobId'),
    findByCallbackNonce: unmodelled('Actorum', 'findByCallbackNonce'),
    findByNullifier: unmodelled('Actorum', 'findByNullifier'),
    findExpired: unmodelled('Actorum', 'findExpired'),
    findInFlight: unmodelled('Actorum', 'findInFlight'),
    findByCompositum: unmodelled('Actorum', 'findByCompositum'),
  }
}

function makeSignorum() {
  const released: string[] = []
  const settled: Array<{ ids: string[]; actualImpetus: bigint; actumId: string }> = []
  return {
    balance: async () => 500n,
    issue: async (s: Omit<Signum, 'id' | 'natum' | 'status'>) => ({ ...s, id: 'new', status: 'valid' as const, natum: new Date() }),
    spend: async () => {},
    lock: async () => {},
    release: async (ids: string[]) => { released.push(...ids) },
    history: async () => [],
    settle: async (ids: string[], actualImpetus: bigint, actumId: string) => { settled.push({ ids, actualImpetus, actumId }) },
    sessionBudget: unmodelled('Signorum', 'sessionBudget'),
    reserve: unmodelled('Signorum', 'reserve'),
    findByTestis: unmodelled('Signorum', 'findByTestis'),
    ownsAny: unmodelled('Signorum', 'ownsAny'),
    transfer: unmodelled('Signorum', 'transfer'),
    createMany: unmodelled('Signorum', 'createMany'),
    _released: released,
    _settled: settled,
  }
}

function makeNexus() {
  const emitted: Array<{ type: string; payload: unknown }> = []
  return {
    on: () => {},
    emit: async (event: { type: string; payload: unknown }) => { emitted.push(event); return [] },
    _emitted: emitted,
  } satisfies Nexus & { _emitted: typeof emitted }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('updates actum status to completus on success', async () => {
  const actum = makeActum()
  const acta = makeActa(actum)
  const completor = new ActumCompletor({ acta, signorum: makeSignorum(), nexus: makeNexus() })

  await completor.complete(actum, makeRunResult())

  assert.equal(acta.latest.status, 'completus')
})

test('records the actual impetus (not the reservation) on actum', async () => {
  const actum = makeActum({ impetus: 100n })  // reserved 100
  const acta = makeActa(actum)
  const completor = new ActumCompletor({ acta, signorum: makeSignorum(), nexus: makeNexus() })

  await completor.complete(actum, makeRunResult({ impetus: 73n }))  // actual 73

  assert.equal(acta.latest.impetus, 73n)
})

test('records exitus and duratio on actum', async () => {
  const actum = makeActum()
  const acta = makeActa(actum)
  const completor = new ActumCompletor({ acta, signorum: makeSignorum(), nexus: makeNexus() })
  const result = makeRunResult({ exitus: { image: 'out.png' }, duratio: 4200 })

  await completor.complete(actum, result)

  assert.deepEqual(acta.latest.exitus, { image: 'out.png' })
  assert.equal(acta.latest.duratio, 4200)
})

test('sets completum timestamp', async () => {
  const actum = makeActum()
  const acta = makeActa(actum)
  const completor = new ActumCompletor({ acta, signorum: makeSignorum(), nexus: makeNexus() })
  const before = new Date()

  await completor.complete(actum, makeRunResult())

  assert.ok(acta.latest.completum! >= before)
})

test('calls settle with all locked signa and actual impetus', async () => {
  const actum = makeActum({ signaConsumed: ['sig-a', 'sig-b'] })
  const acta = makeActa(actum)
  const signorum = makeSignorum()
  const completor = new ActumCompletor({ acta, signorum, nexus: makeNexus() })

  await completor.complete(actum, makeRunResult({ impetus: 80n }))

  assert.equal(signorum._settled.length, 1)
  assert.deepEqual(signorum._settled[0].ids.sort(), ['sig-a', 'sig-b'])
  assert.equal(signorum._settled[0].actualImpetus, 80n)
  assert.equal(signorum._settled[0].actumId, 'act-1')
})

test('settle receives the actual impetus so delta refund is correct', async () => {
  // reserved 100n, actual 60n — settle() handles the 40n delta refund
  const actum = makeActum({ impetus: 100n, signaConsumed: ['sig-a', 'sig-b'] })
  const acta = makeActa(actum)
  const signorum = makeSignorum()
  const completor = new ActumCompletor({ acta, signorum, nexus: makeNexus() })

  await completor.complete(actum, makeRunResult({ impetus: 60n }))

  assert.equal(signorum._settled[0].actualImpetus, 60n)
})

test('emits execution_spend to nexus on success', async () => {
  const actum = makeActum()
  const acta = makeActa(actum)
  const nexus = makeNexus()
  const completor = new ActumCompletor({ acta, signorum: makeSignorum(), nexus })

  await completor.complete(actum, makeRunResult())

  assert.equal(nexus._emitted.length, 1)
  assert.equal(nexus._emitted[0].type, 'execution_spend')
})

test('nexus emission includes the completed actum and actual impetus', async () => {
  const actum = makeActum({ id: 'act-xyz' })
  const acta = makeActa(actum)
  const nexus = makeNexus()
  const completor = new ActumCompletor({ acta, signorum: makeSignorum(), nexus })

  await completor.complete(actum, makeRunResult({ impetus: 55n }))

  const payload = nexus._emitted[0].payload as { actum: Actum; impetus: bigint }
  assert.equal(payload.actum.id, 'act-xyz')
  assert.equal(payload.impetus, 55n)
})

// ── Settlement: measured cost, not the reservation ──────────────────────────
// A warm-pod run carries a dispatch-time `pricingTier` stamp. Settlement must be
// driven by the cursor's measured cost (`Exitus.impetus`), with the guest warm
// surcharge added on top — never by the reservation the run happened to lock.

test('warm run settles at the measured cost, not the reservation (owner tier)', async () => {
  const actum = makeActum({ impetus: 1800n, executio: { pricingTier: 'owner' } })
  const acta = makeActa(actum)
  const signorum = makeSignorum()
  const completor = new ActumCompletor({ acta, signorum, nexus: makeNexus() })

  await completor.complete(actum, makeRunResult({ impetus: 12n, duratio: 12_000 }))

  assert.equal(acta.latest.impetus, 12n, 'settles at measured pod wall-clock')
  assert.equal(signorum._settled[0].actualImpetus, 12n)
})

test('warm run settles at measured cost + WARM_SURCHARGE_IMPETUS on guest tier', async () => {
  const actum = makeActum({ impetus: 1800n, executio: { pricingTier: 'guest' } })
  const acta = makeActa(actum)
  const completor = new ActumCompletor({ acta, signorum: makeSignorum(), nexus: makeNexus() })

  await completor.complete(actum, makeRunResult({ impetus: 12n, duratio: 12_000 }))

  assert.equal(acta.latest.impetus, 12n + WARM_SURCHARGE_IMPETUS)
})

test('admin tier pays the measured cost with no surcharge', async () => {
  const actum = makeActum({ impetus: 1800n, executio: { pricingTier: 'admin' } })
  const acta = makeActa(actum)
  const completor = new ActumCompletor({ acta, signorum: makeSignorum(), nexus: makeNexus() })

  await completor.complete(actum, makeRunResult({ impetus: 30n }))

  assert.equal(acta.latest.impetus, 30n)
})

test('no tier stamp (cold start) settles at the measured cost, unsurcharged', async () => {
  const actum = makeActum({ impetus: 1800n })
  const acta = makeActa(actum)
  const completor = new ActumCompletor({ acta, signorum: makeSignorum(), nexus: makeNexus() })

  await completor.complete(actum, makeRunResult({ impetus: 12n }))

  assert.equal(acta.latest.impetus, 12n)
})

test('stamps executio.baseImpetus with the measured base and finalImpetus with the settled total', async () => {
  const actum = makeActum({ impetus: 1800n, executio: { pricingTier: 'guest' } })
  const acta = makeActa(actum)
  const completor = new ActumCompletor({ acta, signorum: makeSignorum(), nexus: makeNexus() })

  await completor.complete(actum, makeRunResult({ impetus: 12n }))

  assert.equal(acta.latest.executio?.baseImpetus, 12n, 'base is the measured cost')
  assert.equal(acta.latest.executio?.finalImpetus, 12n + WARM_SURCHARGE_IMPETUS)
  assert.equal(acta.latest.executio?.pricingTier, 'guest', 'dispatch stamp preserved')
})

test('nexus payload carries the measured base, not the reservation', async () => {
  const actum = makeActum({ impetus: 1800n, executio: { pricingTier: 'guest' } })
  const acta = makeActa(actum)
  const nexus = makeNexus()
  const completor = new ActumCompletor({ acta, signorum: makeSignorum(), nexus })

  await completor.complete(actum, makeRunResult({ impetus: 12n }))

  const payload = nexus._emitted[0].payload as { impetus: bigint; baseImpetus: bigint }
  assert.equal(payload.baseImpetus, 12n)
  assert.equal(payload.impetus, 12n + WARM_SURCHARGE_IMPETUS)
})

test('a dispatch-time impetus stamp does not drive settlement', async () => {
  // An actum stamped before this change carries amounts derived from the
  // reservation. Settlement ignores them and uses the measured cost.
  const actum = makeActum({
    impetus: 1800n,
    executio: { pricingTier: 'owner', baseImpetus: 1800n, finalImpetus: 1800n },
  })
  const acta = makeActa(actum)
  const signorum = makeSignorum()
  const completor = new ActumCompletor({ acta, signorum, nexus: makeNexus() })

  await completor.complete(actum, makeRunResult({ impetus: 12n }))

  assert.equal(acta.latest.impetus, 12n)
  assert.equal(signorum._settled[0].actualImpetus, 12n)
  assert.equal(acta.latest.executio?.baseImpetus, 12n, 'base rewritten to the measured cost')
})

// ── Guards that must keep holding ───────────────────────────────────────────

test('a cursor reporting more than the reservation still throws Cursor overcharge', async () => {
  const actum = makeActum({ impetus: 100n, executio: { pricingTier: 'guest' } })
  const acta = makeActa(actum)
  const completor = new ActumCompletor({ acta, signorum: makeSignorum(), nexus: makeNexus() })

  await assert.rejects(
    () => completor.complete(actum, makeRunResult({ impetus: 101n })),
    /Cursor overcharge/,
  )
})

test('a surcharged total above the reservation settles at the reservation', async () => {
  // Measured cost sits just under the reservation; adding the guest surcharge
  // would exceed it. The cap holds — we never settle more than was locked.
  const actum = makeActum({ impetus: 100n, executio: { pricingTier: 'guest' } })
  const acta = makeActa(actum)
  const signorum = makeSignorum()
  const completor = new ActumCompletor({ acta, signorum, nexus: makeNexus() })

  await completor.complete(actum, makeRunResult({ impetus: 90n }))

  assert.equal(acta.latest.impetus, 100n, 'capped at the reservation')
  assert.equal(signorum._settled[0].actualImpetus, 100n)
})

test('terminates a one-shot pod on successful completion', async () => {
  const actum = makeActum({ externusJobId: 'pod-99', oneshotPod: true })
  const acta = makeActa(actum)
  const terminated: string[] = []
  const completor = new ActumCompletor({
    acta, signorum: makeSignorum(), nexus: makeNexus(),
    terminatePod: async (id) => { terminated.push(id) },
  })

  await completor.complete(actum, makeRunResult())

  assert.deepEqual(terminated, ['pod-99'])
})

test('leaves a warm/pooled pod alive on completion (oneshotPod unset)', async () => {
  const actum = makeActum({ externusJobId: 'warm-pod', oneshotPod: undefined })
  const acta = makeActa(actum)
  const terminated: string[] = []
  const completor = new ActumCompletor({
    acta, signorum: makeSignorum(), nexus: makeNexus(),
    terminatePod: async (id) => { terminated.push(id) },
  })

  await completor.complete(actum, makeRunResult())

  assert.deepEqual(terminated, [])   // reuse: only the idle reaper sweeps warm pods
})

test('completion still succeeds when one-shot pod termination throws', async () => {
  const actum = makeActum({ externusJobId: 'pod-x', oneshotPod: true })
  const acta = makeActa(actum)
  const completor = new ActumCompletor({
    acta, signorum: makeSignorum(), nexus: makeNexus(),
    terminatePod: async () => { throw new Error('runpod 500') },
  })

  const completed = await completor.complete(actum, makeRunResult())

  assert.equal(completed.status, 'completus')   // best-effort: a reaper hiccup never blocks completion
})

test('marks actum fractus and releases all signa on failure', async () => {
  const actum = makeActum({ signaConsumed: ['sig-a', 'sig-b'] })
  const acta = makeActa(actum)
  const signorum = makeSignorum()
  const completor = new ActumCompletor({ acta, signorum, nexus: makeNexus() })

  await completor.fail(actum, 'runner timed out')

  assert.equal(acta.latest.status, 'fractus')
  assert.equal(acta.latest.error, 'runner timed out')
  assert.deepEqual(signorum._released.sort(), ['sig-a', 'sig-b'])
})

test('does not emit to nexus on failure', async () => {
  const actum = makeActum()
  const acta = makeActa(actum)
  const nexus = makeNexus()
  const completor = new ActumCompletor({ acta, signorum: makeSignorum(), nexus })

  await completor.fail(actum, 'timeout')

  assert.equal(nexus._emitted.length, 0)
})

// ---------------------------------------------------------------------------
// Vestigium indexing (single choke point — moved from executionWebhook)
// ---------------------------------------------------------------------------

function makeThrowingVestigiorum(): Vestigiorum {
  return {
    create: async () => { throw new Error('mongo write failed') },
    indexPromptum: async () => {},
    indexImago: async () => {},
    indexIntella: async () => {},
    search: async () => [],
  } as unknown as Vestigiorum

}

/** Wraps a real MemoryVestigiorum, spying on create() while delegating every other
 *  method to the underlying instance (a plain object spread would lose the prototype
 *  methods — MemoryVestigiorum's index-family and search methods live on its prototype,
 *  not as own properties). */
function spyOnCreate(inner: MemoryVestigiorum): { spy: Vestigiorum; created: () => unknown } {
  let created: unknown
  const spy = {
    create: async (v: Parameters<Vestigiorum['create']>[0]) => { created = v; return inner.create(v) },
    indexPromptum: inner.indexPromptum.bind(inner),
    indexImago: inner.indexImago.bind(inner),
    indexIntella: inner.indexIntella.bind(inner),
    search: inner.search.bind(inner),
    findById: inner.findById.bind(inner),
    forIdentity: inner.forIdentity.bind(inner),
    setAuctorImpressio: inner.setAuctorImpressio.bind(inner),
    rate: inner.rate.bind(inner),
    update: inner.update.bind(inner),
  } as unknown as Vestigiorum
  return { spy, created: () => created }
}

test('writes a vestigium for an animaId auctor on completion', async () => {
  const actum = makeActum({ aditus: { prompt: 'a cat in space' } })
  const acta = makeActa(actum)
  const { spy, created } = spyOnCreate(new MemoryVestigiorum())
  const completor = new ActumCompletor({ acta, signorum: makeSignorum(), nexus: makeNexus(), vestigiorum: spy })

  await completor.complete(actum, makeRunResult({ exitus: { imageUrl: 'https://x.com/out.png' } }), { animaId: 'anima-abc' })

  assert.deepEqual((created() as { auctorKey: unknown }).auctorKey, { animaId: 'anima-abc' })
  assert.equal((created() as { actumId: string }).actumId, actum.id)
})

function makeDeployments(hash: string, models: Array<{ id: string; role: string }>): Pick<DeploymentumStore, 'find'> {
  return {
    find: async (h: string) => h === hash
      ? { hash, spec: { models }, natum: new Date() }
      : null,
  }
}

function makeIntellarum(byId: Record<string, string>): Pick<Intellarum, 'find'> {
  return {
    find: async (id: string) => byId[id]
      ? ({ id, nomen: byId[id] } as unknown as Intella)
      : null,
  }
}

test('populates intellaIds/intellaDescription from the deployment bundle (base + lora, human names)', async () => {
  const actum = makeActum({ aditus: { prompt: 'a cat in space' }, deploymentHash: 'dep-1' })
  const acta = makeActa(actum)
  const { spy, created } = spyOnCreate(new MemoryVestigiorum())
  const deployments = makeDeployments('dep-1', [
    { id: 'intella-x', role: 'lora' },
    { id: 'intella-base', role: 'checkpoint' },
  ])
  const intellarum = makeIntellarum({ 'intella-x': 'stationthis lora', 'intella-base': 'FLUX.2 Klein' })
  const completor = new ActumCompletor({
    acta, signorum: makeSignorum(), nexus: makeNexus(), vestigiorum: spy, deployments, intellarum,
  })

  await completor.complete(actum, makeRunResult(), { animaId: 'anima-abc' })
  await new Promise((resolve) => setImmediate(resolve)) // flush the fire-and-forget index write

  const options = created() as { intellaIds?: string[]; intellaDescription?: string }
  assert.deepEqual(new Set(options.intellaIds), new Set(['intella-x', 'intella-base']))
  assert.equal(options.intellaDescription, 'stationthis lora + FLUX.2 Klein')
})

test('falls back to the raw id when a model has no resolvable Intella record', async () => {
  const actum = makeActum({ deploymentHash: 'dep-2' })
  const acta = makeActa(actum)
  const { spy, created } = spyOnCreate(new MemoryVestigiorum())
  const deployments = makeDeployments('dep-2', [{ id: 'intella-unregistered', role: 'checkpoint' }])
  const intellarum = makeIntellarum({})
  const completor = new ActumCompletor({
    acta, signorum: makeSignorum(), nexus: makeNexus(), vestigiorum: spy, deployments, intellarum,
  })

  await completor.complete(actum, makeRunResult(), { animaId: 'anima-abc' })
  await new Promise((resolve) => setImmediate(resolve))

  const options = created() as { intellaIds?: string[]; intellaDescription?: string }
  assert.deepEqual(options.intellaIds, ['intella-unregistered'])
  assert.equal(options.intellaDescription, 'intella-unregistered')
})

test('writes a vestigium for a commitment auctor on completion', async () => {
  const actum = makeActum({ aditus: { prompt: 'anon run' } })
  const acta = makeActa(actum)
  const { spy, created } = spyOnCreate(new MemoryVestigiorum())
  const completor = new ActumCompletor({ acta, signorum: makeSignorum(), nexus: makeNexus(), vestigiorum: spy })

  await completor.complete(actum, makeRunResult(), { commitment: 'deadbeef' })

  assert.deepEqual((created() as { auctorKey: unknown }).auctorKey, { commitment: 'deadbeef' })
})

test('skips indexing when no auctor is threaded (ownerless/system acta)', async () => {
  const actum = makeActum()
  const acta = makeActa(actum)
  let createCalls = 0
  const vestigiorum = {
    create: async (v: unknown) => { createCalls += 1; return v as never },
    indexPromptum: async () => {}, indexImago: async () => {}, indexIntella: async () => {},
    search: async () => [],
  } as unknown as Vestigiorum
  const completor = new ActumCompletor({ acta, signorum: makeSignorum(), nexus: makeNexus(), vestigiorum })

  await completor.complete(actum, makeRunResult())   // no auctor

  assert.equal(createCalls, 0)
})

test('vestigiorum absent → completion still succeeds, no throw', async () => {
  const actum = makeActum()
  const acta = makeActa(actum)
  const completor = new ActumCompletor({ acta, signorum: makeSignorum(), nexus: makeNexus() })

  const completed = await completor.complete(actum, makeRunResult(), { animaId: 'anima-abc' })

  assert.equal(completed.status, 'completus')
})

test('vestigiorum.create failure logs a warning and completion still succeeds', async () => {
  const actum = makeActum()
  const acta = makeActa(actum)
  const completor = new ActumCompletor({
    acta, signorum: makeSignorum(), nexus: makeNexus(),
    vestigiorum: makeThrowingVestigiorum(),
  })

  const completed = await completor.complete(actum, makeRunResult(), { animaId: 'anima-abc' })

  assert.equal(completed.status, 'completus')
})

test('double-completion is rejected before any index write', async () => {
  const actum = makeActum({ status: 'completus' })
  const acta = makeActa(actum)
  let createCalls = 0
  const vestigiorum = {
    create: async (v: unknown) => { createCalls += 1; return v as never },
    indexPromptum: async () => {}, indexImago: async () => {}, indexIntella: async () => {},
    search: async () => [],
  } as unknown as Vestigiorum
  const completor = new ActumCompletor({ acta, signorum: makeSignorum(), nexus: makeNexus(), vestigiorum })

  await assert.rejects(
    () => completor.complete(actum, makeRunResult(), { animaId: 'anima-abc' }),
    /already completus/,
  )

  assert.equal(createCalls, 0)
})
