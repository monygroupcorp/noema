# Handoff — Admin/ops workspace: accounting dashboards + approval channels

- **Date:** 2026-07-02
- **Relates to:** ADR-0012 (moderation gate, model-license enforcement), ADR-0013 (USD revenue ledger, payout/W-9 gate)
- **Blocked by JS teardown?** **Partly — it *replaces* the legacy JS/React admin that the teardown removes.** This is the crystal successor to the existing admin surface; build crystal-first, don't extend the doomed React admin.
- **Depends on:** the USD revenue ledger from the accounting handoff (`2026-07-02-creditvault-referral-accounting-handoff.md`) for the accounting half. The approvals half can proceed independently.

## 0. Ground rules (non-negotiable)
- Crystal-first: **do NOT invent an "ApprovalChannel" noun if an existing primitive carries it.** First design task is the reduction (see §2).
- Pin DB to `noemaplane` / `noemaplane_test`. Never `noema` (prod).
- This is an internal ops surface — auth-gate it hard (owner/admin roles only; note the existing `WalletGate.js` pattern).

## 1. What exists today (legacy JS/React — to be superseded, verified 2026-07-02)
- **Admin dashboard (React):** `src/platforms/web/frontend/src/components/admin/` — `DepositsTable`, `CreatorActivity`, `CostManager`, `AnalyticsCharts`, `ActivityFeed`, `UserSearch`, `WalletGate`, `PLHero`.
- **Admin APIs:** `src/api/internal/admin/revenueApi.js` (revenue), `src/api/external/admin/adminApi.js`, `src/api/external/v1/admin/index.js`, `src/api/internal/admin/index.js`, `src/api/external/system/adminApi.js`.
- **Approval/review infra:** `src/core/services/db/reviewQueueDb.js`, `src/core/services/review/reviewResetService.js`, `src/core/services/adminActivityService.js`.
- **Revenue aggregation (JS stub):** `src/core/services/RevenueAggregationService.js` (combines creditLedgerDb + x402PaymentLogDb; not FMV/trailing-12mo aware).

These are the *seeds* — the crystal version reuses their concepts, not their code.

## 2. FIRST design task — the crystal-first reduction (do before building)
Answer: **is "approval channel" a new primitive, or does it emerge from existing ones?**
- Candidate reductions: a review/approval is a **pending `Nexus` event awaiting a human `Signum`/decision**, or an item in a single generic `reviewQueue` collection tagged by `kind` (`moderation` | `payout` | `sanctions` | `publish`). Prefer ONE generic queue with a `kind` discriminator over N bespoke queues.
- Decide whether the existing crystal moderation gate (Editio async moderation, ADR-0012) already models the queue, and whether payouts/sanctions slot into the same shape.
- Output a one-paragraph decision (like an ADR delta) before writing UI.

## 3. The two halves

### Half A — Accounting dashboards (reads, depends on the USD ledger)
Surface the ADR-0013 data as ops views:
- **Trailing-12-month USD revenue** + the **$1M Krea-cap gauge/alert** (the tripwire — must be glanceable).
- **Revenue by source** (credit purchases, x402, per-model royalties), **gross vs. referral-commission** (referral is gross revenue + commission expense, not netted — ADR-0013 §4b).
- **Crypto holdings + cost basis + unrealized/realized gain-loss** (property accounting, §3).
- **Deferred-revenue liability** (unspent credits outstanding).
- **Exports:** the customer-facing docs from §6c (purchase invoices w/ EIN, creator/referrer earnings statements) generated from the same ledger.

### Half B — Approval channels (the workspace; can start independently)
One workspace, multiple queues (per the §2 reduction), each an approve/reject with audit trail:
1. **Content moderation** — CSAM/NCMEC + publishing moderation gate (ADR-0012; the go-live blocker). Human review of flagged generations/publishes. **CSAM logic stays in the private module** — the workspace shows only the queue item + verdict surface, never the detector internals.
2. **Payout / KYC review** — the §4c gate: payees crossing $600 cumulative need W-9 (US) / W-8BEN (foreign); approve/hold/backup-withhold. Referrer + creator-royalty withdrawals land here.
3. **Sanctions review** — deposits/anima flagged by `src/compliance/SanctionsScreen.ts` (OFAC) awaiting a human call.
4. **Model-publish approval** — public promotion of imported/trained models (ties to `project_model_import` ORIGIN→R2 promotion + CSAM scan).

Each queue item needs: subject ref, reason/flags, decision, decider identity, timestamp, immutable audit log.

## 4. Build order
1. **§2 reduction decision** (blocks everything).
2. **Half B — moderation queue first** (it's the go-live blocker; ADR-0012). Then sanctions, then payout/KYC.
3. **Half A — accounting views** once the USD ledger (accounting handoff, Half C) exists.
4. **Auth/roles hardening** throughout.

## 5. Acceptance tests (go/no-go)
- No approval queue exposes private detector internals (CSAM logic stays private; only verdict/queue item shown).
- A flagged item cannot be published/paid/settled until an admin decision is recorded, with an immutable audit trail (decider + time).
- The trailing-12-month revenue gauge matches the ledger and fires the Krea-cap alert at threshold.
- Every admin route is role-gated; anonymous/user tokens are rejected.

## 6. Relationship to the JS teardown
This crystal workspace is the **successor** to the legacy React admin + `reviewQueueDb`. It should exist before those are nuked (they hold live ops function — moderation, revenue reporting). Sequencing: build crystal workspace → cut over → nuke legacy admin. So it is **teardown-adjacent**, not teardown-blocked.

## 7. Open questions
- **[design]** §2 reduction — one generic queue vs. per-kind (recommend generic + `kind`).
- **[CPA]** which accounting figures are authoritative-of-record vs. informational (the ledger is the book; the dashboard is a view).
- **[product]** is this a web-only surface, or also surfaced to Telegram admin (`adminManager.js` exists)?

## 8. Pointers
- ADRs: `docs/adr/0012-*`, `docs/adr/0013-*`
- Sibling handoffs: `2026-07-02-creditvault-referral-accounting-handoff.md` (USD ledger dependency), `2026-07-02-model-license-enforcement-handoff.md`
- Memory: `project_licensing_and_accounting`, `project_compliance_posture`, `project_model_import`, `project_publishing_editio`, `project_go_live_runway`
- Legacy anchors: `src/platforms/web/frontend/src/components/admin/*`, `src/api/internal/admin/revenueApi.js`, `src/core/services/db/reviewQueueDb.js`, `src/compliance/SanctionsScreen.ts`
