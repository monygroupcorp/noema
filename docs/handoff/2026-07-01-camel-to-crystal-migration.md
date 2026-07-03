# Handoff — Migrate the CAMEL agent system into crystal (before the JS nuke)

**For:** a fresh-context agent. **Status of the codebase:** the TypeScript "crystal" rewrite is
nearly at parity and we are about to **delete the entire legacy JavaScript side** (`src/api/**/*.js`,
`src/core/services/**/*.js`, the legacy bot/workers). The dead JS is actively misleading gap analysis
(it keeps producing false "backend exists" positives), so it must go. **But one feature has no crystal
parity and must be re-expressed in crystal FIRST, or the nuke loses it: the CAMEL agent system.**

**Your task:** investigate the CAMEL system as it exists on `main`, and produce a **migration design
(ADR + phased plan)** for integrating it into crystal **in an improved way** — re-expressed on crystal
primitives, not ported line-by-line. Design first; confirm scope with the user before implementing.

**Hard rules:**
- **Work purely in crystal TypeScript.** Do NOT revive, patch, or import any `.js`. Read the JS only to
  understand behavior, then re-express it on crystal primitives.
- **Crystal-first** (`feedback_crystal_first_buildout`): reduce each CAMEL concept to its crystal core,
  reuse existing unions (`AuctorKey = {animaId}|{commitment}|{bursaToken}`) before adding nouns/fields,
  minimize surface area. "Improved" means *fewer, cleaner primitives*, not a faithful copy.
- This precedes the JS teardown. Nothing gets deleted until CAMEL (and any confirmed compute/API parity,
  see §7) lives in crystal.

---

## 0. Branch reality — read this first

**CAMEL is 100% on the `main` branch. There is ZERO CAMEL code on the current `chainengine-migration`
branch.** Every path below is on `main` — read it with `git show main:<path>` (do not expect these files
in your working tree). The `feat/camel-onboarding-workspacefactory` branch is an OLDER snapshot; `main`
supersedes it (it has the go-live hardening: JWKS override, provisioned-agent resolution, cast tagging,
donate, delegation). **Migrate from `main`, not the feat branch.**

**Spec of record (the runtime contract):** `main:docs/camel/agent-auth-client-spec.md` — read this in full.
§6 treasury model, §7 x402 capability layer, §9.3 ZK/anonymous agents, §10.2 required endpoints, §4.3
EIP-712 spending cap. Old plans (context, not authoritative): `main:docs/plans/2026-05-18-camel-agent-runtime-implementation.md`,
`main:docs/plans/2026-05-18-agent-runtime-hardening.md`.

## 1. What CAMEL is (the product)

CAMEL NFT holders register their token for a **soulbound ERC-8004 agent identity**. Noema is the
**runtime**: it hosts the agent's compute, holds a **treasury** that grants the agent **credits**, and
lets the agent run generations (paying from those credits) and earn revenue (x402). One treasury (e.g.
`camelcabal.fun` / `camel-1`) funds many agents; each agent is tied to its NFT owner's wallet.

The lifecycle: **CAMEL issuer signs a JWT asserting the agent + owner → Noema verifies it (JWKS) →
find-or-create a Noema account for the owner wallet → clone a starter workspace for the agent →
atomically grant it starter credits from the treasury → the agent runs generations / earns via x402 →
a faucet periodically tops it up from the treasury.**

## 2. THE critical structural problem — two parallel stacks

CAMEL exists as **two overlapping implementations that do not share a data model.** A migration must
collapse them into **one crystal source of truth** — this is the single most important design decision.

**Stack A — "internal" (userCore typed-accounts + credit ledger).** Balance is *derived* by summing
credit-ledger deposits.
- `main:src/api/internal/treasury/treasuryApi.js` (`createTreasuryApi`/`createAgentsApi`/`createTemplateWorkspaceApi`)
- `main:src/core/services/agents/AgentAccountService.js`, `main:src/core/services/agents/FaucetService.js`
- Mounted `main:src/api/internal/index.js:204-209` → `/v1/data/treasury`, `/v1/data/agents`, `/v1/data/template-workspace`

