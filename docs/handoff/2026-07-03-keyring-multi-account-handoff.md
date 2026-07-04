# Handoff · Keyring / Multi-account identity

**Bucket:** own-context feature spec, deferred out of [UX Handoff 2 · Architecture](./2026-07-03-ux-2-architecture-handoff.md) (Decision 3).
**Do first, before Projects** — this establishes the account/ownership model that
[Projects · Holdings](./2026-07-03-projects-holdings-handoff.md) builds on.
**Why its own handoff:** the audit's recommendation was *retire Keyring* (singleton identity is
what shipped). The product call reversed it: **multi-account is wanted** — the Twitter model, where
one browser holds several accounts you switch between, each with its own projects/config for clean
separation. Nothing backs that today, so it's a real feature, not a nav move. We build it properly in
its own context rather than half-wiring it.

This handoff is **decisions-first** — each block is a call to make, with a recommendation and the
current-code reality it has to move.

---

## The good news up front: this is mostly a frontend change
Each account is already an independent backend soul — `/v1/auth/register|login` mints a per-anima JWT,
and every `/v1` call carries `Authorization: Bearer …` for the active session (`state/session.tsx:5-9`).
The backend has no concept of "one browser," so **holding several named logins at once needs no new
backend** — it's a client-side store of multiple sessions plus an active pointer. Recovery (wallet +
Telegram, `Profile.tsx` `BackupRecovery`) already exists per account. The work is: a multi-session
store, a real switcher, additive sign-in, and honest copy.

## Current reality (what has to change)
- **Singleton session** — `state/session.tsx` holds one `SessionState | null`; the token lives under a
  single key via `getSession`/`setSession` (`lib/api.ts`), and the refresh loop refreshes that one
  session (`scheduleRefresh`, `session.tsx:49`).
- **Singleton identity** — `state/identity.tsx:72` hard-codes `idents: [ident]`, `setIdentity: () => {}`.
  The comment (`identity.tsx:12-14`) states the singleton premise explicitly.
- **Mock Keyring** — `screens/Keyring.tsx` renders a profile list from the singleton `idents` (so always
  one row) and `Create profile` is `alert('… todo')` (`Keyring.tsx:52`). Its "switch" calls the no-op
  `setIdentity`.
- **Global (not per-account) local state** — `noema-project`, `noema-projects`, `noema-exec` are
  per-browser localStorage keys (`state/project.tsx`, `identity.tsx:30`), so today they'd bleed across
  accounts. This is the seam Projects consumes.

---

## Decision 1 — the multi-session store
Replace the single-token store with a keyed set of sessions + an active pointer.
- **Recommend:** `accounts: { animaId, token, username, expiresIn }[]` + `activeAnimaId`, persisted in
  localStorage. The **anon commitment path is always the implicit "no account" slot** — logging out of
  every account falls back to it, never to a broken state.
- **Migration:** on first load, fold the existing single stored token into the new store as one account
  (don't strand signed-in users).
- **Open:** do we persist the raw JWTs for all accounts in localStorage (convenient, but N tokens at
  rest) or only the active token + re-auth others on switch? Recommend persist-all for the Twitter-like
  instant switch, with a documented XSS/token-at-rest note.

## Decision 2 — switching semantics
`setIdentity(id)` becomes real: re-point `activeAnimaId`, swap the Bearer token the API layer reads, and
refresh the balance/collections/settings (they already derive from the session).
- **Recommend:** switch is instant if the target token is unexpired; refresh-then-activate if it's near
  expiry; fall to a re-login prompt only if refresh fails. No full reload — the providers re-derive.

## Decision 3 — add account (additive sign-in)
"Add account" routes to `/onboard`, but the result is **appended** to the store and becomes active —
distinct from today's replace-the-session login.
- **Recommend:** a mode flag on the onboarding flow (`?add=1`) so register/login `adopt()` appends
  rather than replaces. The existing anon→named "your anon work does not migrate" note still holds.

## Decision 4 — sign-out semantics
Sign out of the **active** account: remove it from the store, activate the next stored account, or fall
to anon if none remain. Offer an explicit "sign out of all."
- **Open:** does per-account sign-out revoke the token server-side, or just drop it locally? Recommend
  local-drop for now (matches today's `logout`), with a follow-up for server revocation.

## Decision 5 — the anonymity-claim honesty fix
Keyring's copy today promises profiles are "unlinkable by construction … we hold no map between them"
(`Keyring.tsx:16-17, 54-56`). For **named accounts you switch between in one browser, that's false** —
they're saved logins, linkable by the browser that holds them (and often by recovery channels). The
unlinkability promise belongs to the **anon commitment path only**.
- **Recommend:** rewrite the copy. Named accounts = "saved logins, switch freely" (Twitter framing).
  The "unlinkable, we witness nothing" language moves to the anonymous slot specifically. This keeps us
  honest post–Handoff 1.

## Decision 6 — per-account local state (the Projects seam)
Namespace the per-browser localStorage keys by `animaId`: active project, project list, execution mode.
- **Recommend:** key them `noema-<animaId>-project`, etc., so switching accounts switches the workspace.
  **This is the exact seam [Projects · Holdings](./2026-07-03-projects-holdings-handoff.md) consumes** —
  its ownership boundary is the account. Define the namespacing here; Projects reads it.
- **Open:** is `execution` (TEE/local/rented) per-account or per-browser-device? Recommend per-account
  (it's a posture of *who you are*), but it's a genuine call.

## Decision 7 — where it lives
Keyring gets its real home on the **Identity pillar** of the Rail once built (it's off-Rail today,
reachable only via `/map`). The Account dropdown's "switch to identified/anonymous" button
(`shell/Account.tsx`) expands into the account list.
- **Unblocks:** giving Keyring a real home is one of the gates on removing `/map` (UX Handoff 2 build
  order step 4). Tee/Studio (D8) and Trace (D7) are the others.

---

### Build order
1. Multi-session store (Decision 1) + migration of the existing single token.
2. `SessionProvider` — expose `accounts[]`, `activeAnimaId`, `switchAccount`, additive `addAccount`,
   `signOutActive` / `signOutAll` (Decisions 2–4).
3. `IdentityProvider` — derive from the active session; `setIdentity` → `switchAccount`; `idents` = the
   real account list.
4. Rebuild `screens/Keyring.tsx` — real switch/sign-out rows + "add account" (additive) + honest copy
   (Decision 5).
5. Account dropdown → account list (Decision 7).
6. Namespace per-account local state by `animaId` (Decision 6) — hand the seam to Projects.
7. Surface Keyring on the Rail's Identity pillar; note the `/map`-removal gate it clears.

---

**Sequence:** Keyring (you are here) → **[Projects · Holdings](./2026-07-03-projects-holdings-handoff.md)**.
Projects' ownership model depends on Decision 6 — do not start Projects' holdings work until the
per-account scoping seam is defined here.
