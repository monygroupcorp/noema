# EPIC: Crystal Agent API — MCP + REST over the crystal, at capability parity

- **Status:** **Phases 1–4 COMPLETE** — live-verified on staging (`chainengine-migration`/`staging`, 2026-06-10). Hermetic-green.
- **Owner:** none

## Implementation status

- **Phase 1 — DONE** (commits `7bd8ea59`→`35ddbcaf`): `dispatchInceptio` (extracted from `ExecuteFlow`,
  shared so bot+API can't drift); `aditusToJsonSchema`/`describeFlow`; `Run` projection (`toRun`); the
  `CrystalApi` facade (`invokeFlow`/`getRun`/`listFlows`/`describeFlow`, verb-resolve via `Consuetudinum`
  + shared `CANON_VERBS`); `IdentityResolver` (Credentials→`AuctorKey`, injectable acceptors, `ApiError`
  taxonomy); the `/v1` REST router (runs + flows, error envelope), **mounted live** in `src/index.ts`; the
  contract-first doc pipeline (`apiContract`→`gen:api-docs`→`docs/api/openapi.json`+`reference.md`) with a
  hermetic **drift-check** + `.claude/skills/crystal-api/SKILL.md`. All hermetic-tested.
  - **Phase-1.x — DONE** (commit `afb714c2`): `GET /v1/openapi.json` serves the live spec; the mounted
    `IdentityResolver` now resolves **JWT** (`JWT_SECRET`→`'web'` persona), **API-key** (`ms2_` → read-only
    users lookup + sha256 → `'api'` persona), and anon `{commitment}` — each via persona find-or-create
    (`makeCredentialAcceptors`). Verification is defensive (failures → `auth.invalid`). **Remaining:** `web3`
    (needs a nonce-challenge endpoint). Real auth is staging-validated (the persona-mapping is hermetic-tested).
- **Phase 2 — DONE** (commit `a4bc5ff6`): `busToRunEvent` (pure: `actum.stage/complete/fail`→`RunEvent`) +
  `RunEventHub` (per-run SSE fan-out, fire-and-forget completion webhooks, a bounded ring buffer for
  reconnect replay). `GET /v1/runs/:id/stream` (SSE) + `options.webhookUrl` on `POST /runs` + poll
  (`GET /v1/runs/:id`). Hub wired over the real `bus` + a `fetch` poster (in-process, single instance).
  Contract/docs updated for the new routes; hermetic-tested (incl. real-HTTP SSE).
- **Phase 3 — DONE** (commit `c38c3136`): MCP adapter over the same `CrystalApi`. A small verb tool-set
  (`run_flow`/`get_run`/`list_flows`/`describe_flow`, zod inputSchemas) — NOT a tool per flow; the catalog
  is `crystal://flows[/{id}]` resources. Stateless per-request streamable-HTTP transport, mounted `/v1/mcp`,
  optional auth (public tools work; run_flow/get_run enforce). `@modelcontextprotocol/sdk` v1.25.3.
  Hermetic-tested incl. a real in-memory client↔server protocol test. SKILL updated for MCP + SSE/webhook.
- **Phase 4a — DONE** (commit `9b15a452`): remaining discovery + quote/cap. `quote` (`POST /v1/runs/quote`
  + MCP `quote`) via the cursor's side-effect-free upper-bound reservation; `maxImpetus` admission cap on
  invoke (`economy.cap_too_low`); `listFundamenta` (`GET /v1/fundamenta` + `crystal://fundamenta`) and the
  filterable `listModels` (`GET /v1/models` + `crystal://models` + MCP `list_models`) over the real
  `IntelligentiumStore`. Exposed `ring.fundamentorum`. Contract/docs/drift updated. Hermetic-tested.
- **Phase 4b — DONE** (commit `43b480e8`): the account ops. `saveFlow` (`POST /v1/flows` + MCP `save_flow`)
  — derive an owner-keyed Modus from an owned run or a base flow via `deriveSavedModus` (collision →
  `conflict.slug_taken`); `bind` (`PUT /v1/me/bindings/:verb` + MCP `bind`) via the owner-keyed `Consuetudinum`;
  `status` (`GET /v1/me/status` + MCP `status`) via `aggregateStatus`, JSON-projected. Added ring deps
  `hospitia` + `materiae`. Contract/docs/drift updated. Hermetic-tested.
- **Phase 4c — DONE + live-verified** (ADR-0006 `Conductor`; commits `84a1fc5e`→`577339b1`):
  - **`studioId`-targeted runs** — `invokeFlow`/`run_flow` take a `studioId` → `Inceptio.modoId` (hermetic-tested).
  - **Studio provisioning** — `POST/GET /v1/studios` (REST + MCP `provision_studio`/`list_studios`) over the
    new `Conductor` ring anchor (provisions `Materia` + binds `Hospitium` keyed by the host + opens a budgeted
    `Modo`). Renames landed: `StudioBilling → Census`, pod-client role → `Procurator`. `studioId` is the Modo id,
    consistent across `/v1/studios` and `/v1/me/status`.
  - **`maxImpetus` watchdog — now a HARD cap.** The budget tessera was issued but never enforced; added
    `Signorum.sessionBudget(modoId)` + a `Census` budget-drain check + `reapIdle` reaping `drainOnly` pods, so a
    budget-exhausted studio drains and is reaped within ~90s (live-verified: spend capped at one Census tick).
  - **Billing fix (found in passing).** `Materia.impetusPerSecond` was config-`?? 0n` (never set) → studios
    billed nothing; added `Materia.costPerHr` + per-window `impetusForPodMs` so `Census` bills from real cost
    (~3% rounding vs the old +76% per-second skew).

## Context / why

The platform should be drivable by **agents** over an API — capability parity with the Telegram bot, but
**API-first and agent-idiomatic**, NOT a port of the bot's UI. The consumer is agents (LLM tool-use) and
general/web callers; the API is how they reach the crystal.

**The shaping insight:** the Telegram surface sprawls largely because of its *medium* — inline keyboards +
a chat interface force multi-step wizards, morphing button rows, force-reply sequences, and pagination. The
API has none of those constraints, so it should be **deliberately smaller and more direct**: the sprawl is
medium-induced, not inherent. One clean operation replaces a whole stateful surface.

This is **capability parity, not presentation parity.** An agent can do everything a Telegram user can —
generate, run any flow, manage models/studios, save flows — through declarative, typed, intent-complete
operations. We do NOT mirror the bot's interaction model (tap-an-affordance, morph-a-row, reply-to-prompt).

## The shape: one crystal facade, two protocols

A single **agent-shaped facade** over the execution rail + stores, in crystal vocabulary. It has two halves:
*discovery* (so the agent learns what's choosable) and *action*.
- **Discovery:** `listFlows()` / `describeFlow(id) → tool schema`, `listFundamenta()`,
  `listModels(filter)` (the one filterable catalog — see below; subsumes the old `resolveLora`),
  `listImages()` / runtimes. These feed the agent the valid values.
- **Action:** `invokeFlow(auctor, modusId|verb, aditus, opts) → Run`, `getRun(id)`, `cancelRun`, `quote`,
  `provisionStudio(auctor, {fundamentumId, models?, warm?})`,
  `saveFlow(auctor, {fromRun|fromConfig, name, affixes, promptMode, pinnedModels?})`, `rerun`, `rate`, `bind`,
  `status`.

These are the facade *methods*; the REST routes and MCP tool names are the **same ops under different wire
names** — e.g. `invokeFlow` ↔ `POST /v1/runs` ↔ the `run_flow` MCP tool — because both adapters call this one facade.

Both protocol adapters call this one facade:

- **MCP adapter** — a small **verb tool-set** + the catalog as **resources** (NOT a tool per flow — see *MCP
  layout* below). The emerging agent standard; supersedes the legacy MCP/tools surface in `src/api/` with a
  crystal-native one.
- **REST adapter** — resources (`/v1/runs`, `/v1/flows`, `/v1/models`, `/v1/studios`, `/v1/me/...`) with
  self-describing JSON-Schema'd inputs. Any HTTP/agent client works.

**Flows are tools.** A `Modus`/`Essentia` already carries a typed input schema (`aditus` = `Porta` map:
type/required/default/label/description) and output (`exitus`). A pure `aditusToJsonSchema(modus.aditus)`
derives the MCP tool `inputSchema` AND the REST validation/OpenAPI — one function, both protocols. The agent
reads the schema and submits **complete** params; no interactive per-`Porta` stepping.

**Discoverable, not blind — surface the choices, not just the operations.** A wizard does two jobs:
*stepping* (drop it) and *enumerating the valid options* at each step (keep it). Collapsing `/arm` into one
`POST /v1/studios` is only usable if the agent can first learn *which* `fundamentumId`s, models, images, and
runtimes exist — otherwise it's calling blind. So every enumerable axis is a **discovery resource** and, where
the domain is bounded, the input schema carries the values inline:
- **Discovery resources / MCP resources:** `GET /v1/fundamenta` (substrates for provisioning),
  `GET /v1/flows` (+ `describeFlow` → aditus schema), `GET /v1/models` & `/v1/loras` (filterable catalog),
  `GET /v1/images` / runtimes-for-image (the Custom-studio axes). These are the API twin of "the wizard shows
  you the choices" — each former wizard *step* becomes a queryable resource feeding the one provision call.
- **Schema enums:** `aditusToJsonSchema` (and the studio/provision input schema) emit JSON-Schema `enum`
  (or `examples` + a link/`$ref` to the discovery resource) wherever the domain is a known bounded set — so an
  agent reading the tool schema sees the allowed values without a second guess. This is the hard requirement:
  no operation may expect an opaque id the agent has no way to enumerate.

## Models discovery (one filterable resource, not a `resolveLora` verb)

The whole categories→list→detail→search→by-trigger picker collapses into **one filterable list**:
`GET /v1/models` (alias `/v1/loras` ≡ `?genus=lora`), filterable on every axis an agent might arrive with:

| Filter | Meaning | Backed by |
|---|---|---|
| `genus` | `lora` \| `checkpoint` \| `vae` \| `clip` \| … | `Intellarum.list(genus)` |
| `fundamentum` *or* `familia` | "what works on this base/studio" — a LoRA's compat key is `familia`; `fundamentum=flux-comfyui` resolves to its familia | `triggerMap(familia)` / familia filter |
| `trigger` | match a trigger word (the old `resolveLora`, now a filter) | `findByTrigger(trigger, familia)` |
| `q` | free text over nomen / slug / trigger / **description** | catalog substring search (+ description) |
| `page`/`limit` | pagination | — |

Each result is the model's card — `{ intellaId, nomen, genus, familia, base, trigger, sizeGb, description,
sourceUri, auctor }` — so the agent can *decide*, not just enumerate.

**Discovery ≠ application** (the skill must teach this): listing a LoRA says it *exists*; using it happens at
invoke time, two ways — (1) **prompt**: drop the discovered `trigger` into `aditus.prompt` and the Compiler's
`loraResolver` auto-resolves it (familia-scoped) — the same path the bot uses; (2) **explicit**:
`pinnedModels: [intellaId]` on the run forces it regardless of prompt. The models endpoint is purely discovery.

## The collapse (Telegram surface → one API op)

| Telegram (medium-constrained) | Agent API |
|---|---|
| `/make` `/run` `/chat` + interactive aditus gather | `POST /v1/runs {modusId\|verb, aditus, pinnedModels?}` / MCP tool call |
| Flow card — `Porta`-by-`Porta` panel | the flow's JSON-Schema input, submitted whole |
| Delivery menu (info/rate/wrench→rerun/tweak/save) | `GET /v1/runs/:id` (+ stats); `POST /v1/runs/:id/rerun`; `POST /v1/runs/:id/rating`; `POST /v1/flows {fromRun}` |
| Save-as force-reply sequence (name→review→toggle→confirm) | `POST /v1/flows {fromRun, name, affixes, promptMode}` — one call |
| `/arm` wizard (preset→detail→image→config→picker→start) | discover the choices: `GET /v1/fundamenta`, `GET /v1/images`/runtimes — then one shot `POST /v1/studios {fundamentumId, models?, warmMs?}` |
| Mod• picker (categories→list→detail→page→search→trigger) | one filterable `GET /v1/models?genus=&fundamentum=&trigger=&q=` (see Models discovery) — browse+filter becomes a query |
| Bulletin HUD (journal/live line/affordances/submenus) | `GET /v1/runs/:id/stream` (SSE) ; `GET /v1/studios/:id` |
| `/status` HUD | `GET /v1/me/status` |
| `/bind` | `PUT /v1/me/bindings/:verb {modusId}` |

The right column is the whole API. If a surface in the left column has no agent-meaningful op, it has no API
analog (e.g. the bulletin's *morphing* — only its *information*, the run's event stream, survives).

## Reuse vs new

- **Reuse as-is:** the execution rail (`ActumInceptor`→`Cursor`→`ActumCompletor`→`Nexus`), `Compiler`
  (affix-weave + LoRA-resolution happen here at compile time, so the agent just supplies `aditus`), and the
  stores (`Modorum`/`Fundamentorum`/`Intellarum`/`Consuetudinum`), `aggregateStatus`.
- **Do NOT reuse:** `FlowRouter` + the `Primitive` stepping (Select/Form/Prompt/Stream) — that's the
  *human-conversational* state machine. The agent path goes straight intent → `Inceptio` → `inceptor.initiate`
  → `Actum`, bypassing it. Nor the Telegram affordance/keyboard/force-reply plumbing.
- **Supersede:** the legacy `src/api/` MCP + tools-registry (old tools/spells vocabulary) — the crystal agent
  API is its go-forward, crystal-native replacement. Legacy auth primitives (`jwt.verify`, `/validate-key`,
  `/web3/verify`) are reused only as credential acceptors feeding the resolver.
- **Net-new:** the facade, the MCP adapter, the REST adapter, `aditusToJsonSchema`, `IdentityResolver`,
  `BulletinBusProjector` (neutral run-event projection), the SSE endpoint, the contract-first route/tool
  schemas + the `gen:api-docs` generator + the CI drift-check + the SKILL.md.

## Invocation & run contract

**Uniform run-handle.** `POST /v1/runs { modusId|verb, aditus, studioId?, options? }` ALWAYS returns a Run (a
projection of the `Actum`): `{ id, status: pending|running|complete|failed, exitus?, failure?, cost?, modusId,
createdAt }`. Sync flows are simply born `complete` (exitus inline); everything else is born `pending`. **One
contract — sync is degenerate async.** This is the *low-regret* choice: it's the superset, so adding a `?wait`
long-poll or a per-flow sync shortcut later is purely additive, whereas a "block-for-fast" hybrid would have to
be broken to unify. Decided by the workload: ~2 of 24 runs finish under 5 min, and flows that run **hours to
days** are an explicit offering — you cannot hold a connection open for that, so the handle is mandatory.

**Three observation channels, caller's choice** (a day-long run won't sit on a socket):
- **poll** — `GET /v1/runs/:id`. Always available; the floor.
- **SSE** — `GET /v1/runs/:id/stream`. Live progress while watching (minutes-scale), projected from the same
  bus the bulletin uses (`actum.stage/complete/fail`, `pod.*`) via a neutral `BulletinBusProjector`. Reconnect
  replays from durable `Actum` stage history.
- **webhook** — `options.webhookUrl`. Fire-and-forget completion POST; **essential for the hours/days flows.**

A `?wait=<ms>` long-poll (capped) is optional sugar for the warm-pod fast case. MCP: the invoke tool returns the
handle; a `getRun` tool + a run resource observe it; progress notifications where the client supports them.
`Idempotency-Key` dedupes retried invokes. **SSE is the live spine; WebSocket is an optional later upgrade.**

## Error taxonomy

**Two planes, two code-spaces** (different recovery — never conflate):
- **Request errors** — the *call* was bad/unauthorized/un-admittable → HTTP `4xx/5xx` +
  `{ error: { code, message, retryable?, retryAfter?, details? } }`.
- **Run failures** — the call *succeeded*, a run was created, then it *failed during execution* → HTTP `200` +
  `status:"failed", failure:{ code, message, retryable?, details? }`.

Discipline: validate everything cheap at **admission** (modus exists, `aditus` matches schema, fundament/models
resolve, signa sufficient) → those are *request* errors with fast feedback; the run-failure space is reserved
for what can only fail at execution (pod crash, OOM, watchdog, the gen itself). Every error carries a **stable
string `code`** (agents branch on it, never prose/status) and a **`retryable`** flag (+ `retryAfter`).

**Request errors** (`category.specific`): `auth.{missing,invalid,forbidden}` (401/403); `input.{malformed,
invalid_aditus,invalid_option}` (400/422); `not_found.{flow,fundamentum,model,run,studio}` (404);
`economy.insufficient_signa` (**402** — `details.required/available`), `economy.cap_too_low` (422);
`capacity.{no_pods,economy_unavailable}` (503, **retryable** + `retryAfter`), `capacity.studio_unavailable` (409);
`conflict.{run_terminal,idempotency_mismatch}` (409); `rate.limited` (429, **retryable**);
`internal.{error,unavailable}` (500/503, retryable).

**Run failures** (`200` + `status:failed`): `run.pod_failed` (retry, fresh pod), `run.timeout` (retry/raise
limit), `run.cap_exceeded` (retry with higher `maxImpetus` — the watchdog killed it at the cap), `run.oom`
(no — bigger `gpuClass`/smaller model), `run.execution_error` (inspect `details`), `run.cancelled`, `run.expired`
(retry — reaper recovered it).

**Stability:** codes are **append-only, never repurposed** — part of the API contract, emitted into the generated
spec + `docs/api/errors.md`, so the drift-check guards them like everything else. **MCP mapping:** a request error
= the tool call errors (`isError` + structured `code`); a run failure = the tool call **succeeds** (returns a run
handle) and the run later reports `failed` — same two-plane split, so an agent never confuses a bad call with a
failed gen.

## Execution strategy & modes (the platform's modes of use)

Single-run execution is one mode; the platform deliberately encourages several, and they already exist as
crystal knobs (`GpuClass`, `computeStrategy`, `Materia.podPolicy` = private|economy|link, warm TTL, `Hospitium`,
`drainOnly`). The slow cold-start is *why* hosting matters — an agent that runs often provisions a warm studio
once and amortizes the cold start across many fast runs. **Two execution targets:**

- **Ephemeral** — `POST /v1/runs { modusId, aditus, options? }`. The platform sources a pod (cold-start or
  warm-match), runs, releases per options. The one-shot.
- **Hosted** — `POST /v1/studios { fundamentumId, warmMs, gpuClass?, podPolicy? }` → a persistent warm `Materia`;
  then `POST /v1/runs { …, studioId }` targets it (fast, warm). Agent extends/keeps it alive, drains/destroys when
  done. The "ready for action all day" mode.

**`options`** (all optional) IS the per-run strategy, mapped to existing fields: `gpuClass`,
`computeStrategy`/`podPolicy` (economy-piggyback | private | link-shared), `warmMs` (hold warm after — turns a
one-shot into a mini-host), `maxImpetus`/`maxCostUsd` (cap), `webhookUrl`.

**Cost lives at both levels — quote + cap (the gas estimate + gas limit pattern):**
- `POST /v1/runs/quote { … }` → `{ fixed }` for `impetusFixum`/API flows, or `{ min, max, basis }` for
  duration-based pod gens (can only be a range up front).
- `options.maxImpetus`/`maxCostUsd` is a HARD cap — admission refuses below the minimum-viable reservation, and a
  **mid-run watchdog** kills the pod if accrued impetus would exceed it (reuse the existing reservation + drain/reap).
  Non-negotiable: an autonomous agent in a loop must not be able to drain an account; the balance is too coarse a backstop.
- A studio exposes its burn rate (impetus/sec) + boot cost + a budget that drains when the balance can't cover
  (reuse `drainOnly` + reap).

**Discipline (north-star: build for the full case; the simple case is a config):** `POST /v1/runs { modusId,
aditus }` with nothing else just works — standard GPU, ephemeral, private, default cap. Every strategy knob is
opt-in, so the surface is capable + flexible for power operators and trivial for a casual agent.

## IdentityResolver

One resolver, multiple credential acceptors → crystal `AuctorKey = {animaId} | {commitment}`: web JWT,
`X-API-Key`, web3 signature, arcanum commitment. **Anon (commitment) supported day one** — it flows straight
through `Inceptio.identity`. JWT is just one accepted input (the web platform path), not a separate model.

## Saved flows (agent-authored tools)

`saveFlow` is the agent **authoring its own reusable flows** — a derived `Modus` (`deriveSavedModus`): base flow
+ captured config + a prompt wrapper + pinned models, **owner-keyed** (`AuctorKey`), with a global-unique slug
and a `fonte` link to its parent. One declarative call replaces the bot's name→review→toggle→affix→confirm dance:
`POST /v1/flows { fromRun | fromConfig, name, affixes, promptMode, pinnedModels? }`.
- **`fromRun`** — derive from an existing run (captures its modus + aditus + pinned models).
- **`fromConfig`** — compose from scratch (base `modusId` + `aditus` + affixes), *no run required* — the natural
  agent "author a tool" path.

**Affixes = the flow-baked prompt wrapper** (`Porta.praefixum`/`suffixum`): text the *flow* supplies, woven around
the value the *caller* supplies at compile time — `[prefix, value, suffix].map(trim).filter().join(', ')`, woven
BEFORE LoRA trigger resolution (a trigger word in an affix still resolves). The "style" mechanism, invisible to
the caller. Per-`Porta` in full (`{[porta]:{prefix,suffix}}`); the common case is the prompt (`{prefix,suffix}`).

**Prompt mode:** `open` (prompt stays an input, affixes wrap it → a reusable *tool*) vs `pinned` (captured prompt
baked as the default → a *preset*).

**The payoff — a self-extending toolset:** a saved flow IS a first-class `Modus`, so the instant it's created it's
a discoverable tool — it appears in `listFlows`/`describeFlow` and MCP `tools/list`, its baked config reflected in
its schema (pinned prompt → the prompt `Porta` has a default; affixes hidden, applied at compile). An agent can
mint its own tools. **Guardrail:** saved flows are **owner-scoped by default** (in *that* `AuctorKey`'s catalog,
anon/commitment included) — publishing to the shared catalog is a separate, deliberate act (the `fonte` fork-chain
+ royalties, ADR-0003), so an agent minting tools can't pollute everyone's discovery.

## MCP layout (tools vs resources)

**Don't make every flow a tool.** MCP tool lists load into the LLM's context, so one-tool-per-flow grows
unboundedly AND churns whenever a flow is seeded/saved — degrading tool-selection and burning tokens. Tools are
a **small, stable verb set**; the *catalog* lives in **resources**.

- **Tools (verbs, ≈1:1 with REST, stable):** `run_flow`, `get_run`, `list_flows`, `describe_flow`, `list_models`,
  `list_fundamenta`, `provision_studio`, `save_flow`, `quote`, `cancel_run`, `bind`, `status`. Adding a flow never
  changes this list.
- **Resources (read-only catalog):** `crystal://flows`, `crystal://flows/{slug}` (→ the flow's JSON Schema),
  `crystal://models?genus=&familia=&trigger=&q=`, `crystal://fundamenta`, `crystal://runs/{id}` — resource
  *templates* for the parameterized ones. The "flows are tools" typed guidance survives via `describe_flow`:
  discover→invoke (`run_flow(modusId, aditus)`), not a tool per flow.
- **Ergonomic hybrid (additive, later):** a BOUNDED set of canonical `Essentiae` ALSO as named tools
  (`run.flux-schnell` + full schema) for one-shot; the long tail + saved flows stay resource-discoverable; and
  `notifications/tools/list_changed` scopes *an agent's own saved flows* as session tools (the self-extending
  toolset, without polluting others). Floor = generic `run_flow` + resources; the named subset is a follow-up.

