# EPIC: ApiAllocutio — crystal-native HTTP API at Telegram parity

- **Status:** backlog epic (scoped, not started). Graduates to numbered `TASK-NNN` specs per phase when picked up.
- **Owner:** none

## Context / why

Everything a user can do through the Telegram bot (`src/allocutio/telegram/TelegramAllocutio.ts`) should
be doable over an HTTP API — make/run/chat/status/flows/bind/cancel **and** the stateful, live surfaces
(bulletin pod-lifecycle HUD, morphing delivery menu, Save-as, `/arm` wizard, Mod• picker). Parity unblocks
the web platform and the CAMEL agent runtime (both need crystal-native HTTP), and it's cheapest to design
while the crystal vocabulary is fresh.

## The finding that shapes everything

The architecture was **built for a second adapter**:
- `Platform` already includes `'rest'` and `'mcp'` (`src/flow/types.ts:111`); `Nuntius.platforma` already
  models `'http'` "(authenticated or anonymous)" with `externusConversationId` = session id
  (`src/types/allocutio.ts:50,100`).
- Interactive surfaces are **already platform-neutral in logic**: `affordancesFor(snapshot)` returns pure
  `Affordance[][]` of `{id,label,kind,scope}` (`src/allocutio/lexicon/bulletin/affordances.ts:63`);
  `BulletinView`/`DeliveryView`/`StatusView` return `{text, keyboard}`. **Telegram is the only thing that
  packs those into an inline_keyboard.** An API renders the same `Affordance[][]` as JSON and accepts the
  same `id` back — **no per-surface API work, only one protocol**; every interactive surface falls out of it.
- The platform-neutral core is reused **as-is**: the ring (`src/container.ts`), `FlowRouter`
  (`enter/handle/handleActumComplete`), `ExecuteFlow`, the execution rail
  (`ActumInceptor`→`Cursor`→`ActumCompletor`→`Nexus`), `Consuetudinum` verb resolution, `aggregateStatus`.

**The one real coupling:** the stateful managers key on `chatId: number` (`BulletinManager` ~145 refs;
`DeliveryMenu` meta; `pickerCache`). That number does triple duty — conversation id + session key + the
cross-owner authorization scope (`DeliveryMenu.ts:62` `meta.chatId !== opts.chatId`). Generalizing it to a
`SurfaceId: string` (+ explicit `hostAuctorKey`) is the spine refactor — pure key-type change;
render/affordance logic untouched.

## Locked decisions

1. **Full parity in one epic** — commands + all live/stateful surfaces.
2. **SSE is the spine** for async pod-lifecycle/bulletin updates (one-way push, `GET …/stream`); every
   client action is a POST. WebSocket is an optional *later* upgrade, out of scope.
3. **One `IdentityResolver`** accepts web JWT / `X-API-Key` / web3 sig / arcanum commitment and emits the
   crystal `AuctorKey = {animaId} | {commitment}`. Anon (commitment) supported day one. (JWT is one input
   credential — composes with crystal-native, does not conflict.)
4. **Fresh crystal-native surface** mounted on the ring, **separate** from the legacy Express API in
   `src/api/` (old tools/spells vocabulary). Legacy auth primitives (`jwt.verify`, `/validate-key`,
   `/web3/verify`) reused **only as credential acceptors** feeding the resolver — no vocabulary entanglement.

## The crux: one affordance protocol

One route pair is the API twin of the *entire* inline-keyboard + callback + force-reply plumbing:
- `GET  /v1/surface/:id` → `{ text, rows: Affordance[][], seq }` — the rendered snapshot.
- `POST /v1/surface/:id/act { id, value? }` → `202 { seq }` — "tap affordance `id`"; the optional `value`
  is the force-reply twin (Save-as name/affix, picker search/trigger text).

Rows go on the wire **verbatim** — no `bul:`/`dm:`/`sa:` prefix (that was Telegram multiplexing one callback
channel; the API routes by URL path + surface `kind`, then dispatches the bare `id` to the same manager
method). The owner guard generalizes to *same-SurfaceId AND AuctorKey-owner-match* for `scope:'host'`
affordances — preserving the existing cross-chat replay protection.

