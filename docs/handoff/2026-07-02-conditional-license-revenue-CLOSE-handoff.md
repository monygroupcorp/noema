# Handoff — CLOSE the conditional-license revenue + deposit-buy-points arc

- **Date:** 2026-07-02
- **Purpose:** the single doc to pick up next session and **finish** this thread. Everything below
  is what's left after a long session that built the whole deposit→revenue→credit pipeline. The
  ORIGINAL ask — "conditional-license revenue tracking" — is **still not closed**: the revenue
  *plumbing* exists, but the **tripwire that uses it (the whole point) is unbuilt** (spec steps 3–6).
- **Spec:** `docs/spec/conditional-license-revenue.md` (has its own build-order §; steps 1–2 ✅, 3–6 ✗).
- **Related handoff:** `docs/handoff/2026-07-02-deposit-buy-points-frontend-handoff.md` (the UI — a
  SEPARATE track, §T3 below). Memory: `project_deposit_pricing_parity`, `project_licensing_and_accounting`.

## 0. Ground rules (non-negotiable)
- Crystal-first; reuse existing helpers, don't re-derive. Pin DB to `noemaplane`/`noemaplane_test`.
- `[CPA]`/`[counsel]` items = capture data / get a professional; don't hard-code a tax/legal treatment.
- This is a money/compliance path. The tripwire is a legal safety valve — build it to be LOUD, not silent.

## 1. What is DONE (verified this session — do NOT rebuild)
The full deposit→revenue→credit pipeline is live in the backend and hermetic-green (756):
- **Revenue book (`Reditus`)** — `src/types/reditus.ts`, `MemoryRedituum`/`MongoRedituum` (unique-partial-index idempotency, `trailingUsdRevenue(now)` rollup query EXISTS on the store). Fail-closed FMV. ADR-0013 §1–§2.
- **Deposit webhook wired** — `src/api/webhooks/alchemyWebhook.ts`: prices once → books GROSS revenue (`Reditus`) + credits NET impetus (`Signum`); OFAC-skips `fractum`; idempotent; recognized-at-receipt.
- **Per-asset pricer** — `src/crystal/AssetPricer.ts` (Alchemy Prices, ETH + ERC-20). **Funding** — `src/ledger/depositFunding.ts` (0.70 default + overrides). **Canonical rate** — `rates.ts` `MICRO_USD_PER_IMPETUS=337n` / `usdMicroToImpetus`.
- **Buy-points parity fixed** — identified path credits impetus (was raw wei); anon `weiToCredits` (`src/arcanum/ethPrice.ts`) reconciled to the SAME rate+funding (both = 6231 for 0.001 ETH @ $3000).
- **Quote API** — `POST /v1/deposit/quote` + `GET /v1/deposit/config` (`CrystalApi.depositQuote/depositConfig`); quote == webhook credit, tested; OpenAPI-documented.
- **Gas decision** — deliberately NOT deducted in the webhook (would double-dock/zero small deposits); belongs in the future quote UI surface. See `creditImpetus` doc-comment.

## 2. What REMAINS to CLOSE — four tracks

### T1 — The conditional-license TRIPWIRE (spec steps 3–6) — ✅ **CLOSED (2026-07-02)**
This was the reason the whole thread started: `isCatalogEligible` (`src/crystal/modelLicense.ts`) lets
`conditional` licenses (Krea 2 `<$1M`, Stability SD3/3.5) into the public catalog **on the promise
that we watch revenue and pre-negotiate before the cap**. **That watch now exists.** What landed:
- `CONDITIONAL_CAP_USD` + `conditionalCapUsd` + `bindingCapUsd` (min-binding, null=dormant) +
  `activeConditionalLicenses` (public-catalog query) in `src/crystal/modelLicense.ts`.
- `src/crystal/licenseTripwire.ts`: `band()` (pure bigint ratio), `evaluateTripwire` (edge-triggered
  on band transitions, suppresses the dormant baseline, persists the band), `startLicenseTripwire`
  (6h cadence), the `onThresholdBand` seam + `logThresholdBand` default (breach = `log.error`, LOUD).
- Persisted band: `MongoTripwireBandStore` (single-doc, `license_tripwire` coll) — `ring.tripwireBand`.
- Admin rollup: `CrystalApi.revenueReport` (platform-admin) → `GET /v1/admin/revenue` (OpenAPI-documented).
- Evaluator scheduled in `src/index.ts` beside the subsidy sweeper.
- Step 6 comment retirement done. Hermetic-green (+19 new tests). Acceptance §4 below all satisfied.
- **Only T2 remains** (env + [counsel] cap figures). The historical build spec follows for reference:

- **Step 3 — expose the rollup.** `trailingUsdRevenue(now)` exists on `Redituum` but nothing calls it.
  Surface it: an admin/report read (a `CrystalApi` method + an admin route, or a scheduled job that
  logs/persists the figure). ADR-0013 §5 wants "a real query/report, not a manual reconstruction."
- **Step 4 — the cap registry.** Add `CONDITIONAL_CAP_USD: Record<string, number>` next to
  `LICENSE_COMMERCIAL` in `modelLicense.ts` (`krea-community: 1_000_000`, `stability-community:
  1_000_000` **[counsel: verify exact figure/semantics]**). Add `activeConditionalCaps()` = the caps
  of conditional-licensed models CURRENTLY reachable in the public catalog (query `Intella` where
  `commercialUse ∈ isCatalogEligible` && public). `bindingCap = min(activeCaps)` (∞ if none active).