**Naming:** English-legible, matching the REST surface (`/v1/runs`, `/v1/flows` — not `/acta`, `/modi`; an LLM
reasons better about "run a flow" than Latin). `snake_case` tools, `crystal://` resource scheme; crystal
vocabulary lives in the *descriptions*, not wire names. **Unifier:** the MCP tool `inputSchema` ≡ the REST body
schema ≡ `aditusToJsonSchema` output — both adapters call the one facade, so MCP and REST cannot drift.

## Documentation & sync (docs ↔ skill ↔ surface)

**Principle: one source of truth (the surface); generate the rest; a CI drift-check forbids divergence.**
Never hand-maintain parallel copies — drift is prevented mechanically, not by discipline. Two kinds of truth
sync differently:

- **Static contract** (*which* ops/tools exist + their I/O shapes) → lives in **code**: each route/MCP tool
  is **one typed schema** that drives runtime validation AND the OpenAPI doc AND the MCP `tools/list` manifest.
  (`aditusToJsonSchema` is the flow-input case — contract-first everywhere: define once, derive all.)
- **Dynamic catalog** (*which* flows/fundamenta/models exist) → lives in the registries; exposed only via the
  **discovery endpoints**. NEVER baked into docs or the skill (it would stale the instant a flow is seeded) —
  the agent fetches it live.

