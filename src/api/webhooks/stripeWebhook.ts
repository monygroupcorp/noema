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
//   · At-most-one credit per payment under redelivery/concurrency — a DURABLE, CROSS-INSTANCE
//     guard, not an in-process claim. Two indexes carry it: a unique PARTIAL index on
//     `Signum.testis` (scoped to auctor:'stripe:purchase') and a unique PARTIAL index on
//     `Reditus.chargeRef` (scoped to origo:'fiat'). The idempotency key is the Stripe
//     payment_intent id — SHARED by a purchase's two events (checkout.session.completed +
//     payment_intent.succeeded), so keying on it collapses both (and any redelivery, from any
//     instance) to ONE credit + ONE Reditus. When two instances race, the second `issue`/`record`
//     hits the unique index → dup-key error → the helper replays the original outcome (no second
//     credit, no second revenue row). A pre-read of the ledger is only an optimization; the
//     unique index is the real guard (a read-then-write alone is a race).
//
// The Stripe SDK is behind the `StripeGateway` port — the real impl wraps `stripe`; tests
// inject a fake, so no live key is needed to verify (real keys are go-live config).
// =============================================================================

import type { Signorum, Signum } from '../../types/significandi.js'
import type { Redituum } from '../../types/reditus.js'
import type { AnimaStore } from '../../types/anima.js'
import { resolvePack, type CreditPack } from '../../ledger/stripePacks.js'
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
  /**
   * charge/dispute: the Stripe object's own creation time (SECONDS-epoch). On a `charge.refunded`
   * event this is the CHARGE's `created` — the externally-auditable, retry-immune anchor the 14-day
   * refund window is measured against (Q4 ruling, noema-082), NOT any internal Signum/Reditus natum.
   */
  created?: number
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

/** Refund events → claw back previously-minted impetus + reverse recognized revenue (noema-082). */
const REFUND_EVENT_TYPES = new Set(['charge.refunded'])

/** Dispute events → freeze the anima's user-initiated value-outflow pending manual review (noema-082). */
const DISPUTE_EVENT_TYPES = new Set(['charge.dispute.created'])

/** The refund window (Q4): 14 days from the CHARGE's `created`. A later refund is a terminal no-op. */
const REFUND_WINDOW_MS = 14 * 24 * 60 * 60 * 1000

/** The auctor stamped on a refund clawback DEBIT — also the scope of its unique-partial testis index. */
const STRIPE_REFUND_AUCTOR = 'stripe:refund'

/**
 * The dispute-freeze alert seam — fired when a `charge.dispute.created` freezes an anima. Mirrors
 * licenseTripwire's `onThresholdBand`: the default wiring LOGS (loud), and a later consumer can wire
 * real delivery. Q-C ruling (2026-07-21): no ntfy client exists in the repo and none is built here —
 * real delivery is a follow-up. May be async.
 */
export type OnDisputeFrozen = (ev: { animaId: string; disputeEventId: string; paymentKey: string }) => void | Promise<void>

/** The default alert seam: a LOUD structured log (a chargeback is a live financial event). */
export const logDisputeFrozen: OnDisputeFrozen = (ev) => {
  log.warn('STRIPE DISPUTE — anima FROZEN (spend + purse-mint blocked) pending manual review. Wire to alerting later (no ntfy client yet, Q-C).', ev)
}

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
  /** The credit ledger. `issue` must SURFACE its dup-key error (the durable idempotency guard, used
   *  by BOTH the purchase credit and the refund clawback debit). `balance` reads the anima's current
   *  net spendable (the refund policy claws back the REMAINING balance, capped at the pack).
   *  `findByTestis` resolves the disputing/refunded anima FROM OUR OWN credit row (a real Stripe
   *  Charge/Dispute object carries no client_reference_id/metadata.animaId — round-10). */
  signorum: Pick<Signorum, 'issue' | 'history' | 'balance' | 'findByTestis'>
  /** The USD revenue book — a peer fiat `Reditus` is booked on purchase; on refund the recognized
   *  revenue is un-booked via `reverse()` (found via `findByChargeRef`), Q5/Q-B rulings. */
  redituum: Pick<Redituum, 'record' | 'reverse' | 'findByChargeRef'>
  /** Identity store — `find` gates the credit mint; `update` sets the dispute freeze flag. */
  animae: Pick<AnimaStore, 'find' | 'update'>
  gateway: StripeGateway
  /** Log-only injectable alert seam fired when a dispute freeze is SET. Unset → `logDisputeFrozen`. */
  onDisputeFrozen?: OnDisputeFrozen
}

