// =============================================================================
// partnerInvoice — the meter priced, issued, and paid APART from consumer credits
// =============================================================================
//
// The load-bearing claim of the B2B rail is that a partner's payment is not a credit purchase.
// Both rails cross the same Stripe boundary and both book USD revenue; only one of them mints
// spendable impetus. So the assertions here are not only "the invoice was paid" but "the
// ledger is untouched" — checked against the same `MemorySignorum` a pack purchase would have
// credited, in the same test, so the two rails are compared rather than described.
//
// Hermetic: Memory stores throughout, a fake `StripeGateway`, no live key and no Mongo.
// =============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  handleInvoiceCheckout,
  handleStripeWebhook,
  type StripeGateway,
  type StripeWebhookEvent,
  type StripeCheckoutInput,
} from '../../../src/api/webhooks/stripeWebhook.js'
import { MemorySignorum } from '../../../src/ledger/MemorySignorum.js'
import { MemoryRedituum } from '../../../src/ledger/MemoryRedituum.js'
import { MemoryPartnerUsage } from '../../../src/crystal/MemoryPartnerUsage.js'
import { MemoryPartnerInvoice } from '../../../src/crystal/MemoryPartnerInvoice.js'
import { draftInvoice, priceImpetus, usdMicroToCents } from '../../../src/ledger/partnerInvoicing.js'
import { MICRO_USD_PER_IMPETUS } from '../../../src/ledger/rates.js'
import type { PartnerBilling } from '../../../src/types/partner.js'
import type { PartnerInvoice } from '../../../src/types/partnerInvoice.js'
import type { AnimaStore, Anima } from '../../../src/types/anima.js'

const ANIMA = 'anima-partner-1'
const PERIOD_START = new Date('2026-09-01T00:00:00.000Z')
const PERIOD_END = new Date('2026-10-01T00:00:00.000Z')
const ISSUED = new Date('2026-10-01T09:00:00.000Z')

const BILLING: PartnerBilling = {
  billingEmail: 'ap@example.com',
  billedTo: 'Example Ltd',
  netDays: 30,
  setAt: new Date('2026-08-01T00:00:00.000Z'),
}

function fakeGateway(): StripeGateway & { checkouts: StripeCheckoutInput[] } {
  const checkouts: StripeCheckoutInput[] = []
  return {
    checkouts,
    async createCheckoutSession(input) {
      checkouts.push(input)
      return { id: `cs_${input.invoiceId ?? input.packId}`, url: `https://checkout.stripe.test/${input.invoiceId ?? input.packId}` }
    },
    constructWebhookEvent(rawBody, signature) {
      if (signature !== 'good') throw new Error('No signatures found matching the expected signature for payload')
      return JSON.parse(rawBody) as StripeWebhookEvent
    },
  }
}

function makeAnimae(): Pick<AnimaStore, 'find' | 'update'> {
  const souls = new Map<string, Anima>([[ANIMA, { id: ANIMA } as unknown as Anima]])
  return {
    find: async id => souls.get(id) ?? null,
    update: async (id, patch) => {
      const next = { ...souls.get(id), ...patch } as Anima
      souls.set(id, next)
      return next
    },
  }
}

/** A meter with `calls` settled calls of `impetus` each, all inside the period. */
async function meterWith(calls: number, impetus: string): Promise<MemoryPartnerUsage> {
  const usage = new MemoryPartnerUsage()
  for (let i = 0; i < calls; i++) {
    const actumId = `actum-${i}`
    await usage.record({ actumId, animaId: ANIMA, keyPrefix: 'ms2_aaaabbbb', modusId: 'flux-schnell', calledAt: new Date('2026-09-10T00:00:00.000Z') })
    await usage.settle(actumId, { settledAt: new Date('2026-09-10T00:05:00.000Z'), impetus, modusLabel: 'FLUX Schnell', models: ['intella-unet'] })
  }
  return usage
}

