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

## The 19 Primitives — What Each Replaces

```
CRYSTAL PRIMITIVE      REPLACES (JS)                        NEW CAPABILITY
──────────────────────────────────────────────────────────────────────────
TIER 1 — CORE (identified side)
  Anima                userCore + UserService               soul persists across platforms
  Persona              platformUsers + find-or-create       platform mask per anima
  Signum               creditLedger + userEconomy           privacy partition, lock/settle/ZK

TIER 1 — CORE (anonymous side)
  Modo                 runpodSessions + SessionManager      sticky GPU session + volume mount
  Actum                generationOutputs + GenerationService immutable execution ledger
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

TIER 2 — SECONDARY
  Catena               CreditVault/deposits (partial)       onchain layer: ETH, x402, NFT proofs
  Allocutio            Telegram/Discord handlers            platform adapter + iframe embed
```

---

## Inventory: What Exists Today

### Types — COMPLETE (21 primitives + additions)

All 19 original primitives in `src/types/`, plus two additions made to support
the NFT fleet client feature:

- `Tabula` — added `templateId?: string`, `followTemplate?: boolean`,
  and `Tabularum.listDerived()` for workspace fleet propagation
- `Catena` — added `Testimonium` type + `Testimoniorum` store interface
  for NFT ownership attestation

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

### Phase 1 — Execution Rail (1 week)

**Goal:** Crystal writes its first real records. `MongoActorum` + `RunPodCursor`
wired into a skeleton `container.ts`. `ActumCompletor` handles RunPod completions.

**Deliverables:**

`src/crystal/MongoActorum.ts`
- Collection: `noemaplane.acta`
- Indexes: `{ id: 1 }` unique, `{ status: 1, expirat: 1 }`
- `bigint` ↔ `Decimal128` on read/write

`src/crystal/RunPodCursor.ts`
- Implements `Cursor` — wraps existing JS `GenerationRunner`
- `reserve()` → `GPUScheduler.estimateCost()`
- `run()` → dispatches to `GenerationRunner`, returns `Exitus`

`src/container.ts` (skeleton)
- `MongoActorum` + `MemorySignorum` + `MemoryModorum`
- `Cursorum` with `RunPodCursor` registered
- `ActumCompletor` wired with these deps
- Exported as `container` singleton

Wire `ActumCompletor` into `GenerationRunner.onComplete()` / `onFail()`.
The JS `GenerationService` path stays in place on `main` — we're running
alongside it in staging, not replacing it.

---

### Phase 2 — Modus Registry (1 week)

**Goal:** `noemaplane.modi` is the authoritative tool and spell registry.
ChainEngine Phase 2 (`noemaplane.toolVersions`) and crystal Phase 2 are the
same work under two names — `MongoModorum` is the implementation of both.

**Deliverables:**

`src/crystal/MongoModorum.ts`
- Collection: `noemaplane.modi`
- `(id, versio)` unique index; `register()` is idempotent on contentHash
- `find()` without `versio` returns highest semver

Seed `noemaplane.modi` by registering `runmake` and canonical spells on startup.
`Compiler.compile()` in the ring resolves the Modus from `MongoModorum` before
compiling — locking version and contentHash into every Actum.

---

### Phase 3 — Ledger and Identity (2 weeks)

**Goal:** `MongoSignorum`, `MongoAnima`, `MongoPersona` live in staging.
The privacy partition is enforced at the database level for the first time.

**Deliverables:**

`src/crystal/MongoSignorum.ts`
- Collection: `noemaplane.signa` — append-only, no update path
- `lock/release/settle` are atomic `findOneAndUpdate` status transitions
- `settle()` uses a MongoDB session transaction: spend locked + issue refund
- `balance()` is a `$sum` aggregation
- `issue()` enforces privacy invariant: rejects `forma: arcanum` with `animaId`

`src/crystal/MongoAnima.ts`
- Collection: `noemaplane.animae`

