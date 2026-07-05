# Handoff · Projects / real holdings

> **STATUS — SHIPPED (working tree, hermetic-green, never live-verified) 2026-07-04.**
> All 6 decisions built backend-first. The crystal type is **`Provincia`** (an account-owned
> workspace lens), store **`Provinciarum`** (`MongoProvinciarum`, `provinciae` collection).
> - **D1** — `/v1/me/projects` CRUD (`GET`/`POST`/`GET :id`/`PATCH :id`/`DELETE :id` +
>   `POST/DELETE :id/holdings`), account-scoped by `animaId`, identified-only. `CrystalApi`
>   methods + `ApiFacade` + `apiContract` + regenerated `docs/api/*`.
> - **D2** — `Provincia.res` = `{ datasetIds, modelIds, collectionIds }` (references, not copies);
>   web `Project` gains the three arrays; `counts()`/ProjectHub read real lengths (hardcoded `0`
>   killed). `state/project.tsx` is backend-authoritative for identified accounts, keeping the
>   per-account localStorage cache as the view overlay (chats/canvases/favorites) + anon fallback.
> - **D3** — file/unfile holdings endpoints (idempotent) + optimistic `fileAsset`/`unfileAsset`.
> - **D4** — ProjectHub asset tabs/cards open the **canonical** `Datasets`/`Shelf`/`Collections`
>   surfaces filtered by `?project=<id>` (shared `useProjectScope` + `ScopeBanner`).
> - **D5** — Preferences "land in (project)" is a live picker persisting `generatio.defaultProjectId`
>   (portable; cast-time auto-filing marked next).
> - **D6** — a project **references a Team** via `sodalitasId` (no second membership model);
>   ProjectHub shares by picking one of the caller's Teams.
> - **Open follow-ups:** cast-time auto-filing of new work into the default project; deriving a
>   shared-member count from the referenced Team; a re-file action on the canonical surfaces.
> Tests: `tests/unit/crystal/projects.test.ts` (9), added to `test:hermetic` (877 total green).

**Bucket:** own-context feature spec, deferred out of [UX Handoff 2 · Architecture](./2026-07-03-ux-2-architecture-handoff.md) (Decision 5).
**Depends on [Keyring · Multi-account](./2026-07-03-keyring-multi-account-handoff.md) — do it second.**
**Why its own handoff:** the audit found Projects structurally broken — `Project` carries no
datasets/models fields, so ProjectHub's Datasets/Models/Collections tabs are hardcoded to `0` and can
never populate (`ProjectHub.tsx:33, 78-86`). The launch recommendation was *demote*; the product call
was to **build it properly** instead, in its own context. It waits on Keyring because a project's
ownership boundary **is the account** — which account owns a project, and which project set is visible,
can't be answered until the multi-account model exists.

> **Hard dependency:** this consumes Keyring **Decision 6** (per-account local-state namespacing by
> `animaId`). The account is the ownership boundary. Do not start the holdings work until that seam is
> defined.

This handoff is **decisions-first** — each block is a call to make, with a recommendation and the
current-code reality it has to move.

---

## Current reality (what has to change)
- **No holdings on the type** — `lib/projects.ts:11-23` `Project` = `{ id, name, glyph, color, desc,
  shared?, updated, chats[], cards[], canvases[], gens }`. There are **no `datasets`/`models`/
  `collections` fields**; `addProject` seeds `chats/cards/canvases/gens` only (`state/project.tsx:50`).
