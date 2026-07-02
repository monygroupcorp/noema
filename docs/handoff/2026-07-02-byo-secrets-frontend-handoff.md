# BYO secrets — frontend (Profile "Connected accounts") handoff

**Date:** 2026-07-02
**Status:** ✅ **SHIPPED** (`dfc3b0c2`, branch `chainengine-migration`). §1–§3 built; §4 not reachable
(no web import surface exists). Acceptance criteria met against a configured store. Go-live = set
`SECRETA_MASTER_KEY` server-side (see below). Remaining items are polish/other-track — see
**Follow-ups** at the bottom; none block closing this thread.
_Original build brief follows._

**Prior status:** backend LIVE (API-only); **no frontend surface exists** — this is the build.
**Depends on:** BYO-secrets Phases A+B+C(host) — `docs/plans/2026-07-02-byo-secrets-gated-origin.md`,
`docs/spec/model-import.md` §"BYO secrets".
**Owner decision carried in:** anonymous/purse users CAN connect secrets; surface the
deanonymization warning and let them take the risk (their choice).

---

## Why this thread exists

The BYO-secrets backend is complete and API-only. A user can connect a Civitai/HuggingFace token
so gated model imports scrape metadata and download weights — but there is **nothing in the web app
that lets them do it**. Grep confirms: the only web hit for "secrets" is `Vault.tsx`, which is about
anonymous *credit* (browser-local purse), unrelated. This thread adds a **Profile-integrated
"Connected accounts" panel** over the existing endpoints. Backend stays untouched.

---

## The backend contract (already shipped — do not rebuild)

All under the existing `auth(req)` gate; works for wallet AND anonymous (purse/commitment) callers.

### Read — `GET /v1/me` (`CrystalApi.getMe`)
The server `MeView` already carries per-provider presence (`CrystalApi.ts:1934`):
```ts
secrets: Record<'civitai' | 'huggingface', 'connected' | 'absent'>
```
**The token is never returned** — only `connected`/`absent`. There is no endpoint that echoes a
stored token, by design (`Secretarium.resolve` is server-internal only).

### Connect — `PUT /v1/me/secrets/:provider`
- Body: `{ token: string, idleDays?: number }` (`idleDays` = the idle-expiry window; default 90).
- Returns `SecretView` (`CrystalApi.ts:1939`), token NEVER included:
  ```ts
  { provider, status: 'connected', expiresAt?: string /*ISO*/, warning?: string }
  ```
- `warning` is present **only for anonymous callers** (`bursaToken`/`commitment` in auctor) — the
  `DEANON_WARNING` string. This is the authoritative signal to render the caution.

### Disconnect — `DELETE /v1/me/secrets/:provider`
- Returns `{ provider, status: 'absent' }`.

### Feature-gate behavior
If no secret store is configured server-side (`SECRETA_MASTER_KEY` unset), the endpoints 501 and
`getMe.secrets` is all `'absent'`. The UI must treat a 501 as "connecting accounts isn't available
here" (hide/disable the panel), not as an error.

**Providers:** `civitai`, `huggingface` (the `SecretProvider` union). Don't hardcode a longer list.

---

## Frontend gaps to close

### 1. Client typing + API methods — `src/platforms/web/app/src/lib/api.ts`
The client `MeView` (`api.ts:159`) is **missing `secrets`** — add it, mirroring the server:
```ts
export interface MeView {
  appearance?: Appearance;
  generatio?: Generatio;
  bindings: Array<{ verb: string; modusId: string }>;
  secrets?: Record<'civitai' | 'huggingface', 'connected' | 'absent'>; // optional: 501/absent → undefined
}
export interface SecretView {
  provider: 'civitai' | 'huggingface';
  status: 'connected' | 'absent';
  expiresAt?: string;
  warning?: string;
}
```
Add two methods next to the other mutations (use the existing `anonHeaders()` helper, as the
Collection mutations do):
```ts
putSecret: (provider: string, token: string, idleDays?: number) =>
  fetch(`/v1/me/secrets/${provider}`, { method: 'PUT', headers: anonHeaders(), body: JSON.stringify({ token, idleDays }) }).then(j<SecretView>),
removeSecret: (provider: string) =>
  fetch(`/v1/me/secrets/${provider}`, { method: 'DELETE', headers: anonHeaders() }).then(j<SecretView>),
```
Handle the 501 in `j<>()`/caller so an unconfigured store degrades to "unavailable", not a red error.

