// =============================================================================
// stripeProMonthlyRail -- the Pro Monthly subscription rail (Option B, card fkhqv3)
// =============================================================================
//
// Hermetic. The Stripe SDK is behind a fake `ProMonthlyGateway` (no live key), the ledger is the
// Memory impl, so these prove the money-critical invariants end to end:
//   · signature verification gates activation/granting (a bad/unsigned webhook grants nothing)
//   · checkout.session.completed activates the subscription record, mapping subscription→anima
//   · invoice.paid grants the EXACT monthly allowance (parity with standard_25), once per invoice
//   · redelivery of the SAME invoice is idempotent (no double-grant)
//   · a subscription this rail never saw activated, or one already canceled, never grants
//   · customer.subscription.deleted stops all FUTURE grants for that subscription
//   · the fair-use rollover cap throttles a renewal once the standing balance would exceed it
// =============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  handleProMonthlyCheckout,
  handleProMonthlyWebhook,
  type ProMonthlyGateway,
  type ProMonthlyWebhookEvent,
  type ProMonthlyCheckoutInput,
} from '../../../../src/api/webhooks/stripeProMonthlyWebhook.js'
import { MemoryProMonthlySubscriptions } from '../../../../src/ledger/MemoryProMonthlySubscriptions.js'
import { MemorySignorum } from '../../../../src/ledger/MemorySignorum.js'
import { PRO_MONTHLY, PACKS, proMonthlyFairUseCap, proMonthlyRenewalGrant } from '../../../../src/ledger/stripePacks.js'

const KNOWN_ANIMA = 'anima_1'

function fakeGateway(): ProMonthlyGateway & { checkouts: ProMonthlyCheckoutInput[] } {
  const checkouts: ProMonthlyCheckoutInput[] = []
  return {
    checkouts,
    async createSubscriptionCheckoutSession(input) {
      checkouts.push(input)
      return { id: `cs_promonthly_${input.animaId}`, url: `https://checkout.stripe.test/promonthly/${input.animaId}` }
    },
    constructWebhookEvent(rawBody, signature) {
      if (signature !== 'good') throw new Error('No signatures found matching the expected signature for payload')
      return JSON.parse(rawBody) as ProMonthlyWebhookEvent
    },
  }
}

function makeDeps() {
  return {
    signorum: new MemorySignorum(),
    subscriptions: new MemoryProMonthlySubscriptions(),
    gateway: fakeGateway(),
  }
}

function deliver(deps: ReturnType<typeof makeDeps>, event: ProMonthlyWebhookEvent, signature = 'good') {
  return handleProMonthlyWebhook({ rawBody: JSON.stringify(event), signature }, deps)
}

function checkoutCompleted(args: { animaId?: string; stripeSubscriptionId: string; eventId?: string }): ProMonthlyWebhookEvent {
  return {
    id: args.eventId ?? `evt_${Math.random().toString(36).slice(2)}`,
    type: 'checkout.session.completed',
    data: { object: { client_reference_id: args.animaId ?? KNOWN_ANIMA, subscription: args.stripeSubscriptionId } },
  }
}

function invoicePaid(args: { invoiceId: string; stripeSubscriptionId: string }): ProMonthlyWebhookEvent {
  return {
    id: `evt_${Math.random().toString(36).slice(2)}`,
    type: 'invoice.paid',
    data: { object: { id: args.invoiceId, subscription: args.stripeSubscriptionId } },
  }
}

function subscriptionDeleted(stripeSubscriptionId: string): ProMonthlyWebhookEvent {
  return {
    id: `evt_${Math.random().toString(36).slice(2)}`,
    type: 'customer.subscription.deleted',
    data: { object: { id: stripeSubscriptionId } },
  }
}

// ── checkout ───────────────────────────────────────────────────────────────

test('checkout: identified caller → a subscription-mode hosted-checkout URL, server-priced', async () => {
  const gateway = fakeGateway()
  const res = await handleProMonthlyCheckout({ animaId: KNOWN_ANIMA }, { gateway })
  assert.equal(res.ok, true)
  if (!res.ok) return
  assert.match(res.url, /checkout\.stripe\.test\/promonthly/)
  assert.equal(gateway.checkouts[0]?.amountCents, PRO_MONTHLY.amountCents)
  assert.equal(gateway.checkouts[0]?.animaId, KNOWN_ANIMA)
})

test('checkout: anonymous caller → 401 (a card cannot fund an anon purse)', async () => {
  const res = await handleProMonthlyCheckout({ animaId: undefined }, { gateway: fakeGateway() })
  assert.equal(res.ok, false)
  if (res.ok) return
  assert.equal(res.status, 401)
  assert.equal(res.code, 'payments.identity_required')
})

// ── activation ───────────────────────────────────────────────────────────────

test('checkout.session.completed activates the subscription record (subscription → anima)', async () => {
  const deps = makeDeps()
  const res = await deliver(deps, checkoutCompleted({ stripeSubscriptionId: 'sub_1' }))
  assert.equal(res.status, 200)
  const record = await deps.subscriptions.findBySubscriptionId('sub_1')
  assert.equal(record?.animaId, KNOWN_ANIMA)
  assert.equal(record?.status, 'active')
})

