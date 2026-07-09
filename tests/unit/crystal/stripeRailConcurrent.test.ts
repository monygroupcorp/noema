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

const animae: Pick<AnimaStore, 'find'> = {
  find: async (id: string) => (id === ANIMA ? ({ id } as unknown as Anima) : null),
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
})

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
