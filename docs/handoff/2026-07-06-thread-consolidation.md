# Thread consolidation — auth · login · projects · frontend (2026-07-06)

**Purpose.** Four threads were worked in parallel on `chainengine-migration` over 2026-07-02→06.
All four are green in the tree, but they were planned in separate contexts, their docs partially
contradict each other, and **none of it is deployed** — origin/staging still runs the *old*
email-verify auth while the local branch carries 22 unpushed commits that replace it. This doc is
the single map: what each thread is, where it actually stands, how they entangle, which docs are
now stale, and the one aligned scope that closes all four. The execution plan lives in the
companion handoff: `docs/handoff/2026-07-06-consolidation-handoff.md`.

---

## 0. The one-sentence situation

Everything converges on **one coordinated staging push**: auth (Thread A) gates authed
verification of everything else; keyring (B) sits on auth; projects (C) sits on keyring's
per-account seam; the UX pass (D) is the surface all of them render on. Ship them together,
verify them together.

## 1. The four threads

### Thread A — Account auth rail (the "email auth" thread, since pivoted)
- **History:** JS-nuke blocker #11 → fiat **email**+password auth was built first
  (commit `9774be32`, spec `docs/spec/fiat-auth.md`, handoffs `2026-07-02-fiat-auth.md` +
  `2026-07-02-fiat-auth-frontend.md`). That version is what **staging runs today**
  (`register → verification_sent`, un-passable without a mailer).
- **Pivot (2026-07-03):** email was **dropped entirely** (Noop mailer, no `RESEND_API_KEY`,
  verification gate bricked). Replaced by **anonymous username+password** with **wallet and
  Telegram as recovery channels** (extra `Persona` rows on the same `animaId`; recovery mints a
  session, not a reset).
- **State:** backend `805d1fe6` + web rail `4ffd99f0`, committed local-only. 868/868 hermetic,
  plus an 18-check **real-Mongo smoke pass (2026-07-04)** covering the credenta migration,
  wallet link/recover/move, telegram challenge/bind/recover.
- **Sharp edge:** first boot of the new code runs a **destructive one-time clean-swap** —
  drops the `email_1` index and purges credenta docs missing `username`. It is self-disabling
  (runs only while the legacy index exists), but it means the deploy erases existing
  email-registered accounts **by design** (decided: no migration).
- **Still unverified:** real MetaMask `personal_sign` in a browser; live Telegram bot deep-link
  (`/start link_<code>`) transport. No unlink for either channel (deferred).

### Thread B — Login/session: multi-account Keyring
- Twitter-model multi-account, commit `15675d52`. **Pure client-side** (each account is already
  an independent soul; no new backend): `noema-sessions` keyed store, active pointer, instant
  switch + background refresh, per-account localStorage namespacing `noema-<animaId>-*`.
- **State:** built 2026-07-04, browser-smoke-verified only (switch/dropdown/anon slot). Never
  exercised against a backend that can actually mint two real sessions — blocked on Thread A
  deploying.
- **Open:** sign-out is local-drop only (no server-side revoke) — converges with backend ticket
  **T1 (GDPR delete must revoke sessions)**.

### Thread C — Projects · Holdings (`Provincia`)
- Account-owned workspace lens: `Provincia` type + `/v1/me/projects` CRUD + holdings
  (dataset/model/collection id refs) + `?project=` scoped surfaces + Teams reference (D6).
  Commits `39658fe5`, `85f421c2`, `9884b067`, `7c3fce92`.
- **State:** the best-verified thread — **E2E-verified against real noemaplane Mongo 2026-07-05
  (22/22)**. Depends on Thread B's per-account namespacing for the client cache; web filing UI
  (`HoldingToggle`) wired on Datasets/Shelf/Collections.
- **Open follow-ups:** cast-time auto-filing into `defaultProjectId`; shared-member count from
  the referenced Team; **dataset holdings point at mock ids until T4 (datasets backend) lands**.

### Thread D — Frontend flows (UX audit handoffs 1→2→3 + wiring backlog)
- Source: `docs/plans/2026-07-03-ux-flow-audit.md` → three worked handoffs:
  - **H1 Polish** — DONE (`6c196e10`…`07e8963b`): no Latin at the boundary, honest 404/doors,
    one name per screen.
  - **H2 Architecture** — DONE (`c79867fd`, `de6d734d`): production Rail pillars
    (Create/Memory/Build/Publish/Identity/Account), account-cluster merge, default-/make-flow
    picker, publish cross-link, `/map` retired. D3/D5 were deferred out and became Threads B and C.
  - **H3 P0** — DONE-as-triaged (`676ca8a2`): everything wireable was wired; everything without
    a backend was made *honest* ("coming soon", no fiction). Surfaced the five backend tickets
    (`docs/handoff/2026-07-06-backend-tickets-land-the-plane.md`, T1–T5).
