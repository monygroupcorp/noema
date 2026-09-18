// =============================================================================
// partnerMeter — the B2B meter, both halves and the rollup the invoice reads
// =============================================================================
//
// The meter is written at two ends that never meet: the API edge knows the key and not the
// units, the completion webhook knows the units and not the key. These tests exercise the
// store's own contract, then drive the real `handleExecutionWebhook` to prove the second half
// actually lands — including the parts that are easy to get wrong the other way round: a
// failed run is voided and NOT billed, and a run that is not a partner run writes nothing.
//
// Hermetic: MemoryPartnerUsage + the webhook's own fakes. No Mongo.
// =============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryPartnerUsage } from '../../../src/crystal/MemoryPartnerUsage.js'
import { handleExecutionWebhook } from '../../../src/api/webhooks/executionWebhook.js'
import type { ExecutionWebhookDeps, WebhookRequest } from '../../../src/api/webhooks/executionWebhook.js'
import type { Actum } from '../../../src/types/actum.js'
import type { Actorum, Exitus } from '../../../src/types/cursus.js'
import type { Modus, Modorum } from '../../../src/types/modus.js'

const T0 = new Date('2026-09-01T00:00:00.000Z')
const T1 = new Date('2026-10-01T00:00:00.000Z')
const at = (iso: string) => new Date(iso)

function makeActum(overrides: Partial<Actum> = {}): Actum {
  return {
    id: 'actum-1',
    modusId: 'flux-schnell',
    modusVersiono: '1.0.0',
    impetus: 100_000n,
    signaConsumed: [],
    aditus: {},
    status: 'nascens',
    inceptum: new Date(),
    expirat: new Date(Date.now() + 60_000),
    externusJobId: 'job-1',
    ...overrides,
  }
}

function makeActorum(actum: Actum | null): Actorum {
  return {
    async create(a: Omit<Actum, 'inceptum'>) { return { ...a, inceptum: new Date() } as Actum },
    async update() { return actum! },
    async findById() { return actum },
    async findByExternusJobId() { return actum },
    async findExpired() { return [] as Actum[] },
    async findByCallbackNonce() { throw new Error('not exercised') },
    async findByNullifier() { throw new Error('not exercised') },
    async findInFlight() { throw new Error('not exercised') },
    async findByCompositum() { throw new Error('not exercised') },
  }
}

function makeModorum(modus: Modus): Modorum {
  return {
    async find() { return modus },
    async register() {},
    async list() { return [modus] },
    async update() { return modus },
  }
}

/** The completor as the webhook uses it here: returns the actum stamped terminal with the
 *  settled cost and duration, which is what the meter's second half reads. */
function makeCompletor() {
  return {
    async complete(actum: Actum, exitus: Exitus): Promise<Actum> {
      return { ...actum, status: 'completus', impetus: exitus.impetus, duratio: exitus.duratio, completum: at('2026-09-15T12:00:00.000Z') }
    },
    async fail(actum: Actum, error: string): Promise<Actum> {
      return { ...actum, status: 'fractus', error }
    },
  }
}

const req = (body: unknown): WebhookRequest => ({ body, rawBody: JSON.stringify(body) })

// ── The store's own contract ──────────────────────────────────────────────────

test('record is idempotent on the actum — a retried write does not double-count a call', async () => {
  const meter = new MemoryPartnerUsage()
  const row = { actumId: 'actum-1', animaId: 'anima-1', keyPrefix: 'ms2_aaaabbbb', modusId: 'flux-schnell', calledAt: at('2026-09-10T00:00:00Z') }
  await meter.record(row)
  await meter.record({ ...row, keyPrefix: 'ms2_ccccdddd' })

  const rows = await meter.list('anima-1', T0, T1)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].keyPrefix, 'ms2_aaaabbbb', 'the first write wins; a replay does not rewrite the key')
})

