// =============================================================================
// The training standing order — opened at the click, read off the run
// =============================================================================
//
// rth, 2026-08-24: "if I have clicked that I intend to train this, then even if it
// fails, I don't have to continue retrying it." This suite pins the half of that which
// lives in the facade: a training launch OPENS an order carrying the effective input
// and the payer key, an order that fires does not open a second one, the order is
// visible on the run without parsing prose, and the cancel is the holder's.
//
// The order is opened at the click because that is the only moment both facts exist:
// an Actum deliberately carries no identity, and no spend cap — so the payer key and
// the dispatch terms are unreachable from any later, downstream failure hook.
// =============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { CrystalApi } from '../../../../src/allocutio/api/CrystalApi.js'
import { ApiError } from '../../../../src/allocutio/api/errors.js'
import { TRAINING_MODUS_ID, ORDER_MAX_RUNS, ORDER_WINDOW_MS } from '../../../../src/crystal/MandatumRunner.js'
import { MemoryMandatum } from '../../crystal/memoryMandatum.js'
import type { Actum } from '../../../../src/types/actum.js'
import type { Inceptio } from '../../../../src/types/cursus.js'

const OWNER = { animaId: 'anima-1' } as const
const STRANGER = { animaId: 'anima-2' } as const

const TRAINING_ADITUS = { dataset: '[{"url":"https://example.test/a.png"}]', triggerWord: 'trigword', steps: 1200 }

/** The smallest dispatch ring `invokeFlow` can run over: one atomic, async modus. */
function ring(mandata: MemoryMandatum, modusId = TRAINING_MODUS_ID) {
  const acta = new Map<string, Actum>()
  let seq = 0
  const modus = { id: modusId, versio: '1', genus: 'atomicum', ministerium: 'test', aditus: {}, exitus: {} }
  const seen: Inceptio[] = []
  const deps = {
    mandata,
    modorum: { async find() { return modus } },
    inceptor: {
      async initiate(inceptio: Inceptio) {
        seen.push(inceptio)
        const actum: Actum = {
          id: `run-${++seq}`,
          modusId: inceptio.modusId,
          modusVersiono: '1',
          impetus: 0n,
          signaConsumed: ['signum-1'],
          aditus: inceptio.aditus,
          status: 'nascens',
          inceptum: new Date(),
        } as Actum
        acta.set(actum.id, actum)
        return actum
      },
    },
    cursorum: {
      resolve() {
        return {
          async run() { return { kind: 'async' as const } },
          // The admission-cap estimate goes through the cursor; cheap here, so a capped
          // request is admitted and the cap can be asserted where it is KEPT.
          async reserve() { return 1000n },
        }
      },
    },
    completor: { async fail() {}, async complete() {} },
    actorum: { async findById(id: string) { return acta.get(id) ?? null } },
    // Ownership is the ledger's: OWNER holds the signum every seeded run consumed.
    signorum: { async ownsAny(auctor: { animaId?: string }) { return auctor.animaId === OWNER.animaId } },
  }
  return { deps, acta, seen, modus }
}

function apiOver(mandata: MemoryMandatum, modusId?: string) {
  const r = ring(mandata, modusId)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { api: new CrystalApi(r.deps as any), ...r }
}

test('a training launch opens a standing order carrying the effective input, the payer, and the day', async () => {
  const mandata = new MemoryMandatum()
  const { api } = apiOver(mandata)

  const before = Date.now()
  const run = await api.invokeFlow(OWNER, { modusId: TRAINING_MODUS_ID }, TRAINING_ADITUS)

  const orders = await mandata.list()
  assert.equal(orders.length, 1, 'the click opened exactly one order')
  const order = orders[0]
  assert.deepEqual(order.by, { animaId: 'anima-1' }, 'the payer key the actum cannot hold')
  assert.deepEqual(
    order.aditus,
    { ...TRAINING_ADITUS, ownerAnimaId: 'anima-1' },
    'the effective input carries the stamped owner, so a later attempt replays exactly',
  )
  assert.equal(order.modusId, TRAINING_MODUS_ID)
  assert.equal(order.status, 'active')
  assert.deepEqual(order.acta, [run.id], 'the launch is the order\'s first attempt')
  assert.equal(order.ignitions, 1)
  assert.equal(order.pendens, run.id, 'the order is watching the attempt, not scheduling a new one')
  assert.equal(order.schedula?.maxRuns, ORDER_MAX_RUNS)
  assert.ok(
    (order.finis?.getTime() ?? 0) >= before + ORDER_WINDOW_MS,
    'the window runs a day from the ORIGINAL click',
  )
  // And it rides back on the response, so the caller never has to ask a second question.
  assert.equal(run.order?.id, order.id)
  assert.equal(run.order?.state, 'attempting')
  assert.equal(run.order?.attempts, 1)
})

