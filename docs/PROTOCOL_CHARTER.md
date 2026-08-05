# Noema Protocol Charter

This document states the promises Noema makes to every participant — users, creators, hosts, and model authors. These are not aspirational. They are invariants. Any version of the protocol that violates them is not Noema.

The invariant test suite exists to prove these pledges hold in every build. This charter is the authoritative source for what those tests must prove.

---

## I. The Privacy Pledge

**The platform cannot link a session to a deposit.**

This is the foundational privacy property. Everything else is a consequence of it.

### 1.1 Commitments, not accounts

When a user funds their balance, Noema does not credit an account. It credits a commitment — a hash `H(secret)` generated client-side by the user from a secret only they hold. The deposit form takes a commitment hash. The ledger records credit against that hash. The platform never learns the secret.

### 1.2 The one-way link

The deposit record carries a forward pointer to the commitment it funded (`arcanumHash` on the deposit signum). The commitment record carries no pointer back to the deposit. This asymmetry is structural: the link exists in one direction only, and the back half lives exclusively in the user's memory.

**Corollary:** An anonymous signum (arcanum or tessera forma) must never carry `arcanumHash`. It is the anonymous end of the link. A back-pointer on it would collapse the break.

### 1.3 Anonymous signa carry no identity

Signa of forma `arcanum` or `tessera` must never have an `animaId` field set, at any point in their lifecycle: creation, locking, settlement, or refund. This is enforced at every write path.

### 1.4 Refunds preserve anonymous identity

When a session completes and a refund is issued for unused credit, the refund signum inherits the same commitment hash (`testis`) as the original signum. The refund does not acquire an `animaId`. The user's anonymity is not degraded by the settlement process.

### 1.5 Anonymous and identified paths are equivalent

The platform makes no functional distinction between a user paying with an identified account and a user paying anonymously via a commitment. Both paths go through the same execution rail, the same settlement, the same distribution hooks. Anonymity is not a degraded mode.

---

## II. The Treasury Pledge

**The platform never charges more than it consumed.**

### 2.1 Exact charge on completion

When an execution completes, the user is charged exactly the actual impetus consumed — not the reservation, not the locked amount. If the actual cost is less than what was locked, the delta is immediately refunded as a new signum to the same identity. The user's net cost equals the actual cost. Always.

### 2.2 No charge on failure

If an execution fails for any reason, the user pays nothing. All locked signa are released to valid status. The user's balance after a failed execution is identical to their balance before initiation.

### 2.3 Pre-flight atomicity

If initiation fails — unknown modus, insufficient balance, any error — no signa are locked and no actum record is created. The ledger is left exactly as it was before the attempt.

### 2.4 Value conservation

The ledger creates and destroys no value. Every impetus point in the system traces to an issuance event. The total value of all valid signa, locked signa, and spent signa equals the total value of all signa ever issued. Settlement redistributes value; it does not manufacture or erase it.

### 2.5 Cursor cost contract

A cursor's `run()` method must never return an impetus value exceeding its `reserve()` value for the same modus and inputs. The reservation is a quoted upper bound and a binding commitment. A cursor that overcharges is rejected at the completion step.

---

## III. The Distribution Pledge

**Every participant is paid exactly their stated rate. No more. No less.**

These rates are a contract with creators, hosts, and model authors. Drifting from them is fraud.

### 3.1 Host cut — 20%

The operator hosting the modo session receives 20% of the execution impetus, calculated as floor division. This compensates hosting costs and incentivises infrastructure operation.

### 3.2 Spell royalty — 10%

The author of the modus (the spell) receives 10% of the execution impetus. This is the creator's ongoing royalty for every run of their published tool.

### 3.3 Model royalty — 5%, split equally

The authors of any intelligence components (model authors) collectively receive 5% of the execution impetus, divided equally among all credited authors using floor division. Dust from integer division (the remainder when the pool does not divide evenly) is not distributed — it stays in the platform's general operating pool, not as an explicit signum.

### 3.4 Referral split — 5% of deposit

When a deposit is confirmed via a referral link, the referrer receives 5% of the deposit valor as a reward signum. The ledger issues this reward on every `deposit_confirmed` event that carries a `referrerAnimaId`. Preventing duplicate referral events for the same deposit is the responsibility of the application layer — the ledger itself does not deduplicate.

### 3.5 Total distribution never exceeds impetus

The sum of all signa produced by all distribution hooks on a single execution event must never exceed the impetus charged for that execution. Hooks are applied to the same impetus value; they do not compound.

*Note: secondary events (e.g. `royalty_fired` triggered after `execution_spend`) are separate accounting entries and are not included in this sum. Each event type's hooks are independently bounded by their own input.*

### 3.6 Hook isolation

A distribution hook that throws must not prevent other hooks from firing. Distribution to one party is never conditional on the behaviour of another party's hook.

### 3.7 Hook determinism

Given the same event, the same hooks always produce the same signa. Distribution is not random and does not depend on external state.

---

## IV. The Execution Pledge

**Every execution is accounted for exactly once.**

### 4.1 Nexus fires exactly once on success

The `execution_spend` event is emitted exactly once per successful completion. It is never emitted on failure. Double-emission would cause double-payment to distribution recipients.

### 4.2 Signum status is monotonic

A signum's status moves in one direction: `valid` → `locked` → `spent`. Status never moves backwards. A spent signum cannot be re-locked or re-validated. A locked signum can only move to `spent` (via settle) or back to `valid` (via explicit release on failure) — never to `spent` via spend without being locked first.

---

## V. Scope of These Pledges

These pledges apply to the core protocol layer — the ledger, the execution rail, and the distribution hooks. They are independent of:

- Which frontend (Telegram, Discord, web) initiates the execution
- Which backend cursor (RunPod, OpenAI, local) handles it
- Whether the session is identified or anonymous
- Whether TEE attestation is in use

A future build that adds TEE, on-chain commitments, or ZK proofs must satisfy all of the above. The privacy pledge becomes stronger (the platform loses the ability to even see deposit metadata) but the structure is the same.

---

*This charter is the source of truth for the invariant test suite in `tests/unit/invariants/`. Every section of this document should be traceable to at least one passing invariant test. Any pledge without a corresponding test is an unproven claim.*
