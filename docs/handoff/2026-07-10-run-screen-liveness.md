# Spec — Run surface tells the truth live (phases, elapsed, failure)

**Date:** 2026-07-10 · **For:** a repo-context agent on `noema-crystal` · **Status:** spec, not started
**Live repro (owner, staging, 2026-07-10):** klein run `16637f94…` — pod provisioned 19s in,
3 models downloaded, job failed at 19:16 — and the Run view showed NONE of it: no "pod
provisioned", no download progress, **no failure**; refreshing reset the elapsed timer to 0.

## Findings (three distinct defects, one surface)
1. **No phases.** The backend emits a rich lifecycle (`actum initiated` → `pod provisioning` →
   `pod SSH ready` → `bootstrapping` → `model download started/done n/3` → workflow submitted
   → failed/complete) but the run views poll `GET /v1/runs/:id`, whose projection is only
   `pending|running|complete|failed` (`runProjection.toRun`). The stepline the user stares at
   is static copy.
2. **Elapsed resets on refresh.** Elapsed is computed from component mount, not from the
   run's `createdAt` (which `Run` already carries in the projection).
3. **Failure is silent.** The actum failed server-side with a real error message
   (`failure.code/message` exist on the projection) but the screen kept looking pending.
   (Card.tsx at least polls to terminal; the Run screen path the owner watched did not
   surface it — audit which of Run.tsx/Card.tsx the "run mode" view is and fix the one that
   lied; verify both.)

## Shape
1. **Wire the stream that already exists.** `GET /v1/runs/:id/stream` (SSE, `RunEventHub`) —
   client method `api.streamRun()` exists. Determine what events the hub actually forwards
   today: the runner status sink (`POST /runner/status` → `reportProgressus`) and the
   cursor lifecycle logs. Whatever subset reaches the hub, forward it as SSE events with a
   `Phasis` + optional `ProgressusMensura` payload (`src/types/progressus.ts:44` — the OWNED
   taxonomy; do not invent new phase names). If cursor lifecycle (pod provisioning / SSH
   ready / model n/3) doesn't reach the hub yet, bridge it — smallest seam, likely where
   `cursor:runpod:secure`/`cursor:comfyrunner` already log.
2. **Run view consumes SSE, falls back to poll.** Stepline states derive from the latest
   `Phasis` (same mapping the new Tee screen uses — `screens/Tee.tsx` `steps()` is the
   pattern). Progress rows for `downloading` (n/3 models), `executing` (steps if reported).
3. **Elapsed = `now − run.createdAt`**, server timestamps, survives refresh trivially.
4. **Terminal honesty.** `failed` → show `failure.message` prominently + what was charged
   (should be 0 on pre-execution failure — reservation released) + a retry affordance.
   `complete` → exitus render (already works on Card).
5. This spec is the *surface* half of the drafted Nuntius system
   ([[project_runner_status_nuntius]], spec 2026-06-22, unbuilt). If implementing Nuntius
   proper is the cleaner cut, do that — but the minimum bar is: phases stream to the browser,
   elapsed survives refresh, failure shows.

## Acceptance
- Watching a cold-start run: stepline advances through provision → download (with n/N) →
  execute → terminal, no refresh needed.
- Mid-run refresh: elapsed continues from `createdAt`, current phase restored (SSE reconnect
  or first poll).
- A failing run (torch-drift class) shows the error message within seconds of the webhook,
  with 0 charged.
- Hermetic: event bridge unit test (cursor report → SSE frame), projection carries what the
  UI needs; docs-drift green if contract changed.

## Leads
- `src/allocutio/api/RunEventHub.ts`, `runEvents.ts`, `apiRouter.ts:168` (SSE route).
- `POST /runner/status` sink: `src/index.ts:1176` (`reportProgressus`).
- `src/allocutio/api/runProjection.ts:36` (`toRun`) — projection fields.
- Screens: `src/platforms/web/app/src/screens/Run.tsx`, `Card.tsx:156` (poll loop),
  `Tee.tsx` (Phasis→stepline mapping to reuse).
