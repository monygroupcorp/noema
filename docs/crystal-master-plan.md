# Crystal Master Plan
## The TypeScript Rewrite That Makes This System Its Most Perfect Form

**Date:** 2026-05-11
**Status:** Canonical. All crystal work executes inside this frame.
**Branch:** Stage branch — break things freely, no production caution.
**Production:** JS codebase on `main` is untouched. Client runs unaffected.
**Vision ceiling:** `docs/plans/2026-05-06-stationthis-launchpad-vision.md`

---

## What The Crystal Is

The crystal is not a refactor. It is the ground-up TypeScript service layer that
replaces the JavaScript domain services with a type-safe, privacy-partitioned,
append-only, vendor-portable ring architecture.

Three things make it the saving grace:

**Security.** The privacy partition is a first-class schema invariant — not a
convention, not a comment, not a flag. Anonymous operations (`arcanumHash`) and
identified operations (`animaId`) are different code paths that cannot be confused.
The ledger is append-only: `Signorum` has no `update()`. The ZK spend proof
(`nullifier`) is the only bridge across the partition, and it can only cross once.

**Optimization.** The ring is in-process function calls. No HTTP hop, no
serialization, no `X-Internal-Client-Key` theater. The JS service-layer migration
(`docs/plans/service-layer-migration.md`) spent nine phases removing network hops
from in-process callers. The crystal makes it structurally impossible to add them
back: there is no internal HTTP API to call.

**Expansion.** Four entirely new capabilities become possible:

- **Vestigium / RAG** — semantic search over every generation a user has ever run
- **Modo / Sessions** — sticky GPU sessions with persistent memory volumes and a
  personal agent who knows the user's soul
- **Mandatum / Agents** — standing autonomous instructions that fire on schedule
  or event, owning their own spend budget
- **Catena / Onchain** — first-class ETH/x402 + NFT ownership integration,
  not bolted on as an afterthought

---

## The 23 Primitives — What Each Replaces

```
CRYSTAL PRIMITIVE      REPLACES (JS)                        NEW CAPABILITY
──────────────────────────────────────────────────────────────────────────
TIER 1 — CORE (identified side)
  Anima                userCore + UserService               soul persists across platforms
  Persona              platformUsers + find-or-create       platform mask per anima
  Signum               creditLedger + userEconomy           privacy partition, lock/settle/ZK
  Memoria              (new)                                long-term distilled agent memory;
                                                            what Anima.memoriaRef points to.
                                                            Rebuilt periodically from Colloquia.

TIER 1 — CORE (anonymous side)
  Modo                 runpodSessions + SessionManager      sticky GPU session + volume mount
  Actum                generationOutputs + GenerationService immutable execution ledger
                                                            + dictumId (origin conversation turn)
  Materia              RunPodPodService (partial)           compute substrate with attestation
  Modus                noema.tools + spellsDb + SpellService version-locked fractal tool
  Essendi              tool categories / expression types   atomic expression catalog
  Intelligendi         model metadata                       model substrate type

TIER 1 — EXTENDED
  Corpus               datasets + DatasetService            training dataset assembly
  Collectio            noema.cooks + BatchOrchestrator      batch container
  Mandatum             (new — partial in CookOrchestrator)  standing agent instructions
  Tabula               canvas / FocusDemo (web)             authoring workspace + fleet templates
  Vestigium            (entirely new)                       RAG: indexed trace of every output
  Colloquium           (new)                                conversation thread — identified only.
                                                            Persists across Modos and sessions.
                                                            Optional tabulaId + modoId binding.
  Dictum               (new)                                one turn in a Colloquium.
                                                            genus: user | agent | systema.
                                                            actumId links to spawned execution.
                                                            Mandatum agents may own Colloquia.

TIER 2 — SECONDARY
  Catena               CreditVault/deposits (partial)       onchain layer: ETH, x402, NFT proofs
  Allocutio            Telegram/Discord handlers            platform adapter + iframe embed
                                                            + WebChatAllocutio (mobile primary)

TIER 3 — SOCIAL
  Scholium             (new)                                tagged community annotation on Modus
                                                            or Modos. tag: bug|fix|fork|tip|correct.
                                                            resoluta? marks resolution. Powers
                                                            quality signals in community catalog.
```

---

## Inventory: What Exists Today

### Types — COMPLETE (21 primitives + additions); 3 new types pending

All 19 original primitives in `src/types/`, plus additions:

