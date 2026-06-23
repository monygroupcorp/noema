# Staging verify — runner-status #6 (Progressus is the sole status channel)

**Date:** 2026-06-23
**Branch shipped:** `chainengine-migration` → merged into `staging` (commit `2f677735`).
**Goal:** prove on real hardware that retiring the stringly `actum.stage` shim (#6e) did **not**
break any status consumer — the Telegram bulletin, the per-run SSE stream, the 🔥/👌 reaction, the
persisted `Actum.progressus` timeline + `phaseDurations`, and the derived `ActumExecutio` telemetry
in the wide event — now that **`actum.progressus` is the single channel** end-to-end (#6a–#6e).

Scope built in #6:
- **6a** cold-start records `Progressus` (provisioning/pulling) + pod identity.
- **6b** Telegram bulletin driven solely by `actum.progressus`; 🔥 reaction off the same.
- **6c** SSE (`GET /v1/runs/:id/stream`) emits a typed `progress` frame carrying the `Progressus`.
- **6d** `ActumExecutio` durations (provisionMs/downloadMs/executionMs) derive from `phaseDurations`.
- **6e** deleted `actum.stage`, `progressusToStage`, `emitStage`, `PodSession.onStage`,
  `BulletinManager.onStage`, the `'stage'` RunEvent kind, and `_handleActumStage`.

## Deploy pathway

1. ✅ Pushed `staging` → `.github/workflows/staging.yml` builds + pushes
   `ghcr.io/monygroupcorp/noema:staging` (~2–3 min).
2. On the staging host (`ssh root@64.227.15.104`): **`./stage.sh`** → pulls `:staging`, swaps the
   staging container. Interactive (keystore password via `/dev/tty`) — run it yourself.
   **Before restarting: confirm NO `/make` pod run is in flight** (check the RunPod dashboard) — a
   mid-run restart wastes GPU.
3. `comfyrunner.py` ships to each pod over SSH at bootstrap — pod-side changes deploy with the next gen.

URL: `staging.noema.art` · env `/opt/noema/.env.staging`.

## What changed for an observer (so you don't misread expected behavior as a bug)

- The Telegram bulletin animation is now driven by `actum.progressus`, not `actum.stage`. The on-screen
  result should be **identical** to before — silent hunt → **Found <gpu> for $<rate>/hr** → Initializing
  → downloading (n/m) → generating → saving → receipt.
- **Phase durations show real elapsed**, not the synthetic "in 30s / 4.5m" the fake used to inject.
  A "Found … in 0s" on a fast hunt is expected, not a regression.
- **The per-tick sampler % bar over SSE is gone by design** (§7 keeps per-tick live-only; one
  `actum.progressus` per sampler step would flood the Telegram render). SSE still emits a `progress`
  frame on every *phase/counter* transition. If a frontend wanted a smooth sampler bar it needs a
  separate throttled channel — out of scope.
- `RunEvent.kind` no longer includes `'stage'`. SSE frames are now `snapshot` → `progress` (typed) →
  `complete`/`failed`. A frontend still reading `ev.stage` must move to `ev.progressus.phase`.

## Run list — ordered FASTEST-FAILURE FIRST (preserve capital)

Gate strictly: do not advance a tier until the prior is green. Path-validation uses the SMALL model
(**SD1.5 4.27GB**); FLUX (~34GB) is saved for the download-counter test last. Keep the RunPod
dashboard open and **Destroy explicitly after each pod test**.

### Tier 0 — free, NO pod ($0 to fail here)

- **0a Boot:** `./log.sh` → "Listening"; `curl :4000/api/health` 200; Mongo connected. No unhandled
  errors referencing `actum.stage`, `onStage`, or `progressusToStage` (all deleted — a stray reference
  would surface as an import/throw at boot).
- **0b Contract:** `curl https://staging.noema.art/v1/openapi.json | jq '.paths."/v1/runs/{id}/stream"'`
  → the summary mentions **"progress/stage/complete/failed frames"** (the #6c contract line).
- **0c Webhook reachability (BEFORE any pod):** from OFF the host,
  `curl https://staging.noema.art/api/health`. If the public URL isn't reachable, every gen provisions
  a pod and never receives completion → burnt $. #1 capital leak — verify first.
- **0d Internal live feed (optional):** open the internal `/live` SSE (analytics/debug). It now
  forwards `actum.progressus` (not `actum.stage`). A later gen should stream `actum.progressus` frames.

### Tier 1 — COLD `/make` on SD1.5 (~2–4 min pod) — the core #6b + #6c + 6d proof

Run `/make` (SD1.5) from Telegram. Watch **three surfaces at once**:

1. **Telegram bulletin (6b — the headline):** the full animation must play and **not stall**:
   - "Provisioning…" during the silent hunt (this is the `provisioning`-no-pod → starting state),
   - **Found <gpu> for $<rate>/hr** when the pod locks (`provisioning`+pod),
   - Initializing → (model) downloading → generating → saving,
   - receipt with `N gen · exec ~Xs · $Y ea · $Z total`.
   - A frozen/blank bulletin or a cold start mis-rendered as warm ("keep cooking") = **FAIL** (the
     buffered-`provisioning` replay path, #6b register replay).
2. **SSE stream (6c):** grab the run id, then
   `curl -N -H 'x-api-key: <key>' https://staging.noema.art/v1/runs/<id>/stream`. Expect:
   `data: {"kind":"snapshot",...}` → several `data: {"kind":"progress","progressus":{"phase":...}}`
   frames (phases: provisioning → pulling → downloading{progress} → loading → executing → uploading)
   → terminal `data: {"kind":"complete",...}`. The stream **ends on complete**. No `"kind":"stage"`
   frames anywhere = correct.
3. **Persisted timeline + 6d (after completion):** `GET /v1/runs/<id>` and inspect the stored Actum.
   - `progressus[]` holds the ordered transitions (each with `at`), opening at **`provisioning`**
     (not `downloading` — the 6a cold-start fold).
   - `phaseDurations` is populated (`provisioning`, `downloading/model`, `executing`, …).
   - Wide event / analytics for this run carries **provisionMs, downloadMs, executionMs** — confirm
     they're present and sane (6d derives them from `phaseDurations` when the cursor didn't report
     them explicitly; comfyrunner reports executionMs explicitly so that stays exact).
   - **costUsd unchanged** — sanity-check it still equals `costPerHr × billedMs` (6d must not have
     moved cost; it rides `billedMs`, never `executionMs`).

### Tier 2 — WARM reuse (second `/make`, no destroy in between) — the 🔥 reaction (#6b/#6e)

Immediately `/make` again on the same chat while the pod is warm.
- The bot reacts **🔥** (warm), **not 👌** (cold). This is the migrated signal: warm reuse now emits a
  `provisioning` + `message:'warm pod reused'` Progressus, and `_handleActumProgressus` raises 🔥 off
  it. A 👌 on a warm reuse = **FAIL** (the reaction lost its signal in the shim retirement).
- Bulletin: **no second "Found" line** — straight to generating. `phaseDurations.provisioning ≈ 0`
  for this run (warm), so cold-vs-warm cost falls straight out of the data.

### Tier 3 — `/arm` Start (provision-only) — the direct-callback migration (#6e)

`/arm → SD1.5 → ▸ Start studio` (the path that runs OUTSIDE an actum trace).
- Bulletin: provisioning → **Found <gpu>** → Initializing → "ready to cook" (markReady), posted as a
  fresh message (push notification). This exercises `_startStudio` projecting the provisioner's string
  callback through `coldStartProgressus → session.onProgressus` — the one place that callback lands.
- A stalled/blank `/arm` bulletin = **FAIL** (the migrated drive). **Destroy after.**

### Tier 4 — FLUX cold `/make` (~34GB, expensive) — download counter fidelity (#6b/#6e)

Only after Tiers 1–3 are green. `/make` FLUX cold.
- Bulletin downloading line must **tick the (n/m) counter** as each model lands (not freeze at the
  first). This is the per-model `record({downloading, progress})` that replaced the deleted
  `emitStage('downloading:n/m')`. A frozen counter = **FAIL**.
- SSE `progress` frames should show `progressus.progress.done` advancing 0→…→total. **Destroy after.**

## Out-of-scope here (separate runners, verify only if convenient)

- **TEE** (#4): live session `phase` reflection over `/runner/status` — unchanged by #6 consumers.
- **ai-toolkit training** (#5): full `progressus[]` + `phaseDurations` persist via the poll runner;
  the docker spawn is the only CI-untestable piece (own live-verify, tracked in the spec).

## Pass criteria

All of: cold bulletin animates end-to-end (T1), SSE emits typed `progress` frames + terminal (T1),
`Actum.progressus`/`phaseDurations` persist and open at `provisioning` (T1), wide event carries
provision/download/execution ms with cost unchanged (T1), warm reuse → 🔥 (T2), `/arm` Start animates
(T3), FLUX download counter ticks (T4). Any frozen bulletin, a 👌-on-warm, or a missing/extra
`stage` SSE frame is a blocker — file against #6 before merging the branch onward.