The pipeline (all generated from the surface):
1. **Contract-first** — one typed schema per route/tool feeds validation + spec; no second copy.
2. **The API serves its own spec** — `GET /v1/openapi.json` + MCP `tools/list` + the discovery endpoints are
   the canonical reference; an agent reads truth at call time, not a doc that may lag.
3. **`npm run gen:api-docs`** emits the committed `openapi.json` + generated `docs/api/reference.md` from the
   schemas.
4. **The skill is *pattern + pointers*, not a catalog dump** (`.claude/skills/<name>/SKILL.md`): it teaches the
   run lifecycle, the discovery-first habit, and ~3 canonical examples, then points at the self-describing
   endpoints for specifics. So it stays **stable** when a flow/endpoint is added — it only changes when the
   *conceptual model* shifts (rare), and is the one human-authored artifact (thin by design).

**Enforcement (load-bearing):** a CI drift-check — `npm run gen:api-docs && git diff --exit-code` —
regenerates the manifest + reference from the surface and fails if the committed copy is stale. Adding an op
without regenerating breaks the build. This is what actually keeps surface↔docs in sync; the skill defers to
the live spec + discovery so catalog/endpoint adds can't stale it.

**Cadence:** *every phase that adds or changes an operation* regenerates (`gen:api-docs`) and updates the skill
only if the conceptual model moved; the drift-check gates the PR. No phase is "done" with a stale spec.

