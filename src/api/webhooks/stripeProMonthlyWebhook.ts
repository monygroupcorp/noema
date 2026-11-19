// =============================================================================
// stripeProMonthlyWebhook -- the Pro Monthly subscription rail (Option B, card fkhqv3)
// =============================================================================
//
// The recurring-subscription analogue of stripeWebhook.ts (the one-time pack rail). Three
// entry points:
//
//   handleProMonthlyCheckout -- an IDENTIFIED caller opens a Checkout Session in `mode:
//     'subscription'` for the Pro Monthly plan. Identified-only, same as a pack (a card
//     de-anonymizes by construction).
//
//   handleProMonthlyWebhook -- Stripe -> server, signature-gated:
//     - `checkout.session.completed` (mode: subscription) activates the subscription record
//       (maps stripeSubscriptionId -> animaId). No credit here -- the grant always comes from
//       `invoice.paid`, so the first cycle and every renewal share one crediting path.
//     - `invoice.paid` grants this cycle's impetus allowance, capped by the fair-use rollover
//       cap (`proMonthlyRenewalGrant`). Idempotent per invoice.
//     - `customer.subscription.deleted` marks the subscription canceled -- no later `invoice.paid`
//       for it grants anything (checked at grant time, not just at cancellation time, so an
//       out-of-order redelivery can't re-open a closed subscription).
//
// IDENTITY RESOLUTION (round-10 lesson from the pack rail's refund/dispute path, reapplied up
// front here rather than discovered the same way twice): a Stripe `invoice` or `subscription`
// object carries NEITHER `client_reference_id` NOR a reliably-propagated `metadata.animaId` --
// only the Checkout Session does. So the animaId is resolved from OUR OWN subscription record
// (keyed by `stripeSubscriptionId`, set at `checkout.session.completed`), never from the later
// event's own fields.
//
// SECURITY INVARIANTS (mirrors the pack rail):
//   - No activation without a signature-verified event.
//   - The granted amount is ALWAYS `proMonthlyRenewalGrant` over the server-side `PRO_MONTHLY`
//     constant + the subscriber's own ledger balance -- never a client-supplied figure.
//   - At-most-one grant per invoice: testis `stripe:promonthly:<invoiceId>`, auctor
//     'stripe:subscription', guarded by a unique PARTIAL index on that auctor (see
//     ensureIndexes.ts) -- the same durable, cross-instance pattern as 'stripe:purchase'.
// =============================================================================

import { type Signorum } from '../../types/significandi.js'
import { PRO_MONTHLY, proMonthlyRenewalGrant } from '../../ledger/stripePacks.js'
import { makeLogger } from '../../lib/logger.js'

const log = makeLogger('stripe-promonthly-webhook')

// ---------------------------------------------------------------------------
// The subscription record store
// ---------------------------------------------------------------------------

export type ProMonthlySubscriptionStatus = 'active' | 'canceled'

/** One Pro Monthly subscription -- the durable map from a Stripe subscription to its anima. */
export interface ProMonthlySubscriptionRecord {
  id: string
  animaId: string
  stripeSubscriptionId: string
  status: ProMonthlySubscriptionStatus
  natum: Date
  canceledAt?: Date
}

/**
 * ProMonthlySubscriptions -- the store this rail depends on. One implementation: Mongo
 * (`MongoProMonthlySubscriptions`); `MemoryProMonthlySubscriptions` backs tests.
 */
export interface ProMonthlySubscriptionStore {
  /** Idempotent; call once at wiring (mirrors MongoLinkToken/MongoMandatum). The Memory test
   *  double has nothing to create and leaves this absent. */
  ensureIndexes?(): Promise<void>
  /** Idempotent upsert keyed on `stripeSubscriptionId` -- safe to call on every redelivery of
   *  `checkout.session.completed`. Re-activates a previously-canceled row (a resubscribe reuses
   *  the same Stripe subscription id only in edge cases; the common case is a fresh id, a fresh
   *  row). */
  activate(input: { animaId: string; stripeSubscriptionId: string }): Promise<ProMonthlySubscriptionRecord>
  findBySubscriptionId(stripeSubscriptionId: string): Promise<ProMonthlySubscriptionRecord | null>
  /** No-op if already canceled (idempotent under redelivery). */
  cancel(stripeSubscriptionId: string): Promise<void>
}

// ---------------------------------------------------------------------------
// The Stripe port -- the minimal SDK surface this rail depends on (fake-able in tests)
// ---------------------------------------------------------------------------

export interface ProMonthlyCheckoutInput {
  animaId: string
  amountCents: number
  label: string
  successUrl?: string
  cancelUrl?: string
}

export interface ProMonthlyCheckoutSession {
  id: string
  url: string
}

