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
  type OnDisputeFrozen,
} from '../../../../src/api/webhooks/stripeWebhook.js'
import { MemorySignorum } from '../../../../src/ledger/MemorySignorum.js'
import { MemoryRedituum } from '../../../../src/ledger/MemoryRedituum.js'
import { PACKS } from '../../../../src/ledger/stripePacks.js'
import { CrystalApi, type CrystalApiDeps } from '../../../../src/allocutio/api/CrystalApi.js'
import type { AuctorKey } from '../../../../src/flow/types.js'
import type { AnimaStore, Anima } from '../../../../src/types/anima.js'

// ── fakes ────────────────────────────────────────────────────────────────────

const KNOWN_ANIMA = 'anima_1'

/** A mutable AnimaStore double: `find` returns the soul (with its live `disputeFrozen`), `update`
 *  applies a patch. Backed by a Map so a dispute-freeze set via `update` is visible to a later
 *  `find` (the freeze test asserts the flag flipped). */
function makeAnimae(opts: { known?: Set<string>; frozen?: Set<string> } = {}) {
  const known = opts.known ?? new Set([KNOWN_ANIMA])
  const souls = new Map<string, Anima>()
  for (const id of known) souls.set(id, { id, disputeFrozen: opts.frozen?.has(id) ?? false } as unknown as Anima)
  const store: Pick<AnimaStore, 'find' | 'update'> = {
    find: async (id: string) => souls.get(id) ?? null,
    update: async (id, patch) => {
      const cur = souls.get(id)
      if (!cur) throw new Error(`Anima not found: ${id}`)
      const next = { ...cur, ...patch } as Anima
      souls.set(id, next)
      return next
    },
  }
  return { store, souls }
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

function makeDeps(over: { known?: Set<string>; frozen?: Set<string> } = {}) {
  const signorum = new MemorySignorum()
  const redituum = new MemoryRedituum()
  const gateway = fakeGateway()
  const { store: animae, souls } = makeAnimae({ ...(over.known ? { known: over.known } : {}), ...(over.frozen ? { frozen: over.frozen } : {}) })
  const disputeAlerts: Array<{ animaId: string; disputeEventId: string; paymentKey: string }> = []
  const onDisputeFrozen: OnDisputeFrozen = (ev) => { disputeAlerts.push(ev) }
  return {
    signorum,
    redituum,
    animae,
    gateway,
    onDisputeFrozen,
    // test-only handles (not part of StripeWebhookDeps)
    souls,
    disputeAlerts,
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

// ── refund clawback (Part B: charge.refunded → claw back unspent + reverse revenue) ───────────

function refundEvent(args: { paymentIntent: string; animaId?: string; eventId?: string; createdMsAgo?: number }): StripeWebhookEvent {
  const createdMs = args.createdMsAgo !== undefined ? Date.now() - args.createdMsAgo : Date.now()
  return {
    id: args.eventId ?? `evt_refund_${Math.random().toString(36).slice(2)}`,
    type: 'charge.refunded',
    data: { object: { payment_intent: args.paymentIntent, metadata: { animaId: args.animaId ?? KNOWN_ANIMA }, created: Math.floor(createdMs / 1000) } },
  }
}

function refundDebits(signorum: MemorySignorum, animaId = KNOWN_ANIMA) {
  return signorum.history({ animaId }).then(h => h.filter(s => s.auctor === 'stripe:refund'))
}

test('charge.refunded within 14 days, full balance → clawback = full pack, recognized revenue reversed to net zero', async () => {
  const deps = makeDeps()
  const pi = 'pi_refund_full'
  await deliver(deps, completedSession({ packId: 'starter_10', paymentIntent: pi }))
  assert.equal(await deps.signorum.balance({ animaId: KNOWN_ANIMA }), 20800n)

  const res = await deliver(deps, refundEvent({ paymentIntent: pi }))
  assert.equal(res.status, 200)
  // The full unspent pack is clawed back (a single -20800 debit nets the balance to zero).
  assert.equal(await deps.signorum.balance({ animaId: KNOWN_ANIMA }), 0n)
  const debits = await refundDebits(deps.signorum)
  assert.equal(debits.length, 1)
  assert.equal(debits[0]!.valor, -20800n)
  // Recognized revenue reversed → the trailing figure nets to zero over the window.
  assert.equal(await deps.redituum.trailingUsdRevenue(new Date(Date.now() + 60_000)), 0n)
})

test('charge.refunded with a PARTIAL balance → clawback = remaining only; revenue reversal is proportional (Q1)', async () => {
  const deps = makeDeps()
  const pi = 'pi_refund_partial'
  await deliver(deps, completedSession({ packId: 'starter_10', paymentIntent: pi }))  // 20800 impetus / $10
  // Spend exactly half (10400) via reserve→settle so 10400 remains unspent.
  const r = await deps.signorum.reserve({ animaId: KNOWN_ANIMA }, 10400n, 'spend_half')
  assert.equal(r.ok, true); if (!r.ok) return
  await deps.signorum.settle(r.signaIds, 10400n, 'spend_half')
  assert.equal(await deps.signorum.balance({ animaId: KNOWN_ANIMA }), 10400n)

  const res = await deliver(deps, refundEvent({ paymentIntent: pi }))
  assert.equal(res.status, 200)
  // Only the remaining 10400 is clawed back (the spent portion is non-refundable).
  assert.equal(await deps.signorum.balance({ animaId: KNOWN_ANIMA }), 0n)
  const debits = await refundDebits(deps.signorum)
  assert.equal(debits.length, 1)
  assert.equal(debits[0]!.valor, -10400n)
  // Revenue reversed proportionally: 10_000_000 × 10400/20800 = 5_000_000 → net 5_000_000 remains.
  assert.equal(await deps.redituum.trailingUsdRevenue(new Date(Date.now() + 60_000)), 5_000_000n)
})

test('charge.refunded with a ZERO balance remaining → no-op-200 (fully spent, nothing to claw back)', async () => {
  const deps = makeDeps()
  const pi = 'pi_refund_spent'
  await deliver(deps, completedSession({ packId: 'starter_10', paymentIntent: pi }))
  const r = await deps.signorum.reserve({ animaId: KNOWN_ANIMA }, 20800n, 'spend_all')
  assert.equal(r.ok, true); if (!r.ok) return
  await deps.signorum.settle(r.signaIds, 20800n, 'spend_all')
  assert.equal(await deps.signorum.balance({ animaId: KNOWN_ANIMA }), 0n)

  const res = await deliver(deps, refundEvent({ paymentIntent: pi }))
  assert.equal(res.status, 200)
  // No clawback debit; recognized revenue is NOT reversed (spent credits are non-refundable).
  assert.equal((await refundDebits(deps.signorum)).length, 0)
  assert.equal(await deps.redituum.trailingUsdRevenue(new Date(Date.now() + 60_000)), 10_000_000n)
})

test('a redelivered charge.refunded (same event.id) is idempotent — one debit, one reversal, no double-claw', async () => {
  const deps = makeDeps()
  const pi = 'pi_refund_dup'
  await deliver(deps, completedSession({ packId: 'standard_25', paymentIntent: pi }))
  const evt = refundEvent({ paymentIntent: pi, eventId: 'evt_refund_same' })

  await deliver(deps, evt)
  await deliver(deps, evt)   // Stripe redelivers the identical refund event

  assert.equal((await refundDebits(deps.signorum)).length, 1)   // clawed back exactly once
  assert.equal(await deps.signorum.balance({ animaId: KNOWN_ANIMA }), 0n)
  // Revenue reversed exactly once → net zero (no double-reversal into positive/negative drift).
  assert.equal(await deps.redituum.trailingUsdRevenue(new Date(Date.now() + 60_000)), 0n)
})

test('charge.refunded OUTSIDE the 14-day window (anchored to charge.created) → no-op-200, no clawback', async () => {
  const deps = makeDeps()
  const pi = 'pi_refund_late'
  await deliver(deps, completedSession({ packId: 'plus_50', paymentIntent: pi }))
  const before = await deps.signorum.balance({ animaId: KNOWN_ANIMA })

  const res = await deliver(deps, refundEvent({ paymentIntent: pi, createdMsAgo: 15 * 24 * 60 * 60 * 1000 }))
  assert.equal(res.status, 200)   // terminal no-op, NOT a 4xx (Stripe would retry a non-2xx)
  assert.equal(await deps.signorum.balance({ animaId: KNOWN_ANIMA }), before)
  assert.equal((await refundDebits(deps.signorum)).length, 0)
})

test('charge.refunded with no matching prior credit → 200 no-op (nothing to claw back)', async () => {
  const deps = makeDeps()
  const res = await deliver(deps, refundEvent({ paymentIntent: 'pi_never_credited' }))
  assert.equal(res.status, 200)
  assert.equal((await refundDebits(deps.signorum)).length, 0)
})

test('trailingUsdRevenue nets a reversal so the Krea/Stability cap reads the post-refund figure (Q5)', async () => {
  const deps = makeDeps()
  await deliver(deps, completedSession({ packId: 'starter_10', paymentIntent: 'pi_keep' }))     // $10
  await deliver(deps, completedSession({ packId: 'standard_25', paymentIntent: 'pi_gone' }))    // $25
  const gross = await deps.redituum.trailingUsdRevenue(new Date(Date.now() + 60_000))
  assert.equal(gross, PACKS.starter_10.usdMicro + PACKS.standard_25.usdMicro)   // 35_000_000

  await deliver(deps, refundEvent({ paymentIntent: 'pi_gone' }))   // full refund of the $25
  const net = await deps.redituum.trailingUsdRevenue(new Date(Date.now() + 60_000))
  assert.equal(net, PACKS.starter_10.usdMicro)   // only the un-refunded $10 is recognized
})

// ── dispute freeze (Part B: charge.dispute.created → freeze spend + alert) ────────────────────

function disputeEvent(args: { paymentIntent: string; animaId?: string; eventId?: string }): StripeWebhookEvent {
  return {
    id: args.eventId ?? `evt_dispute_${Math.random().toString(36).slice(2)}`,
    type: 'charge.dispute.created',
    data: { object: { payment_intent: args.paymentIntent, metadata: { animaId: args.animaId ?? KNOWN_ANIMA } } },
  }
}

test('charge.dispute.created → sets disputeFrozen on the anima + invokes the injected alert seam (200)', async () => {
  const deps = makeDeps()
  const pi = 'pi_dispute'
  await deliver(deps, completedSession({ packId: 'starter_10', paymentIntent: pi }))
  assert.equal((await deps.animae.find(KNOWN_ANIMA))?.disputeFrozen ?? false, false)

  const res = await deliver(deps, disputeEvent({ paymentIntent: pi, eventId: 'evt_dispute_1' }))
  assert.equal(res.status, 200)
  // The soul is now frozen.
  assert.equal((await deps.animae.find(KNOWN_ANIMA))?.disputeFrozen, true)
  // The alert seam FIRED (we assert it was called + its payload, NOT any real delivery).
  assert.equal(deps.disputeAlerts.length, 1)
  assert.equal(deps.disputeAlerts[0]?.animaId, KNOWN_ANIMA)
  assert.equal(deps.disputeAlerts[0]?.disputeEventId, 'evt_dispute_1')
})

test("a frozen anima's SPEND is rejected (auth.forbidden) while a non-frozen anima passes the freeze gate (login is never gated)", async () => {
  const { store: animae } = makeAnimae({ known: new Set([KNOWN_ANIMA, 'anima_ok']), frozen: new Set([KNOWN_ANIMA]) })
  // The freeze guard runs at the TOP of invokeFlow, BEFORE any other dep is used — so a minimal
  // CrystalApi (only `animae` wired) exercises exactly the spend-gate this item adds.
  const api = new CrystalApi({ animae } as unknown as CrystalApiDeps)

  const frozen: AuctorKey = { animaId: KNOWN_ANIMA }
  await assert.rejects(
    () => api.invokeFlow(frozen, { verb: 'make' }, { prompt: 'hi' }),
    (err: unknown) => (err as { code?: string }).code === 'auth.forbidden',
  )
  // A non-frozen anima passes the freeze gate and fails LATER (unresolvable verb) — proving the
  // block is freeze-conditional, not a blanket denial. Login/identity reads are never gated here.
  const ok: AuctorKey = { animaId: 'anima_ok' }
  await assert.rejects(
    () => api.invokeFlow(ok, { verb: 'definitely-not-a-canon-verb' }, {}),
    (err: unknown) => (err as { code?: string }).code === 'not_found.flow',
  )
  // The frozen soul is still readable (its identity/login surface is untouched by the freeze).
  assert.equal((await animae.find(KNOWN_ANIMA))?.disputeFrozen, true)
})

test("a SYSTEM transfer (signorum.reserve) for a frozen anima still settles — reserve is freeze-blind by design", async () => {
  // Freeze-boundary ruling 2026-07-22: the freeze gates USER-initiated outflow only, checked at the
  // named chokepoints — NEVER inside signorum.reserve, which serves system paths (SubsidySweeper,
  // AgentProvisioner, treasuryAdmin). This regression-guards that: if anyone ever adds a freeze check
  // INSIDE reserve, this system-path settle would start failing for a frozen anima.
  const deps = makeDeps({ frozen: new Set([KNOWN_ANIMA]) })
  await deliver(deps, completedSession({ packId: 'starter_10', paymentIntent: 'pi_sys' }))  // fund 20800
  assert.equal((await deps.animae.find(KNOWN_ANIMA))?.disputeFrozen, true)

  // A system/SubsidySweeper transfer reserves + settles against the frozen anima — must succeed.
  const r = await deps.signorum.reserve({ animaId: KNOWN_ANIMA }, 5000n, 'system_transfer')
  assert.equal(r.ok, true); if (!r.ok) return
  await deps.signorum.settle(r.signaIds, 5000n, 'system_transfer')
  assert.equal(await deps.signorum.balance({ animaId: KNOWN_ANIMA }), 15800n)  // freeze did not block it
})

test("a frozen anima is BLOCKED (auth.forbidden) at every Collections chokepoint — collect / fireCollection / resumeCollection (freeze-boundary v2)", async () => {
  // Freeze-boundary v2 (2026-07-22, "freeze all money lines"): the dispute freeze gates the ENTIRE
  // Collections path — collect() (dispatches unless drafted), fireCollection() (dispatches the run),
  // and resumeCollection() (resume triggers new spends) — not just invokeFlow + owned-purse mint.
  // Each method gates the freeze at its TOP, before any other dep is touched, so a minimal CrystalApi
  // (only `animae` wired) exercises exactly the spend-gate this item adds.
  const { store: animae } = makeAnimae({ known: new Set([KNOWN_ANIMA, 'anima_ok']), frozen: new Set([KNOWN_ANIMA]) })
  const api = new CrystalApi({ animae } as unknown as CrystalApiDeps)
  const frozen: AuctorKey = { animaId: KNOWN_ANIMA }
  const isForbidden = (err: unknown) => (err as { code?: string }).code === 'auth.forbidden'

  await assert.rejects(() => api.collect(frozen, {} as Parameters<CrystalApi['collect']>[1]), isForbidden)
  await assert.rejects(() => api.fireCollection(frozen, 'col_1'), isForbidden)
  await assert.rejects(() => api.resumeCollection(frozen, 'col_1'), isForbidden)

  // A non-frozen anima passes the freeze gate and fails LATER (collections deps absent →
  // not_found.collection), proving the block is freeze-conditional, not a blanket denial. Login and
  // identity reads are never routed through this gate.
  const ok: AuctorKey = { animaId: 'anima_ok' }
  await assert.rejects(
    () => api.collect(ok, {} as Parameters<CrystalApi['collect']>[1]),
    (err: unknown) => (err as { code?: string }).code === 'not_found.collection',
  )
  assert.equal((await animae.find(KNOWN_ANIMA))?.disputeFrozen, true)
})