- `Tabula` — added `templateId?: string`, `followTemplate?: boolean`,
  and `Tabularum.listDerived()` for workspace fleet propagation
- `Catena` — added `Testimonium` type + `Testimoniorum` store interface
  for NFT ownership attestation

**Pending additions (Phase 8):**
- `src/types/colloquium.ts` — `Colloquium`, `Dictum`, `ColloquiumStore`, `DictumStore`
- `src/types/anima.ts` — `Memoria` type body (Anima.memoriaRef already exists as pointer)
- `src/types/cursus.ts` — `Actum.dictumId?: string` (origin conversation turn)

### Memory implementations — COMPLETE for execution rail

| File | Status |
|------|--------|
| `src/execution/MemoryActorum.ts` | ✅ Done |
| `src/execution/MemoryModorum.ts` | ✅ Done |
| `src/execution/MemorySignorum.ts` | ✅ Done |
| `src/execution/ActumCompletor.ts` | ✅ Done — complete + fail with settle/release |
| `src/execution/ActumInceptor.ts` | ✅ Done |
| `src/execution/Cursorum.ts` | ✅ Done |
| `src/execution/Nexus.ts` | ✅ Done |
| `src/execution/hooks/` | ✅ Done |
| `src/rag/MemoryVestigiorum.ts` | ✅ Done — 27 tests passing |

### Not yet built
- All Mongo implementations (`src/crystal/Mongo*.ts`)
- Composition root (`src/container.ts`)
- Crystal API routes
- `RunPodCursor` (bridge to JS `GenerationRunner`)

---

## The Ring Architecture

```
┌─ EXTERNAL BOUNDARY ───────────────────────────────────────────────────────┐
│  Express routes  /api/v1/...       Telegram handler    Discord handler    │
│  Iframe embed (Allocutio)                                                  │
│  (thin — validate, call ring, serialize response)                         │
└────────────────────────────┬──────────────────────────────────────────────┘
                             │ in-process function calls (no HTTP)
┌─ CRYSTAL RING ─────────────▼──────────────────────────────────────────────┐
│                                                                            │
│  ActumInceptor   →  Cursorum  →  Cursor.reserve()                         │
│  Signorum.lock() →  Actum{ nascens }  →  Cursor.run()                     │
│  ActumCompletor  →  Signorum.settle() →  Nexus.emit()                     │
│                     └→ Vestigiorum.create() (hook)                        │
│                     └→ Collectio / Mandatum hooks                         │
│                                                                            │
│  Stores: Actorum  Modorum  Signorum  Animarum  Vestigiorum  Mandatorum    │
│          Tabularum  Testimoniorum  Catenarum  Corporum  Collectionum      │
│                                                                            │
└────────────────────────────┬──────────────────────────────────────────────┘
                             │ MongoDB driver (no ORM)
┌─ DATA LAYER ───────────────▼──────────────────────────────────────────────┐
│  noemaplane.acta          noemaplane.modi           noemaplane.signa       │
│  noemaplane.animae        noemaplane.personae       noemaplane.modos       │
│  noemaplane.vestigia      noemaplane.mandatores     noemaplane.tabulae     │
│  noemaplane.collectiones  noemaplane.corpora        noemaplane.testimonia  │
│  noemaplane.deposita      noemaplane.solutiones     noemaplane.petitiones  │
└───────────────────────────────────────────────────────────────────────────┘
```

**Collection naming rule:** `noemaplane.<genitive plural>` — always.
`noema.*` collections (production JS) are left entirely alone. We write only
to `noemaplane.*`. No parity checks, no shadow windows, no migration scripts
until we are ready to promote staging to production.

---

## Staging Posture

This is a stage branch. The rules are different here:

- **Wire directly.** No feature flags, no parallel-write windows, no rollback
  ceremony. `container.ts` is authoritative from day one. If something breaks,
  fix it.
- **`noema.*` is read-only by neglect.** We don't write to legacy collections.
  We don't maintain parity. Production runs on `main` unaffected.
- **Break things willingly.** The staging environment exists precisely so we
  can move fast. Integration errors are expected and cheap. Find them early.
- **Test at the seams.** Each Mongo implementation gets a test suite that runs
  against a real local/staging MongoDB — not mocks. Memory implementations
  already proved the logic; Mongo implementations prove the persistence.

---

## Phases

### Phase 0 — Foundations ✅ DONE

Types, memory implementations, execution rail choreography.
Ring works end-to-end in memory. Architecture is proven.