test('checkout.session.completed grants nothing by itself — the first grant comes from invoice.paid', async () => {
  const deps = makeDeps()
  await deliver(deps, checkoutCompleted({ stripeSubscriptionId: 'sub_1' }))
  assert.equal(await deps.signorum.balance({ animaId: KNOWN_ANIMA }), 0n)
})

// ── renewal grant (the point) ─────────────────────────────────────────────────

test('invoice.paid grants EXACTLY the monthly allowance (parity with standard_25)', async () => {
  const deps = makeDeps()
  await deliver(deps, checkoutCompleted({ stripeSubscriptionId: 'sub_1' }))
  const res = await deliver(deps, invoicePaid({ invoiceId: 'in_1', stripeSubscriptionId: 'sub_1' }))
  assert.equal(res.status, 200)
  assert.equal(res.body.granted, '57200')
  assert.equal(await deps.signorum.balance({ animaId: KNOWN_ANIMA }), PRO_MONTHLY.monthlyImpetus)
  assert.equal(PRO_MONTHLY.monthlyImpetus, PACKS.standard_25.impetus, 'priced at parity, not a discount')
})

test('the grant signum is stripe:subscription / testis stripe:promonthly:<invoiceId> / forma minted', async () => {
  const deps = makeDeps()
  await deliver(deps, checkoutCompleted({ stripeSubscriptionId: 'sub_1' }))
  await deliver(deps, invoicePaid({ invoiceId: 'in_1', stripeSubscriptionId: 'sub_1' }))
  const history = await deps.signorum.history({ animaId: KNOWN_ANIMA })
  assert.equal(history.length, 1)
  const s = history[0]!
  assert.equal(s.auctor, 'stripe:subscription')
  assert.equal(s.testis, 'stripe:promonthly:in_1')
  assert.equal(s.forma, 'minted')
  assert.equal(s.valor, 57200n)
})

test('redelivery of the SAME invoice grants EXACTLY ONCE (no double-grant)', async () => {
  const deps = makeDeps()
  await deliver(deps, checkoutCompleted({ stripeSubscriptionId: 'sub_1' }))
  await deliver(deps, invoicePaid({ invoiceId: 'in_1', stripeSubscriptionId: 'sub_1' }))
  const second = await deliver(deps, invoicePaid({ invoiceId: 'in_1', stripeSubscriptionId: 'sub_1' }))
  assert.equal(second.status, 200)
  assert.equal(second.body.granted, '57200')
  assert.equal(await deps.signorum.balance({ animaId: KNOWN_ANIMA }), 57200n)
  assert.equal((await deps.signorum.history({ animaId: KNOWN_ANIMA })).length, 1)
})

test('three successive invoices (three cycles) each grant once — three distinct credits', async () => {
  const deps = makeDeps()
  await deliver(deps, checkoutCompleted({ stripeSubscriptionId: 'sub_1' }))
  await deliver(deps, invoicePaid({ invoiceId: 'in_1', stripeSubscriptionId: 'sub_1' }))
  await deliver(deps, invoicePaid({ invoiceId: 'in_2', stripeSubscriptionId: 'sub_1' }))
  await deliver(deps, invoicePaid({ invoiceId: 'in_3', stripeSubscriptionId: 'sub_1' }))
  assert.equal(await deps.signorum.balance({ animaId: KNOWN_ANIMA }), 57200n * 3n)
  assert.equal((await deps.signorum.history({ animaId: KNOWN_ANIMA })).length, 3)
})

test('invoice.paid for a subscription this rail never saw activated → 200 no-op, nothing granted', async () => {
  const deps = makeDeps()
  const res = await deliver(deps, invoicePaid({ invoiceId: 'in_ghost', stripeSubscriptionId: 'sub_ghost' }))
  assert.equal(res.status, 200)
  assert.equal(res.body.granted, undefined)
})

// ── cancellation ─────────────────────────────────────────────────────────────

test('customer.subscription.deleted marks canceled; a LATER invoice.paid for it grants nothing', async () => {
  const deps = makeDeps()
  await deliver(deps, checkoutCompleted({ stripeSubscriptionId: 'sub_1' }))
  await deliver(deps, invoicePaid({ invoiceId: 'in_1', stripeSubscriptionId: 'sub_1' }))
  assert.equal(await deps.signorum.balance({ animaId: KNOWN_ANIMA }), 57200n)

  const cancelRes = await deliver(deps, subscriptionDeleted('sub_1'))
  assert.equal(cancelRes.status, 200)
  assert.equal((await deps.subscriptions.findBySubscriptionId('sub_1'))?.status, 'canceled')

  const res = await deliver(deps, invoicePaid({ invoiceId: 'in_2', stripeSubscriptionId: 'sub_1' }))
  assert.equal(res.status, 200)
  assert.equal(res.body.granted, undefined)
  assert.equal(await deps.signorum.balance({ animaId: KNOWN_ANIMA }), 57200n, 'unchanged — no post-cancel grant')
})

