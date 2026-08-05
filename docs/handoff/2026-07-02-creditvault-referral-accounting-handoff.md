# Handoff — Implement ADR-0013: referral payout gate + USD revenue accounting

- **Date:** 2026-07-02
- **ADR:** `docs/adr/0013-tax-and-accounting-posture.md` (esp. §4c referral gate, §5 USD rollup, §6b payee reporting)
- **Blocked by JS teardown?** **NO — but gated by a CreditVault CONTRACT change (on-chain).** The 5% split lives in the Solidity contract's `_processPayment`. Good news: the contract is **UUPS-upgradeable in place** (`contracts/src/CreditVault.sol` L290), so the fix is a localized new-implementation upgrade at the same address — no redeploy, no address migration. See §2A / §5.

> **DECISION 2026-07-02 (simplifies this whole handoff):** the on-chain crypto referral
> slice is being **REMOVED**; referral rewards pay **spend-only internal credits** (rebate,
> not commission — ADR-0013 §4c). Consequences: task A shrinks to "delete the split from
> `_processPayment`"; the existing `referralSplitHook` becomes the sole mechanism (double-pay
> gone); **the referral payout gate / W-9 / $600 machinery in task B is NO LONGER NEEDED for
> referrals** (kept only if creator *royalty* payouts pay real money — a separate flow).
> Guardrail: credits must stay non-withdrawable-to-cash or the surface returns.

## 0. Ground rules (non-negotiable)
- Crystal-first. Do not add nouns that an existing primitive (`Signum`, `Anima`, ledger hooks) already carries.
- Pin DB to `noemaplane` / `noemaplane_test`. Never `noema` (prod). Never restart `hyperbot-staging` mid pod-run.
- **[CPA]-marked items are treatment decisions — build the DATA CAPTURE, do not hard-code a tax treatment.** This is not tax advice.

## 1. What is already TRUE in the code (verified 2026-07-02 — do not rebuild)
- **The 5% split is embedded IN THE CREDITVAULT CONTRACT (on-chain, live).** Source: `contracts/src/CreditVault.sol`, `_processPayment` (**L261–288**): `referralAmount = amount * bps / 10000` (**L270**) then **transferred on-chain** to `referralAddress[key]` — ETH via `recipient.call{value:...}` (**L277**), ERC20 via `SafeTransferLib.safeTransfer` (**L280**); protocol keeps the remainder (**L285**). Default cut `defaultReferralBps = 500` = 5% (**L40, L102**), per-referrer overridable up to 50% (`MAX_REFERRAL_BPS = 5000`, **L24**) via `setReferralBps` (**L181**). ADR-0013 §4c is therefore **NOT done** — the accrue-and-gate model cannot be enforced while the contract pays irreversibly on-chain.
- **GOOD NEWS — the contract is UUPS-upgradeable in place.** `UUPSUpgradeable` + `_authorizeUpgrade(address) onlyOwner` (**L290**) + `Initializable`/`initialize` (**L100**). The fix is a **new implementation upgrade at the same proxy address — NO new deploy, NO deposit-address migration.** Removes the biggest cost worry.
- **Referrals are IDENTIFIED-PATH ONLY.** `pay`/`payCoin` carry a `referralKey`; the anonymous entrypoints `payAnonymous`/`payCoinAnonymous` (**L132–149**) take only a commitment and do **no** referral split. So the referral/1099 tension never touches the anon/Bursa path — it's purely the identified deposit flow.
- **DOUBLE-PAY is real and mixed-asset.** The contract emits `Payment(payer, referralKey, ..., referralAmount)` (**L287**) AND `src/ledger/hooks/referralSplit.ts` credits a **5% internal `reward` signum** on `deposit_confirmed` (wired `src/index.ts:459`). So a referrer today likely receives **~5% real ETH/token on-chain *plus* 5% internal credits**. Reconciling these — one must go — is task A.
- **Note for the 1099 path:** the on-chain referral recipient is only a wallet (`referralAddress`), never a tax identity (name+TIN). So even the on-chain design can't produce a 1099 — reinforcing that the target is internal-accrual + gated withdrawal where W-9/W-8 is collected.
- **Legacy JS referral/deposit machinery:** `src/api/external/referralVaultApi.js` (reads on-chain `referralOwner(keccak256(name))`), `src/platforms/web/middleware/referralHandler.js`, `src/core/services/alchemy/credit/DepositProcessorService.js`, `EventWebhookProcessor.js`.
- **A revenue rollup stub exists (JS):** `src/core/services/RevenueAggregationService.js` combines `creditLedgerDb` (mainnet points) + `x402PaymentLogDb` (Base x402) for the admin dashboard. It is NOT FMV/cost-basis aware and NOT trailing-12-month.
- **OFAC screening is crystal:** `src/compliance/SanctionsScreen.ts`. Anon issuance is crystal: `src/ledger/ArcanumIssuer.ts`.