### 2. Profile panel — `src/platforms/web/app/src/screens/Profile.tsx`
`Profile` already loads `getMe()` on mount (`Profile.tsx:29`). Extend that effect to read
`me.secrets` into state, and add a **"Connected accounts"** section below the existing Assets/skins
blocks (same `sectionhead` + `sub` markup the file already uses).

Per provider (Civitai, HuggingFace), one row:
- **Absent** → a "Connect" affordance: a token input (`type="password"`, never rendered back), an
  idle-window picker (default 90 days; offer 30/90/180/365 + the rotation nudge copy), a Connect
  button → `api.putSecret(provider, token, idleDays)` → on success flip the row to Connected and
  drop the token from state immediately.
- **Connected** → show `expiresAt` ("expires in N days, renews on use") + a Disconnect button →
  `api.removeSecret(provider)` → flip to Absent.
- Never display or retain the token after submit. No "reveal" affordance exists or should exist.

### 3. Deanonymization warning (owner decision — must be prominent)
Show the caution **before** an anonymous/purse user connects, and confirm it from the response:
- **Pre-connect:** if the local identity is anonymous (the app already knows this — it sends
  `x-commitment` / a purse token rather than a connected wallet; reuse that same signal), render the
  warning copy inline next to the Connect button so it's seen before submit.
- **Authoritative:** `putSecret` returns `warning` for anonymous callers — surface it on success too
  (e.g. a dismissible notice). For wallet callers `warning` is absent; render nothing.
- Copy to mirror (source of truth = `DEANON_WARNING`, `CrystalApi.ts:1950`): *connecting a
  Civitai/HF token links that named account to this anonymous session on our backend, weakening
  anonymity; use a minimally-scoped token and rotate it.*