**Stack B — "external" (dedicated `treasuries` + `agentAccounts` collections, integer balances).** This is
the ERC-8004 / camelcabal-facing stack and owns the endpoint the product uses.
- Provisioning: `main:src/api/external/agents/agentProvisioningApi.js` (`POST /api/v1/treasury/:treasuryId/agents`, `:51`)
- Session/manifest/revoke: `main:src/api/external/agents/agentSessionApi.js`; delegation `agentDelegationApi.js`; ERC-8004 card `agentCardFederationApi.js`
- JWT: `main:src/core/services/agents/agentJwtVerifier.js`; faucet: `agentFaucetWorker.js`
- DBs: `main:src/core/services/db/{treasuryDb,agentAccountDb,faucetDripsDb,issuerDb}.js`
- Mounted `main:src/api/external/index.js:603-652`

Shared infra: `main:src/core/services/agents/WorkspaceFactory.js`, `{OnChainVerifier,ChallengeService,VerifyService,agentCardFetcher,agentSessionCallback}.js`; admin `main:src/api/internal/admin/{treasuryAdminApi,issuersAdminApi}.js`.

## 3. Data + credit model (Stack B, the canonical one)

- **Treasury** (`main:src/core/services/db/treasuryDb.js:21-34`, coll `treasuries`): `treasuryId`,
  `issuerName`, `issuerDomain`, `balance` (integer points), `faucetPolicy`, `status`, `starterWorkspaceSlug`.
  Atomic debit with an insufficient-funds guard: `debitBalance` uses `{balance:{$gte:points}}` (`:91-98`).
- **FaucetPolicy** (`:12-19`): `starterGrant`, `monthlyMax`, `perCycleBudget`, `subsidyMode`, `refillCadence`.
- **AgentAccount** (`main:src/core/services/db/agentAccountDb.js:19-40`, coll `agentAccounts`): `agentAccountId`
  (`cmw_`+hex), `treasuryId`, `agentId` (ERC-8004), `tokenId`, `ownerAddress`, `agentChainId`, `agentAdapter`,
  `noemaAccountId`, `workspaceSlug`, `scope[]`, `balance` (integer), `payoutPolicy` (`self-fund|withdraw|split`),
  `revokeToken`, `status`, `sessionIssuedAt/ExpiresAt`.
- **Credit flow:** on provisioning, `starterGrant` is atomically debited from the treasury and added to the
  agent's `balance` AND mirror-credited to the owner's Noema economy account (`agentProvisioningApi.js:238-296`).
- **Spend cap:** per-agent `monthlyMax` enforced only in the **faucet worker** (cadence-aligned window), NOT at
  generation time. The JWT carries a `spending_cap` claim (spec §4.3 EIP-712) that is **asserted but never
  runtime-enforced** — a spec-vs-impl gap and an *improvement opportunity* for crystal (see §5).

## 4. How an agent authenticates + runs + pays

- **Provisioning** (`agentProvisioningApi.js:51`, 14 steps): verify the ES256 assertion JWT against
  `treasury.issuerDomain`'s JWKS (`aud:'noema.art'`, `iss:'https://{issuerDomain}'`) → parse
  `sub = agent:<chainId>:<adapter>:<agentId>` → idempotency (replay/409/suspended) → **find-or-create a
  Noema account by wallet** (`/internal/v1/data/auth/find-or-create-by-wallet`) → clone starter workspace →
  create `agentAccounts` row → atomic treasury debit of `starterGrant` → mirror-credit → async session
  callback to the issuer → `202 {agentAccountId, manifestURI, revokeURI, balance}`.
- **Agent identity = the owner's wallet-derived Noema account.** No separate keypair/API-key is minted; the
  agent authenticates later calls as that Noema account (plus the CAMEL JWT for CAMEL-scoped endpoints).
- **Three token types:** issuer/agent **assertion JWT** (ES256/JWKS); **agent-owner session JWT** (HS256, via
  EIP-712 challenge/verify — `ChallengeService`/`VerifyService`/`agentOwnerSession.js`); **`revokeToken`** (bearer
  secret gating revoke). Multi-issuer resolution via a `trusted_issuers` registry (`issuerDb`); dev JWKS
  redirect via `AGENT_JWKS_OVERRIDE` + SSRF guard.
