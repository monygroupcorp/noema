# Coverage checklist — licensing & accounting go-pro (umbrella over the 3 handoffs)

- **Date:** 2026-07-02
- **Purpose:** the cross-thread seams and orthogonal items that fall *between* the three handoffs and are easiest to miss when each is worked alone. Verify against this as downstream threads land.
- **Threads:** [1] model-license-enforcement · [2] creditvault-referral-accounting · [3] admin-workspace-accounting-and-approvals · [MI] model-import (already built, `project_model_import`)

## A. Cross-thread integration seams (where two threads MUST meet)
- [ ] **License field lives on `Intella` → covers imported/BYO models, not just seeded catalog.** [1]×[MI] The descriptor must support a **user-declared** license + **attestation** (BYO = user liability, ADR-0012), distinct from a catalog-canonical license.
- [ ] **ONE public-promotion gate, not two.** [1]×[MI] Model-import already built the CSAM/moderation gate at private→public promotion. The **commercial-use license check hooks into that same gate**, not a new one.
- [ ] **Base-model FLOOR resolution.** [1] The gate must resolve a LoRA to **its base's** license (floor), not read the LoRA's self-declared license. Confirm the base linkage exists (`Fundamentum.familia`/derives-from) and the gate walks it.
- [ ] **Krea-cap alert has an owner + an action.** [2]→[3] trailing-12mo USD revenue → workspace gauge → **the business action** (pre-negotiate Krea enterprise license before crossing $1M). The gauge without a named human action is a silent tripwire.
- [x] ~~One payout gate serves referral AND creator-royalty.~~ **OBSOLETE — see §F.** Decided 2026-07-02: NO internal payout gate at all; all in-app payouts are spend-only credits, real money is launchpad-only.
- [ ] **CSAM detector internals stay PRIVATE across every surface.** [3]×[MI]×ADR-0012 workspace shows verdict/queue-item only; model-import scan + moderation queue both read the private module, never expose thresholds.
- [ ] **Customer tax docs derive from the USD ledger.** [2]→[3] purchase invoices (our EIN) + creator/referrer earnings statements are workspace exports over the same ledger — don't reinvent a data source.

## B. Foundational unknowns that GATE downstream work (resolve early)
- [x] ~~Are referral/royalty earnings withdrawable-to-money, or spend-only credits?~~ **DECIDED 2026-07-02 → SPEND-ONLY (see §F).** The W-9/1099/backup-withholding gate is not needed internally at all.
- [ ] **Revenue recognition model** [2] **[CPA]** — on-sale vs deferred-until-consumed; confirms the deferred-revenue-liability treatment.
- [ ] **Sales tax / VAT on digital-goods credit sales** [2] **[CPA]** — global user base; may require tax lines on invoices (feeds [3] exports).
- [ ] **Crypto lot method** (FIFO vs specific-ID) [2] **[CPA]** — needed before gain/loss is authoritative.
- [ ] **§2 approval-queue reduction** [3] **[design]** — one generic `reviewQueue` + `kind` vs N bespoke; is "approval" just a pending Nexus event awaiting a human Signum? Blocks [3] UI.

