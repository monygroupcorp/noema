// =============================================================================
// Session spend ↔ ledger settlement parity
// =============================================================================
//
// `Modo.impetusAccrued` is the session budget guard's input (Census reads it as
// `costAccrued + impetusAccrued >= budget`), so it must hold the amount the
// LEDGER SETTLED for each run — not the cursor's raw metered figure, which is
// only settlement's base term. The two coincide until a surcharge or the
// reservation cap applies; these tests pin them together on both completion
// rails across exactly the cases where they can come apart.
//
// TEST DESIGN — the assertion is always against a number the LEDGER produced:
// `RecordingSignorum` captures the exact amount handed to `signorum.settle`, and
// the accrual delta is compared to THAT (and to the actum's persisted `impetus`,
// written from the same value). Nothing here recomputes the settled amount from
// the rate rules — a test that redid the arithmetic the way the code does could
// not catch the two sides using different numbers in the first place.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { ActumCompletor } from '../../../src/execution/ActumCompletor.js'
import { MemoryActorum } from '../../../src/execution/MemoryActorum.js'
import { MemoryModo } from '../../../src/execution/MemoryModo.js'
import { MemorySignorum } from '../../../src/ledger/MemorySignorum.js'
import { TesseraCursor } from '../../../src/crystal/TesseraCursor.js'
import { dispatchInceptio, type DispatchDeps } from '../../../src/execution/dispatchInceptio.js'
import { handleExecutionWebhook } from '../../../src/api/webhooks/executionWebhook.js'
import type { Actum } from '../../../src/types/actum.js'
import type { Modus } from '../../../src/types/modus.js'
import type { Cursor, CursorResult, Inceptio } from '../../../src/types/cursus.js'
import type { PricingTier } from '../../../src/ledger/rates.js'

// ── doubles ──────────────────────────────────────────────────────────────────

/** MemorySignorum that records what the ledger was told to settle, so a test can
 *  assert against the settled number itself rather than a re-derived one. */
class RecordingSignorum extends MemorySignorum {
  readonly settled: Array<{ actumId: string; impetus: bigint }> = []
  override async settle(signaIds: string[], actualImpetus: bigint, actumId: string): Promise<void> {
    this.settled.push({ actumId, impetus: actualImpetus })
    await super.settle(signaIds, actualImpetus, actumId)
  }
}

function makeModus(): Modus {
  return {
    id: 'mod-1', nomen: 'Test Flow', genus: 'atomicus',
    versio: '1.0.0', contentHash: 'abc',
    aditus: { prompt: { type: 'text', required: true, description: 'The prompt' } },
    exitus: { url: { type: 'image' } },
    canonica: true, ministerium: 'runpod',
    natum: new Date(), mutatum: new Date(),
  } as Modus
}

interface Rig {
  acta: MemoryActorum
  signorum: RecordingSignorum
  modos: MemoryModo
  completor: ActumCompletor
  modoId: string
  actum: Actum
  /** Session spend at the moment the run started — the baseline every delta is taken from. */
  accruedBefore: bigint
}

/**
 * One session, one dispatched run holding a reservation of `reservation` impetus.
 *
 * `tier` stamps the dispatch-time pricing tier the completor reads; omitted → no
 * tier, which is the no-surcharge case. `reservation` doubles as the settlement
 * cap, so a small one is how a test makes the cap bind.
 */
async function makeRig(opts: {
  reservation: bigint
  tier?: PricingTier
  accruedBefore?: bigint
  jobId?: string
}): Promise<Rig> {
  const acta = new MemoryActorum()
  const signorum = new RecordingSignorum()
  const modos = new MemoryModo()
  const completor = new ActumCompletor({ acta, signorum, modos })

  const accruedBefore = opts.accruedBefore ?? 0n
  const modo = await modos.create({
    status: 'active', impetusAccrued: accruedBefore, acta: [], idleWarmthSec: 300,
  })

  const signum = await signorum.issue({
    animaId: 'anima-1', forma: 'integer', valor: opts.reservation, auctor: 'test:seed',
  })

  const actum = await acta.create({
    id: 'actum-1',
    modusId: 'mod-1',
    modusVersiono: '1.0.0',
    impetus: opts.reservation,
    signaConsumed: [signum.id],
    aditus: { prompt: 'a cat' },
    status: 'agens',
    expirat: new Date(Date.now() + 60_000),
    externusJobId: opts.jobId ?? 'job-1',
    modoId: modo.id,
    ...(opts.tier ? { executio: { pricingTier: opts.tier } } : {}),
  })
  await signorum.lock([signum.id], actum.id)

  return { acta, signorum, modos, completor, modoId: modo.id, actum, accruedBefore }
}