async function issueFor(usage: MemoryPartnerUsage, invoices = new MemoryPartnerInvoice()): Promise<{ invoice: PartnerInvoice; invoices: MemoryPartnerInvoice }> {
  const invoice = await draftInvoice(
    { usage, invoices },
    { animaId: ANIMA, billing: BILLING, periodStart: PERIOD_START, periodEnd: PERIOD_END, issuedAt: ISSUED },
  )
  return { invoice, invoices }
}

function paidSession(invoiceId: string, paymentIntent: string, animaId = ANIMA): StripeWebhookEvent {
  return {
    id: `evt_${paymentIntent}`,
    type: 'checkout.session.completed',
    data: {
      object: {
        client_reference_id: animaId,
        metadata: { invoiceId, animaId },
        payment_intent: paymentIntent,
        payment_status: 'paid',
        created: Math.floor(new Date('2026-10-05T10:00:00.000Z').getTime() / 1000),
      },
    },
  }
}

// ── pricing ──────────────────────────────────────────────────────────────────

test('priceImpetus: the platform rate, read from code, rounded up to the whole cent', () => {
  // 1 impetus = 337 micro-USD, which is not a whole cent — so the invoice states the cent above.
  assert.equal(priceImpetus(1n), 10_000n)
  // 100 impetus = 33,700 micro-USD = 3.37 cents → 4 cents.
  assert.equal(priceImpetus(100n), 40_000n)
  // An exact multiple is left alone: 10,000 impetus = 3,370,000 micro-USD = exactly $3.37.
  assert.equal(priceImpetus(10_000n), 10_000n * MICRO_USD_PER_IMPETUS)
  assert.equal(priceImpetus(0n), 0n)
})

test('priceImpetus: every output is a whole number of cents, so cash and revenue cannot diverge', () => {
  for (const impetus of [1n, 7n, 13n, 999n, 123_457n, 2n ** 70n]) {
    assert.equal(priceImpetus(impetus) % 10_000n, 0n, `impetus ${impetus} priced to a sub-cent amount`)
  }
})

test('priceImpetus: exact past 2^53 — a big invoice does not lose precision to a float', () => {
  const huge = 9_007_199_254_740_993n            // 2^53 + 1, the first integer a double cannot hold
  assert.equal(priceImpetus(huge) / 10_000n * 10_000n, priceImpetus(huge))
  assert.ok(priceImpetus(huge) >= huge * MICRO_USD_PER_IMPETUS)
})

// ── drafting from the meter ──────────────────────────────────────────────────

test('an invoice is drawn from the meter: totals, line items, and the amount due', async () => {
  const { invoice } = await issueFor(await meterWith(3, '900'))

  assert.equal(invoice.usage.calls, 3)
  assert.equal(invoice.usage.impetus, '2700')
  assert.deepEqual(invoice.usage.lines, [{ modusId: 'flux-schnell', modusLabel: 'FLUX Schnell', calls: 3, impetus: '2700' }])
  assert.equal(invoice.usdMicro, priceImpetus(2700n).toString())
  assert.equal(invoice.status, 'open')
  assert.equal(invoice.billedTo, 'Example Ltd')
  assert.equal(invoice.dueAt.toISOString(), '2026-10-31T09:00:00.000Z', 'net 30 from issue')
})

test('the invoice freezes what it billed — later meter activity does not restate it', async () => {
  const usage = await meterWith(1, '900')
  const { invoice } = await issueFor(usage)

  // A run from the same period lands late (it was in flight when the invoice was cut).
  await usage.record({ actumId: 'actum-late', animaId: ANIMA, keyPrefix: 'ms2_aaaabbbb', modusId: 'sdxl', calledAt: new Date('2026-09-30T23:00:00.000Z') })
  await usage.settle('actum-late', { settledAt: new Date('2026-10-01T00:30:00.000Z'), impetus: '5000', modusLabel: 'SDXL', models: [] })

  assert.equal(invoice.usage.impetus, '900', 'the issued invoice still says what it said')
  assert.equal((await usage.sumPeriod(ANIMA, PERIOD_START, PERIOD_END)).impetus, '5900', 'the meter has moved on')
})

