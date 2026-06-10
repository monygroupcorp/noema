# Handoff — `Conductor` (ADR-0006) + API Phase 4c (`/v1/studios`)

> Paste-ready prompt for a fresh session. Picks up the Noema Crystal API epic where this
> session left off. Branch `chainengine-migration`.

---

You're picking up the Noema Crystal API epic on branch `chainengine-migration`
(repo: `/home/rth/projects/main/noema-crystal`). Two linked goals, in order:

1. Implement **ADR-0006** — the `Conductor` studio-lifecycle ring anchor (+ `Census`/
   `Procurator` renames).
2. Then finish **API Phase 4c** on top of it: `POST /v1/studios` + `GET /v1/studios`
   (REST + MCP), wiring `maxImpetus → session budget`.

## Read first (don't skip — these are the source of truth)
- `AGENTS.md`, then `docs/agent-tasks/INDEX.md`.
- `docs/adr/0006-conductor-studio-lifecycle.md` — THE spec for goal 1 (decision + scope).
- `docs/adr/0005-fundamentum-substrate-primitive.md` — the precedent/style to mirror.
- `docs/agent-tasks/EPIC-api-allocutio.md` — the API epic; Phases 1–4b are DONE and
  LIVE-VERIFIED on staging, 4c is PARTIAL (studioId-targeted runs done).
- Your memory file `project_api_allocutio_live.md` (via MEMORY.md) — ops facts + gotchas.

## Current state
- API Phases 1, 1.x, 2, 3, 4a, 4b complete; live-verified on staging (a real anon sd1-5
  run produced an R2 image). 4c partial: `studioId → Inceptio.modoId` already lands.
- Hermetic gate green at 541 (`npm run test:hermetic`), `npm run typecheck` clean.
- One `CrystalApi` facade backs both REST (`apiRouter.ts`) and MCP (`mcp/`), mounted in
  `src/index.ts` at `/v1` and `/v1/mcp`. Contract is `apiContract.ts` → `npm run
  gen:api-docs` → `docs/api/*` (a drift-check test enforces sync).

## The seams already scouted (use these — don't re-investigate)
The studio primitives ALL exist in the ring and are AuctorKey-keyed; `Conductor` just
gives them one named door. Key files:
- `src/crystal/SecurePodClient.ts` `provisionStudio` — composes `Materia` + `Hospitium`
  (`provisioningContext.hostKey`). `Hospitium.hostKey` IS the `AuctorKey` union
  (`{animaId}|{commitment}`, see `src/types/hospitium.ts`). → becomes/feeds `Procurator`.
- `src/crystal/TesseraCursor.ts` `openModo(budget, auctorKey)` — creates the `Modo`
  (session) + a budget tessera bound to it.
- `src/crystal/StudioBilling.ts` — the billing tick; drain-terminates on exhaustion.
  → rename to `Census`. (Confirm precisely how the budget tessera drives drain so
  `budget = maxImpetus` actually enforces mid-run — that's the watchdog, no new subsystem.)
- `src/crystal/Praefectus.ts` — the warm-pool scheduler. GOOD Latin, leave it. Conductor
  PAIRS with it (Praefectus picks the pod; Conductor leases the studio).
- `src/index.ts` (~413–463) — the current `provisionStudio` hook. BUG to fix via Conductor:
  it calls provisionStudio WITHOUT a `hostKey`, so bot-provisioned studios are host-less.
- `src/execution/ActumInceptor.ts` already threads `Inceptio.modoId` (studioId routing — done).
- `src/allocutio/lexicon/bulletin/BulletinManager.ts` `startStudio` hook + `_startStudio`
  — the Telegram adapter to migrate onto `Conductor`. Keep chatId/render/picker and the
  `pod.parked` group-admin late-binding in the adapter; move the lifecycle out.

## Plan
1. `Conductor` (new, `src/crystal/Conductor.ts`) — ring service `conducere(auctor, {models,
   budget, warmMs?, runtime?}) → studio handle` composing Procurator(Materia+Hospitium,
   hostKey=auctor) + openModo(budget) + bind; plus `find`/`claudere`. Rename
   `StudioBilling→Census`, the pod-client RING ROLE → `Procurator` interface (provider impls
   stay provider-named UNDER it — don't rename RunPod internals). Wire into `src/container.ts`
   + expose on the Ring. ADR-0006 §Scope is the checklist.
2. API 4c: `CrystalApi.provisionStudio(auctor, opts)` over `Conductor`; `POST /v1/studios`
   + `GET /v1/studios` in `apiRouter.ts`; MCP `provision_studio`/`list_studios` in `mcp/`;
   `apiContract.ts` routes + error codes; `npm run gen:api-docs`. Wire
   `maxImpetus → Conductor budget`.

## Gates & discipline (hold these — they're why this epic stayed clean)
- After every change: `npm run typecheck` clean + `npm run test:hermetic` green. Contract
  edits → `npm run gen:api-docs` (the drift-check test will fail otherwise).
- Gate the renames on existing tests staying green (it's a live-path refactor — extract +
  rename, NOT rewrite; the primitives already work).
- Do the facade/ring SEAMS yourself (the judgment); fan the mechanical wiring (routes, MCP
  tools, tests, contract) to Sonnet subagents with precise specs, then re-verify yourself —
  don't trust agent self-reports; run the gate.
- Respect the ring↔allocutio boundary (`src/crystal` must not import `src/allocutio` —
  there's a boundaries test).

## CRITICAL safety/ops (these have bitten before)
- DB: `.env` `MONGO_DB_NAME=noema` is PRODUCTION. Staging uses `noemaplane` on the SAME
  Atlas cluster. NEVER target `noema`. Any seed/test script must HARDCODE `noemaplane`
  (see `scripts/seed-test-commitment.mjs`).
- Deploy: staging builds ONLY on push to the `staging` branch (`.github/workflows/
  staging.yml`); fast-forward `staging` to your tip, push, wait ~3min for the ghcr image,
  then the user redeploys (it does not auto-pull). Push code to `chainengine-migration` too.
- Anon API auth on bodyless requests (`GET /v1/runs/:id`, the SSE stream) uses the
  `x-commitment` header (commitment-in-body wins on POST).
- Commits: no Co-Authored-By lines; default `fix:` over `feat:`; commit/push only when asked.

## Verify on staging when ready
Use `scripts/seed-test-commitment.mjs` to fund an arcanum commitment in `noemaplane`, then:
discover → `POST /v1/studios` (provision a real pod) → `POST /v1/runs {studioId}` targeting
it → observe via SSE → confirm the studio shows in `GET /v1/me/status` and `GET /v1/studios`,
and that `maxImpetus` as budget drain-terminates. Base URL: `https://staging.noema.art`.

**Definition of done:** ADR-0006 implemented (Conductor anchor + Census/Procurator renames,
both adapters on Conductor, host-less bug fixed); `POST/GET /v1/studios` live on REST+MCP;
`maxImpetus→budget` wired; hermetic + typecheck green; contract/docs regenerated; staging
smoke-tested end-to-end.
