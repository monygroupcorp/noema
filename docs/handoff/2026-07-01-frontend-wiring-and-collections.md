# Handoff — frontend wiring + collections (2026-07-01)

Pick-up notes for continuing the go-live frontend wiring. Everything below is committed on
`chainengine-migration` and deployed to `staging.noema.art`. Memory: `project_go_live_runway`.

## What shipped this session (all deployed + verified)

- **Ceremony** — `/ceremony` page (announcement + live contribution), live **sequencer**
  (`GET/POST /v1/ceremony*`, self-serve verified upload under an optimistic head-lock),
  **in-browser snarkjs WASM contribution** (drove a real 2-contribution chain in a browser),
  and `npm run ceremony:finalize` (capture head → beacon → prints `CEREMONY_FINALIZE=`).
  Not opened for real (deliberate launch act — see "standing blockers").
- **Moderation fail-closed** (`132d52cd`) — the →public CSAM gate defaulted to *approve-all*
  (fail-open) with a public feed now wired. Flipped to `denyModerationGate` by default;
  `MODERATION_ALLOW_UNSCANNED=1` opts into permissive (dev/staging, logged). **Public
  publishing is DISABLED until a real scanner lands.**
- **Feed** (`7a1d3ee6`) — `/feed` reads `GET /v1/feed` (masonry media grid); Card result has
  **Publish to feed** → `POST /v1/editiones`. `lib/media.ts` mirrors the backend exitus projector.
- **Collections** — front door (`60132b8c`: list + create + hub), **CanonicRun** live progress
  + rarity polling (`d34f87fe`), **Curation** review queue + the backend read it needed
  (`544cf248`), **review ON by default** (`8c0a0fcb`).

## Collections surface — current state

| Screen | Route | State |
|---|---|---|
| Collections (list + create) | `/collections` | ✅ wired (`listCollections`/`createCollection`) |
| EditioHub (detail) | `/collections/:id` | ✅ wired (`getCollection`) |
| CanonicRun (live run) | `/collections/:id/run` | ✅ wired (poll `:id` + `:id/rarity`, cancel/extend) |
| Curation (review queue) | `/collections/:id/curation` | ✅ wired (`:id/pieces` + approve/reject) |
| TraitsGarden | `/collections/:id/garden` | ❌ mock — needs backend (see below) |
| TraitRules | `/collections/:id/rules` | ❌ mock — needs backend (see below) |
| EditioExport | `/collections/:id/export` | ⚠️ mock — **wireable now** onto the publish path |

### Key model fact (don't fight it)
Backend `Collectio` = a **batch-gen over a `tractus[]` grid**, created and **fired in one shot**
by `POST /v1/collectiones`. Status is `pending|running|complete|cancelled`. Traits + rules reach
the backend **only as `tractus[]` at create time** (`TractusValor` already carries `rarity`,
`promptFragment`, `excludes[]`, `tags[]` — the rule primitives). There is **no draft state** and
**no post-create trait/rule mutation**. The generation engine *honors* excludes/tags during
selection; it just has no CRUD surface to edit them.

## Net-new BACKEND work (the real blockers for the last 3 screens)

### 1. Draft collection lifecycle — the big one (unblocks TraitsGarden + TraitRules)
To make the garden + rules genuine *authoring* surfaces, a collection needs a **pre-fire draft**:
- Add a `draft` status (or a `draft: true` flag) to `Collectio`. `POST /v1/collectiones` creates a
  draft **without firing** (or add `?fire=false`); a new `POST /v1/collectiones/:id/fire` starts the run.
- `PATCH /v1/collectiones/:id/tractus` (draft-only) — add/edit/remove axes + values (the garden) and
  their `excludes`/`tags` (the rules). Re-derives `provenanceHash` on each edit (it's content-addressed
  off the config, so it MUST change when tractus changes).
- Guard: once fired (running/complete), tractus is frozen (provenance is locked). Editing a fired
  collection is not allowed — that's the whole provenance guarantee.
- Frontend then: create → draft → author garden/rules → fire → run → curate → export.

**Alternative (smaller, if you don't want a draft lifecycle):** make TraitsGarden + TraitRules
**read-only** views of the tractus the collection was created with (derive from `getCollection` —
but the projection doesn't currently include `tractus`; add it to the `Collection` projection).
This ships fast but the screens become "view your axes" not "author them."

### 2. Per-collection review toggle (net-new; today it's global)
`reviewEnabled` is a single **global** `CollectioCursor` config (just flipped ON in `container.ts`).
To let creators choose per collection:
- Add `reviewEnabled?: boolean` to `Collectio` + the `collect` opts + the create request schema.
- Have `CollectioCursor` read it from the Collectio, not its own config.
- Surface a "review each piece" toggle in the create form (`Collections.tsx` CreateForm).

### 3. (Optional) Tractus in the Collection projection
Curation + garden both benefit from the collection exposing its `tractus` (axes + values + rarity
targets). Add `tractus` to the `Collection` projection (`types.ts` + `apiContract` + `toCollection`).

## Wireable NOW (frontend only, no backend) — EditioExport
`/collections/:id/export` maps onto the **existing** `POST /v1/editiones` publish path with
`artifact: { kind: 'collectio', id }`. `CrystalApi.publish` already handles a collectio artifact,
the freeze boundary (mint/marketplace require `status === 'completa'`), and owners/rights.
- Wire the export screen's destinations to `api.publish`: **download/private-bucket works now**;
  **feed/mint/marketplace are DENIED until the CSAM scanner lands** (moderation fail-closed) — the
  UI should reflect that (disable public destinations + explain, don't just fail).
- This is a clean next frontend slice; do it before the draft-lifecycle backend work if you want
  momentum.

## Standing go-live blockers (unchanged, bigger than frontend)
1. **CSAM/NCMEC scanner** — architecture done + fail-closed; needs a vendor (PhotoDNA/Thorn/Hive) +
   NCMEC ESP registration + CyberTipline reporting (18 USC 2258A). Business/legal, then wire
   `makeVendorModerationGate` behind the seam. **Gates the public feed + collection mint/marketplace.**
2. **Real auth/session** — `lib/entry.ts` mock; hybrid (anon Bursa-commitment first).
3. **Frontend wallet + snarkjs deposit layer** — for live deposits (Funding buttons are copy-only).
4. **`noema.*` → `noemaplane.*` data cutover** — no one-button path; shared droplet/Atlas/token.
5. **Ceremony go-live** — scp `arcanum_0000.zkey` to droplet + `CEREMONY_OPEN=1` + mount the 1.2GB ptau.

## Ops reminders
- Any route/contract change → `npm run gen:api-docs` or the `apiDocsDrift` hermetic test fails.
- Deploy: merge `chainengine-migration` → `staging` branch, wait for CI green, `ssh noema './deploy-staging.sh'`.
  (The repo's `scripts/mirror-weights.mjs` is untracked locally but tracked on `staging` — move it aside
  before `git checkout staging`, restore after. Pre-existing quirk, not yours to fix.)
- Recommended next-session order: **EditioExport (frontend)** → **per-collection review toggle (small backend)**
  → **draft lifecycle + trait/rule CRUD (the big backend piece)** → garden/rules frontend.