## 2. The THREE real deltas (what ADR-0013 actually needs)
### A. CreditVault CONTRACT upgrade to remove the on-chain split (the central undertaking)
Source of truth: `contracts/src/CreditVault.sol` (291 lines, Solady UUPS). Tests: `contracts/test/CreditVault.t.sol`. Deploy script: `contracts/script/DeployCreditVault.s.sol`.
- **The change is small and localized:** in `_processPayment` (L261–288), stop the on-chain transfer of `referralAmount` (L272–282). Keep computing it and keep emitting it in the `Payment` event (L287) so the backend can **accrue it internally** — but do not send it to the referrer's wallet. (Simplest variant: drop the transfer block; `protocolAmount` becomes the full `amount`; the event still reports the notional `referralAmount` for the accrual hook.)
- **Upgrade, don't redeploy:** UUPS `_authorizeUpgrade` onlyOwner (L290) → ship a new implementation, call `upgradeToAndCall` from the owner. Same proxy address → **no deposit-address migration, no user-facing change.** Confirm the current deployment is behind the UUPS proxy (check `contracts/broadcast/` + `foundationConfig.js` addresses) before assuming.
- **Reconcile the double-pay (must fix regardless):** contract on-chain 5% + `referralSplit.ts` internal 5% = double. Target end-state per §4c: **contract stops paying on-chain; `referralSplit.ts` internal accrual becomes the single source of truth**, then gated withdrawal (task B). Until the contract upgrade ships, consider whether `referralSplitHook` should be disabled to stop the double-pay in the interim.
- **Migration nuance:** existing registered referral names + BPS live in contract storage (`referralOwner`/`referralAddress`/`referralBps` mappings) — a UUPS upgrade **preserves storage**, so registrations survive. Do not reorder/insert storage slots in the new implementation (storage-layout compatibility).

### B. The payout GATE on referrer/creator earnings (§4c, §6b)
The 5% reward accrues as internal credits. The gate applies **when those earnings convert to money out** (if a withdrawal path exists — verify: grep shows `withdraw` in `creditService.js`/`AdminOperationsService.js`, confirm whether referrers can cash out or only spend internally).
- If earnings are **spend-only internal credits** (closed-loop, non-withdrawable) → likely NOT a §6b "payment" in the 1099 sense, but **[CPA]** must confirm (receiving valued credits can still be income).
- If earnings **can be withdrawn to money** → build the gate: per-payee, per-tax-year **cumulative** total (reset yearly); anon up to **$599.99**; at/above **$600** require **W-9 (US) / W-8BEN (foreign)** before further payout; refusal → **24% backup withholding** or hold; **stamp USD FMV at each payout**.
- Same gate covers creator royalty payouts (`modelRoyaltyHook`/Editio).

### C. The USD revenue ledger (§2, §3, §5)
Add a **USD-denominated financial ledger** distinct from `Signum` credits:
- **FMV-at-receipt stamp** on every inbound payment (crypto + fiat + anon Bursa) — the USD value at block time. Choose + log a price source.
- **Per-lot crypto cost basis** on the 95% we custody (the 5% never enters our wallet — no basis tracking there); realized gain/loss on disposal (**[CPA]** FIFO vs specific-ID).
- **Trailing-12-month total USD revenue** as a queryable report + **alert as it nears $1M** (the Krea-cap tripwire, ADR-0012). Extend/replace `RevenueAggregationService.js` in crystal.
- Referral = **gross revenue (100%) + commission expense** (principal/agent, §4b) — the rollup must not net the 5% out.

## 3. Build order
1. **Investigate A** (contract behavior + withdrawal path existence) — decides scope of everything else. Report findings before building.
2. **USD ledger + FMV stamp** (C) — foundational; the gate and reporting depend on it.
3. **Payout gate** (B) — only the tier relevant to whether earnings are withdrawable.
4. **Trailing-12mo rollup + Krea alert** (C).
5. **Customer tax docs** (§6c): purchase invoices (our EIN) + earnings statements — once the USD ledger exists.

## 4. Acceptance tests (go/no-go)
- No inbound payment (incl. anon) is recorded without a USD FMV + price source.
- Referrer is never double-paid (on-chain + internal) — one path only.
- If withdrawable: a payee crossing $600 cumulative is blocked from further payout until W-9/W-8 supplied; sub-$600 anon payout works.
- Trailing-12-month USD revenue is queryable and counts referral **gross**.
- Crypto disposal produces a realized gain/loss line against per-lot basis.

## 5. Relationship to the JS teardown (the founder's question, answered)
**Not blocked.** The credit/deposit/referral vertical is a HYBRID mid-migration: crystal accrual (`referralSplit.ts`) consuming a `deposit_confirmed` event still emitted by legacy JS detection (`EventWebhookProcessor.js`/`DepositProcessorService.js`). Therefore:
- **Do NOT build the gate or USD ledger in the doomed legacy JS.** Build crystal-side.
- Completing C (crystal USD ledger + deposit issuance) is part of migrating this vertical off JS — i.e. it **unblocks** the teardown rather than being blocked by it.
- The real gating undertaking is the **CreditVault contract upgrade** (task A, CONFIRMED needed) — on-chain Solidity work, orthogonal to the JS nuke. The USD ledger + gate depend on the contract no longer paying the referral irreversibly on-chain, so **task A is the critical path**, not the teardown.

## 6. Pointers
- ADR-0013 `docs/adr/0013-tax-and-accounting-posture.md`; ADR-0012 (Krea cap) `docs/adr/0012-licensing-source-and-models.md`
- Memory `project_licensing_and_accounting`, `project_compliance_posture`, `project_bursa_live` (anon deposits), `project_go_live_runway`
- Legacy anchors to retire/reconcile: `referralVaultApi.js`, `referralHandler.js`, `DepositProcessorService.js`, `EventWebhookProcessor.js`, `RevenueAggregationService.js`, `foundationConfig.js`
- Crystal anchors: `src/ledger/hooks/referralSplit.ts`, `src/index.ts:459`, `src/ledger/ArcanumIssuer.ts`, `src/compliance/SanctionsScreen.ts`
