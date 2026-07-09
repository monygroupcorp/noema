// =============================================================================
// stripeWebhook — the fiat (Stripe) funding rail: checkout + signature-verified webhook
// =============================================================================
//
// The fiat analogue of `alchemyWebhook.ts` (the crypto deposit boundary). Two entry points:
//
//   handleStripeCheckout — an IDENTIFIED caller picks a credit pack → a Stripe Checkout
//     Session is created (`client_reference_id = animaId`, packId in metadata, the pack's
//     USD price as the line item). Returns the hosted-checkout URL. A fiat pack can only
//     fund an identified account (a card de-anonymizes by construction) — an anon caller
//     is rejected.
//
//   handleStripeWebhook — Stripe → server, signature-gated. On a completed payment
//     (`checkout.session.completed` / `payment_intent.succeeded`) it credits the pack's
//     impetus to the anima and books a peer fiat `Reditus` (revenue at receipt, ADR-0013
//     §2/§4). IDEMPOTENT on the payment key: Stripe redelivers, and one purchase emits two
//     events sharing a payment_intent — both collapse to a SINGLE credit.
//
// SECURITY INVARIANTS (the gauntlet's focus):
//   · No credit without a signature-verified event — a bad/unsigned webhook is rejected (400).
//   · No credit from a non-completed payment — the event must actually be paid.
//   · The credited amount is the SERVER-SIDE pack constant keyed by the server-set packId,
//     never a client-supplied figure.
//   · At-most-one credit per payment under redelivery — the atomic `StripeEventStore` claim
//     (fast, in-process) plus the durable `Signum.testis` ledger check (survives restart /
//     another instance) together prevent a double-credit and a double-`Reditus`.
//
// The Stripe SDK is behind the `StripeGateway` port — the real impl wraps `stripe`; tests
// inject a fake, so no live key is needed to verify (real keys are go-live config).
// =============================================================================

import type { Signorum } from '../../types/significandi.js'
import type { Redituum } from '../../types/reditus.js'
import type { AnimaStore } from '../../types/anima.js'
import { resolvePack, type CreditPack } from '../../ledger/stripePacks.js'
import type { StripeEventStore, StripeEventOutcome } from '../../ledger/StripeEventStore.js'
import { makeLogger } from '../../lib/logger.js'

const log = makeLogger('stripe-webhook')

// ---------------------------------------------------------------------------
// The Stripe port — the minimal SDK surface the rail depends on (fake-able in tests)
// ---------------------------------------------------------------------------

/** Inputs to open a hosted Checkout Session for a pack. */
export interface StripeCheckoutInput {
  packId: string
  animaId: string
  /** Line-item price in cents (the pack's USD × 100). Server-authoritative. */
  amountCents: number
  /** Line-item label shown on the Stripe checkout page. */
  label: string
  successUrl?: string
  cancelUrl?: string
}

/** A created Checkout Session — the id + the hosted URL to redirect the buyer to. */
export interface StripeCheckoutSession {
  id: string
  url: string
}

/** The verified webhook event fields the rail consumes (a subset of the Stripe event). */
export interface StripeWebhookEvent {
  id: string
  type: string
  data: { object: StripeEventObject }
}

/** The event's `data.object` — a checkout.session or a payment_intent (overlapping fields). */
export interface StripeEventObject {
  /** The object's own id (a payment_intent's id, when the object IS the PI). */
  id?: string
  /** checkout.session: the animaId we set as `client_reference_id`. */
  client_reference_id?: string | null
  /** checkout.session: `{ packId }` set server-side at session creation. */
  metadata?: Record<string, string> | null
  /** checkout.session: the linked PaymentIntent id (the per-purchase idempotency key). */
  payment_intent?: string | null
  /** checkout.session: 'paid' once the payment settled. */
  payment_status?: string | null
  /** payment_intent: 'succeeded' once captured. */
  status?: string | null
}

/**
 * The port the rail talks to. The real impl wraps the `stripe` SDK (bound to the secret key +
 * endpoint secret from env); tests inject a fake. `constructWebhookEvent` MUST throw on an
 * invalid or absent signature — that is the authentication boundary.
 */
export interface StripeGateway {
  createCheckoutSession(input: StripeCheckoutInput): Promise<StripeCheckoutSession>
  /** Verify `stripe-signature` against the endpoint secret; THROWS on an invalid/absent signature. */
  constructWebhookEvent(rawBody: string, signature: string | undefined): StripeWebhookEvent
}

// ---------------------------------------------------------------------------
// Checkout
// ---------------------------------------------------------------------------

