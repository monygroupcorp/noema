# Spec — Conditional-license revenue tracking (crystal)

- **Status:** COMPLETE (2026-07-02) — **build-order steps 1–6 landed** (`Reditus` type +
  memory/Mongo stores + fail-closed FMV tests; FMV stamp wired live into the Alchemy deposit
  boundary; **the TRIPWIRE now exists**: `CONDITIONAL_CAP_USD` + `activeConditionalLicenses` +
  `bindingCapUsd` in `modelLicense.ts`, `band()`/`evaluateTripwire`/`startLicenseTripwire` +
  `onThresholdBand` seam in `crystal/licenseTripwire.ts`, persisted band `MongoTripwireBandStore`,
  the admin rollup `CrystalApi.revenueReport` → `GET /v1/admin/revenue`, evaluator scheduled every
  6h in `index.ts`, and the `isCatalogEligible` comment retired to point at the real watch; all
  hermetic-green, see §"Build order"). Booking + crediting go LIVE when `ALCHEMY_API_KEY` is set
  (Alchemy `AssetPricer` wired into both books); the tripwire is live regardless (it reads whatever
  the revenue book holds). Only **T2** remains (set `ALCHEMY_API_KEY`, staging verify, **[counsel]**
  cap figures). Reduces ADR-0013 §5 to its crystal
  core and defines the seam that makes `isCatalogEligible`'s "we track revenue against the
  conditional caps" true. Depends on the USD financial ledger (ADR-0013 §1–§2), which does **not
  yet exist** — this spec scopes the *minimum* slice of that ledger the license tripwire needs,
  so the two can be built together or the tripwire deferred behind the ledger.
- **Why:** `isCatalogEligible` (`src/crystal/modelLicense.ts:64`) admits `conditional` licenses
  (Krea 2 Community `<$1M` total revenue; Stability Community SD3/3.5 revenue/entity thresholds)
  into the public commercial catalog on the promise that we *watch the revenue and pre-negotiate
  an enterprise license before crossing the cap* (ADR-0012). Today that promise is unbacked: grep
  finds no USD ledger, no FMV stamp, no trailing-12mo rollup, no alert. The code comment overstates
  reality. This spec closes the gap or, if not built, tells us exactly what to stop claiming.
- **Anchors:** ADR-0013 (§1 two ledgers, §2 FMV-at-receipt, §5 trailing-12mo rollup + tripwire,
  §7 anon-in-aggregate), ADR-0012 (the caps), `docs/legal/compliance-landscape.md` §"Model license
  register", `src/crystal/modelLicense.ts` (`licenseCommercial` / `isCatalogEligible`).
- **NOT tax advice.** Follows ADR-0013's posture: capture the data any treatment needs; treatment
  decisions stay **[CPA]**.

## The crystal reduction — one number, not per-model attribution

The instinct is to attribute revenue *to the conditional model* (per-settle → license id → a
per-license revenue meter). **That is the wrong primitive for this problem.** Re-read the cap:

- **Krea 2 Community (ADR-0012):** commercial use is permitted only for entities under **$1M
  total company-wide revenue, all sources, trailing 12 months** — *not* revenue derived from Krea.
- **Stability Community:** binds on **entity revenue / headcount thresholds**, again a property of
  *us*, not of SD3 usage.

So the quantity the tripwire compares against every conditional cap is the **same single scalar**:
company-wide trailing-12-month USD revenue. Per-model revenue attribution (ADR-0013 §6) is a real
but **separate** concern — it exists for *royalty payouts*, and it must not be conflated with the
cap. The cap needs:

1. **`R` = one company-wide trailing-12-month USD revenue rollup** (ADR-0013 §5).
2. **A registry of active conditional caps** — for each conditional license *currently reachable in
   the public catalog*, the USD threshold it binds at.
3. **A tripwire** — `R` vs the **minimum active cap** (the tightest binding wins), emitting an alert
   band before the crossing so counsel can pre-negotiate.

No new per-settle attribution. No per-license revenue meter. The finer attribution stays where
ADR-0013 §6 already put it (royalties). This is the whole reduction: **the license tripwire is a
threshold check on the top-line USD number the tax posture already requires us to compute.**