## C. Orthogonal / time-sensitive (not in any code thread — easy to forget)
> **DECISION 2026-07-02: the Part-A source-code licensing sweep is PARKED until after the JS nuke.** Rationale: the repo already sits under a safe protective default (VPL/AGPL); relaxing edges to Apache is an adoption optimization with no pre-launch cost; and per-dir LICENSE/SPDX boundaries should be drawn ONCE over the clean post-nuke crystal tree, not over a doomed mixed tree with shifting dirs. **The urgent licensing work (Part B model-license backfill) is already DONE — parking Part A leaves no compliance hole.** Exception: the CLA (below) has an external clock and is NOT parked.
- [x] **CLA — DONE 2026-07-02.** `CLA.md` (license-grant ICLA, entity = **Mony Group LLC**, contributor keeps copyright, grants relicense right for open-core/dual-license), wired into `CONTRIBUTING.md` + PR-template checkbox. Automated gate = `.github/workflows/cla.yml` (contributor-assistant action), **allowlist `monyrth,*[bot]` so owner/agent velocity is untouched; gates external PRs only; NOT a required check so it never blocks merges.** **One-time setup left to owner:** add repo secret `PERSONAL_ACCESS_TOKEN` (PAT `repo` scope) so signatures write to the `cla-signatures` branch — until then the check errors harmlessly. Counsel review of `CLA.md` still advised.
- [ ] **[PARKED → post-nuke] Per-directory `LICENSE` files + SPDX headers + root `LICENSING.md`** (ADR-0012 Part A open-core split). Do in one pass over the clean crystal tree after the JS nuke.
- [ ] **[PARKED → post-nuke] Abuse-logic private-repo carve-out** (ModerationGate seam public / impl private). Nothing to extract until CSAM is built; do against the final tree.
- [ ] **CSAM/NCMEC scanner built private-from-birth.** Not built yet = the lucky break; architect it in the private module the first time (don't commit it to the public repo).
- [ ] **ADR statuses** — 0012/0013 are `proposed`. Flip to `accepted` once you commit, so downstream agents don't relitigate.

## D. Contract-upgrade specifics (thread [2], on-chain)
- [ ] **Confirm live deployment is behind the UUPS proxy** (`contracts/broadcast/` + `foundationConfig.js`) before assuming in-place upgrade.
- [ ] **Storage-layout compatibility** — new `_processPayment` impl must NOT reorder/insert storage slots (referral mappings must survive).
- [ ] **Contract change is now just "delete the split"** (§F) — remove the referral transfer (`CreditVault.sol` L272–282), `protocolAmount` = full `amount`. No accrual/withdrawal/gate machinery.
- [ ] **Double-pay resolved by the deletion** — removing the contract's on-chain 5% leaves `referralSplit.ts` (internal credit) as the sole mechanism. Interim before the upgrade ships: consider disabling the hook OR expect ~10% until deployed.
- [ ] **Anon deposits still get the FMV revenue stamp** [2] even though they carry no referral — revenue totals must include Bursa/anon.

## E. Sequencing (founder's plan, 2026-07-02)
1. **NOW:** backfill + model-conditional seam (descriptor + floor on `Fundamentum`/`Intella`). [1 partial]
2. **After seam:** workspace accounting + approvals. [3]
3. **After backfill:** enforcement gate (Editio reads the field). [1 remainder]
- Model-import [MI] overlap already surfaced (§A rows 1–2). Thread [2] (contract + ledger) sequenced separately.

## F. Payout model — DECIDED 2026-07-02 (ADR-0013 §4c-0/§4c/§4d)
> **Two rails, mapped to two tax postures. Inside the app = spend-only credits, full stop. Real money = launchpad only.**

- **All in-app payouts pay spend-only credits** — referral AND creator model-royalties (`modelRoyaltyHook`/Editio) AND any earning. Rebate/loyalty character → **no 1099/W-9/payee-reporting, no MSB payout exposure, anonymity intact, books stay closed-loop.**
- **Real money for creators = create a collection → launchpad**, where NOEMA is a **non-custodial facilitator**: on-chain split **direct** to creator + separated NOEMA fee; NOEMA never custodies the creator's cut → creator bears own tax, NOEMA revenue = fee only.
- **Rail symmetry (custody is the trigger):** credit sales = principal → NO on-chain split → credits; launchpad = facilitator → on-chain peer-to-peer split IS correct.

**Guardrails to verify as these land:**
- [ ] **In-app credits are non-withdrawable-to-cash.** The moment they're cashable they revert to compensation and the whole payee surface returns. (Also keeps MSB-clear.)
- [ ] **Launchpad split is genuinely non-custodial** — creator's cut NEVER routes through a NOEMA-controlled balance, or we fall back to payer/transmitter.
- [ ] **[CPA/counsel] Scope 1099-DA broker reporting** for the launchpad rail — it's a *different* regime than 1099-NEC, not zero reporting. Do when the launchpad rail is built.
- [ ] **No cash/crypto payout path exists anywhere on our internal books** — audit that referral, royalty, and any earning surface resolve to credits only.

## Pointers
- Handoffs: `2026-07-02-{model-license-enforcement, creditvault-referral-accounting, admin-workspace-accounting-and-approvals}-handoff.md`
- ADRs: `docs/adr/0012-*`, `docs/adr/0013-*`
- Memory: `project_licensing_and_accounting`, `project_model_import`, `project_compliance_posture`, `project_go_live_runway`
