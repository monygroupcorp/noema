# Handoff — build Publishing (Editio) build-order #1: the feed

**Date:** 2026-06-21 · **Branch:** `chainengine-migration` · **Read this + `docs/spec/publishing.md`, then start.**

You are picking up a fresh context. A long session designed two things end-to-end. This handoff
orients you and hands you the **next build task**: Publishing build-order #1 (publish an `Actum` to a feed).

---

## 0. The one task

Build the **publishing spine + feed adapter** per `docs/spec/publishing.md` §5 (crystal core) + §6 (build-order #1):

> **Publish an `Actum` to our feed.** New pieces only: `Editio` primitive + `Editionum` store + a
> `PublicationAdapter` interface + a `FeedAdapter` + the `visibility` flag + one `Anima` publishing-pref
> default + an **async moderation gate** for public surfaces. A `/v1/feed` read API. Nothing on-chain.

`docs/spec/publishing.md` is the **canonical source of truth** — §5 (Editio shape, adapter interface,
PublishingPrefs, single-source-of-truth, the Intella↔royalty note), §6 (build order), §8 (finalized
decisions), §9 (deferred items). Don't re-litigate §8; it's decided.

---

## 1. What this codebase is

`noema-crystal` — a TypeScript rewrite (the "crystal" layer: `src/crystal`, `src/types`, `src/execution`,
`src/ledger`, `src/allocutio/api`) of a legacy JS bot (`src/core`, `src/platforms`). The crystal side
exposes a self-describing `/v1` agent API (`ApiAllocutio`). Primitives are Latin-named nouns: `Modus` (a
flow), `Actum` (a run/gen), `Intella` (a model/LoRA weight), `Collectio` (a generated collection),
`Sodalitas` (a team), `Anima` (a user identity). Execution rail: `Inceptio → Actum`, dispatched by a
`Cursor` resolved from `Cursorum` by `modus.ministerium`; multi-step pipelines are a `compositus` modus run
by `CompositusCursor`; async jobs (GPU pods) complete via a webhook → `ActumCompletor`.

## 2. What this session shipped (lineage, newest last)

**Collectio build-orders #1–#4 — shipped, reviewed, hardened, all green** (`docs/spec/collectio.md` is current):
- `dd6f4d57` #1 launch surface (MCP `collect` + `/v1/collectiones` in the API contract)
- `fb7fad6a` #2 integrity/observability (provenance hash, rarity report, DNA dedup)
- `5040f0cf` + `606ed305` #3 collaborative-flow (incremental batches `extendCollection`; teams = `Sodalitas`; per-artifact `owners[]` split)
- `aa9981b1` + `e616a061` review fixes (funder-only extend; modus validation; bigint-safe provenance; reject≠fail accounting `reiectae`)
- `d9d90b23` #4a layer-composite runtime · `ec54bb6e` #4b ffmpeg runtime (host-side deterministic cursors)
- spec marks: `2a0bc3a3` `3e043b48` `32498353` `93bab636`

**Publishing (Editio) — spec finalized, nothing built:**
- `4cabcfdf` draft · `d4be7fe5` finalize + point Collectio §4e at it

Net: Collectio #5–7 (export/freeze/mint/living-NFTs) are now **publishing concerns** — they become
Mint/Marketplace/hosted-metadata adapters on the Editio spine. "Publish a trained LoRA" is publishing
build-order #3 (HuggingFace/custody adapter under prefs), not a special case.

## 3. The patterns to copy (this is how the codebase does it)

The deterministic-runtime work from #4 is your **template** for the feed adapter — same shape:
- **Injected engine/uploader behind an interface, real + fake** → see `src/crystal/LayerCompositeCursor.ts`
  + `LayerCompositeEngine.ts` + `MediaFetcher.ts` + `R2Uploader.ts`, and their tests
  `tests/unit/crystal/LayerComposite*.test.ts`. **Build `FeedAdapter` + the `ModerationGate` the same way**
  (interface + real-impl-deferred + fake for tests). The moderation scanner (CSAM/NCMEC) is **specced, not
  built** (compliance posture) — so inject a `ModerationGate` interface now, fake it in tests, real impl later.
- **A Mongo store + container wiring** → `src/crystal/MongoCollectionum.ts` (store), `src/types/collectio.ts`
  (entity + store interface), `src/container.ts` (construct + add to `Ring`), `src/index.ts` (pass into
  `CrystalApi` deps). Mirror this for `Editio`/`Editionum`.
- **A `/v1` route + the API contract** → routes in `src/allocutio/api/apiRouter.ts`; the **declarative
  contract** in `src/allocutio/api/apiContract.ts` (add route + schemas there); then run `npm run
  gen:api-docs` (regenerates `docs/api/openapi.json` + `reference.md`) — a hermetic **drift test**
  (`tests/unit/allocutio/api/apiDocsDrift.test.ts`) fails if you forget.
- **Reuse existing primitives** — `Actum` is the artifact (its `exitus` carries media URLs); `Anima` holds
  `PublishingPrefs`; the Nexus hook rail (`src/types/nexus.ts`, `src/ledger/hooks/*`) is where the §5d
  reconciler (keep `Intella.access` in sync with `Editio`) should attach — decide event-hook vs
  write-through at build time (§9).

## 4. Verify (baseline is green — keep it green)

```
npm run typecheck            # tsc --noEmit, clean
npm run test:hermetic        # 595 passing (includes the API-docs drift gate)
npm run test:crystal         # 940 passing
```
Run all three before committing. After any `apiContract.ts` change: `npm run gen:api-docs` first.

## 5. Hard rules (non-negotiable)

- **DB:** `noema` Mongo is **LIVE PRODUCTION** — never touch it. Work only against `noemaplane` /
  `noemaplane_test`. Scripts that hit the DB must pin the target explicitly (`.env` `MONGODB_URI` points at
  prod). See memory `feedback_noema_is_production_db`.
- **Commits:** `fix:` by default, `feat:` only for genuinely new user-facing features. **No `Co-Authored-By`
  lines.** Branch is `chainengine-migration` (don't touch `main`/`staging` directly).
- **Deploy only when asked.** Nothing in this build needs a deploy; staging deploy + GPU runs cost money and
  require explicit go-ahead.
- **Moderation gate is non-negotiable:** any `Editio` to a public surface (`visibility:'feed'|'marketplace'`)
  goes `pending` → async scan → `published` | `rejected`. Never a synchronous publish to public.
- **Crystal discipline** (memory `feedback_crystal_first_buildout`): reduce to the crystal core, reuse
  existing unions (`{animaId}|{commitment}`), minimize surface. Don't model a second artifact type — `Editio`
  only *references* an `Actum`/`Intella`/`Collectio`.

## 6. Suggested build slices for #1 (small commits, green between each)

1. `Editio` type + `Editionum` store interface (`src/types/`) + `MongoEditionum` + container/Ring/deps wiring.
2. `PublicationAdapter` interface + `ModerationGate` interface (injected; fakes for tests).
3. `FeedAdapter` (writes/serves an `Editio` of an `Actum`; custody `ours`).
4. `PublishingPrefs` on `Anima` + the publish entry on `CrystalApi` (`publish(auctor, { artifactRef,
   destination, visibility, custody })`, defaulting from prefs) + the moderation `pending→published` flow.
5. `/v1` routes: `POST /v1/editiones` (publish) + `GET /v1/feed` (read, owner/visibility-scoped) + contract
   entries + `gen:api-docs`.
6. The §5d reconciler (Editio → `Intella.access`) — decide hook vs write-through; can be a thin start.

Tests alongside each (mirror `LayerCompositeCursor.test.ts` for adapter/gate fakes; `collect.test.ts` for the
CrystalApi + store wiring).

## 7. After #1

Per `publishing.md` §6: #2 bucket/hosting custody → #3 model publishing + custody prefs (resolves the
training-LoRA thread) → #4 rights/license/splits (the Intella↔royalty/ChainEngine surface, §5e) → #5
collection/mint (Collectio freeze) → #6 living NFTs. Also still open from earlier: **live verification of
Collectio #1–4** (never deployed/proven on GPUs — tested, not verified) — flag to the user before relying on it.
