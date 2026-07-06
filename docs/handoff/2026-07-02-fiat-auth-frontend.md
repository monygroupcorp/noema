# Handoff — Fiat auth FRONTEND (login/register/verify/reset screens + session wiring)

> **⚠ SUPERSEDED (2026-07-03/04).** Email was dropped (username+password + wallet/Telegram
> recovery instead), and the single-session `noema-session` store described below was replaced by
> the **multi-account keyring** `noema-sessions` store (`2026-07-03-keyring-multi-account-handoff.md`).
> Do not build from this doc. Current map: `docs/handoff/2026-07-06-thread-consolidation.md`
> (Threads A + B).

**For:** a fresh-context agent working in the React web app. **Goal:** wire the **already-built**
fiat username/password backend (`/v1/auth/*`) into the web frontend — register/login/verify/reset
screens, plus a real **session** layer so a logged-in user's `/v1` calls carry
`Authorization: Bearer <session>` instead of the anonymous `x-commitment`.

The backend is DONE and hermetic-green (commit `9774be32`, spec `docs/spec/fiat-auth.md`). This is a
**pure frontend** task: no crystal/TS-backend changes. The web app currently has **no login UI and
no session** — only the anon `x-commitment` identity is wired.

## Ground rules
- App: `src/platforms/web/app` (Vite + React 18 + `react-router-dom` v6; **no** external state lib —
  React Context only). Design-system classes: `.btn`, `.btn-ghost`, `.byo-input` (see `Profile.tsx`).