---

### Phase 1 — Execution Rail ✅ DONE

**Goal:** Crystal writes its first real records. `MongoActorum` + `RunPodCursor`
wired into a skeleton `container.ts`. `ActumCompletor` handles RunPod completions.

Delivered: `MongoActorum`, `RunPodCursor`, `SecurePodClient`, `Praefectus`,
`WarmPodClient`, `ActumInceptor`, `ActumCompletor`, `SimpleCursorum`, full
`container.ts` Ring with all 24 Mongo implementations. `RunPodCursor` is
standalone — does not wrap `GenerationRunner`. Compiler pipeline and
`WorkflowTemplateRegistry` also land here.

---

### Phase 2 — Modus Registry ✅ DONE

**Goal:** `noemaplane.modi` is the authoritative tool and spell registry.

Delivered: `MongoModorum` with semver resolution + idempotent `register()`.
`CANONICAL_MODI` seeded on startup. `MongoIntella` (`Intellarum`) wired into
`Compiler` — model download URLs resolved from registry with template fallback.
`CANONICAL_INTELLAE` (4 FLUX Schnell models) seeded on startup.

---

### Phase 3 — Ledger and Identity ✅ DONE

**Goal:** `MongoSignorum`, `MongoAnima`, `MongoPersona` live in staging.
The privacy partition is enforced at the database level for the first time.

Delivered: `MongoSignorum` (append-only, atomic lock/settle/refund, privacy
invariant on `issue()`), `MongoAnima` (multi-Persona, activeAnimaId, linkAnima,
switchAnima), `MongoPersona` (findOrCreate). All 6 ledger hooks wired to Nexus.
`TelegramIdentityResolver` wired in `index.ts`.

---

### Phase 4 — Vestigium / RAG ✅ DONE (store only)

**Goal:** Every completed actum in staging produces a Vestigium.

Delivered: `MongoVestigiorum` with Atlas Vector Search on `embedding`.
`vestigiumHook` wired to Nexus `execution_spend`. REST search/rate endpoints
are **not yet built** — store and hook are in place, API surface deferred.

---

### Phase 5 — Modo / Sessions ✅ DONE

**Goal:** `Modo` is the crystal's session primitive — sticky GPU sessions with
tessera signa as session credentials.

Delivered: `MongoModo`, `TesseraCursor` (routes session-scoped jobs through
an open Modo, issues tessera Signum). `DeploymentumStore` also lands here —
`RunPodCursor` content-addresses each compiled spec and stamps `Actum.deploymentHash`.

---

### Phase 6 — Full Ring ✅ DONE

**Goal:** All remaining primitives have Mongo implementations. Composition
root is complete. Ring is authoritative for all staging writes.

Delivered: All 24 Mongo implementations (see handoff doc for full table).
`src/container.ts` (`createContainer`) wires the full Ring. `Ring` interface
exported — all stores accessible via a single in-process object. 835 tests
passing.

---

### Phase 7 — Wire Platform Handlers to Ring ✅ DONE (Telegram); Discord pending

In staging, platform handlers begin calling the crystal ring directly.

**Telegram — DONE:** `TelegramAllocutio` + `FlowRouter` + `ExecuteFlow` +
`MongoFlowContextStore` + `webhookRouter`. Full end-to-end: Telegram message
→ identity resolution → flow dispatch → `ActumInceptor` → RunPod → webhook
→ reply. `index.ts` boots the full stack.

**Discord — NOT DONE:** No `DiscordAllocutio` exists. Discord users still
route through the legacy JS platform. Mirror of `TelegramAllocutio` — ~1 day.

**Web / iframe — NOT DONE:** No crystal API routes for tools, spells, users,
collections. The Vite/Vue frontend is untouched.

JS service retirement (deleting `GenerationService`, etc.) happens after ring
is promoted to production — not yet.

---

### Phase 9 — Social Layer

**Goal:** Community annotation and favorites on Modus/Modos. Powers the
Models and Flows catalog pages — quality signals, bug reporting, community
improvement. See `docs/models-flows-design.md` for full UX spec.

**Deliverables:**

`src/types/scholium.ts`
- `Scholium` — tagged annotation. Fields: id, animaId, targetType
  ('modus' | 'modos'), targetId, corpus, tag ('bug'|'fix'|'fork'|'tip'|'correct'),
  natum, resoluta?: Date
- `Scholiorum` — store interface: create, listByTarget, resolve, findById

