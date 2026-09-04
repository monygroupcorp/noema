# Moderation REJECT reason — proposal

**Status:** proposal, not a ruling. Prompted by a real rejected publish (a klein-4B LoRA,
"brutalite," `POST /v1/editiones` → `huggingface`, `unlisted`) where nobody — including a
platform admin — can currently find out why the gate refused it.

**Companion docs:** `docs/spec/moderation-classifier.md` (the gate's cascade + verdict shape,
still "design, not built" for the router/human-review pieces); `docs/spec/publishing.md` §4/§8
(HOLD review flow, the →public gate).

---

## 1. The gap

`ModerationGate.scan()` (`src/crystal/ModerationGate.ts`) returns a typed verdict:

```ts
export type ModerationVerdict =
  | { ok: true; billable?: boolean }
  | { ok: false; reason: string; hold?: boolean; billable?: boolean }
```

`reason` is **required**, not optional, on every refusal. The gate itself always knows why.
The information is not missing at the source — it is discarded one hop later.

`CrystalApi._settlePublication` (`src/allocutio/api/CrystalApi.ts`, current lines ~1958–2030) is
the only caller of `scan()` on the live path. Its two refusal branches (~2003–2013):

```ts
if (!verdict.ok) {
  if (verdict.hold) {
    await editiones.update(editioId, { reviewOutcome: 'pending' })   // no verdict.reason written
    return
  }
  await editiones.update(editioId, { status: 'rejected' })            // no verdict.reason written
  return
}
```

Neither branch passes `verdict.reason` anywhere. This was directly confirmed against the live
`editiones` collection: brutalite's rejected document has `status`, `natum`/`mutatum`,
`attempts`, `leasedUntil` — and nothing that says why.

