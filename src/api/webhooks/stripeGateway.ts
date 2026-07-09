// =============================================================================
// stripeGateway — the real `StripeGateway` port, wrapping the `stripe` SDK
// =============================================================================
//
// The ONE file that imports the `stripe` SDK. It binds the port `stripeWebhook.ts` depends on
// to a live Stripe client built from env config, so the rail's logic + tests stay SDK-free
// (tests inject a fake gateway). Constructed once by `CrystalApi` when Stripe is configured;
// absent config → the rail reports 503 (a go-live wiring gap, never a silent no-op).
// =============================================================================

import Stripe from 'stripe'
import { makeLogger } from '../../lib/logger.js'
import type {
  StripeGateway,
  StripeWebhookEvent,
} from './stripeWebhook.js'

const log = makeLogger('stripe-gateway')

/** Env-sourced Stripe config. Secret + webhook secret are REQUIRED; the redirect URLs default. */
export interface StripeConfig {
  /** `STRIPE_SECRET_KEY` — the server-side secret (test key on staging, live in prod). */
  secretKey: string
  /** `STRIPE_WEBHOOK_SECRET` — the endpoint signing secret used to verify `stripe-signature`. */
  webhookSecret: string
  /** Where Stripe redirects after a successful checkout (UX only; crediting is webhook-driven). */
  successUrl: string
  /** Where Stripe redirects on cancel. */
  cancelUrl: string
}

/**
 * Read Stripe config from the environment. Returns `null` when the required secrets are absent
 * (the deployment has not been go-live-configured) — the caller then reports the rail unavailable.
 * The redirect URLs are non-load-bearing UX (crediting happens via the webhook regardless); they
 * default to a placeholder that go-live overrides via `STRIPE_SUCCESS_URL` / `STRIPE_CANCEL_URL`.
 */
export function stripeConfigFromEnv(env: NodeJS.ProcessEnv = process.env): StripeConfig | null {
  const secretKey = env.STRIPE_SECRET_KEY
  const webhookSecret = env.STRIPE_WEBHOOK_SECRET
  if (!secretKey || !webhookSecret) return null
  const successUrl = env.STRIPE_SUCCESS_URL
  const cancelUrl = env.STRIPE_CANCEL_URL
  if (!successUrl || !cancelUrl) {
    log.warn('STRIPE_SUCCESS_URL / STRIPE_CANCEL_URL unset — using placeholder redirect URLs (set them at go-live). Crediting is webhook-driven and unaffected.')
  }
  return {
    secretKey,
    webhookSecret,
    successUrl: successUrl ?? 'https://example.invalid/funding?status=success',
    cancelUrl: cancelUrl ?? 'https://example.invalid/funding?status=cancel',
  }
}

/** Build the live `StripeGateway` from config. */
export function makeStripeGateway(config: StripeConfig): StripeGateway {
  const stripe = new Stripe(config.secretKey)
  return {
    async createCheckoutSession(input) {
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        client_reference_id: input.animaId,
        // packId travels in metadata on BOTH the session and the payment_intent so the webhook
        // can read it from either event type. The webhook trusts THIS server-set value, not the client.
        metadata: { packId: input.packId, animaId: input.animaId },
        payment_intent_data: { metadata: { packId: input.packId, animaId: input.animaId } },
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: 'usd',
              unit_amount: input.amountCents,
              product_data: { name: input.label },
            },
          },
        ],
        success_url: input.successUrl ?? config.successUrl,
        cancel_url: input.cancelUrl ?? config.cancelUrl,
      })
      if (!session.url) throw new Error('Stripe returned a session with no checkout URL')
      return { id: session.id, url: session.url }
    },

    constructWebhookEvent(rawBody, signature): StripeWebhookEvent {
      // Throws `Stripe.errors.StripeSignatureVerificationError` on a bad/absent signature — the
      // handler catches it and returns 400 (no credit path is reached).
      const event = stripe.webhooks.constructEvent(rawBody, signature ?? '', config.webhookSecret)
      return event as unknown as StripeWebhookEvent
    },
  }
}