export interface StripeCheckoutRequest {
  packId: unknown
  /** The caller's animaId — resolved from identity; `undefined` for an anonymous caller. */
  animaId: string | undefined
  successUrl?: string
  cancelUrl?: string
}

export type StripeCheckoutResult =
  | { ok: true; url: string; sessionId: string }
  | { ok: false; status: 400 | 401; code: string; message: string }

export interface StripeCheckoutDeps {
  gateway: StripeGateway
}

/**
 * Create a Checkout Session for a pack. Identified-only (a fiat pack cannot fund an anon
 * purse). The amount + packId are server-set, so the webhook credits a server-authoritative
 * constant regardless of anything the client sends.
 */
export async function handleStripeCheckout(
  req: StripeCheckoutRequest,
  deps: StripeCheckoutDeps,
): Promise<StripeCheckoutResult> {
  if (!req.animaId) {
    return { ok: false, status: 401, code: 'payments.identity_required', message: 'A fiat pack can only fund an identified account — sign in first (you cannot card-fund anonymously).' }
  }
  if (typeof req.packId !== 'string' || !req.packId) {
    return { ok: false, status: 400, code: 'payments.pack_required', message: 'packId is required' }
  }
  const pack = resolvePack(req.packId)
  if (!pack) {
    return { ok: false, status: 400, code: 'payments.unknown_pack', message: `Unknown pack '${req.packId}'` }
  }
  const session = await deps.gateway.createCheckoutSession({
    packId: pack.id,
    animaId: req.animaId,
    amountCents: pack.amountCents,
    label: pack.label,
    ...(req.successUrl ? { successUrl: req.successUrl } : {}),
    ...(req.cancelUrl ? { cancelUrl: req.cancelUrl } : {}),
  })
  return { ok: true, url: session.url, sessionId: session.id }
}

// ---------------------------------------------------------------------------
// Webhook
// ---------------------------------------------------------------------------

/** Event types that credit a pack. Both share a payment_intent for one purchase (deduped to one credit). */
const CREDITING_EVENT_TYPES = new Set(['checkout.session.completed', 'payment_intent.succeeded'])

export interface StripeWebhookRequest {
  /** The exact raw request body (bytes as received) — required for signature verification. */
  rawBody: string
  /** The `stripe-signature` header. */
  signature?: string
}

export interface StripeWebhookResult {
  status: 200 | 400
  body: { received: boolean; credited?: string; message?: string }
}

export interface StripeWebhookDeps {
  signorum: Signorum
  /** The USD revenue book — a peer fiat `Reditus` is booked at the charge amount. */
  redituum: Pick<Redituum, 'record'>
  animae: Pick<AnimaStore, 'find'>
  /** The idempotency claim store (keyed on the payment key). */
  stripeEvents: StripeEventStore
  gateway: StripeGateway
}

/** A structurally-bad or non-creditable event — carries the HTTP status to return. */
class StripeEventError extends Error {
  constructor(readonly httpStatus: 400, message: string) {
    super(message)
  }
}

/**
 * Handle a Stripe webhook delivery. Signature-gated; idempotent per payment. Returns 400 for
 * a bad signature or a structurally-invalid/non-completed event (never credits), 200 otherwise.
 */