/**
 * The assertion this whole file exists for: what the session accrued for this run
 * is what the ledger settled for it — nothing recomputed on the test's side.
 */
async function assertParity(rig: Rig): Promise<bigint> {
  const settledByLedger = rig.signorum.settled
  assert.equal(settledByLedger.length, 1, 'the ledger settled this run exactly once')
  const settled = settledByLedger[0].impetus

  const persisted = (await rig.acta.findById(rig.actum.id))!.impetus
  assert.equal(persisted, settled, 'the actum records the settled amount')

  const modo = (await rig.modos.findById(rig.modoId))!
  assert.equal(
    modo.impetusAccrued - rig.accruedBefore,
    settled,
    'session accrual for the run equals the ledger-settled amount',
  )

  return settled
}

// ── async rail: the completion webhook ───────────────────────────────────────

function webhookReq(jobId: string, executionTimeMs: number) {
  return {
    body: { id: jobId, status: 'COMPLETED', output: [], executionTime: executionTimeMs },
    rawBody: '',
  }
}

test('async rail — ordinary run: session accrual is the settled amount', async () => {
  const rig = await makeRig({ reservation: 10_000n, accruedBefore: 100n })
  // 60_000 ms → the webhook reports 60 impetus of metered pod time.
  await handleExecutionWebhook(webhookReq('job-1', 60_000), {
    actorum: rig.acta, completor: rig.completor,
  })

  const settled = await assertParity(rig)
  // No tier, no cap in play — nothing separates the two figures here, and the
  // guard's total moved by exactly one run's settled spend.
  assert.equal(settled, 60n)
  assert.equal((await rig.modos.findById(rig.modoId))!.impetusAccrued, 160n)
})

test('async rail — surcharged (guest) run: the surcharge lands in the session total', async () => {
  const rig = await makeRig({ reservation: 10_000n, tier: 'guest' })
  await handleExecutionWebhook(webhookReq('job-1', 60_000), {
    actorum: rig.acta, completor: rig.completor,
  })

  const settled = await assertParity(rig)
  // The whole point: the settled figure is ABOVE the 60 the webhook metered, and
  // the session counted the settled one. (Asserted as an inequality against the
  // reported figure, not as the arithmetic that produced it.)
  assert.ok(settled > 60n, 'a guest run settles above its metered pod time')
})

test('async rail — capped run: the session counts the capped amount, not the raw one', async () => {
  // Reservation deliberately below what the surcharge would push the run to, so
  // the cap binds and the settled figure lands BELOW base + surcharge.
  const rig = await makeRig({ reservation: 70n, tier: 'guest' })
  await handleExecutionWebhook(webhookReq('job-1', 60_000), {
    actorum: rig.acta, completor: rig.completor,
  })

  const settled = await assertParity(rig)
  assert.equal(settled, 70n, 'the reservation cap is what settled')
  assert.ok(settled > 60n && settled < 60n + 80n, 'the cap bound between base and base + surcharge')
})

test('async rail — a run bound to no session leaves every session untouched', async () => {
  const rig = await makeRig({ reservation: 10_000n, accruedBefore: 42n })
  // Same rig, but the run carries no session binding.
  await rig.acta.update(rig.actum.id, {})
  const unbound = { ...rig.actum }
  delete (unbound as Partial<Actum>).modoId
  const acta = new MemoryActorum()
  await acta.create(unbound)

  await handleExecutionWebhook(webhookReq('job-1', 60_000), {
    actorum: acta,
    completor: new ActumCompletor({ acta, signorum: rig.signorum, modos: rig.modos }),
  })

  assert.equal((await rig.modos.findById(rig.modoId))!.impetusAccrued, 42n)
})

// ── sync rail: dispatchInceptio completing inline behind a TesseraCursor ─────

