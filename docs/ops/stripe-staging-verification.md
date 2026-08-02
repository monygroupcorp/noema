# Stripe Staging Verification — Runbook (source of truth)

> Operator directive 2026-08-01: "assume our Stripe integration is faulty until we've run it
> through." Existing hermetic tests (`tests/unit/allocutio/api/stripeRail.test.ts`) prove the
> money-path INVARIANTS but inject a FAKE gateway. `stripeRailRealSignature.test.ts`
> (noema-120) closes the signature-verification gap hermetically — it drives the REAL
> `StripeGateway` (`stripeGateway.ts` → `stripe.webhooks.constructEvent`) with a Stripe-signed
> payload, no live key. **What that hermetic test CANNOT cover** is the live network path: a real
> Checkout Session redirect, a real card charge, a real webhook DELIVERY from Stripe's servers to
> this deployment. That's what this runbook is for. Attended — the operator runs it, with real
> Stripe TEST-mode keys, before go-live.

## What's covered where

| Layer | Covered by |
|---|---|
| Signature HMAC verification (real `stripe.webhooks.constructEvent`, tampered/wrong-secret rejection) | `stripeRailRealSignature.test.ts` (hermetic, no live key) |
| Crediting logic, idempotency, refund/dispute (money-path invariants) | `stripeRail.test.ts` (hermetic, fake gateway) |
| Real Checkout Session creation + hosted redirect | **This runbook** (needs live test key) |
| Real webhook DELIVERY (Stripe → staging, over the network) | **This runbook** (needs live test key + registered endpoint) |
| A real test-card charge landing a real credit | **This runbook** (needs live test key + test card) |

## 1. Configure staging with Stripe TEST-mode keys

On the droplet (`ssh noema`), edit `/opt/noema/.env.staging` (source of truth per
`staging-deploy.md` — NOT the repo copy):

```
STRIPE_SECRET_KEY=sk_test_...       # Stripe Dashboard → Developers → API keys (TEST mode)
STRIPE_WEBHOOK_SECRET=whsec_...     # from the endpoint you register in step 2
STRIPE_SUCCESS_URL=https://staging.noema.art/funding?status=success
STRIPE_CANCEL_URL=https://staging.noema.art/funding?status=cancel
```

Never put live (`sk_live_...`) keys here — this file is test-mode-only until go-live
config is a separate, explicit decision.

Redeploy after editing (`~/deploy-staging.sh`, per `staging-deploy.md`) so the container
picks up the new env — `stripeConfigFromEnv()` reads it once at boot; without both
`STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` set, the rail 503s (by design — a go-live
wiring gap is never a silent no-op).

## 2. Register the webhook endpoint (test mode)

Two options — pick one:

- **Stripe Dashboard** (closer to real production wiring): Developers → Webhooks → Add
  endpoint → `https://staging.noema.art/v1/webhooks/stripe` (confirm the exact mounted
  path in `src/index.ts` / the webhooks router), TEST mode, events: `checkout.session.completed`,
  `payment_intent.succeeded`, `charge.refunded`, `charge.dispute.created`. Copy the signing
  secret it gives you into `STRIPE_WEBHOOK_SECRET` above.
- **Stripe CLI forwarding** (faster iteration, no dashboard config needed):
  ```
  stripe listen --forward-to https://staging.noema.art/v1/webhooks/stripe
  ```
  It prints a `whsec_...` for the forwarding session — use that as `STRIPE_WEBHOOK_SECRET`
  for the duration of the session.

## 3. Run a real test-mode purchase

1. Trigger `handleStripeCheckout` for a pack (via the app's funding UI on staging, or a
   direct `curl` to the checkout endpoint with an identified session) — confirm you get
   back a real `checkout.stripe.com/...` URL.
2. Open the URL, pay with a **Stripe test card**: `4242 4242 4242 4242`, any future
   expiry, any CVC, any ZIP.
3. Confirm the redirect lands on `STRIPE_SUCCESS_URL`.

## 4. Confirm the webhook landed + credited correctly

- **Signature verified:** check staging logs for `stripe payment credited` (info level) —
  its absence, or a `stripe webhook signature verification failed` warning, means the
  endpoint URL/secret is misconfigured (re-check step 2).
- **Balance moved by the exact pack amount:** query the anima's balance before and after —
  the delta must equal `PACKS[<packId>].impetus` exactly (no haircut, no partial credit).
- **Signum + Reditus rows written:** the credit `Signum` has `auctor:'stripe:purchase'`,
  `testis:'stripe:<payment_intent>'`, `forma:'minted'`; a peer `Reditus` is booked with
  `origo:'fiat'`, `chargeRef:<payment_intent>`, `usdFmv` = the pack's charge amount in
  micro-USD.

## 5. Verify idempotency LIVE (redelivery)

From the Stripe Dashboard (Developers → Webhooks → the endpoint → the delivered event →
"Resend") or the CLI (`stripe events resend <event_id>`), redeliver the
`checkout.session.completed` event for the purchase above.

- Confirm the response is still `200`.
- Confirm the balance did **not** move again (still the single pack's impetus).
- Confirm only ONE `Signum` history row exists for that `payment_intent` (no second
  credit was minted).

This is the live-path counterpart of `stripeRailRealSignature.test.ts`'s redelivery
assertion — the hermetic test proves the guard holds through the real verifier in-process;
this step proves it holds against an actual Stripe redelivery over the network.

## 6. Verify a bad-signature POST is rejected

```
curl -i -X POST https://staging.noema.art/v1/webhooks/stripe \
  -H 'Content-Type: application/json' \
  -H 'stripe-signature: t=0,v1=deadbeef' \
  -d '{"id":"evt_fake","type":"checkout.session.completed","data":{"object":{}}}'
```

Expect `400`. Confirm no balance changed and no new `Signum`/`Reditus` rows were written.

## 7. Verify a non-completed payment credits nothing

Trigger a test-mode payment that does NOT complete (e.g. use a Stripe test card that
declines, `4000 0000 0000 0002`, or `stripe trigger payment_intent.payment_failed`).
Confirm no credit lands and no `Signum` is written for that attempt.

## Checklist (mirrors the webhook's stated invariants, `stripeWebhook.ts`)

- [ ] No credit without a signature-verified event (step 6).
- [ ] The credited amount is the server-side pack constant, never client-supplied
      (step 4 — balance delta equals `PACKS[packId].impetus` exactly).
- [ ] At-most-one credit per payment under redelivery (step 5).
- [ ] A non-completed payment credits nothing (step 7).
- [ ] Refund clawback and dispute freeze (`charge.refunded`, `charge.dispute.created`) —
      optional but recommended before go-live: use `stripe trigger charge.refunded` /
      `stripe trigger charge.dispute.created` against a purchase from step 3 and confirm
      the balance is clawed back / the anima is frozen, mirroring the hermetic assertions
      in `stripeRail.test.ts`.

## What needs live test keys (operator, this runbook) vs. what's already hermetic (CI, every run)

- **Hermetic (no action needed, runs on every CI build):** signature HMAC verification
  (real verifier, `stripeRailRealSignature.test.ts`), crediting math, idempotency logic,
  refund/dispute logic (`stripeRail.test.ts`).
- **Needs live test keys (this runbook, attended, before go-live):** real Checkout Session
  creation + hosted redirect, real webhook delivery over the network, a real test-card
  charge landing a real credit, live redelivery via the Stripe dashboard/CLI.
