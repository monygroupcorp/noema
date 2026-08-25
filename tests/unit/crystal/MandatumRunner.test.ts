// =============================================================================
// MandatumRunner — the standing order, one decision at a time
// =============================================================================
//
// What is actually at stake here is spending: this loop is the only thing in the
// system that can start a paid run without a user present. So the suite asserts the
// NEGATIVE cases as hard as the positive ones — a fulfilled order never fires again,
// a real failure ends the order instead of re-running it, an erased payer is never
// spent on, a cancelled order is inert, and the day's window closes the order even
// while attempts remain.
//
// The clock is injected, so an hour is a number here and nothing sleeps.
// =============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { MandatumRunner, type AttemptOutcome, HOURLY_CRON, ORDER_MAX_RUNS, ORDER_WINDOW_MS, TRAINING_MODUS_ID } from '../../../src/crystal/MandatumRunner.js'
import { MemoryMandatum } from './memoryMandatum.js'
import type { Mandatum } from '../../../src/types/mandatum.js'

const T0 = new Date('2026-08-24T12:00:00.000Z').getTime()
const HOUR = 60 * 60_000

/** A clock the test advances by hand. */
function clock(start = T0) {
  let t = start
  return { now: () => new Date(t), advance: (ms: number) => { t += ms }, at: () => t }
}

/** An order as `CrystalApi` opens one: live, holding its first attempt, due immediately. */
async function seedOrder(store: MemoryMandatum, over: Partial<Mandatum> = {}): Promise<Mandatum> {
  const created = await store.create({
    modusId: TRAINING_MODUS_ID,
    aditus: { dataset: '[]', triggerWord: 'trigword', steps: 1000 },
    by: { animaId: 'anima-1' },
    triggerGenus: 'schedula',
    schedula: { cron: HOURLY_CRON, zona: 'UTC', maxRuns: ORDER_MAX_RUNS },
    status: 'active',
    finis: new Date(T0 + ORDER_WINDOW_MS),
    proximum: new Date(T0),
    pendens: 'run-1',
    ...over,
  })
  return store.update(created.id, { acta: ['run-1'], ignitions: 1, ignitum: new Date(T0) })
}

interface Harness {
  store: MemoryMandatum
  runner: MandatumRunner
  fired: string[]
  outcomes: Map<string, AttemptOutcome>
  time: ReturnType<typeof clock>
}

function harness(opts: {
  payerLive?: (by: Mandatum['by']) => Promise<boolean>
  fire?: (m: Mandatum) => Promise<string>
} = {}): Harness {
  const store = new MemoryMandatum()
  const outcomes = new Map<string, AttemptOutcome>()
  const fired: string[] = []
  const time = clock()
  let seq = 1
  const runner = new MandatumRunner({
    mandata: store,
    outcome: async (actumId) => outcomes.get(actumId) ?? null,
    fire: opts.fire ?? (async (m) => {
      fired.push(m.id)
      const id = `run-${++seq}`
      outcomes.set(id, { state: 'pending' })
      return id
    }),
    ...(opts.payerLive ? { payerLive: opts.payerLive } : {}),
    now: time.now,
  })
  return { store, runner, fired, outcomes, time }
}

test('an attempt still running is left alone and re-checked later — never re-fired underneath itself', async () => {
  const h = harness()
  const m = await seedOrder(h.store)
  h.outcomes.set('run-1', { state: 'pending' })

  await h.runner.drainOnce()

  assert.equal(h.fired.length, 0, 'a second run must never start while the first is in flight')
  const after = await h.store.find(m.id)
  assert.equal(after?.status, 'active')
  assert.equal(after?.pendens, 'run-1', 'still watching the same attempt')
  assert.ok((after?.proximum?.getTime() ?? 0) > h.time.at(), 'rescheduled into the future')
})