## Phasing (each graduates to a TASK-NNN)

1. **Facade (discovery + invoke) + IdentityResolver + flow-as-tool schema + core run resources (REST) + the
   doc/skill pipeline.** Establish contract-first schemas, `gen:api-docs`, `GET /v1/openapi.json`, the CI
   drift-check, and the first SKILL.md *in this phase* so the sync discipline exists before the surface grows.
   `listFlows`/`describeFlow` + `invokeFlow`/`getRun`, `aditusToJsonSchema` (with `enum`s for bounded fields),
   reusing the rail. Discovery is in from the start — an agent must be able to list flows and read a flow's
   schema before invoking. *Acceptance (hermetic):* mocked ring + in-memory store; `listFlows` enumerates the
   seeds; schema derived from a real `Essentia.aditus`; each credential → invoke returns an actumId; anon
   commitment accepted; **`gen:api-docs` is idempotent (drift-check clean) and the skill renders.**
2. **Observation channels: SSE + webhook + poll.** `BulletinBusProjector` projects the existing bus events into a
   neutral run-event stream (`GET /v1/runs/:id/stream`, reconnect replays from durable `Actum` stage history) +
   `options.webhookUrl` fire-and-forget completion (essential for the hours/days flows) + `GET /v1/runs/:id` poll.
   *Acceptance:* a run's lifecycle is observable on all three; webhook fires once on terminal state.