export async function handleStripeWebhook(
  req: StripeWebhookRequest,
  deps: StripeWebhookDeps,
): Promise<StripeWebhookResult> {
  // 1. Authenticate: verify the signature. A bad/unsigned body is rejected — no credit path.
  let event: StripeWebhookEvent
  try {
    event = deps.gateway.constructWebhookEvent(req.rawBody, req.signature)
  } catch (err) {
    log.warn('stripe webhook signature verification failed', { message: err instanceof Error ? err.message : String(err) })
    return { status: 400, body: { received: false, message: 'Invalid signature' } }
  }

  // 2. Only completed-payment events credit; everything else is acked + ignored.
  if (!CREDITING_EVENT_TYPES.has(event.type)) {
    return { status: 200, body: { received: true } }
  }

  // 3. Resolve the per-purchase idempotency key (payment_intent id, then the object id).
  const obj = event.data?.object ?? {}
  const paymentKey = obj.payment_intent ?? obj.id ?? event.id

  try {
    validateCompleted(event.type, obj)
    // animaId: a checkout.session carries it as client_reference_id; a payment_intent carries it
    // only in metadata (both are server-set at checkout). packId is in metadata on both objects.
    const animaId = requireField(obj.client_reference_id ?? obj.metadata?.animaId, 'client_reference_id / metadata.animaId')
    const packId = requireField(obj.metadata?.packId, 'metadata.packId')
    const pack = resolvePack(packId)
    if (!pack) throw new StripeEventError(400, `Unknown pack '${packId}'`)

    // 4. Atomic in-process claim (fast dedup gate for concurrent redeliveries).
    const claim = await deps.stripeEvents.claim(paymentKey)
    if (claim === 'in_flight') {
      // Another delivery is crediting this same payment right now — do not double-credit.
      return { status: 200, body: { received: true } }
    }
    if (typeof claim === 'object') {
      // Already fully processed — replay the original outcome (no new credit, no new Reditus).
      return { status: 200, body: { received: true, credited: claim.done.credited.toString() } }
    }

    // claim === 'claimed' → first delivery for this payment.
    try {
      const outcome = await creditPayment({ animaId, pack, paymentKey }, deps)
      await deps.stripeEvents.finish(paymentKey, outcome)
      log.info('stripe payment credited', { paymentKey, animaId, packId: pack.id, credited: outcome.credited.toString(), signumId: outcome.signumId })
      return { status: 200, body: { received: true, credited: outcome.credited.toString() } }
    } catch (err) {
      // Release the claim so a redelivery retries. The durable `Signum.testis` check inside
      // creditPayment ensures a partial-then-retried delivery can't double-credit.
      await deps.stripeEvents.abort(paymentKey)
      throw err
    }
  } catch (err) {
    if (err instanceof StripeEventError) {
      log.warn('stripe webhook rejected', { paymentKey, type: event.type, message: err.message })
      return { status: err.httpStatus, body: { received: false, message: err.message } }
    }
    throw err
  }
}

/** Throw unless the event represents a genuinely-completed (paid) payment. */
function validateCompleted(type: string, obj: StripeEventObject): void {
  if (type === 'checkout.session.completed') {
    // A session can complete without payment (e.g. async/failed) — require the paid status.
    if (obj.payment_status && obj.payment_status !== 'paid') {
      throw new StripeEventError(400, `checkout.session not paid (payment_status='${obj.payment_status}')`)
    }
    return
  }
  // payment_intent.succeeded — the type itself is terminal-success, but re-assert if present.
  if (obj.status && obj.status !== 'succeeded') {
    throw new StripeEventError(400, `payment_intent not succeeded (status='${obj.status}')`)
  }
}

function requireField(value: string | null | undefined, name: string): string {
  if (!value) throw new StripeEventError(400, `Stripe event missing ${name}`)
  return value
}

/**
 * Credit one completed payment: the pack's impetus to the anima + a peer fiat `Reditus`.
 * DURABLE IDEMPOTENCY: before issuing, the ledger is checked for an existing
 * `stripe:<paymentKey>` credit — so a partial-then-retried delivery (or another instance)
 * returns the original credit instead of minting a second. The signum is issued BEFORE the
 * Reditus so a crash between them can only UNDER-count revenue (safe), never double-credit.
 */
async function creditPayment(
  args: { animaId: string; pack: CreditPack; paymentKey: string },
  deps: StripeWebhookDeps,
): Promise<StripeEventOutcome> {
  const { animaId, pack, paymentKey } = args
  const testis = `stripe:${paymentKey}`

  // Durable dedup backstop: has this exact payment already been credited on the ledger?
  const prior = (await deps.signorum.history({ animaId }))
    .find(s => s.auctor === 'stripe:purchase' && s.testis === testis)
  if (prior) {
    return { credited: pack.impetus, signumId: prior.id, packId: pack.id }
  }

  // Identified-only invariant: the target anima must exist.
  const anima = await deps.animae.find(animaId)
  if (!anima) throw new StripeEventError(400, `anima '${animaId}' not found`)

  // Issue the credit — forma reuses the deposit path ('eth'), auctor 'stripe:purchase', testis
  // = the per-payment key. valor is the SERVER-SIDE pack constant (full amount, NO haircut).
  const signum = await deps.signorum.issue({
    forma: 'eth',
    animaId,
    valor: pack.impetus,
    auctor: 'stripe:purchase',
    testis,
  })

  // Book USD revenue at receipt (ADR-0013 §2/§4) — a peer of the credit. Fiat: origo:'fiat',
  // usdFmv = the charge amount directly, fmvSource = the Stripe payment id, NO depositumId.
  await deps.redituum.record({
    usdFmv: pack.usdMicro,
    fmvSource: testis,
    origo: 'fiat',
  })

  return { credited: pack.impetus, signumId: signum.id, packId: pack.id }
}
