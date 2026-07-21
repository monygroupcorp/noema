// =============================================================================
// stripeRail — the fiat (Stripe) funding rail: checkout + idempotent credit webhook
// =============================================================================
//
// Hermetic. The Stripe SDK is behind a fake `StripeGateway` (no live key), the ledger + revenue
// book are the Memory impls, so these prove the money-critical invariants end to end:
//   · signature verification gates crediting (a bad/unsigned webhook credits nothing)
//   · a completed payment credits the pack's EXACT impetus, full amount, NO haircut
//   · a fiat `Reditus` is booked at the charge amount (origo:'fiat', no depositumId)
//   · redelivery is idempotent — the SAME payment (incl. its two event types) credits ONCE
//   · a non-completed / anon / unknown-pack event never credits
// =============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  handleStripeCheckout,
  handleStripeWebhook,
  type StripeGateway,
  type StripeWebhookEvent,
  type StripeCheckoutInput,
} from '../../../../src/api/webhooks/stripeWebhook.js'
import { MemorySignorum } from '../../../../src/ledger/MemorySignorum.js'
import { MemoryRedituum } from '../../../../src/ledger/MemoryRedituum.js'
import { PACKS } from '../../../../src/ledger/stripePacks.js'
import type { AnimaStore, Anima } from '../../../../src/types/anima.js'

// ── fakes ────────────────────────────────────────────────────────────────────

const KNOWN_ANIMA = 'anima_1'

function animae(known: Set<string> = new Set([KNOWN_ANIMA])): Pick<AnimaStore, 'find'> {
  return { find: async (id: string) => (known.has(id) ? ({ id } as unknown as Anima) : null) }
}

/** Fake gateway: `constructWebhookEvent` accepts ONLY signature 'good' (else throws — an invalid
 *  signature); the raw body IS the serialized event. `createCheckoutSession` echoes a URL. */
function fakeGateway(): StripeGateway & { checkouts: StripeCheckoutInput[] } {
  const checkouts: StripeCheckoutInput[] = []
  return {
    checkouts,
    async createCheckoutSession(input) {
      checkouts.push(input)
      return { id: `cs_${input.packId}`, url: `https://checkout.stripe.test/${input.packId}` }
    },
    constructWebhookEvent(rawBody, signature) {
      if (signature !== 'good') throw new Error('No signatures found matching the expected signature for payload')
      return JSON.parse(rawBody) as StripeWebhookEvent
    },
  }
}

function makeDeps(over: { known?: Set<string> } = {}) {
  const signorum = new MemorySignorum()
  const redituum = new MemoryRedituum()
  const gateway = fakeGateway()
  return {
    signorum,
    redituum,
    animae: animae(over.known),
    gateway,
  }
}

function completedSession(args: {
  packId: string
  animaId?: string
  paymentIntent: string
  eventId?: string
}): StripeWebhookEvent {
  return {
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
  }
}

function deliver(deps: ReturnType<typeof makeDeps>, event: StripeWebhookEvent, signature = 'good') {
  return handleStripeWebhook({ rawBody: JSON.stringify(event), signature }, deps)
}

// ── checkout ───────────────────────────────────────────────────────────────

test('checkout: identified caller → a hosted-checkout URL with server-set pack + animaId', async () => {
  const gateway = fakeGateway()
  const res = await handleStripeCheckout({ packId: 'standard_25', animaId: KNOWN_ANIMA }, { gateway })
  assert.equal(res.ok, true)
  if (!res.ok) return
  assert.match(res.url, /checkout\.stripe\.test\/standard_25/)
  // The amount is the SERVER-side pack constant (not client-supplied): $25 → 2500 cents.
  assert.equal(gateway.checkouts[0]?.amountCents, 2500)
  assert.equal(gateway.checkouts[0]?.animaId, KNOWN_ANIMA)
  assert.equal(gateway.checkouts[0]?.packId, 'standard_25')
})

test('checkout: anonymous caller → 401 (a card cannot fund an anon purse)', async () => {
  const res = await handleStripeCheckout({ packId: 'standard_25', animaId: undefined }, { gateway: fakeGateway() })
  assert.equal(res.ok, false)
  if (res.ok) return
  assert.equal(res.status, 401)
  assert.equal(res.code, 'payments.identity_required')
})