test('a period is billed once — a second issue is refused rather than silently re-billing', async () => {
  const usage = await meterWith(1, '900')
  const { invoices } = await issueFor(usage)
  await assert.rejects(() => issueFor(usage, invoices), /already billed for this period/)
})

test('a period that metered nothing still issues — billed and came to nothing is a fact', async () => {
  const { invoice } = await issueFor(new MemoryPartnerUsage())
  assert.equal(invoice.usage.calls, 0)
  assert.equal(invoice.usdMicro, '0')
  assert.equal(invoice.status, 'open')
})

// ── checkout ─────────────────────────────────────────────────────────────────

test('checkout: the session carries the invoice and NO pack, at the amount the invoice states', async () => {
  const { invoice } = await issueFor(await meterWith(3, '900'))
  const gateway = fakeGateway()
  const res = await handleInvoiceCheckout(invoice, { gateway })

  assert.equal(res.ok, true)
  const sent = gateway.checkouts[0]
  assert.equal(sent?.invoiceId, invoice.id)
  assert.equal(sent?.packId, undefined, 'no pack — this session must never reach the crediting branch')
  assert.equal(sent?.amountCents, usdMicroToCents(BigInt(invoice.usdMicro)))
  assert.equal(sent?.animaId, ANIMA)
})

test('checkout: an invoice with nothing due opens no session', async () => {
  const { invoice } = await issueFor(new MemoryPartnerUsage())
  const gateway = fakeGateway()
  const res = await handleInvoiceCheckout(invoice, { gateway })
  assert.equal(res.ok, false)
  if (res.ok) return
  assert.equal(res.code, 'payments.nothing_due')
  assert.equal(gateway.checkouts.length, 0)
})

test('checkout: an already-paid invoice opens no session', async () => {
  const { invoice, invoices } = await issueFor(await meterWith(1, '900'))
  await invoices.markPaid(invoice.id, new Date(), 'pi_1')
  const paid = (await invoices.find(invoice.id))!
  const res = await handleInvoiceCheckout(paid, { gateway: fakeGateway() })
  assert.equal(res.ok, false)
  if (res.ok) return
  assert.equal(res.status, 409)
})

// ── payment: revenue, and NOT credits ────────────────────────────────────────

async function payFixture() {
  const usage = await meterWith(3, '900')
  const { invoice, invoices } = await issueFor(usage)
  const deps = {
    signorum: new MemorySignorum(),
    redituum: new MemoryRedituum(),
    animae: makeAnimae(),
    gateway: fakeGateway(),
    partnerInvoices: invoices,
  }
  return { invoice, invoices, deps }
}

const deliver = (deps: Awaited<ReturnType<typeof payFixture>>['deps'], event: StripeWebhookEvent, signature = 'good') =>
  handleStripeWebhook({ rawBody: JSON.stringify(event), signature }, deps)

test('paying an invoice books USD revenue and mints NO spendable credit', async () => {
  const { invoice, invoices, deps } = await payFixture()

  const res = await deliver(deps, paidSession(invoice.id, 'pi_inv_1'))
  assert.equal(res.status, 200)

  // Revenue: one fiat Reditus, at the invoice's amount, keyed by the charge.
  const booked = await deps.redituum.findByChargeRef('pi_inv_1')
  assert.ok(booked, 'a Reditus was booked')
  assert.equal(booked.usdFmv.toString(), invoice.usdMicro)
  assert.equal(booked.origo, 'fiat')
  assert.equal(booked.depositumId, undefined, 'a fiat row carries no depositum')
  assert.equal(booked.natum.toISOString(), '2026-10-05T10:00:00.000Z', 'revenue at receipt, from the time on the charge')

  // Credits: nothing. This is the whole claim.
  assert.equal((await deps.signorum.balance({ animaId: ANIMA })).toString(), '0')
  assert.equal((await deps.signorum.history({ animaId: ANIMA })).length, 0, 'no signum of any kind was issued')

  // The invoice is settled, and says what settled it.
  const paid = (await invoices.find(invoice.id))!
  assert.equal(paid.status, 'paid')
  assert.equal(paid.chargeRef, 'pi_inv_1')
  assert.equal(paid.paidAt?.toISOString(), '2026-10-05T10:00:00.000Z')
})

