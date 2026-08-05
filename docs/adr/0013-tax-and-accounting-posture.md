# ADR-0013: Tax & accounting posture — crypto revenue, cost basis, and threshold tracking

- **Status:** proposed
- **Date:** 2026-07-02
- **Related:** ADR-0012 (licensing — the $1M Krea cap and model-royalty splits that this accounting must feed)

## Context

Going pro forces real books. Multiple obligations all reduce to *the same accounting
gap*: we cannot presently answer "what is our USD revenue, trailing twelve months?" —
which is required by:

- **The Krea 2 commercial cap** (ADR-0012): total company-wide revenue, all sources,
  trailing 12 months, measured in **USD**.
- **Income tax** on revenue and on crypto disposals.
- **The MSB/securities posture** (closed-loop credits), which depends on how received
  funds are classified.
- **Royalty splits** (`modelRoyaltyHook`, Editio) and any future contributor/creator
  payout reporting.

The core complication is **crypto**. Users fund credits by sending ETH/tokens to the
CreditVault (including anonymous ZK/Bursa deposits). In the US and most jurisdictions
**crypto is property, not currency**, so accepting it creates a *two-book* problem that
fiat does not.

The current `Signum` ledger tracks **internal credits** (platform units), which is **not**
the same as **USD revenue recognized** or **crypto cost basis**. That unit mismatch is the
gap this ADR closes.

**This ADR is engineering policy and a scaffold for a crypto-literate CPA + counsel. It is
NOT tax advice.** Items marked **[CPA]** are treatment decisions to be confirmed with a
professional; the ADR's job is to guarantee we *capture the data* any treatment requires.

## Decision

### 1. Two ledgers, not one. Keep `Signum` for credits; add a USD financial ledger.

`Signum` remains the internal credit ledger (what users hold/spend). Introduce a separate
**USD-denominated financial ledger** that records real-money events. They reconcile but are
distinct units and distinct purposes. Never conflate "credits" with "dollars."

### 2. Stamp USD fair-market-value at receipt on every inbound payment.

Every crypto deposit records the **USD FMV at block time** (the price at the moment of
receipt). This single number does double duty:

- it is the **revenue amount** (Book 1), and
- it becomes the **cost basis** of the crypto asset now held (Book 2).

Fiat deposits (Stripe, etc.) record their USD amount directly. A price-oracle/source of
record for FMV-at-time must be chosen and logged with each event (auditability).

### 3. Track crypto as property: per-lot cost basis + realized gain/loss on disposal.

Held crypto is an asset carried at its FMV-at-receipt basis. On any **disposal**
(conversion to fiat, spend, transfer out) compute **realized gain/loss = proceeds −
basis**, using a documented lot-selection method (**[CPA]**: FIFO vs specific-ID). This is
a **second** taxable event distinct from the revenue in §2. Requires per-lot inventory of
inbound crypto.

### 4. Revenue recognition follows the closed-loop refundability design. **[CPA]**

The classification of received funds is downstream of one product decision:

- **Non-refundable, closed-loop, non-withdrawable credits** (our MSB-avoidance posture) →
  received crypto/fiat is **our asset**; unspent credits are a **deferred-revenue
  liability** (we owe service, not money). Normal business accounting. **This is the
  intended design and the one that keeps the books simple.**
