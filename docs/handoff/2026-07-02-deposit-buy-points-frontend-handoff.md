# Handoff — Buy-points / deposit user-facing surface (frontend + quote API)

- **Date:** 2026-07-02
- **What this is:** the site UI that lets a user turn crypto into spendable credits ("buy points") —
  pick an asset, see a live quote (how many impetus points X buys), send the deposit, watch the
  balance update. The **backend deposit→credit pipeline is DONE**, and the **quote API is now DONE
  too** (added 2026-07-02 — see §2A, marked ✅). **Only the user-facing surface (§2B/§2C) remains.**

- **UPDATE 2026-07-02 — the quote API (§2A) is BUILT and tested.** `POST /v1/deposit/quote` +
  `GET /v1/deposit/config` are live (public, no auth). `CrystalApi.depositQuote/depositConfig`
  (`src/allocutio/api/CrystalApi.ts`), routes in `apiRouter.ts`, documented in the OpenAPI
  (`GET /v1/openapi.json` + `docs/api/reference.md`). The load-bearing guarantee is TESTED: a
  quote's `pointsQuoted` equals what the webhook actually credits for the same input (same pricer
  instance) — see `tests/unit/crystal/alchemyWebhook.test.ts` "quote == credit" + `tests/unit/allocutio/api/depositQuote.test.ts`.
  The frontend can build against it now. §2B (wire `Funding.tsx`) and §2C (wallet connect) remain.
- **Related:** `docs/spec/conditional-license-revenue.md` (§"stamp seam", §"shared pricer"),
  memory `project_deposit_pricing_parity`, ADR-0013 (revenue book).
- **Scope call:** build the **identified (doxxed-wallet) deposit + quote** flow first. The
  **anonymous (Bursa/arcanum) flow is Phase 2** — it's more involved and partly exists already
  (snarkjs/ceremony toolkit in the app). Don't block Phase 1 on it.

## 0. Ground rules (non-negotiable)
- **Crystal-first.** The quote endpoint must REUSE the existing pricing/funding/rate helpers below —
  do NOT re-derive the buy math in the frontend or a new service. One source of truth or the quote
  and the webhook credit will silently diverge.
- **Pin DB to `noemaplane` / `noemaplane_test`.** Never `noema` (prod).
- **Closed-loop, non-refundable credits** (ADR-0013 §4) — the UI must never imply credits are
  withdrawable/refundable (that would flip us into money-transmitter/trust-accounting territory).
  Copy is "add credits", not "deposit funds you can take back".
- **This is a money path.** Quote and credit must agree to the point. Test it (see §4).

## 1. What is already TRUE in the code (verified 2026-07-02 — do NOT rebuild)

The **deposit → credit + revenue pipeline is live** end-to-end in the backend:

- **Per-asset USD pricing:** `src/crystal/AssetPricer.ts` — `AlchemyPricer.usdFmv(chainId, token, amountRaw) → micro-USD | null`. Alchemy Prices API (ETH by-symbol, ERC-20 by-address + metadata decimals). `nullPricer` (no key → skip, loud), `fixedPricer` (tests). Returns `null` when unpriceable — callers treat null as "do not credit", never a silent zero.
- **Funding rate (the buy haircut):** `src/ledger/depositFunding.ts` — `DEFAULT_FUNDING_BPS = 7000n` (0.70, open acceptance) + `FUNDING_OVERRIDES` (favored assets at/near par: Milady/Remilio/Kagami/MiladyStation = 1.0, Fumo/CultExec = 0.85, Bonkler = 0.65). `fundingBps(token)`, `applyFundingBps(grossMicroUsd, bps)`.
- **Canonical rate:** `src/ledger/rates.ts` — `IMPETUS_USD_RATE = 0.000337`, `MICRO_USD_PER_IMPETUS = 337n`, `usdMicroToImpetus(usdMicro)`. **This is THE buy/spend rate (2967 pts/USD).** Do not use the legacy `0.00037` (2703) anywhere.
- **The credit conversion the webhook uses** (mirror it exactly in the quote): `creditImpetus(grossUsdFmv, token) = usdMicroToImpetus(applyFundingBps(grossUsdFmv, fundingBps(token)))` in `src/api/webhooks/alchemyWebhook.ts`. So: `points = floor( grossMicroUsd × fundingBps/10000 / 337 )`.
- **The deposit webhook** (`src/api/webhooks/alchemyWebhook.ts`, `handlePaymentLog`): OFAC-screens the payer → writes a `Depositum` → **books GROSS revenue** (`Reditus`, ADR-0013) → **credits NET impetus** (`Signum{forma:'eth', valor: impetus}`) when the payer's `Anima` is linked. Idempotent on re-delivery; unpriceable/OFAC deposits are parked/quarantined, never mis-credited. Goes live when `ALCHEMY_API_KEY` is set (else `nullPricer` parks with a loud warning).
- **Magic-amount wallet linking** already works in the webhook: an open `Petitio` whose `valuta` equals the deposited wei is auto-confirmed (`petitiones.findExpectans` → `status:'confirmata'`). This is how an unlinked wallet gets tied to an Anima.
- **Anonymous path (Phase 2):** anon deposits book gross revenue (§7) and mint a Bursa purse via ZK proof at `POST /arcanum/purse` — `weiToCredits` (in `src/arcanum/ethPrice.ts`) now uses the **same canonical rate + funding** as the identified path (reconciled 2026-07-02; 0.001 ETH @ $3000 → 6231 impetus on both paths).
- **Deposit address:** the CreditVault — `0x00000001152D633eb2AC3Cf91eac9994aEEFc021` (Ethereum mainnet **and** Base). `src/index.ts` `CREDIT_VAULT`.