// =============================================================================
// The training owner stamp — the minted LoRA's `ownerAnimaId` is set from the
// resolved caller, never from the request body, and rides the order's snapshot
// so a later hourly retry replays with the same owner as the original click.
// =============================================================================

test('an anima\'s training invoke stamps the caller as owner, even without one in the request', async () => {
  const mandata = new MemoryMandatum()
  const { api, seen } = apiOver(mandata)

  await api.invokeFlow(OWNER, { modusId: TRAINING_MODUS_ID }, TRAINING_ADITUS)

  assert.equal(seen[0]?.aditus.ownerAnimaId, OWNER.animaId, 'the finalizer mints against this field')
})

test('a client-supplied ownerAnimaId is overwritten with the caller\'s — identity never comes off the payload', async () => {
  const mandata = new MemoryMandatum()
  const { api, seen } = apiOver(mandata)

  await api.invokeFlow(OWNER, { modusId: TRAINING_MODUS_ID }, { ...TRAINING_ADITUS, ownerAnimaId: STRANGER.animaId })

  assert.equal(seen[0]?.aditus.ownerAnimaId, OWNER.animaId, 'the caller\'s identity wins over anything the client set')
})

test('a bursa-bearer invoke stamps no owner, and strips one the client supplied — a bearer names no one to trust', async () => {
  const mandata = new MemoryMandatum()
  const { api, seen } = apiOver(mandata)

  await api.invokeFlow(OWNER, { modusId: TRAINING_MODUS_ID }, { ...TRAINING_ADITUS, ownerAnimaId: STRANGER.animaId }, {
    by: { bursaToken: 'purse-1' },
  })

  assert.equal(seen[0]?.aditus.ownerAnimaId, undefined, 'a bearer credential names no durable owner')
})

test('a non-training run\'s aditus is untouched by the owner stamp', async () => {
  const mandata = new MemoryMandatum()
  const { api, seen } = apiOver(mandata, 'modus.text-to-image')

  await api.invokeFlow(OWNER, { modusId: 'modus.text-to-image' }, { prompt: 'a cat' })

  assert.ok(!('ownerAnimaId' in seen[0]!.aditus), 'the stamp is scoped to the training modus only')
})

test('the spend cap the request carried is kept on the order — later attempts run on the same terms', async () => {
  const mandata = new MemoryMandatum()
  const { api } = apiOver(mandata)

  await api.invokeFlow(OWNER, { modusId: TRAINING_MODUS_ID }, TRAINING_ADITUS, {
    maxImpetus: '250000', computeStrategy: 'performance', gpuClass: 'ultra',
  })

  const [order] = await mandata.list()
  assert.equal(order.invocatio?.maxImpetus, '250000', 'an unattended attempt must still be capped')
  assert.equal(order.invocatio?.computeStrategy, 'performance')
  assert.equal(order.invocatio?.gpuClass, 'ultra')
})

test('an attempt fired BY an order does not open a second order', async () => {
  const mandata = new MemoryMandatum()
  const { api } = apiOver(mandata)

  await api.invokeFlow(OWNER, { modusId: TRAINING_MODUS_ID }, TRAINING_ADITUS)
  const [order] = await mandata.list()
  await api.invokeFlow(OWNER, { modusId: TRAINING_MODUS_ID }, TRAINING_ADITUS, { mandatumId: order.id })

  assert.equal((await mandata.list()).length, 1, 'a retry must not fan out into a second standing order')
})

test('a non-training run opens no order at all', async () => {
  const mandata = new MemoryMandatum()
  const { api } = apiOver(mandata, 'modus.text-to-image')

  const run = await api.invokeFlow(OWNER, { modusId: 'modus.text-to-image' }, { prompt: 'a cat' })

  assert.equal((await mandata.list()).length, 0)
  assert.equal(run.order, undefined)
})

test('a bursa bearer token opens no order — a bearer credential names no one to spend for', async () => {
  const mandata = new MemoryMandatum()
  const { api } = apiOver(mandata)

  await api.invokeFlow(OWNER, { modusId: TRAINING_MODUS_ID }, TRAINING_ADITUS, { by: { bursaToken: 'purse-1' } })

  assert.equal((await mandata.list()).length, 0)
})

