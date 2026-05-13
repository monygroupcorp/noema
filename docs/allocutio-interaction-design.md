# Allocutio — Interaction System Design
## The Language Layer That Sits Between the Crystal Ring and the Human

**Date:** 2026-05-11
**Status:** Draft — workshop until canonical. All Phase 7 platform work executes inside this frame.
**Vision ceiling:** `docs/plans/2026-05-06-stationthis-launchpad-vision.md`
**Crystal ceiling:** `docs/crystal-master-plan.md`

---

## What This Document Is

The crystal master plan defined the ring — the data primitives, the ledger, the execution rail. It said Phase 7 is "wire platform handlers to ring" and left it there. That was the right call: you don't design the language before you understand the vocabulary.

The vocabulary is now clear. This document defines the **Allocutio** — the layer that translates human intent on any surface (Telegram, Discord, web canvas, iframe embed, REST API, future MCP) into crystal ring calls and back.

The problem this solves is not "how do I add a Telegram command." It is: we have five surfaces, a dozen intents, three identity modes (anonymous, identified, agent-delegated), and a system that has historically grown by bolting each new thing onto the previous thing until the mods menu became 1,475 lines of callback spaghetti. We stop that now by defining the language first.

---

## The Core Vocabulary (Canonical — Do Not Expand Without Cause)

This is the complete user-facing dictionary. Everything in the system is expressible through these words. If a new concept requires a word not on this list, the design is wrong.

```
Workspace       The top-level container. A user has one or more.
                HOME workspace is provided on account creation, pre-populated
                with canonical surfaces for every transformation type.

Surface         A named group of nodes within a workspace. The user cycles
                between surfaces. Navigation tier between workspace and node.

Node            The atomic execution unit on a surface. Opaque — internally
                it may be a single Modus, a sequence, an NFT engine. The
                canvas doesn't care. Named by whoever authored it.

Mint            The act of saving a node configuration (or a selection of
                connected nodes) as a new named Node available everywhere.

Media           A node that supplies a file, URL, or camera input.
Value           A node that supplies a typed literal — text, number, or a
                maintained list of options the user cycles through.
Transform       A node that reshapes or combines connected inputs. Has
                designed preset faces; expression language underneath.
Context         A node that injects identity and memory — trigger words,
                RAG history, Anima fields, NFT metadata.
```

**What is not in this dictionary:** spell, cook, effect, collection test, expression (as a user-facing name). These concepts still exist — they are expressed through the primitives above.

- Spell = a minted Node with exposed slots and locked config
- Cook = a Node whose upstream Value has multiple states, producing batch
- Effect = a Media node wired into a Node's input (a pattern, not a type)
- Expression = the engine inside Transform (an implementation detail)

The user never needs these words. The system subsumed them.

**Outer shell nav (canonical):**
```
[Wordmark]   [Workspace]   [Models]   [Flows]   [Account ▾]
```
- **Models** — asset library: LoRAs, checkpoints, embeddings
- **Flows** — executable catalog: canonical tools + personal minted + community published

**The canvas is the reference implementation of this vocabulary.** Every decision about how nodes, surfaces, and execution work is made there first. See `docs/canvas-design.md` for the full canvas spec.

---

## The Three-Layer Model

```
┌─ SURFACES ────────────────────────────────────────────────────────────────┐
│  Telegram    Discord    Canvas (web)    Iframe embed    REST API    MCP   │
│  thin platform adapter — render primitives, route events                  │
└────────────────────────────┬──────────────────────────────────────────────┘
                             │ Intent + Context
┌─ FLOW ENGINE ──────────────▼──────────────────────────────────────────────┐
│  Intent Router — maps raw input to named Intent                           │
│  Flow FSM — stateful multi-step conversation management                   │
│  Primitive Emitter — emits UI primitives, not raw text                    │
└────────────────────────────┬──────────────────────────────────────────────┘
                             │ Ring calls (in-process)
┌─ CRYSTAL RING ─────────────▼──────────────────────────────────────────────┐
│  Actorum  Signorum  Animae  Vestigiorum  Modorum  Mandatores  etc.        │
└───────────────────────────────────────────────────────────────────────────┘
```

