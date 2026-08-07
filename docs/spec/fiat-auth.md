# Spec — Fiat username/password auth rail

**Status:** BUILT. Mounted at `/v1/auth/*` (+ compat `/api/v1/auth/*`) in `index.ts`.

Fiat (Stripe / no-wallet) users need a persistent, **recoverable** account. Crystal previously
minted nothing — anon `x-commitment`, web3, API-key, and federated rails all either self-assert or
verify an externally-issued credential. This rail is the first that **issues** a crystal session,
from a username + password.

**Dropped: the email verification rail.** An earlier revision of this spec registered by email
with a verify/resend/forgot/reset flow gated behind a verified-email flag. That never shipped —
rth ruled to drop email. Registration is anonymous username+password and logs the caller in
immediately, no verification step. Account recovery is not email-based: a user binds backup
channels (wallet / Telegram) to their soul, and proving one of those channels reaches the
`animaId` and mints a session.

## Identity model

The identity is still the `Anima`; the mask is a **`'password'` `Persona`** whose `externusId` is
the normalized username. The credential material lives in its own store — a `Credentum` — so
`Anima`/`Persona` stay non-sensitive.

- Password hashing — **scrypt** (`node:crypto`), stored as a self-describing
  `scrypt$N$r$p$salt$hash` envelope, verified with `timingSafeEqual`.
- Session — a bearer JWT: `jwt.sign({ sub: <animaId>, typ:'session' }, JWT_SECRET, {expiresIn})`.
  `apiAcceptors.verifyJwt` special-cases `typ:'session'` to return `sub` **directly as an
  animaId**, skipping the `'web'`-genus re-resolution used for legacy web JWTs — without this the
  session's `sub` would be treated as a `'web'` externusId and mint a *second* anima, splitting
  the account from the one the `'password'` persona established at register.

## Endpoints (`createAuthRouter`, mounted at `/v1/auth/*` + compat `/api/v1/auth/*`)

### Username core

| Route | Body | Result |
|---|---|---|
| `POST /register` | `{username,password}` | 201 `{session, animaId}`. Anonymous, logs in immediately — no verification step. Dup username → generic **409** (no enumeration). |
| `POST /login` | `{username,password}` | 200 `{session, animaId}`; wrong creds or missing account → generic **401**. |
| `POST /session/refresh` | Bearer session | re-mint → `{session, animaId}`. |

### Backup recovery channels — bound to the soul from the profile

| Route | Auth | Body | Result |
|---|---|---|---|
| `POST /wallet/challenge` | none | `{address}` | `{token, statement}` to sign. |
| `POST /wallet/link` | Bearer | `{challengeToken,signature}` | bind the proven wallet to the caller's soul; moves the binding if it belonged to another soul. |
| `POST /wallet/register` | none | `{challengeToken,signature}` | wallet-first signup: logs into the bound soul if the wallet is already linked, else mints a soul and binds it. `{session, animaId}`, 201 on a fresh mint / 200 on resolve-to-existing. |
| `POST /wallet/recover` | none | `{challengeToken,signature}` | prove a bound wallet → `{session, animaId}` (forgot-password path). |
| `GET /wallet` | Bearer | — | `{wallets: address[]}` linked to the caller. |
| `POST /telegram/challenge` | Bearer | — | `{code, deepLink?, botUsername?}` — one-time link code; 501 if `linkTokens` isn't configured. |
| `GET /telegram` | Bearer | — | `{linked: boolean}`. |
| `POST /telegram/recover` | none | `{code}` | redeem a bot-issued recovery code → `{session, animaId}` (forgot-password path); 501 if `linkTokens` isn't configured. |

`session = { token, tokenType:'Bearer', expiresIn }`. All 11 routes above are the full rail.

## Security

scrypt hashing; hashes never logged/returned; constant-time verify. `register`/`login`/wallet
challenge+recover routes accept injected rate limiters (`index.ts` wires express-rate-limit; tests
run unthrottled). Generic messages everywhere (no user enumeration). `JWT_SECRET` is server-only
and gates the whole rail.

## Wiring / env

- `JWT_SECRET` (required to enable the rail) — signs + verifies sessions.
- `SESSION_TTL_SECONDS` — session lifetime (default 7d).
- Telegram linking requires an injected `linkTokens` store + `botUsername`; absent → the
  `/telegram/*` routes report 501.
- Store: `credenta` collection.

## Files

`src/types/credentum.ts`, `src/crystal/{passwordHash,sessionToken,walletAuth,MongoCredentum,MemoryCredentum}.ts`,
`src/allocutio/api/authRouter.ts`, `src/types/persona.ts` (`'password'` genus),
`src/allocutio/api/apiAcceptors.ts` (session branch), `src/index.ts` (wiring).
