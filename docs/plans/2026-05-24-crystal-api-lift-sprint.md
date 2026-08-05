# Crystal API lift — sprint plan

**Date:** 2026-05-24
**Predecessors:** Phase C economics + bulletin/arm/status UX carve (both 2026-05-23)
**Successor:** the actual implementation of Mod•/Share•/Destroy/arm/status surfaces (now multi-platform-ready)

## Vocabulary

**User-facing word for the GPU compute resource: studio.** Soft, accessible, vendor-neutral, no Latin academia in chat copy. Internally the code keeps **Materia** (Latin, brand-consistent with Modus / Hospitium / Actum / Anima / Modo); the user never sees that word. API resource path: `/api/v1/studios/*`.

## The point

Crystal has no public API. Telegram is the only consumer. The Mod•/Share•/Destroy/arm/status work is queued and naturally serves multiple platforms (web frontend, programmatic clients, eventual Discord lift). Building those surfaces as Telegram-only code now would force a rewrite later.

This sprint takes the **cheapest possible moment** — before any new bulletin UX code lands — to:

1. Do a small refactor that decouples `BulletinManager` from Telegram's `chatId` primitive.
2. Formalize `affordancesFor(podSession) → Affordance[]` so any renderer (Telegram inline keyboard, API JSON, future web component) can consume it.
3. Build the first public `/api/v1/*` surface mapping 1:1 to the UX carve.
4. Wire SSE on top of the existing bus for live state updates.

After this sprint, every new UX feature (Mod•, Share•, /arm wizard, /status renderer) lands on Telegram + API simultaneously with one implementation.

## What's in scope

### 1. Lift: PodSession registry keyed by studioId (Materia.id), not chatId

`BulletinManager` today: `chats = Map<chatId, {session, messageId, timers}>`. After lift: `sessions = Map<studioId, {session, timers}>`. The Telegram adapter holds its own `chatId ↔ studioId` map and the `messageId` it's editing in place. Other adapters (API, future Discord) do the same with their identifiers.

**Why this scope:** keeps PodSession + BulletinView untouched, doesn't introduce SurfaceRef yet (premature when only Telegram + JSON consumes it), and lets API endpoints look up sessions directly by `studioId`.

(Note: `PodSession` as a *type name* stays — it predates this naming pass and is internal-only. User-facing surfaces translate to "studio" in copy.)

### 2. `affordancesFor(podSession) → Affordance[]`

Extract from current `TelegramAllocutio` bulletin code. Canonical Affordance shape:

```ts
interface Affordance {
  id: string                         // 'mod', 'share', 'destroy', 'mod.add-lora', etc.
  label: string                      // 'Mod •'
  kind: 'action' | 'submenu' | 'noop'
  scope: 'owner' | 'guest' | 'any'   // for permission gating
  data?: Record<string, unknown>     // optional payload for the handler
  children?: Affordance[]            // for submenu-shaped affordances
}
```

Telegram adapter packs into `UiKeyboard`. API serializes verbatim as JSON. Future web/Discord adapters do the obvious thing.

### 3. API endpoints — `/api/v1/*` namespace

Map directly to the UX carve. All endpoints require auth (see §5).

```
POST   /api/v1/studios                    arm a studio; body = config (loadout, sharing); returns { studioId, state }
GET    /api/v1/studios/:id                bulletin state DTO + affordances[]
GET    /api/v1/studios/:id/stream         SSE: state-change events
POST   /api/v1/studios/:id/affordances/:affordanceId
                                          invoke an affordance (Mod•, Share•, Destroy submenu items)
DELETE /api/v1/studios/:id                shortcut: destroy {mode: 'now'|'drain'}

GET    /api/v1/me/status                  aggregated user state: balance + gens + studios + joinable
POST   /api/v1/generations                spawn a gen (programmatic /make); body = {modusId, aditus, studioId?}
GET    /api/v1/generations/:id            delivery state DTO
POST   /api/v1/generations/:id/cancel     cancel a queued/running gen (owner only)
POST   /api/v1/generations/:id/rerun      rerun (body may include tweaks)
```

All endpoints use canonical DTOs serialized straight from existing Crystal types (PodSession, Actum, Modo, etc.). No bespoke shapes; the API is a thin transport layer over the same state the bulletin renders.

### 4. SSE on top of `bus`

The existing `bus` emits `pod.parked`, `actum.stage`, etc. The SSE handler:

```ts
app.get('/api/v1/studios/:id/stream', auth, (req, res) => {
  res.writeHead(200, { 'content-type': 'text/event-stream', ... })
  const subscription = busSubscribe({ studioId: req.params.id }, (event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`)
  })
  req.on('close', () => subscription.unsubscribe())
})
```

(Bus event names like `pod.parked` keep their internal Latin/legacy names; the API surface translates as needed when serializing.)

Same pattern for `/api/v1/me/status/stream` (later, not v1 of this sprint).

### 5. Auth — bridge to legacy keystore (decision)

Two viable approaches:

| | bridge to legacy | crystal-native |
|---|---|---|
| **time** | ~half day | ~2 days |
| **shape** | crystal middleware verifies API key against legacy `apiKeys` collection in shared MongoDB | crystal grows its own key model + issuance endpoints |
| **trade-off** | one source of truth for keys; tight coupling to legacy schema | clean separation; can deprecate legacy later cleanly |
| **right when** | now, while legacy is still live | a year from now, when legacy is being retired |

**Recommend: bridge.** Crystal middleware reads the existing collection; if the legacy app deprecates the key model, we re-host without breaking external consumers.

### 6. OpenAPI spec doc

Hand-authored `docs/api/v1.openapi.yaml`. Consumers (web frontend, MCP, future SDKs) read it. Generated by editor, not by tooling — small enough to maintain manually for v1.

## What's OUT of scope

- **SurfaceRef discriminated union** — premature when only two renderers (Telegram inline, JSON). Revisit when Discord lift starts.
- **Webhook callbacks to API consumers** (push our events out to their endpoints) — defer; SSE covers the common live case.
- **Streaming for `/me/status`** — v1 is polling; SSE comes when we observe real polling pain.
- **GraphQL / batch endpoints** — start REST; add only if request volume forces it.
- **Rate limiting** — add a `express-rate-limit` floor in v1; sophisticated quota tied to plans/economy waits.
- **API key issuance UI/CLI** — bridge means legacy still owns issuance; crystal just verifies.
- **MCP rebuild on top of the new API** — separate sprint; the legacy app's MCP can keep working off legacy endpoints for now.
- **Discord adapter lift** — separate sprint; this work makes it cheap when it comes.
- **Renaming internal type/bus names from `pod` to `studio`** — internal Latin/legacy names stay; the studio rename is a USER-FACING vocabulary lock, not a code-wide rename.

## Sprint items

Estimates: a realistic 3–4 day budget assuming clean runs.

### Day 1 — lift refactor

1. [`~1h`] `BulletinManager`: switch internal map to `Map<studioId, {session, timers}>`. Telegram adapter inherits a `chatId ↔ studioId` map; the existing `messageId` tracking stays on the Telegram side.
2. [`~1h`] `affordancesFor()` extracted into `src/allocutio/lexicon/bulletin/affordances.ts`. Telegram adapter calls it, packs into `UiKeyboard`. Existing button behavior unchanged from the user's POV.
3. [`~30m`] Tests: `affordances.test.ts` (truth table per studio state — should be tiny since the single-shape constraint means few branches).
4. [`~1h`] `Affordance` DTO + JSON serializer in `src/lib/dto/`.

### Day 2 — auth bridge + first endpoints

5. [`~3h`] Auth middleware: verify `X-Api-Key` header against legacy `apiKeys` collection in shared MongoDB. Tests with valid/invalid/missing key.
6. [`~2h`] `GET /api/v1/studios/:id` + `GET /api/v1/generations/:id` (simplest reads — serialize PodSession and Actum to DTOs).
7. [`~1h`] `GET /api/v1/me/status` (aggregate read).

### Day 3 — write endpoints + SSE

8. [`~2h`] `POST /api/v1/studios` (the /arm equivalent) — body schema = `Mod` + `Share` config; calls into existing ExecuteFlow with `provisioningContext`. Returns `{studioId, state}`.
9. [`~2h`] `POST /api/v1/studios/:id/affordances/:affordanceId` — dispatcher into Mod/Share/Destroy handlers. Same handlers used by Telegram callback path (lift them out of `TelegramAllocutio` into platform-neutral functions during this work).
10. [`~2h`] `POST /api/v1/generations` (programmatic /make) + `POST /api/v1/generations/:id/cancel` + `POST /api/v1/generations/:id/rerun`.
11. [`~2h`] SSE: `GET /api/v1/studios/:id/stream` (subscribe to `bus` events filtered by studioId; write them out as SSE).

### Day 4 — tests + spec doc

12. [`~3h`] Integration tests: each endpoint with real Express + Ring + in-memory stores. SSE test using `eventsource` client lib.
13. [`~2h`] `docs/api/v1.openapi.yaml` — hand-authored, all 10 endpoints + DTO schemas.
14. [`~1h`] Memo update + commit hygiene.

## Architectural seams (where the new code lands)

```
src/api/v1/                          ← NEW
  index.ts                           — createV1Router(deps)
  auth.ts                            — verifyApiKey middleware (legacy bridge)
  studios.ts                         — studio endpoints + SSE handler
  generations.ts                     — gen endpoints
  status.ts                          — /me/status aggregator
  dto/                               — canonical serializers
    StudioStateDto.ts                — PodSession → JSON
    AffordanceDto.ts                 — Affordance → JSON
    StatusStateDto.ts                — aggregate user state → JSON
    GenerationDto.ts                 — Actum → JSON

src/allocutio/lexicon/bulletin/
  BulletinManager.ts                 — REFACTORED: keyed by studioId
  affordances.ts                     — NEW: affordancesFor(session) → Affordance[]

src/allocutio/telegram/
  TelegramAllocutio.ts               — REFACTORED: maintains chatId↔studioId map, calls affordancesFor() then packs

src/index.ts                         — adds: app.use('/api/v1', createV1Router({...ring, ...}))
```

## Discipline that keeps this sprint from sprawling

- **No new state machine.** PodSession stays as-is; the API serializes it.
- **No new flow logic.** API write handlers delegate to ExecuteFlow / existing services. They are transport adapters, not business logic.
- **One DTO per resource.** Resist the urge to add filtering/field-selection in v1.
- **JSON only.** No GraphQL, no batch, no binary protocols.
- **SSE only for liveness.** No WebSocket bidirectional. SSE is one-way server→client, which is what bulletin updates are.
- **Keep `/api/v1/*` strict.** Internal endpoints stay at `/internal/*`; webhook endpoints stay at `/webhooks/*`. The `/api/v1/*` namespace is the contract.

## After this sprint

The "bulletin UX surfaces" sprint (Mod•/Share•/Destroy/arm/status implementation) can start. Each new surface lands as:
- Handler logic in `lexicon/` (platform-neutral)
- Telegram adapter delegates the existing way
- API endpoint surfaces it automatically (because `affordances.ts` returns the new affordances; serialization is unchanged)
- Future Discord/web adapters get it for free when they're built

That's the multiplier this sprint exists to unlock.
