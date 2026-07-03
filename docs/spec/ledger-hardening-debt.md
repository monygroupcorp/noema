# Ledger hardening — tracked debt (ADR-0011 Phase 1 follow-ups)

**Status:** tracked debt, NOT blocking. Raised 2026-07-02 during review of Phase 1
(`reserve`/`transfer`/settle-parity, commits `b88929b7`, `783ae25d`). None of these block
Phase 2+ of the CAMEL→crystal migration; they harden the ledger primitives Phase 1 introduced.

Context: ADR-0011 §3 accepts two "costs" of the Tier-1 (event-sourced, no cached balance)
ledger. On review, both are **incidental, not inherent** to the no-cache stance, and each has a
cheap fix that keeps the single-source-of-truth invariant. This doc records the analysis and the
fixes so they aren't silently absorbed into "the saga handles it."

The token ratio ($0.000337/impetus point) is **not** implicated in any of this and must not be
changed to "fix" it — see debt #1.

---

## Debt #1 — `reserve` is O(n) in pool size (should be ~O(k))

### Symptom
`MongoSignorum.reserve` loads **every** valid signum for the identity into the app and sorts in
JS on each attempt:

```js
const candidates = (await this.col.find({ ...idq, status: 'valid' }).toArray())
  .sort((a, b) => (BigInt(a.valor) < BigInt(b.valor) ? -1 : 1))
```

Cost scales with pool size. The treasury — the *whole reason `reserve` exists* — is the pool that
monotonically accumulates signa (every grant/topup/reward-skim, and every settle refund-delta, adds
a valid row). Under the CAMEL shape (many agents, one treasury, concurrent debits) this risks a
congestion feedback loop: more signa → slower loads → wider race window → more retries → more full
reloads. First appears in production under load, where the ADR's mitigation ("graduate to `Bursa`")
is an unplanned migration under fire.

### Root cause (NOT the token scale)
The O(n) is **not** caused by the token ratio, and re-scaling would fix nothing (it doesn't remove
rows). The causal chain is the storage *type*:

```
valor is bigint → Mongo can't store bigint → serialized to STRING (toDoc)
  → strings sort lexicographically ("9" > "10") → cannot .sort().limit() server-side
  → forced to full-load + JS sort → O(n)
```

`bigint` was chosen for money-as-integers discipline, but `valor` is **always impetus-scale, never
wei** (ETH deposits convert to points; wei/tx-hash live in `testis`). A JS `Number` is exact to
2^53 ≈ $3 trillion of impetus in a single balance — far beyond any real pool. So the bigint buys no
usable precision; its only *effect* is the unsortable-string serialization above.

### Fix
Make `valor` sortable in Mongo so selection becomes server-side `sort + limit` (pull only the ~k
coins needed to cover the amount — k is tiny and bounded, effectively constant):

- **Low-risk (preferred): `valorNum` sort-mirror.** Keep the authoritative `bigint`; add a numeric
  field written alongside it, used *only* for `.sort({ valorNum: 1 }).limit(k)`. Lossless
  (< 2^53), reversible, doesn't touch the value model or re-open the money-in-floats debate.
- **Cleaner but heavier: migrate `valor` to BSON `Number`.** Touches every Signum read/write and the
  precision-discipline stance; only worth it if we're changing the schema anyway.

Either gets `reserve` to ~O(k) **with no cached balance and no drift**. True O(1) *debit* (decrement
a counter, never touch coins) still requires the `Bursa` aggregate cell — that tradeoff stays
reserved for genuinely hot pools, as the ADR intends.

---

## Debt #2 — `settle` spend+refund is not atomic (latent value-loss bug, pre-existing)

### Symptom
`settle` spends all locked signa, then issues the overshoot refund as a **separate** write:

```js
await this.col.updateMany({ id: {$in}, status:'locked' }, { $set:{ status:'spent', ... } }) // spend TOTAL
// ← crash / disconnect / OOM-kill here
if (delta > 0n) await this.issue({ ...refund of (total - amount) })                          // refund overshoot
```

A crash between the two awaits spends coins worth **`total`** but never issues the refund — the
identity loses `amount + overshoot`, not just `amount`. This is in the plain `ActumCompletor.settle`
run path too, so **every run** (not just `transfer`) carries a small value-loss window on the
overshoot delta. It predates Phase 1; the hardening tightened the guards but kept the
spend-then-refund structure.

### Why the ADR's "no transactions" objection is weak here
ADR-0011 §3 rejects Mongo transactions as "infra + latency + unfaithful in `MemorySignorum`." But:
- We run on **Atlas, which is always a replica set** — multi-document transactions are available
  with **zero new infra**.
- `MemorySignorum` is single-threaded and synchronous → **trivially atomic already**; it needs no
  transaction to match the guarantee.
- `settle` is the ideal candidate: a bounded two-write op scoped to one identity, low latency cost.

### Fix
Wrap `settle`'s spend + refund in a Mongo session/transaction (Memory is already atomic → no-op
there). Owner verdict (2026-07-02): **no-brainer**, do it — just not blocking Phase 2, so tracked
here.

---

## Debt #3 — `transfer` has no idempotency key and no orphan reconciler

### Symptom
`transferVia` is debit-then-credit across separate writes (correct *ordering* — a crash loses value,
never invents it). But:
- The "recoverable / re-issuable by an operator" safety net assumed in review **does not exist** —
  there's no job scanning for `transfer:*` (or settle) actumIds with a spend but no matching credit.
  So today the real behavior is silent loss until a human notices.
- The saga/idempotency mitigation in ADR §5 is **specific to provisioning (Phase 3)**. The subsidy
  sweep worker (Phase 5) and TEE billing get no such protection.

### Fix (cheaper than a per-caller saga, covers everyone)
1. **Idempotency key on `transfer`/grants** — combined with debit-first ordering, a retry turns
   "lost value" into "eventually completes" for *all* callers, not just provisioning.
2. **A dead-simple orphan-transfer reconciler** (startup/interval): scan for spends whose `actumId`
   has no matching credit/refund and complete or flag them — makes "recoverable" actually true.

Defer both, but they are debt, not "handled by the saga."

---

## What the ADR got right (do NOT undo)
- **No cached balance cell (Tier-2 rejected).** A second source of truth that drifts is worse than
  any of the above. All three fixes preserve the single derived source of truth.
- **Debit-before-credit ordering** in `transfer`/`settle`. Inventing money is unforgivable; losing it
  is merely bad and recoverable. Keep it.

The correction is narrow: O(n) selection and non-atomic settle are **incidental artifacts**, not
unavoidable consequences of the no-cache design.