- **Tabs hardcoded to zero** — `ProjectHub.tsx:33` sets Datasets/Models/Collections tab counts to a
  literal `0`; the Overview holding cards pass `n={0}` (`:78-86`). They *are* honestly marked ("no
  datasets yet", "building that surface is a later phase" `:79, 115`), so it's not dishonest — just
  empty and inert.
- **localStorage only, no backend** — `state/project.tsx:6-9` `TODO(backend: project persistence)`:
  the whole list seeds from the mock `PROJECTS` and persists to `noema-projects`. No `/v1` store.
- **Preferences blocked on it** — the "land in (project)" default row is disabled with "needs a
  Projects entity — not built" (`Preferences.tsx:82-83`).
- **ProjectHub already states the boundary** — "the only hard boundary is your account"
  (`ProjectHub.tsx:102`). That sentence is the whole reason Keyring comes first.

---

## Decision 1 — a real Projects backend (account-scoped)
Replace the localStorage mock with a `/v1` projects store, keyed by owning `animaId`.
- **Recommend:** a minimal entity — `{ id, animaId (owner), name, meta, memberships[], holdings:
  { datasetIds[], modelIds[], collectionIds[] } }`. Holdings are **references, not copies** — a project
  files existing assets, it doesn't own new nouns.
- **Consumes Keyring D6:** the active `animaId` selects the visible project set; switching account
  switches Projects. Keep localStorage as a per-account cache keyed the way Keyring defines.

## Decision 2 — add holdings to the type
Extend `Project` with `datasetIds`, `modelIds`, `collectionIds` (id references). `counts()` and the
ProjectHub tabs/cards read real lengths instead of `0`.
- **Open:** do chats/cards/canvases (today inline objects) also move to id-references for consistency,
  or stay inline? Recommend id-references across the board once the backend exists.

## Decision 3 — asset ↔ project linkage
How a dataset/model/collection gets filed into a project.
- **Recommend:** stamp `projectId` on the asset at creation — ProjectHub's quick-start actions
  (`ProjectHub.tsx:16-22`) already create *into* the active project, so creation-time filing is natural.
  Add a re-file action for existing assets. The active project comes from the account-namespaced key.
- **Open:** can an asset belong to more than one project? ProjectHub's copy says a project "isn't a
  wall … anything here can be referenced from other projects" (`:102`) — that argues for many-to-many
  (tags), not exclusive ownership. Recommend tags (many-to-many) to match the stated model.

## Decision 4 — scoped surfaces
ProjectHub's non-Overview tabs should open the **canonical** datasets/models/collections lists filtered
to `projectId`, not bespoke panes (`ProjectHub.tsx:112-117` already promises exactly this).
- **Recommend:** teach the canonical list surfaces (`Datasets.tsx`, `Shelf.tsx`, `Collections.tsx`) to
  accept an optional project filter, and route the tabs through them. One list surface, two entry modes.

## Decision 5 — wire the Preferences default
Once a Projects entity exists, wire the disabled "land in (project)" row (`Preferences.tsx:82-83`) to a
default-project binding that new work files into.

## Decision 6 — reconcile sharing with Teams
Projects are described as the unit of sharing (`lib/projects.ts:1-5`, `p.shared`), but Teams
(`Sodalitas`, `screens/Teams.tsx`) is the existing co-ownership CRUD. Two membership models today.
- **Open:** is a project's `memberships[]` the same thing as a Team, or does a project *reference* a
  Team for its member set? Recommend project → references a Team (don't build a second membership
  system). Cross-check the `owners[]`/Sodalitas work already shipped in the Collectio buildout.

---

### Build order
1. Projects `/v1` backend entity, `animaId`-scoped (Decision 1) — consumes Keyring D6.
2. `Project` type gains `datasetIds/modelIds/collectionIds` (Decision 2); `counts()`/ProjectHub read
   real lengths.
3. Asset creation stamps `projectId`; add re-file (Decision 3).
4. ProjectHub tabs → canonical list surfaces with a project filter (Decision 4).
5. Wire the Preferences "land in project" default (Decision 5).
6. Reconcile project membership with Teams/Sodalitas (Decision 6).

---

**Sequence:** [Keyring · Multi-account](./2026-07-03-keyring-multi-account-handoff.md) →
Projects (you are here). Blocked on Keyring Decision 6 (per-account scoping). With both landed, the
deferred UX Handoff 2 items (default-flow picker's project row, `/map` removal) come unblocked.
