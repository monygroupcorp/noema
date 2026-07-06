# Frontend Wiring Audit & Backlog — approach fresh

- **Date:** 2026-07-03
- **Branch:** `chainengine-migration` (deployed to `staging`, healthy on the post-JS-nuke image)
- **Purpose:** With the legacy JavaScript backend deleted (the "JS nuke"), the codebase is
  crystal-only — no more dead JS producing false "backend exists" positives. This is the map of
  **what the web app actually wires to the backend vs. what still renders mock data**, ranked so
  the next session can pick a target and go. Every `/v1` route named here is real crystal code that
  passed the staging build.
- **Method:** two parallel read-only sweeps — (1) full crystal HTTP route surface, (2) the web
  app's API client + screen callers + mock screens — then cross-referenced.

## Where things live (orientation for a cold start)

- **Server routes:** `src/index.ts` (router mounts + prefixes), `src/allocutio/api/apiRouter.ts`
  (the bulk of `/v1`), plus `authRouter.ts`, `storageRouter.ts`, `purseRouter.ts`,
  `sponsioRouter.ts`, `widgetRouter.ts`, `x402AgentRouter.ts`, `agentCompatRouter.ts`,
  `mcp/mcpRouter.ts`; `src/api/{webhooks,internal,vestigia,arcanum}/*Router.ts`.
- **Frontend app** (the go-live React app, served when `STAGING_FRONTEND=1`):
  `src/platforms/web/app/`. API client = `src/lib/api.ts` (the `api` + `api.auth` objects) and
  `src/lib/ceremony.ts`. Screens = `src/screens/**`; shell/nav = `src/shell/**`; UI = `src/ui/**`;
  React state contexts = `src/state/**`.
- **Mock data sources:** `src/lib/{datasets,models,collections,projects,idents}.ts` (each carries a
  `TODO(backend …)` marker). `src/state/identity.tsx` and `src/state/project.tsx` seed from the
  `IDENTS` / `PROJECTS` mocks — see the cross-cutting note below.

## Reconciliations (don't get tripped up)

- `GET /v1/flows` and `GET /v1/flows/:id` **DO exist** (`apiRouter.ts:464,480`) — they're registered
  in a multi-line form that a naive single-line grep misses. Catalog/Card/Collections use them.
- `GET /v1/me/status` **exists** (`apiRouter.ts:498`).
- `GET /v1/data/datasets` and `POST /v1/data/trainings/calculate-cost` do **NOT** exist server-side.
  The client has stub methods (`listDatasets`, `trainingCost`) but nothing calls them — training
  management endpoints are unbuilt (see Tier C).
- `Ceremony.tsx` IS backend-real: `/v1/ceremony`, `/v1/ceremony/slots`, `/v1/ceremony/current.zkey`,
  `/v1/ceremony/contributions` all exist (`ceremoniaRouter.ts`). The `ceremony.ts:11` "TODO(backend)"
  comment is stale defensive code (it degrades to an "announced" fallback if the coordinator is down).

## A. Wired & live — the working spine (backend-real, end-to-end)

- **Gen loop:** Catalog → Card. `GET /v1/flows`, `POST /v1/runs`, `POST /v1/runs/quote`,
  `GET /v1/runs/:id`, `POST /v1/editiones` (publish-to-feed from Card).
- **Feed:** `Feed.tsx` ↔ `GET /v1/feed`.
- **Collectiones:** Collections, CanonicRun, Curation, TraitRules, TraitsGarden, EditioHub,
  EditioExport ↔ create/list/`:id`/rarity/pieces/approve/reject/pause/resume/cancel/extend/tractus/fire.
- **Moderation:** `Review.tsx` ↔ `/v1/editiones/review` + approve/reject/confirm-csam.
- **Auth + session:** Auth, Onboard, `state/session.tsx` ↔ `/v1/auth/*`.
- **Profile:** `Profile.tsx` ↔ `/v1/me`, `/v1/purses*`, `/v1/me/secrets/:provider`,
  `/v1/me/appearance`, `POST /api/v1/storage/uploads/sign`.
- **Status:** meStatus (`/v1/me/status`) in AccountSettings/Status/Dashboard/shell.
- **Ceremony:** `Ceremony.tsx` ↔ `/v1/ceremony/*`.

## B. Backend EXISTS, frontend mock or absent — the WIRE-NOW backlog (ranked)

