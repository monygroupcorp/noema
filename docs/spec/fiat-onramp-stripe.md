# Fiat Onramp (Stripe) — Spec

**Date:** 2026-06-17
**Status:** Spec / draft. Parallel to the crypto + arcanum funding paths.
**Relates to:** the credit system (`signa`), the privacy partition, the compliance posture
(closed-loop credits, KYC/OFAC), `/v1/me/status` balance.

> Funding is a **privacy gradient**. Stripe is the most *doxed* rung — a card is your name,
> billing address, and KYC. That's a feature, not a flaw: it's the rung for people who want
> card convenience and don't need anonymity. It is deliberately **incompatible with the
> anonymous tier** — you cannot pay by card *and* stay unlinkable.

## 1. The three funding rungs (most private → most doxed)

| Rung | Method | Identity exposed | Credits land on |
|---|---|---|---|
| **Anonymous** | arcanum deposit (on-chain → ZK note → bursa purse) | none (unlinkable) | a bearer **purse** (`x-bursa-token`) |
| **Account (crypto)** | wallet deposit to CreditVault (magic-amount link / web3) | wallet address | an **identified account** (`anima`) |
| **Fiat (Stripe)** | card / Apple Pay / Google Pay via Stripe | **full** — name, card, billing, KYC | an **identified account** (`anima`) |

**Invariant:** fiat credits can only fund an **identified account**, never an arcanum
purse (a card payment de-anonymizes by construction). The UI must enforce + explain this.

## 2. What's being sold: closed-loop credits (NOT money)

- A purchase converts fiat → **`signa`** (credits), a prepaid balance redeemable **only for
  compute on this platform**. Credits are **not withdrawable, not transferable, not
  refundable for cash** (modulo consumer-law refund windows on unused balances — see §6).
- This keeps us a **closed-loop prepaid system**, not a money transmitter / stored-value
  issuer (see the compliance posture notes). Credits are a license to compute, not a
  financial instrument. **Counsel must confirm** the closed-loop framing per jurisdiction.
- Ledger: a fiat purchase creates a `Signum` credit entry on the `anima` (`forma: 'integer'`,
  `auctor: 'stripe:purchase'`, `testis: <stripe_payment_intent_id>`), mirrored by a platform
  debit, exactly like the existing crypto-deposit grant.

## 3. Credit packs (value metric = credits; $ is placeholder — business decision)

Sell discrete **credit packs** (not a $-amount field — packs reduce decision friction and
read as "topping up," not "depositing money"):

| Pack | Credits | Price (placeholder) | $/credit |
|---|---|---|---|
| Starter | 1,000 | $5 | — |
| Plus | 5,000 | $20 | (volume discount) |
| Pro | 25,000 | $80 | (more) |

*(Numbers are placeholders — pricing is a business decision; see `docs/site/pricing.md`.)*
Optionally an auto-reload ("keep me above N credits") later — adds churn-resistance but also
recurring-billing + consent complexity; defer.

## 4. Stripe integration (backend)

- **Stripe Checkout (hosted) for v1** — least PCI burden (Stripe holds the card; we never
  touch PANs → SAQ-A). Redirect or embedded. Upgrade to Payment Element later if we want
  in-app card fields.
- **Products/Prices** configured in Stripe (one Price per credit pack). Server creates a
  **Checkout Session** for the chosen Price, tied to the authenticated `anima`
  (`client_reference_id = animaId`, `customer` = a Stripe Customer per anima for receipts).
- **Webhook** `POST /v1/payments/stripe/webhook` (or `/api/...`):
  - **Verify the signature** (`stripe-signature` + endpoint secret) — reject otherwise.
  - On `checkout.session.completed` (and/or `payment_intent.succeeded`): grant the pack's
    credits to the `anima`. **Idempotent** on the event id / payment-intent id (Stripe
    retries; never double-grant).
  - On `charge.refunded` / `charge.dispute.created`: claw back unspent credits / flag.
- **Keys:** test keys on staging, live keys in prod (env). Never ship secret keys to the
  client; the client only gets the Checkout URL / publishable key.
- **Endpoints (proposed, under the agent API or a payments router):**
  - `POST /v1/payments/checkout` → `{ packId }` (auth required) → `{ url }` (Stripe Checkout URL).
  - `POST /v1/payments/stripe/webhook` → Stripe → grants credits (no client auth; signature-gated).
  - `GET /v1/me/status` already returns the balance the UI refreshes after return.