test('an unsettled call is recorded and not billable — the rollup counts settled rows only', async () => {
  const meter = new MemoryPartnerUsage()
  await meter.record({ actumId: 'actum-1', animaId: 'anima-1', keyPrefix: 'ms2_aaaabbbb', modusId: 'flux-schnell', calledAt: at('2026-09-10T00:00:00Z') })

  assert.equal((await meter.list('anima-1', T0, T1)).length, 1, 'the call is visible')
  assert.deepEqual(await meter.sumPeriod('anima-1', T0, T1), { calls: 0, impetus: '0', lines: [] })
})

test('a VOIDED call stays on the meter and is not billed', async () => {
  const meter = new MemoryPartnerUsage()
  await meter.record({ actumId: 'actum-1', animaId: 'anima-1', keyPrefix: 'ms2_aaaabbbb', modusId: 'flux-schnell', calledAt: at('2026-09-10T00:00:00Z') })
  await meter.void('actum-1', at('2026-09-10T00:01:00Z'))

  const rows = await meter.list('anima-1', T0, T1)
  assert.equal(rows.length, 1, 'the customer can still see the call it made')
  assert.ok(rows[0].voidedAt, 'and can see that it was not billed')
  assert.equal((await meter.sumPeriod('anima-1', T0, T1)).calls, 0)
})

test('the rollup itemizes per flow, biggest line first, and totals exactly', async () => {
  const meter = new MemoryPartnerUsage()
  const rows: Array<[string, string, string]> = [
    ['actum-1', 'flux-schnell', '900'],
    ['actum-2', 'flux-schnell', '600'],
    ['actum-3', 'sdxl', '2000'],
  ]
  for (const [actumId, modusId, impetus] of rows) {
    await meter.record({ actumId, animaId: 'anima-1', keyPrefix: 'ms2_aaaabbbb', modusId, calledAt: at('2026-09-10T00:00:00Z') })
    await meter.settle(actumId, { settledAt: at('2026-09-10T00:05:00Z'), impetus, modusLabel: modusId.toUpperCase(), models: ['intella-1'] })
  }

  const rollup = await meter.sumPeriod('anima-1', T0, T1)
  assert.equal(rollup.calls, 3)
  assert.equal(rollup.impetus, '3500')
  assert.deepEqual(rollup.lines, [
    { modusId: 'sdxl', modusLabel: 'SDXL', calls: 1, impetus: '2000' },
    { modusId: 'flux-schnell', modusLabel: 'FLUX-SCHNELL', calls: 2, impetus: '1500' },
  ])
})

test('the window is half-open [from, to) on the time the call was MADE', async () => {
  const meter = new MemoryPartnerUsage()
  for (const [id, calledAt] of [['a', T0], ['b', at('2026-09-30T23:59:59.999Z')], ['c', T1]] as Array<[string, Date]>) {
    await meter.record({ actumId: id, animaId: 'anima-1', keyPrefix: 'ms2_aaaabbbb', modusId: 'm', calledAt })
    await meter.settle(id, { settledAt: T1, impetus: '10', modusLabel: 'm', models: [] })
  }
  const rollup = await meter.sumPeriod('anima-1', T0, T1)
  assert.equal(rollup.calls, 2, 'the opening instant is in, the closing instant is out')
})

test('one partner never sees the calls of another', async () => {
  const meter = new MemoryPartnerUsage()
  await meter.record({ actumId: 'actum-1', animaId: 'anima-1', keyPrefix: 'ms2_aaaabbbb', modusId: 'm', calledAt: at('2026-09-10T00:00:00Z') })
  await meter.settle('actum-1', { settledAt: T1, impetus: '10', modusLabel: 'm', models: [] })

  assert.deepEqual(await meter.list('anima-2', T0, T1), [])
  assert.equal((await meter.sumPeriod('anima-2', T0, T1)).calls, 0)
})

// ── The webhook half, against the real handler ────────────────────────────────

