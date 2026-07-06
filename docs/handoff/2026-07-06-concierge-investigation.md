# Investigation — The Concierge: from scattered fragments to a buildable v1

**Date:** 2026-07-06 · **Status:** investigation (nothing built) · **For:** the owner + a fresh build agent
**Sources:** `docs/ideas/concierge-flows.md` (the vision, 2026-06-11), `docs/handoff/2026-07-02-api-cursors.md`
(the transport handoff — "This underlies the Concierge more than anything else"), the wiring audit
(`docs/handoff/2026-07-03-frontend-wiring-audit.md:128` — "No chat-run / **Concierge** endpoint; routing/egress meter is fake").

The headline: **the codebase has been quietly pre-shaping toward a server-side concierge for a month.** The LLM
transport, the tool surface, the conversation nouns, and even the streaming architecture decision already exist —
what's missing is one endpoint, one agent loop, and honest frontend wiring. This is an M, not an L.

## 1 · Inventory — what a concierge composes (all verified in-tree)

**The assist rail (client, shipped).** The Concierge already exists as a *form-field coach*:
- `src/platforms/web/app/src/state/promptAssist.tsx:56` — `useAssistField()` one-line field wiring; context at `:26`.
- `src/platforms/web/app/src/shell/Concierge.tsx` — the bubble, mounted on **every** shell screen (`shell/AppShell.tsx:30`),
  slides open on field focus with example + "write it for me" draft. Consumer today: **Card only** (`screens/Card.tsx:76,242`;
  the old Profile wiring is gone — grep `useAssistField` hits one screen).
- `src/platforms/web/app/src/lib/promptExamples.ts:47` — `buildPrompt()` is a **local template drafter** with an explicit
  swap point: *"swap for a real Concierge endpoint when the chat backend lands."*

**The run rail (server, live-verified on staging).** Everything a concierge would drive is one facade:
- Discovery: `GET /v1/flows` + `GET /v1/flows/:id` (JSON-Schema per field, no auth) — `src/allocutio/api/apiRouter.ts:509,517`.
- Quote: `POST /v1/runs/quote` (`apiRouter.ts:236`); dispatch: `POST /v1/runs` (`:146`); SSE run events with snapshot+replay:
  `GET /v1/runs/:id/stream` (`:167`, via `RunEventHub`).
- Bindings: canon verbs `make`/`chat` (`src/crystal/canonVerbs.ts:17`), rebind via `PUT /v1/me/bindings/:verb` (`apiRouter.ts:534`).
- Typed web client already wraps all of it: `src/platforms/web/app/src/lib/api.ts:198–208`, auth = Bearer session or
  `x-commitment` anon (`api.ts:165–171`).

**The LLM transport (server, built + metered).** `src/crystal/ApiCursor.ts` — ONE declarative cursor over
OpenAI-compatible providers (`apiProviders.ts:85`: OpenAI + OpenRouter descriptors; registered `src/container.ts:547–551`),
chat/image/imageEdit capabilities, **real per-1k-token impetus metering** (`apiProviders.ts` pricing). Critically, the
streaming architecture for the Concierge was **already decided and documented** (`ApiCursor.ts:22–28`): the cursor stays
sync; *"the Concierge owns its own token-streaming chat session directly against the provider for the interactive path,
and only SETTLES through a run when it commits work."* Seeded chat modi: `modus.chatgpt`, `modus.openrouter-chat`
(`seeds/modi.ts:20,101`). No Anthropic client exists server-side (grep `anthropic` in src → 0 outside the mock frontend);
the `openai` npm dep (`package.json:65`) is **vestigial** — zero imports remain.

**The tool surface (server, built).** The MCP server registers **16 pure tool handlers over CrystalApi**
(`src/allocutio/api/mcp/mcpServer.ts`): `run_flow, get_run, list_flows, describe_flow, quote, list_fundamenta,
list_models, save_flow, bind, status, provision_studio, get_studio, list_studios, collect, …` — implemented as plain
async functions in `mcp/tools.ts`. **This is exactly the tool-calling harness a concierge agent needs**, already
factored out of transport.

**The conversation substrate (built, dormant — as the idea doc predicted).** `src/types/colloquium.ts` — `Colloquium`
(thread) + `Dictum` (turn) with `Dictum.actumId` (turn → run) and `Dictum.signaIds` (turn → credit events) — the schema
was *designed* for a metered concierge. Mongo stores instantiated (`container.ts:461–462`), indexed (`ensureIndexes.ts`),
and **consumed nowhere** (grep: no reader/writer outside container + impls). Constraint: `animaId` required — *"no
anonymous conversations"* (`colloquium.ts:25`).

