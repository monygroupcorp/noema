// =============================================================================
// stripeRailConcurrent — the fiat rail's DURABLE cross-instance idempotency, on real Mongo.
// =============================================================================
//
// The Memory-store tests (tests/unit/allocutio/api/stripeRail.test.ts) prove sequential
// idempotency, but a single-writer Map cannot prove the money-critical property: that TWO
// instances processing the SAME payment at once credit impetus EXACTLY ONCE. That guarantee is
// the unique PARTIAL indexes — `Signum.testis` (auctor:'stripe:purchase') + `Reditus.chargeRef`
// (origo:'fiat') — created by the production `ensureIndexes`. This test wires the REAL
// MongoSignorum + MongoRedituum behind the actual webhook handler and fires concurrent deliveries.
//
// This was the false-confidence gap that blocked v1: a sequential-only test passes while a
// two-instance race double-mints. Runs under test:crystal (ephemeral mongo).
// =============================================================================

import { test, before, after, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { MongoClient, Db } from 'mongodb'

import { ensureIndexes } from '../../../src/crystal/ensureIndexes.js'
import { MongoSignorum } from '../../../src/crystal/MongoSignorum.js'
import { MongoRedituum } from '../../../src/crystal/MongoRedituum.js'
import { PACKS } from '../../../src/ledger/stripePacks.js'
import {
  handleStripeWebhook,
  type StripeGateway,
  type StripeWebhookEvent,
  type StripeWebhookDeps,
} from '../../../src/api/webhooks/stripeWebhook.js'
import type { AnimaStore, Anima } from '../../../src/types/anima.js'

const URI = process.env.MONGO_PASS ?? process.env.MONGODB_URI ?? 'mongodb://localhost:27017'
const DB = 'noemaplane_test_stripe_concurrent'
const ANIMA = 'anima_conc'

let client: MongoClient
let db: Db
let signorum: MongoSignorum
let redituum: MongoRedituum
let deps: StripeWebhookDeps

// Fake gateway: the raw body IS the serialized event; only signature 'good' verifies.
const gateway: StripeGateway = {
  async createCheckoutSession() { throw new Error('not used in this test') },
  constructWebhookEvent(rawBody, signature) {
    if (signature !== 'good') throw new Error('invalid signature')
    return JSON.parse(rawBody) as StripeWebhookEvent
  },
}

const frozenAnimae = new Set<string>()
const animae: Pick<AnimaStore, 'find' | 'update'> = {
  find: async (id: string) => (id === ANIMA ? ({ id, disputeFrozen: frozenAnimae.has(id) } as unknown as Anima) : null),
  update: async (id, patch) => {
    if (patch.disputeFrozen === true) frozenAnimae.add(id)
    if (patch.disputeFrozen === false) frozenAnimae.delete(id)
    return { id, disputeFrozen: frozenAnimae.has(id) } as unknown as Anima
  },
}

function deliver(event: StripeWebhookEvent) {
  return handleStripeWebhook({ rawBody: JSON.stringify(event), signature: 'good' }, deps)
}

function sessionEvent(packId: string, pi: string): StripeWebhookEvent {
  return {
    id: `evt_sess_${pi}`,
    type: 'checkout.session.completed',
    data: { object: { client_reference_id: ANIMA, metadata: { packId, animaId: ANIMA }, payment_intent: pi, payment_status: 'paid' } },
  }
}

function paymentIntentEvent(packId: string, pi: string): StripeWebhookEvent {
  return {
    id: `evt_pi_${pi}`,
    type: 'payment_intent.succeeded',
    data: { object: { id: pi, metadata: { packId, animaId: ANIMA }, status: 'succeeded' } },
  }
}

before(async () => {
  client = new MongoClient(URI)
  await client.connect()
  db = client.db(DB)
  // The PRODUCTION index definitions — the actual guard under test (unique partial on
  // signa.testis@stripe:purchase + reditus.chargeRef@fiat).
  await ensureIndexes(db)
  signorum = new MongoSignorum(db.collection('signa'), client)
  redituum = new MongoRedituum(db.collection('reditus'))
  deps = { signorum, redituum, animae, gateway }
})

afterEach(async () => {
  await db.collection('signa').deleteMany({})
  await db.collection('reditus').deleteMany({})
  frozenAnimae.clear()
})

// Real Stripe `charge.refunded` shape: the CHARGE carries `payment_intent` + `created` but NO
// `metadata.animaId`/`client_reference_id`. Omitted deliberately so this Mongo-backed test exercises
// the round-10 anima resolution through the REAL unique-partial index (findByTestis on
// 'stripe:<payment_intent>') — the index-backed ledger lookup, not the event object.
function refundEvent(pi: string, eventId: string): StripeWebhookEvent {
  return {
    id: eventId,
    type: 'charge.refunded',
    data: { object: { payment_intent: pi, created: Math.floor(Date.now() / 1000) } },
  }
}

after(async () => {
  await db.dropDatabase().catch(() => {})
  await client.close()
})

async function assertCreditedOnce(pack: { impetus: bigint; usdMicro: bigint }, pi: string): Promise<void> {
  // Exactly ONE stripe-purchase credit for this payment key.
  const credits = await db.collection('signa').find({ auctor: 'stripe:purchase', testis: `stripe:${pi}` }).toArray()
  assert.equal(credits.length, 1, 'expected exactly one credit signum (no double-mint)')
  assert.equal(credits[0]!.valor, pack.impetus.toString())
  // Spendable balance == the exact pack impetus (full amount, no haircut, credited once).
  const balance = await signorum.balance({ animaId: ANIMA })
  assert.equal(balance, pack.impetus)
  // Exactly ONE peer fiat Reditus for this payment key.
  const reditusRows = await db.collection('reditus').find({ chargeRef: pi, origo: 'fiat' }).toArray()
  assert.equal(reditusRows.length, 1, 'expected exactly one Reditus (no double-book)')
  assert.equal(await redituum.trailingUsdRevenue(new Date(Date.now() + 60_000)), pack.usdMicro)
}

test('CONCURRENT: the two event types of one purchase (session + payment_intent) credit EXACTLY once', async () => {
  const pi = 'pi_two_events'
  const results = await Promise.all([
    deliver(sessionEvent('standard_25', pi)),
    deliver(paymentIntentEvent('standard_25', pi)),
  ])
  for (const r of results) assert.equal(r.status, 200)
  await assertCreditedOnce(PACKS.standard_25, pi)
})

test('CONCURRENT: N simultaneous redeliveries of the same event credit EXACTLY once', async () => {
  const pi = 'pi_nway'
  const deliveries = Array.from({ length: 6 }, () => deliver(sessionEvent('plus_50', pi)))
  const results = await Promise.all(deliveries)
  for (const r of results) assert.equal(r.status, 200)
  await assertCreditedOnce(PACKS.plus_50, pi)
})

test('CONCURRENT: mixed session + payment_intent redeliveries (4-way) credit EXACTLY once', async () => {
  const pi = 'pi_mixed'
  const results = await Promise.all([
    deliver(sessionEvent('studio_100', pi)),
    deliver(paymentIntentEvent('studio_100', pi)),
    deliver(sessionEvent('studio_100', pi)),
    deliver(paymentIntentEvent('studio_100', pi)),
  ])
  for (const r of results) assert.equal(r.status, 200)
  await assertCreditedOnce(PACKS.studio_100, pi)
})

test('two DIFFERENT payments each credit once (the guard is per-payment, not global)', async () => {
  const [a, b] = await Promise.all([
    deliver(sessionEvent('starter_10', 'pi_a')),
    deliver(sessionEvent('starter_10', 'pi_b')),
  ])
  assert.equal(a.status, 200)
  assert.equal(b.status, 200)
  const credits = await db.collection('signa').find({ auctor: 'stripe:purchase' }).toArray()
  assert.equal(credits.length, 2)
  assert.equal(await signorum.balance({ animaId: ANIMA }), PACKS.starter_10.impetus * 2n)
  assert.equal(await redituum.trailingUsdRevenue(new Date(Date.now() + 60_000)), PACKS.starter_10.usdMicro * 2n)
})

// ── refund clawback: DURABLE cross-instance idempotency on real Mongo ─────────────────────────

test('CONCURRENT: N redeliveries of the SAME charge.refunded claw back EXACTLY once (unique testis@stripe:refund)', async () => {
  const pi = 'pi_refund_race'
  await deliver(sessionEvent('standard_25', pi))
  assert.equal(await signorum.balance({ animaId: ANIMA }), PACKS.standard_25.impetus)

  // Fire N simultaneous redeliveries of the identical refund event — the unique partial index on
  // testis@auctor:'stripe:refund' is the durable guard that only ONE negative-valor debit lands.
  const evt = refundEvent(pi, 'evt_refund_race')
  const results = await Promise.all(Array.from({ length: 6 }, () => deliver(evt)))
  for (const r of results) assert.equal(r.status, 200)

  const debits = await db.collection('signa').find({ auctor: 'stripe:refund', testis: 'evt_refund_race' }).toArray()
  assert.equal(debits.length, 1, 'expected exactly one clawback debit (no double-claw under the race)')
  assert.equal(debits[0]!.valor, (-PACKS.standard_25.impetus).toString())
  assert.equal(await signorum.balance({ animaId: ANIMA }), 0n)
  // Revenue reversed exactly once (unique reversalOf index) → net zero over the window.
  const reversals = await db.collection('reditus').find({ reversalOf: { $exists: true } }).toArray()
  assert.equal(reversals.length, 1, 'expected exactly one revenue contra-row (no double-reversal)')
  assert.equal(await redituum.trailingUsdRevenue(new Date(Date.now() + 60_000)), 0n)
})

test('MongoRedituum.reverse(): nets the Mongo-backed rollup and is idempotent on reversalOf', async () => {
  // Book a fiat revenue row, then reverse HALF of it. The trailing rollup must read the net figure.
  const original = await redituum.record({ usdFmv: PACKS.plus_50.usdMicro, fmvSource: 'stripe:pi_rev', origo: 'fiat', chargeRef: 'pi_rev' })
  assert.equal(await redituum.trailingUsdRevenue(new Date(Date.now() + 60_000)), PACKS.plus_50.usdMicro)

  const half = PACKS.plus_50.usdMicro / 2n
  const contra = await redituum.reverse(original.id, half, 'stripe-refund:pi_rev')
  assert.equal(contra.reversalOf, original.id)
  assert.equal(contra.usdFmv, -half)
  assert.equal(await redituum.trailingUsdRevenue(new Date(Date.now() + 60_000)), PACKS.plus_50.usdMicro - half)

  // Idempotent: a second reverse (redelivery) returns the SAME contra-row and does not net twice.
  const again = await redituum.reverse(original.id, half, 'stripe-refund:pi_rev')
  assert.equal(again.id, contra.id)
  const reversalRows = await db.collection('reditus').find({ reversalOf: original.id }).toArray()
  assert.equal(reversalRows.length, 1)
  assert.equal(await redituum.trailingUsdRevenue(new Date(Date.now() + 60_000)), PACKS.plus_50.usdMicro - half)

  // findByChargeRef resolves the original (the webhook's paymentKey → originalReditusId lookup).
  const found = await redituum.findByChargeRef('pi_rev')
  assert.equal(found?.id, original.id)
})
