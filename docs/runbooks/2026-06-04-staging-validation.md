# Staging validation — /arm provisioning + warm model-add (first real-GPU run)

**Date:** 2026-06-04
**Goal:** validate, on real RunPod hardware, the work built fake-first: the **/make gen path** still
delivers (regression on the comfyrunner refactor + `admitWarm`), **warm model-add** (comfyrunner
`POST /install`), and **/arm Start** (provision-only warm studio, A1/A2 real). This is the gate that
unblocks the second-runtime/co-hosting work (`memory/runtime-cohosting-gate.md`).

## Deploy pathway (GitOps)

1. Commit this work and **push to the `staging` branch** → `.github/workflows/staging.yml` builds +
   pushes `ghcr.io/monygroupcorp/noema:staging`.
2. On the **staging host**: `./deploy-staging.sh` → pulls `:staging`, swaps the `crystal-staging`
   container, health-checks `/api/health:4000`. Caddy fronts `staging.noema.art` (TLS).
3. `comfyrunner.py` ships to each pod over SSH at bootstrap — pod-side changes deploy with the next gen.

### Required `.env.staging` (real mode — NOT DEV_FAKE_POD)
`BOT_TOKEN`, `MONGODB_URI` (staging Atlas), `DB_NAME`, `PORT=4000`, `WEBHOOK_URL=staging.noema.art`,
`RUNPOD_API_KEY`, `RUNPOD_CLOUD_TYPE=SECURE`, `RUNPOD_KEEP_WARM=true`, `RUNPOD_WARM_TTL_MS` (bump
generously, e.g. 1800000, so an arming studio isn't reaped mid-config), `R2_*` (4 creds + public URL),
`RUNPOD_SSH_KEY_PATH` (default `~/.ssh/runpod`). **`DEV_FAKE_POD` must be UNSET.**

## Run list — ordered FASTEST-FAILURE FIRST (preserve capital)

Each tier is cheaper to fail than the next. Gate strictly: **do not advance a tier until the prior
is green.** All path-validation uses the SMALL models (SmolLM2 0.145GB, SD1.5 4.27GB); **FLUX (~34GB)
is saved for last** so you never pay its download to discover a plumbing bug. Keep the RunPod
dashboard open and **Destroy explicitly after each pod test** — don't trust the reaper alone for cost.

**Tier 0 — free, NO pod ($0 to fail here):**
- **0a Boot:** `docker logs -f crystal-staging` → "Listening on :4000"; `curl :4000/api/health` 200;
  Mongo connected; **NO "DEV_FAKE_POD active" warning** (confirms real mode).
- **0b Webhook reachability (do this BEFORE any pod):** from OFF the host,
  `curl https://staging.noema.art/api/health`. If the public URL isn't reachable, every gen will
  provision a pod and never receive completion → burnt $. This is the #1 capital leak — verify first.
- **0c Bot surface:** send a message; `/arm` opens the chooser showing **FLUX · SD1.5 · SmolLM2 ·
  Custom**; the model explorer browses; capability/conflict messages render. All pod-less.

**Tier 1 — cheapest pod op: provision-only, no gen, no big download (~1-3 min pod):**
- **/arm → SD1.5 → Proceed → ▸ Start studio** (or Start with nothing queued). Exercises
  `_provisionAndBootstrap`: RunPod provision → SSH → bootstrap → comfyrunner `/health`. The cheapest
  way to catch provisioning/SSH/bootstrap breakage. Watch: pod appears on the dashboard, SSH connects,
  `/health` ready, bulletin shows provisioning → found → warm, an idle `Materia` exists. **Destroy after.**

**Tier 2 — cheapest `/install` (tiny file, seconds):**
- On that warm studio, **Mod • → Add SmolLM2 (0.145GB)** → `Installing… → installed`; `POST /install`
  returns a tally, `installedModels` updates, no gen. Then optionally add **SD1.5 (4GB)** for a bigger
  `/install`. Validates the endpoint + per-dest lock cheaply.

**Tier 3 — full gen on the CHEAP model (~2-4 min pod):**
- **/make an SD1.5 gen.** End-to-end: cold start → comfyrunner `_ensure_models` download (validates the
  refactor) → inference → R2 upload → **webhook → result delivered**. ⚠ Watch `/tmp/comfyrunner.log`
  for download/lock errors; confirm the webhook hit `staging.noema.art/webhooks/runpod`.

**Tier 4 — admission gate (cheap):**
- Gen needing a small model not yet on a warm pod → it waits for the install, then runs (no
  double-download — the per-dest lock).

**Tier 5 — EXPENSIVE, last (only after Tiers 1-4 green, ~5-15 min pod):**
- **FLUX** — `/arm` Start FLUX or `/make` a FLUX gen → ~34GB download (24GB unet + 9.8GB T5-XXL).
  By now the plumbing is proven on SD1.5/SmolLM2, so this only confirms the big-model path works.

**Tier 6 — teardown:**
- Destroy → pod terminates; confirm the idle reaper sweeps a studio left past `warmUntil`. Then a
  **terminate-all sweep on the RunPod dashboard** to be sure nothing is left billing.

### Capital rules
- Gate tier-to-tier; never jump to FLUX to "just test it."
- Destroy after every pod test; moderate `RUNPOD_WARM_TTL_MS` (enough not to reap mid-arm-config,
  short enough that a forgotten pod dies) + manual Destroy.
- Cheapest GPU tier; the meter is ~$0.69/hr — a provision + small gen is cents, a FLUX download is the
  costly part.

## Known gaps / watch-items
- **Real progress streaming** from `/install` is not wired — `WarmPodClient.installModels` ignores
  `onProgress` on the real path (bulletin shows begin → end, not %). Cosmetic.
- **/arm host pairing:** `provisionStudio` is called without a `provisioningContext` (no Hospitium
  pairing / billing tier for arm-Started studios yet). Functional for validation; pairing is a follow-up.
- **Flow base models** (FLUX unet/vae/clip) are display-only in the loadout — `/arm` Start parks an
  empty studio; models arrive via the warm-add path. Base-models-at-boot is a separate gap.
- **`.env.fake` has live secrets committed** — rotate/remove before this is anything but throwaway.

## If green
The gate lifts: the second-runtime real runner (llama-server) + VRAM co-hosting become fair game.
If red, fix on staging before any runner work.