`src/crystal/MongoScholium.ts`
- Collection: `noemaplane.scholia`
- Indexes: `{ targetType, targetId }`, `{ animaId }`, `{ resoluta: 1 }` sparse

**Favorites** — embedded on Modus/Modos as `stellae: number` count.
Separate collection only if "who starred" queries are needed for notifications.
Start embedded, promote if needed.

`src/container.ts`
- Add `scholia: ScholiOrum` to Ring interface + createContainer() wiring.

---

### Phase 10 — Training as a Flow

**Goal:** Training is not a separate pipeline. It is a Flow with transformation
type `corpus → modos` (dataset → LoRA), running through the same RunPodCursor
that handles inference. The entire JS training pipeline is retired. VastAI
is retired. RunPod is the sole compute provider for both inference and training.

**The insight:** Training is rented compute + a task + a stored output.
So is generation. The execution rail already handles this shape. The only
difference is what compile() produces and what ActumCompletor writes on
completion.

`compile()` is not a ComfyUI compiler — it is a job spec compiler. The
output type depends on the Modus genus:

```
inference Modus  →  compile()  →  ComfyUI workflow JSON   →  RunPod serverless
training Modus   →  compile()  →  AI-Toolkit config YAML  →  RunPod training
```

The training recipes (FLUX, SDXL, KONTEXT, WAN) are AI-Toolkit config
generators. That is all they are. They become the compile() implementation
for training Moduses — not separate service classes. Recipe variation is
aditus configuration, not code branching.

**Deliverables:**

Training Modus type
- A Modus with `genus: 'training'` and ports: `corpus` (dataset input),
  `modos` (LoRA output). Recipe parameters are aditus fields.

`compile()` for training Moduses
- Accepts training Modus + aditus (recipe params + dataset ref)
- Produces an AI-Toolkit config YAML — the canonical training job spec
- Dataset prep (validate, pack, upload) is a pre-compilation step before
  the Actum is created; not part of the Actum lifecycle itself

`ActumCompletor` — training variant
- On completion of a training Actum: writes a new Modos document to the ring
  (the trained LoRA metadata + storage ref)
- Same completor, different Exitus handler branch keyed on `modus.genus`

**Deployment hash storage (deferred to this phase):**
ChainEngine specifies storing the fully-resolved compiled deployment by
`sha256(canonicalize(spec))` for warm-pool affinity routing and first-discoverer
provenance. Crystal currently computes deployments transiently — `compile()`
produces the spec, the cursor consumes it, nothing is persisted. `Modus.contentHash`
hashes the template, not the resolved execution artifact.
For Phase 10 / training: evaluate whether `noemaplane.deployments` (the
content-addressed compiled artifact store from the ChainEngine spec) should be
added as a ring primitive. Warm-pool affinity and "first discoverer" royalty
mechanics require it. Can be deferred past Phase 10 if session affinity routing
is handled by other means.

**JS retirement triggered by this phase:**
- `src/core/services/training/` (10+ files) — entire training pipeline deleted
- `src/core/services/vastai/` (13 files) — VastAI retired entirely;
  RunPod handles both inference and training
- `src/core/services/comfydeploy/` (12 files) — RunPod is the sole
  execution backend; ComfyDeploy retired

---

### Phase 8 — Conversation Primitives

**Goal:** Chat is first-class in the ring. Colloquium, Dictum, and Memoria
are not bolted onto the platform layer — they are ring primitives with
full Mongo implementations, store interfaces, and container wiring.

**Why now:** The product's primary mobile entry point is a chat interface
(WebChatAllocutio). The personal agent (concierge) requires persistent
conversation memory across sessions. Without these primitives in the ring,
chat is a second-class citizen with no path to the privacy partition,
the ledger, or the RAG layer.

**Deliverables:**

`src/types/colloquium.ts`
- `Colloquium` — conversation thread. Fields: id, animaId, natum, mutatum,
  status ('active' | 'archived'), tabulaId?, modoId?, titulus?
- `Dictum` — one turn. Fields: id, colloquiumId, natum, genus
  ('user' | 'agent' | 'systema'), corpus (text), actumId?, signaIds[]
- `ColloquiumStore`, `DictumStore` — store interfaces

`src/types/anima.ts`
- `Memoria` type body — summarium, affines, praeferentia, natum, mutatum.
  Anima.memoriaRef already points here; this is the type behind the pointer.