**The platform adapter never calls the ring directly.** It speaks to the Flow Engine. The Flow Engine speaks to the ring. This separation is what allows one set of business logic to power all surfaces.

---

## Part 1 — The Starting Condition Model

The canvas v2 ActionModal already answered the core design question: **how do you present a toolbelt that can do anything without overwhelming the user?**

The answer is: **don't ask what they want to do — ask what they're starting with.** Starting condition determines the mode, mode constrains the category, category constrains the tools. The user never sees the full catalog. They see a flat three-level path:

```
STARTING CONDITION → MODE → CATEGORY → TOOL
```

This is the universal mental model for `execute`. It lives in `ActionModal.js` as a radial donut but it must translate identically to every surface.

### The Two Modes

```
CREATE      Starting from nothing — you want to produce something new.
            Category = output type: image / sound / text / movie
            Tool = any tool whose category matches (txt2img, TTS, LLM, etc.)

EFFECT      Starting from existing content — you want to transform it.
            Category = what you're processing: image / caption / video / sound
            Tool = any tool with a required input of that type
            (masking, background removal, upscale, interrogate, etc.)
```

These two modes are the entire surface of `execute`. Every tool in the system lives in exactly one of them, in exactly one category. There are no orphaned tools.

### The Four Anchors

The ActionModal's inner ring offers four **shortcut entry points** that bypass the mode/category selection. These are atomic: they represent the four ways to start a workflow without picking a mode first.

```
ANCHOR          WHAT IT MEANS
────────────────────────────────────────────────────────────────────────────
upload          I have a file — add it as an input node.
                On canvas: addUploadWindow()
                On chat: send a photo/attachment → becomes the effect input

text            I have text — add it as a primitive input.
                On canvas: addPrimitiveWindow('text')
                On chat: plain text message → routed to the active tool's text input

expression      I want to sequence — connect tools into a pipeline.
                On canvas: addExpressionWindow()
                On chat: "chain mode" — queue tools that run in sequence

agent ctx       Inject my memory — load Vestigium/soul context as an input node.
                On canvas: addAgentContextWindow()
                On chat: a toggle at cast time ("use my history")
```

These four anchors are the seams between the user's **data** (what they have) and the execution rail (what we can do with it). They are the same concept on every surface, rendered differently.

### Full Intent Vocabulary

`execute` is the primary intent. The others are support intents — everything the user needs to do that isn't executing a tool.

```
INTENT          ENTRY POINT             DESCRIPTION
────────────────────────────────────────────────────────────────────────────
execute         /cast, canvas tap,      The primary verb. Mode (create/effect)
                embed, API              + category + tool. Encompasses spells,
                                        cooks (parallel batch), and chains.
                                        Anchors: upload / text / expression / agent ctx.

train           /train                  Full training workflow for LoRA / fine-tune.
                                        Subsumes: dataset selection (Corpus), parameter
                                        config, trigger run, monitor, review, publish.
                                        configure_lora is not a separate intent —
                                        it is a state inside this flow.

explore         /mods, /spells,         Browse the catalog of tools, spells, LoRAs,
                /tools, canvas          collections. Read-only.

review          /history, canvas        Inspect prior Acta, search via Vestigium,
                                        rate outputs, compare runs.

manage          /account, /wallet,      Account-level: wallet, deposits, identity
                settings                linking, settings, groups, Tabula config.

delegate        /agent                  Create or configure a Mandatum — standing
                                        instruction with its own budget.
                                        "Every morning, run this for me."

status          /status                 Active Modo, cost-so-far, balance,
                                        pending jobs, open Collectiones.
```

### Why This Vocabulary

**execute subsumes create, effect, spells, and cooks.** They share the same execution rail — Actum → Cursorum → ring. The mode (create vs effect) and composition style (single / spell / cook / chain) are parameters of execute, not separate intents.

**train not (train + configure_lora).** Training is one workflow; LoRA configuration is a step inside it. Separate intents would require every adapter to independently manage the navigation between them.

**explore not browse/catalog.** The verb is the user action, not the noun of what's being shown.

---

## Part 2 — The Interaction Grammar

### Node Types (canonical vocabulary from the canvas)