export interface ProMonthlyWebhookEvent {
  id: string
  type: string
  data: { object: ProMonthlyEventObject }
}

/** The event's `data.object` -- a checkout.session, an invoice, or a subscription (overlapping
 *  fields, only the ones this rail reads). */
export interface ProMonthlyEventObject {
  /** The object's own id (an invoice id, when the object IS the invoice). */
  id?: string
  /** checkout.session (mode: subscription): the animaId we set as `client_reference_id`. */
  client_reference_id?: string | null
  /** checkout.session: the created Subscription's id. */
  subscription?: string | null
  /** invoice: the Subscription id this invoice bills. */
  // (Stripe's real Invoice also exposes `subscription`; reusing the same field name keeps this
  // port's object shape a single flat type instead of a union the handler has to narrow.)
  status?: string | null
}

export interface ProMonthlyGateway {
  createSubscriptionCheckoutSession(input: ProMonthlyCheckoutInput): Promise<ProMonthlyCheckoutSession>
  /** Verify `stripe-signature` against the endpoint secret; THROWS on an invalid/absent signature. */
  constructWebhookEvent(rawBody: string, signature: string | undefined): ProMonthlyWebhookEvent
}

// ---------------------------------------------------------------------------
// Checkout
// ---------------------------------------------------------------------------

export interface ProMonthlyCheckoutRequest {
  /** The caller's animaId -- resolved from identity; `undefined` for an anonymous caller. */
  animaId: string | undefined
  successUrl?: string
  cancelUrl?: string
}

export type ProMonthlyCheckoutResult =
  | { ok: true; url: string; sessionId: string }
  | { ok: false; status: 400 | 401; code: string; message: string }

export interface ProMonthlyCheckoutDeps {
  gateway: ProMonthlyGateway
}

/**
 * Open a Checkout Session for the Pro Monthly plan. Identified-only -- same invariant as a
 * fiat credit pack (a card de-anonymizes by construction).
 */
export async function handleProMonthlyCheckout(
  req: ProMonthlyCheckoutRequest,
  deps: ProMonthlyCheckoutDeps,
): Promise<ProMonthlyCheckoutResult> {
  if (!req.animaId) {
    return { ok: false, status: 401, code: 'payments.identity_required', message: 'Pro Monthly can only fund an identified account — sign in first (you cannot card-fund anonymously).' }
  }
  const session = await deps.gateway.createSubscriptionCheckoutSession({
    animaId: req.animaId,
    amountCents: PRO_MONTHLY.amountCents,
    label: PRO_MONTHLY.label,
    ...(req.successUrl ? { successUrl: req.successUrl } : {}),
    ...(req.cancelUrl ? { cancelUrl: req.cancelUrl } : {}),
  })
  return { ok: true, url: session.url, sessionId: session.id }
}

// ---------------------------------------------------------------------------
// Webhook
// ---------------------------------------------------------------------------

/** The auctor stamped on every Pro Monthly grant -- also the scope of the unique-partial testis
 *  index (ensureIndexes.ts, mirroring 'stripe:purchase'/'stripe:refund'). */
const STRIPE_SUBSCRIPTION_AUCTOR = 'stripe:subscription'

export interface ProMonthlyWebhookRequest {
  /** The exact raw request body (bytes as received) -- required for signature verification. */
  rawBody: string
  signature?: string
}

export interface ProMonthlyWebhookResult {
  status: 200 | 400
  body: { received: boolean; granted?: string; throttled?: boolean; message?: string }
}

export interface ProMonthlyWebhookDeps {
  /** `issue` must SURFACE its dup-key error (the durable idempotency guard); `balance` reads the
   *  subscriber's current spendable impetus (the fair-use cap input). */
  signorum: Pick<Signorum, 'issue' | 'history' | 'balance'>
  subscriptions: ProMonthlySubscriptionStore
  gateway: ProMonthlyGateway
}

class ProMonthlyEventError extends Error {
  constructor(readonly httpStatus: 400, message: string) {
    super(message)
  }
}

function ack(): ProMonthlyWebhookResult {
  return { status: 200, body: { received: true } }
}

/**
 * Handle a Pro Monthly webhook delivery. Signature-gated. Returns 400 for a bad signature or a
 * structurally-invalid event (never grants), 200 otherwise.
 */