/** The result of crediting one completed payment (fresh or replayed on redelivery). */
interface CreditOutcome {
  credited: bigint
  signumId: string
  packId: string
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

  // 2. Resolve the per-payment idempotency key (payment_intent id, then the object id). Shared by
  //    the credit, refund, and dispute paths — all three key on the SAME Stripe payment_intent.
  const obj = event.data?.object ?? {}
  const paymentKey = obj.payment_intent ?? obj.id ?? event.id

  // 3a. Completed-payment events credit a pack.
  if (CREDITING_EVENT_TYPES.has(event.type)) {
    try {
      validateCompleted(event.type, obj)
      // animaId: a checkout.session carries it as client_reference_id; a payment_intent carries it
      // only in metadata (both are server-set at checkout). packId is in metadata on both objects.
      const animaId = requireField(obj.client_reference_id ?? obj.metadata?.animaId, 'client_reference_id / metadata.animaId')
      const packId = requireField(obj.metadata?.packId, 'metadata.packId')
      const pack = resolvePack(packId)
      if (!pack) throw new StripeEventError(400, `Unknown pack '${packId}'`)

      // Credit the pack's impetus + book the peer fiat Reditus. Idempotent per payment via the
      // durable unique indexes (see creditPayment) — a redelivery/concurrent instance replays the
      // original credit rather than minting a second. A DB failure propagates (→ 500 at the
      // router) so Stripe retries the delivery; the retry is idempotent.
      const outcome = await creditPayment({ animaId, pack, paymentKey }, deps)
      log.info('stripe payment credited', { paymentKey, animaId, packId: pack.id, credited: outcome.credited.toString(), signumId: outcome.signumId })
      return { status: 200, body: { received: true, credited: outcome.credited.toString() } }
    } catch (err) {
      if (err instanceof StripeEventError) {
        log.warn('stripe webhook rejected', { paymentKey, type: event.type, message: err.message })
        return { status: err.httpStatus, body: { received: false, message: err.message } }
      }
      throw err
    }
  }

  // 3b. Refund events claw back the unspent balance + reverse the recognized revenue.
  if (REFUND_EVENT_TYPES.has(event.type)) {
    return handleRefund(event, obj, paymentKey, deps)
  }

  // 3c. Dispute events freeze the anima's user-initiated value-outflow pending manual review.
  if (DISPUTE_EVENT_TYPES.has(event.type)) {
    return handleDispute(event, paymentKey, deps)
  }

  // 4. Any other event type is acked + ignored (unchanged behavior).
  return { status: 200, body: { received: true } }
}

/** A terminal, non-error ack — a legitimate no-op (do NOT 4xx; Stripe would retry a non-2xx). */
function ack(): StripeWebhookResult {
  return { status: 200, body: { received: true } }
}

/**
 * Resolve the original `stripe:purchase` credit for a refund/dispute event. Resolves the anima FROM
 * OUR OWN LEDGER, NOT the event object: a real Stripe Charge/Dispute object carries neither
 * `client_reference_id` nor a propagated `metadata.animaId` (only the Checkout Session does, and
 * metadata does not propagate to the Charge/Dispute) — so reading the anima off the event is inert
 * in production (round-10 blocker). The original purchase credit was stamped
 * testis:'stripe:<paymentKey>' under a unique partial index, so we recover it (and its `animaId`) by
 * that key. Returns null when no matching credit exists (a refund/dispute on a pre-feature or
 * non-credit charge) — the caller then no-op-200s (nothing to claw back / freeze).
 */
async function findPurchaseCredit(
  deps: StripeWebhookDeps,
  paymentKey: string,
): Promise<Signum | null> {
  return deps.signorum.findByTestis(`stripe:${paymentKey}`)
}

/** Find this refund event's already-struck clawback debit (the replay source), or null. */
async function findRefundDebit(
  signorum: Pick<Signorum, 'history'>,
  animaId: string,
  testis: string,
): Promise<Signum | null> {
  const history = await signorum.history({ animaId })
  return history.find(s => s.auctor === STRIPE_REFUND_AUCTOR && s.testis === testis) ?? null
}

/**
 * Handle a `charge.refunded`. Claws back the UNSPENT balance (capped at the original pack amount,
 * Q1) via a SINGLE negative-valor debit signum, then reverses the proportional recognized revenue
 * (Q5). Idempotent end-to-end: the debit dedups on the unique testis@stripe:refund index and the
 * revenue reversal dedups on the unique reversalOf index, so a redelivered event self-heals without
 * double-clawing or double-reversing. Every terminal state is a 200 (a 4xx would make Stripe retry).
 */
