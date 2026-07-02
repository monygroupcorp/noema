# Spec — Fiat username/password auth rail

**Status:** BUILT 2026-07-02 (hermetic-green; not yet staging-verified). JS-nuke blocker #11.
**Handoff:** `docs/handoff/2026-07-02-fiat-auth.md`.

Fiat (Stripe / no-wallet) users need a persistent, **recoverable** account. Crystal previously
minted nothing — anon `x-commitment`, web3, API-key, and federated rails all either self-assert or
verify an externally-issued credential. This rail is the first that **issues** a crystal session,
from an email + password with email verification and password reset.

## Identity model

The identity is still the `Anima`; the mask is a **`'password'` `Persona`** (new genus) whose
`externusId` is the lowercased email. The credential material lives in its own store — a
`Credentum` — so `Anima`/`Persona` stay non-sensitive (mirrors `Secretum`/`Secretarium`).

```
Credentum { id, email(unique,lowercased), passwordHash, animaId,
            emailVerified, verifyTokenHash?, verifyTokenExp?,
            resetTokenHash?, resetTokenExp?, natum, mutatum }
```

- `passwordHash` — a **scrypt** envelope (see §decisions).
- `verifyTokenHash` / `resetTokenHash` — the **SHA-256** of the random token that was emailed. We
  look the row up by hashing the presented token, so a store dump never yields a usable link.
  Tokens are single-use + short-TTL (verify 24h, reset 1h).

## Endpoints (`createAuthRouter`, mounted at `/v1/auth/*` + compat `/api/v1/auth/*`)

| Route | Body | Result |
|---|---|---|
| `POST /register` | `{email,password}` | 202 `verification_sent` (account exists, unverified, no session). Dup email → generic **409** (no enumeration). |
| `GET\|POST /verify-email` | `{token}` | verify (single-use) → **auto-login**: `{session, animaId}`. |
| `POST /resend-verification` | `{email}` | always **202** (emails only an existing *unverified* account). |
| `POST /login` | `{email,password}` | verified → `{session, animaId}`; wrong creds → generic **401**; unverified → **403 `auth.email_unverified`**. |
| `POST /session/refresh` | Bearer session | re-mint → `{session, animaId}`. |
| `POST /forgot-password` | `{email}` | always **202** (no enumeration). |
| `POST /reset-password` | `{token,newPassword}` | re-hash + clear token; verifies the email if it wasn't. |

`session = { token, tokenType:'Bearer', expiresIn }`.

## The same-Anima trap (§trap)

The session is `jwt.sign({ sub: <animaId>, typ:'session' }, JWT_SECRET, {expiresIn})`.
`apiAcceptors.verifyJwt` special-cases `typ:'session'` to return `sub` **directly as an animaId**,
skipping the `'web'`-genus re-resolution used for legacy web JWTs. Without this, the session's
`sub` would be treated as a `'web'` externusId and mint a *second* anima — splitting the account
from the one the `'password'` persona established at register. The hermetic test
`authRouter.test.ts` ("the same-Anima invariant") proves register → verify → `/v1/me` → login all
resolve one anima and mint it exactly once.

## Decisions (the handoff asked these be picked + stated)

1. **Hashing — scrypt (`node:crypto`), not argon2id/bcrypt.** Both of those are native modules that
   complicate the Node-20 staging build; scrypt is a first-class memory-hard KDF already in the
   runtime, so zero new deps. Stored as a self-describing `scrypt$N$r$p$salt$hash` envelope
   (cost params can evolve without a migration), verified with `timingSafeEqual`.
2. **Session = bearer JWT**, not a cookie — the crystal React app sends headers (`anonHeaders`).
3. **Login blocked until `emailVerified`** — distinct `auth.email_unverified` (403) so the frontend
   can prompt "resend". Simplest/safest v1 (vs. allow-login-but-gate-spend).
4. **Mailer seam** (`Mailer.send({to,subject,html})`) with `NoopMailer` (logs link — hermetic/dev
   default) + `HttpMailer` → **Resend** (`RESEND_API_KEY`, plain `fetch`, no npm dep). Vendor is a
   one-file swap; `mailerFromEnv` degrades to Noop when unconfigured.

## Security

scrypt hashing; hashes never logged/returned; constant-time verify. Verify/reset tokens are
256-bit random, single-use, short-TTL, **stored hashed**. `register`/`login`/`forgot`/`resend` are
IP-rate-limited (express-rate-limit, wired in `index.ts`; the router accepts injected limiters so
tests run unthrottled). Generic messages everywhere (no user enumeration). Email normalized
(lowercase/trim). `JWT_SECRET` is server-only and gates the whole rail (unset ⇒ rail disabled).

**Deferred:** session revocation on password reset (sessions are stateless short-TTL JWTs — full
revocation would need a per-credentum session epoch embedded in the token + checked in `verifyJwt`).
Disposable-email blocking. These are noted, not built.

## Wiring / env

- `JWT_SECRET` (required to enable the rail) — signs + verifies sessions.
- `RESEND_API_KEY` + `MAIL_FROM` (+ `MAILER_PROVIDER=resend`) — real email; else NoopMailer.
- `MAILER_REVEAL_LINKS=1` — let NoopMailer print links (local dev only).
- `AUTH_APP_BASE_URL` — base the emailed verify/reset links point at (a frontend page).
- `SESSION_TTL_SECONDS` — session lifetime (default 7d).
- Store: `credenta` collection; `MongoCredentum.ensureIndexes()` (unique `email` + sparse token
  indexes) is called fire-and-forget at boot.

## Files

`src/types/credentum.ts`, `src/crystal/{passwordHash,sessionToken,MongoCredentum,MemoryCredentum}.ts`,
`src/allocutio/api/{Mailer,authRouter}.ts`, `src/types/persona.ts` (`'password'` genus),
`src/allocutio/api/apiAcceptors.ts` (session branch), `src/index.ts` (wiring).
Tests: `tests/unit/allocutio/api/authRouter.test.ts`, `tests/unit/crystal/passwordHash.test.ts`,
`apiAcceptors.test.ts` (session branch).
