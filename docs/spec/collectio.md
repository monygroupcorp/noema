# Collectio — spec

**Status:** scoping (2026-06-19). The canonical spec for the collection / batch-generation feature.
Build against this. Naming rule: **`Collectio` is the only backend term** (Latin, internal — never
surfaced to users); the colloquial "cook" is **purged from code** (→ `GenFlags`); user-facing labels
("Collections"/"Drops"/"Editions") are a frontend concern; **`mint` is reserved for the on-chain step
(Catena)**, never for generation.

## 1. What it is

A **general combinatorial-expansion primitive**:

> **one Modus × a `Tractus[]` parameter grid → N Acta.**

NFT collections are the *design driver*, NOT the definition. The lean core also serves:
- **Variation testing** — sweep prompts/seeds/params, compare outputs.
- **Grid / parameter search** — explore a flow's space systematically.
- **Procedural / programmatic generation** — an agent or larger workflow fires a Collectio over a
  bounded grid as one well-scoped sub-step (API/MCP-driven, not UI-only).
- **NFT collection** — the same thing + rarity + dedup + attribute manifest + (later) mint.

NFT-specific behaviour (rarity weighting, DNA dedup, `attributes[]` manifest, mint) are **optional
layers on top**, never baked into the primitive. A variation-test run ignores them.

## 2. Conceptual model (two reframes)

### 2a. A Collectio is a long-lived collaborative *flow*, not a one-shot fan-out
A persistent, **multi-author**, **incrementally-built**, **reviewed** workspace that accrues approved
pieces toward a target over time (fire 50 → review → fire 50 more, even if the end goal is 1M). Implies:
- ownership is multi-party (today `Collectio.by` is single `{animaId}|{commitment}`);
- generation is incremental batches toward a target (today: all-at-once to `numerus`);
- each piece passes review before it counts (today: `CollectioCursor` review/revive — built, unsurfaced).

### 2b. Layers + ffmpeg are deterministic *runtimes* — the per-piece pipeline is a compositus
Layer-compositing and ffmpeg post-processing are NOT special NFT features — they're **deterministic
processing `runtime`s** (siblings of the existing `python-modelcard` runtime), and the per-piece
pipeline is a **compositus** (the engine in ADR-0008):
```
traits → [AI gen] → [layer composite] → [ffmpeg post] → piece
         (prompt)    (deterministic)     (deterministic)
```
A Collectio expands *that compositus* over the trait grid. So NFT generation is one instance of
**content-pipeline-at-scale**. Pure layer-comp collections skip the AI step; AI collections skip
compositing; most do both. (See [[project_compositus_spells]].)

## 3. Current state (what's already built)

- **Types** `Collectio` / `Tractus` / `TraitValor` (`src/types/collectio.ts`): trait grid, weighted
  `rarity`, `promptFragment`, `excludes`, `tags`.
- **`TraitMixer.selectForPiece`** — weighted-random selection, exclusions, tag-rules, `{{porta}}`
  prompt assembly, NFT-standard `attributes[]` per piece.
- **`CollectioCursor`** — fan-out with concurrency, **review/approve + reject-and-reroll**
  (`reviewEnabled`, `approveActum`, `rejectAndRevive`, `pendingReview`), pause/resume,
  restart-rehydrate.
- **Stores** `MongoCollectio` / `MongoCollectionum` in the ring; the webhook loop-back is wired
  (`collectioRouter: ring.collectioCursor` → `onActumCompleta`).
- **The one gap:** nothing calls `collectioCursor.start` — there is no launch surface.

## 4. Feature spec

✅ have · 🟡 lean add (data/observability on existing) · 🟠 new build

### 4a. Generation pipeline (per-piece)
- ✅ AI prompt-driven (traits → prompt → generative modus).
- 🟠 **Layer compositing** — a deterministic `runtime` + a composite step modus (z-order PNG layers;
  the "trait" is an image layer). Reuses the trait grid; the selected layer files composite per piece.