The canvas gave us a vocabulary for the kinds of "things" a user can place in a workflow. These are not canvas-only concepts — they are the atoms of any execution, across every surface.

```
NODE TYPE       CRYSTAL PRIMITIVE   DESCRIPTION
────────────────────────────────────────────────────────────────────────────
Tool            Modus (create)      Executes a tool in create mode.
                                    Input: text/params. Output: new media.

Effect          Modus (effect)      Executes a tool in effect mode.
                                    Input: existing media. Output: transformed media.

Spell           Modus (canonica)    Pre-configured tool with locked params.
                                    Entry point bypasses category/tool selection.

Upload          (data input)        User provides media from outside the system.
                                    Becomes the input to an Effect tool.

Primitive       (data input)        User types or pastes a value (text, number, URL).
                                    Becomes a parameter or the prompt for a Tool.

Expression      Collectio (chain)   Sequences multiple tools. Output of one becomes
                                    input of the next. Compiled to a Collectio.

Agent Context   Vestigium / Anima   Injects personal memory/history as context.
                                    RAG search over user's Vestigia at cast time.

Collection      Collectio (batch)   Runs a tool (or spell/chain) in parallel over
(Cook)          batch               N inputs. Results gathered as a Collectio.
```

Every execution is one or more of these nodes connected together. The node type vocabulary is how we describe an execution to the user without exposing the underlying ring primitives.

### UI Primitives

A **UI Primitive** is the smallest unit of interaction that any surface can render. The Flow Engine emits sequences of primitives. Each adapter renders them in the platform idiom. If an adapter cannot render a primitive (e.g., Stream on an older API surface), it degrades gracefully.

```
UI PRIMITIVE    WHAT IT IS                          TELEGRAM          DISCORD           CANVAS
────────────────────────────────────────────────────────────────────────────────────────────────
Prompt          Free-text input request             await text msg    modal / prompt    text field
Select          Pick one from N options (≤8)        inline keyboard   select menu       radial / button group
MultiSelect     Pick any of N options               inline keyboard   select menu       checkbox group
Paginate        Scrollable list with next/prev      inline keyboard   embed + buttons   tool list panel
Confirm         Binary yes/no gate                  inline keyboard   confirm button    dialog
Form            Multi-field structured input        step-by-step      modal form        params card
Detail          Read-only content + actions         message+buttons   embed+buttons     card+toolbar
Action          Fire-and-forget side effect         button tap        button click      icon button
Stream          Progressive output                  edit message      edit embed        SSE / WebSocket
```

**The rule: the Flow Engine emits primitives. Adapters render them. Logic never lives in adapters.**

### The Three-Level Execute Pattern

The ActionModal's three-level model is the canonical execute interaction on every surface:

```
LEVEL 1: MODE       "What are you starting with?"
                    [create] — make something new
                    [effect] — transform existing content
                    ── or pick a quick anchor ──
                    [upload] [text] [expression] [agent ctx]

LEVEL 2: CATEGORY   "What kind of thing?"
                    create → [image] [sound] [text] [movie]
                    effect → [image] [caption] [video] [sound]

LEVEL 3: TOOL       Filtered list for that mode+category.
                    Spells appear here as pre-configured entries.
```

On the canvas: radial menu. On chat platforms: Select primitives (two rounds). On API: `{ mode, category, modusId }` params. The logic is identical.

```
SURFACE     LEVEL 1                   LEVEL 2                     LEVEL 3
────────────────────────────────────────────────────────────────────────────────────────
Canvas      radial: effect/create     radial: category labels     scrollable tool grid
Telegram    /cast → 2 buttons         4 inline keyboard buttons   paginated tool list
Discord     /cast modal → select      select menu                 select menu
REST        mode param                category param              modusId param
```

---

## Part 3 — The Flow Engine

### Intent → Flow mapping

Each intent maps to a **Flow** — a stateful FSM that knows the steps from entry to resolution.

```
execute  → ExecuteFlow
train    → TrainFlow
explore  → ExploreFlow
review   → ReviewFlow
manage   → ManageFlow
delegate → DelegateFlow
status   → StatusFlow
```

### Flow Contract