## 5. Frontend flow

1. **Funding screen** ("Add credits") shows the three rungs with the privacy gradient
   explicit (reuse the trust language: a card icon + "card payments identify you").
2. Fiat path requires an **identified** active identity. If the user is on the anonymous
   tier, prompt to sign in first (you can't card-fund anonymously) — a deliberate, legible
   gate, not a silent block.
3. Pick a pack → `POST /v1/payments/checkout` → redirect to Stripe Checkout (or open embedded).
4. On `success_url` return → poll `GET /v1/me/status` until the balance reflects the grant
   (webhook is the source of truth; the redirect is just UX).
5. Apple Pay / Google Pay come free with Stripe Checkout (good mobile conversion).

## 6. Compliance & ops (the boring, load-bearing part)

- **KYC/identity:** Stripe performs card auth + (for higher volumes) its own KYC. We rely on
  Stripe as the merchant-of-record-ish layer; confirm whether we need **Stripe Connect** or
  standard. **OFAC/sanctions:** Stripe screens; we additionally block sanctioned regions.
- **SCA / 3DS:** handled by Checkout. **Tax/VAT:** enable **Stripe Tax** (digital goods —
  VAT/GST by customer location). **Receipts:** Stripe emails them (Customer object).
- **Refunds (RATIFIED 2026-07-07, reconfirmed 2026-07-21 R-1; BUILT noema-082):** the policy is
  **14 days, unused-balance-only**. Unused credits are refundable within **14 days of purchase**;
  consumed credits are **non-refundable** for the spent portion; a partial-spend refund returns the
  **remaining (unspent) balance**, capped at the pack amount (operator Q1 ruling — never a negative
  balance). The 14-day clock is anchored to the Stripe charge's own `created` timestamp (Q4). This
  is now live in the legal/pricing copy (`docs/legal/terms-and-conditions.md`,
  `src/platforms/web/app/src/content/{terms,pricing}.md`, `docs/site/pricing.md`) and wired as
  `charge.refunded` → single negative-valor clawback debit + proportional `Redituum.reverse()`.
- **Chargebacks (BUILT noema-082):** `charge.dispute.created` → freeze the account's user-initiated
  value-outflow (generation spend + owned-purse mint; login + value-inflow untouched), held pending
  manual operator review (no auto-lift), alert fired; respond via Stripe.
- **Fraud:** Stripe Radar; velocity limits on new accounts; first-purchase caps.
- **Securities/MSB:** closed-loop, non-transferable, compute-only → stays out of MSB/securities
  territory (counsel to confirm). Do **not** allow credit→cash or credit→credit transfer.

## 7. How it sits next to the other rungs

- Same destination ledger (`signa` on the `anima`) as the **crypto account** rung — so once
  credits land, runs/quotes don't care how they were funded.
- The **anonymous** rung is a different destination (a bearer purse) and a different code
  path (arcanum) — fiat never touches it.
- The Vault (arcanum) build is largely assembled (backend ZK complete); this Stripe path is
  **independent and can ship first** — it's simpler (no on-chain, no ZK), just Stripe + a
  webhook + the existing credit-grant.

## 8. Open decisions (need a human)

- Pricing of the credit packs (and the $/credit curve).
- The legal entity / Stripe account, and merchant-of-record posture.
- Auto-reload (recurring) — in v1 or later?
- Endpoint home: under `/v1` (agent API) vs a dedicated `/payments` router.

## 9. Build order (when we do it)

1. Stripe account + products/prices (staging test mode).
2. `POST /v1/payments/checkout` + `POST /v1/payments/stripe/webhook` (signature-verified,
   idempotent) → credit grant to `anima`.
3. Frontend **Funding screen** (the three rungs) + the fiat → Checkout → return → balance-refresh.
4. Legal: refunds/credits policy — **DONE (noema-082)**: the ratified 14-day-unused-only policy is
   in `docs/legal/terms-and-conditions.md` + `src/platforms/web/app/src/content/{terms,pricing}.md`
   + `docs/site/pricing.md`, and the `charge.refunded`/`charge.dispute.created` mechanism is built.
5. Live keys + go-live checklist (tax, Radar, region blocks).
