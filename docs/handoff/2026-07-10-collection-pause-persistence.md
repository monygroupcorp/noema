# Spec — collection pause must be persisted + surfaced (not an in-memory flag)

**Date:** 2026-07-10 · **For:** a repo-context agent on `noema-crystal` · **Status:** spec, not started

## Finding
`POST /v1/collectiones/:id/pause|resume` flips `CollectioState.paused` — an entry in
`CollectioCursor`'s **in-memory Map** (`src/crystal/CollectioCursor.ts:23,36,257-268`). Nothing
lands on the collection record. Consequences:
1. `GET /v1/collectiones/:id` cannot tell a paused run from a running one — the web CanonicRun
   screen (wired 2026-07-10) fakes it with a client-side toggle that resets on reload.
2. A process restart loses the flag entirely — a paused collection silently resumes (or worse,
   its state entry is gone; check what re-hydrates `states` after boot — if nothing does, that
   is a second, bigger bug this spec should confirm and cover).

## Goal
Pause is a durable, queryable fact: survives restarts, shows on the projection, drives the UI.

## Shape
1. **Persist**: add `pausatum?: boolean` (or `pausatum?: Date` for auditability) to the
   Collectio record (`src/types/collectio.ts` — keep `CollectioStatus` union UNCHANGED; paused
   is orthogonal to `agens`, crystal-first: a flag, not a new status). Store write in
   `pause()`/`resume()` alongside the in-memory flip.
2. **Re-hydrate**: on cursor start (or first `_dispatch` for a collection), read the flag —
   a paused collection must NOT dispatch after restart. While in there, verify/spec how
   in-flight `agens` collections resume dispatching after a restart at all; if they don't,
   document it in this handoff and fix in the same PR (same seam).
3. **Surface**: `toCollection` projection (+ frontend `Collection` interface in
   `src/platforms/web/app/src/lib/api.ts:~581`) gains `paused?: boolean`. Contract entry +
   `npm run gen:api-docs`.
4. **Frontend**: `screens/CanonicRun.tsx` drops the local `paused` useState (added 2026-07-10,
   commented as temporary) and reads `c.paused`; poll keeps it fresh.

## Acceptance
- pause → reload page → UI still shows paused; resume works.
- pause → restart backend (hermetic harness) → no new pieces dispatch until resume.
- `GET /v1/collectiones/:id` carries `paused: true` while paused. Hermetic + docs-drift green.
