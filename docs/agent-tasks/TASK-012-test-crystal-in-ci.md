# TASK-012: Add `test:crystal` (the DB layer) to CI

- **Status:** ready — **handoff-ready for a fresh session** (self-contained; no prior conversation needed)
- **Owner:** none
- **Gated by:** — (this IS a CI/test-infra task; success = the new CI job runs `test:crystal` green against
  a MongoDB service container)

## Why (the gap this closes)
CI's `verify` job runs only `npm run typecheck` + `npm run test:hermetic`. The **DB layer**
(`MongoIntella`, `MongoModorum`, `executionWebhook`, `MongoConsuetudinum`, the Compiler↔Mongo integration
test, …) needs a real Mongo and runs only under `npm run test:crystal` — which **nothing in CI runs**.
That gap let **three real bugs reach staging** on 2026-06-09, all green on the hermetic gate (which uses
*mock* Intellarum/stores that diverge from real Mongo behavior):
- the canonical-LoRA access filter (`{canonica:true}` clause in `MongoIntella.buildAccessOrClauses`),
- the `loraResolver.pickIntella` canonical-access bucket,
- TASK-006's stale string-`auctor` test fixtures.
See [[staging-findings-2026-06-08]] + [[feedback_local_integration_repro]] for the full story.

## Read first
- `AGENTS.md` (repo conventions, the hermetic vs DB test split).
- `.github/workflows/ci.yml` — the existing `verify` / `test` / `docker-build` jobs (you add a new job).
- `package.json` scripts — `test:crystal` runs `./scripts/run-with-env.sh npx tsx --test 'tests/unit/crystal/…'`.
- `scripts/run-with-env.sh` — **the wrinkle:** it loads a local `.env` and exports it before running. CI
  has no `.env`. (`tests/unit/crystal/*.test.ts` connect to Mongo via
  `process.env.MONGO_PASS ?? process.env.MONGODB_URI ?? 'mongodb://localhost:27017'`, DB `noemaplane_test`.)

## Deliverables
1. **A new CI job** in `.github/workflows/ci.yml` (e.g. `crystal-db`) that:
   - spins up a **MongoDB service container** (GitHub Actions `services:` → `mongo` image, port 27017,
     a health check so the job waits for it);
   - checks out, sets up Node 20, `npm install --legacy-peer-deps`;
   - runs the crystal DB suite against `mongodb://localhost:27017`.
2. **Handle the `run-with-env.sh` / `.env` dependency** — pick the cleanest of:
   - (a) provide a minimal CI env (`MONGODB_URI=mongodb://localhost:27017` etc.) via the job's `env:` and
     invoke the underlying `npx tsx --test 'tests/unit/crystal/**/*.test.ts' …` directly (bypassing
     `run-with-env.sh`, which only exists to load `.env`); **or**
   - (b) make `run-with-env.sh` tolerate a missing `.env` (no-op the load when absent) so `test:crystal`
     works as-is with the job's `env:` set. (b) is nicer — `test:crystal` then "just works" in CI.
   Use the SAME glob `test:crystal` uses so coverage matches local. Confirm the run is green
   (the Compiler↔Mongo LoRA repro, `MongoIntella`, `MongoModorum`, `Consuetudinum`, `executionWebhook`, …).
3. Keep it on the same `on: pull_request` trigger as the rest of `ci.yml` (and/or push — match the file's
   convention).

## Acceptance
- The new job runs `test:crystal` (the full DB glob) green in CI against the Mongo service container.
- A deliberate DB-layer regression (e.g. revert the `{canonica:true}` clause in
  `MongoIntella.buildAccessOrClauses`) makes the new job **red** — proving it actually guards the layer.
  (Revert your experiment after confirming.)
- `npx tsc --noEmit`, `npm run test:hermetic`, and `npm run test:crystal` all green locally (the latter
  needs a local Mongo — `mongodb://localhost:27017`).

## Out of scope
- Running GPU/pod things in CI (those stay on staging).
- `mongodb-memory-server` (could later make these hermetic, but a service container is the simpler first
  step — note it as a possible follow-up, don't build it).
- Fixing any *new* failures the job surfaces beyond making the suite green — if it reveals a real bug,
  file it on the board rather than papering over it.

## Handoff note
This is the first task for a fresh session. Everything you need is in this file + `AGENTS.md` + the two
linked memories. The codebase is on branch `chainengine-migration`; CI runs on PRs to `main`. There is a
local Mongo available for `test:crystal` during development.
