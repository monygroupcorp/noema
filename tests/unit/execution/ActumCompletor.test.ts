import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Actum } from '../../../src/types/actum.js'
import type { Signum } from '../../../src/types/significandi.js'
import type { Exitus, Actorum } from '../../../src/types/cursus.js'
import type { Nexus } from '../../../src/types/nexus.js'
import type { Vestigiorum } from '../../../src/types/vestigium.js'
import type { DeploymentumStore } from '../../../src/types/deploymentum.js'
import type { Intella, Intellarum } from '../../../src/types/intelligendi.js'
import type { Modus } from '../../../src/types/modus.js'
import type { Editionum } from '../../../src/types/editio.js'
import { ActumCompletor } from '../../../src/execution/ActumCompletor.js'
import { Nexus as RealNexus } from '../../../src/ledger/Nexus.js'
import { MemorySignorum } from '../../../src/ledger/MemorySignorum.js'
import { MemoryModorum } from '../../../src/execution/MemoryModorum.js'
import { hostCutHook } from '../../../src/ledger/hooks/hostCut.js'
import { spellRoyaltyHook } from '../../../src/ledger/hooks/spellRoyalty.js'
import { modelRoyaltyHook } from '../../../src/ledger/hooks/modelRoyalty.js'
import { platformSkimHook } from '../../../src/ledger/hooks/platformSkim.js'
import { WARM_SURCHARGE_IMPETUS } from '../../../src/ledger/rates.js'
import { MemoryVestigiorum } from '../../../src/rag/MemoryVestigiorum.js'
import { bus } from '../../../src/lib/bus.js'
import { classifyError } from '../../../src/lib/classifyError.js'

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

// ---------------------------------------------------------------------------
// The failure record: what survives, and who can see it
//
// The sweeps in `expiryReaper` fail runs on a timer, outside any dispatch — no trace context, and
// a reason that describes the sweep rather than the run. Both of those used to cost the record
// something: a more specific cause was overwritten, and the wide event that a failure-rate
// measurement counts was not emitted at all.
// ---------------------------------------------------------------------------

test('fail keeps a cause already on the record instead of overwriting it with a general one', async () => {
  const actum = makeActum({ status: 'agens' })
  const acta = makeActa(actum)
  // A specific cause was recorded while the run was still live.
  await acta.update(actum.id, { error: 'processor load failed: no module named torchvision' })
  const completor = new ActumCompletor({ acta, signorum: makeSignorum() })

  await completor.fail(actum, 'Actum expired — pod never reported back')

  assert.equal(acta.latest.status, 'fractus')
  assert.equal(acta.latest.error, 'processor load failed: no module named torchvision')
})

test('fail stamps the given reason when nothing more specific is on the record', async () => {
  const actum = makeActum({ status: 'agens' })
  const acta = makeActa(actum)
  const completor = new ActumCompletor({ acta, signorum: makeSignorum() })

  await completor.fail(actum, 'Actum expired — pod never reported back')

  assert.equal(acta.latest.error, 'Actum expired — pod never reported back')
})

test('fail emits its wide event with no trace context — a swept run still reaches the failure count', async () => {
  const actum = makeActum({ id: 'act-swept', status: 'agens', impetus: 1800n })
  const acta = makeActa(actum)
  const completor = new ActumCompletor({ acta, signorum: makeSignorum() })

  const seen: Array<Record<string, unknown>> = []
  const onFail = (e: unknown) => { seen.push(e as Record<string, unknown>) }
  bus.on('actum.fail', onFail)
  try {
    // Deliberately NOT inside withTrace — this is the reaper's situation.
    await completor.fail(actum, 'Pod never reported in')
  } finally {
    bus.off('actum.fail', onFail)
  }

  assert.equal(seen.length, 1)
  assert.equal(seen[0].actumId, 'act-swept')
  assert.equal(seen[0].status, 'failed')
  // errorCode is the classified value (grouping fairly by fault) — the raw text this run
  // actually failed with is preserved verbatim in `message`.
  assert.equal(seen[0].errorCode, classifyError('Pod never reported in'))
  assert.equal(seen[0].message, 'Pod never reported in')
  // Release-only, so the whole reservation is refunded and nothing is charged.
  assert.equal(seen[0].reservation, '1800')
  assert.equal(seen[0].impetus, '0')
  assert.equal(seen[0].refund, '1800')
})

// ── Royalty, host cut and platform skim ──────────────────────────────────────
//
// `complete()` is the ONE `execution_spend` emitter in the codebase, so this is
// where the payout is proven. It used to emit a bare payload and the RunPod
// webhook built an enriched one of its own — which meant a run finishing on the
// sync-cursor rail (`POST /v1/runs`, MCP dispatch, every hosted-API modus) paid
// no royalty at all, silently. These tests hold the enrichment at the settlement
// point, where every rail passes through.
//
// Real Nexus + real hooks + MemorySignorum + MemoryModorum: the seams are the
// actum store and the cursor result, not the ledger.