- Keep the anon path intact — logged-out users still work via `x-commitment` (fiat auth is additive).
- End green (the app's typecheck/build). Prefer `fix:`; this is a genuinely new feature → `feat(web):`.

## The backend contract (what you're calling)
All under `/v1/auth` (dev server proxies `/v1` → backend). Errors are `{ error: { code, message } }`.

| Call | Body | Success |
|---|---|---|
| `POST /register` | `{email,password}` | `202 {status:'verification_sent'}` — **no session** (verify first). Dup email → generic `409`. |
| `POST /verify-email` | `{token}` | `200 {session,animaId}` — **auto-login**. |
| `POST /resend-verification` | `{email}` | always `202`. |
| `POST /login` | `{email,password}` | `200 {session,animaId}`; wrong creds → `401 auth.invalid`; unverified → **`403 auth.email_unverified`**. |
| `POST /session/refresh` | (Bearer session header) | `200 {session,animaId}`. |
| `POST /forgot-password` | `{email}` | always `202`. |
| `POST /reset-password` | `{token,newPassword}` | `200 {status:'password_reset'}`. |

`session = { token, tokenType:'Bearer', expiresIn }`. Password rule: **≥ 8 chars** (mirror
client-side to fail fast; the server re-checks). Handle `403 auth.email_unverified` on login by
offering a "resend verification" action.

## The core seam — `src/lib/api.ts` (headers + a session store)
Today every call builds headers two ways (grep them):
```ts
export function commitment(): string { /* localStorage 'noema-commitment', minted once */ }
const anonHeaders = () => ({ 'content-type': 'application/json', 'x-commitment': commitment() });
// reads use inline:  { 'x-commitment': commitment() }
```
**Do:**
1. Add a session store beside `commitment()`:
   ```ts
   const SESSION_KEY = 'noema-session';
   export function getSession(): string | null { return localStorage.getItem(SESSION_KEY); }
   export function setSession(token: string | null) { token ? localStorage.setItem(SESSION_KEY, token) : localStorage.removeItem(SESSION_KEY); }
   ```
2. Make the header builders **prefer the bearer**, fall back to anon:
   ```ts
   const authHeaders = () => {
     const s = getSession();
     return { 'content-type': 'application/json', ...(s ? { authorization: `Bearer ${s}` } : { 'x-commitment': commitment() }) };
   };
   const readHeaders = () => { const s = getSession(); return s ? { authorization: `Bearer ${s}` } : { 'x-commitment': commitment() }; };
   ```
   Then replace `anonHeaders()` → `authHeaders()` and the inline `{ 'x-commitment': commitment() }`
   reads → `readHeaders()` throughout the file. Backend `verifyJwt` accepts the bearer session
   directly (its `typ:'session'` → animaId), so a logged-in user's `/v1/me`, collections, editiones,
   secrets, etc. all become **identified** with no other change.
3. Add the auth calls (they DON'T send a commitment on register/login/forgot; verify/reset send only
   the token; refresh sends the bearer):
   ```ts
   auth: {
     register: (email, password) => fetch('/v1/auth/register', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({email,password}) }),
     login:    (email, password) => fetch('/v1/auth/login', …).then(j<{session:Session;animaId:string}>),
     verifyEmail: (token) => …, resendVerification: (email) => …,
     forgot: (email) => …, reset: (token, newPassword) => …, refresh: () => …,
   }
   ```
4. **Improve error surfacing.** `j<T>()` currently throws `Error("<status> <text>")`. Give the auth
   calls a parser that reads `body.error.{code,message}` so screens can show the message and branch on
   `code` (`auth.email_unverified`, `conflict.registration`, `auth.token_invalid`, `input.malformed`).

⚠ **Identity note to surface in UI:** the anon `x-commitment` and a logged-in anima are **different
souls** — work/credits created while anonymous do NOT migrate into the account on login. Say so at
login (or don't mint a commitment until the user actually spends anonymously). Account-linking/merge
is out of scope here.

## Session state — a NEW context (do not overload `state/identity.tsx`)
`src/state/identity.tsx` (`useIdentity`) is a **cosmetic** profile/funding/execution skin over mock
`IDENTS` — NOT real auth. Add a separate real-session context, e.g. `src/state/session.tsx`:
- Holds `{ token, animaId, email? }`, seeded from `getSession()`; exposes `login()/register()/logout()`
  that call `api.auth.*` + `setSession()`; `logout()` clears the session (and optionally re-mints a
  fresh commitment).
- Provide `useSession()`. Wrap the app in `src/main.tsx` — the provider stack there is
  `IdentityProvider → ProjectProvider → PromptAssistProvider` inside `<BrowserRouter>`; add
  `<SessionProvider>` alongside them. Mirror `state/identity.tsx`'s Context+localStorage shape.
  Optionally schedule `api.auth.refresh()` before `expiresIn` lapses.

## Screens + routes (react-router v6 in `src/App.tsx` — plain `<Routes>/<Route>`)
Add these routes. **The two token routes' PATHS are fixed by the backend** — the emailed links are
`${AUTH_APP_BASE_URL}/verify-email?token=…` and `/reset-password?token=…` (see `authRouter.ts`
`verifyLink`/`resetLink`), so the frontend routes MUST be exactly:
- `/login` — email + password → `useSession().login()` → on `403 auth.email_unverified` show a resend
  affordance; on success redirect to `/app`.
- `/register` — email + password (+ confirm) → register → "check your email" confirmation state.
- `/verify-email` — read `?token` (via `useSearchParams`) → `POST verify-email` → store session →
  redirect to `/app`. Handle invalid/expired token (`400 auth.token_invalid`) with a resend link.
- `/forgot-password` — email → forgot → generic "if that email exists, we sent a link" (never reveal).
- `/reset-password` — read `?token` + new password → reset → redirect to `/login`.
**Form/style conventions (all in `src/styles/app.css` — plain global CSS, no Tailwind/modules):**
- `<form onSubmit>` template: `Ceremony.tsx:358` (`<form className="cer-claim">` + `<input className="cer-input">` + `<button className="btn" type="submit">`). Labeled field: `Preferences.tsx:65`.
- Classes: text inputs `.cer-input` or `.byo-input`; buttons `.btn` / `.btn.block` (full-width) / `.btn-ghost`; **errors → inline `.warn` banner** (amber). No toast system exists — use the per-component `const [err,setErr]=useState<string|null>(null)` → `{err && <div className="warn">{err}</div>}` pattern (see `Profile.tsx:28,69`).
- Render pre-auth screens **standalone** (like `Landing.tsx` / `Ceremony.tsx` with their own layout), NOT inside `AppShell` — they're reached logged-out.

## Account menu — `src/shell/Account.tsx`
The top-bar dropdown (uses `useIdentity`, shows credits/compute/identity). Add a **Sign in** link
(→ `/login`) when `useSession()` has no token, and **Sign out** (`logout()`) + the account email when
it does. This is the discoverable entry point.

## Backend env to set for a real run (ops)
- `JWT_SECRET` — **required**, or the whole rail 404s (router only mounts when set).
- `AUTH_APP_BASE_URL` — the web origin (e.g. `https://noema.art`) so emailed links resolve to the
  `/verify-email` + `/reset-password` routes above.
- `RESEND_API_KEY` + `MAIL_FROM` — real email; else `NoopMailer` logs the link (set
  `MAILER_REVEAL_LINKS=1` locally to read it out of the backend logs during dev).
- `SESSION_TTL_SECONDS` — optional (default 7d).

**Dev:** the Vite dev server (port 5174) proxies `/v1` + `/api` → `API_ORIGIN` (default
`https://staging.noema.art`; see `vite.config.ts`). Point `API_ORIGIN` at a local backend to iterate
against real `/v1/auth/*` — the NoopMailer link then appears in that backend's logs.

## Acceptance
- Register → (dev) copy the verify link from the backend log → `/verify-email` auto-logs-in → the
  account dropdown shows the email + Sign out → `/v1/me`-backed screens now reflect the **account**
  (bearer), not the anon commitment.
- Login: correct+verified → in; wrong → inline error; unverified → resend affordance.
- Forgot → reset → login with new password; old password rejected.
- Logged-out app still works fully via `x-commitment` (no regressions).
- App typecheck/build green.

## Pointers
- `src/lib/api.ts` (`commitment()` :56, `anonHeaders` :67 — the seam), `src/App.tsx` (:54 routes),
  `src/main.tsx` (providers), `src/state/identity.tsx` (cosmetic — do NOT reuse for auth),
  `src/shell/Account.tsx` (dropdown), `src/screens/Profile.tsx` (form/input/button patterns).
- Backend: `docs/spec/fiat-auth.md`, `src/allocutio/api/authRouter.ts`, `src/allocutio/api/apiAcceptors.ts`.
- Related open frontend gap: web **upload/presign** (`signUpload` → unimplemented `/api/v1/storage/...`)
  is blocker #10 (`docs/handoff/2026-07-02-upload-presign.md`) — separate task.