```typescript
interface Flow {
  intent: Intent
  // Called with whatever context the adapter provides (platform, identity, etc.)
  enter(ctx: FlowContext): Promise<Step>
  // Called when a primitive result comes back
  handle(ctx: FlowContext, event: PrimitiveEvent): Promise<Step | Resolution>
}

// A Step is what the flow engine emits to the adapter
type Step = { primitives: Primitive[] }

// A Resolution ends the flow
type Resolution =
  | { kind: 'complete'; output?: unknown }
  | { kind: 'abandon' }
  | { kind: 'handoff'; toIntent: Intent; withContext: unknown }
```

Flows can hand off to each other. `ExploreFlow` finding a spell hands off to `ExecuteFlow` with the spell pre-selected. `ExecuteFlow` discovering the user has no credits hands off to `ManageFlow` at the wallet step.

### ExecuteFlow

The most important flow. Built on the canvas three-level model.

```
ENTRY
  ↓
[anchor shortcut?]
  upload     → ADD_INPUT_NODE (file)       → CONFIGURE
  text       → ADD_INPUT_NODE (text prim.) → CONFIGURE (skip mode/category)
  agent ctx  → ADD_CONTEXT_NODE           → BROWSE_TOOLS (effect, filtered by compat)
  expression → START_CHAIN               → BROWSE_TOOLS (create, all categories)
  no anchor  → SELECT_MODE

SELECT_MODE
  Select("What are you starting with?", [create, effect])
  ↓
SELECT_CATEGORY
  Select(mode == create ? [image, sound, text, movie]
                        : [image, caption, video, sound])
  ↓
BROWSE_TOOLS
  Paginate(tools filtered by mode + category)
  ↓ select tool or spell
CONFIGURE
  Form(required aditus fields only; optional params behind toggle)
  ↓ confirm
  [has budget?]
    no  → HANDOFF ManageFlow:wallet
    yes → SUBMIT

SUBMIT
  ring.signorum.lock(...)
  ring.actorum.create(actum)
  ring.cursorum.run(actum, modo?)
  Stream(partial outputs as they arrive)
  ↓ complete
  ring.completor.complete(actum, exitus)

RESULT
  Detail(output + actions: [Save, Rate, Remix, Share, Run Again, Chain →])
```

**Spell entry.** Spells bypass SELECT_MODE and SELECT_CATEGORY — they arrive at CONFIGURE with all locked params pre-filled and only exposed inputs visible. The user sees a shorter form.

**Cook (batch) entry.** User multi-selects tools or reaches "run all" on a Collectio. ExecuteFlow creates a Collectio record, runs N Acta in parallel, then aggregates into RESULT. The user sees "running 5 jobs..." not individual job states.

**Chain entry.** Expression anchor opens a chain builder. Each tool added appends to a Collectio with `expressio: 'sequentia'`. Final SUBMIT runs them in order, piping outputs as inputs.

### TrainFlow

```
ENTRY
  ↓
SELECT_TYPE
  Select(LoRA / Embedding / Fine-tune)
  ↓
SELECT_DATASET
  Paginate(Corpora) or create new Corpus inline
  ↓
CONFIGURE_PARAMETERS
  Form(checkpoint, steps, rank, trigger word, etc.)
  ↓ confirm
SUBMIT_TRAINING_JOB
  ring.cursorum.run(actum{ modusId: lora-trainer, aditus })
  Stream(progress: epoch N/M, loss)
  ↓ complete
REVIEW_OUTPUTS
  Detail(sample images + metrics + actions: [Publish, Retry, Discard])
```

There is no `/configure_lora` intent. You arrive at the configure parameters step by going through train. The flow knows which step you're on. Deep-linking into a specific step is done via flow context (`ctx.resumeAt = 'CONFIGURE_PARAMETERS'`), not separate intents.

---

## Part 3b — Canvas as the Reference Implementation

The canvas `ActionModal` is not a special case — it is the reference implementation of the interaction grammar. Every design decision made in `ActionModal.js` maps to an equivalent decision on every other surface. When in doubt about how something should work on Telegram or REST, ask: "how does the ActionModal handle this?"

