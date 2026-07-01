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
| TraitsGarden | `/collections/:id/garden` | ✅ **wired** (draft authoring: edit axes/values, Save→PATCH, Fire; frozen read-only once fired) |
| TraitRules | `/collections/:id/rules` | ✅ **wired** (edit `excludes`/`tags` per value, Save→PATCH; frozen once fired) |
| EditioExport | `/collections/:id/export` | ✅ **download + hosting wired** (archive + gallery); NOESIS-mint tabled for the launchpad |

### Key model fact (don't fight it)
Backend `Collectio` = a **batch-gen over a `tractus[]` grid**, created and **fired in one shot**
by `POST /v1/collectiones`. Status is `pending|running|complete|cancelled`. Traits + rules reach
the backend **only as `tractus[]` at create time** (`TractusValor` already carries `rarity`,
`promptFragment`, `excludes[]`, `tags[]` — the rule primitives). There is **no draft state** and
**no post-create trait/rule mutation**. The generation engine *honors* excludes/tags during
selection; it just has no CRUD surface to edit them.

## Net-new BACKEND work — STATUS

### ✅ DONE 2026-07-01 — Draft lifecycle (unblocked TraitsGarden + TraitRules)
Shipped the full draft lifecycle + trait/rule CRUD:
- `CollectioStatus` gained `'draft'` (projected to `'draft'`); `COLLECTION_STATUS_MAP` + public/frontend
  status unions updated. `Collectio.tractus` + `reviewEnabled` now exposed on the `Collection` projection.
- `POST /v1/collectiones` with `draft:true` creates a draft **without firing** (`collect` skips
  `collectioCursor.start`). New `POST /v1/collectiones/:id/fire` (funder-only, draft-only) re-pins
  provenance to the flow version at fire time, then dispatches. New `PATCH /v1/collectiones/:id/tractus`
  (draft-only) replaces the grid + re-derives `provenanceHash`; frozen once fired (`input.malformed`).
- Store `update()` widened (`Collectionum` + both Mongo stores) to allow `tractus`/`provenanceHash`.
- Frontend: `CreateForm` gained **Save as draft** (no spend confirm → routes to `/garden`); draft cards
  route to `/garden` ("Author draft"). **TraitsGarden** rebuilt into a real editor (axes + value cards
  with label/value/weight, add/remove, Save→PATCH, Fire→run; read-only when fired). **TraitRules**
  rebuilt to edit `excludes`/`tags` per value (Save→PATCH; read-only when fired).
- Tests: `collect.test.ts` +4 (draft/patch/fire/scope). Crystal 1200 green. **Never GPU-verified.**

### ✅ DONE 2026-07-01 — Per-collection review toggle (was global)
`reviewEnabled` is now per-collection: `Collectio.reviewEnabled` + `CollectOpts` + create schema; the
`CollectioCursor` reads `collectio.reviewEnabled ?? config.reviewEnabled` (its global stays the DEFAULT,
preserving "review on by default"). Create form has a "Review each piece" checkbox (default on).
`CollectioCursor.test.ts` +2 (override both ways).

### (historical) 1. Draft collection lifecycle — the big one (unblocks TraitsGarden + TraitRules)
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

## EditioExport — DONE (download path shipped)
The "Export to you" sovereign-download is wired end-to-end. Correction to the original plan:
a collectio publish only emits a freeze *manifest* (`{ provenanceHash, numerus, nomen }`), and
there is **no `'hosting'` adapter** — so the old "download/private-bucket works now" line did not
actually hold for a collection. Built the real path instead:

- **`ArchiveAdapter`** (`src/crystal/ArchiveAdapter.ts`, destination key `archive`) — a new
  `PublicationAdapter` that enumerates a collection's approved pieces, streams each piece's media +
  an OpenSea metadata sidecar into a ZIP (`archiver` → PassThrough → R2 multipart put), hosts it in
  our bucket, and returns the URL as `Editio.externalRef`. `retract` deletes the ZIP. Keyed by
  `editioId` → re-settle is idempotent. Ports the legacy `CollectionExportService` worker onto the
  publishing spine. Zip layout: `images/NNNN.ext`, `metadata/NNNN.json`, `manifest.json`, `metadata.json`.
- **`collectioArchiveSource`** (`src/crystal/collectioArchiveSource.ts`) — resolves the exportable
  pieces (completed + non-rejected acta; media from `exitus`, traits from `aditus._attributes`).
  Same rule as rarity/curation. Registered in `container.ts` (gated on R2, next to `BucketAdapter`).
- **`GET /v1/editiones/:id`** (author-scoped) — new route + `CrystalApi.getEdition`; the frontend
  polls it to watch the async ZIP build settle (`pending` → `published` with `externalRef`).
- **Frontend** — `EditioExport.tsx` loads the real collection, runs `api.publish({ artifact:
  { kind:'collectio', id }, destination:'archive', visibility:'private', custody:'ours' })` then polls
  `api.getEdition` to a download link. `visibility:'private'` → skips the moderation gate, so it works
  on staging today. Hosting + NOESIS-mint are shown **disabled with a reason** (mint also gated on
  `status==='complete'`), per the fail-closed guidance — not silently failing.