### Frontend that exists (a mockup, not wired)
- `src/platforms/web/app/src/screens/Funding.tsx` — a **194-line static design mockup**: hardcoded `PACKS` (starter/plus/pro, fake credits/prices), privacy copy about shielded vs doxxed wallets, a "Connect a wallet" placeholder. **No real pricing, no quote, no deposit address, no wallet connect.** This is the screen to make real.
- The app's backend-call pattern: `src/platforms/web/app/src/lib/api.ts` — `const api = { ... }`, `fetch('/v1/...')`, `anonHeaders()`, `commitment()`, `meStatus()` polls `/v1/me/status`. Follow this pattern exactly.
- Web3/identity toolkit already in the app: `src/lib/idents.ts`, `src/lib/ceremony.ts`, `src/snarkjs.d.ts`, `screens/Onboard.tsx` (the anon-commitment / snarkjs machinery for Phase 2).

## 2. The deltas to build

### A. Backend — a quote endpoint ✅ DONE (2026-07-02)
Built exactly as specced below. `POST /v1/deposit/quote` + `GET /v1/deposit/config` in `src/allocutio/api/apiRouter.ts`; `CrystalApi.depositQuote/depositConfig` reuse the §1 helpers (so quote == webhook credit, tested); OpenAPI-documented. The request/response shapes below are the real contract. **The rest of §A is the spec of what was built — read it as the API reference.**

- **Request:** `{ chainId, token, amount }` (`amount` = raw base units; `token` = `0x0` for ETH).
- **Compute (REUSE the helpers, do not re-derive):**
  ```
  grossMicroUsd = pricer.usdFmv(chainId, token, amount)   // null → 422 PRICE_UNAVAILABLE
  bps           = fundingBps(token)
  points        = usdMicroToImpetus(applyFundingBps(grossMicroUsd, bps))   // == what the webhook credits
  ```