## Substance vs. altitude

| Concern | Altitude (skip) | Substance (build) |
|---|---|---|
| Revenue quantity | per-license revenue meters | **one** company-wide USD rollup |
| FMV source | build our own oracle | pick one, **log source-of-record per event** (§2) |
| Anon deposits | per-user attribution | FMV stamp in **aggregate** only (§7) |
| Which cap binds | evaluate every license live per run | precompute **min active cap**, re-derive on catalog change |
| Alert delivery | full alerting platform | one seam (`onThresholdBand`) — wire to ops later |

## Data model — the minimum USD ledger slice

The full USD financial ledger is ADR-0013's own undertaking. The tripwire needs only its
**inbound-revenue** face. Model it as an append-only record, one per confirmed inbound payment,
distinct in unit and purpose from `Signum` (credits ≠ dollars — ADR-0013 §1).

```
Reditus  (Latin: "revenue / income that flows back", 4th decl.)
  — one row per confirmed inbound payment, USD-denominated.
  {
    id
    natum: timestamp            // receipt / block time (the trailing-window key)
    usdFmv: bigint              // USD fair-market-value AT RECEIPT, MICRO-USD (ADR-0013 §2); NOT the wei valor
    fmvSource: string           // price oracle / source-of-record id, logged per event (§2, §consequences)
    origo: 'crypto' | 'fiat'    // ETH/token deposit vs Stripe
    depositumId?: string        // crypto → FK to the on-chain Depositum (reconciliation + idempotency); fiat → none
    // NO identity required — anon ZK/Bursa deposits still land here (§7).
    // gross, not netted: referral 5% is a downstream expense, not a revenue reduction (ADR-0013 §4b).
  }
```

`Reditus` is deliberately thinner than the full ledger (no cost-basis lot inventory, no
gain/loss — those are ADR-0013 §3, a separate book). It is the **revenue book (Book 1) inbound
face** and nothing more. It is the SECOND ledger of ADR-0013 §1 ("two ledgers, not one"),
distinct from both `Signum` (credits) and `Depositum` (on-chain deposit tracking) — see the stamp
seam below for the `Depositum` relationship.

### The stamp seam (ADR-0013 §2, §7 — the enforced invariant)

> **Correction (integration audit, 2026-07-02).** An earlier draft said the FMV stamp "rides the
> `deposit_confirmed` Nexus event." That was wrong in three ways: (1) Nexus hooks are **pure** —
> they return `Signum` entries, they do not write DB, so a `Reditus` cannot be recorded inside one
> (`src/ledger/Nexus.ts`); (2) `deposit_confirmed` is **emitted nowhere** in crystal today (the
> `referralSplitHook` wired to it at `index.ts` is dead); (3) the real deposit boundary already
> exists and already holds a price source. The seam below reflects the real code.

The FMV stamp is a **peer-write of the Signum issuance at the deposit-confirmation call site** —
today the two handlers in `src/api/webhooks/alchemyWebhook.ts`:

- `handlePaymentDepositLog` (identified ETH) already: OFAC-screens the funder → writes a
  `Depositum` → issues the `forma:'eth'` Signum → and carries **`deps.ethPriceUsd`**, the FMV
  source. The `Reditus.record(...)` call sits right beside the `signorum.issue(...)`, with
  `usdFmv = f(deposit.valor_wei, ethPriceUsd)`, `fmvSource = <oracle id>@<block>`,
  `depositumId = depositum.id`.
- `handleAnonymousDepositLog` (anon ZK/Bursa) — same peer-write; no `animaId` (§7).
- A future **fiat/Stripe** handler (none exists in crystal yet) records `origo:'fiat'`, `usdFmv`
  = the charge amount directly, `fmvSource` = the Stripe charge id, no `depositumId`.

Rules the seam must honour:

- **Revenue is recognized at RECEIPT** (deferred-revenue design, ADR-0013 §4) — so a `Reditus` is
  written **even when the funder's Anima is not yet linked** (the `confirmatum`-without-anima
  case). Revenue recognition ≠ credit issuance; do not gate it on wallet linkage.
- **NOT written for OFAC-quarantined (`fractum`) deposits** — no value is recognized on funds we
  refuse to credit.
