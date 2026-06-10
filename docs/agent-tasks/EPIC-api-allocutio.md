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

A single **agent-shaped facade** over the execution rail + stores, in crystal vocabulary — e.g.
`invokeFlow(auctor, modusId|verb, aditus, opts) → {actumId}`, `getRun(id)`, `listFlows()`,
`describeFlow(id) → tool schema`, `listModels(filter)`, `resolveLora(trigger, familia)`,
`provisionStudio(auctor, {fundamentumId, models?, warm?})`, `saveFlow(auctor, {fromRun, name, affixes, promptMode})`,
`rerun`, `rate`, `bind`, `status`. Both protocol adapters call this one facade:

- **MCP adapter** — flows = MCP tools, catalog = MCP resources. The emerging agent standard; supersedes the
  legacy MCP/tools surface in `src/api/` with a crystal-native one.
- **REST adapter** — resources (`/v1/runs`, `/v1/flows`, `/v1/models`, `/v1/studios`, `/v1/me/...`) with
  self-describing JSON-Schema'd inputs. Any HTTP/agent client works.

**Flows are tools.** A `Modus`/`Essentia` already carries a typed input schema (`aditus` = `Porta` map:
type/required/default/label/description) and output (`exitus`). A pure `aditusToJsonSchema(modus.aditus)`
derives the MCP tool `inputSchema` AND the REST validation/OpenAPI — one function, both protocols. The agent
reads the schema and submits **complete** params; no interactive per-`Porta` stepping.

## The collapse (Telegram surface → one API op)

| Telegram (medium-constrained) | Agent API |
|---|---|
| `/make` `/run` `/chat` + interactive aditus gather | `POST /v1/runs {modusId\|verb, aditus, pinnedModels?}` / MCP tool call |
| Flow card — `Porta`-by-`Porta` panel | the flow's JSON-Schema input, submitted whole |
| Delivery menu (info/rate/wrench→rerun/tweak/save) | `GET /v1/runs/:id` (+ stats); `POST /v1/runs/:id:rerun`; `POST …/rating`; `POST /v1/flows {fromRun}` |
| Save-as force-reply sequence (name→review→toggle→confirm) | `POST /v1/flows {fromRun, name, affixes, promptMode}` — one call |
| `/arm` wizard (preset→detail→image→config→picker→start) | `POST /v1/studios {fundamentumId, models?, warmMs?}` — one shot |
| Mod• picker (categories→list→detail→page→search→trigger) | `GET /v1/models?familia=&kind=&q=` ; `GET /v1/loras?trigger=` |
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
  `BulletinBusProjector` (neutral run-event projection), the SSE endpoint.

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

## Phasing (each graduates to a TASK-NNN)

1. **Facade + IdentityResolver + flow-as-tool schema + core run resources (REST).** `invokeFlow`/`getRun`,
   `listFlows`/`describeFlow`, `aditusToJsonSchema`, reusing the rail. *Acceptance (hermetic):* mocked ring +
   in-memory store; each credential → invoke returns an actumId; schema derived from a real `Essentia.aditus`;
   anon commitment accepted.
2. **SSE run streaming + `BulletinBusProjector`.** Project the existing bus events into a neutral run-event
   stream; `GET /v1/runs/:id/stream`. Reconnect replays from durable `Actum` stage history.
3. **MCP adapter over the same facade.** Flows = tools (inputSchema from `aditusToJsonSchema`), catalog =
   resources, run handle + progress. Crystal-native; supersedes the legacy MCP surface.
4. **Management ops (capability-parity close-out).** `provisionStudio` (one-shot), `saveFlow`,
   `listModels`/`resolveLora` queries, `bind`, `status`. *Acceptance:* an agent script does the full arc
   (describe a flow → invoke → stream → rate → save-as → provision a studio → run on it) over REST + MCP.

## Risks / guardrails

1. **Don't re-sprawl.** The discipline is to *resist* mirroring Telegram surfaces; keep the op set small and
   declarative. If an op only exists to reproduce a chat affordance, drop it.
2. **MCP async contract** — handle-vs-await per `Modus.deliveryMode`; decide before building the MCP adapter.
3. **One facade, not two** — MCP and REST must call the same facade, or they drift. The facade is the contract.

## Verification boundary

Hermetic where possible — the facade, `aditusToJsonSchema`, and `IdentityResolver` are pure logic over a
mocked ring + in-memory store. Live SSE + real pod provisioning are validated on **staging** (a GPU), never
the hermetic gate — same boundary as the rest of the repo.