> **Landed 2026-07-03 (this session): #1–4 wired.** App typecheck + production build green.
> - **#1 Run.tsx** — now streams a real run over `GET /v1/runs/:id/stream` (SSE), keyed on `?id=`.
>   Progressus phases → the 5-stage timeline; terminal `complete` fetches the run for its exitus
>   (media rendered via `mediaFromOutput`). Card's dispatched result got an "open run view →" link so
>   it's reachable end-to-end. `setTimeout` mock deleted. `api.streamRun` now has a caller.
> - **#2 Funding.tsx** — new `api.getDepositConfig`/`api.depositQuote` client methods; pack credits
>   computed live from `pointsPerUsd × funding rate`, real CreditVault address shown, and a live
>   ETH→points quote widget on the onchain rail. Hardcoded `PACKS` gone.
> - **#3 Shelf.tsx** — new `api.listMyModels` client method; renders real owned models from
>   `GET /v1/me/models` (base/trigger/license/commercial/listing). Mock `lib/models.ts` **deleted**
>   (royalty/run economics don't exist server-side → not shown; see #5).
> - **#4 Identity** — `state/identity.tsx` now DERIVES the current `ident` from the real
>   `useSession()` + live `/v1/me/status` balance (funding follows auth; balance is real).
>   `IDENTS` mock **deleted**; `idents` is a singleton, `setIdentity` a no-op; Account's
>   "switch identity" is now honest sign-in/sign-out. De-mocks `ident.bal`/`.name`/`.role`/`.funding`
>   across Card, Run, Studio, Tee, Trace, Status, Dashboard, shell.
>
> **Also landed 2026-07-03: #5–8.** App typecheck + build still green.
> - **#5 Model import + license** — new `api.importModel` (`POST /v1/models/import`) wired as an
>   "import by URL" panel on `Shelf.tsx` (Civitai/HF/direct, genus select); result prepends to the
>   shelf. `api.setModelLicense` (`PUT /v1/models/:id/license`, admin-only) wired as an admin-gated
>   "reclassify license" control on each card (admin detected via `getMe().admin`).
> - **#6 Sponsorships** — net-new `src/screens/Sponsorships.tsx` (`/sponsorships`): create pledge
>   (beneficiary/grant/cadence/caps), list, pause/resume over `/v1/sponsorships`. New client methods
>   `listSponsorships`/`createSponsorship`/`pauseSponsorship`/`resumeSponsorship`. Identified-only.
> - **#7 Teams** — net-new `src/screens/Teams.tsx` (`/teams`): create, list, add/remove members over
>   `/v1/teams`. New client methods `listTeams`/`getTeam`/`createTeam`/`addTeamMember`/`removeTeamMember`.
> - **#8 Affinity** — `Card.tsx` now loads saved per-flow defaults via `getAffines` (overlaid on the
>   schema defaults) and has a "save defaults" control calling `setAffines`. The two dead methods now
>   have callers.
> - Both new screens linked from the Account dropdown; routes added in `App.tsx`. Icons added:
>   `download`, `users`, `hand-coins`, `pause`, `play`, `user-plus`.
>
> **All of Tier B (#1–8) is now wired.** Tier C (endpoints that don't exist yet) is next.
>
> **Staging verification status (2026-07-06):**
> - **Anon-reachable paths VERIFIED live** against `staging.noema.art` (contract + browser via the
>   dev-server proxy): #2 Funding (live pack credits 10,385/41,538/166,152 + real CreditVault address +
>   live ETH→points quote), #3 Shelf (real empty state + import panel), #1 Run (empty state, real
>   balance; stream endpoint wired + owner-scoped 404), #4 identity (real `0 cr`/`anonymous` from
>   session+me/status), #8 Card (`save defaults`→setAffines round-trip), #5 import panel renders,
>   #6/#7 render + 403-gate correctly for anon.
> - **Authenticated close-out DEFERRED to the coordinated staging push.** Staging currently runs the
>   OLD email-verify auth (`register → verification_sent`), so a session can't be minted headlessly.
>   Once the pending threads land and the tree (incl. the username+password auth) deploys, run
>   `scratchpad/verify-authed.sh` (registers 2 throwaway accounts → exercises #4 me, #7 teams CRUD,
>   #6 sponsorships create/list/pause/resume, #5 real HF-LoRA import). **#1 full FLUX run** (owner's
>   call) needs a FUNDED test account — the script quotes + prints the dispatch+stream commands, and
>   auto-runs them when the account has balance.