- **Idempotent on `depositumId`** — Alchemy re-delivers webhooks; the handler already guards
  `existing?.status === 'processatum'`, and `record()` additionally de-dupes on `depositumId` so
  a re-delivery cannot double-count revenue.
- **`usdFmv` is derived, never the raw `valor`** — `Depositum.valor` is **wei**; multiply by the
  FMV price to micro-USD. Recording the wei as if it were USD would be a ~$3000×-scale error.

- **Invariant (test-enforced, ADR-0013 §consequences):** no inbound payment is recorded without a
  `usdFmv` and an `fmvSource`. Fail-closed: a deposit whose FMV cannot be priced is a hard error on
  the deposit path, not a silent zero. Enforced in `Redituum.record()` (see
  `tests/unit/ledger/MemoryRedituum.test.ts`).
- **Anon (§7):** ZK/Bursa deposits carry no `animaId`; they still write a `Reditus`. Anonymity
  limits per-user reporting, never the top line.
- **Gross (§4b):** the referral 5% routed on-chain is a marketing **expense**, booked elsewhere;
  `usdFmv` is the **gross** purchase amount. The cap counts gross.

## The rollup — `R`

```
trailingUsdRevenue(now) = Σ Reditus.usdFmv  where  Reditus.natum ∈ (now − 12 months, now]
```

- A real query/report, not a manual reconstruction (ADR-0013 §5). Sum over a 12-month sliding
  window keyed on `natum`.