3. **MCP adapter over the same facade.** A small stable **verb tool-set** (`run_flow`/`get_run`/`list_flows`/
   `describe_flow`/…, inputSchema from `aditusToJsonSchema`) + the **catalog as `crystal://` resources** — NOT a
   tool per flow. Run handle + `get_run` + progress. Crystal-native; supersedes the legacy MCP surface. (Named
   canonical-flow tools + per-agent saved-flow tools via `list_changed` are an additive follow-up.)
4. **Execution strategy + studios + remaining discovery (capability-parity close-out).** The two targets
   (ephemeral run options + hosted `provisionStudio` with `warmMs`/`gpuClass`/`podPolicy`, `studioId`-targeted
   runs) + `POST /v1/runs/quote` + the `maxImpetus` cap & mid-run watchdog; discovery for `listFundamenta`,
   `listImages`/runtimes, and the filterable `listModels` (genus/fundamentum/trigger/q); `saveFlow`, `bind`,
   `status`. *Acceptance:* an agent script
   does the full arc *blind-start* — quote → provision a hosted studio under a cap → discover + describe a flow →
   invoke against the studio → observe (webhook) → rate → save-as — over REST + MCP, never needing an id it
   couldn't enumerate, never exceeding its cap.

## Risks / guardrails

1. **No opaque ids (discoverability).** Every operation that takes an id (`fundamentumId`, `modusId`, a model
   id, an image) MUST have a discovery resource that enumerates it, and bounded fields carry `enum`s in the
   schema. An agent must be able to start blind and learn every choosable value. This is the half of the
   wizard we keep.
