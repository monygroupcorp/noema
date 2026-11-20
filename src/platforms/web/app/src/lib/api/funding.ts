import { j } from './core';
import { authHeaders, readHeaders } from './session';

// Deposit / buy-points config (GET /v1/deposit/config) — mirrors the backend DepositConfig.
export interface DepositConfig {
  depositAddress: string;
  // Canonical impetus points per 1 USD (gross, before the funding rate) — ≈ 2967.
  pointsPerUsd: number;
  // Default funding rate as a percent (70 = 70% of USD value converts to points).
  defaultFundingRatePct: number;
  chains: Array<{ chainId: number; name: string }>;
}
// A displayable credit pack (GET /v1/payments/packs) — mirrors the backend PackView. Display only:
// `credits` = impetus/10; the charged/credited amount stays server-authoritative by `id` (packId).
export interface Pack {
  id: string;
  usd: number;
  credits: number;
  label: string;
  bestRate?: boolean;
}

// The hosted Stripe Checkout session (POST /v1/payments/checkout) — mirrors the backend
// CheckoutResponseSchema. `url` is the hosted-checkout URL to redirect the caller to.
export interface CheckoutSession {
  url: string;
  sessionId: string;
}

// A deposit quote (POST /v1/deposit/quote) — informational; the webhook credit is authoritative.
export interface DepositQuote {
  chainId: number | string;
  token: string;
  amountRaw: string;
  grossUsd: string;
  grossUsdMicro: string;
  fundingRatePct: number;
  pointsQuoted: string;
  depositAddress: string;
}

// One of the caller's own deposits (GET /v1/deposit/mine) — owner-scoped, real status.
// Mirrors the backend MyDeposit — powers the settle-watch UI instead of hoping the balance moves.
export interface MyDeposit {
  id: string;
  chainId: number | string;
  txHash: string;
  valor: string;
  status: 'detectum' | 'confirmatum' | 'processatum' | 'praesolutum' | 'fractum';
  natum: string;
}

const fundingApi = {
  // ── Deposit / buy-points (Funding) — public, no auth ─────────────────────────
  // GET /v1/deposit/config — the CreditVault address + canonical points-per-USD +
  // default funding rate + supported chains. Static; drives the buy-credits UI.
  getDepositConfig: () => fetch('/v1/deposit/config').then(j<DepositConfig>),
  // POST /v1/deposit/quote — how many impetus points `amount` base units of `token`
  // buys right now. INFORMATIONAL: the on-chain deposit webhook re-prices + credits
  // authoritatively (equal to this) at deposit time. token = 20-byte hex address
  // (0x000…000 for native ETH); amount = raw base units (wei / token-decimals) string.
  depositQuote: (body: { chainId: number | string; token: string; amount: string }) =>
    fetch('/v1/deposit/quote', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      .then(j<DepositQuote>),
  // GET /v1/deposit/mine — the caller's OWN deposits, scoped to their linked wallets (auth
  // required). Real depositum status (confirmatum/processatum) — the settle-watch UI polls
  // this instead of hoping the balance moves.
  myDeposits: () => fetch('/v1/deposit/mine', { headers: readHeaders() }).then(j<{ deposits: MyDeposit[] }>),

  // ── Credit-pack catalog — public, no auth ────────────────────────────────────
  // GET /v1/payments/packs — the ratified credit packs for DISPLAY (pricing page + Funding),
  // sourced from the server's single stripePacks catalog. `credits` is display-only (= impetus/10);
  // the charged/credited amount stays server-authoritative by packId at checkout time.
  listPacks: () => fetch('/v1/payments/packs').then(j<{ packs: Pack[] }>).then((r) => r.packs),

  // ── Fiat pack checkout (Stripe) — identified accounts only ───────────────────
  // POST /v1/payments/checkout — create a hosted Stripe Checkout session for one of the
  // fixed credit packs (starter_10/standard_25/plus_50/studio_100). Server-authoritative:
  // the impetus credited is the pack constant, applied later by the signature-verified
  // webhook on payment completion — never computed client-side. 401
  // payments.identity_required for an anon/purse caller (a fiat pack can't fund a purse).
  createCheckoutSession: (body: { packId: string; successUrl?: string; cancelUrl?: string; allocutio?: 'telegram' }) =>
    fetch('/v1/payments/checkout', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) })
      .then(j<CheckoutSession>),
};

export default fundingApi;
