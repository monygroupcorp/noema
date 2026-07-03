# UX Handoff 2 · Architecture

**Bucket:** P1 — information architecture, discoverability, consolidation. **Do this second.**
**Source:** `docs/plans/2026-07-03-ux-flow-audit.md`
**Why second:** this is the structural cure for "scattered." It depends on the vocabulary settled in
Handoff 1, and it must land *before* Handoff 3 (P0) so we wire buttons into their final homes, not
into screens we're about to move. It also has a hard deadline: **the Map goes away at launch, and
several screens have no other home yet.**

This handoff is **decisions-first** — each block is a call to make together, with a recommendation.
Nothing below should be built until the decision is settled.

---

## Decisions settled (2026-07-03)
Worked as a **two-pass** plan. Pass 1 = Rail + account-cluster merge (Decisions 1 & 2). The rest is
gated behind two deferred specs so we don't half-build the vision.

- **D1 Rail** — new pillars **Create / Memory / Build / Publish / Identity / Account**. Generate bucket
  is **"Create"** (not "Make" — protected canon verb). Account dropdown collapsed to account-only
  actions. *Pass 1.*
- **D2 Account merge** — six account-ish screens → three homes: **Settings** (folds Preferences —
  added to the settings sub-nav + a section card, `/preferences` recrumbed under Settings),
  **Activity** (renamed from `Status`, kills the duplicate "Account" title; spend-ledger deferred — no
  backend endpoint yet, carries an honest "coming" note), **Identity/Security** (Profile is the
  **signed-in** identity home, surfaced on the Rail). The mock `Vault` is NOT retired — it uniquely
  serves the **anonymous** bearer-credit case (Profile's security needs a named account), so it stays
  reachable from Funding + `/map` and travels with the deferred anonymous-credit/purse spec (D3).
  *Pass 1.*
- **D3 Keyring** — **DEFERRED to its own spec.** Multi-account (Twitter-model: several identities per
  browser, each with its own projects/config) *is* wanted, but nothing backs it today (singleton
  identity/session). Keyring stays reachable via `/map` in the interim; not on the new Rail. Build it in
  its own context so we don't betray the vision with a half-feature.
- **D5 Projects** — **DEFERRED to its own context** (pairs with D3: per-account projects). Projects /
  ProjectHub untouched this pass.
- **D4** (default-flow picker), **D6** (publish cross-link), **D7** (Memory/Trace), **D8** (TEE) —
  remaining; next pass, after D3/D5 specs land.
- **`/map` removal** — held until Keyring/Tee/Studio/Trace all have real homes. Removing it now would
  strand them. This is the explicit "don't move on until they're done" gate.

**Purse overload (D2):** sharpest in the mock Vault (retired). Deep purse-vocabulary unification
(anonymous bearer purse vs shareable minted purse) travels with the D3 identity spec.

---

## The forcing function: the Map is leaving
`/map` is a dev scaffold, not a production surface. It is currently the *only* path to
`/keyring`, `/tee`, `/studio`, `/trace`. **Sequence is mandatory:** give those a real home (or delete
them) → *then* remove the `/map` route + the brand-glyph link (`Rail.tsx:49`). Removing the Map first
strands them.

---

## Decision 1 — the single production Rail (name the real pillars)
Replace the current 4 Rail sections with pillars that cover the whole product. Proposed:

```
CREATE     Chat · Catalogue → Card · Canvas · Runs (history/active)
MEMORY     Space · Trace
BUILD      Datasets · Models · Collections
PUBLISH    Feed · Review (author + admin) · Collection export
IDENTITY   Profile · Vault · Private (TEE/Studio) · Keyring?
ACCOUNT    Funding · Settings · Activity
```
- **Open:** the label for the generate bucket. **Not "Make"** — `/make` is a protected canon verb
  (default text→image flow, Telegram parity); overloading it muddies the verb. Recommend **"Create."**
- **Open:** what happens to the **Account dropdown** (`Account.tsx`)? It currently re-lists items and
  adds Profile/Preferences/Teams/Sponsorships. Recommend: collapse it into the Rail's Account/Identity
  pillars and keep the avatar menu for *account-only* actions (switch identity, sign out).

## Decision 2 — merge the six account-ish screens
Account / AccountSettings / Status / Profile / Preferences / Vault overlap heavily (two are literally
both titled "Account"). Target three homes:
- **Settings** — billing · api · security · preferences (fold `Preferences.tsx` in here).
- **Activity** — balance + the **spend ledger that doesn't exist yet** (build it here); rename
  `Status` → "Activity" to kill the duplicate "Account" title.
- **Identity / Security** — recovery + secrets + purse, co-located (today split across a mock Vault and
  Profile). Also resolves the **"purse" overload** (anon credit note vs account token) — pick one name.
- **Open:** exact screen boundaries; which of the six get deleted vs merged.

## Decision 3 — Keyring: retire or rebuild?
Its multi-profile premise contradicts the shipped **singleton identity** model (one identity/browser,
`setIdentity` is a no-op; "Create profile" = `alert(todo)`). Recommend **retire** unless multi-identity
is coming back — if it is, rebuild it as a real login/logout list. **Open:** which.

## Decision 4 — home for "set my default /make flow"
Backend is ready: per-verb bindings (`me.bindings`, verb→modusId, default `flux-schnell`), rebind via
`/bind make <flow>`. Missing = a **web model picker**. Wire the Preferences "auto-apply a model" row
(`Preferences.tsx:69-70`) to write the binding.
- **Open:** does the default-flow picker live under **Settings/Preferences** (portable defaults, the
  current spot) — recommended — and do we extend it to the other canon verbs as they land?

## Decision 5 — Projects: give it real holdings or demote it
Project type carries **no datasets/models fields** (`state/project.tsx:50`), ProjectHub tabs are stubs,
holdings hardcoded 0 — project→asset linkage is structurally impossible today, and Projects/ProjectHub
disagree on what a project holds. **Open:** (a) give Project real dataset/model holdings + scoped
surfaces, or (b) drop the Datasets/Models tabs and demote Projects to a lightweight workspace until the
backend exists. Recommend (b) for launch.

## Decision 6 — reconcile the two publish systems
Collection chain ends at Export (you/hosting/NOESIS); Feed is fed only from single Card results
(`Card.tsx:302`). A collection author has no "post to feed" path. **Open:** one publish system, or
cross-link the two (add "post to feed" on the collection hub). Recommend cross-link for launch.

## Decision 7 — the Memory pillar (Space + Trace)
- `Space.tsx:28` — gated on `VITE_CORPUS_SPACE=1`, so every inbound link hits a dev placeholder in
  prod. Replace the build-flag gate with a real **empty/loading state gated on data presence**.
- `Trace` is orphaned and superseded by Space's in-page viewer (`Space.tsx:570`). **Open:** delete
  Trace, or link the Space viewer's detail to it. Recommend delete unless it grows unique value.
- Surface **Memory** in the Rail (Decision 1) — today the whole pillar is invisible.

## Decision 8 — surface TEE / privacy properly
`/tee` (the marketing headline) is reachable only via the Map, and is redundant with the inline
per-run "TEE · sealed" radio that never opens it. Give it a home under **Identity/Privacy**, and make
the Account posture "sealed session" pill (`Account.tsx:83`) a real link. **Open:** does the Card's TEE
selection deep-link to `/tee` as the provisioning view, or do we fold `/tee` into the Card?

---

### Build order once decisions land
1. New Rail (Decision 1) + move keyring/tee/studio/trace into it.
2. Account-cluster merge (Decision 2) + Status→Activity + purse rename.
3. Default-flow picker (Decision 4), Projects demote (5), publish cross-link (6), Memory/TEE (7,8).
4. **Then** remove `/map` + brand-glyph link.
5. Re-run the job-flow trace to confirm orphan count → 0 and the navs agree.

---

**Sequence:** [Polish](./2026-07-03-ux-1-polish-handoff.md) → Architecture (you are here) → [P0](./2026-07-03-ux-3-p0-handoff.md).
**← Prev:** [Handoff 1 · Polish](./2026-07-03-ux-1-polish-handoff.md).
**→ Next:** with the IA settled, move to **[Handoff 3 · P0](./2026-07-03-ux-3-p0-handoff.md)** — its
wiring lands onto the final homes decided here (each P0 packet notes its dependency on the decisions above).