const LEDGER_MODUS: Modus = {
  id: 'mod-1',
  nomen: 'Flux Schnell',
  genus: 'atomicus',
  versio: '1.0.0',
  contentHash: 'test-hash',
  aditus: {},
  exitus: {},
  canonica: true,
  auctor: { animaId: 'anima-flux-author' },   // the {animaId}|{commitment} owner union
  natum: new Date(),
  mutatum: new Date(),
}

function makeLedger() {
  const nexus = new RealNexus()
  nexus.on('execution_spend', hostCutHook)
  nexus.on('execution_spend', spellRoyaltyHook)
  nexus.on('execution_spend', modelRoyaltyHook)
  nexus.on('royalty_fired', platformSkimHook)
  return { nexus, signorum: new MemorySignorum(), modorum: new MemoryModorum() }
}

/** A run with nothing locked — MemorySignorum settles only ids it actually holds,
 *  and none of these tests are about the lock/refund half. */
function makeLedgerActum(overrides: Partial<Actum> = {}): Actum {
  return makeActum({ impetus: 100_000n, signaConsumed: [], ...overrides })
}

test('spell royalty is paid to the flow author on completion', async () => {
  const { nexus, signorum, modorum } = makeLedger()
  await modorum.register({ ...LEDGER_MODUS })
  const actum = makeLedgerActum()
  const completor = new ActumCompletor({ acta: makeActa(actum), signorum, nexus, modorum })

  // 200n measured → spellRoyalty = 10% = 20n
  await completor.complete(actum, makeRunResult({ impetus: 200n }))

  const signa = await signorum.history({ animaId: 'anima-flux-author' })
  assert.equal(signa.length, 1)
  assert.equal(signa[0].forma, 'reward')
  assert.equal(signa[0].valor, 20n)
  assert.equal(signa[0].auctor, 'nexus:spellRoyalty')
})

test('platform skim is taken once a royalty has fired', async () => {
  const { nexus, signorum, modorum } = makeLedger()
  await modorum.register({ ...LEDGER_MODUS })
  const actum = makeLedgerActum()
  const completor = new ActumCompletor({ acta: makeActa(actum), signorum, nexus, modorum })

  await completor.complete(actum, makeRunResult({ impetus: 200n }))

  // platformSkim = 5% of the 200n base
  const platformId = process.env.PLATFORM_ANIMA_ID ?? 'platform'
  const signa = await signorum.history({ animaId: platformId })
  assert.equal(signa.length, 1)
  assert.equal(signa[0].valor, 10n)
  assert.equal(signa[0].auctor, 'nexus:platformSkim')
})

test('host cut taxes the measured cost, not the surcharged total or the reservation', async () => {
  const { nexus, signorum, modorum } = makeLedger()
  await modorum.register({ ...LEDGER_MODUS, auctor: undefined })   // isolate hostCut from spellRoyalty
  const actum = makeLedgerActum({
    impetus: 1800n,                        // reservation, well above the measured run
    executio: { pricingTier: 'guest' },
  })
  const hospitia = {
    async findByMateriaId(id: string) {
      return id === 'materia-1'
        ? { id: 'hosp-1', materiaId: 'materia-1', hostKey: { animaId: 'host-anima' }, inceptum: new Date() }
        : null
    },
  }
  const completor = new ActumCompletor({ acta: makeActa(actum), signorum, nexus, modorum, hospitia })

  // 200n measured base; hostCut = 20% of THAT (40n), not of the guest-surcharged
  // settle total and not of the 1800n reservation.
  await completor.complete(actum, makeRunResult({ impetus: 200n, materiamId: 'materia-1' }))

  const signa = await signorum.history({ animaId: 'host-anima' })
  assert.equal(signa.length, 1)
  assert.equal(signa[0].valor, 40n)
  assert.equal(signa[0].auctor, 'nexus:hostCut')
})

test('model royalty is routed to the used model\'s published owner', async () => {
  const { nexus, signorum, modorum } = makeLedger()
  await modorum.register({ ...LEDGER_MODUS, auctor: undefined })   // isolate the model-royalty signum
  const actum = makeLedgerActum({ deploymentHash: 'sha256:dep-1' })

  // The bundle records that this gen used 'lora-1'; that model has a published
  // Editio with no explicit split, so its publisher earns the whole 5% pool.
  const deployments = {
    async find(h: string) {
      return h === 'sha256:dep-1'
        ? { hash: h, spec: { models: [{ id: 'lora-1', role: 'lora' }] }, natum: new Date() }
        : null
    },
  }
  const editiones = {
    async listByArtifact(ref: { kind: string; id: string }) {
      if (ref.kind !== 'intella' || ref.id !== 'lora-1') return []
      const now = new Date()
      return [{
        id: 'e-1', artifactRef: { kind: 'intella', id: 'lora-1' }, destination: 'huggingface',
        visibility: 'unlisted', custody: 'ours', by: { animaId: 'lora-author' },
        status: 'published', natum: now, mutatum: now,
      }]
    },
  }
  const completor = new ActumCompletor({
    acta: makeActa(actum), signorum, nexus, modorum,
    deployments: deployments as unknown as DeploymentumStore,
    editiones: editiones as unknown as Editionum,
  })

  // 200n measured → model royalty = 5% = 10n to the sole payee.
  await completor.complete(actum, makeRunResult({ impetus: 200n }))

  const signa = await signorum.history({ animaId: 'lora-author' })
  assert.equal(signa.length, 1)
  assert.equal(signa[0].valor, 10n)
  assert.equal(signa[0].auctor, 'nexus:modelRoyalty')
})

