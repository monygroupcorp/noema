# Handoff — Implement ADR-0011 (CAMEL agents into crystal)

**For:** a fresh-context agent implementing the design. **The design is DONE and verified** —
this handoff is about *building* it, not re-deciding it. Read **`docs/adr/0011-camel-agents-into-crystal.md`**
first; it is the source of truth. This doc adds the build order, the verified code anchors, the
live wire contract, and the acceptance tests.

## 0. Ground rules (non-negotiable)

- **Crystal TypeScript only.** Do NOT revive/patch/import any legacy `.js`. Read JS for behavior,
  re-express on crystal primitives. (`feedback_crystal_first_buildout`.)
- **Every phase ends green:** `npx tsc --noEmit`, `npm run test:crystal`, `npm run test:hermetic`,
  and the docs-drift gate. Concurrency-sensitive work (`reserve`, hardened `settle`) needs a
  **real-Mongo** concurrency test, not only hermetic.
- **Minimize surface** — the design deliberately adds only 4 small types (`Sponsio`,
  `SubsidyPolicy`, `Issuer`, `Legatus`); everything else is field additions + ledger methods.
  If you find yourself adding a 5th noun, stop and reconcile with the ADR.
- **No `Co-Authored-By` in commits** (`feedback_no_coauthor`). Prefer `fix:` over `feat:`.

## 1. What is already decided (do not relitigate)

- Treasury = an ordinary `Anima` (like `PLATFORM_ANIMA_ID`). **No `Fiscus`/`treasuries` type.**
- Ledger gets an atomic **`reserve`** (Tier-1, optimistic select+lock+verify); Tier-2 cached
  cell is **rejected**; a hot pool graduates to the existing `Bursa`.
- Federated JWKS auth is a **universal** acceptor (SSO), not agent-only.
- The only agent-unique surface is **ERC-8004 + x402 monetization** (`Legatus` sidecar).
- Sponsorship (`Sponsio`) is universal and **NOT a camel parity blocker** — camel prod runs
  `subsidyMode:'off'`, grants are manual. Build it, but after parity.
- Discovery cards are **client-hosted** (camelcabal.fun); Noema fetches them, does not serve them.

## 2. Verified code anchors (confirmed present 2026-07-01)

| Concern | File:line | Note |
|---|---|---|
| ledger types + interface | `src/types/significandi.ts` — `SignumForma` :39, `Signorum` :128 (`balance`:134, `sessionBudget`:142, `lock`:150, `release`:155, `settle`:172) | add `reserve` + `transfer` here |
| ledger impls | `src/ledger/MemorySignorum.ts`, `src/crystal/MongoSignorum.ts` | Memory guards settle lock-state+overcharge; **Mongo does NOT** — harden it to parity |
| `AuctorKey` | `src/flow/types.ts:103` (`{animaId}|{commitment}|{bursaToken}`) | reused everywhere |
| auth seam | `CredentialAcceptors` `src/allocutio/api/IdentityResolver.ts:41`; impls `src/allocutio/api/apiAcceptors.ts:47` | add `verifyAgentJwt?(token)` here + a resolve branch |
| auth wiring | `src/allocutio/api/apiRouter.ts` `auth()` helper (`bursaToken` short-circuits BEFORE `IdentityResolver`) | agent token must ride a header the short-circuit ignores |
| economic group | `Animarum` `src/types/anima.ts:152`, `parametri.sharedSigna` :169 | add `subsidia?: SubsidyPolicy` here |
| platform treasury precedent | `src/ledger/hooks/platformSkim.ts:7` (`PLATFORM_ANIMA_ID`) | proves treasury-as-Anima |
| workspace derive | `src/flow/deriveSavedModus.ts`, `src/flow/hashModus.ts` (verify paths) | reproduce the `$NFT_*` step-level bake |
| feed | `GET /v1/feed` `src/allocutio/api/apiRouter.ts:316`; `FeedItem` `src/allocutio/api/types.ts` | add author/agent scoping param |
| appearance | `Appearance` `src/types/consuetudo.ts:48`; `resolveAppearance`/`setAppearance` :101 | add public by-owner projection |
| widget prefix | reserved but unmounted `src/index.ts:887` | mount a `/widget` router |

## 3. The live wire contract to satisfy (verified on prod 2026-06-12)

Sources: `main:docs/camel/agent-auth-client-spec.md` (committed) + the **untracked**
`stationthisdeluxebot:docs/camel/camelcabal-onboarding-handoff.md` and untracked
`scripts/{provision-camelcabal-treasury,dryrun-agent-provision,dev-agent-jwt}.js` (read these).

- **One inbound call:** `POST /api/v1/treasury/camelcabal-1/agents`, `Authorization: Bearer <ES256 JWT>`,
  body `{}`. Idempotent on `agentId`. Returns
  `{ agentAccountId, manifestURI, revokeURI, balance:{amount,currency:'USDC'} }`.
- **Also served (URIs returned above, read by the client browser):**
  `GET /api/v1/agents/:id/manifest`, `POST /api/v1/sessions/:id/revoke` (revokeToken-gated).
- **JWT claims:** `iss=https://camelcabal.fun`, `aud=noema.art`, future `exp`,
  `sub=agent:<chainId>:<adapter>:<agentId>` (4 parts), `owner_at_assertion=0x…40hex`, `agentId`
  (idempotency key), `tokenId`, `scope?`. Verify ES256 via JWKS at
  `https://camelcabal.fun/.well-known/jwks.json`, `kid`-matched, refetch-once on kid-miss.
- **JWKS override is LIVE:** `iss` stays `camelcabal.fun` but fetch JWKS from
  `camelcabal.monygroupcorporation.workers.dev` via `AGENT_JWKS_OVERRIDE` (+ SSRF guard).