### 4. Discoverability from the import flow (nice-to-have, same thread)
A gated import that fails for lack of a token should point here. When `POST /v1/models/import`
fails on a gated origin with no stored secret, deep-link the user to Profile → Connected accounts
with the relevant provider pre-expanded. (Confirm the import error carries enough to distinguish
"gated, no secret" from other failures; if not, that's a tiny backend follow-up, not a blocker.)

---

## Explicitly out of scope (say so in the PR)
- No token reveal/read-back — impossible by design; don't add an endpoint for it.
- No new login — this rides the existing durable `ownerKey` identity (wallet or purse).
- No backend changes beyond the optional import-error discriminator in §4.

## Acceptance
- Wallet user connects Civitai, sees "connected · expires in 90d", disconnects — round-trips.
- Anonymous (purse) user sees the deanonymization warning before *and* after connecting, and can
  still connect (their choice).
- With `SECRETA_MASTER_KEY` unset, the panel shows "unavailable" cleanly (no red error).
- Token never appears in the DOM, network response, or client state after submit.

## Pointers
- Backend facade: `src/allocutio/api/CrystalApi.ts` — `getMe` (1473), `putSecret` (1516),
  `removeSecret` (1532), `secretPresenceView` (1498), `SecretView` (1984), `DEANON_WARNING` (1995).
- Routes/contract: `src/allocutio/api/apiRouter.ts` (`auth` 128, secrets routes 507/512),
  `apiContract.ts` (`PUT/DELETE /v1/me/secrets/:provider`, `SecretViewSchema` 440).
- Server wiring: `src/index.ts:751` (`secretBoxFromEnv` → `MongoSecretarium`, 811 hands
  `secretWriter`/`secretPresence` to `CrystalApi`). Key parsing: `src/crystal/secretBox.ts:107`.
- Web (shipped): `src/platforms/web/app/src/lib/api.ts` (`MeView.secrets`, `SecretView`,
  `SecretsUnavailableError`, `putSecret`/`removeSecret`), `screens/Profile.tsx` (`ConnectedAccounts`
  + `SecretRow`), `styles/app.css` (`.byo-*`).
- Feature context: memory `project_model_import.md`; plan `docs/plans/2026-07-02-byo-secrets-gated-origin.md`.

---

## Go-live — one env var

**`SECRETA_MASTER_KEY`** (server-side only). This is the whole gate.
- **Format:** a 32-byte key as **64-hex** (`openssl rand -hex 32`) or base64. Comma-separated for a
  rotation ring — first entry = active encryptor, the rest decrypt-only for key rotation
  (`src/crystal/secretBox.ts:16-17,107`).
- **Unset/invalid** → `secretBoxFromEnv()` returns `null` → no `Secretarium` → `CrystalApi` gets no
  `secretWriter`/`secretPresence` (`index.ts:811`). Effect: `PUT/DELETE /v1/me/secrets` → **HTTP 500**
  ("BYO secrets are not available on this deployment"), `getMe().secrets` all `'absent'`. The panel
  detects this on first connect attempt and shows "unavailable" — no red error. Shipping the frontend
  before the key exists is therefore safe.
- **Set** → panel is fully live; gated Civitai/HF metadata scrape + weight download start working.
- **⚠ Durable secret:** losing/rotating-out the key makes every sealed token unrecoverable (users just
  reconnect). Store it with the other prod master secrets and back it up. `MongoSecretarium.ensureIndexes()`
  runs on boot against the `secreta` collection (`index.ts:753`).
- **Verify after deploy:** Profile → Connected accounts → connect a minimally-scoped Civitai token →
  row flips to "connected · expires in 90d"; Disconnect round-trips.

---

## Follow-ups (fleshed out — none block closing this thread)

### F1. Named callers still get the deanon warning — *other track (real web auth), DEFER*
**Symptom:** a user shown as "identified" in the UI (`ident.funding === 'named'`) still receives the
deanonymization `warning` from `putSecret` and sees the post-connect notice.
**Root cause (verified):** the web client authenticates *nothing* — every call goes through
`anonHeaders()`, which sends `x-commitment` and no `Authorization`/web3 bundle
(`lib/api.ts` `anonHeaders`). So `IdentityResolver.resolve` always takes branch 1 (`{ commitment }`,
`IdentityResolver.ts:79-82`) and the backend legitimately sees an anonymous caller — the warning is
*correct* for what actually reaches the server. The backend already supports named auth (JWT / API-key /
web3, `IdentityResolver.ts:84-124`); the web app just never sends it.
**Disposition:** **not this thread.** Wiring a named identity (sign-in → Bearer JWT or web3 signature
in the request headers) is the app-wide "real auth" track (go-live memory `project_go_live_runway.md`).
When that lands, this symptom disappears with **zero change to the secrets panel** — the panel already
keys its pre-connect warning off `ident.funding` and surfaces whatever the response authoritatively
returns. **Action: none here.** Do not add a client-only "named" shortcut that suppresses the warning —
it would lie about what the backend sees.

### F2. Deep-link from a failing gated import (handoff §4) — *blocked on a prerequisite, DEFER*
**Why not done:** there is **no model-import-by-URL surface in the web app at all.** `/models`
(`screens/Shelf.tsx`) renders static `MODELS` mock data; nothing calls `POST /v1/models/import`. There
is no failing-import UI to deep-link *from*.
**Disposition:** **deferred until the import UI exists** — it's the natural home for this. When built:
1. On an import that fails for a gated origin with no stored secret, deep-link to
   `/profile#connected-accounts` (add an `id`/anchor to the `ConnectedAccounts` section) with the
   provider pre-expanded (e.g. `?connect=civitai` → `SecretRow` reads it and focuses the token input).
2. **Backend prerequisite to confirm first:** the import error must be distinguishable as "gated, no
   secret" vs a generic failure. `ModelImporter` currently *falls back* to the public fetcher when no
   secret is present (`ModelImporter.ts:97-98`) rather than emitting a typed "needs secret" error — so a
   gated-but-private import fails later as a plain fetch/404, not a clear signal. Closing F2 needs a
   small backend change to surface a `secret.required` (provider) error. Tiny, but a real prerequisite —
   not a frontend-only task.

### F3. Proactive "unavailable" (hide the panel without a failed attempt) — *optional polish, ~20 min*
**Current:** the panel only learns the store is unconfigured *after* the first connect attempt returns
the 500 (then flips to "unavailable" via `SecretsUnavailableError`). Acceptance is already met — degrade
is clean, no red error — but a first-time anonymous user can type a token before finding out.
**Why it can't be detected today:** `getMe().secrets` is all-`'absent'` whether the store is unconfigured
*or* just empty — `secretPresenceView` returns all-absent when `deps.secretPresence` is falsy
(`CrystalApi.ts:1498-1506`). Indistinguishable from the client.
**Fix (if desired):** add an availability boolean to `MeView` so the panel can hide/disable proactively.
- `CrystalApi.ts`: `MeView` gains `secretsAvailable: boolean`; `getMe` sets it `= !!this.deps.secretWriter`.
- `apiContract.ts`: add `secretsAvailable` to the `MeView` schema (+`required`).
- `lib/api.ts`: mirror `secretsAvailable?: boolean` on the client `MeView`.
- `Profile.tsx`: render `ConnectedAccounts` only when `me.secretsAvailable !== false` (keep the
  reactive `SecretsUnavailableError` path as a belt-and-suspenders fallback).
**Disposition:** nice-to-have, not required for go-live. Do it only if the pre-key window is user-facing.