- Currency of truth is **USD** throughout; crypto is already reduced to USD FMV at the stamp.
- Cheap: a single indexed range-sum. No per-model grouping (that's the point of the reduction).

## The conditional-cap registry

Extend the license classification (`modelLicense.ts`), which already knows each license id's
`conditional` verdict, with the **USD cap** the conditional binds at:

```ts
// modelLicense.ts — alongside LICENSE_COMMERCIAL
const CONDITIONAL_CAP_USD: Record<string, number> = {
  'krea-community':      1_000_000,   // ADR-0012: <$1M total company revenue, trailing 12mo
  'stability-community': 1_000_000,   // SD3/3.5 — entity revenue threshold [verify exact figure/counsel]
  // 'yes' licenses have no cap; 'no'/'unknown' never reach the catalog so never bind.
}
```

- **[counsel]** the exact Stability figure and whether it is revenue-or-headcount must be
  confirmed against the current Stability Community License text before this is load-bearing;
  ship it as `verify` in the register until then.
- Keeping the cap next to `LICENSE_COMMERCIAL` keeps `modelLicense.ts` the single source of truth
  for "what does this license permit and at what ceiling" — no new noun.

### Which caps are *active*

A cap only binds if a model under that license is **actually reachable in the public commercial
catalog** — i.e. some `Intella` with that license has `commercialUse ∈ isCatalogEligible` and is
publicly listed. The tripwire computes:

```
activeCaps   = { CONDITIONAL_CAP_USD[lic] : lic used by a public-catalog Intella }
bindingCap   = min(activeCaps)            // tightest ceiling wins; ∞ if none active
```

Re-derived when the catalog changes (a promotion / delist / license clearance), not per run. If no
conditional model is catalog-active, `bindingCap = ∞` and the tripwire is dormant — pull the last
conditional model and the constraint lifts.

## The tripwire

```
band(R, cap):
  R / cap  < 0.75  → 'clear'
  ∈ [0.75, 0.90)   → 'watch'    // start counsel/enterprise-license conversation
  ∈ [0.90, 1.00)   → 'warn'     // pre-negotiate NOW (ADR-0012: license BEFORE crossing)
  ≥ 1.00           → 'breach'   // over cap while a conditional model is catalog-active — compliance incident
```

- **Seam, not a platform:** one hook `onThresholdBand(prev, next, { R, bindingCap, licenses })`
  fires on band *transitions* only (edge-triggered, no per-run spam). Initial wiring: log + ops
  alert. Later: auto-open a task, gate new conditional promotions at `warn`, etc. — out of scope
  here.
- **Evaluated** on a cheap cadence (a scheduled rollup, or debounced after a `Reditus.record`),
  not on the hot run path.
- **`breach` is a real incident:** we are commercially serving a conditional model over its cap.
  The response is a **[counsel]** runbook (enterprise license in place? delist the model?), not an
  automatic teardown — but it must be loud.

## What this spec deliberately does NOT do

- **No per-license / per-model revenue meter.** The cap is company-total; attribution is a
  different problem (ADR-0013 §6, royalties).
- **No cost-basis / gain-loss book.** That is ADR-0013 §3, a separate ledger, not needed for the cap.
- **No FMV oracle implementation.** Pick a source-of-record and log it; the oracle choice is
  ADR-0013 §consequences item 5, **[CPA]**-adjacent.
- **No enforcement action on breach beyond the alert.** Gating/delisting policy is counsel's call.

## Build order (when green-lit)

1. ✅ **DONE (2026-07-02)** — `Reditus` type + `Redituum` store, thin: `{ natum, usdFmv, fmvSource, origo, depositumId? }`.
   `src/types/reditus.ts`, `src/ledger/MemoryRedituum.ts`, test `tests/unit/ledger/MemoryRedituum.test.ts`
   (in the hermetic suite). USD is bigint **micro-USD** (no float drift vs the $1M cap). Fail-closed
   FMV invariant + `depositumId` idempotency enforced in `record()`; trailing-12mo rollup implemented.
   **`MongoRedituum` DONE** (`src/crystal/MongoRedituum.ts`, test `tests/unit/crystal/MongoRedituum.test.ts`,
   in `test:crystal`) — bigint↔string round-trip + idempotency via a **unique partial index on
   depositumId** (concurrency-safe, not a JS scan); LIVE-verified 5/5 against `noemaplane_test`.
2. ✅ **DONE (2026-07-02)** — wired the FMV stamp into the **real deposit boundary**
   (`src/api/webhooks/alchemyWebhook.ts` handlers, NOT a Nexus hook). `Ring.redituum` constructed
   in `src/container.ts` (`reditus` collection) + indexes in `ensureIndexes.ts`; added to
   `AlchemyWebhookDeps` + assembled in `src/index.ts`. `weiToMicroUsd()` + `bookRevenue()` helpers;
   `record()` is a peer of `signorum.issue`, run while the deposit is still `confirmatum` (retry-safe),
   recognized at receipt even without a linked Anima, **skipped for `fractum`/OFAC**, idempotent on
   `depositumId` (also fixed a latent duplicate-`Depositum` on re-delivery by reusing the existing
   `confirmatum` record). Anon deposits book in aggregate (§7), no `depositumId`.
   **Price oracle + buy-conversion NOW BUILT (2026-07-02):** `AssetPricer` (`src/crystal/AssetPricer.ts`)
   = Alchemy Prices (ETH by-symbol reusing `arcanum/ethPrice`, ERC-20 by-address + metadata decimals),
   returns micro-USD or `null`; injected in place of the `ethPriceUsd` stub. The single price forks:
   `Reditus.usdFmv = grossUsd` (revenue) **and** `Signum.valor = usdMicroToImpetus(applyFundingBps(gross,
   fundingBps(token)))` — the parity fix (was raw wei). **Policy decided:** open acceptance at
   `DEFAULT_FUNDING_BPS=7000` (0.70) with a per-asset override table (`src/ledger/depositFunding.ts`,
   favored assets at par); canonical `$0.000337` (`MICRO_USD_PER_IMPETUS=337n` in `rates.ts`).
   Unpriceable → deposit parked `confirmatum`, no credit, no revenue, loud (never a silent zero).
   Live when `ALCHEMY_API_KEY` set (else `nullPricer`). Tests: `AssetPricer.test.ts` (6) + webhook 22–28.
   No user-facing buy-quote surface yet (doesn't exist). No fiat/Stripe path yet.
3. ✅ **DONE (2026-07-02)** — the `trailingUsdRevenue(now)` rollup (already on the Mongo store) is
   surfaced read-only via `CrystalApi.revenueReport` (platform-admin) → `GET /v1/admin/revenue`,
   returning `R` (micro-USD + formatted), the live `band`, the binding cap, active conditional
   licenses, and the last persisted band. OpenAPI-documented (drift-checked).
4. ✅ **DONE (2026-07-02)** — `CONDITIONAL_CAP_USD` (whole USD) + `conditionalCapUsd` +
   `bindingCapUsd` (min-binding, null=dormant) + `activeConditionalLicenses` (public-catalog query
   over model views: public/canonica ∧ conditional ∧ capped) in `modelLicense.ts`. Unit-tested.
5. ✅ **DONE (2026-07-02)** — `band()` (pure bigint ratio, edge tests) + `evaluateTripwire`
   (reads `R`, computes binding cap, fires `onThresholdBand` on band TRANSITIONS only, suppresses the
   dormant baseline, persists via `TripwireBandStore`) + `startLicenseTripwire` (6h cadence, mirrors
   `startSubsidySweeper`) in `crystal/licenseTripwire.ts`. Default seam `logThresholdBand` (breach =
   `log.error`, LOUD). Persisted band = single-doc `MongoTripwireBandStore` (`license_tripwire`
   collection) so transitions survive restarts. Wired in `container.ts` (`ring.tripwireBand`) +
   `index.ts`. Unit-tested: dormant/no-alert, null→watch, idempotent-same-band, watch→warn→breach,
   delist→clear, restart persistence.
6. ✅ **DONE (2026-07-02)** — the `isCatalogEligible` doc comment now points at the real tripwire
   (`licenseTripwire.ts` + `CONDITIONAL_CAP_USD`) instead of the aspirational "we track revenue".

## Consequences

- **Truthful comment:** step 6 retires the current overstatement. Until built, the honest state is
  "conditional passes the gate; the revenue tripwire is specced (this doc) but not built" — say
  that, don't imply tracking exists.
- **Enforced by:** the fail-closed FMV-stamp test (ADR-0013 §consequences) — the same test the
  full USD ledger needs, so no wasted work.
- **Cheap to run:** one indexed range-sum + a min over a tiny active-cap set; nothing on the hot
  path.
- **Gas deduction — deliberately NOT in the webhook (decided 2026-07-02).** Legacy deducts the
  user's deposit-tx gas, but only in its PRE-deposit `/quote`. Post-deposit (the webhook) is the
  wrong place: it would dock the user twice for gas they already paid to the network, and zero-out
  small deposits (mainnet gas can exceed a small deposit's net value) for funds already received.
  Gas belongs in the future user-facing buy-QUOTE surface (informational, before the user sends).
  The webhook stays gas-free; the funding rate is the buffer. (The arcanum `weiToCredits` credit
  path was RECONCILED 2026-07-02 to the same canonical `$0.000337` + funding, so the anon Bursa mint
  and the identified deposit agree — 0.001 ETH @ $3000 → 6231 impetus on both.) Full detail: memory
  `project_deposit_pricing_parity`.
- **Open / [counsel]:** exact Stability Community threshold + semantics (§registry); whether
  `warn` should hard-gate new conditional promotions; the `breach` runbook.
- **Coupling:** `Reditus` is the inbound face of ADR-0013's USD ledger — build it as that ledger's
  projection, never a parallel store, when the ledger lands.
- **The FMV oracle is a SHARED per-asset pricer, not an ETH-only stub (finding 2026-07-02).** The
  same `price(token) × amount = grossUsd` fetch that stamps `Reditus.usdFmv` (revenue = gross) also
  drives the **credit issuance** (`Signum.valor = floor((grossUsd × fundingRate − gasUsd) / $0.000337)`
  impetus). Legacy uses the **Alchemy Prices API** (`by-symbol`/`by-address`) + CoinGecko — the only
  multi-asset source (Chainlink lacks feeds for the memecoins/NFTs accepted). Per-asset `fundingRate`
  (ETH 0.7, favored NFTs 1.0…) is the gross-vs-retained-margin lever (ADR-0013 §4b). So `bookRevenue`'s
  `ethPriceUsd`/`fmvSource` placeholder should become this shared pricer, built once. **Severe latent
  bug:** the crystal deposit path currently issues `Signum.valor = raw wei` (~11 orders of magnitude
  off the correct impetus) — a go-live blocker. Full detail: memory `project_deposit_pricing_parity`.