test('checkout: unknown pack → 400, no session created', async () => {
  const gateway = fakeGateway()
  const res = await handleStripeCheckout({ packId: 'mega_9000', animaId: KNOWN_ANIMA }, { gateway })
  assert.equal(res.ok, false)
  if (res.ok) return
  assert.equal(res.status, 400)
  assert.equal(gateway.checkouts.length, 0)
})

// ── per-pack crediting (exact impetus, full amount, no haircut) ───────────────

test('each pack credits its EXACT impetus + books a fiat Reditus at the charge amount', async () => {
  for (const [packId, pack] of Object.entries(PACKS)) {
    const deps = makeDeps()
    const res = await deliver(deps, completedSession({ packId, paymentIntent: `pi_${packId}` }))
    assert.equal(res.status, 200)
    assert.equal(res.body.credited, pack.impetus.toString())
    // Spendable balance == the exact locked pack impetus (no funding haircut).
    assert.equal(await deps.signorum.balance({ animaId: KNOWN_ANIMA }), pack.impetus)
    // Revenue booked at the FULL charge amount in micro-USD (origo:'fiat').
    assert.equal(await deps.redituum.trailingUsdRevenue(new Date(Date.now() + 60_000)), pack.usdMicro)
  }
  // Sanity: the ratified constants are exactly the locked numbers (2026-07-21 R-1 ruling).
  assert.equal(PACKS.starter_10.impetus, 20800n)
  assert.equal(PACKS.standard_25.impetus, 57200n)
  assert.equal(PACKS.plus_50.impetus, 124800n)
  assert.equal(PACKS.studio_100.impetus, 270400n)
  // Anti-drift: the impetus constant must stay tied to the ruling's DISPLAY-POINT figure
  // (points = impetus / 10). A future re-ruling must change both together — this catches
  // silent drift between the code constant and the ruled points.
  assert.equal(PACKS.starter_10.impetus / 10n, 2080n)
  assert.equal(PACKS.standard_25.impetus / 10n, 5720n)
  assert.equal(PACKS.plus_50.impetus / 10n, 12480n)
  assert.equal(PACKS.studio_100.impetus / 10n, 27040n)
})

test('the credit signum is stripe:purchase / testis stripe:<paymentKey> / forma minted', async () => {
  const deps = makeDeps()
  await deliver(deps, completedSession({ packId: 'plus_50', paymentIntent: 'pi_x' }))
  const history = await deps.signorum.history({ animaId: KNOWN_ANIMA })
  assert.equal(history.length, 1)
  const s = history[0]!
  assert.equal(s.auctor, 'stripe:purchase')
  assert.equal(s.testis, 'stripe:pi_x')
  // forma:'minted' — a platform-issued, fiat-funded credit (NOT 'eth'; no ETH is involved).
  assert.equal(s.forma, 'minted')
  assert.equal(s.valor, 124800n)
})

// ── idempotency (the point) ──────────────────────────────────────────────────

test('redelivery of the SAME event credits impetus EXACTLY ONCE (no double-credit, no double-Reditus)', async () => {
  const deps = makeDeps()
  const event = completedSession({ packId: 'starter_10', paymentIntent: 'pi_dup', eventId: 'evt_same' })

  const first = await deliver(deps, event)
  const second = await deliver(deps, event)   // Stripe redelivers the identical event

  assert.equal(first.status, 200)
  assert.equal(second.status, 200)
  assert.equal(first.body.credited, '20800')
  assert.equal(second.body.credited, '20800')  // the replay reports the original outcome
  // Credited ONCE.
  assert.equal(await deps.signorum.balance({ animaId: KNOWN_ANIMA }), 20800n)
  assert.equal((await deps.signorum.history({ animaId: KNOWN_ANIMA })).length, 1)
  // Revenue booked ONCE.
  assert.equal(await deps.redituum.trailingUsdRevenue(new Date(Date.now() + 60_000)), PACKS.starter_10.usdMicro)
})

test('both event types for ONE payment (checkout.session.completed + payment_intent.succeeded) credit ONCE', async () => {
  const deps = makeDeps()
  const sessionEvt = completedSession({ packId: 'standard_25', paymentIntent: 'pi_one', eventId: 'evt_sess' })
  const piEvt: StripeWebhookEvent = {
    id: 'evt_pi',
    type: 'payment_intent.succeeded',
    data: { object: { id: 'pi_one', metadata: { packId: 'standard_25', animaId: KNOWN_ANIMA }, status: 'succeeded' } },
  }

  await deliver(deps, sessionEvt)
  await deliver(deps, piEvt)   // same payment_intent id → same idempotency key

  assert.equal(await deps.signorum.balance({ animaId: KNOWN_ANIMA }), 57200n)
  assert.equal((await deps.signorum.history({ animaId: KNOWN_ANIMA })).length, 1)
  assert.equal(await deps.redituum.trailingUsdRevenue(new Date(Date.now() + 60_000)), PACKS.standard_25.usdMicro)
})