test('a COMPLETED run stamps the meter row with its units and the models the flow ran', async () => {
  const meter = new MemoryPartnerUsage()
  await meter.record({ actumId: 'actum-1', animaId: 'anima-1', keyPrefix: 'ms2_aaaabbbb', modusId: 'flux-schnell', calledAt: at('2026-09-10T00:00:00Z') })

  const deps: ExecutionWebhookDeps = {
    actorum: makeActorum(makeActum()),
    completor: makeCompletor(),
    modorum: makeModorum({
      id: 'flux-schnell',
      nomen: 'FLUX Schnell',
      intellae: [{ id: 'intella-unet', role: 'unet' }, { id: 'intella-vae', role: 'vae' }],
    } as unknown as Modus),
    partnerUsage: meter,
  }
  const result = await handleExecutionWebhook(req({ id: 'job-1', status: 'COMPLETED', output: [], executionTime: 5000 }), deps)
  assert.equal(result.status, 200)

  const [row] = await meter.list('anima-1', T0, T1)
  assert.equal(row.impetus, '5', 'pod-seconds, as the webhook settled them')
  assert.equal(row.durationMs, 5000)
  assert.equal(row.modusLabel, 'FLUX Schnell')
  assert.deepEqual(row.models, ['intella-unet', 'intella-vae'])
  assert.equal(row.voidedAt, undefined)

  assert.deepEqual(await meter.sumPeriod('anima-1', T0, T1), {
    calls: 1,
    impetus: '5',
    lines: [{ modusId: 'flux-schnell', modusLabel: 'FLUX Schnell', calls: 1, impetus: '5' }],
  })
})

test('a FAILED run voids the meter row — the call is on the record, and is not billed', async () => {
  const meter = new MemoryPartnerUsage()
  await meter.record({ actumId: 'actum-1', animaId: 'anima-1', keyPrefix: 'ms2_aaaabbbb', modusId: 'flux-schnell', calledAt: at('2026-09-10T00:00:00Z') })

  const deps: ExecutionWebhookDeps = {
    actorum: makeActorum(makeActum()),
    completor: makeCompletor(),
    partnerUsage: meter,
  }
  await handleExecutionWebhook(req({ id: 'job-1', status: 'FAILED', error: 'pod died' }), deps)

  const [row] = await meter.list('anima-1', T0, T1)
  assert.ok(row.voidedAt, 'the row is voided')
  assert.equal(row.settledAt, undefined, 'and never settled')
  assert.equal((await meter.sumPeriod('anima-1', T0, T1)).calls, 0, 'a failed run is not billable')
})

test('a run that opened no meter row settles nothing — most runs are not partner runs', async () => {
  const meter = new MemoryPartnerUsage()
  const deps: ExecutionWebhookDeps = {
    actorum: makeActorum(makeActum()),
    completor: makeCompletor(),
    partnerUsage: meter,
  }
  const result = await handleExecutionWebhook(req({ id: 'job-1', status: 'COMPLETED', output: [], executionTime: 5000 }), deps)

  assert.equal(result.status, 200, 'the run completes exactly as it would with no meter wired')
  assert.deepEqual(await meter.list('anima-1', T0, T1), [])
})

test('a redelivered completion re-stamps the same row rather than adding a second call', async () => {
  const meter = new MemoryPartnerUsage()
  await meter.record({ actumId: 'actum-1', animaId: 'anima-1', keyPrefix: 'ms2_aaaabbbb', modusId: 'flux-schnell', calledAt: at('2026-09-10T00:00:00Z') })
  const deps: ExecutionWebhookDeps = {
    actorum: makeActorum(makeActum()),
    completor: makeCompletor(),
    partnerUsage: meter,
  }
  const body = { id: 'job-1', status: 'COMPLETED', output: [], executionTime: 5000 }
  await handleExecutionWebhook(req(body), deps)
  await handleExecutionWebhook(req(body), deps)

  assert.equal((await meter.sumPeriod('anima-1', T0, T1)).calls, 1)
  assert.equal((await meter.sumPeriod('anima-1', T0, T1)).impetus, '5')
})