- **Response:** `{ grossUsd, fundingRatePct, pointsQuoted, depositAddress, chainId }`.
- **Gas — show it, do NOT subtract it.** Per the decision this session (see `creditImpetus` doc-comment + spec), the webhook does not deduct gas, so the quote must not either, or quote≠credit. Instead return an **informational** `estimatedNetworkFeeUsd` (a separate line: "you'll also pay ~$Z to send this, paid to the network, not us") — estimate via a gas oracle (`getFeeData`) if you want it live, or omit for v1. **`pointsQuoted` must equal what the webhook credits for the same input.**
- **Do NOT pre-stage the quote** (legacy stages quotes in the credit ledger and matches them at deposit time). The crystal webhook already computes the credit independently and correctly, so the quote is **informational only** — as long as it uses the same helpers, they agree. (If product later wants locked-in quotes despite price drift, that's a staging feature to add then.)
- Also expose the **supported-assets + rate** for the picker: either a `GET /v1/deposit/config` (`{ depositAddress, pointsPerUsd: 2967, assets: [{token, symbol, fundingRatePct}] }`) or fold the asset list into the same module. Source the favored-asset list from `FUNDING_OVERRIDES` + a curated display list; open acceptance means "any token Alchemy prices" but the picker should surface a sensible default set.

### B. Frontend — make `Funding.tsx` real
- Replace the hardcoded `PACKS` with a **live quote**: asset picker (ETH + the favored tokens) + amount input → debounced `api.depositQuote({chainId, token, amount})` → render `pointsQuoted` + the gross USD + the informational network-fee line. Keep the existing visual design/copy.
- Show the **deposit target**: the CreditVault address (from `/v1/deposit/config`), copyable + QR. For an **unlinked wallet**, drive the **magic-amount** flow — request a `Petitio` (there's an internal magic-amount endpoint; expose a `/v1` wrapper) and tell the user the exact amount to send so the webhook auto-links their wallet.
- After send, **poll `api.meStatus()`** (`/v1/me/status`) until the balance reflects the credit; show a success state. (The webhook credits asynchronously when Alchemy delivers the deposit event.)
- Preserve the two-mode framing the mockup already gestures at: **doxxed onchain wallet** (Phase 1, identified) vs **shielded/anon** (Phase 2, Bursa). Wire Phase 1; leave the anon card as "coming soon" or behind a flag.

### C. Wallet connect (Phase 1)
- The app leans anon-first (commitment/snarkjs), so an identified **wallet-connect** may need adding (the micro-web3 toolkit is referenced in memory `project_frontend_vision`). Minimal: let the user connect a wallet to (a) read their address for the magic-amount `Petitio` and (b) optionally trigger the send. If a full connector is too much for v1, the **address-display + magic-amount** flow works with zero wallet integration (user sends manually).

## 3. Build order
1. `POST /v1/deposit/quote` + `GET /v1/deposit/config` (backend, reuse §1 helpers) — with a unit test asserting `pointsQuoted == creditImpetus(...)` for several assets/amounts.
2. Wire `Funding.tsx` to the quote + config (asset picker, amount, live points, deposit address).
3. Magic-amount `Petitio` request + "send exactly this" UX + `meStatus` polling for the balance update.
4. (Optional v1) live gas estimate as the informational network-fee line.
5. (Phase 2) anon/Bursa funding via the existing `/arcanum/purse` + snarkjs toolkit.

## 4. Acceptance / go-no-go
- **Quote == credit:** for the same `{chainId, token, amount}`, `POST /v1/deposit/quote`.pointsQuoted equals the impetus the webhook credits (drive `handlePaymentLog` with the same input in a test). This is the load-bearing check — if they diverge, users get a different number than promised.
- **Canonical rate + funding:** 0.001 ETH @ $3000 quotes **6231** points (0.70 funding); a favored-asset override (1.0) quotes the full `gross/337`.
- **Unpriceable asset →** quote returns 422 `PRICE_UNAVAILABLE`, UI shows a clean "can't price this asset" state (never "0 points" silently).
- **No `ALCHEMY_API_KEY` →** quote endpoint degrades loudly (the pricer is `nullPricer`); UI shows funding temporarily unavailable, not a zero quote.
- **Magic-amount:** sending the exact quoted amount from an unlinked wallet links it and credits (verify against `handlePaymentLog`'s `Petitio` confirmation).
- **Closed-loop copy:** no "withdraw"/"refund" language anywhere in the flow.

## 5. Gotchas (read before coding)
- **Quote is informational, not staged.** Price can drift between quote and deposit; the webhook re-prices at deposit time and that credit is authoritative. Don't promise a locked number unless you add staging.
- **Gas is NOT subtracted from points** (deliberate — see `creditImpetus` in `alchemyWebhook.ts` for the full why: post-deposit gas would double-dock the user and zero small deposits). Show it as a separate FYI line only.
- **`amount` is raw base units** (wei for ETH, token-decimals for ERC-20). The pricer handles decimals; the frontend must send raw units (convert from the human amount using the token's decimals).
- **Two chains:** the same CreditVault address is on mainnet **and** Base — let the user pick the chain; pass `chainId` through to the quote (ERC-20 pricing is per-network).
- **OFAC:** the webhook screens the payer and quarantines blocked deposits (`fractum`, no credit). The UI can't pre-screen, but shouldn't promise credit to an address that may be blocked — keep success contingent on the `meStatus` poll, not the send.
- **Revenue vs credit:** the user is credited NET (after funding); we recognize GROSS as revenue (ADR-0013 §4b). The UI only ever shows the user their NET points — never surface the gross/margin.

## 6. Pointers
- Backend pricing/credit: `src/crystal/AssetPricer.ts`, `src/ledger/depositFunding.ts`, `src/ledger/rates.ts`, `src/api/webhooks/alchemyWebhook.ts` (`handlePaymentLog`, `priceDeposit`, `creditImpetus`), `src/arcanum/ethPrice.ts` (`weiToCredits`, Phase 2).
- Revenue book: `src/types/reditus.ts`, `src/crystal/MongoRedituum.ts`.
- API surface to extend: `src/allocutio/api/apiRouter.ts`, `src/allocutio/api/CrystalApi.ts` (see `quote`, `listModels`).
- Frontend: `src/platforms/web/app/src/screens/Funding.tsx` (make real), `src/lib/api.ts` (fetch pattern), `screens/Onboard.tsx` + `lib/idents.ts` + `lib/ceremony.ts` + `snarkjs.d.ts` (Phase 2 anon).
- **Legacy reference to PORT (behavior parity), not copy:** `src/api/internal/economy/pointsApi.js` (`/quote` — the full formula, gas handling, quote staging), `src/api/internal/economy/ratesApi.js` (rates response), `src/core/services/alchemy/priceFeedService.js` (Alchemy usage), `src/core/services/alchemy/creditService.js` (`estimateDepositGasCostInUsd`), `src/core/services/alchemy/tokenConfig.js` (the favored-asset funding table), `DepositProcessorService.js` (quote-match-on-deposit, if staging is ever wanted).
- Deposit address / config: `src/index.ts` `CREDIT_VAULT`; memory Magic-Amount Wallet Linking section.