test('a delivery that crashed AFTER the credit but BEFORE the Reditus is repaired on redelivery (revenue booked once)', async () => {
  // The credit (Signum) is minted, then the process dies before the peer Reditus is booked. Stripe
  // redelivers: the credit is replayed (not double-minted) AND the missing Reditus is now booked —
  // so revenue lands exactly once, never zero. Simulates the crash by minting the signum directly.
  const deps = makeDeps()
  await deps.signorum.issue({ forma: 'minted', animaId: KNOWN_ANIMA, valor: PACKS.plus_50.impetus, auctor: 'stripe:purchase', testis: 'stripe:pi_crash' })
  // No Reditus yet (the crash). Redeliver:
  const again = await deliver(deps, completedSession({ packId: 'plus_50', paymentIntent: 'pi_crash' }))
  assert.equal(again.status, 200)
  // Credited exactly once (the pre-existing signum is replayed, not re-minted).
  assert.equal(await deps.signorum.balance({ animaId: KNOWN_ANIMA }), 124800n)
  assert.equal((await deps.signorum.history({ animaId: KNOWN_ANIMA })).length, 1)
  // The peer Reditus, missing after the crash, is now present — booked exactly once.
  assert.equal(await deps.redituum.trailingUsdRevenue(new Date(Date.now() + 60_000)), PACKS.plus_50.usdMicro)
})

// ── security: no unauthenticated / unverified / non-completed credit ──────────

test('a bad/unsigned webhook is rejected (400) and credits nothing', async () => {
  const deps = makeDeps()
  const event = completedSession({ packId: 'studio_100', paymentIntent: 'pi_bad' })
  const res = await deliver(deps, event, 'FORGED')
  assert.equal(res.status, 400)
  assert.equal(res.body.received, false)
  assert.equal(await deps.signorum.balance({ animaId: KNOWN_ANIMA }), 0n)
  assert.equal(await deps.redituum.trailingUsdRevenue(new Date(Date.now() + 60_000)), 0n)
})

test('a non-completed checkout.session (unpaid) never credits (400)', async () => {
  const deps = makeDeps()
  const event: StripeWebhookEvent = {
    id: 'evt_unpaid',
    type: 'checkout.session.completed',
    data: { object: { client_reference_id: KNOWN_ANIMA, metadata: { packId: 'starter_10' }, payment_intent: 'pi_unpaid', payment_status: 'unpaid' } },
  }
  const res = await deliver(deps, event)
  assert.equal(res.status, 400)
  assert.equal(await deps.signorum.balance({ animaId: KNOWN_ANIMA }), 0n)
})

test('a non-crediting event type (e.g. payment_intent.created) is acked (200) and credits nothing', async () => {
  const deps = makeDeps()
  const event: StripeWebhookEvent = {
    id: 'evt_created',
    type: 'payment_intent.created',
    data: { object: { id: 'pi_created', metadata: { packId: 'starter_10', animaId: KNOWN_ANIMA } } },
  }
  const res = await deliver(deps, event)
  assert.equal(res.status, 200)
  assert.equal(res.body.credited, undefined)
  assert.equal(await deps.signorum.balance({ animaId: KNOWN_ANIMA }), 0n)
})

test('an unknown packId in a verified event never credits (400)', async () => {
  const deps = makeDeps()
  const res = await deliver(deps, completedSession({ packId: 'mega_9000', paymentIntent: 'pi_unknown' }))
  assert.equal(res.status, 400)
  assert.equal(await deps.signorum.balance({ animaId: KNOWN_ANIMA }), 0n)
})

test('a completed event for a non-existent anima never credits (400)', async () => {
  const deps = makeDeps({ known: new Set() })  // no anima exists
  const res = await deliver(deps, completedSession({ packId: 'starter_10', paymentIntent: 'pi_ghost' }))
  assert.equal(res.status, 400)
  assert.equal(await deps.signorum.balance({ animaId: KNOWN_ANIMA }), 0n)
})