`src/types/cursus.ts`
- `Actum` — add `dictumId?: string`. Origin conversation turn. Optional —
  Acta spawned outside a conversation (canvas, API, Mandatum) leave it unset.

`src/crystal/MongoColloquium.ts`
- Collection: `noemaplane.colloquia`
- create, find, findByAnima, update, archive

`src/crystal/MongoDictum.ts`
- Collection: `noemaplane.dicta`
- create, listByColloquium, findById, update

`src/crystal/MongoMemoria.ts`
- Collection: `noemaplane.memoriae`
- upsert (one per animaId), findByAnima

`src/container.ts`
- Add: `colloquia: ColloquiumStore`, `dicta: DictumStore`,
  `memoriae: MemoriaStore` to Ring interface + createContainer() wiring.

**Privacy:** Colloquium, Dictum, Memoria are identified-side only.
animaId is required on all three. No anonymous conversation persistence.
Anonymous sessions (arcanum/tessera) get ephemeral execution but no chat history.

---

## JS Retirement Map

Each crystal phase has a corresponding JS deletion. The JS codebase shrinks
as the ring goes live — not after, not in a separate cleanup sprint. Wire it,
delete it, move on.

### Delete immediately (dead code, no dependencies)
```
src/core/services/olddb.legacy.js          155 lines — explicitly abandoned
src/core/services/oldworkflows.js         1685 lines — deprecated workflow defs
src/api/internal/teams/                          — deprecated, marked in code
src/api/external/teams/                          — deprecated, marked in code
src/api/external/v1/admin/                       — v1 superseded by v2
```

### Delete at Phase 7 (ring wired to platform handlers)

These are superseded by crystal primitives. Once handlers call the ring
directly, these files have no callers.

```
src/core/services/db/           33 files  — replaced by MongoActorum et al.
src/core/services/store/         9 files  — wrapped by crystal stores
src/core/services/SpellsService.js        — Modus
src/core/services/WorkflowExecutionService.js — crystal execution rail
src/core/services/generationExecutionService.js — RunPodCursor
src/core/services/cook/          7 files  — dissolves into canvas Value node
src/core/services/expression/    1 file   — dissolves into canvas Transform node
src/core/services/batch/                  — dissolves into Value node fan-out
```

Approximate deletion: ~55 files, ~8,000–12,000 lines.

### Delete at Phase 10 (training as a Flow, RunPod-only)

```
src/core/services/training/     10+ files — replaced by training Modus + compile()
src/core/services/vastai/       13 files  — RunPod replaces VastAI entirely
src/core/services/comfydeploy/  12 files  — RunPod is the sole execution backend
```

Approximate additional deletion: ~35 files, ~5,000–8,000 lines.

### Migrate to TypeScript (not deleted — platform-critical infrastructure)

These have no crystal equivalent yet and run real production traffic.
They migrate rather than disappear.

```
src/platforms/telegram/         platform adapter → TS (Phase 7)
src/platforms/discord/          platform adapter → TS (Phase 7)
src/platforms/web/              web server + middleware → TS (Phase 7)
src/core/services/alchemy/      blockchain/wallet/credit → TS
src/core/services/media.js      media handling → TS
src/core/services/storageService.js S3 abstraction → TS
src/core/services/charging/     point consumption → TS
src/core/services/pricing/      cost calculation → TS
src/core/services/notifications/ dispatch layer → TS
src/core/services/apiKeyService.js → TS
src/core/services/websocket/    → TS
src/api/                        entire API layer becomes Allocutio in TS
```

### Net result

By Phase 10: ~90+ JS files deleted outright, ~150–180 files migrated to TS.
The JS codebase as it exists today ceases to exist. What remains is either
in the crystal ring, in typed platform adapters, or in the Allocutio API layer.

---

## NFT Fleet Pattern (Client Feature)

The admin workspace fleet pattern — master Tabula → N derived agent Tabulae
with NFT metadata bindings, treasury-funded via scheduled Mandatum — is
natively expressible in the crystal. No special-casing required.

```
Admin Anima
  └── master Tabula (templateId = null, published Modus)
       └── N derived Tabulae (templateId → master, followTemplate: true)
            each with nodi[].aditus = agent's NFT metadata

Animarum (the fleet)
  └── agent Anima[] (each linked to one Persona via Testimonium)
       each funded by: treasury Mandatum (triggerGenus: 'schedula')
                       → issues tessera Signum per agent
       each auth'd by: Testimonium (NFT ownership confirmed on-chain)
```