- Earlier in the same arc: **wiring backlog Tier B #1–8** (`3731b088`) — already merged to
  staging and **anon-paths live-verified** against staging.noema.art (2026-07-06).
- **Deferred piece:** the **authed close-out** (`scratchpad/verify-authed.sh`) explicitly waits
  for the coordinated push, because staging's old email auth can't mint a session headlessly.

## 2. The dependency braid (why these can't ship piecemeal)

```
Thread A  auth rail ──────────────┐  mints real sessions
Thread B  keyring (needs ≥2 real accounts to mean anything) ──┐
Thread C  projects (per-account namespacing = B's seam) ──────┤
Thread D  UX surfaces (Profile/Onboard/Account all speak      │
          username-auth vocabulary; P0 wiring landed on H2 IA)┘
                        ↓
        ONE coordinated staging push + authed close-out
                        ↓
        remaining client-transport verifies (MetaMask, Telegram bot)
                        ↓
        backlog: backend tickets T1–T5 · CSAM Track B (parallel, non-code)
```

Concretely: you cannot verify B without A deployed; C's client cache is keyed by B's convention;
D's screens (Onboard recovery doors, Profile backup section, Keyring screen, ProjectHub) render
A+B+C. A partial deploy would put staging in a vocabulary the frontend no longer speaks.

## 3. Doc reconciliation — what is now stale or contradictory

| Doc | Status | Action |
|---|---|---|
| `docs/handoff/2026-07-02-fiat-auth.md` | **SUPERSEDED** — describes email verify/forgot/reset flows that were *deleted* in the pivot | banner added pointing here; do not build from it |
| `docs/handoff/2026-07-02-fiat-auth-frontend.md` | **SUPERSEDED** — same; also its single-session `noema-session` store was replaced by the keyring `noema-sessions` store | banner added |
| `docs/handoff/2026-07-03-frontend-wiring-audit.md` §B#4 | Partially stale: "idents is a singleton, `setIdentity` a no-op" was true then; Thread B made identity multi-account | read #4 through the keyring handoff |
| `docs/handoff/2026-07-03-keyring-multi-account-handoff.md` | current (worked) | — |
| `docs/handoff/2026-07-03-projects-holdings-handoff.md` | current (worked + E2E note) | — |
| UX handoffs 1/2/3 | current, status blocks accurate | — |
| `docs/handoff/2026-07-06-backend-tickets-land-the-plane.md` | current — this is the *next* build queue | — |
| `docs/handoff/2026-07-03-csam-go-live-handoff.md` | current — but **untracked** (see risks) | commit it |
| `docs/spec/fiat-auth.md` | describes the email-era backend | verify against `authRouter.ts` before citing |

**Terminology alignment:** "email auth" as a thread name is dead — the account rail is
**username+password**; email exists nowhere in the tree. "Login" = session minting (A) plus the
multi-account store (B). Keep the names Thread A/B/C/D or the plain names above; retire "fiat auth."

## 4. Risks and standing rules for the close-out

1. **Verify from the git tree, never the working tree.** The staging build already broke once on
   untracked-but-imported files. Right now `2026-07-03-csam-go-live-handoff.md` and
   `2026-07-03-ux-1-polish-handoff.md` are **untracked**, and `api.ts` has one uncommitted line
   (the wallet-link `moved?: boolean` type from A's review hardening). Commit before pushing;
   clean-worktree `tsc` before merge.
2. **The credenta clean-swap is destructive** (by decision). On staging it erases the test email
   accounts — fine. It is the same story at prod cutover — that is the accepted design; note it
   in the deploy message so nobody reads it as data loss.
3. **Never deploy mid-run** — check for in-flight pod runs before the droplet container swap.
4. **Multi-agent collisions** — parallel sessions on this repo have thrashed branches before.
   This consolidation exists to make `chainengine-migration` + this doc the single source; new
   sessions should read this doc first and work this branch only.
5. **Scratch files** (`_*_demo.ts`, `_feed_demo.mts`, `scripts/.koh-manifest.json`) stay
   uncommitted — exclude them as before.

## 5. The single aligned scope (summary)

1. **Land**: commit strays → clean-worktree green gates → push branch → merge → staging → image
   → droplet swap.
2. **Verify**: `verify-authed.sh` (accounts, teams, sponsorships, import) → keyring 2-account
   switch → projects authed CRUD/filing → MetaMask + Telegram client transports → (owner's call)
   one funded FLUX run.
3. **Then build**: backend tickets T1–T5 in the ticketed order (T1+T2 → T3 → T4→T5), with
   Track B CSAM/legal running in parallel off-code.

Step-by-step execution: **`docs/handoff/2026-07-06-consolidation-handoff.md`**.