test('a redelivered customer.subscription.deleted is idempotent (still canceled, no error)', async () => {
  const deps = makeDeps()
  await deliver(deps, checkoutCompleted({ stripeSubscriptionId: 'sub_1' }))
  await deliver(deps, subscriptionDeleted('sub_1'))
  const second = await deliver(deps, subscriptionDeleted('sub_1'))
  assert.equal(second.status, 200)
  assert.equal((await deps.subscriptions.findBySubscriptionId('sub_1'))?.status, 'canceled')
})

// ── security: no unauthenticated grant ────────────────────────────────────────

test('a bad/unsigned webhook is rejected (400) and grants/activates nothing', async () => {
  const deps = makeDeps()
  const res = await deliver(deps, checkoutCompleted({ stripeSubscriptionId: 'sub_bad' }), 'FORGED')
  assert.equal(res.status, 400)
  assert.equal(res.body.received, false)
  assert.equal(await deps.subscriptions.findBySubscriptionId('sub_bad'), null)
})

test('checkout.session.completed missing client_reference_id/subscription → 400, nothing activated', async () => {
  const deps = makeDeps()
  const event: ProMonthlyWebhookEvent = {
    id: 'evt_bad',
    type: 'checkout.session.completed',
    data: { object: {} },
  }
  const res = await deliver(deps, event)
  assert.equal(res.status, 400)
})

test('an unrelated event type is acked (200) and changes nothing', async () => {
  const deps = makeDeps()
  const res = await deliver(deps, { id: 'evt_x', type: 'customer.subscription.created', data: { object: {} } })
  assert.equal(res.status, 200)
})

// ── fair-use rollover cap (the pure math, and wired through the webhook) ──────

test('proMonthlyRenewalGrant: grants the full monthly allowance under the cap', () => {
  const { grant, throttled } = proMonthlyRenewalGrant(0n)
  assert.equal(grant, PRO_MONTHLY.monthlyImpetus)
  assert.equal(throttled, false)
})

test('proMonthlyRenewalGrant: the cap is exactly 3 cycles (this + 2 rolled-over)', () => {
  assert.equal(proMonthlyFairUseCap(), PRO_MONTHLY.monthlyImpetus * 3n)
  assert.equal(proMonthlyFairUseCap(), 171600n)
})

test('proMonthlyRenewalGrant: a partially-hoarded balance grants only the remaining headroom', () => {
  const cap = proMonthlyFairUseCap()
  const balance = cap - 20000n
  const { grant, throttled } = proMonthlyRenewalGrant(balance)
  assert.equal(grant, 20000n)
  assert.equal(throttled, true)
  assert.equal(balance + grant, cap)
})

test('proMonthlyRenewalGrant: at or over the cap grants ZERO', () => {
  assert.deepEqual(proMonthlyRenewalGrant(proMonthlyFairUseCap()), { grant: 0n, throttled: true })
  assert.deepEqual(proMonthlyRenewalGrant(proMonthlyFairUseCap() + 1000n), { grant: 0n, throttled: true })
})

test('a subscriber who never spends gets throttled on the 4th cycle (3 full grants, then 0)', async () => {
  const deps = makeDeps()
  await deliver(deps, checkoutCompleted({ stripeSubscriptionId: 'sub_hoarder' }))
  for (const invoiceId of ['in_1', 'in_2', 'in_3']) {
    await deliver(deps, invoicePaid({ invoiceId, stripeSubscriptionId: 'sub_hoarder' }))
  }
  assert.equal(await deps.signorum.balance({ animaId: KNOWN_ANIMA }), proMonthlyFairUseCap())

  const fourth = await deliver(deps, invoicePaid({ invoiceId: 'in_4', stripeSubscriptionId: 'sub_hoarder' }))
  assert.equal(fourth.status, 200)
  assert.equal(fourth.body.granted, '0')
  assert.equal(fourth.body.throttled, true)
  assert.equal(await deps.signorum.balance({ animaId: KNOWN_ANIMA }), proMonthlyFairUseCap(), 'no change on the throttled cycle')
})

test('a subscriber who spends down between cycles keeps getting granted in full', async () => {
  const deps = makeDeps()
  await deliver(deps, checkoutCompleted({ stripeSubscriptionId: 'sub_spender' }))
  await deliver(deps, invoicePaid({ invoiceId: 'in_1', stripeSubscriptionId: 'sub_spender' }))
  assert.equal(await deps.signorum.balance({ animaId: KNOWN_ANIMA }), 57200n)

  // Spend the whole first grant before the next cycle bills.
  const r = await deps.signorum.reserve({ animaId: KNOWN_ANIMA }, 57200n, 'spend_cycle_1')
  assert.equal(r.ok, true); if (!r.ok) return
  await deps.signorum.settle(r.signaIds, 57200n, 'spend_cycle_1')
  assert.equal(await deps.signorum.balance({ animaId: KNOWN_ANIMA }), 0n)

  const second = await deliver(deps, invoicePaid({ invoiceId: 'in_2', stripeSubscriptionId: 'sub_spender' }))
  assert.equal(second.body.granted, '57200')
  assert.equal(await deps.signorum.balance({ animaId: KNOWN_ANIMA }), 57200n)
})