- **If credits were ever refundable/withdrawable** → we would be **custodying user funds**
  → segregated/**trust accounting** (off our P&L) *and* MSB/money-transmitter exposure.

Decision: **commit to non-refundable closed-loop credits** so the accounting is
deferred-revenue, not fiduciary trust. **[CPA]** to confirm recognition timing
(on-sale vs on-consumption of credits).

### 4b. Referral is gross revenue + a promotional rebate (superseded by §4c decision). **[CPA]**

> **Updated 2026-07-02:** the on-chain crypto slice is **removed** (§4c) — referral now pays
> spend-only credits. The analysis below is retained for the principal-vs-agent reasoning,
> but the "commission expense at FMV / referrer has taxable income" framing is replaced by
> the **rebate** treatment in §4c.

Substance-over-form / principal-vs-agent: on **credit-purchase referrals** we set the price
and provide the service → we are the **principal** (this is why the launchpad "non-custodial
facilitator" posture does NOT apply to credit sales — it may apply to marketplace/mint/x402
flows; see §4d). Therefore:

- **Revenue = the GROSS purchase amount (100%).** With the on-chain slice removed, the full
  payment now enters our wallet cleanly (no diverted 5%), so gross-revenue recognition is
  simpler than before.
- **The 5% referral reward is a promotional/rebate cost in internal credits** (§4c), not a
  crypto commission. Spend-only ⇒ rebate character ⇒ minimal payee-reporting surface.
- **Krea-cap impact:** the cap still counts the **gross** 100%.
- **Cost basis:** the full inbound amount is now custodied → tracked per §3.

### 4c-0. UNIFYING RULE: all in-app payouts are spend-only credits; real money is launchpad-only. **[DECIDED 2026-07-02]**

**Every internal payout surface pays spend-only platform credits** — referral rewards AND
creator model-royalties (`modelRoyaltyHook`/Editio) and any other in-app earning. No cash/
crypto payouts happen on NOEMA's own books. This makes the **entire internal payout surface
a rebate/loyalty system**: no 1099/W-9/payee-reporting, no MSB payout exposure, anonymity
preserved, books stay closed-loop (deferred revenue + spend-only credits).

**Creators who want REAL MONEY create a collection and are pushed to the launchpad**, where
NOEMA is a **non-custodial facilitator** (§4d): the collection/mint contract splits on-chain
**directly** to creator + a separated NOEMA fee — NOEMA never custodies the creator's
proceeds. The creator bears their own tax; NOEMA's revenue is the **fee only**.

**Rail symmetry (custody is the trigger):**
- *Credit sales — NOEMA is principal* → NO on-chain split; full payment to NOEMA; earning paid in credits (§4c).
- *Launchpad — NOEMA is facilitator* → on-chain peer-to-peer split IS correct; creator paid directly; NOEMA takes fee only.

**Guardrails:** (1) in-app credits must be **non-withdrawable-to-cash** or they revert to
compensation; (2) the launchpad split must be **genuinely non-custodial** (never route the
creator's cut through a NOEMA-controlled balance) or we fall back to payer/transmitter; (3)
the launchpad rail may trigger **1099-DA broker reporting** — a different regime than
1099-NEC, not zero reporting — **[CPA/counsel]** to scope when built.

### 4c. Referral pays SPEND-ONLY CREDITS; the on-chain crypto slice is removed. **[DECIDED 2026-07-02]**

**Prior problem (now moot).** The CreditVault split 5% **directly on-chain at purchase**,
which (a) paid before any gate could run, (b) created a **double-pay** (contract 5% crypto +
crystal `referralSplitHook` 5% internal credit), and (c) put us in *commission-payment*
territory (§4b/§6b: 1099/W-9/$600 gate, breaking anonymity).

**Decision.** **Remove the on-chain crypto slice entirely and pay referral rewards as
internal, spend-only platform credits.** Rationale:

- **Changes the tax character.** A crypto slice is a cash *commission* (payee-reporting
  surface). Spend-only credits usable only on the platform are closer to a **loyalty/rebate
  reward** (airline-miles / card-points model) — commonly treated as a **purchase-price
  rebate, not compensation income**, so the referral **1099/W-9/$600 payout gate largely
  dissolves.** `[CPA]` to bless the rebate characterization.
- **Collapses the double-pay.** The existing `src/ledger/hooks/referralSplit.ts` (5% internal
  `reward` signum on `deposit_confirmed`, wired `src/index.ts:459`) becomes the **single
  mechanism** — already built and wired.
- **Stays inside the closed loop** → consistent with the MSB-avoidance posture (§4);
  no money leaves the system; referrer anonymity preserved (no forced W-9).

**The one guardrail that keeps this true:** referral credits must be **genuinely spend-only
/ non-withdrawable-to-cash.** The moment a referrer can cash out, it reverts to
*compensation* and the §6b surface returns. Frame it as "reward for referring, spent on the
platform," never "payment for services."

**Contract change (now trivial).** Delete the referral transfer from `_processPayment`
(`contracts/src/CreditVault.sol` L272–282); `protocolAmount` becomes the full `amount`.
In-place UUPS upgrade (L290), no redeploy, storage-layout preserved. No accrual-withdrawal
gate, no identity/withholding layer needed for referrals.

**Creator royalty payouts — resolved by §4c-0.** `modelRoyaltyHook`/Editio royalties also pay
**spend-only credits** in-app (rebate, no surface). Creators wanting real money go to the
**launchpad** (non-custodial facilitator, §4d). So there is **no cash-royalty payout on our
books** and thus no W-9/$600 gate anywhere in the internal system.

### 4d. Tax character differs by flow: principal vs. non-custodial facilitator. **[CPA/counsel]**

Not one flat rule — the payee-reporting/revenue surface depends on whether, for a given
flow, we are the **principal seller** or a **non-custodial facilitator** (how NFT launchpads
justify their light posture):

- **Credit sales (our own compute/service)** → we are the **principal** (set price, provide
  service). Facilitator posture does NOT apply. Referral there is handled by §4c (spend-only
  credits ⇒ rebate).
- **Editio marketplace / mint / user-to-user model sales** → if the contract splits
  **peer-to-peer and we never take custody/title**, taking only a clearly-separated fee, the
  **facilitator** characterization may apply → smaller surface (our revenue = fee only).
- **x402 pass-through** (lower priority) → true pass-through we never take title to is **not
  our revenue** — only our fee is (also shrinks the Krea-cap number). **Resolved by Addendum A
  (2026-07-03):** the facilitator/pass-through split was rejected for the operator/degen
  flagship; x402 is currently the **principal + credits-rebate** rail, and real-USDC is
  reserved for arms-length B2B partners behind CPA/counsel sign-off.

Substance over labels: to claim facilitator treatment, the flow must actually be
non-custodial (contract-level split, separated fee, no routing through our balance) — you
design the flow to match the posture, not label it after.

### 6b. (was §6) — Payee reporting (1099) vs. anonymity. **[CPA]**

We owe information reporting on people we **pay**, not people who **buy from us**:

- **Credit-buying customers → never 1099'd** (they are customers, not payees).
- **Payees ≥ $600/yr → 1099-NEC territory**: referrers (§4b), creators earning royalties
  (`modelRoyaltyHook`/Editio splits), contractors — when US persons. Collect **W-9 before
  paying**.
- **Anon tension:** paying a pseudonymous wallet with no TIN cannot be 1099'd and can
  trigger **backup-withholding**. → **Payouts to US persons realistically need an
  identity/W-9 step at payout time**, even inside an otherwise-anonymous system. This is a
  design constraint on the earnings/referral payout path, not a detail.

### 6c. Customer-facing tax documents are a feature we provide (not their bookkeeping).

Once the USD ledger exists, surface — for business users — cheap, high-value docs:

- **Purchase invoices** (our legal entity + EIN, date, USD amount, description, and any
  tax/VAT line per §consequences) so business customers can **expense credit purchases**.
- **Earnings statements** for creators/referrers to report their own income (data we
  already hold for our §6b reporting).
- **Out of scope:** acting as the user's bookkeeper/accountant. We issue clean documents;
  we do not keep their books.

### 5. Trailing-12-month USD revenue is a first-class, queryable rollup.

The financial ledger must answer "total USD revenue, trailing 12 months, all sources" on
demand — this is the Krea-cap tripwire and a tax primitive. Build it as a real query/report,
not a manual reconstruction. Emit an alert as the figure approaches the $1M Krea threshold
(pre-negotiate the enterprise license *before* crossing, per ADR-0012).

### 6. Attribution for royalties and payouts.

Revenue tied to a specific model/owner (Editio royalties, `modelRoyaltyHook`) is tagged so
per-owner payout totals are derivable — needed for correct splits and any future
contractor/creator tax reporting (1099-class). **[CPA]** on reporting obligations.

### 7. Anonymous flows are accountable in aggregate.

ZK/Bursa anonymous deposits still record **USD FMV at receipt** — identity is not required
for revenue/cap/tax totals, which are aggregates. Anonymity only limits *per-user*
reporting, not the top line. No anon deposit may bypass the FMV stamp.

## Consequences

- **Enforced by:** the USD financial ledger + FMV-stamp-at-receipt become required on every
  inbound-payment path (crypto and fiat, incl. anon); a test asserts no deposit is recorded
  without a USD FMV and price-source. The trailing-12-month rollup gets a report + threshold
  alert.
- **Easier:** we can actually *know* when we cross the Krea cap / tax thresholds; crypto
  gain/loss is computable at year-end instead of reconstructed; royalty splits are auditable.
- **Harder / open — needs a crypto CPA + counsel (do not ship treatment on assumptions):**
  1. **[CPA]** Revenue recognition timing (on-sale vs deferred-until-consumed).
  2. **[CPA]** Crypto lot method (FIFO vs specific-ID) and disposal accounting.
  3. **[CPA]** Entity, jurisdiction, and whether digital-goods **sales tax / VAT** applies
     to credit sales (varies by buyer location — a large open question for a global user base).
  4. **[CPA/counsel]** Confirm the closed-loop non-refundable design holds the MSB/securities
     line *and* the deferred-revenue treatment simultaneously.
  5. Choose the FMV price oracle / source of record and log it per event.
  6. Build the USD financial ledger + rollup; wire the FMV stamp into every deposit path.
- **Not tax advice.** This ADR captures the data model and the decisions to bring to a
  professional; it does not determine tax treatment.

## Addendum A — x402 agent payout: real-money slice removed; agent monetization is credits-only. **[DECIDED 2026-07-03]**

Resolves the `x402 pass-through` line deferred as "lower priority" in §4d, and applies the
§4c-0 unifying rule to the whitelabel on-chain-agent flow (ERC-8004 agents calling a NOEMA
`modus` and paying via x402/USDC).

**What was in the code (now removed).** The x402 path booked the agent's slice —
`margin (price − serve cost) − fee` — into a **USD-denominated payout book (`Merces`/
`Mercedum`)** via `accruePayeePayout`/`accrueAgentCut`, gated at $600/yr. That is the
**money-OUT / 1099 model**, which contradicts §4c-0. Nothing ever disbursed
(`setStatus('paid')` had no callers; W-9 collection was an unwired seam), so it was a
**scaffolded liability with no live rail** — and it double-paid (below).

**Decision. Remove the USD money-out entirely. Agent monetization on x402 is the closed-loop
credits royalty, and nothing else.** The x402 run mints the paid impetus onto the agent's
Anima and dispatches through the **normal execution path** (`runSpell` → `invokeFlow`);
completion emits `execution_spend`, which already fires `spellRoyaltyHook` (10% of impetus in
spend-only `reward` credits to the modus author = the agent) and `modelRoyaltyHook`. Therefore:

- The agent already earns a **closed-loop credits royalty automatically** — no build, no new
  hook; x402 inherits the same royalty as every other run.
- The `Merces` accrual was a **second, parallel payout** stacked on the credits one — the same
  double-pay anti-pattern removed from CreditVault (§4c). Deleting it fixes the double-pay.

**Rail placement (substance over form).** With the money-out gone, x402 agent calls sit on the
**principal + credits-rebate rail**, identical in posture to ordinary credit sales (§4c-0 rail
symmetry): the caller's full USDC settles to NOEMA (`X402_PAY_TO`) as our revenue; the agent's
reward is spend-only credits (rebate). It is **NOT** the launchpad/facilitator rail — we did
not adopt an on-chain split, so no fee-only / non-custodial characterization applies here.

**Why the real-money (on-chain split-at-source) alternative was investigated and rejected.**
We evaluated paying the agent's slice as real USDC via a splitter-as-`payTo` (the §4d
facilitator posture):

- *Technically feasible.* EIP-3009 / x402 "exact" is single-recipient (one `to` = `payTo`,
  `transferWithAuthorization`), and x402 V2 "dynamic payTo" is per-request single-address — so
  native multi-recipient does not exist, **but** `payTo` may be a contract, so an immutable
  non-custodial splitter (e.g. 0xSplits on Base) achieves a source-split. Margin variance is
  manageable via per-`(modus × cold/warm/duration)` split buckets plus a **quote-time floor
  check** (never settle where NOEMA's share < serve cost, so a loss is impossible on any
  settled call).
- *But the posture does not hold for our case.* The facilitator/non-custodial defense (§4d)
  requires (a) NOEMA is **not** the operator and (b) a separate party bears any
  merchant-of-record / reporting role. In the **flagship, NOEMA is the collection's
  developer/operator**, and both the agent holders and the collection-makers are
  **pseudonymous degens who will not KYC**. That stacks four problems at once: **§6050W/1099-K
  (TPSO)** on a payment network we operate; **backup withholding** we cannot satisfy against
  anonymous wallets; a **KYC gate the audience rejects**; and — because we would be paying
  **our own NFT holders real money based on platform usage** — a **Howey/securities**
  characterization (yield-bearing NFT) that cuts directly against the closed-loop MSB/
  securities posture (§4, §4c-0). The entity-shuffle that rescues §4d (push operator/reporting
  onto an arms-length partner) is **unavailable when we are the operator and the counterparties
  are anonymous.**

**Reserved, not deleted.** The real-USDC split stays a **future B2B feature for a genuine
arms-length business partner** — a real company that will be merchant-of-record/operator and
own its holders' tax + securities exposure — implemented as a **partner- or agent-owned**
immutable non-custodial split (NOEMA takes a separated fee only). That, and only that, is the
§4d facilitator posture. It ships **behind explicit [CPA/counsel] sign-off** (below); not now.

**How opt-in would work if that B2B path is ever taken.** Real-USDC payout must be **opt-in**,
because opt-in is the enrollment chokepoint that turns an anonymous wallet into an identifiable,
reportable payee (collect W-9/W-8 there, wire the scaffolded `hasTaxDocs`/`onBand` gate). It
de-risks both outcomes without forcing the legal call up front — but match the record depth to
the posture counsel blesses (light attestation for conduit; full W-9 + withholding if we accept
payer status), since collecting heavy records also self-characterizes us as the payer.

**Code removed (teardown 2026-07-03).** `accrueAgentCut` wiring (`src/index.ts`,
`src/allocutio/api/x402AgentRouter.ts`), `accruePayeePayout`/`agentCutMicro`, the `Merces`/
`Mercedum` type + `MongoMerces`/`MemoryMerces` stores, `container.ts` plumbing +
`mercesCollection`, and the `mercedes` indexes in `ensureIndexes.ts`, plus their unit tests.
The existing `mercedes` Mongo collection (dormant, never-disbursed accruals) is left in place to
drop manually; no value was ever paid, and agents received credits regardless.

**Guardrail (unchanged from §4c-0).** The credits royalty must remain
**non-withdrawable-to-cash / non-transferable**, or it reverts to compensation and the entire
payee-reporting + securities surface returns.

**[CPA/counsel] — required before any real-money agent payout ships:**

1. **§6050W / TPSO** — does operating the widget / rails / pricing make NOEMA a third-party
   settlement organization *even under a partner-owned non-custodial split*? This single answer
   gates real-USDC vs. credits-only.
2. **1099-K / backup withholding** — reporting + TIN obligations if (1) is yes.
3. **Howey / securities** — paying NFT holders real money based on platform usage as a
   yield-bearing instrument; the closed-loop credits model is the mitigation.
4. Confirm the credits-royalty rebate/loyalty character (per §4c) extends to the agent-usage
   royalty, not just referral.