`src/crystal/MongoPersona.ts`
- Collection: `noemaplane.personae`
- `findOrCreate(platform, platformId)` — the crystal's find-or-create

Seed staging with test animae mapped from a sample of `noema.users`.
No production migration yet — staging data can be synthetic.

---

### Phase 4 — Vestigium / RAG (1 week)

**Goal:** Every completed actum in staging produces a Vestigium. RAG search
endpoint is live and queryable.

**Deliverables:**

`src/crystal/MongoVestigiorum.ts`
- Collection: `noemaplane.vestigia`
- Atlas Vector Search on `embedding` (or local Qdrant for staging — swappable)

`src/execution/hooks/vestigiumHook.ts`
- Nexus `execution_spend` handler → `vestigiorum.create()` + async `index()`

`POST /api/v1/rag/search` — `VestigiumQuery` → `VestigiumResult[]`
`POST /api/v1/rag/rate` — community impression
`PUT /api/v1/rag/:id/impressio` — author impression

---

### Phase 5 — Modo / Sessions (1–2 weeks)

**Goal:** `Modo` is the crystal's session primitive. The JS `SessionManager`
is the first backend — `RunPodCursor` already speaks to it. This phase types
it correctly and issues tessera signa as session credentials.

**Deliverables:**

`src/crystal/MongoModo.ts`
- Collection: `noemaplane.modos`
- Tracks: pod ref, volume mount ref, tessera signum id, active acta, status

`src/crystal/TesseraCursor.ts`
- On Modo open: issues a `tessera` Signum with session budget, locked to `modoId`
- Acts as the bearer credential for all actum spend within the session

Nexus hook: `modo_open` event → issue tessera → bind to Modo.

---

### Phase 6 — Full Ring (1–2 weeks)

**Goal:** All remaining primitives have Mongo implementations. Composition
root is complete. Ring is authoritative for all staging writes.

**Remaining implementations:**

| File | Collection |
|------|-----------|
| `MongoMandatum` | `noemaplane.mandatores` |
| `MongoCorpus` | `noemaplane.corpora` |
| `MongoCollectio` | `noemaplane.collectiones` |
| `MongoTabula` | `noemaplane.tabulae` |
| `MongoTestimoniorum` | `noemaplane.testimonia` |
| `MongoDepositum + MongoSolutio + MongoPetitio` | `noemaplane.deposita` etc. |

`src/container.ts` — full composition root, all stores wired.

```typescript
export interface Container {
  acta: Actorum
  modorum: Modorum
  signorum: Signorum
  animae: AnimaStore        // find, create, findByCustos
  personae: PersonaStore    // findOrCreate
  vestigiorum: Vestigiorum
  mandatores: Mandatorum
  collectiones: Collectionum
  tabulae: Tabularum
  testimonia: Testimoniorum
  cursorum: Cursorum
  completor: ActumCompletor
  inceptor: ActumInceptor
  nexus: Nexus
}
```

---

### Phase 7 — Wire Platform Handlers to Ring (ongoing)

In staging, platform handlers (Telegram, Discord, iframe) begin calling
the crystal ring directly rather than the JS service layer. This is where
staging diverges meaningfully from `main`. Each handler migrated is a
verification that the ring's API is complete and ergonomic.

JS service retirement (deleting `GenerationService`, `EconomyService`, etc.)
happens after ring promotion to production — not in staging.

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

| Phase | Description | Staging estimate |
|-------|-------------|-----------------|
| 0 | Types + memory implementations | ✅ Done |
| 1 | Execution rail (MongoActorum + RunPodCursor) | 1 week |
| 2 | Modus registry (MongoModorum) | 1 week |
| 3 | Ledger + identity (MongoSignorum + MongoAnima) | 2 weeks |
| 4 | Vestigium / RAG | 1 week |
| 5 | Sessions / Modo + tessera | 1–2 weeks |
| 6 | Full ring + composition root | 1–2 weeks |
| 7 | Wire platform handlers to ring | ongoing |

**Total to full ring in staging: ~8–9 weeks (~2 months).**

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