**Conversational precedent (Telegram).** Start-screen `chat` button → one-shot `modus.chatgpt` dispatch
(`TelegramAllocutio.ts:729–732`); force-reply wizards for save-as/model-catalog (`:571–593`). It's step-machine
conversational UX, not an LLM session — and it doesn't touch Colloquium either.

**Spells.** `CompositusCursor.ts` runs `gradus`-chained modi straight through (loop at `:88`) — **no pause/checkpoint
primitive exists** (grep `pause|checkpoint` in the cursor → 0). Staged human-in-the-loop is net-new machinery.

**TEE/local routes.** The Chat route picker's `tee`/`local` options map to the "user compute endpoint" idea —
`docs/tee-hardening-plan.md` §Feature extensions (`POST /v1/completions` proxied through a server-held WG tunnel):
explicitly *"non-trivial"*, not built.

## 2 · The gap — what does NOT exist

- **No chat/concierge endpoint.** Full route enumeration of `apiRouter.ts` (688 lines) + grep `concierge|chat` across
  `src/allocutio/api/` → nothing but the binding-summary string in `apiContract.ts:1131`.
- **Chat.tsx is 100% mock.** Seed transcript (`Chat.tsx:58`), `send()` appends a canned "Reading that as make —
  quoting…" (`:102–113`), provenance meter derived presentationally from the picker (`:47–56`, `TODO(backend)`),
  canvas handoff is a bare navigate (`:95–99`).
- **No intent routing.** Nothing anywhere maps free text → verb/flow/aditus. The "picks the tool and runs it" promise
  (Concierge bubble idle copy) is backed by a **dead input** — `Concierge.tsx:73–76` has no handler at all.
- **No LLM agent loop.** MCP is inbound (external agents calling us); there is no outbound LLM-with-tools loop anywhere
  in src. No streaming client either — `ApiCursor` is deliberately sync, and `/v1/runs/:id/stream` carries run lifecycle
  events, not token deltas.
- **No turn/session state in use.** Colloquium/Dictum dormant (above); the web app's `state/session.tsx` is auth
  sessions, not conversations.
- **Anon hole.** Colloquium requires `animaId`; the web front door defaults to `x-commitment` anon — a concierge for
  anon users needs a decision (ephemeral thread vs relaxing the type).
- **No compositus checkpoints** (staged "do you like how I read your script?" — the frankenstein-spell moment).

## 3 · Three prototype options

**(a) Client-side concierge over existing /v1 — the spike.**
Shape: Chat.tsx calls `POST /v1/runs {verb:'chat'}` per turn with a system prompt embedding the flow catalog
(`listFlows` output) + an intent JSON contract; the client parses `{coach|intent}` and drives `quote → createRun →
streamRun` itself via `lib/api.ts`. Reuses: everything in §1's run rail, chat modus, metering-for-free (each turn is a
billable run). Net-new: frontend chat loop + system prompt + intent schema; also replaces `buildPrompt()` at its marked
swap point. **Effort: S.** Risk: no token streaming (sync turn latency), conversation state client-only, system prompt
shipped to the browser, no multi-step tool use (one classify-and-coach per turn), needs a funded caller (anon balance=0
→ error today). Verdict: fastest way to *learn the conversation design*, not the v1.

**(b) Server-side concierge endpoint (chat-run) — the pre-shaped v1.**
Shape: `POST /v1/colloquia/:id/dicta` (or `/v1/concierge`) → server-held agent turn: LLM streaming call (SSE tokens to
the client) with a tool loop over the **existing `mcp/tools.ts` handlers** (`describe_flow`, `quote`, `run_flow`,
`get_run`, `bind`, `status`); persists `Colloquium`/`Dictum`, stamps `Dictum.actumId` when a turn fires a run and
`signaIds` for its own token spend. Reuses: the documented streaming decision (`ApiCursor.ts:22–28`), provider
descriptors + pricing, the whole run rail, the dormant conversation nouns (first consumer — no new noun, exactly as the
idea doc bet). Net-new: one router, one `ConciergeAgent` loop (~a few hundred lines), a thin streaming provider client
(fetch-SSE against `/chat/completions` — no SDK), system-prompt/persona asset, anon-thread decision. **Effort: M.**
Risk: agent-loop quality tuning (the real "easier said than done"), token-cost settlement path for the interactive
session (the decided model only settles committed work — the coaching spend needs its own signum), anon identity.