test('a successful attempt fulfils the order, and the order never fires again', async () => {
  const h = harness()
  const m = await seedOrder(h.store)
  h.outcomes.set('run-1', { state: 'succeeded' })

  await h.runner.drainOnce()
  h.time.advance(2 * HOUR)
  await h.runner.drainOnce()

  const after = await h.store.find(m.id)
  assert.equal(after?.status, 'exhaustus')
  assert.equal(after?.causa, 'impletum')
  assert.equal(after?.pendens, undefined)
  assert.equal(h.fired.length, 0, 'a fulfilled order is done — nothing further is dispatched')
})

test('an infrastructure failure schedules the next attempt an hour out, and the hour is honoured', async () => {
  const h = harness()
  const m = await seedOrder(h.store)
  h.outcomes.set('run-1', { state: 'failed', error: 'Pod pod-9 abandoned after 130000ms as an ip-less host' })

  await h.runner.drainOnce()
  let after = await h.store.find(m.id)
  assert.equal(after?.status, 'active', 'the request stands')
  assert.equal(after?.pendens, undefined, 'no attempt outstanding')
  assert.equal(after?.proximum?.getTime(), h.time.at() + HOUR)

  // Thirty minutes on, nothing is due yet.
  h.time.advance(30 * 60_000)
  await h.runner.drainOnce()
  assert.equal(h.fired.length, 0, 'fired early — the hourly cadence is not being honoured')

  h.time.advance(31 * 60_000)
  await h.runner.drainOnce()
  assert.equal(h.fired.length, 1)
  after = await h.store.find(m.id)
  assert.equal(after?.ignitions, 2)
  assert.equal(after?.acta.length, 2, 'the new attempt is recorded on the order')
  assert.equal(after?.pendens, after?.acta[1], 'now watching the new attempt')
})

test('a failure that is a real answer ends the order — the work is not re-run on the user', async () => {
  const h = harness()
  const m = await seedOrder(h.store)
  h.outcomes.set('run-1', { state: 'failed', error: 'comfyrunner job failed: cuDNN error CUDNN_STATUS_EXECUTION_FAILED' })

  await h.runner.drainOnce()
  h.time.advance(2 * HOUR)
  await h.runner.drainOnce()

  const after = await h.store.find(m.id)
  assert.equal(after?.status, 'exhaustus')
  assert.equal(after?.causa, 'defectus')
  assert.equal(h.fired.length, 0, 'a job that ran and failed must never be re-run automatically')
})

test('the day closes the order even with attempts left, and reports that it was the day', async () => {
  const h = harness()
  const m = await seedOrder(h.store)
  h.outcomes.set('run-1', { state: 'failed', error: 'SSH not ready after 600000ms' })

  await h.runner.drainOnce()          // schedules the next attempt
  h.time.advance(ORDER_WINDOW_MS)     // …but the day runs out first
  await h.runner.drainOnce()

  const after = await h.store.find(m.id)
  assert.equal(after?.status, 'exhaustus')
  assert.equal(after?.causa, 'consumptum')
  assert.ok((after?.ignitions ?? 0) < ORDER_MAX_RUNS, 'attempts remained — it was the window that ended it')
  assert.equal(h.fired.length, 0)
})

test('the attempt allowance closes the order inside the window', async () => {
  const h = harness()
  const m = await seedOrder(h.store, { schedula: { cron: HOURLY_CRON, zona: 'UTC', maxRuns: 2 } })
  h.outcomes.set('run-1', { state: 'failed', error: 'no capacity in any region' })

  await h.runner.drainOnce()                       // → scheduled, 1 of 2 spent
  h.time.advance(HOUR)
  await h.runner.drainOnce()                       // → fires attempt 2
  assert.equal(h.fired.length, 1)
  const second = (await h.store.find(m.id))!.acta[1]
  h.outcomes.set(second, { state: 'failed', error: 'no capacity in any region' })
  h.time.advance(2 * 60_000)
  await h.runner.drainOnce()                       // → allowance spent

  const after = await h.store.find(m.id)
  assert.equal(after?.status, 'exhaustus')
  assert.equal(after?.causa, 'consumptum')
  assert.equal(h.fired.length, 1, 'no third attempt past the allowance')
})