## Phases (each graduates to a TASK-NNN when picked up)

1. **Stateless commands + IdentityResolver + mount.** make/run/chat/status/flows/bind/cancel as
   request/response HTTP, reusing `FlowRouter` exactly as Telegram does; async returns `{actumId, step}`.
   New: `ApiAllocutio.ts`, `IdentityResolver.ts`, `ApiCommandRouter.ts` (twin of `CommandRouter`, JSON in,
   same `RouterDeps`), `apiRouter.ts` mounted in `src/index.ts`. Reuses rail + `Consuetudinum` +
   `aggregateStatus`/`StatusView` + `CANON_VERBS`. *Acceptance (hermetic):* mocked ring + in-memory store;
   each credential type → `POST /v1/make` returns an actumId; anon commitment accepted.
2. **Server-side session state (riskiest).** `chatId:number → SurfaceId:string` + `hostAuctorKey` across the
   4 managers + 2 sink interfaces (key-type change only). Live managers stay **in-process** (they own
   `TimerRegistry` timers + bus subscriptions that can't serialize); a thin `ApiSessionRegistry` holds
   SurfaceId↔AuctorKey + last snapshot for replay. **Do NOT reuse `ModoStore`** — `Modo` is deliberately
   identity-blind (`src/types/modo.ts`). *Land as its own PR gated on Telegram's full suite, before any API code.*
3. **Affordance protocol + SSE.** The `/v1/surface/:id` + `/act` pair (above). SSE: `GET /v1/stream?surfaceId&since`
   subscribes to the same bus events (`actum.stage/complete/fail`, `pod.*`); lift the five handler bodies
   (`TelegramAllocutio` ~936-987) into a neutral `BulletinBusProjector` — Telegram renders to message edits,
   API to SSE frames. Reconnect replays held snapshot + durable Actum stage history.
4. **Parity close-out.** `/v1/arm`, picker, save-as, delivery all route through the one `/surface/:id/act`
   pair — zero new routes. *Acceptance:* a scripted client reproduces a full Telegram session (arm → add
   models → start → run → rate → save-as → drain) over HTTP, asserting each snapshot matches Telegram's.

## Reuse vs new

| Reuse as-is | Refactor to neutral seam (do NOT duplicate) | Stays Telegram-only | Net-new |
|---|---|---|---|
| `FlowRouter`, `ExecuteFlow`, execution rail, `Consuetudinum`, all `*View`/`affordancesFor`, `aggregateStatus` | the 4 managers (`chatId→SurfaceId`+owner); bus→bulletin projection (`BulletinBusProjector`) | `packAffordances`/`_toInline`, callback prefixing, force-reply | `ApiAllocutio`, `ApiCommandRouter`, `apiRouter`, `IdentityResolver`, `ApiEventEmitter`, `ApiSessionRegistry` |

The managers are the bulk of the value — forking them guarantees drift; extract the neutral seam.

## Biggest risks to weigh before committing

1. **`chatId→SurfaceId` crosses Telegram-shared code** (4 managers + 2 sinks). A missed call site silently
   re-forks state. Mitigation: own PR, gated on Telegram's full suite, before API work. *Open question:*
   accept shared-code risk (refactor) vs fork a second manager (faster, permanent drift). **Recommend: refactor.**
2. **Live state is in-process; HTTP wants horizontal scale.** Timers + bus subs don't serialize.
   Recommend single-instance + sticky routing on SurfaceId for the epic; the `?since=`/durable-replay design
   keeps distribution open without reshaping the client contract.
3. **SSE replay completeness** depends on durable `Actum` stage history being a faithful superset of the live
   bus stream. Audit stage-event durability first; a bounded per-surface ring buffer is a simpler
   lossless-within-window fallback.

## Verification boundary

Hermetic gate where possible (mocked ring + in-memory session store; the affordance protocol +
IdentityResolver are pure logic). Phase 2's `chatId→SurfaceId` refactor is verified by **Telegram's existing
full suite staying green** (no behavior change). Live SSE + real pod lifecycle (Phases 3-4) validated on
**staging** (a GPU), never the hermetic gate — same boundary as the rest of the repo.