**(c) The full vision — concierge-first flows.**
Shape: `concierge: on|off` + persona on the Essentia, flows author concierge-first; staged compositus checkpoints
(CompositusCursor pause/resume + turn-based run handle); warm-session cost coaching (Census/`maxImpetus`/studio
economics); cold-start masking with async studio handles; Muse's surprise weaver as a concierge skill. Reuses (b)
wholesale. Net-new: compositus checkpoint machinery, per-flow persona authoring, session-economics coaching, Essentia
schema change. **Effort: L**, and unbuildable well before (b) proves the turn loop. Risk: high; blocks on product
learning we don't have yet.

## 4 · Recommendation

**Build (b), with (a) as its first two days.** The evidence is unusually one-directional: the streaming decision in
`ApiCursor.ts` *names* this architecture, `mcp/tools.ts` already is the tool harness, and Colloquium/Dictum were built
for it. Option (a) alone strands state client-side and can't stream; (c) needs learning only (b) produces. Do (a) as a
throwaway prompt/UX spike *inside* the (b) effort (the system prompt + intent schema are shared work), not as a
deliverable.

Backend tickets (all buildable + hermetic-testable now, independent of frontend de-mocking):
1. **Streaming provider client** — fetch-SSE against the OpenAI-compatible `/chat/completions` of the existing
   descriptors (delete the vestigial `openai` dep while there). Small, pure.
2. **ConciergeAgent loop** — system prompt (flow catalog + house rhythm: "terse, picks tool & runs"), tool loop over
   `mcp/tools.ts` handlers, turn budget/anti-runaway caps.
3. **`POST /v1/colloquia` + `POST /v1/colloquia/:id/dicta` (SSE)** — same `auth()` seam as every route
   (`apiRouter.ts:135–142`); first consumer of MongoColloquium/MongoDictum; `actumId`/`signaIds` stamped.
4. **Concierge token metering** — a signum per turn using the descriptor's per-1k pricing; decide subsidized-vs-charged
   (open question below) but *record* regardless.
5. **Anon threads decision + impl** — ephemeral (in-memory, TTL) for `x-commitment`/bursa callers, persistent for anima.

Frontend (this IS part of the de-mock, not blocked by it): wire `Chat.tsx` `send()` to ticket 3's stream (kill the
canned reply; the provenance meter becomes honest for the `noema` route — "routed via <provider>" is finally true);
wire the Concierge bubble's dead idle input to the same endpoint; swap `buildPrompt()` for a one-shot concierge call.
Must wait: `tee`/`local` picker routes (gate honestly — TEE passthrough is unbuilt), canvas node handoff, compositus
checkpoints (c-tier).

## 5 · Open product questions for the owner

1. **Is coaching metered?** The idea doc says meter it; but the concierge's whole point is converting broke/anon
   cold-starters. Proposal to react to: N free concierge turns per identity per day, gens always metered — where's N?
2. **Anon concierge?** Colloquium is identified-only by design. Ephemeral anon threads OK, or does the front door
   require an account before the concierge speaks?
3. **Which provider/model is "NOEMA default"?** Chat.tsx's mock says "routed via anthropic api" but only
   OpenAI/OpenRouter descriptors exist. OpenRouter descriptor + model routing gets Claude/others cheaply; an Anthropic
   descriptor is a ~20-line add. Also: name the provider in the egress meter (the honesty rule) — which one?
4. **Is a concierge turn a run?** Rails question with pricing consequences: own rail with signum-per-turn (ticket 4)
   vs every turn a `chat`-verb Actum. Recommend own rail (turns are cheap and chatty; Actum stays the unit of *work*).
5. **IA:** Chat pillar = the concierge's home, bubble = its ambient form — do they share one Colloquium per identity,
   or per-screen threads? (Recommend: one active thread, resumable, `titulus` from first turn.)
6. **When does concierge-first flow authoring (c) flip on** — after how many identified users / what turn-quality bar?
7. **Cost coaching v1 scope:** just "here's the quote before I fire" (free — `/v1/runs/quote` exists) vs warm-session
   amortization coaching (needs studio/Census surfacing — later)?