Fleet propagation: when admin publishes new master Modus →
`tabularum.listDerived(masterTabulaId)` → re-apply each agent's `nodi[].aditus`
overrides onto the new structure → auto-publish derived Modus per agent.

---

## How Crystal and ChainEngine Relate

Parallel tracks. `RunPodCursor` is the bridge — it wraps `GenerationRunner`
(JS, stays) and implements the crystal `Cursor` interface.

```
ChainEngine (JS):                          Crystal Ring (TS):
  Compiler.compile()                         Cursorum.resolve(modus)
    → Deployment (hash)                        → RunPodCursor
  RunPodAdapter.startJob()                         .run(actum)
    → GenerationRunner ──────────────────────────→ Exitus
                                             ActumCompletor
                                               .complete(actum, exitus)
```

ChainEngine Phase 2 (`noemaplane.toolVersions`) = Crystal Phase 2
(`MongoModorum`). Same collection, same work, different names in each spec.

---

## Timeline

| Phase | Description | Status |
|-------|-------------|--------|
| 0 | Types + memory implementations | ✅ Done |
| 1 | Execution rail (MongoActorum + RunPodCursor) | ✅ Done |
| 2 | Modus registry (MongoModorum) | ✅ Done |
| 3 | Ledger + identity (MongoSignorum + MongoAnima) | ✅ Done |
| 4 | Vestigium / RAG | ✅ Done |
| 5 | Sessions / Modo + tessera | ✅ Done |
| 6 | Full ring + composition root | ✅ Done |
| 7 | Wire platform handlers to ring | ongoing |
| 8 | Conversation primitives (Colloquium + Dictum + Memoria) | ✅ Done |
| 9 | Social layer (Scholium + favorites) | ✅ Done |
| 10 | Training as a Flow — RunPod-only, VastAI + ComfyDeploy retired | 2 weeks |

No parallel-write windows. No shadow comparison. No rollback flags.
Wire it, test it, move on.

---

## What This Makes Possible

**Fully anonymous paid sessions.** Arcanum signum → open Modo → run generations
→ arcanum settled. Platform never knows who the user is. New revenue stream,
structurally impossible in the JS codebase.

**NFT-gated agent fleets.** Testimonium proves NFT ownership → tessera issued
→ agent casts through fleet's master Modus with their NFT metadata as inputs.
Admin updates master → all derived workspaces propagate.

**Mandatum agents.** Standing instruction, owns tessera budget, fires on cron
or event. "Every morning at 9am, run this modus with yesterday's journal entry."
No button pressed. Requires Modo + Vestigium + Mandatum (Phases 4–6).

**Personal RAG at cast time.** Inject similar vestigia as context into aditus
automatically. `auctorImpressio: ['amor']` selects only loved outputs. Requires
Vestigium (Phase 4).

**Host/guest pod economy.** Host earns 10-point cut per guest run. Guest
cost-recovery is platform margin. Flows through `Signorum.settle()` with reward
split in the settlement logic. Requires Modo + full Signorum rail (Phases 3–5).

---

## The Launchpad Vision Mapping

| Vision concept | Crystal primitive | Phase |
|----------------|------------------|-------|
| Personal agent who knows your stuff | Anima.memoriaRef + Vestigiorum | 4–5 |
| Warm GPU pod within 60 seconds | Modo + RunPodCursor | 5 |
| Fractal Tools as agent verbs | Modus + Cursorum + Compiler | 2 |
| Host/guest pod economy | Modo + Signorum (reward forma) | 5–6 |
| Soul-level tool affinities | Anima.affines | 3 |
| ZK anonymous sessions | Signum (arcanum/tessera) + Modo | 3–5 |
| NFT fleet / admin workspace | Tabula.templateId + Testimonium | 6 |
| Spell royalties (tier-decayed) | Signorum (reward) + Nexus hooks | 6 |
| Model royalties (equal-split) | Signorum (reward) + Corpus | 6 |
| Platform margin on royalties | Signorum (settle logic) | 6 |
| Onchain deposits (ETH, x402) | Catena + Signum (eth/x402 forma) | 6 |
| Community extensibility | Modus.canonica = false | 2 |
| Iframe embed / cross-site access | Allocutio (IframeAllocutio) | 7 |

---

*This document is the master plan. Update it when phases complete or scope*
*changes. Do not let it drift from the actual state of `src/types/`,*
*`src/execution/`, and `src/crystal/`.*
