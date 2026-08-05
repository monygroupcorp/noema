# /arm Part B — live model-apply E2E (fake mode)

**Date:** 2026-06-04
**Sprint:** `docs/plans/2026-06-04-arm-provisioning-live-apply-sprint.md` — Part B (B1–B4) + C.
**Mode:** `DB_NAME=noema_fake DEV_FAKE_POD=1 DEV_FREE_EXECUTION=1` — no GPU, no $.

## What shipped (fake-first with real seams)

- **B1** — `POST /install` on `scripts/pod/comfyrunner.py`: download-only model apply (no workflow),
  returns `{modelsDownloaded, modelsReused, downloadMs, downloadBytes}`. Idempotent (skips present,
  resumes partial). A per-dest download lock (`_download_model`) is shared with the job preflight so
  `/install` and `_ensure_models` never fetch the same file concurrently. *Verified only by
  `py_compile` — real download path needs a GPU pod.*
- **B2** — `installViaRunner()` + `InstallResult` (`comfyrunnerClient`); `installModels()` on
  `WarmPodClient` (real → `/install`) and `FakeWarmPodClient` (simulated); `ModelInstaller`
  (resolve ids → refs, install, set-union into `Materia.installedModels`).
- **B3** — Mod • Add on a **warm-idle** studio installs LIVE (background) and shows an
  `Installing: …` tail; on completion the loadout re-fetches to reflect `installedModels`. Adds
  before a pod exists still queue to **Standby** (decision 3).
- **B4** — `InstallCoordinator` serializes installs per pod; `RunPodCursor` admission gate awaits a
  pod's in-flight install before dispatching a gen that needs a not-yet-installed model.

## Fake-mode E2E

1. `/arm` → pick **FLUX** (＋) → **Proceed** → Mod • menu (loadout shows base + VAE/CLIP).
2. `▸ Start studio` → fake provisioner parks a warm `Materia` (status `idle`, `installedModels` =
   the loadout). Bulletin journals provisioning → found → resting warm.
3. Mod • → Add → pick a LoRA → bulletin shows **`Installing: <name>…`**, then it clears and the
   model lands in the loadout (`installedModels` updated). **No gen ran.**
4. (admission) Run a `/make` flux gen that needs a model not yet on the pod → the gen awaits the
   install (serialized with any in-flight live add) before the job preflight, then runs.

## Verification

- `python3 -m py_compile scripts/pod/comfyrunner.py` — OK.
- `tsc --noEmit` — 0 errors.
- `npx tsx --test 'tests/unit/allocutio/**/*.test.ts'` + crystal install tests — 222 pass.
- `npm run test:crystal` — 767 pass.
- New tests: `ModelInstaller.test.ts` (resolve→install→union, skip-unknown), `InstallCoordinator.test.ts`
  (per-pod serialization, ensureForGen dedupe, gen-awaits-live), `BulletinManager` warm-studio
  live-install routing, `BulletinView` Installing tail.

## Real-seam TODO (needs a GPU pod)

- `SecurePodClient.provision()` + `parkWarm` (Part A real) — fake provisioner still stands in.
- Verify comfyrunner `/install` against a live pod (download + idempotency + the per-dest lock under
  real concurrency).
- Real progress streaming from `/install` (today it returns a final tally; `WarmPodClient.installModels`
  ignores `onProgress` on the real path — the fake client honors it).