function syncDeps(rig: Rig, reported: bigint): DispatchDeps {
  const modus = makeModus()
  const inner: Cursor = {
    reserve: async () => rig.actum.impetus,
    run: async (): Promise<CursorResult> => ({
      kind: 'sync',
      exitus: { exitus: { url: 'https://example.com/x.png' }, impetus: reported, duratio: 1_000 },
    }),
  }
  const cursor = new TesseraCursor(inner, rig.modos, rig.signorum)
  return {
    inceptor: { initiate: async () => rig.actum },
    modorum: {
      find: async () => modus,
      register: async () => {},
      list: async () => [],
    } as unknown as DispatchDeps['modorum'],
    cursorum: { register: () => {}, resolve: () => cursor },
    completor: rig.completor,
  }
}

const inceptio: Inceptio = { modusId: 'mod-1', aditus: { prompt: 'a cat' }, by: { animaId: 'anima-1' } }

test('sync rail — ordinary run: session accrual is the settled amount', async () => {
  const rig = await makeRig({ reservation: 10_000n, accruedBefore: 100n })
  await dispatchInceptio(syncDeps(rig, 60n), inceptio)

  const settled = await assertParity(rig)
  assert.equal(settled, 60n)
})

test('sync rail — surcharged (guest) run: the surcharge lands in the session total', async () => {
  const rig = await makeRig({ reservation: 10_000n, tier: 'guest' })
  await dispatchInceptio(syncDeps(rig, 60n), inceptio)

  const settled = await assertParity(rig)
  assert.ok(settled > 60n, 'a guest run settles above its metered pod time')
})

test('sync rail — capped run: the session counts the capped amount, not the raw one', async () => {
  const rig = await makeRig({ reservation: 70n, tier: 'guest' })
  await dispatchInceptio(syncDeps(rig, 60n), inceptio)

  const settled = await assertParity(rig)
  assert.equal(settled, 70n, 'the reservation cap is what settled')
  assert.ok(settled > 60n && settled < 60n + 80n, 'the cap bound between base and base + surcharge')
})

test('sync rail — the cursor itself accrues nothing; only settlement does', async () => {
  // TesseraCursor sees only the pre-settlement figure, so it must not write spend.
  // It still records the actum on the session.
  const rig = await makeRig({ reservation: 10_000n, tier: 'guest' })
  const inner: Cursor = {
    reserve: async () => 10_000n,
    run: async (): Promise<CursorResult> => ({
      kind: 'sync',
      exitus: { exitus: {}, impetus: 60n, duratio: 1_000 },
    }),
  }
  const cursor = new TesseraCursor(inner, rig.modos, rig.signorum)
  const modo = (await rig.modos.findById(rig.modoId))!

  await cursor.run(rig.actum, modo)

  const after = (await rig.modos.findById(rig.modoId))!
  assert.equal(after.impetusAccrued, 0n, 'no spend accrued before the ledger settled anything')
  assert.deepEqual(after.acta, [rig.actum.id], 'the run is still recorded on the session')
  assert.equal(rig.signorum.settled.length, 0, 'nothing settled yet')
})

// ── the two rails must not differ from each other ────────────────────────────

test('both rails settle and accrue the SAME figure for the same run', async () => {
  const asyncRig = await makeRig({ reservation: 10_000n, tier: 'guest' })
  await handleExecutionWebhook(webhookReq('job-1', 60_000), {
    actorum: asyncRig.acta, completor: asyncRig.completor,
  })

  const syncRig = await makeRig({ reservation: 10_000n, tier: 'guest' })
  await dispatchInceptio(syncDeps(syncRig, 60n), inceptio)

  const asyncModo = (await asyncRig.modos.findById(asyncRig.modoId))!
  const syncModo = (await syncRig.modos.findById(syncRig.modoId))!
  const asyncSettled = asyncRig.signorum.settled[0].impetus
  const syncSettled = syncRig.signorum.settled[0].impetus

  assert.equal(asyncSettled, syncSettled, 'the two rails settle the same run identically')
  assert.equal(asyncModo.impetusAccrued, asyncSettled, 'async rail accrued what it settled')
  assert.equal(syncModo.impetusAccrued, syncSettled, 'sync rail accrued what it settled')
  assert.ok(asyncSettled > 0n, 'the run had a cost to account for at all')
})
