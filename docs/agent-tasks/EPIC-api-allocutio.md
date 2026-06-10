# EPIC: Crystal Agent API — MCP + REST over the crystal, at capability parity

- **Status:** backlog epic (scoped, not started). Graduates to numbered `TASK-NNN` specs per phase when picked up.
- **Owner:** none

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
- **Discovery:** `listFlows()` / `describeFlow(id) → tool schema`, `listFundamenta()`, `listModels(filter)`,
  `resolveLora(trigger, familia)`, `listImages()` / runtimes. These feed the agent the valid values.
- **Action:** `invokeFlow(auctor, modusId|verb, aditus, opts) → {actumId}`, `getRun(id)`,
  `provisionStudio(auctor, {fundamentumId, models?, warm?})`, `saveFlow(auctor, {fromRun, name, affixes, promptMode})`,
  `rerun`, `rate`, `bind`, `status`.

Both protocol adapters call this one facade:

- **MCP adapter** — flows = MCP tools, catalog = MCP resources. The emerging agent standard; supersedes the
  legacy MCP/tools surface in `src/api/` with a crystal-native one.
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

## The collapse (Telegram surface → one API op)

| Telegram (medium-constrained) | Agent API |
|---|---|
| `/make` `/run` `/chat` + interactive aditus gather | `POST /v1/runs {modusId\|verb, aditus, pinnedModels?}` / MCP tool call |
| Flow card — `Porta`-by-`Porta` panel | the flow's JSON-Schema input, submitted whole |
| Delivery menu (info/rate/wrench→rerun/tweak/save) | `GET /v1/runs/:id` (+ stats); `POST /v1/runs/:id:rerun`; `POST …/rating`; `POST /v1/flows {fromRun}` |
| Save-as force-reply sequence (name→review→toggle→confirm) | `POST /v1/flows {fromRun, name, affixes, promptMode}` — one call |
| `/arm` wizard (preset→detail→image→config→picker→start) | discover the choices: `GET /v1/fundamenta`, `GET /v1/images`/runtimes — then one shot `POST /v1/studios {fundamentumId, models?, warmMs?}` |
| Mod• picker (categories→list→detail→page→search→trigger) | `GET /v1/models?familia=&kind=&q=` ; `GET /v1/loras?trigger=` (the picker *was* browse+filter; here it's a query) |
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

## Async / streaming

A run is an `Actum` resource. REST: `GET /v1/runs/:id` (state) + `GET /v1/runs/:id/stream` (SSE of stage
events → result), projected from the same bus the bulletin uses (`actum.stage/complete/fail`, `pod.*`) via a
neutral `BulletinBusProjector`. MCP: a tool call returns a **run handle** (+ progress notifications where the
client supports them), or awaits completion for fast/sync flows (`Modus.deliveryMode`). **SSE is the spine;
WebSocket is an optional later upgrade.**

## IdentityResolver

One resolver, multiple credential acceptors → crystal `AuctorKey = {animaId} | {commitment}`: web JWT,
`X-API-Key`, web3 signature, arcanum commitment. **Anon (commitment) supported day one** — it flows straight
through `Inceptio.identity`. JWT is just one accepted input (the web platform path), not a separate model.

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
2. **SSE run streaming + `BulletinBusProjector`.** Project the existing bus events into a neutral run-event
   stream; `GET /v1/runs/:id/stream`. Reconnect replays from durable `Actum` stage history.
3. **MCP adapter over the same facade.** Flows = tools (inputSchema from `aditusToJsonSchema`), catalog =
   resources, run handle + progress. Crystal-native; supersedes the legacy MCP surface.
4. **Management ops + remaining discovery (capability-parity close-out).** `provisionStudio` (one-shot) +
   its discovery (`listFundamenta`, `listImages`/runtimes); `listModels`/`resolveLora` queries; `saveFlow`;
   `bind`; `status`. *Acceptance:* an agent script does the full arc *blind-start* — discover fundamenta →
   provision a studio → discover + describe a flow → invoke → stream → rate → save-as → run on the studio —
   over REST + MCP, never needing an id it couldn't enumerate.

## Risks / guardrails

1. **No opaque ids (discoverability).** Every operation that takes an id (`fundamentumId`, `modusId`, a model
   id, an image) MUST have a discovery resource that enumerates it, and bounded fields carry `enum`s in the
   schema. An agent must be able to start blind and learn every choosable value. This is the half of the
   wizard we keep.
2. **Don't re-sprawl.** Resist mirroring Telegram surfaces; keep the op set small and declarative. If an op
   only exists to reproduce a chat affordance (a morph, a step, a page turn), drop it.
3. **MCP async contract** — handle-vs-await per `Modus.deliveryMode`; decide before building the MCP adapter.
4. **One facade, not two** — MCP and REST must call the same facade, or they drift. The facade is the contract.

## Verification boundary

Hermetic where possible — the facade, `aditusToJsonSchema`, and `IdentityResolver` are pure logic over a
mocked ring + in-memory store. The **doc/skill drift-check** (`gen:api-docs && git diff --exit-code`) runs in
the hermetic gate every phase — a stale spec fails the build. Live SSE + real pod provisioning are validated
on **staging** (a GPU), never the hermetic gate — same boundary as the rest of the repo.