```
ActionModal concept          Allocutio equivalent
─────────────────────────────────────────────────────────────────────────────
Outer ring: effect / create  SELECT_MODE step in ExecuteFlow
Inner ring: four anchors     Anchor shortcuts that bypass SELECT_MODE
Category grid                SELECT_CATEGORY step
Tool list panel (scrollable) BROWSE_TOOLS step (Paginate primitive)
Back button                  Built into every step (navigation stack in FlowContext)
Connecting mode (blue tint)  Context-aware filtering — tools filtered by output type
                             of the node the user is connecting from
"no tools" empty state       BROWSE_TOOLS with zero results → suggest alternative category
Text primitive shortcut      upload/text anchor → ADD_INPUT_NODE, skips mode selection
ConnectionDropPicker         Same as anchor-triggered ExecuteFlow but pre-filtered
                             to tools compatible with the dragged output type
```

### The Connecting Mode Insight

When the canvas is in connection mode (dragging an output anchor), the ActionModal filters tools to only those whose inputs are compatible with the dragged type. This is contextual execute — the user's starting condition is already known (they have a specific output type), so the modal skips mode selection and goes straight to a type-filtered tool list.

This same pattern applies on chat platforms: if the user sends a photo, the `/cast` flow opens in `effect` mode with the photo pre-loaded, skipping SELECT_MODE entirely. The starting condition is inferred from the message content.

```
CONTEXT CLUE                 INFERRED STARTING CONDITION
────────────────────────────────────────────────────────────────
User sends photo/video/audio → effect mode, that media as input
User sends text message      → create or effect (prompt user for mode)
User says /cast @spell-name  → spell shortcut, jump to CONFIGURE
User says /cast              → full SELECT_MODE → SELECT_CATEGORY → BROWSE_TOOLS
User says /cast [query]      → BROWSE_TOOLS with text search pre-filled
Canvas output → empty canvas → ConnectionDropPicker (type-filtered tool list)
```

## Part 4 — The Platform Adapter (Allocutio)

### Contract

```typescript
interface Allocutio {
  // Platform sends user input here
  receive(input: AllocutioInput): Promise<void>
  // Flow engine sends steps here to render
  render(step: Step, ctx: AllocutioContext): Promise<void>
  // Subscribe to primitive events (button press, text input, etc.)
  on(event: 'primitive_event', handler: (e: PrimitiveEvent) => void): void
}
```

### Implementations

```
TelegramAllocutio   — grammY / node-telegram-bot-api
DiscordAllocutio    — discord.js
WebChatAllocutio    — web chat interface (mobile primary) — same primitives as Telegram,
                      rendered natively in browser. The concierge/agent entry point.
                      Shares primitive definitions with TelegramAllocutio.
CanvasAllocutio     — postMessage bridge to canvas workspace
IframeAllocutio     — same as Canvas but embedded in third-party site
RestAllocutio       — express routes (JSON in/out, no interactive primitives)
McpAllocutio        — MCP tool responses (tools are intents, responses are Detail primitives)
```

**WebChatAllocutio is the mobile primary surface.** On mobile, Chat is the default landing screen — not the canvas. The web chat interface renders the same primitives as Telegram (Select, Detail, Stream, etc.) in a native browser idiom. A user who knows Telegram knows web chat. Continuity is structural.

Chat belongs to the **Anima**, not to a Workspace. The conversational history, the agent's memory, the Vestigium context — all of it transcends workspace boundaries. Chat is the user's persistent relationship with their agent across all sessions, all workspaces, all time.

### What adapters do NOT do

- **No flow logic.** Adapters don't know what step comes after BROWSE_TOOLS. The flow engine does.
- **No ring calls.** Adapters don't call `ring.actorum.create()`. The flow engine does, via a service layer.
- **No state.** Adapters don't remember where you are in a flow. The Flow Engine's context store does.
- **No content decisions.** Adapters don't decide which tools to show or which parameters are required. The flow engine asks the ring and emits primitives.

The adapter's job is exclusively: receive raw platform event → normalize to PrimitiveEvent → hand to flow engine. And: receive Step → render each primitive in the correct platform idiom.

### Context Store

Flow state must survive across multiple messages (especially on Telegram/Discord where each user action is a separate event). The context store maps `(platform, userId) → FlowContext`.