- 🟠 **ffmpeg post-processing** — a deterministic `runtime` for content pipelines (video/audio/image).
- The pipeline is a **compositus**; a Collectio expands it. Pure-AI / pure-layer / hybrid all fall out.

### 4b. Trait grid + selection
- ✅ weighted `rarity`, `excludes` (invalid combinations), `tags` (group mutual-exclusion), prompt
  fragments.
- 🟡 **DNA uniqueness dedup** — no duplicate trait combinations; per-axis `bypassDNA` (ignore an axis
  in the uniqueness check, e.g. background). Verify/extend `selectForPiece`.
- 🟡 **Forced / guaranteed combinations** and **1/1 inserts** (hand-made uniques placed into the run).

### 4c. Collaborative process
- ✅ review/approve + reject-and-reroll (surface it).
- 🟠 **Multi-author access** — `Collectio.by` (single) → a collaborator/access model (multiple authors
  generate, review, manage one Collectio).
- 🟡 **Incremental batches** — dispatch X at a time toward a larger target, on demand, over time
  (batch-dispatch mode over the current all-at-once `numerus`).

### 4d. Integrity + observability
- 🟡 **Provenance hash** — content-address the generative config `{ modusId+modusVersiono, tractus,
  aditusBase }` → a `provenanceHash` on the Collectio. Any trait/weight/flow change → new hash → a
  provably different input/version. (This is the NFT "provenance hash" + our content-addressing ethos.)
- 🟡 **Imagined vs realized rarity** — target (`TraitValor.rarity`, normalized) vs actual
  (count of each value across produced pieces / total, from the stamped `attributes[]`). Surface both
  so a creator sees "target 1% vs current 0.4% (3/750)" and can reroll/adjust. Drift is expected at low N.
- ✅/🟡 progress (`completae`/`fractae`/`numerus`), cost (`impetusTotal`) — have; surface via observe.

### 4e. Export + mint
- 🟠 **Metadata export** — assemble per-piece `attributes[]` + media into a collection manifest in the
  standards people expect (ERC-721 / ERC-1155, OpenSea attributes, Metaplex for Solana).
- **Mint** — the SEPARATE on-chain step (Catena/CreditVault rails). Generate a Collectio → *then* mint.
  Never conflated with generation.

## 5. Launch surface (the one missing wire)
- `CrystalApi.collect(auctor, { modusId, aditusBase, tractus, concurrentia, ... })` → create the
  `Collectio` + `collectioCursor.start`. (Never `cook()`.)
- `POST /v1/collectiones` + observe (`GET …/:id` with progress + rarity table) + `pause`/`resume`/
  `cancel` + the review endpoints (approve/reject). An **MCP tool** so an agent can drive it inside a
  larger workflow.
- `Tractus[]` grid is the input — generic axes of variation. Rarity/dedup/attributes opt-in.

## 6. Net-new work + proposed build order

1. **Launch surface over the existing engine** (`§5`) — gives live *general* collection generation
   immediately (variation testing works day one) + surfaces the built-in review. Smallest, highest leverage.
2. **Integrity/observability layer** (`§4d`) — provenance hash + realized-rarity table + DNA dedup.
   Pure data on top of what we stamp.
3. **Collaborative-flow model** (`§4c`) — incremental batches + multi-author access.
4. **Deterministic runtimes** (`§4a`) — layer-composite + ffmpeg. Net-new, but reusable far beyond NFT
   (content pipelines at large).
5. **Export + extras** (`§4b`/`§4e`) — metadata standards, forced combos, 1/1 inserts.
6. **Mint** — Catena, later, separate track.

## 7. Open questions
- Multi-author access model: a collaborator list on `Collectio`, or a shared-workspace (`Tabula`-style)
  layer above it?
- Layer-composite runtime: host-side (a small compositor) vs a pod ComfyUI graph? (Deterministic, cheap
  — likely host-side.)
- Where does the per-piece compositus get authored — the same Tabula→Modus publish path, with the
  Collectio referencing the published compositus by id?