async function handleRefund(
  event: StripeWebhookEvent,
  obj: StripeEventObject,
  paymentKey: string,
  deps: StripeWebhookDeps,
): Promise<StripeWebhookResult> {
  const credit = await findPurchaseCredit(deps, paymentKey)
  if (!credit || !credit.animaId) {
    log.warn('stripe refund: no matching stripe:purchase credit — nothing to claw back', { paymentKey })
    return ack()
  }
  const animaId = credit.animaId
  const packImpetus = credit.valor   // the full pack amount credited on purchase (no haircut)
  const debitTestis = event.id       // the refund event id is the clawback's idempotency key

  // Q4 window: anchor to the CHARGE's own `created` (Stripe seconds-epoch). A refund past 14 days is
  // a legitimate terminal no-op (log + 200), never a 4xx. Only reject when expiry is PROVABLE — an
  // event without `created` is treated as in-window (we cannot prove otherwise).
  const createdMs = typeof obj.created === 'number' ? obj.created * 1000 : undefined
  if (createdMs !== undefined && Date.now() - createdMs > REFUND_WINDOW_MS) {
    log.warn('stripe refund: outside the 14-day window (anchored to charge.created) — no clawback', { paymentKey, animaId })
    return ack()
  }

  // Determine the clawback amount. On a REDELIVERY the debit already exists — recover the amount
  // from it (NOT from the now-reduced live balance) so the proportional revenue reversal stays
  // consistent. On a fresh delivery, claw back the remaining balance capped at the pack (Q1).
  let debit = await findRefundDebit(deps.signorum, animaId, debitTestis)
  let refundAmount: bigint
  if (debit) {
    refundAmount = -debit.valor   // the debit carries the negative of what was clawed
  } else {
    const balance = await deps.signorum.balance({ animaId })
    refundAmount = balance < packImpetus ? balance : packImpetus
    if (refundAmount <= 0n) {
      log.info('stripe refund: balance fully spent — nothing to claw back (spent credits are non-refundable, Q1)', { paymentKey, animaId })
      return ack()
    }
    // SINGLE negative-valor debit (Q-A/v4): the value-change IS the dedup row, guarded by the unique
    // partial index on testis@auctor:'stripe:refund'. A concurrent/redelivered event collides →
    // catch the dup-key → replay the winner's debit (never double-claw). forma:'minted' matches the
    // purchase credit; reserve() excludes negative-valor rows, balance() nets them.
    try {
      debit = await deps.signorum.issue({
        forma: 'minted',
        animaId,
        valor: -refundAmount,
        auctor: STRIPE_REFUND_AUCTOR,
        testis: debitTestis,
      })
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        debit = await findRefundDebit(deps.signorum, animaId, debitTestis)
        if (!debit) throw err
        refundAmount = -debit.valor
      } else {
        throw err
      }
    }
    log.info('stripe refund clawed back', { paymentKey, animaId, refundAmount: refundAmount.toString(), signumId: debit.id })
  }

  // Reverse the recognized revenue (Q5), proportional to refundAmount / packImpetus of the original
  // reditus's usdFmv. Order is debit-FIRST (above), then reverse() — each half dedups independently
  // (testis index / reversalOf index), so a crash between them self-heals on redelivery.
  const originalReditus = await deps.redituum.findByChargeRef(paymentKey)
  if (originalReditus) {
    const amountMicro = (originalReditus.usdFmv * refundAmount) / packImpetus
    if (amountMicro > 0n) {
      await deps.redituum.reverse(originalReditus.id, amountMicro, `stripe-refund:${paymentKey}`)
      log.info('stripe refund: recognized revenue reversed', { paymentKey, animaId, amountMicro: amountMicro.toString(), reversalOf: originalReditus.id })
    }
  } else {
    log.warn('stripe refund: no peer Reditus found for chargeRef — revenue not reversed (pre-feature charge?)', { paymentKey, animaId })
  }

  return ack()
}

/**
 * Handle a `charge.dispute.created`. Sets the Q3 SPEND-only freeze flag on the disputing anima
 * (blocks generation spend + owned-purse mint; login + value-inflow untouched) and fires the
 * injected alert seam. Held pending manual operator review — no auto-lift. Idempotent: a redelivered
 * dispute just re-sets the flag. No matching credit → no anima to freeze → no-op-200.
 */
