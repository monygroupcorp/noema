# Collectio — spec

**Status:** build-order #1 + #2 + #3 + #4 SHIPPED (2026-06-19); #5–7 remain.
The canonical spec for the collection / batch-generation feature. Build against this.

**#1 done — `CrystalApi.collect()` + `/v1/collectiones` routes** (create/list/get/pause/resume/cancel +
per-piece review), owner-scoped, public `Collection` projection; hermetic-tested (2-axis grid → N
woven+run pieces). **Discovery:** `CollectioCursor` only `initiate`d pieces and never RAN them (it
predated `dispatchInceptio`) — fixed to dispatch (run), sharing the compositus-aware dispatch, so a
Collectio piece may itself be a compositus (**cook-over-spell works for free**). All green
(typecheck, test:hermetic 593, test:crystal 895). Small follow-ups: an MCP `collect` tool; `API_CONTRACT`
entries so `/v1/openapi.json` advertises `/v1/collectiones`; a staging rebuild+deploy to exercise on GPUs. Naming rule: **`Collectio` is the only backend term** (Latin, internal — never
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
compositing; most do both.

### 2c. A Project is NOT a Collectio — keep them separate
- **Project** = the *workspace* — the iterative, messy home where you experiment toward a working
  pipeline (chats / R&D, draft Tabulae, test gens, dead-ends) **and** where finished Collectio runs
  live. The journey. Mutable, ongoing, multi-author. Its shared meta-context is the *intent/brief*.
- **Collectio** = the *running artifact* — the finalized pipeline × grid actually producing the
  collection. The destination. Lean, focused, freezable.
- A project **contains** Collectio run(s); it does not replace them. Collapse them and you bloat
  Collectio with workspace concerns. **Keep Collectio lean; the project is the surface above it.**
- **Why the project must exist (retention):** reaching a working pipeline is brutally iterative;
  "make a masterpiece from a blank canvas" churns users. The project absorbs the learning curve — it
  durably remembers the *road*, not just the destination (the concierge/warm-session philosophy made
  persistent). That is the spend-and-stay loop.
- **Crystal discipline:** do NOT extract a `Project` noun yet. Build Collectio as a cross-interface
  focal target; when a second thing (a training run, a research thread) needs the same shell,
  generalize the project then. The one genuinely new data shape the project framing demands is a
  **container of references** (→ Colloquia, → the compositus Tabula, → its Acta/Vestigia, → trait config).

### 2d. Interfaces: one focal target, four lenses
A Collectio/project is a **shared focal target the whole app points at** (fits the existing
`FocusStateMachine`) — chat / canvas / cards / space are four *lenses* on the same object, and
multi-author = several people focused on one target through different lenses. Each lens's job + the
new needs it surfaces:
- **Canvas** — author the per-piece pipeline + bind traits/layers. Needs: a **trait-group node** (a
  `Tractus` axis wired into a node input — prompt slot or layer slot), **layer-stack authoring**
  (z-order folders → composite node), "mark this published compositus as the Collectio's pipeline,"
  and **expansion viz** (this node fans out over N).
- **Chat** — R&D / brainstorm traits (the Concierge). Needs: a Concierge that **mutates the focused
  Collectio from conversation** ("add a `background` axis: sunset/city/forest at 60/30/10"), acts on
  the target id (not a fresh context), and surfaces state ("what's underrepresented?").
- **Cards** — review + dial-in. Needs: a **review queue** (each `pendingReview` piece a card with
  approve/reject/reroll — already in `CollectioCursor`), **"dial in a section"** (a card on one
  step/trait-group with its param panel + re-fire a small batch), a **rarity-tuning card**, **batch
  controls**.
- **Space (3D / Vestigium)** — embedding-space **curation instrument**. Recenter on a Collectio →
  its pieces as embeddings: **diversity/coverage**, **gaps** (empty regions = combos to generate
  into), **"weight of generations"** (semantic-space density vs intent), **outliers** to reject.
  Mostly *filtering* the existing Vestigium space to a Collectio's pieces.
- The four form a **curation loop:** Space shows a gap → Chat brainstorms traits → Canvas wires them →
  fire a batch → Cards review → Space updates.

**Scoping consequence (important):** because multiple lenses + people act on one Collectio *live*, the
backend is NOT a thin "create + start" API. It's a **shared, mutable, observable target**: (1) a rich
**Collectio view** object (config + pieces-with-review-state + rarity target-vs-realized + progress +
collaborators) every lens reads; (2) **granular mutations from any surface** (add/edit trait, set
rarity, bind pipeline, approve/reject, fire batch); (3) a **live stream (SSE)** of the view so realized
rarity ticks up, review propagates, and co-authors see each other. The lenses are thin clients over it.

## 3. Current state (what's already built)

Foundations (pre-#1):
- **Types** `Collectio` / `Tractus` / `TraitValor` (`src/types/collectio.ts`): trait grid, weighted
  `rarity`, `promptFragment`, `excludes`, `tags`.
- **`TraitMixer.selectForPiece`** — weighted-random selection, exclusions, tag-rules, `{{porta}}`
  prompt assembly, NFT-standard `attributes[]` per piece.
- **`CollectioCursor`** — fan-out with concurrency, **review/approve + reject-and-reroll**, pause/resume,
  restart-rehydrate.
- **Stores** `MongoCollectio` / `MongoCollectionum` in the ring; webhook loop-back wired.

Shipped this build-out (#1–#4, 2026-06-19):
- **#1 launch surface** — `CrystalApi.collect()` + `/v1/collectiones` (create/list/get/extend/pause/
  resume/cancel + per-piece review) + MCP `collect`/`get_collection`/`list_collections`; the dispatch
  fix that made `CollectioCursor` actually RUN pieces (cook-over-spell falls out for free).
- **#2 integrity/observability** — `provenanceHash` (content-address of the gen config), `rarityReport()`
  (target-vs-realized, `GET …/:id/rarity`), opt-in DNA dedup (`Collectio.dna` + per-axis `bypassDNA`,
  `TraitMixer` salted reroll).
- **#3 collaborative-flow** — incremental batches (`extendCollection` / `POST …/:id/extend`); **teams** =
  the lean `Sodalitas` primitive (flat membership, `/v1/teams`); per-artifact `owners[]` split snapshot
  (equal, provisional — finalized at freeze) via a `sodalitasId` overlay (funding stays on `by`).
  Review accounting corrected: rejected pieces count `reiectae`, not `fractae`.
- **#4 deterministic runtimes** — host-side cursors (by `ministerium`, sync, no GPU): **layer-composite**
  (jimp z-order; `modus.layer-composite`) and **ffmpeg** (bounded ops; `frames-to-video`;
  `modus.frames-to-video`), on a shared `MediaFetcher` + host-side `R2Uploader` foundation.

## 4. Feature spec

✅ have · 🟡 lean add (data/observability on existing) · 🟠 new build

### 4a. Generation pipeline (per-piece)
- ✅ AI prompt-driven (traits → prompt → generative modus).
- ✅ **Layer compositing** (#4) — host-side `LayerCompositeCursor` (ministerium `composite`) + jimp
  z-order PNG flatten; `modus.layer-composite` takes ordered layer URLs (`layers`) → image.
- ✅ **ffmpeg post-processing** (#4) — host-side `FfmpegCursor` (ministerium `ffmpeg`), **bounded ops
  only** (no raw args); `frames-to-video` (mp4/webm) shipped; `modus.frames-to-video`. transcode/trim/etc
  are localized engine additions later.
- The pipeline is a **compositus**; a Collectio expands it. Pure-AI / pure-layer / hybrid all fall out.
- 🟡 *Open seam:* binding a trait grid's per-axis image selections into the `layers`/`frames` ordered list
  is the Canvas layer-authoring concern (§2d), not yet wired — the runtimes consume the list directly.

### 4b. Trait grid + selection
- ✅ weighted `rarity`, `excludes` (invalid combinations), `tags` (group mutual-exclusion), prompt
  fragments.
- ✅ **DNA uniqueness dedup** (#2) — opt-in `Collectio.dna`; `TraitMixer` rerolls a colliding piece with a
  salted seed until unique; per-axis `bypassDNA`. Cursor tracks the ledger + stamps `_dna` for rehydrate.
- 🟡 **Forced / guaranteed combinations** and **1/1 inserts** (hand-made uniques placed into the run) —
  not yet built (lands with #5 export/freeze).

### 4c. Collaborative process
- ✅ review/approve + reject-and-reroll, surfaced via `POST …/:id/pieces/:actumId/{approve,reject}`.
  Rejected pieces count `reiectae` (≠ `fractae`) and extend the dispatch budget by one (a replacement
  is generated) — surfaced as `Collection.rejected`.
- ✅ **Multi-author access** (#3) — team ownership via the `sodalitasId` overlay; every `Sodalitas` member
  owns + can review/observe the Collectio (extend is funder-only until a pooled team ledger exists).
- ✅ **Incremental batches** (#3) — `extendCollection(id, addCount)` raises the target and dispatches the
  delta, re-opening a completed Collectio. (Funder-only; team-pooled funding deferred.)

### 4d. Integrity + observability
- ✅ **Provenance hash** (#2) — `provenanceHash()` content-addresses `{ modusId+versio, tractus,
  aditusBase }` → `sha256:…` on every Collectio (bigint-safe). Surfaced on the public `Collection`.
- ✅ **Imagined vs realized rarity** (#2) — `rarityReport()`: per-axis target (`TraitValor.rarity`,
  normalized) vs realized (counted from the stamped `attributes[]` of completed, non-rejected pieces).
  `GET /v1/collectiones/:id/rarity`. Drift is expected at low N.
- ✅ progress (`completae`/`pendentes`/`fractae`/`reiectae`/`numerus`), cost (`impetusTotal`) — surfaced
  via the public `Collection` (`completed`/`pendingReview`/`failed`/`rejected`/`total`/`cost`) + observe.
  `completae` is *generated and accepted*; a piece held by `reviewEnabled` is *generated and awaiting a
  decision* and counts in `pendentes` until a reviewer approves it (→ `completae`) or rejects it
  (→ `reiectae`, which extends the dispatch budget by one). Every dispatched piece is in exactly one
  counter, so `completed + pendingReview + failed + inFlight + outstanding = total`.

### 4e. Export + mint (agnostic metadata, projected on export)
- **→ Now owned by the Publishing module** (`docs/spec/publishing.md`, finalized 2026-06-21): publishing owns
  the adapter registry; a Collectio *requests* a publish — `publish(collectio, { destination:'mint' |
  'marketplace', visibility, custody })` — rather than carrying its own export code. The freeze boundary
  below stays a Collectio concern (it snapshots at publish time); the *adapters* it projects through live in
  publishing. Build-orders #5/#6 here = the Mint/Marketplace adapters there.
- 🟠 **Agnostic metadata + export adapters** — same discipline as `projectExitus`: store ONE canonical,
  format-agnostic piece record (attributes + media + provenance hash); **export adapters project it**
  into the format a target wants (ERC-721 / ERC-1155, OpenSea attributes, Metaplex/Solana, **and our
  native launchpad**). The native launchpad is a **first-party adapter, NOT a privileged data shape** —
  the internal record never knows about any launchpad. *Generate agnostic, filter on export.*
- **The freeze boundary (Collectio owns on-chain):** at export the Collectio **freezes** — it snapshots
  the ownership/split arrangement + provenance hash + trait DNA into the immutable canon. Mutable team
  above, frozen drop below (see Ownership). This split also enables living NFTs (see Publish).
- **Mint** — the SEPARATE on-chain step (Catena/CreditVault rails). Generate a Collectio → freeze/export
  → *then* mint. Never conflated with generation.

### 4f. Ownership & teams (DECIDED: teams)
- ✅ **Built (#3):** the `Sodalitas` team primitive (flat membership; team CRUD + `/v1/teams`) + the
  per-artifact `owners[]` split snapshot (equal weights at create, via the `sodalitasId` overlay). Still
  **pending:** the on-chain **split payout** wiring into the royalty hooks + the **freeze** re-snapshot
  (both land with #5/#6) — and a pooled team ledger (so any member, not just the funder, can spend).
- **Teams own the project.** A team is the shared collaborative-identity construct (mutable membership);
  it owns the *workspace* and the work that accrues in it.
- **The Collectio owns the on-chain — via the freeze.** At export the Collectio snapshots the team's
  ownership/**split** arrangement + provenance hash + trait DNA into the immutable canon. Mutable team
  above, frozen drop below; export is the boundary. So per-drop splits live on the Collectio, derived
  from the team at freeze time.
- **Two distinct flavors of "shared" — don't conflate:**
  1. **Shared access** to a profile (multiple humans → one identity). Substrate exists: an `Anima` with
     multiple `Persona`e (built for one human across platforms; this stretches it to several humans).
  2. **Split ownership** of an artifact (several distinct `Anima`e / a team, with **on-chain royalty
     splits**). The one with teeth — touches the royalty hooks (today a single recipient → split weights)
     and the ledger. Modeled as `owners[]`/team + a per-artifact split, snapshotted at freeze.
- **Scope discipline:** build the *team* construct + per-artifact split snapshot; do NOT build a full
  org/role hierarchy yet. Generalizes for free (a co-trained model, a co-authored flow get splits too).

### 4g. Living NFTs — the Publish north star (customizable NFTs)
The unmet "NFTs you can customize" — uniquely ours because **we host the metadata**, so the dynamism
lives in a layer we control (and charge for), sidestepping the messy on-chain/trustless attempts.
- **Two-layer architecture (falls out of the freeze boundary):**
  - **On-chain (frozen canon):** token, ownership, provenance hash, trait DNA. Immutable. Collectio-owned.
  - **Hosted (mutable, ours):** the image the `tokenURI` points at. We serve it → we can change it.
- **Customization** = the NFT owner runs a **constrained version of the creator's pipeline** (a publish-
  variant compositus with **creator-defined owner-exposed bounded inputs** — i.e. `exposedInputs` scoped
  to owner-safe axes, e.g. a "theme" axis: night/day/Valentine's/event) → re-generates → **overwrites the
  hosted image for that token**. The NFT visibly changes because we serve the metadata.
- **Owner-gated:** verify on-chain ownership of token #N (wallet-link / arcanum) → only #N's owner may
  re-run #N, writing only #N's hosted image.
- **Business model:** ongoing hosting/customization is a **fiat subscription** (enforceable; crypto can't
  enforce recurring). Stop paying → fall back to the frozen-canon image. Recurring revenue + a real moat
  (dynamic NFTs as a *service*, not a one-time mint).
- **It's a composition, not a new subsystem:** Collectio (gen) + Publish (hosted metadata) + spell
  `exposedInputs` (bounded input) + wallet-link (ownership) + a small hosted-metadata service + fiat
  billing. Every step we've scoped is load-bearing for it.
- **Pieces it adds:** (1) hosted-metadata service — per-token `tokenURI` + mutable image + per-token
  customization state; (2) customization pipeline — publish-variant + owner-exposed bounds; (3)
  owner-gated re-execution; (4) fiat subscription billing (separate from closed-loop credits).
- **Honest trade-off:** the dynamism is in the *trusted hosted layer*, not on-chain; the token +
  provenance stay canonical on-chain. That trade is exactly why it's achievable when trustless attempts fail.

## 5. Launch surface (the one missing wire)
- `CrystalApi.collect(auctor, { modusId, aditusBase, tractus, concurrentia, ... })` → create the
  `Collectio` + `collectioCursor.start`. (Never `cook()`.)
- `POST /v1/collectiones` + observe (`GET …/:id` with progress + rarity table) + `pause`/`resume`/
  `cancel` + the review endpoints (approve/reject). An **MCP tool** so an agent can drive it inside a
  larger workflow.
- `Tractus[]` grid is the input — generic axes of variation. Rarity/dedup/attributes opt-in.

## 6. Net-new work + proposed build order

1. ✅ **DONE — Launch surface over the existing engine** (`§5`): `CrystalApi.collect()` + routes +
   the dispatch fix (pieces now actually run). General collection generation is live + hermetic-tested.
2. ✅ **DONE — Integrity/observability layer** (`§4d`): `provenanceHash` content-addresses
   `{modusId+versio, tractus, aditusBase}` on every Collectio (surfaced on the public Collection);
   `rarityReport()` gives target-vs-realized per-axis rarity (`GET /v1/collectiones/:id/rarity`);
   opt-in `Collectio.dna` enforces trait-combination uniqueness (TraitMixer salted reroll +
   per-axis `bypassDNA`; cursor tracks the ledger + stamps `_dna` for rehydrate). All hermetic-tested.
3. ✅ **DONE — Collaborative-flow model** (`§4c`/`§4f`): **incremental batches** (`extendCollection` /
   `POST …/:id/extend` re-opens a collection toward a larger target); **teams** = a new lean `Sodalitas`
   primitive (flat membership; team CRUD + `/v1/teams`; distinct from the economic `Animarum`);
   **per-artifact split** = `owners[]` snapshotted equal-weight from team membership at create, with a
   `sodalitasId` ownership overlay on the Collectio (funding stays on `by`). Roles/permissions + a pooled
   team ledger + split-payout wiring deferred (the latter lands with freeze/mint). All hermetic-tested.
4. ✅ **DONE — Deterministic runtimes** (`§4a`): host-side cursors (dispatch by `ministerium`, sync, no
   GPU pod — siblings of the OpenAI/HF cursors), on a shared foundation (`MediaFetcher` URL→bytes +
   `R2Uploader` host-side R2 PutObject, both injected). **layer-composite** (jimp z-order PNG flatten;
   `modus.layer-composite`) and **ffmpeg** (bounded ops — no raw args; `frames-to-video` mp4/webm via a
   spawned ffmpeg with a fixed arg vector; `modus.frames-to-video`). A Collectio expands a composite/
   animate step over its grid. Registered when R2 is configured. Net-new, reusable far beyond NFT.
5. **Export + freeze** (`§4b`/`§4e`) — ✅ the freeze boundary + adapters SHIPPED via **publishing #5**
   (`MintAdapter`/`MarketplaceAdapter`, docs/spec/publishing.md §6): a Collectio published to
   `destination:'mint'`/`'marketplace'` content-addresses `provenanceHash + owners[] + size` into the immutable
   canon (must be `completa`; owners[] re-snapshotted at freeze). Still here: agnostic per-token metadata,
   forced combos, 1/1 inserts. The real on-chain mint tx is the publishing-#5 placeholder.
6. **Mint** — Catena, later, separate track (the on-chain tx behind the publishing-#5 freeze).
7. **Living NFTs / Publish** (`§4g`) — the north star: hosted-metadata service + customization pipeline +
   owner-gated re-execution + fiat subscription. Builds on 1–6; largest, highest-differentiation.

The **Project** shell (cross-interface workspace / focal target across the four lenses, §2c/§2d) is the
surface that ties 1–7 together — not extracted as a `Project` noun yet; emerges as Collectio is built
as a shared target and a second use (training run, research thread) earns the generalization.

## 7. Open questions
- **Teams granularity:** flat membership + per-artifact split snapshot (lean) vs roles/permissions
  (deferred). Where do split *weights* default from — equal, or set per Collectio at freeze?
- **Hosted-metadata service:** the per-token `tokenURI` + mutable-image + per-token-state store — new
  ring primitive, or an extension of the existing R2/output hosting? Reveal/fallback semantics when a
  subscription lapses.
- **Layer-composite runtime:** host-side compositor vs a pod ComfyUI graph (deterministic, cheap — likely
  host-side).
- **Per-piece compositus authoring:** the same Tabula→Modus publish path, with the Collectio referencing
  the published compositus by id (and the customization pipeline a publish-variant of it).