**HOLD is not actually better off than REJECT here.** The task brief that kicked off this
investigation assumed HOLD "at least sets `reviewOutcome:'pending'` and there's a whole review
flow" — true, but the review flow is also reason-blind. The admin queue (`GET
/v1/editiones/review` → `listHeldEditions` → the public `Edition` projection in
`src/allocutio/api/types.ts`) carries no `reason`/`verdict` field either — a reviewer opening
`Review.tsx` sees the held item and has to eyeball the content and decide cold, with no signal
from the classifier that put it there. HOLD's real advantage over REJECT isn't "the reason
survives" — it's that a human looks at the actual content before anything terminal happens.
REJECT skips that human entirely *and* discards the diagnostic.

The `Editio` schema itself (`src/types/editio.ts`) has no field to hold this even if a caller
wanted to write one — `Editionum.update`'s patch type is
`Partial<Pick<Editio, 'status' | 'externalRef' | 'visibility' | 'custody' | 'reviewOutcome' |
'leasedUntil'>>`. No `reason`, no `verdict`, no `rejectionDetail`. This is not an oversight where
a field exists and a call site forgot it — it's a genuine schema gap; the fix needs a real
addition, not just a missed write.

No log statement fills the gap either: there is no `log.*` call anywhere in `_settlePublication`
around the scan/hold/reject branches (checked directly). Compare `confirmCsamAndReport` a few
lines above (~1904–1935), which logs loudly on every branch — the reject path was never given
the same treatment.

---

## 2. What's actually recoverable for brutalite right now

Not fully lost — one real avenue exists, undocumented as a diagnostic tool:

**`VerdictCache` / the `verdict_cache` Mongo collection.** `_settlePublication` checks a
content-addressed verdict cache *before* calling `scan()`, and writes the fresh verdict to it
*after* — for every outcome, including reject (`src/crystal/VerdictCache.ts`,
`src/crystal/MongoVerdictCache.ts`, wired unconditionally in `src/index.ts:945`). Its
`CachedVerdict` shape **does** carry `reason` and `hold`:

```ts
export function toCachedVerdict(key: string, v: ModerationVerdict, scannedAt: string): CachedVerdict {
  return {
    key, ok: v.ok,
    ...(v.ok === false && v.reason !== undefined ? { reason: v.reason } : {}),
    ...(v.ok === false && v.hold ? { hold: true } : {}),
    scannedAt,
  }
}
```

The key is `contentKey()`: the SHA-256 of the artifact's sorted media URLs. For brutalite, that's
the SHA-256 of its 8 preview-sample URLs, joined with `\n` and hashed — the exact same
computation `_settlePublication` ran at scan time. **This means the reason for brutalite's
rejection is very likely still sitting in the `verdict_cache` collection**, findable by
recomputing that key from the artifact's current preview URLs and querying
`{ key }` in `verdict_cache`. This wasn't done as part of this investigation (no DB access was
in scope), but it's the concrete first move before treating the reason as gone — cheaper than
any code change and answers the immediate "why was brutalite rejected" question on its own.

This only works forward from whenever `MongoVerdictCache` was wired in (need to confirm
brutalite's publish postdates that), and only for artifacts with scannable media (a key is null
when `contentKey()` finds no media — not brutalite's case, it has 8 sample images).

What's permanently gone regardless: any signal that *isn't* in the verdict itself — e.g. which
specific one of the 8 images tripped it, or a raw classifier score if the private module doesn't
put one in `reason`'s string. The verdict cache is a lucky byproduct of a caching feature, not a
designed audit trail — it happens to hold the one field this spec cares about, nothing more.

---

## 3. Options for the real fix

### (a) Persist the verdict on the Editio record; surface it via review-style tooling

Add a field to the `Editio` schema — e.g. `moderation?: { reason: string; hold?: boolean;
scannedAt: string }` — and write it in both `_settlePublication` branches (hold and reject),
alongside the existing HOLD infra. Extend `Editionum.update`'s patch keys to include it. Surface
it in the `Edition` public projection (admin-scoped, or author-scoped with a redacted/generic
message — see privacy note below) and in `GET /v1/editiones/review` for held items; add a small
admin-only read (`GET /v1/editiones/:id` returning the full record, or an
`/v1/editiones/:id/moderation` inspect endpoint) for terminal `rejected` items, which have no
queue entry to look at today.

- **Pro:** durable, queryable, the natural home for this data, piggybacks on the schema/API
  surface that already exists for HOLD (small marginal addition, not new plumbing).
- **Con:** schema migration (additive, so low-risk — existing rows just lack the field); decide
  who sees raw classifier text (a reason string from a private compliance module may describe
  detection internals the platform doesn't want a rejected author reading verbatim — likely
  needs an admin-only raw field plus an author-facing generic one, e.g. "flagged by automated
  review").
- **Effort:** small-to-medium. Reuses `_settlePublication`'s existing branches, the `Editio`
  type, and (for surfacing) the review UI/API already built for HOLD.

### (b) Route REJECT through the HOLD-plus-review pipeline instead of a terminal state

Never let the gate itself write `status:'rejected'` directly for non-hash-match refusals — treat
every `ok:false` as a HOLD (`reviewOutcome:'pending'`), and let a human's explicit
`rejectHeldEdition` (or `confirmCsamAndReport`) be the only path to terminal `rejected`. A
person always sees the actual content before anything is discarded.

- **Pro:** structurally guarantees a human looks before data is destroyed — closes both this bug
  *and* the plausible-false-positive risk in one move; no new schema field strictly required
  (though (a)'s field still helps the reviewer, same as it would help today's HOLD reviewer).
- **Con:** changes reject semantics for cases that plausibly should stay terminal-automatic
  (the built exact/perceptual hash-match layer per `moderation-classifier.md` §2 step 1–2 — a
  known-CSAM hash hit has no ambiguity to review) — routing *that* through human review adds
  queue volume and reviewer CSAM exposure for zero benefit. Would need to preserve hash-match as
  a genuine auto-reject-and-report path and apply this only to classifier-driven verdicts,
  which the current `ModerationVerdict` shape can't distinguish (no verdict-source field) —
  itself a small addition. Larger blast radius than (a); touches the safety posture, not just
  diagnostics.
- **Effort:** medium-to-large, and it's a policy change, not just a diagnostics fix — probably
  wants the same sign-off gate `moderation-classifier.md` §14 already flags for the CSAM/legal
  posture generally, not a decision made in this spec.

### (c) Log the verdict server-side, no schema change

Add one `log.warn`/`log.error` call in both `_settlePublication` refusal branches, logging
`editioId`, `artifactRef`, `verdict.reason`, and `verdict.hold` — mirroring
`confirmCsamAndReport`'s existing logging discipline a few lines above.

- **Pro:** trivial, no schema/API surface change, matches the codebase's existing
  loud-logging-on-compliance-events pattern, ships same-day.
- **Con:** logs are not a queryable audit trail for "why was editio X rejected" days later
  without log-infrastructure access (unlike (a)'s DB field, or the accidental verdict-cache
  recovery in §2); doesn't help an author-facing "why was I rejected" surface at all; doesn't
  help the reviewer at HOLD time either (a log line isn't in `Review.tsx`).

---

## Recommendation

**(a), with (c) alongside it as a same-day stopgap.** (c) costs a few lines and closes the
"gone forever with no trace" failure mode immediately — ship it first, independent of anything
else. (a) is the real fix: it's the smallest change that makes REJECT's diagnostics as
first-class as HOLD's already are, reuses infrastructure that exists (the `Editio` schema
pattern, the review-style read surface), and doesn't touch reject/hold *policy* — just what gets
recorded. (b) is a genuine policy improvement worth raising separately (see §4 below, brutalite
is a real argument for it) but it's a bigger, safety-posture-adjacent decision that shouldn't
ride in on a diagnostics bug fix — it belongs in front of whoever owns the
`moderation-classifier.md` §14 sign-off, not decided here.

Immediate next step, before any code change: pull brutalite's actual reason out of
`verdict_cache` (§2) — cheapest possible action, and it may resolve the concrete question (false
positive on the dark/horror art style vs. a real hit) that motivated this whole spec.

---

## 4. Secondary finding — REJECT may be reachable pre-Thorn when the design says it shouldn't be

Flagged separately because it's a distinct question from the missing-reason bug, and only
partially resolvable without private-module access — noted because there's concrete textual
evidence, not raised as pure speculation.

`moderation-classifier.md` §2 documents the intended cascade:

```
1. exact SHA-256 hash-match  → hit? → REJECT + NCMEC report        (built)
2. perceptual hash near-match → hit? → REJECT + NCMEC report        (built)
3. SexualContentRouter.route(bytes) → sexual?  no → PASS  yes → 4
4. CsamClassifier.classify(bytes)  [Thorn]      match → REJECT   clear → PASS
   —— if NO CsamClassifier is configured (pre-Thorn) ——
      → HOLD for human review (NOT auto-reject, NOT auto-report)
```

Per this design, a terminal REJECT should only be reachable via (1) a known-CSAM hash match or
(4) an actual Thorn classifier match — and §14 of the same doc lists the Thorn contract as
"application-gated, slow — start now," i.e. an open, not-yet-closed go-live blocker as of that
doc's writing. If Thorn isn't yet wired for this deployment, a non-hash-match item like
brutalite's inoffensive character-portrait samples should have HELD, not REJECTed, under the
documented design.

This doesn't resolve on its own — three explanations are equally consistent with what's visible
from the public code: (i) Thorn has since gone live and this really was a classifier match
(plausibly a false positive on the LoRA's dark/horror-metal training style, per the background
motivating this spec); (ii) the private module's actual cascade deviates from
`moderation-classifier.md`'s documented design (that doc is marked "design, not built" for the
router/hold pieces specifically); or (iii) this genuinely was a hash-match hit, which given the
content description (AI-generated character portraits, generic prompts) seems the least likely
of the three but can't be ruled out from here. **This is exactly the question §1–2's missing
reason would answer directly** — another point in favor of shipping option (a)/(c): the next
time this happens, "which cascade step fired" stops being a guessing game.