- **Running a generation:** there is **NO dedicated CAMEL generation endpoint.** A funded agent runs through
  the normal x402 / partner-run surface (`main:src/api/external/partner/partnerRunApi.js`): pay-per-run via
  `X-PAYMENT`, a SplitLedger entry per run, owner rev-share (`distributeAgentOwnerReward`), cast tagged with
  `agentAccountId`. **Key insight:** the treasury is debited only at **grant/faucet time**; at **run time the
  agent spends its own mirrored balance.** The mental model "agent spends treasury per generation" is really
  "treasury periodically tops up the agent; agent spends its own balance." Preserve or improve deliberately.
- **Faucet** (`agentFaucetWorker.js:32`): daily, per-treasury cadence gate, recency-scored allocation of
  `perCycleBudget` capped by `monthlyMax`-this-window, atomic per-agent debit, `faucetDrips` audit rows.
- **WorkspaceFactory** (`WorkspaceFactory.js`): clone an admin **template workspace** → substitute `$NFT_*`
  placeholders (image mirrored to R2) → bake typed **spell anchors** (`agent-context` window bindings) into
  target step `parameterMappings` as `{type:'static'}` (MUST be step-level, not spell-level, or the engine
  drops them) → deep-clone every spell private to the agent → git-like template revision sync/merge/propagate.

## 5. Crystal mapping — where each concept lands (the "improved way")

These are the natural correspondences on the current branch. The *improvement* is that crystal already has
enforceable, reservation-based primitives CAMEL fakes with periodic top-ups.

| CAMEL concept | Crystal home | Note / improvement |
|---|---|---|
| credits / balances / grants / earnings | **`Signum` ledger** (`src/types/significandi.ts`, `src/ledger/`, `MongoSignorum.ts`) | Strong fit. `SignumForma` already has `minted` (grants), `mined` (earned), `reward` (splits). Crystal ledger has `lock`/`release`/`settle` — **per-run spend reservation CAMEL lacks**. |
| agent session + spend cap | **`tessera` forma** (`significandi.ts:47` — "bearer capability, session-scoped, budget in valor") | Almost purpose-built for the agent-owner session + `spendingCap`. Improvement: a tessera is an **enforceable** budget, vs CAMEL's asserted-but-unenforced JWT cap. |
| treasury (pooled balance funding sub-identities) | **GENUINE GAP** — no crystal primitive | The one real net-new. Options to weigh: a new `Fiscus`/treasury primitive that issues `minted`/`tessera` signa to agents, vs a parent `Anima` that funds children via the ledger. Decide this. |
| agent identity | **`Anima`/`Persona`**; anon variant **`arcanum` commitment** (`AuctorKey`) | Wallet→Anima. Spec §9.3 ZK agents → the existing commitment/anonymous rail. |
| workspace | **`Modo`** (studio/loadout, `src/types/modo.ts`) + **`Consuetudo`** (defaults) | Template→clone→**revision sync** has no crystal equivalent (`deriveSavedModus.ts`/`hashModus.ts` are nearest). Real gap — decide how much template machinery to keep. |
| spell anchors (typed factory bindings) | **compositus modus** (`CompositusCursor.ts`, `canonVerbs.ts`) | Baked static step bindings fit composition; the NFT-trait→param binding + `exposedInputs` pruning is CAMEL-specific. |
| treasury's agent cohort / group access | **`Sodalitas`** (`src/types/sodalitas.ts`) | Plausible home for a treasury's agents / at-cost group. |

## 6. What a migration MUST preserve (behaviors with no crystal equivalent today)

1. **Treasury custody** — a pooled, atomically-debited balance funding many sub-identities (the `$gte` guard).
2. **Faucet economics** — recency scoring, `perCycleBudget`, cadence-aligned `monthlyMax`, idempotent drips, audit trail.
3. **Multi-issuer agent auth** — ES256 JWKS discovery per `issuerDomain`, `trusted_issuers` registry, key-rotation
   retry, `AGENT_JWKS_OVERRIDE`, SSRF guard, tiered claims, EIP-712 challenge/verify + on-chain ownership
   (`OnChainVerifier` Mode B), `revokeToken`.