- **Step 5 — the tripwire.** `band(R, cap)`: `clear <0.75 / watch 0.75–0.90 / warn 0.90–1.0 / breach ≥1.0`.
  One edge-triggered seam `onThresholdBand(prev, next, {R, bindingCap, licenses})` — fires on band
  TRANSITIONS only; initial wiring = log + ops alert. Evaluate on a cheap cadence (scheduled, or
  debounced after `Reditus.record`), NOT the hot path. `breach` is a real compliance incident → loud.
- **Step 6 — retire the overstatement.** Once T1 is live, fix the `modelLicense.ts` comment
  ("…we track revenue…") to point at the real tripwire instead of an aspiration.
- **Crystal reduction (already decided — don't re-litigate):** the cap is COMPANY-WIDE total
  trailing-12mo USD revenue (one scalar `R`), NOT per-model attribution. Do not build a per-license
  revenue meter. See spec §"The crystal reduction".

### T2 — Go-live activation (the pipeline is dormant until this)
- **Alchemy key — NOW WIRED (2026-07-02).** The key was already in `.env` under the LEGACY name
  `ALCHEMY_KEY` (not the crystal `ALCHEMY_API_KEY`), so crystal was still using `nullPricer` despite
  it being present. `index.ts` now resolves `ALCHEMY_API_KEY ?? ALCHEMY_KEY ?? ALCHEMY_KEY_1` for the
  pricer + `weiToCredits`, and the webhook signing keys fall back through `ALCHEMY_SIGNING_KEY_MAINNET
  ?? _1 ?? ALCHEMY_SIGNING_KEY` (and `_BASE ?? _8453 ?? …`). **Live-probed:** `AlchemyPricer` prices
  1 ETH → ~$1703 against the real key — the pipeline lights up. Signing-key reconciliation also closes
  a prod hole (an absent per-chain key made the webhook SKIP HMAC validation).
- **Still TODO:** verify with a small real deposit on staging (`noemaplane`) end-to-end:
  deposit → priced → `Reditus` row (gross) + `Signum` credit (net 0.70) → balance shows.
- **[counsel]** confirm the Krea/Stability cap figures before T1's `CONDITIONAL_CAP_USD` is load-bearing.

### T3 — Frontend surface (SEPARATE, already handed off)
→ `docs/handoff/2026-07-02-deposit-buy-points-frontend-handoff.md`. §2A (quote API) is now ✅ done;
what's left there is wiring `Funding.tsx` + wallet connect. Independent of T1/T2 — can run in parallel.

### T4 — Loose ends (flagged, not blocking; close if scope allows)
- **Fiat/Stripe deposit path** — none exists in crystal; `Reditus.origo:'fiat'` has no producer.
  When built, it books revenue directly (no wei conversion) via the same `Redituum`.
- **`fmvSource` enrichment** — currently `alchemy:<token>`; add the block/timestamp when the oracle records it.
- **Gas in the quote UI** — informational network-fee line (belongs in T3's UI, not the webhook).
- **`forma:'eth'`** is reused for all CreditVault crypto deposits (valor is impetus now) — no per-asset forma; fine, note only.

## 3. Build order to CLOSE (T1 is the meat)
1. `CONDITIONAL_CAP_USD` + `activeConditionalCaps()` in `modelLicense.ts` (+ the `Intella` public-catalog query). Unit-test the min-binding logic.
2. `band()` + `onThresholdBand` seam (pure fn + a logger/ops hook). Unit-test the band edges.
3. Wire evaluation: a scheduled job (or a debounce after `Reditus.record`) that reads `trailingUsdRevenue(now)`, computes `bindingCap`, and fires `onThresholdBand` on transitions. Persist the last band so transitions are detectable across restarts.
4. Expose the rollup for the admin/accounting view (ties into the admin-workspace handoff, `2026-07-02-admin-workspace-accounting-and-approvals-handoff.md`).
5. Retire the `isCatalogEligible` comment (step 6).
6. T2: set `ALCHEMY_API_KEY`, staging verify. **[counsel]** cap figures.

## 4. Acceptance / go-no-go (T1)
- With a conditional model catalog-active and `R` seeded past 90% of its cap, the evaluator emits a `warn` band transition exactly once (edge-triggered, not per-tick).
- With NO conditional model catalog-active, `bindingCap = ∞` and the tripwire is dormant (no alerts).
- Pulling the last conditional model lifts the constraint (band → clear/dormant).
- `breach` (R ≥ cap while conditional-active) emits a loud, distinct incident signal.
- Step 6: `modelLicense.ts` no longer claims tracking exists as an aspiration.

## 5. Pointers
- Spec + its build order: `docs/spec/conditional-license-revenue.md`.
- Revenue book: `src/types/reditus.ts`, `src/ledger/MemoryRedituum.ts`, `src/crystal/MongoRedituum.ts` (`trailingUsdRevenue`).
- Policy anchor: `src/crystal/modelLicense.ts` (`isCatalogEligible`, `LICENSE_COMMERCIAL` — add `CONDITIONAL_CAP_USD` here).
- Deposit pipeline: `src/api/webhooks/alchemyWebhook.ts`, `src/crystal/AssetPricer.ts`, `src/ledger/depositFunding.ts`, `rates.ts`.
- Quote API: `src/allocutio/api/CrystalApi.ts` (`depositQuote`), `apiRouter.ts`, `apiContract.ts`.
- Adjacent handoffs: deposit-buy-points-frontend (T3), admin-workspace-accounting-and-approvals (the rollup's UI home), creditvault-referral-accounting (ADR-0013 §4c, the other USD-ledger consumer).
- ADRs: 0012 (the caps), 0013 (the USD ledger this feeds).
