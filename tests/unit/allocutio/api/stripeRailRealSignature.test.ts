// =============================================================================
// stripeRailRealSignature — drives the REAL `StripeGateway` signature verification
// =============================================================================
//
// Operator directive 2026-08-01: "assume our Stripe integration is faulty until we've run it
// through." `stripeRail.test.ts` proves the money-path INVARIANTS but injects a FAKE gateway
// (`constructWebhookEvent` accepts only signature `'good'`) — the real `stripe.webhooks
// .constructEvent` HMAC verification (`makeStripeGateway`, `stripeGateway.ts`) has never been
// exercised. This test closes that gap hermetically: it signs a payload with Stripe's real
// signing scheme via the `stripe` SDK's own test helper (`stripe.webhooks
// .generateTestHeaderString`), then feeds it through `makeStripeGateway(...).constructWebhookEvent`
// — the exact function the production webhook route calls. No live key; a TEST secret string.
//
// Covers: a correctly-signed `checkout.session.completed` verifies and drives ONE credit of the
// correct server-side pack amount; a tampered payload / wrong-secret signature is REJECTED (400,
// no credit); redelivery of the identical signed payload collapses to ONE credit THROUGH the real
// verifier (the idempotency guard holds with the real gateway in the loop, not just the fake).
// =============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'
import Stripe from 'stripe'

import { handleStripeWebhook } from '../../../../src/api/webhooks/stripeWebhook.js'
import { makeStripeGateway } from '../../../../src/api/webhooks/stripeGateway.js'
import { MemorySignorum } from '../../../../src/ledger/MemorySignorum.js'
import { MemoryRedituum } from '../../../../src/ledger/MemoryRedituum.js'
import { PACKS } from '../../../../src/ledger/stripePacks.js'
import type { AnimaStore, Anima } from '../../../../src/types/anima.js'

const KNOWN_ANIMA = 'anima_real_1'
const TEST_WEBHOOK_SECRET = 'whsec_test_1234567890abcdefghijklmnopqrstuv'

function makeAnimae(known: Set<string> = new Set([KNOWN_ANIMA])): Pick<AnimaStore, 'find' | 'update'> {
  const souls = new Map<string, Anima>()
  for (const id of known) souls.set(id, { id, disputeFrozen: false } as unknown as Anima)
  return {
    find: async (id: string) => souls.get(id) ?? null,
    update: async (id, patch) => {
      const cur = souls.get(id)
      if (!cur) throw new Error(`Anima not found: ${id}`)
      const next = { ...cur, ...patch } as Anima
      souls.set(id, next)
      return next
    },
  }
}

/** The REAL gateway, bound to a TEST secret — never a live key. */
function realGateway() {
  return makeStripeGateway({
    secretKey: 'sk_test_not_a_real_key',
    webhookSecret: TEST_WEBHOOK_SECRET,
    successUrl: 'https://example.invalid/success',
    cancelUrl: 'https://example.invalid/cancel',
  })
}

function makeDeps() {
  const signorum = new MemorySignorum()
  const redituum = new MemoryRedituum()
  const animae = makeAnimae()
  const gateway = realGateway()
  return { signorum, redituum, animae, gateway }
}

function completedSessionPayload(args: { packId: string; animaId?: string; paymentIntent: string; eventId?: string }) {
  return JSON.stringify({
    id: args.eventId ?? `evt_${Math.random().toString(36).slice(2)}`,
    type: 'checkout.session.completed',
    data: {
      object: {
        client_reference_id: args.animaId ?? KNOWN_ANIMA,
        metadata: { packId: args.packId, animaId: args.animaId ?? KNOWN_ANIMA },
        payment_intent: args.paymentIntent,
        payment_status: 'paid',
      },
    },
  })
}

/** Sign a raw payload with Stripe's real scheme via the SDK's own test helper — the canonical,
 *  hermetic way to exercise the real verifier (no live key, no hand-rolled HMAC). */
function sign(payload: string, secret: string = TEST_WEBHOOK_SECRET): string {
  return Stripe.webhooks.generateTestHeaderString({ payload, secret })
}

// ── the real verifier accepts a correctly-signed event ─────────────────────────

test('REAL StripeGateway: a correctly-signed checkout.session.completed verifies and credits the exact pack amount ONCE', async () => {
  const deps = makeDeps()
  const payload = completedSessionPayload({ packId: 'standard_25', paymentIntent: 'pi_real_1' })
  const signature = sign(payload)

  const res = await handleStripeWebhook({ rawBody: payload, signature }, deps)

  assert.equal(res.status, 200)
  assert.equal(res.body.credited, PACKS.standard_25.impetus.toString())
  assert.equal(await deps.signorum.balance({ animaId: KNOWN_ANIMA }), PACKS.standard_25.impetus)
  assert.equal((await deps.signorum.history({ animaId: KNOWN_ANIMA })).length, 1)
})