test('redelivery is idempotent — one revenue row, one paid stamp, still no credit', async () => {
  const { invoice, invoices, deps } = await payFixture()
  const event = paidSession(invoice.id, 'pi_inv_1')

  await deliver(deps, event)
  await deliver(deps, event)
  // The purchase's other event type shares the payment_intent, and must collapse too.
  await deliver(deps, {
    id: 'evt_pi',
    type: 'payment_intent.succeeded',
    data: { object: { id: 'pi_inv_1', metadata: { invoiceId: invoice.id, animaId: ANIMA }, status: 'succeeded' } },
  })

  // The revenue book has no list read; the trailing rollup is the figure the cap is measured
  // against, and a double-book would show up there as twice the invoice.
  const recognized = await deps.redituum.trailingUsdRevenue(new Date('2026-10-06T00:00:00.000Z'))
  assert.equal(recognized.toString(), invoice.usdMicro, 'revenue booked exactly once')
  assert.equal((await invoices.find(invoice.id))!.status, 'paid')
  assert.equal((await deps.signorum.history({ animaId: ANIMA })).length, 0)
})

test('an unsigned delivery pays nothing', async () => {
  const { invoice, invoices, deps } = await payFixture()
  const res = await deliver(deps, paidSession(invoice.id, 'pi_inv_1'), 'forged')

  assert.equal(res.status, 400)
  assert.equal(await deps.redituum.findByChargeRef('pi_inv_1'), null)
  assert.equal((await invoices.find(invoice.id))!.status, 'open')
})

test('a payment naming an unknown invoice books nothing', async () => {
  const { deps } = await payFixture()
  const res = await deliver(deps, paidSession('invoice-that-does-not-exist', 'pi_inv_9'))
  assert.equal(res.status, 400)
  assert.equal(await deps.redituum.findByChargeRef('pi_inv_9'), null)
})

test('a payment naming an invoice that belongs to another account is refused', async () => {
  const { invoice, invoices, deps } = await payFixture()
  const res = await deliver(deps, paidSession(invoice.id, 'pi_inv_2', 'anima-someone-else'))
  assert.equal(res.status, 400)
  assert.equal((await invoices.find(invoice.id))!.status, 'open')
})

test('a SECOND, different charge against a paid invoice is refused and not double-stamped', async () => {
  const { invoice, invoices, deps } = await payFixture()
  await deliver(deps, paidSession(invoice.id, 'pi_inv_1'))
  const res = await deliver(deps, paidSession(invoice.id, 'pi_inv_2'))

  assert.equal(res.status, 400, 'the delivery is refused, so Stripe stops retrying a call that cannot succeed')
  const paid = (await invoices.find(invoice.id))!
  assert.equal(paid.chargeRef, 'pi_inv_1', 'the invoice still names the charge that actually settled it')
  assert.equal((await deps.signorum.history({ animaId: ANIMA })).length, 0)
})

test('the pack rail is untouched: a payment carrying a packId still credits, in the same handler', async () => {
  // The fork is one `if`, and this is the other side of it — asserted here so a change that
  // routes everything down the invoice branch fails in the file that describes the invoice branch.
  const { deps } = await payFixture()
  const res = await deliver(deps, {
    id: 'evt_pack',
    type: 'checkout.session.completed',
    data: {
      object: {
        client_reference_id: ANIMA,
        metadata: { packId: 'starter_10', animaId: ANIMA },
        payment_intent: 'pi_pack_1',
        payment_status: 'paid',
      },
    },
  })
  assert.equal(res.status, 200)
  assert.equal((await deps.signorum.balance({ animaId: ANIMA })).toString(), '20800', 'the pack credited as it always did')
})