export async function handleProMonthlyWebhook(
  req: ProMonthlyWebhookRequest,
  deps: ProMonthlyWebhookDeps,
): Promise<ProMonthlyWebhookResult> {
  let event: ProMonthlyWebhookEvent
  try {
    event = deps.gateway.constructWebhookEvent(req.rawBody, req.signature)
  } catch (err) {
    log.warn('promonthly webhook signature verification failed', { message: err instanceof Error ? err.message : String(err) })
    return { status: 400, body: { received: false, message: 'Invalid signature' } }
  }

  const obj = event.data?.object ?? {}

  if (event.type === 'checkout.session.completed') {
    try {
      const animaId = requireField(obj.client_reference_id, 'client_reference_id')
      const stripeSubscriptionId = requireField(obj.subscription, 'subscription')
      const record = await deps.subscriptions.activate({ animaId, stripeSubscriptionId })
      log.info('promonthly subscription activated', { animaId, stripeSubscriptionId: record.stripeSubscriptionId })
      return ack()
    } catch (err) {
      if (err instanceof ProMonthlyEventError) {
        log.warn('promonthly webhook rejected', { type: event.type, message: err.message })
        return { status: err.httpStatus, body: { received: false, message: err.message } }
      }
      throw err
    }
  }

  if (event.type === 'invoice.paid') {
    return handleInvoicePaid(obj, deps)
  }

  if (event.type === 'customer.subscription.deleted') {
    const stripeSubscriptionId = obj.id ?? obj.subscription
    if (stripeSubscriptionId) {
      await deps.subscriptions.cancel(stripeSubscriptionId)
      log.info('promonthly subscription canceled', { stripeSubscriptionId })
    }
    return ack()
  }

  // Any other event type is acked + ignored (unchanged behavior).
  return ack()
}

/**
 * Grant one billed cycle. Resolves the subscriber from OUR OWN subscription record (never from
 * the invoice event itself -- see the module header). A canceled subscription, or one this rail
 * never saw activated, grants nothing (200 no-op, not a 4xx -- a legitimate terminal state).
 * Idempotent on `testis = stripe:promonthly:<invoiceId>` under the unique partial index.
 */
async function handleInvoicePaid(
  obj: ProMonthlyEventObject,
  deps: ProMonthlyWebhookDeps,
): Promise<ProMonthlyWebhookResult> {
  const invoiceId = obj.id
  const stripeSubscriptionId = obj.subscription
  if (!invoiceId || !stripeSubscriptionId) {
    log.warn('promonthly invoice.paid missing id/subscription — nothing to grant', { invoiceId, stripeSubscriptionId })
    return ack()
  }

  const record = await deps.subscriptions.findBySubscriptionId(stripeSubscriptionId)
  if (!record || record.status !== 'active') {
    log.warn('promonthly invoice.paid: no active subscription record — nothing granted', { invoiceId, stripeSubscriptionId })
    return ack()
  }

  const testis = `stripe:promonthly:${invoiceId}`

  // Replay a prior grant if this invoice was already credited (optimization + Memory-store
  // dedup; the Mongo unique partial index is the real cross-instance guard).
  const existing = await findSubscriptionGrant(deps.signorum, record.animaId, testis)
  if (existing) {
    return { status: 200, body: { received: true, granted: existing.valor.toString() } }
  }

  const balance = await deps.signorum.balance({ animaId: record.animaId })
  const { grant, throttled } = proMonthlyRenewalGrant(balance)

  if (grant <= 0n) {
    log.info('promonthly invoice.paid: fair-use cap already reached — cycle granted 0', { invoiceId, animaId: record.animaId, balance: balance.toString() })
    return { status: 200, body: { received: true, granted: '0', throttled: true } }
  }

  try {
    const signum = await deps.signorum.issue({
      animaId: record.animaId,
      forma: 'minted',
      valor: grant,
      auctor: STRIPE_SUBSCRIPTION_AUCTOR,
      testis,
    })
    log.info('promonthly cycle granted', { invoiceId, animaId: record.animaId, granted: grant.toString(), throttled, signumId: signum.id })
    return { status: 200, body: { received: true, granted: grant.toString(), ...(throttled ? { throttled: true } : {}) } }
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      const replay = await findSubscriptionGrant(deps.signorum, record.animaId, testis)
      if (replay) return { status: 200, body: { received: true, granted: replay.valor.toString() } }
    }
    throw err
  }
}

/** Find this invoice's already-struck grant signum (the replay source), or null. */
async function findSubscriptionGrant(
  signorum: Pick<Signorum, 'history'>,
  animaId: string,
  testis: string,
) {
  const history = await signorum.history({ animaId })
  return history.find(s => s.auctor === STRIPE_SUBSCRIPTION_AUCTOR && s.testis === testis) ?? null
}

function requireField(value: string | null | undefined, name: string): string {
  if (!value) throw new ProMonthlyEventError(400, `Stripe event missing ${name}`)
  return value
}

/** A Mongo duplicate-key (E11000) error, detected structurally (mirrors stripeWebhook.ts). */
function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 11000
}