test('a flow with no identified author earns nothing, and no skim follows', async () => {
  const { nexus, signorum, modorum } = makeLedger()
  await modorum.register({ ...LEDGER_MODUS, auctor: undefined })
  const actum = makeLedgerActum()
  const completor = new ActumCompletor({ acta: makeActa(actum), signorum, nexus, modorum })

  await completor.complete(actum, makeRunResult({ impetus: 200n }))

  assert.equal((await signorum.history({ animaId: 'anima-flux-author' })).length, 0)
  assert.equal((await signorum.history({ animaId: process.env.PLATFORM_ANIMA_ID ?? 'platform' })).length, 0)
})

test('execution_spend carries the flow author resolved from the modus registry', async () => {
  const modorum = new MemoryModorum()
  await modorum.register({ ...LEDGER_MODUS })
  const actum = makeActum()
  const nexus = makeNexus()
  const completor = new ActumCompletor({ acta: makeActa(actum), signorum: makeSignorum(), nexus, modorum })

  await completor.complete(actum, makeRunResult())

  const payload = nexus._emitted[0].payload as { modusAuctorAnimaId?: string }
  assert.equal(payload.modusAuctorAnimaId, 'anima-flux-author')
})

test('an anon-owned flow resolves no author to route a royalty to', async () => {
  const modorum = new MemoryModorum()
  await modorum.register({ ...LEDGER_MODUS, auctor: { commitment: '0xdeadbeef' } })
  const actum = makeActum()
  const nexus = makeNexus()
  const completor = new ActumCompletor({ acta: makeActa(actum), signorum: makeSignorum(), nexus, modorum })

  await completor.complete(actum, makeRunResult())

  const payload = nexus._emitted[0].payload as { modusAuctorAnimaId?: string }
  assert.equal(payload.modusAuctorAnimaId, undefined)
})

test('execution_spend carries the model royalty payees for a published model', async () => {
  const actum = makeActum({ deploymentHash: 'sha256:dep-1' })
  const nexus = makeNexus()
  const deployments = {
    async find(h: string) {
      return h === 'sha256:dep-1'
        ? { hash: h, spec: { models: [{ id: 'lora-1', role: 'lora' }] }, natum: new Date() }
        : null
    },
  }
  const editiones = {
    async listByArtifact(ref: { kind: string; id: string }) {
      if (ref.kind !== 'intella' || ref.id !== 'lora-1') return []
      const now = new Date()
      return [{
        id: 'e-1', artifactRef: { kind: 'intella', id: 'lora-1' }, destination: 'huggingface',
        visibility: 'unlisted', custody: 'ours', by: { animaId: 'lora-author' },
        status: 'published', natum: now, mutatum: now,
      }]
    },
  }
  const completor = new ActumCompletor({
    acta: makeActa(actum), signorum: makeSignorum(), nexus,
    deployments: deployments as unknown as DeploymentumStore,
    editiones: editiones as unknown as Editionum,
  })

  await completor.complete(actum, makeRunResult())

  const payload = nexus._emitted[0].payload as { intellaRoyaltyPayees?: Array<{ animaId: string; weight: number }> }
  assert.deepEqual(payload.intellaRoyaltyPayees, [{ animaId: 'lora-author', weight: 1 }])
})

test('royalty_fired and the signa write are skipped when nothing was earned', async () => {
  // A bare nexus whose hooks produce no signa — the empty case that must not
  // write a ledger row or fire a skim off a zero royalty.
  const actum = makeActum()
  const nexus = makeNexus()
  const signorum = makeSignorum()   // its createMany throws if reached
  const completor = new ActumCompletor({ acta: makeActa(actum), signorum, nexus })

  await completor.complete(actum, makeRunResult())

  assert.deepEqual(nexus._emitted.map(e => e.type), ['execution_spend'])
})

test('completion emits execution_spend exactly once', async () => {
  // The non-vacuity proof for the double-emission hazard. `complete()` is the sole
  // emitter; when the webhook rail also had its own emit, a webhook completion fired
  // this event TWICE — the bare one no-op'd the royalty hooks but hostCut and
  // hospitium do not gate on enrichment, so hosts were paid twice. Restore that
  // second call site and this count goes to 2.
  const modorum = new MemoryModorum()
  await modorum.register({ ...LEDGER_MODUS })
  const actum = makeActum()
  const nexus = makeNexus()
  const completor = new ActumCompletor({ acta: makeActa(actum), signorum: makeSignorum(), nexus, modorum })

  await completor.complete(actum, makeRunResult())

  assert.equal(nexus._emitted.filter(e => e.type === 'execution_spend').length, 1)
})