4. **NFT onboarding / WorkspaceFactory** — template clone, `$NFT_*` substitution, R2 image mirror, private spell
   cloning, typed spell-anchor bindings, template revision sync.
5. **Session lifecycle contract with the issuer** — manifest/revoke endpoints, async session callback billing
   blocks, ERC-8004 agent-card federation (`/.well-known/agent-card.json`).
6. **Collapsing the two stacks** — decide the single crystal source of truth; do NOT port both.

**Known landmine (do not reintroduce):** on `main` a real CAMEL JWT POST 403s because a catch-all
`authenticateUserOrApiKey` shadows the public CAMEL routes (see `project_external_api_auth_spec`). Crystal's
`/v1` auth (commitment/bursa/anima) is cleaner — design agent auth as a first-class `AuctorKey` acceptor, not a
route bolted behind a catch-all.

## 7. Second parity candidate — non-rented / BYO compute + external API (LOWER priority)

The user flagged crystal as weak on "non-rented compute — API stuff." Finding: **BYO/self-hosted *inference*
compute and an OpenAI-compatible passthrough are absent on BOTH sides** — this is **greenfield, not a JS→crystal
port**, so the nuke risks losing *nothing* here. JS compute is rented/platform-keyed (single `OPENAI_API` env
key, config-driven RunPod/Vast). The crystal foothold to build BYO on is **`Hospitium`/`Materia`** (host-provided
pods with first-class `hostCut` economics — `src/types/hospitium.ts`) plus **`Anima` BYO custody** (the
credentials pattern, for *outputs*, `anima.ts:34-63`). **The one real user-supplied behavior to verify before the
nuke:** model import by URL (`main:src/api/internal/models/modelImportApi.js` — Civitai/HF download) — confirm
crystal's `ModelInstaller.ts`/`HfUploader.ts` cover it. Treat BYO-inference as a *future feature*, not a
migration blocker.

## 8. Your deliverable

A design doc (ADR-style) under `docs/plans/` (or `docs/adr/`) that:
1. **Decides the single crystal source of truth** for treasury + agent + credits (collapse the two stacks).
2. **Decides the treasury primitive** (the one genuine gap) — new primitive vs parent-anima-funds-children.
3. **Decides agent identity** — Anima vs commitment vs a new `AuctorKey` variant; how agent auth becomes a
   first-class crystal acceptor (JWKS multi-issuer verifier as a crystal service).
4. **Maps the run + spend path** onto the crystal ledger (`lock`/`settle`), improving on the top-up model
   (real per-run reservation against a tessera/agent budget).
5. **Scopes WorkspaceFactory** — how much template/spell-clone/revision-sync machinery to keep vs replace with
   `Modo`/compositus + `deriveSavedModus`.
6. Lists the ERC-8004 / session-lifecycle endpoints crystal must expose (manifest/revoke/card/callback).
7. A **phased plan** (ledger + treasury primitive → agent identity + auth → provisioning → workspace →
   session/federation → faucet) with what's hermetically testable at each phase.
8. Confirms the `modelImportApi` parity check (§7) so the JS nuke is safe.

Then, only after user sign-off on the design, implement — crystal-first, hermetically tested, same discipline as
the rest of this branch (typecheck clean, `npm run test:crystal` / `test:hermetic` green, docs-drift gate).

## 9. Pointers
- Memory: `project_camel_agent_runtime`, `project_camel_memify_bug_backlog`, `project_external_api_auth_spec`,
  `project_crystal_master_plan`, `feedback_crystal_first_buildout`, `project_go_live_runway`.
- Crystal ledger to study: `src/types/significandi.ts`, `src/ledger/MemorySignorum.ts`, `src/crystal/MongoSignorum.ts`.
- Crystal identity/session: `src/types/{anima,persona,hospitium,modo,sodalitas,consuetudo}.ts`, `src/allocutio/api/apiAcceptors.ts` (auth acceptors), `src/allocutio/api/apiRouter.ts`.
- All CAMEL source: `git show main:<path>` for every `main:...` cited above.

**Sequencing reminder:** CAMEL → crystal (this handoff) → confirm compute/API parity is greenfield-safe →
**then** the JS teardown → then resume frontend wiring.