async function handleDispute(
  event: StripeWebhookEvent,
  paymentKey: string,
  deps: StripeWebhookDeps,
): Promise<StripeWebhookResult> {
  const credit = await findPurchaseCredit(deps, paymentKey)
  if (!credit || !credit.animaId) {
    log.warn('stripe dispute: no matching credit — cannot resolve the anima to freeze', { paymentKey })
    return ack()
  }
  const animaId = credit.animaId
  await deps.animae.update(animaId, { disputeFrozen: true })
  const alert = deps.onDisputeFrozen ?? logDisputeFrozen
  await alert({ animaId, disputeEventId: event.id, paymentKey })
  log.info('stripe dispute: anima frozen pending review', { paymentKey, animaId, disputeEventId: event.id })
  return ack()
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

/** The auctor stamped on every fiat credit — also the scope of the unique-partial testis index. */
const STRIPE_AUCTOR = 'stripe:purchase'

/**
 * A Mongo duplicate-key (E11000) error, detected structurally so this handler stays decoupled
 * from the driver (the Memory stores never throw it — their single-writer dedup is the pre-read).
 */
function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 11000
}

/** Find this payment's already-struck fiat credit (the replay source), or null. */
async function findStripeCredit(
  signorum: Pick<Signorum, 'history'>,
  animaId: string,
  testis: string,
): Promise<Signum | null> {
  const history = await signorum.history({ animaId })
  return history.find(s => s.auctor === STRIPE_AUCTOR && s.testis === testis) ?? null
}

/**
 * Credit one completed payment: the pack's impetus to the anima + a peer fiat `Reditus`.
 *
 * DURABLE, CROSS-INSTANCE IDEMPOTENCY. The credit's `testis` is `stripe:<paymentKey>` and a
 * unique PARTIAL index on (testis where auctor:'stripe:purchase') makes a second `issue` for the
 * same payment throw a dup-key error — so a concurrent second instance (or a redelivery, or the
 * purchase's other event type sharing the same payment_intent) does NOT double-mint: we catch the
 * dup-key and REPLAY the winner's credit. The pre-read below is only an optimization (and the
 * dedup path for the single-writer Memory store); the unique index is the actual guard.
 *
 * The peer `Reditus` is booked with `chargeRef = paymentKey`, deduped by its own unique partial
 * index (origo:'fiat') — so revenue can't double-book either. `record()` is always called (even on
 * a replayed credit) so the peer revenue row is present exactly once even if a prior delivery
 * crashed between the issue and the record; it is idempotent on chargeRef.
 */
async function creditPayment(
  args: { animaId: string; pack: CreditPack; paymentKey: string },
  deps: StripeWebhookDeps,
): Promise<CreditOutcome> {
  const { animaId, pack, paymentKey } = args
  const testis = `stripe:${paymentKey}`

  // Resolve the credit signum: replay a prior one if present, else mint it.
  let signum = await findStripeCredit(deps.signorum, animaId, testis)   // optimization + Memory dedup
  if (!signum) {
    // Identified-only invariant: the target anima must exist (checked only on the mint path).
    const anima = await deps.animae.find(animaId)
    if (!anima) throw new StripeEventError(400, `anima '${animaId}' not found`)

    // Mint the credit — forma:'minted' (a platform-issued, fiat-funded credit; NOT 'eth' — no ETH
    // is involved), auctor 'stripe:purchase', testis = the per-payment key. valor is the
    // SERVER-SIDE pack constant (full amount, NO haircut).
    try {
      signum = await deps.signorum.issue({
        forma: 'minted',
        animaId,
        valor: pack.impetus,
        auctor: STRIPE_AUCTOR,
        testis,
      })
    } catch (err) {
      // The durable guard fired: another instance won the race for this payment. Replay its credit.
      if (isDuplicateKeyError(err)) {
        signum = await findStripeCredit(deps.signorum, animaId, testis)
        if (!signum) throw err   // dup-key but the winner's row isn't visible — surface (unexpected)
      } else {
        throw err
      }
    }
  }

  // Book USD revenue at receipt (ADR-0013 §2/§4) — a peer of the credit. Fiat: origo:'fiat',
  // usdFmv = the pack's charge amount in micro-USD, fmvSource = the Stripe payment id (a free-form
  // audit string), chargeRef = the payment key (the dedicated idempotency key), NO depositumId.
  await deps.redituum.record({
    usdFmv: pack.usdMicro,
    fmvSource: testis,
    origo: 'fiat',
    chargeRef: paymentKey,
  })

  return { credited: pack.impetus, signumId: signum.id, packId: pack.id }
}
