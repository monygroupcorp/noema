# Spec — studio release endpoint (end the lease deliberately)

**Date:** 2026-07-10 · **For:** a repo-context agent on `noema-crystal` · **Status:** spec, not started

## Finding
A studio lease can only end passively — warm-window expiry (idle-pod reaper), budget drain
(`Census` drain-terminate), or provisioning failure. There is no way for the owner to say "I'm
done, stop the meter." The web Studio screen (wired 2026-07-10, `4448fda7`) had to ship without
a Release button and says so honestly. Every idle minute the user can't release = real pod
dollars.

## Goal
`DELETE /v1/studios/:id` — owner-scoped, idempotent: terminate the pod, settle the session,
free the remaining budget back to the balance, mark the host record terminated.

## Shape
1. **Conductor gains a public `release(studioId, auctor)`** (`src/crystal/Conductor.ts`) —
   mirror of the private `_fail` (Conductor.ts:194) plus the pod kill:
   - owner-scoped lookup (reuse `getStudio(studioId, auctor)`, Conductor.ts:216 — stranger
     gets null → 404 `not_found.studio`, no leak);
   - terminate the pod via `deps.terminate(podId)` (already in `ConductorDeps`,
     Conductor.ts:90) when a `materia`/pod is bound; tolerate already-gone pods;
   - `modos.update(studioId, { status: 'terminated', terminatum })`.
2. **Settle the session budget** — whatever `Census`/tessera settle does at drain-terminate,
   invoke the same path so unspent `maxImpetus` reservation is released (grep Census for the
   drain-terminate settle; do NOT invent a second settle path).
3. **CrystalApi `releaseStudio(auctor, id)`** next to `provisionStudio` (CrystalApi.ts:1980);
   route `DELETE /v1/studios/:id` in `apiRouter.ts` beside GET (apiRouter.ts:627); contract
   entry in `apiContract.ts` (StudioView already there ~:487); `npm run gen:api-docs`.
4. **Frontend**: `api.releaseStudio(id)` in `lib/api.ts`; "Release studio" button back on
   `screens/Studio.tsx` controls row (it existed in the mock; the wire removed it for honesty).
5. **Idempotency**: releasing a terminated/draining studio returns the terminal view, not an
   error (double-click safe).

## Acceptance
- Lease → release → `GET /v1/studios` no longer lists it; pod terminated on RunPod; balance
  reflects only actual metered spend.
- Releasing twice = 200 both times. Stranger's DELETE = 404.
- Hermetic tests for release + double-release + stranger; docs-drift green.

## Guardrail
Never test the live path against a real pod without the owner (GPU money); hermetic
DEV_FAKE_POD covers the loop.