- Tests: `tests/unit/crystal/ArchiveAdapter.test.ts` (9, hermetic). All green; **never GPU-verified**
  (no real R2 zip built against live pieces yet — verify on staging after deploy).

### ✅ DONE 2026-07-01 — Hosting bridge (`GalleryAdapter`)
The hosting destination is wired as a **temporary bridge** (decided model: NOEMA is an AI-gen platform,
not permanent storage). `GalleryAdapter` (`src/crystal/GalleryAdapter.ts`, key `gallery`) reuses
`collectioArchiveSource` + `R2Uploader` from the archive path — fans out per-piece PUBLIC puts
(`gallery/<editioId>/<tokenId>.png` + `<tokenId>.json`, OpenSea metadata with `image` = the FULL public
url), 0-indexed tokenIds, + `manifest.json` (carries `HOSTING_NOTICE` urging Arweave/IPFS migration +
a `files` index for retract) + `metadata.json`. `externalRef` = the base URI (set your contract's
`baseURI` to it). `retract` deletes the set from its own manifest (best-effort/revocable). Registered in
container (R2-gated). `publish()` now treats `gallery` as a PUBLIC destination (default visibility
`marketplace` → the moderation gate runs). Frontend: EditioExport hosting option is a real publish→poll
flow (shows the base URI on success, "held for content-safety review" on gate-reject) with a prominent
temporary-bridge warning + consent. **On staging (`MODERATION_ALLOW_UNSCANNED=1`) it works and produces
real tokenURIs; in prod it's fail-closed until a CSAM scanner.** Tests: `GalleryAdapter.test.ts` (7).
Crystal 1207 green. **Never GPU/R2-verified.**

### ✅ DONE 2026-07-01 — Arweave graduation (backend; live-unverified)
The permanent-storage counterpart to the R2 bridge — built the `HfUploader` way (hermetic orchestration
+ a live-unverified real transport). Destination `arweave` on the publish spine:
- `ArweaveUploader` (`src/crystal/ArweaveUploader.ts`) — orchestration: fetch pieces → **meter/charge**
  (ArweaveCharger seam) → two-pass upload (image → txid, then metadata whose `image` = the permanent
  gateway URL) → build + upload an **Arweave path manifest** so `<gateway>/<manifestTxid>/<tokenId>.json`
  resolves. `externalRef` = the base URI. Fully hermetic (fake transport/charger/fetcher).
- `IrysTransport` (same file) — the REAL Irys bundler (`@irys/upload` + `@irys/upload-ethereum`, added
  deps), **lazy-loaded** so an unconfigured boot never touches it. **LIVE-UNVERIFIED** (needs a funded
  wallet + network) — the only untested surface.
- `ArweaveAdapter` (`src/crystal/ArweaveAdapter.ts`, key `arweave`) — thin spine seam; reuses
  `archiveSource`; threads the payer `by` (new `PublishArtifact.by`, populated from `Editio.by`) for
  metering. PERMANENT → no `retract`. PUBLIC → moderation gate applies.
- Container: registered only when `ARWEAVE_PRIVATE_KEY` is set (secret → NOEMA-side, not NOESIS). Charger
  is a **PLACEHOLDER** (`grep PLACEHOLDER(publishing#6-arweave)`): balance-check-only, does NOT debit.
- Tests: `ArweaveUploader.test.ts` (6). Crystal 1213 green. Frontend stays a "migrate to Arweave →
  coming soon" nudge (not a live button — see caveats).

**⚠ GO-LIVE HARDENING before funding** (in `ArweaveUploader` header comment): (1) the PublicationWorker
is at-least-once → a re-settle RE-UPLOADS + RE-CHARGES a paid, non-idempotent op (persist the manifest
txid on the Editio + short-circuit retries first); (2) charge-then-upload leaves paid orphans on a
mid-upload crash; (3) wire the real bytes→credits price/markup + signa debit (the charger placeholder).
Pinata/IPFS stays RESERVED for our own collections (2TB); Arweave is the user-facing permanence offer.

**NOESIS mint = tabled (launchpad deploying separately).** `MintAdapter` is projection-only
(`PLACEHOLDER(publishing#5)`, no on-chain tx). NOESIS is static + secretless, so it CANNOT host tokenURIs
or bear mint secrets — it leans on the NOEMA `GalleryAdapter` endpoint above. Left disabled-with-reason
("coming with the NOESIS launchpad") in the export UI.

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
- Recommended next-session order: ~~EditioExport~~ (DONE) → **per-collection review toggle (small backend)**
  → **draft lifecycle + trait/rule CRUD (the big backend piece)** → garden/rules frontend.
- New dep: `@types/archiver` (dev). Pinned to `^6` on purpose — v8's types dropped the callable
  vending default (`archiver('zip', …)`), so v8 won't typecheck against archiver 7's runtime.
