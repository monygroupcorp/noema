# ADR-0011: Re-express the CAMEL agent system on crystal primitives

- **Status:** proposed
- **Date:** 2026-07-01
- **Supersedes runtime of:** `main:docs/camel/agent-auth-client-spec.md` (the legacy JS contract)
- **Handoff:** `docs/handoff/2026-07-01-camel-to-crystal-migration.md`

## Context

The legacy JavaScript "CAMEL" system lets on-chain agents (ERC-8004 identities held by
NFT owners) run Noema generations funded by a pooled treasury, and earn revenue via x402.
It is the one feature with **zero crystal parity**, so it must be re-expressed on crystal
primitives before the legacy JS is deleted.

CAMEL exists on `main` as **two parallel stacks that do not share a data model**:

- **Stack A ("internal")** — typed `userCore` accounts; balance is *derived* by summing
  credit-ledger deposit rows (`AgentAccountService._sumBalance`).
- **Stack B ("external", canonical)** — dedicated `treasuries` + `agentAccounts`
  collections with *stored integer* balances and an atomic `debitBalance` guard
  (`{balance:{$gte:points}}`). Owns the product endpoint
  (`POST /api/v1/treasury/:treasuryId/agents`).

Investigation of both stacks and of the crystal primitives (`Signum` ledger,
`Anima`/`Persona`, `Animarum`, `Modus`, `Consuetudo`, `Editio` feed, the `/v1` auth
acceptors) produced a single load-bearing finding and a chain of crystal-first reductions:

**Load-bearing finding — the treasury is never debited at run time.** Legacy partner/x402
runs are paid in USDC on-chain; the internal ledger only *receives* credits (rewards). The
treasury → agent money movement happens **only at grant + faucet time**. "Agent spends
treasury per generation" is a myth; it is "treasury periodically tops the agent up, the
agent then spends its own balance." Therefore the **entire run/spend path is already
crystal-native**: an agent with an `Anima` balance runs through the normal `/v1` path
(`ActumInceptor.lock` → `ActumCompletor.settle`), and earnings are already emitted by Nexus
hooks as `mined`/`reward` signa. No new run machinery is required.

That collapses the "CAMEL migration" into a small set of decisions, most of which are
*universal platform primitives* that happen to also serve agents, plus one genuinely
agent-specific module.

## Decision