test('the order rides on GET run — the scheduled state is a field, never a sentence to parse', async () => {
  const mandata = new MemoryMandatum()
  const { api, acta } = apiOver(mandata)

  const launched = await api.invokeFlow(OWNER, { modusId: TRAINING_MODUS_ID }, TRAINING_ADITUS)
  // The attempt fails on infrastructure and the runner reschedules it.
  const actum = acta.get(launched.id)!
  actum.status = 'fractus'
  actum.error = 'Pod pod-3 abandoned after 130000ms as an ip-less host'
  const [order] = await mandata.list()
  await mandata.update(order.id, { pendens: undefined })
  await mandata.setNextFire(order.id, new Date(Date.now() + 60 * 60_000))

  const run = await api.getRun(OWNER, launched.id)

  assert.equal(run.status, 'failed', 'the ATTEMPT failed — that stays true')
  assert.equal(run.order?.state, 'scheduled', 'and the REQUEST stands, said in a field')
  assert.ok(run.order?.nextAttemptAt, 'with the next attempt named')
  assert.equal(run.order?.attemptsRemaining, ORDER_MAX_RUNS - 1)
  // The failure the user is shown is classified copy, not the operator's raw text.
  assert.ok(!/abandoned after/.test(run.failure?.message ?? ''), 'raw internal failure text reached the user')
})

test('a fulfilled order reports its reason, and offers no next attempt', async () => {
  const mandata = new MemoryMandatum()
  const { api } = apiOver(mandata)
  const launched = await api.invokeFlow(OWNER, { modusId: TRAINING_MODUS_ID }, TRAINING_ADITUS)
  const [order] = await mandata.list()
  await mandata.update(order.id, { status: 'exhaustus', causa: 'impletum', pendens: undefined })

  const run = await api.getRun(OWNER, launched.id)
  assert.equal(run.order?.state, 'fulfilled')
  assert.equal(run.order?.reason, 'fulfilled')
  assert.equal(run.order?.attemptsRemaining, 0)
  assert.equal(run.order?.nextAttemptAt, undefined, 'a terminal order must not advertise a next attempt')
})

test('the holder can cancel their order, and cancelling is idempotent', async () => {
  const mandata = new MemoryMandatum()
  const { api } = apiOver(mandata)
  const launched = await api.invokeFlow(OWNER, { modusId: TRAINING_MODUS_ID }, TRAINING_ADITUS)

  const cancelled = await api.revokeRunOrder(OWNER, launched.id)
  assert.equal(cancelled?.state, 'cancelled')
  assert.equal(cancelled?.reason, 'cancelled')
  const [stored] = await mandata.list()
  assert.equal(stored.status, 'revocatum', 'the store holds the revocation, so the runner will not claim it')
  assert.equal(stored.pendens, undefined)

  const again = await api.revokeRunOrder(OWNER, launched.id)
  assert.equal(again?.state, 'cancelled', 'a second cancel neither reopens nor re-terminates')
})

test('a stranger can neither read nor cancel an order, and cannot tell it exists', async () => {
  const mandata = new MemoryMandatum()
  const { api } = apiOver(mandata)
  const launched = await api.invokeFlow(OWNER, { modusId: TRAINING_MODUS_ID }, TRAINING_ADITUS)

  for (const call of [
    () => api.getRunOrder(STRANGER, launched.id),
    () => api.revokeRunOrder(STRANGER, launched.id),
  ]) {
    const err = await call().then(() => null, (e: unknown) => e)
    assert.ok(err instanceof ApiError, 'a stranger must be refused')
    assert.equal((err as ApiError).code, 'not_found.run')
  }
  // Indistinguishable from an id that never existed — no existence leak.
  const absent = await api.getRunOrder(STRANGER, 'id-that-does-not-exist').then(() => null, (e: unknown) => e)
  assert.equal((absent as ApiError).code, 'not_found.run')
  // And nothing was mutated by the refused cancel.
  assert.equal((await mandata.list())[0].status, 'active')
})

test('a run with no order reads as no order, not as an error', async () => {
  const mandata = new MemoryMandatum()
  const { api } = apiOver(mandata, 'modus.text-to-image')
  const run = await api.invokeFlow(OWNER, { modusId: 'modus.text-to-image' }, { prompt: 'a cat' })

  assert.equal(await api.getRunOrder(OWNER, run.id), null)
  assert.equal(await api.revokeRunOrder(OWNER, run.id), null)
})

test('a store that refuses to open an order does not fail the training the user paid for', async () => {
  const mandata = new MemoryMandatum()
  mandata.create = async () => { throw new Error('mandata unavailable') }
  const { api } = apiOver(mandata)

  const run = await api.invokeFlow(OWNER, { modusId: TRAINING_MODUS_ID }, TRAINING_ADITUS)

  assert.ok(run.id, 'the run stands on its own — the order is a convenience over it')
  assert.equal(run.order, undefined)
})
