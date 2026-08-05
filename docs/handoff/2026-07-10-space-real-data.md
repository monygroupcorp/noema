# Spec — /space renders the caller's real vestigia (kill the static corpus)

**Date:** 2026-07-10 · **For:** a repo-context agent on `noema-crystal` · **Status:** spec, not started
**Prior art (read first):** `docs/plans/2026-06-17-vestigium-self-migration.md` (§2 fixed-commitment
decision, §4 projection gap) — this spec is its "wire the web surface" cut.

## Finding
`screens/Space.tsx` is a finished 3D explorer (THREE.Points cloud, cluster colors, fly-to picking)
fed entirely by **static build-time files** (`/space/{manifest,clusters,meta}.json` +
`{points,attrs}.bin`, loaded at Space.tsx:38-46) baked from the 163k-gen ComfyDeploy corpus by
`scripts/corpus-space/` (embed → UMAP → k-means → c-TF-IDF). Beautiful, but it's the same
exhibit for every visitor. Meanwhile the vestigia backend is real: `Vestigium` records with CLIP
embeddings (`embeddingPromptum/Imago/Intella`), `GET /api/vestigia` + `/api/vestigia/search`
(vestigiaRouter.ts:34,83,103), embeddings computed via `CLIP_SERVICE_URL` microservice
(index.ts:366-388), fire-and-forget indexing on every gen (vestigiumHook.ts:85-87).

**The one missing organ: projection.** Vestigia have 512-dim embeddings; the screen needs xyz.
Nothing computes or stores 3D coordinates today (plan doc §4).

## Goal
A signed-in (or commitment-carrying) user opens `/space` and flies through THEIR generations,
clustered and labeled, updating as they generate. The static corpus stays as the signed-out
demo exhibit.

## Shape
1. **Projection service (backend).** New piece: project a user's embedding set to 3D.
   - v1 (plan §4's own suggestion): **PCA to 3D, computed on demand** server-side — no Python,
     no UMAP dependency; PCA on ≤ a few thousand 512-dim vectors is cheap linear algebra
     (do it in TS; no new heavy deps).
   - Endpoint: `GET /api/vestigia/projection?embedding=imago|promptum` (auth: session or
     commitment) → `{ points: [{id, p:[x,y,z], cluster}], clusters: [{label, color, count}], n }`
     normalized to the same ~[-2.5,2.5] cube Space.tsx expects. Simple k-means (k scaled to n)
     + top-terms labels from prompts (port the c-TF-IDF idea cheaply: top TF words per cluster).
   - Cache the artifact per anima (recompute when vestigia count changes materially or age > N
     min). Store nothing on the Vestigium record itself in v1 (crystal-first: projection is a
     VIEW, not substance).
2. **Router gap:** `GET /api/vestigia` requires `animaId` today — accept the caller's identity
   (bearer session OR `x-commitment`) instead of a query param, matching how the rest of /v1
   resolves auctor. Same for the projection endpoint. (Plan §2's fixed-commitment login makes
   the commitment path meaningful.)
3. **Frontend:** `Space.tsx` gains a data source switch:
   - signed-in / commitment with vestigia → fetch projection endpoint, adapt to the existing
     `Corpus` shape (positions Float32Array, attrs, clusters, meta from vestigium fields:
     prompt=promptum, model=intellaIds, date=natum, src=imagoUrl);
   - empty/anon → current static corpus files, labeled clearly as "the public exhibit".
   - Add `listVestigia`/`vestigiaProjection` client methods to `lib/api.ts`.
4. **Data prerequisite (parallel, non-code):** the owner's legacy gens migration
   (plan §3, `scripts/count-my-generations.mjs` first) fills the space for the flagship
   account. The surface must work for a fresh account with 3 gens too (PCA on 3 points = fine,
   render, no clusters).

## Acceptance
- Fresh account: generate 3 images → /space shows 3 labeled points (no crash, no clusters).
- Account with hundreds of vestigia: clustered, labeled cloud; click-through shows real
  prompt/model/date; image src resolves.
- Anon with no history: static exhibit, clearly labeled.
- No Python in the serving path. Hermetic tests for the projection math (deterministic on a
  fixed embedding fixture) + router auth scoping (stranger sees nothing).

## Leads
- `src/platforms/web/app/src/screens/Space.tsx:20,24,38-46,54-125` — Corpus/PtMeta shapes to feed.
- `src/api/vestigia/vestigiaRouter.ts:34,83` · `src/crystal/MongoVestigiorum.ts:120` (manual
  cosine — Atlas Vector Search TODO noted there; not needed for this spec).
- `scripts/corpus-space/project.py` — normalization + labeling reference (port, don't call).
- `src/rag/MemoryVestigiorum.ts` — in-memory store for hermetic tests.