test('a balance dip skips the hour instead of ending the order, and a funded hour later succeeds', async () => {
  let broke = true
  const h = harness({
    fire: async () => {
      if (broke) throw Object.assign(new Error('Balance cannot cover the reservation'), { code: 'economy.insufficient_signa' })
      return 'run-funded'
    },
  })
  const m = await seedOrder(h.store)
  h.outcomes.set('run-1', { state: 'failed', error: 'SSH not ready after 600000ms' })

  await h.runner.drainOnce()
  h.time.advance(HOUR)
  await h.runner.drainOnce()                       // the fire throws 402

  let after = await h.store.find(m.id)
  assert.equal(after?.status, 'active', 'a momentary shortfall must not end the request')
  assert.equal(after?.ignitions, 1, 'a skipped fire is not an attempt — nothing was reserved')
  assert.equal(after?.proximum?.getTime(), h.time.at() + HOUR)

  broke = false
  h.time.advance(HOUR)
  await h.runner.drainOnce()
  after = await h.store.find(m.id)
  assert.equal(after?.ignitions, 2)
  assert.equal(after?.pendens, 'run-funded')
})

test('an erased payer ends the order — an erased account is never spent on', async () => {
  const h = harness({ payerLive: async () => false })
  const m = await seedOrder(h.store)
  h.outcomes.set('run-1', { state: 'failed', error: 'SSH not ready after 600000ms' })

  await h.runner.drainOnce()
  h.time.advance(HOUR)
  await h.runner.drainOnce()

  const after = await h.store.find(m.id)
  assert.equal(h.fired.length, 0, 'no run may be dispatched for a payer that no longer exists')
  assert.equal(after?.status, 'revocatum')
  assert.equal(after?.causa, 'defectus')
})

test('a frozen payer does not fire — the gate refusal is observed, not bypassed', async () => {
  // The freeze lives in the invoke path, so it reaches the runner as a throw. The order is
  // held, not killed: a dispute hold can lift inside the day.
  const h = harness({
    fire: async () => { throw Object.assign(new Error('This account is frozen pending review'), { code: 'auth.forbidden' }) },
  })
  const m = await seedOrder(h.store)
  h.outcomes.set('run-1', { state: 'failed', error: 'SSH not ready after 600000ms' })

  await h.runner.drainOnce()
  h.time.advance(HOUR)
  await h.runner.drainOnce()

  const after = await h.store.find(m.id)
  assert.equal(after?.ignitions, 1, 'nothing was dispatched for a frozen account')
  assert.equal(after?.status, 'active')
})

test('a revoked order is inert — it is never claimed and never fires again', async () => {
  const h = harness()
  const m = await seedOrder(h.store)
  await h.store.update(m.id, { status: 'revocatum', causa: 'revocatum', pendens: undefined })

  h.time.advance(2 * HOUR)
  await h.runner.drainOnce()

  assert.equal(h.fired.length, 0)
  assert.equal((await h.store.find(m.id))?.status, 'revocatum')
})

test('a claimed order is not handed to a second runner while its lease holds', async () => {
  const h = harness()
  await seedOrder(h.store)
  const first = await h.store.claimDue(h.time.now(), 60_000)
  assert.ok(first, 'the order was claimable')
  const second = await h.store.claimDue(h.time.now(), 60_000)
  assert.equal(second, null, 'two workers must never hold the same order')
})

test('an attempt that cannot be read is treated as still running, never as a failure', async () => {
  const h = harness()
  const m = await seedOrder(h.store)   // no outcome registered for run-1

  await h.runner.drainOnce()

  const after = await h.store.find(m.id)
  assert.equal(after?.status, 'active')
  assert.equal(after?.pendens, 'run-1')
  assert.equal(h.fired.length, 0, 'an unreadable attempt must not trigger a duplicate run')
})