```typescript
interface FlowContext {
  intent: Intent
  flow: Flow
  state: unknown          // flow-specific step state
  identity: AuctorKey     // animaId or arcanumHash
  modoId?: string         // active session if one exists
  platform: Platform
  platformUserId: string
  messageId?: string      // for message editing (Telegram/Discord)
}
```

In-memory for a single process. Redis-backed for multi-process/multi-region. The store is injected into the flow engine — not hardcoded.

---

## Part 5 — Identity Modes

The crystal ring has a hard privacy partition. The interaction system must route to the correct side.

```
MODE            WHO                 IDENTITY IN RING         SIGNUM FORMA
────────────────────────────────────────────────────────────────────────────
Identified      Logged-in user      animaId                  minted / eth / x402
Anonymous       No account          arcanumHash (per-client) arcanum / tessera
Agent           Mandatum running    animaId (owner's)        tessera (from Mandatum budget)
```

The adapter knows the platform user's identity (Telegram user_id, Discord user_id, web session). The flow engine resolves this to an AuctorKey via `PersonaStore.findOrCreate()` for identified users, or generates an arcanumHash for anonymous sessions.

Anonymous sessions are a first-class feature, not an edge case. A user who hasn't linked an account can still run executions — they are charged via the arcanum/tessera rail, with no identity attached to their outputs.

---

## Part 6 — Third-Party Integration Seams

We will expose three integration surfaces to third parties:

### 1. REST API (RestAllocutio)

The `/api/v1/execute` endpoint accepts a tool selection + aditus and returns a completed actum. This is the machine-readable form of ExecuteFlow — no interactive steps, just submit and poll. Third-party apps that want to run a generation without embedding a UI use this.

```
POST /api/v1/execute
  { modusId, aditus, signaIds[] }   // the caller pre-selects the tool and pre-locks credits
→ { actumId }                       // poll for completion

GET /api/v1/execute/:actumId
→ { status, exitus }
```

### 2. Iframe Embed (IframeAllocutio)

A third-party embeds `<iframe src="https://stationthis.com/embed?context=execute&modusId=xyz" />`. The IframeAllocutio renders the ExecuteFlow (or any other flow) inside the iframe via postMessage. The embed surface can be scoped to a single tool (a spell embed), a collection of tools, or the full catalog.

Third-party identity: the embed accepts a JWT issued by our auth system. The third-party mints JWTs for their users via their own API key.

### 3. MCP Tool Server (McpAllocutio)

