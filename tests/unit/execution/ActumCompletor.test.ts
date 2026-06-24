import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Actum } from '../../../src/types/actum.js'
import type { Signum } from '../../../src/types/significandi.js'
import type { Exitus, Actorum } from '../../../src/types/cursus.js'
import type { Nexus } from '../../../src/types/nexus.js'
import { ActumCompletor } from '../../../src/execution/ActumCompletor.js'

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

function makeActum(overrides: Partial<Actum> = {}): Actum {
  return {
    id: 'act-1', modusId: 'mod-1', modusVersiono: '1.0.0',
    impetus: 100n, signaConsumed: ['sig-a', 'sig-b'],
    aditus: {}, status: 'nascens', inceptum: new Date(),
    ...overrides,
  }
}

function makeRunResult(overrides: Partial<Exitus> = {}): Exitus {
  return { exitus: { url: 'https://example.com/out.png' }, impetus: 80n, duratio: 5000, ...overrides }
}

function makeActa(actum: Actum): Actorum & { latest: Actum } {
  let latest = { ...actum }
  return {
    get latest() { return latest },
    create: async (a) => { latest = { ...a, inceptum: new Date() }; return latest },
    update: async (_id, patch) => { Object.assign(latest, patch); return latest },
    findById: async () => latest,
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