// ── the real verifier rejects what it should reject ─────────────────────────────

test('REAL StripeGateway: a TAMPERED payload (signature computed over the original) is REJECTED — no credit', async () => {
  const deps = makeDeps()
  const original = completedSessionPayload({ packId: 'plus_50', paymentIntent: 'pi_real_tamper' })
  const signature = sign(original)
  // Feed a body that differs from what was signed (simulates a body mutated in transit/parsing).
  const tampered = original.replace('pi_real_tamper', 'pi_real_tamper_EVIL')

  const res = await handleStripeWebhook({ rawBody: tampered, signature }, deps)

  assert.equal(res.status, 400)
  assert.equal(res.body.received, false)
  assert.equal(await deps.signorum.balance({ animaId: KNOWN_ANIMA }), 0n)
})

test('REAL StripeGateway: a signature computed with the WRONG secret is REJECTED — no credit', async () => {
  const deps = makeDeps()
  const payload = completedSessionPayload({ packId: 'starter_10', paymentIntent: 'pi_real_wrongsecret' })
  const signature = sign(payload, 'whsec_wrong_secret_entirely_00000000')

  const res = await handleStripeWebhook({ rawBody: payload, signature }, deps)

  assert.equal(res.status, 400)
  assert.equal(await deps.signorum.balance({ animaId: KNOWN_ANIMA }), 0n)
})

test('REAL StripeGateway: a missing signature header is REJECTED — no credit', async () => {
  const deps = makeDeps()
  const payload = completedSessionPayload({ packId: 'starter_10', paymentIntent: 'pi_real_nosig' })

  const res = await handleStripeWebhook({ rawBody: payload, signature: undefined }, deps)

  assert.equal(res.status, 400)
  assert.equal(await deps.signorum.balance({ animaId: KNOWN_ANIMA }), 0n)
})

// ── idempotency THROUGH the real verifier ───────────────────────────────────────

test('REAL StripeGateway: redelivery of the identical signed payload credits EXACTLY ONCE', async () => {
  const deps = makeDeps()
  const payload = completedSessionPayload({ packId: 'starter_10', paymentIntent: 'pi_real_dup', eventId: 'evt_real_same' })
  const signature = sign(payload)

  const first = await handleStripeWebhook({ rawBody: payload, signature }, deps)
  const second = await handleStripeWebhook({ rawBody: payload, signature }, deps)   // Stripe redelivers

  assert.equal(first.status, 200)
  assert.equal(second.status, 200)
  assert.equal(first.body.credited, PACKS.starter_10.impetus.toString())
  assert.equal(second.body.credited, PACKS.starter_10.impetus.toString())   // replay, not a second mint
  assert.equal(await deps.signorum.balance({ animaId: KNOWN_ANIMA }), PACKS.starter_10.impetus)
  assert.equal((await deps.signorum.history({ animaId: KNOWN_ANIMA })).length, 1)
  assert.equal(await deps.redituum.trailingUsdRevenue(new Date(Date.now() + 60_000)), PACKS.starter_10.usdMicro)
})

test('REAL StripeGateway: a fresh Stripe-signed timestamp+payload each carries a distinct valid signature (sanity: not a fixed fixture)', async () => {
  // Guards against the test accidentally depending on a hardcoded signature string rather than the
  // real HMAC scheme — two different payloads must produce two different (both valid) signatures.
  const deps = makeDeps()
  const payloadA = completedSessionPayload({ packId: 'starter_10', paymentIntent: 'pi_real_a' })
  const payloadB = completedSessionPayload({ packId: 'starter_10', paymentIntent: 'pi_real_b' })
  const sigA = sign(payloadA)
  const sigB = sign(payloadB)
  assert.notEqual(sigA, sigB)

  const resA = await handleStripeWebhook({ rawBody: payloadA, signature: sigA }, deps)
  const resB = await handleStripeWebhook({ rawBody: payloadB, signature: sigB }, deps)
  assert.equal(resA.status, 200)
  assert.equal(resB.status, 200)
  // Cross-wired signature (A's payload with B's signature) must fail.
  const crossRes = await handleStripeWebhook({ rawBody: payloadA, signature: sigB }, deps)
  assert.equal(crossRes.status, 400)
})