Claude Code and other AI systems can discover and invoke our tools via MCP. Each published Modus becomes an MCP tool. Invocation = `execute` intent via the McpAllocutio. Results are returned as Detail primitives (the MCP tool's response).

The MCP adapter is intentionally read-only for discovery (`explore`) and write for execution. Training, wallet management, and delegation are not exposed via MCP — they require the full interactive flow.

---

## Part 7 — The Mods Menu Problem (and How We Fix It)

The existing Telegram `modsMenuManager.js` is 1,475 lines and manages its own state via callback data shortcodes hacked to fit Telegram's 64-byte limit. It implements its own navigation logic, its own pagination, its own confirmation dialogs. This is the canonical example of what not to do.

Under Allocutio, the entire thing collapses:

```
/mods → explore intent, filtered to genus: 'lora'
```

The `ExploreFlow` renders a Paginate primitive (the list of LoRAs). The user selects one. The `ExploreFlow` renders a Detail primitive (the LoRA's info + actions). Actions available on the Detail: [Use in execute] [Edit] [Delete] [Change checkpoint]. Each action fires a handoff or an Action primitive. No custom state management. No callback shortcodes. The TelegramAllocutio handles Telegram's 64-byte limit internally (it encodes a session-relative cursor, not the full intent chain).

The 1,475 lines condense to:
- `ExploreFlow` (shared across all surfaces, ~200 lines)
- `TelegramAllocutio.renderPaginate()` + `TelegramAllocutio.renderDetail()` (adapter rendering, ~100 lines)

This is the promise of the three-layer model.

---

## Part 8 — Platform Surface Inventory

What each surface needs to support at Phase 7 launch:

### Telegram
- **Intents:** execute, train, explore, review, manage, status
- **Primitives:** all except Stream (fallback: edit final message when done)
- **Identity mode:** identified (linked animaId) + anonymous (arcanumHash on demand)
- **Phase 7 scope:** ExecuteFlow (single tool, spells), TrainFlow, ExploreFlow (mods/spells), StatusFlow

### Discord
- **Intents:** execute, explore, status
- **Primitives:** all via interactions API (modals for Form, selects for Select, embeds for Detail)
- **Identity mode:** identified only (Discord guild context)
- **Phase 7 scope:** ExecuteFlow (spells / slash commands), ExploreFlow, StatusFlow

### Canvas (FocusDemo web)
- **Intents:** execute (primary), explore, review, train
- **Primitives:** all, with native web rendering (no degradation needed)
- **Identity mode:** identified
- **Phase 7 scope:** ExecuteFlow via tool node + connection system (already built), integration with ring

### Iframe embed
- **Intents:** execute (scoped — single tool or collection only)
- **Primitives:** select, form, confirm, stream, detail
- **Identity mode:** identified (JWT) or anonymous
- **Phase 7 scope:** single-tool embed for third-party integration

### REST API
- **Intents:** execute (programmatic), status
- **Primitives:** none (JSON request/response only)
- **Identity mode:** identified (API key → animaId) or anonymous (arcanumHash)
- **Phase 7 scope:** fully working execute endpoint

---

## Part 8b — Chat as First-Class Surface

Chat belongs to the **Anima**, not to a Workspace. It is the user's persistent relationship with their personal agent across all sessions, all workspaces, all time. It is not a feature of the canvas — it is a parallel entry point to the entire system.

### Crystal backing (Phase 8)

Three new ring primitives support chat. See `docs/crystal-master-plan.md` Phase 8 for full spec.

```
Colloquium    conversation thread — animaId required, optional tabulaId + modoId binding
Dictum        one turn — genus (user|agent|systema), corpus (text), actumId? (spawned execution)
Memoria       long-term distilled memory — rebuilt from Colloquia, loaded by concierge at session start
```

`Actum` gains `dictumId?: string` — the origin conversation turn. From the Gallery, every output
traces back to the conversation that produced it.

### WebChatAllocutio

The web chat is a first-class Allocutio adapter, not a port of the canvas. On mobile it is the
**default landing screen** — the user arrives in Chat, not in Workspace.

- Renders the same primitives as TelegramAllocutio (Select, Detail, Stream, Confirm, etc.)
- Shared primitive definitions mean Telegram UX and web chat UX are structurally identical
- New users are guided toward their first execution through conversation, not through learning the canvas
- The canvas is one tap away via the Workspace tab

### The concierge

The personal agent lives in Chat. At session start it loads:
- `Memoria` — long-term distilled preferences and affinities
- Recent `Vestigia` — what the user has made and loved
- Active `Tabula` — what workspace is currently configured

The concierge is a Phase 5+ capability (requires Modo + Vestigium + Anima fully wired). The
WebChatAllocutio MVP ships without it — basic flow execution + result cards in a message thread.
The concierge is the upgrade that makes chat feel alive.

### Chat as the unified execution endpoint

Every action expressible through chat is also expressible through REST API and MCP tools:

```
execute        run a flow with inputs → return result (Actum)
manage         create / edit / delete workspace / surface / flow / node
query          search history, list flows, inspect Colloquium state
mint           save a canvas configuration as a named Flow
```

Building WebChatAllocutio well means the API and MCP surfaces are already built. They share
the same four atomic operations routed through the same Flow Engine to the same ring.

### Privacy

Colloquia are identified-side only. Anonymous sessions (arcanum/tessera) get ephemeral
execution with no persistent conversation history. If the user wants the agent to remember
them, they need an account. This is a meaningful incentive for account creation.

---

## Part 9 — Open Questions

These are live — not resolved yet. This section is where we workshop:

**OQ-1: Flow context persistence.** In-memory for Phase 7 (single process, single server). When do we need Redis? Answer depends on process count and session durations.

**OQ-2: Spell and tool browsing depth.** How many levels does ExploreFlow need? Today: type → genre → specific tool. Does `execute` always start with a selection step, or does the user land directly in configure for a pre-selected tool (e.g., from a `/cast @spell-name` command)?

**OQ-3: Concierge mode interaction.** The launchpad vision has a personal agent who greets the user and can take natural language. How does the Flow Engine handle free-text intents that aren't `/commands`? The NLU layer (intent classification from free text → Intent) is not designed yet. This is Phase 5+ territory but the seam should be considered now.

**OQ-7: Agent Context node depth.** The canvas has `addAgentContextWindow()` as an anchor shortcut — it injects the user's Vestigium/soul as a context input. What exactly does this inject? Options: (a) most recent N vestigia, (b) RAG search results for the current prompt text, (c) Anima.memoriaRef pointer (user's persistent memory doc), (d) all three, with the tool's aditus schema deciding which to use. The crystal supports all of these but the interaction contract needs to be defined before the canvas node is wired up.

**OQ-8: Expression / chain UX on chat platforms.** The expression node on canvas is spatial — you draw wires. On Telegram/Discord there's no canvas. Options: (a) a sequential "then do this" multi-step conversation that builds the chain step by step; (b) a shorthand syntax (`/cast upscale | remove-bg | caption`); (c) chains are canvas-only and chat platforms get only single-tool and spell execute; (d) saved chains as spells — users build chains on canvas, save as a spell, then the spell is available everywhere. Option (d) may be the right answer.

**OQ-4: Streaming across platforms.** Canvas and REST can stream properly via SSE/WebSocket. Telegram streams by editing the last message. Discord streams by editing the embed. The Stream primitive needs a platform-specific rendering contract.

**OQ-5: Handoff depth.** When ManageFlow (wallet top-up) completes mid-execute, does the user resume exactly where they were, or do they re-enter ExecuteFlow from the top? The answer shapes how FlowContext stacks.

**OQ-6: MCP tool exposure policy.** Which Modus records are automatically exposed as MCP tools? `canonica: true` only? All published? User-selected? A separate `mcpExposed: boolean` flag?

---

## Part 10 — Phase 7 Build Order

The crystal ring is complete (Phases 0–6). The interaction system design is this document. Phase 7 proceeds in this order:

1. **Define Flow Engine core** — `FlowContext`, `Step`, `Primitive` types; `FlowRouter`; in-memory context store.
2. **Implement ExecuteFlow** (single tool, no cooks/chains yet) — the most critical path.
3. **Wire TelegramAllocutio to ExecuteFlow** — the first live surface. Replaces `castCommand.js` + `toolsMenuManager.js` for single-tool execution.
4. **Wire ExploreFlow (mods browsing)** + **TelegramAllocutio** — replaces `modsMenuManager.js`.
5. **Implement TrainFlow** — replaces `trainModelCommand.js` + training-specific components.
6. **Wire CanvasAllocutio to ExecuteFlow** — the FocusDemo tool node already fires executions; this routes them through the ring.
7. **Implement RestAllocutio** — programmatic execute endpoint.
8. **DiscordAllocutio** — execute and explore.
9. **IframeAllocutio** — embed surface.
10. **McpAllocutio** — MCP tool server.

Each step is a vertical slice: one flow, one adapter, fully working. No partial implementations.

---

## Terminology

| Term | Meaning |
|------|---------|
| **Allocutio** | The full interaction layer: flow engine + all adapter implementations |
| **Intent** | A named top-level user purpose (execute, train, explore, ...) |
| **Flow** | A stateful FSM implementing one intent, from entry to resolution |
| **Primitive** | An atomic UI element emitted by the flow engine (Select, Form, Stream, ...) |
| **Adapter** | Platform-specific renderer of primitives + receiver of platform events |
| **PrimitiveEvent** | The result of a user interacting with a rendered primitive |
| **FlowContext** | The in-flight state of one user's active flow |
| **Resolution** | A flow's terminal state: complete, abandon, or handoff to another flow |
| **AuctorKey** | `{ animaId }` or `{ arcanumHash }` — identity union from the crystal |

---

*This document is the master plan for Phase 7. Update it when flows are designed,*
*primitives are revised, or open questions are resolved. Do not let it drift*
*from the actual state of the Allocutio implementation.*