2. **Runaway spend (the cap is non-negotiable).** Autonomous agents provision GPUs; a buggy loop must not be able
   to drain an account (the balance is too coarse a backstop). Every run/studio takes a `maxImpetus`/`maxCostUsd`
   cap, enforced at admission AND mid-run (watchdog kills the pod at the ceiling). Quote (`/runs/quote`) is the
   informed-consent layer; the cap is the safety net. Ship the cap with the first studio/provision op, not later.
3. **Don't re-sprawl.** Resist mirroring Telegram surfaces; keep the op set small and declarative. If an op only
   exists to reproduce a chat affordance (a morph, a step, a page turn), drop it. But DO expose the real platform
   *modes* (ephemeral / hosted / economy / shared) — those are capability, not chat-sprawl — behind defaulted options.
4. **One facade, not two** — MCP and REST must call the same facade, or they drift. The facade is the contract.
5. **Tool-list is a context cost** — never one MCP tool per flow (it grows + churns in the LLM's context). Tools
   are a fixed verb set; the catalog is `crystal://` resources. Any named-flow tools are bounded + opt-in.

## Verification boundary

Hermetic where possible — the facade, `aditusToJsonSchema`, and `IdentityResolver` are pure logic over a
mocked ring + in-memory store. The **doc/skill drift-check** (`gen:api-docs && git diff --exit-code`) runs in
the hermetic gate every phase — a stale spec fails the build. Live SSE + real pod provisioning are validated
on **staging** (a GPU), never the hermetic gate — same boundary as the rest of the repo.