- **Seed:** `Issuer{issuerId:'https://camelcabal.fun',name:'CAMEL',jwksUrl,status:'active'}`;
  treasury `camelcabal-1` (issuerDomain `camelcabal.fun`, balance 0, active); starterWorkspaceSlug
  → template workspace `918b546f`; grants MANUAL via admin fund/topup.
- **Skim:** settle to on-chain `CamelAgentAdapter.payoutAddress(tokenId)` (adapter `0x…3F1D42…`,
  registry `0x8004A16…`); split % is Noema's `payoutPolicy`.

## 4. Build order (parity-first; each phase independently testable)

1. **Ledger safety** — `reserve(by,amount,actumId)` + `transfer(from,to,amount)` on `Signorum`
   (+ both impls); harden `MongoSignorum.settle`/`release` to Memory parity. Real-Mongo
   concurrency test proving no overdraw + fail-closed. *No CAMEL yet — pure platform.*
2. **Federated auth** — `Issuer` registry + `verifyAgentJwt` in the acceptor seam + a federated
   `PersonaGenus`; JWKS cache/rotation/SSRF/override. Verify the exact §3 JWT. Hermetic tests.
3. **Onboarding parity** — `Legatus` + provisioning saga (create workspace+Anima+Legatus →
   `reserve`/`transfer` grant LAST with fresh read → compensate on failure; suspended=resumable,
   revoked=terminal; idempotent on `agentId`) at the **baked `/api/v1/...` compat paths**; serve
   manifest + revoke; seed `camelcabal-1` + `918b546f`; admin fund/topup. **Acceptance: §5 probe.
   This phase alone re-lights camelcabal onboarding.**
4. **Monetization (the premise)** — x402 capability endpoints (`x402/agents/{id}/spell/{name}` +
   schemas + facilitator) on the compat surface; owner rev-share settled to `payoutAddress`.
5. **Sponsorship** — `Sponsio` + `SubsidyPolicy` + `Animarum.parametri.subsidia` + subsidy sweep
   worker (generalizes the faucet). User-facing; not camel-blocking.
6. **Presentation** — the `StationThis` SDK (`/widget/sdk.js`, per-agent + gallery mounts) over a
   chrome-less feed shell: feed author/agent scoping + public appearance projection + CSP
   `frame-ancestors` allowlist + pinned-origin postMessage.

## 5. Acceptance tests (the go/no-go checks)

- **Auth-shadow probe:** a syntactically-valid ES256 JWT with a **garbage signature** →
  `401 INVALID_ASSERTION`, **NOT 403**. A 403 means a catch-all auth still shadows the route.
- **Workspace clone invariants** (mirror `dryrun-agent-provision.js`): clone strips `agent-context`
  windows + connections; `CamelMemify` spell cloned private to the agent (tool `gpt-image-edit`);
  NFT slot `w-1__input_second_image` removed from `exposedInputs`; NFT image baked **step-level**
  as `w-1.parameterMappings.input_second_image = {type:'static', value:<camelUrl>}` (spell-level
  is dropped by the executor).
- **Idempotency:** re-POST same `agentId` → same `agentAccountId` (200), no double grant.
- **Ledger:** concurrent debits on one pool never overdraw; failed run releases (charges nothing);
  settle refunds `locked − actual`.

## 6. Decisions locked (2026-07-01) — do not relitigate

- **Compat path: LOCKED — crystal serves the `/api/v1/...` paths as thin compat routes**
  (`/api/v1/treasury/:id/agents`, `/api/v1/agents/:id/manifest`, `/api/v1/sessions/:id/revoke`)
  mapped onto the same handlers as the native `/v1/...` surface. No camel404 redeploy (its
  endpoints are on-chain-referenced). Build the compat router in Phase 3.
- **Agent sidecar name: LOCKED — `Legatus`** (registry `Legati`).

## 7. Parity check gating the JS nuke — DONE, verdict: NOT covered

`modelImportApi.js` (Civitai/HF import-by-URL) is **genuinely absent in crystal** — see ADR §
"Parity check … RESULT: NOT covered". **Owner decision (2026-07-02): KEEP it** — import is a
first-class curation feature, specced in **`docs/spec/model-import.md`** (two-tier: private-usable
immediately + review-gated public catalogue; net-new is glue over `trainingFinalizer` + the
publishing/`ModerationGate` spine). Orthogonal to CAMEL (Phases 1–6 unaffected), but **gates the
legacy-JS teardown** — do not delete `modelImportApi.js`/`loraImportApi.js` until that spec ships.

## 8. Pointers

- **ADR:** `docs/adr/0011-camel-agents-into-crystal.md` (the decisions + consequences).
- **Design handoff (context):** `docs/handoff/2026-07-01-camel-to-crystal-migration.md`.
- **Client repo:** `/home/rth/projects/main/camel404` — `wrangler.toml`, `src/agent-issuer/`,
  `contracts/src/agent/CamelAgentAdapter.sol`, `src/utils/stationThis.js`.
- **Legacy JS (read for behavior, `git show main:<path>`):** `src/api/external/agents/*`,
  `src/core/services/agents/*`, `src/core/services/db/{treasuryDb,agentAccountDb,issuerDb}.js`.
- **Untracked prod notes:** `stationthisdeluxebot:docs/camel/camelcabal-onboarding-handoff.md` +
  `scripts/{provision-camelcabal-treasury,dryrun-agent-provision,dev-agent-jwt}.js`.
- **Memory:** `project_camel_crystal_migration_adr`, `project_camel_agent_runtime`,
  `project_external_api_auth_spec`, `feedback_crystal_first_buildout`, `feedback_noema_is_production_db`.