Re-express CAMEL as **four universal primitives** (which benefit ordinary users and are
worth building regardless) plus **one agent-unique monetization module**. We collapse the
two stacks onto the crystal derived-balance model (Stack A's shape), keeping only Stack B's
*atomic-debit discipline* where a hot pool needs it.

### 1. Treasury = an ordinary `Anima`. No new "treasury" / `Fiscus` type.

A pooled, fundable balance is *already* modeled as an Anima — the platform's own treasury
is `PLATFORM_ANIMA_ID`, an ordinary Anima whose balance is `Σ` its valid signa. Stack B's
dedicated `treasuries` collection exists only because the legacy JS lacked a derived-ledger
model; porting it would import a JS limitation. We will **not** add `Fiscus`/`Fiscorum`.
An "org account" / "treasury" is emergent: an Anima that holds sponsorship rules.

### 2. Sponsorship is a universal, user-facing capability — `Sponsio` + `SubsidyPolicy`.

"Keep these accounts topped up" is identical whether a person sponsors a friend, a
collective funds its creators, or a treasury funds agents. This is **not** an agent
privilege and **not** a faucet bolted onto a treasury type. Introduce one small primitive:

- **`Sponsio`** — a standing, directed, capped funding pledge:
  `{ id, sponsor: AuctorKey, beneficiarius: AuctorKey | AnimarumId, subsidia: SubsidyPolicy,
     capTotal?: bigint, status }`. The sponsor is any Anima; the beneficiary is one identity
  or an `Animarum` group.
- **`SubsidyPolicy`** — the generalized faucet:
  `{ grant?, cadence: 'weekly'|'biweekly'|'monthly', perCycleBudget, perMemberCap,
     strategy: 'recency'|'flat'|'weighted' }`. Recency reproduces CAMEL's faucet; flat is
  "everyone gets X/week."
- A **subsidy sweep worker** walks all `Sponsio` records and drips via the ledger
  `transfer` (below), indifferent to whether the sponsor is a person, a collective, or a
  treasury. This replaces `agentFaucetWorker`/`FaucetService` and generalizes them.

`Animarum.parametri.sharedSigna` (today a dead boolean) is the existing hook this completes;
membership reuses `Animarum.animae[]` — no parallel membership store.

### 3. Ledger: add atomic **reservation** (Tier 1) + harden Mongo settle. Reject Tier 2.

The derived ledger has no single "debit-if-sufficient" primitive; the current
check-then-lock in callers is race-prone. We make the base ledger safe against adversarial
concurrency **without** a stored-balance cache:

- **`reserve(by, amount, actumId)`** — select valid signa, lock them with the existing
  guarded per-signum write, re-read which now carry this `actumId`, sum, and if short grab
  more / retry; if uncoverable, release and report insufficient. Overdraw is structurally
  impossible (each signum locks at most once, one winner); every failure **fails closed**
  (deny/slow, never overpay). This is a *correctness* upgrade, not a speed knob, and it
  protects every treasury.
- **Harden `MongoSignorum.settle`/`release`** to match `MemorySignorum`: guard `settle` on
  `status:'locked'`, reject `actualImpetus > totalLocked`, keep `release` a no-op on
  already-spent. This closes the one real caller-facing exploit surface (over-settle /
  double-refund) and removes the two-impl divergence.
- **`transfer(from, to, amount)`** — first-class inter-account move (spend-and-reissue,
  built on `reserve`), replacing the hand-rolled debit/credit pairs (`_billTeeHours`).
- **Tier 2 (O(1) cached balance cell) is rejected.** It reintroduces a second source of
  truth (drift/reconciliation — the exact bug event-sourcing avoids) or Mongo transactions
  (infra + latency + unfaithful in `MemorySignorum`). "Outgrowing" Tier 1 is a *throughput*
  cliff (retry/latency under many concurrent debits on one pool), not a security one, and
  is triggered by metrics. A hot pool that needs O(1) debit **graduates to a `Bursa`** (an
  existing stored-`bigint` cell that *is* its own source of truth, not a cache).

### 4. Federated auth = a universal SSO primitive — `Issuer` + a JWKS acceptor.

Multi-issuer JWKS verification is **federated identity**, not agent auth: any white-label
partner running an IdP can publish a JWKS and have its users land as real Noema accounts.
Only the *claim payload* CAMEL uses is agent-shaped; the verification is universal.

- **`Issuer`** registry — `{ issuerId (==JWT iss), name, jwksUrl, status }` (the
  `trusted_issuers` allow-list).
- A **JWKS acceptor** added to the `CredentialAcceptors` seam (`apiAcceptors.ts`) +
  `IdentityResolver.resolve`, resolving an asserted subject → `{ animaId }` via
  `resolveOrCreateAnima(..., <federated genus>, ...)`. Carries over JWKS cache +
  key-rotation retry, the SSRF guard, and `AGENT_JWKS_OVERRIDE`. Resolves to a `Persona`
  (add a federated `genus`) → `Anima`; **no new identity store**.
- **Constraint:** the `bursaToken` short-circuit runs *before* `IdentityResolver`, so the
  agent/federated token must arrive on a header that short-circuit does not intercept.
- Fixes the known landmine: agent auth is a first-class `AuctorKey` acceptor, not a route
  behind a catch-all (`project_external_api_auth_spec`).

### 5. The agent-unique module — ERC-8004 identity + x402 monetization (`Legatus`).

> **Decision locked (2026-07-01):** the agent sidecar type is named **`Legatus`** (registry
> `Legati`) — an envoy acting with delegated authority, earning for its principal.

Everything above is universal. The genuinely agent-specific surface — the product moat,
**white-label on-chain-payable AI-gen agents with owner rev-share** — is one sidecar record
hung off an otherwise-ordinary Anima, plus its endpoints:

- **`Legatus`** — the on-chain binding + monetization config:
  `{ agentId (ERC-8004, unique), tokenId, ownerAddress, chainId, adapter, animaId (FK),
     issuerId (FK), scope[], payoutPolicy: {mode:'self-fund'|'withdraw'|'split',
     withdrawAddress?}, revokeToken, sessionExpiresAt, status:'active'|'revoked'|'suspended' }`.
  Distinct from a federated *human* login because the identity is an **on-chain,
  transferable, payable asset** (ownership re-verified on-chain via the `OnChainVerifier`
  `ownerOf` modes) and the actor is autonomous (needs revocable, scoped sessions).
- **x402 capability serving is THE premise** (ported onto `/v1`, currently legacy-only):
  `x402/agents/{agentId}/spell/{name}` capability endpoints + JSON schemas + facilitator,
  so *other* on-chain agents can discover-and-run Noema workflows and the owner takes a skim.
  Owner rev-share via `distributeAgentOwnerReward`, settled to the on-chain
  **`adapter.payoutAddress(tokenId)`** (transfer-safe; the client's on-chain skim primitive)
  per Noema's `payoutPolicy` split. This is the product, not polish.
- **Discovery cards are CLIENT-hosted, not ours.** The client serves the ERC-8004 profile at
  its own `…/agents/{tokenId}/card`; Noema only *fetches* that card (best-effort, name/image)
  during provisioning. Do **not** build agent-card `.well-known` federation on Noema for this
  client — our discovery role is to be the x402 *capability execution target* the client card
  points at.
- **Aspirational, NOT shipped (deprioritize):** the EIP-712 challenge/verify owner session
  (→ enforceable `tessera`), the `payout-policy` `PATCH`, and the session callback (the
  client's callback sink is a no-op). Keep in the design as future; the shipped client never
  calls them.
- **Provisioning** becomes a crystal saga preserving Stack B's ordering: create workspace +
  Anima/Legatus first, `reserve`/`transfer` the starter grant *last* with a fresh read,
  compensate (delete workspace, suspend `Legatus`) on failure; `suspended` = resumable,
  `revoked` = terminal; idempotency on unique `agentId`.

> **Amendment (2026-08-07):** a per-agent `GET /api/v1/agents/:agentId/card` route was built
> against `agentCardRouter.ts`, citing this section under the wrong subsection number and
> without a spec of its own. It has been removed — this section's own text above already
> assigns per-agent card hosting to the client, not to Noema. The platform card at
> `GET /.well-known/agent-card.json` is retained; it serves the x402 capability-execution-target
> role this section assigns Noema, and has its own spec at
> `docs/agent_usability/03-erc8004-implementation.md:46-90`.

### 6. Workspace = reuse `Modus`/`deriveSavedModus`/`Consuetudo`. Drop git-style revision sync.

Template clone + `$NFT_*` substitution + typed spell-anchor baking (step-level
`{type:'static'}`) is a thin helper over `deriveSavedModus` (`auctor: AuctorKey`, `fonte`
chain, `contentHash`). Agent defaults/bindings reuse `Consuetudinum` (already AuctorKey-keyed).
The legacy git-like template `getSyncStatus`/`merge`/`propagate` is **replaced** by crystal's
re-derive-and-bump-`versio` model (content-hash + `fonte` already give provenance).

**Fork-once is intentional (owner-confirmed 2026-07-02), not a gap.** An agent gets a private
fork it owns and can modify; it does **not** auto-inherit later master-template revisions. The
git-style cascade merge (rebase agent customizations onto a new template rev) is deliberately NOT
built — it is complex and poorly scoped for the value. If cross-workspace propagation is ever
wanted, the lightweight path is a *transfer-canvas-items* primitive (copy specific steps/bindings
between workspaces on demand), NOT a background merge/propagate worker. Master improvements reach
**newly provisioned** agents only; existing forks keep their frozen copy (`fonte` records lineage).

### 7. Presentation = the `StationThis` widget SDK over a feed+appearance shell.

The client integrates the human-facing surface via a **script-injected SDK**, not a raw
iframe URL: `<script src="https://noema.art/widget/sdk.js">` exposing `window.StationThis`.
**The contract to preserve is that SDK API**, exactly:
- `StationThis.init({ agentId:'camel{tokenId}', container, getProvider, onEvent })` → handle
  with `.walletConnected(address)` / `.destroy()`.
- `StationThis.initGallery({ collectionAddress, container })`.
- The `getProvider`/`onEvent` `postMessage` bridge (wallet/session/payment events).
The iframe the SDK builds is an *implementation detail* under that API. Legacy served three
backend-string-generated HTML docs (hardcoded hex CSS, dark-only, no per-agent theming,
insecure `frame-ancestors *`, `postMessage` to `'*'`); the advertised
`https://noema.art/s/<slug>` workspace URL was a **dead route**. Replace the *inside* of the
SDK with a themed, chrome-less view — **no new data type**, composed from existing primitives:

- **content** — reuse public `GET /v1/feed` (`FeedItem` with inlined media) + `Feed.tsx` +
  `lib/media.ts`; **add an author/agent scoping param** (`listByAuthor` exists on the
  `Editionum` store, just unexposed publicly).
- **theming** — reuse `Consuetudo` `Appearance` (`accent`→`--accent`, `look`); **add a
  public appearance-by-owner projection** (today only self-scoped `/v1/me`). Per-agent
  branding flows from the `$NFT_*` values into the skin.
- **shell** — a **chrome-less embeddable shell** reusing `Feed`'s data path (every screen
  currently assumes full `AppShell`); serve `/widget/sdk.js` + a per-agent widget keyed by
  the `camel{tokenId}` slug + a gallery keyed by collection address (mount the reserved
  `/widget` router).
- **framing** — real CSP `frame-ancestors` **per-partner allowlist** (replacing `ALLOWALL`);
  **pinned-origin** `postMessage` (legacy posted to `'*'`).
- **interact** — the x402 capability endpoints from §5 are the "serve into them" path.

### 8. Client parity constraints (camel404 — the deployed contract).

> **Decision locked (2026-07-01):** crystal serves the legacy `/api/v1/...` paths as **thin
> compat routes** (`/api/v1/treasury/:id/agents`, `/api/v1/agents/:id/manifest`,
> `/api/v1/sessions/:id/revoke`) — the client is deployed and its endpoints are referenced from
> on-chain `agentURI` data, so we do NOT require a camel404 redeploy. New/native callers use
> `/v1/...`; the compat router maps the baked paths onto the same handlers.

The `camel404` client (a separate repo, its `wrangler.toml` +
`src/agent-issuer/`) is **already deployed with Noema URLs and the JWT shape baked in**.
Crystal owns `noema.art` after the JS nuke, so it must honor these *exactly* or we coordinate
a client redeploy:

- **Baked endpoint:** the only server-to-server call is
  `POST https://noema.art/api/v1/treasury/camelcabal-1/agents` (Bearer ES256 JWT, body `{}`),
  idempotent, returning `{ agentAccountId, manifestURI, revokeURI, balance:{amount,currency:'USDC'} }`.
  Crystal must answer this exact path (a `/api/v1/...` compat route, not `/v1/...` — the
  missing `/v1` was "the original mis-wire" per the live handoff). **Verified on prod
  2026-06-12.**
- **Served surfaces the response advertises (client stores in KV, browser reads them):**
  `GET /api/v1/agents/:agentAccountId/manifest` and
  `POST /api/v1/sessions/:agentAccountId/revoke` (revokeToken-gated). These are *not* no-ops —
  crystal must serve them at those exact paths. (The inbound *session callback* to the client
  *is* a no-op sink — that one is safe to skip.)
- **Admin funding is the current grant path (faucet is OFF).** Prod treasury seed:
  `faucetPolicy = { starterGrant:0, monthlyMax:0, perCycleBudget:0, subsidyMode:'off',
  refillCadence:'monthly' }`, `balance:0` — grants are **manual per agent** via
  `/internal/v1/admin/treasury/camelcabal-1/{fund,topup}` and `starterWorkspaceSlug` set via
  `PATCH …/workspace`. So **sponsorship (§2) is confirmed NOT a camel parity blocker** — the
  live product tops up manually; crystal needs an admin fund/topup (an `issue minted` /
  `transfer` to the agent Anima) for parity, and `Sponsio` remains a later universal feature.
- **Baked JWT the JWKS acceptor must verify:** `sub = agent:1:{adapter}:camel{tokenId}` (4
  colon-parts), `iss = https://camelcabal.fun` (== the treasury/`Issuer` `issuerDomain`),
  `aud = noema.art`, `agentId = camel{tokenId}`, `tokenId`, `owner_at_assertion`,
  `scope = ["generate"]`, `exp = iat+600`, `kid = "key-1"`; verified against
  `https://camelcabal.fun/.well-known/jwks.json` (P-256, `max-age=3600`, kid-miss → refetch).
- **Baked widget URLs:** `/widget/sdk.js`, per-agent `/widget/camel{tokenId}`, collection
  gallery. Preserve or redeploy the client.
- **Treasury seed (exact, from `provision-camelcabal-treasury.js`):**
  `Issuer{ issuerId:'https://camelcabal.fun', name:'CAMEL', jwksUrl:'…/.well-known/jwks.json',
  status:'active' }` and treasury `{ treasuryId:'camelcabal-1', issuerName:'camel',
  issuerDomain:'camelcabal.fun', balance:0, status:'active' }`; `starterWorkspaceSlug` PATCHed
  later to template workspace **`918b546f`**.
- **JWKS override is LIVE on prod:** `iss` stays `https://camelcabal.fun` but the JWKS is
  fetched from `camelcabal.monygroupcorporation.workers.dev` via `AGENT_JWKS_OVERRIDE` (apex is
  static hosting). Crystal's acceptor must carry the override until they cut apex DNS to the worker.
- **Workspace clone contract (verified by `dryrun-agent-provision.js`):** clone strips
  `agent-context` windows + their connections, deep-clones the `CamelMemify` spell private to
  the agent (tool `gpt-image-edit`), removes the NFT slot `w-1__input_second_image` from
  `exposedInputs`, and bakes the NFT image as **step-level** `w-1.parameterMappings
  .input_second_image = {type:'static', value:<camelUrl>}` (spell-level mappings are dropped by
  the executor). The `deriveSavedModus` helper (§6) must reproduce exactly this.
- **Skim resolution:** on-chain settlement reads `CamelAgentAdapter.payoutAddress(tokenId)`
  (adapter `0x…3F1D42…`, ERC-8004 registry `0x8004A16…`); the split % is Noema's `payoutPolicy`.
- **Acceptance probe (the auth-shadow test):** a syntactically-valid ES256 JWT with a garbage
  signature must return `401 INVALID_ASSERTION`, **not `403`** — a 403 means the catch-all auth
  shadow is still in front of the route. This is the go/no-go wiring check.

### What we explicitly do NOT do

- Do not add `Fiscus`/`Fiscorum`, a `treasuries` collection, or an integer balance field.
- Do not port both stacks; Stack A's derived model wins, Stack B's atomic discipline is kept
  only via `reserve`/`Bursa`.
- Do not add a Tier-2 cached balance cell.
- Do not add a separate agent identity store — agents are `Anima` + `Persona` + `Legatus`.
- Do not keep git-style workspace revision sync.
- Do not build a bespoke agent-feed or backend-HTML widget.
- Do not build agent-card `.well-known` federation on Noema — the client hosts discovery; we
  only fetch its card and serve the x402 capability target.
- Do not prioritize the aspirational surface (challenge/verify session, payout-policy PATCH,
  session callback) — the shipped client never calls it.
- Do not revive/patch/import any `.js` — read for behavior, re-express in crystal TS.

## Consequences

**Easier.** The migration mostly makes the *platform* better: federated SSO, user-facing
sponsorship, and an atomically-safe ledger are all universal wins. Building
friend-sponsorship for users yields ~80% of the agent treasury for free. The agent-specific
work shrinks to one sidecar type + the x402/ERC-8004 endpoints — the actual differentiated
product. The net-new *type* surface is: `Sponsio`, `SubsidyPolicy`, `Issuer`, `Legatus`
— four small records; everything else is field additions
(`Animarum.parametri.subsidia`, a federated `PersonaGenus`, feed scoping param, public
appearance projection) and ledger methods (`reserve`, `transfer`, hardened `settle`).

**Harder / watch.** `reserve` adds retry cost under high single-pool contention (bounded;
graduate hot pools to `Bursa`). The JWKS acceptor must sidestep the `bursaToken`
short-circuit and needs real key-rotation/SSRF handling. Provisioning-saga compensation and
idempotency must be reproduced faithfully. The `MemorySignorum`/`MongoSignorum` parity must
be enforced by tests (atomicity is trivial in Memory, real only in Mongo).

**Enforcement.** Each phase is hermetically testable and gated by `npm run test:crystal` /
`test:hermetic`, typecheck, and the docs-drift gate. Concurrency correctness of `reserve`
and the hardened `settle` needs a real-Mongo concurrency test, not only hermetic.

**Naming.** Locked: the agent sidecar is **`Legatus`** (registry `Legati`).

### Deferred ledger hardening (tracked debt, non-blocking)

Phase 1 review (2026-07-02) found the two "accepted costs" of the Tier-1 ledger are **incidental,
not inherent** to the no-cache stance, each with a cheap single-source-of-truth-preserving fix:
(1) `reserve`'s O(n) full-load is caused by `valor:bigint` serializing to an unsortable Mongo
string — a `valorNum` sort-mirror gets it to ~O(k) with no cached balance (the token *ratio* is
irrelevant, do not change it); (2) `settle`'s spend+refund is non-atomic (a latent value-loss
window in every run, not just `transfer`) — wrap it in an Atlas transaction (Memory is already
atomic); (3) `transfer` needs an idempotency key + orphan reconciler. None block Phases 2–6. Full
analysis: **`docs/spec/ledger-hardening-debt.md`**.

### Phased plan (parity-first; each phase independently testable)

1. **Ledger safety** — `reserve` (Tier 1) + `transfer` + harden `MongoSignorum.settle`/
   `release` to Memory parity. Real-Mongo concurrency test. (No CAMEL yet; pure platform.)
2. **Federated auth** — `Issuer` registry + JWKS acceptor in the `CredentialAcceptors` seam
   + federated `PersonaGenus`, verifying the *exact* camel404 JWT (§8). Hermetic
   verify/rotation/SSRF tests. User-facing SSO. (Pulled ahead — it's the onboarding gate.)
3. **Onboarding parity** — `Legatus` + the provisioning saga (compensation, idempotency)
   reusing phases 1–2, exposed at the **baked `/api/v1/treasury/:id/agents` compat path**;
   also serve `GET /api/v1/agents/:id/manifest` + `POST /api/v1/sessions/:id/revoke`; seed
   `Issuer` + `camelcabal-1` treasury Anima + template workspace `918b546f`; admin
   fund/topup (manual grant, since the faucet is off in prod). Acceptance = the 401-not-403
   auth-shadow probe. **This phase alone re-lights camel404 onboarding** — the minimal parity
   target.
4. **The premise — monetization** — x402 capability endpoints (`x402/agents/{id}/spell/{name}`
   + schemas + facilitator) on `/v1`, owner rev-share settled to on-chain
   `adapter.payoutAddress`. This is the actual product (other agents run workflows via x402).
5. **Sponsorship** — `Sponsio` + `SubsidyPolicy` + `Animarum.parametri.subsidia` + subsidy
   sweep worker (replaces the faucet). Hermetic drip/cadence/cap/idempotency. User-facing.
6. **Presentation** — the `StationThis` SDK (`/widget/sdk.js`, per-agent + gallery mounts)
   over a chrome-less feed shell: feed author/agent scoping + public appearance projection +
   `/widget` router + CSP `frame-ancestors` allowlist + pinned postMessage.

### Parity check before the JS nuke (handoff §7) — RESULT: NOT covered

**Verdict (2026-07-01): `modelImportApi.js` is genuinely absent in crystal — deleting it is a
feature removal, not a parity pass.** Crystal's catalog is seed-only (`seeds/intellae.ts`) +
trained-on-platform (`trainingFinalizer.ts`); there is **no inbound import-by-URL** anywhere.
`ModelInstaller.ts` installs *pre-registered* intella ids onto pods (no URL/metadata/DB);
`HfUploader.ts` publishes *outward* (opposite direction). `Intellarum` has no `create`/
import-from-URL method.

Legacy surface at risk (`/internal/v1/data/models/{checkpoint,lora}/import`):
- **Checkpoint import** — Civitai-page / direct-`.safetensors` URL → ComfyDeploy volume.
  **Largely vestigial**: writes NO DB record, targets the ComfyDeploy volume crystal has
  deliberately replaced. Low-value to preserve.
- **LoRA import-by-URL** (`loraImportApi.js`) — Civitai/HF metadata scrape (name/base/triggers/
  tags/author/preview), base→checkpoint mapping, `r2.dev` host policy, DB insert
  `createImportedLoRAModel` `status:pending_review`. **This is the real feature** — but its
  actual file deploy is already **commented out** (only metadata + the pending-review row is live).

**Decision (owner, 2026-07-02): KEEP it — import is a first-class curation feature.** Build a
crystal import-by-URL endpoint before deleting the JS. Design is specced separately in
**`docs/spec/model-import.md`** (two-tier: private-usable-immediately via `access:'private'`+
`ownerAnimaId`, public catalogue gated by a user-invoked `Editio` + `ModerationGate`; net-new is
glue only — it mirrors `trainingFinalizer.ts` + reuses the publishing spine). Orthogonal to CAMEL
(does not block Phases 1–6), but **gates the legacy-JS teardown** — do not delete
`modelImportApi.js`/`loraImportApi.js` until that spec ships.