| # | Screen / gap | Backend (exists) | Current state | Notes for the wirer |
|---|---|---|---|---|
| 1 | **`src/screens/Run.tsx`** | `GET /v1/runs/:id/stream` (SSE) + `GET /v1/runs/:id` | `setTimeout`-simulated fake progress (`INITIAL_STEPS`, `Run.tsx:20,38`) | ⭐ Core loop. **Client method `api.streamRun()` already exists (`api.ts:122`) with ZERO callers** — mirror how `Card.tsx` consumes runs. Verify against staging with a real gen. |
| 2 | **`src/screens/Funding.tsx`** | `GET /v1/deposit/config`, `POST /v1/deposit/quote` | hardcoded `PACKS` array (`Funding.tsx:8`), no checkout | ⭐ Deposits-at-launch. Backend done (see the buy-credits work); add `getDepositConfig`/`depositQuote` client methods (none exist yet) then wire the screen. |
| 3 | **`src/screens/Shelf.tsx`** | `GET /v1/me/models` | `MODELS` mock + hardcoded royalties (`Shelf.tsx:4,31`) | ⭐ Real model shelf. Endpoint exists; no client method yet — add one. |
| 4 | **Identity foundation** | `GET /v1/me` + session (both already wired elsewhere) | `state/identity.tsx:2,19` seeds every identity from `IDENTS` mock → **Keyring + every `useIdentity()` consumer (Card, Run, Studio, Trace, Tee…) is transitively mock** | ⭐ Load-bearing — replacing the mock seed with real `/v1/me`/session de-mocks many screens at once. |
| 5 | Model **license** + **import** UI | `PUT /v1/models/:id/license`, `POST /v1/models/import` | no client method, no screen | Rails live; net-new client + UI. |
| 6 | **Sponsorships** UI | `POST/GET /v1/sponsorships`, `:id/pause`, `:id/resume` | no client method, no screen | Net-new screen. |
| 7 | **Teams** UI | full `/v1/teams` CRUD (`teams`, `:id`, members add/remove) | no client method, no screen | Net-new screen. |
| 8 | Model **affinity** in Card/Preferences | `GET/PUT /v1/me/affines/:modusId` | not surfaced | **Client methods `getAffines`/`setAffines` exist (`api.ts:230,232`) with ZERO callers** — just wire them. |

**Dead client methods that have live endpoints** (wire opportunities, or delete if unwanted):
`streamRun` (→ item 1), `pauseCollection`, `resumeCollection`, `retract`, `getAffines`/`setAffines`
(→ item 8). `listDatasets`/`trainingCost` are dead AND their endpoints don't exist (Tier C).

## C. Mock screens that need BACKEND FIRST (endpoint doesn't exist yet)

| Screen(s) | Blocker |
|---|---|
| `Datasets`, `Dataset`, `CaptionJob`, `Derive`, `TrainRun` | Training **management** surface unbuilt — no `/v1/data/*`. (Training *execution* runs via `MODUS_AITOOLKIT_TRAINING` → `/v1/runs`, but list/cost/status management is absent.) |
| `Projects`, `ProjectHub`, `Preferences` "land-in-project" | No **Projects** entity/endpoint at all. `state/project.tsx:8` is pure mock. |
| `Canvas.tsx` | Compositus/**spells** has no HTTP route and no real screen (spells are modus-only today). |
| `Chat.tsx` | No chat-run / **Concierge** endpoint; routing/egress meter is fake (`Chat.tsx:46`). |
| `Tee.tsx` (beyond static explainer), `Studio.tsx` | No TEE run/session or studio-meter route surfaced to the app. NB: the studio rail IS backend-real (ADR-0006 Conductor) — confirm whether a route exists before classifying as net-new. |
| `Vault.tsx`, `Trace.tsx` | web3/arcanum seed-phrase + provenance — belong to the micro-web3 layer / `vestigia`, not `/v1` app routes. |

Static-by-design (not mock, leave alone): `Landing`, `Doc`, `SiteFooter`, `Map`, `Stub`.

## Recommended order

Do **Tier B #1–4 first** — they are pure frontend wires against endpoints (and in two cases,
client methods) that already exist and shipped in the staging image. Highest leverage:

1. `Run.tsx` → `streamRun` SSE (core-loop realism; client method already written).
2. `Funding.tsx` → deposit config/quote (revenue; backend done).
3. `Shelf.tsx` → `/v1/me/models` (real model shelf).
4. Real identity behind `useIdentity()` (removes the most mock in one move).

Then Tier B #5–8 (net-new client+UI over live endpoints), then decide which Tier C backend to build.

## Gotchas carried over from the nuke session

- **Verify from the git tree, not the working tree.** Local `tsc`/`test`/`docker build` read the
  working-tree disk and `COPY . .`, so untracked source files pass locally but fail CI. Use a clean
  worktree: `git worktree add --detach /tmp/wt HEAD && ln -s <repo>/node_modules /tmp/wt/ && (cd /tmp/wt && npx tsc --noEmit)`.
- **Regenerate API docs after any route/contract change:** `npm run gen:api-docs` (else the
  `apiDocsDrift` hermetic test fails).
- **Staging deploy:** push to the `staging` branch triggers the image build (`staging.yml`); the
  droplet-side container swap is a **separate** step (`./deploy-staging.sh`) — check for in-flight
  pod runs before restarting.
- Green gates: `npm run typecheck`, `npm run test:hermetic` (no DB), `npm run test:crystal` (needs
  Mongo; CI provides an ephemeral one — locally, run against a throwaway `mongo:7`, never `.env`'s
  prod Atlas).

## Source data

Full route surface and per-screen caller/mock breakdown were produced by two Explore sweeps on
2026-07-03; this doc is the cross-referenced synthesis. Re-run the sweeps if the app has moved on.
