# Production Deploy — Runbook (source of truth)

**noema.art** / **www.noema.art** / **app.noema.art** currently serve the **legacy**
production container. This doc documents that legacy pipeline as it stands today, and
records the resolved plan for cutting production over to the new crystal server + React
frontend (the app that `docs/ops/staging-deploy.md` documents on staging).

## The facts (so nobody has to re-discover them)

- **Host:** `noema` in `~/.ssh/config` (hostname `hyperbot`). Same
  DigitalOcean droplet that hosts staging. `noema.art`, `www.noema.art`, and
  `app.noema.art` resolve here.
- **Container:** `hyperbotcontained` (network alias `hyperbot`) on docker network
  `hyperbot_network`, image `ghcr.io/monygroupcorp/noema:<VERSION>` (default `:latest`).
  Deployed/managed by `deploy.sh` (repo root) — a blue-green swap script, run on the
  droplet.
- **Caddy:** `caddy_proxy` container, reverse-proxying `noema.art`/`www.noema.art`/
  `app.noema.art` → `hyperbot:4000`, using `${DEPLOY_ROOT}/Caddyfile` on the droplet.
  **The repo copy of `Caddyfile` is stale** (see `staging-deploy.md`'s equivalent note) —
  the live config is `/opt/noema/Caddyfile` on the droplet, not the repo copy. This item
  documents that location; it does not edit either Caddyfile.
- **Production is NOT gated to the new app.** There is no `STAGING_FRONTEND`- or
  `PROD_FRONTEND`-style env flag on prod. Quoting `staging-deploy.md`'s own "Production
  (for contrast)" section: *"Prod is not gated to the new app (no `STAGING_FRONTEND`).
  Prod releases go through `release.sh` (main → release-please → `:latest` →
  `deploy.sh`), a different path from staging."* That remains true as of this writing —
  merging `chainengine-migration` into `main` is what changes it (see below).
- **Health endpoint:** `GET /api/health` → `{ ok: true, v: <BUILD_VERSION> }`
  (`src/index.ts:774`). Both the legacy and new app serve this identically; `deploy.sh`'s
  own health-check loop depends on it.

## Deploy flow (legacy pipeline, as it exists today)

1. **Release:** `./release.sh` — pushes the current branch (expects `main`), waits for
   the `release-please` PR to appear, and (with `--merge`) merges it. Merging that PR is
   the trigger for the next step.
2. **Build:** merging the release-please PR pushes a tag to `main`, which fires
   `.github/workflows/release-please.yml`'s `build-and-push` job — it builds the Docker
   image and pushes it to `ghcr.io/monygroupcorp/noema` tagged `:<version>`,
   `:<major>.<minor>`, `:<major>`, and `:latest`. (`.github/workflows/docker-publish.yml`
   is a separate, manual-only `workflow_dispatch` path for rebuilding a specific tag —
   not part of the normal flow.)
3. **Deploy (manual, on the droplet):**
   ```bash
   ssh noema
   ./deploy.sh <VERSION>     # e.g. ./deploy.sh 4.1.0, or ./deploy.sh for :latest
   ```
   `deploy.sh` is a blue-green swap: it pulls the image, enables a maintenance flag,
   loads the Ethereum signer key interactively (`keystore/loadKeystore.js`, requires a
   TTY), starts a new container (`hyperbotcontained-new`) alongside the old one, health
   -checks it against `http://hyperbot-new:4000/api/health` (80 retries × 5s by default),
   and only on success swaps the network alias from the old container to the new one,
   stops/removes the old container, and tags the deployed image `:previous` for rollback.
   If the health check fails, the new container is torn down and the old one keeps
   serving — "no downtime occurred" per the script's own log line.
4. **Rollback:** `./deploy.sh <previous-version>` (or `./deploy.sh previous` if the
   `:previous` tag was set by the last deploy) re-runs the same blue-green flow against
   the prior image.

## OFAC deposit screening (compliance)

Deposit screening is live only when **both** of these hold. Either one alone is a NO-OP
that clears every address, so do not read one of them as evidence the gate is on.

1. **The private compliance module is mounted.** `src/compliance/SanctionsScreen.ts` in
   this repo ships only the port and the permissive stub; the real Set-backed screen and
   the SDN loader are not published here (ADR-0012 §49) and reach the container as a
   read-only bind mount at deploy time. Both documented ways to start the prod bot carry
   that mount on the same `COMPLIANCE_DIR` default (`/opt/noema/private/compliance`):
   `deploy.sh`'s `docker run`, and `docker-compose.prod.yml`'s `bot` service. The
   `staging` service and `deploy-staging.sh` deliberately do not — staging is not a
   deposit boundary and always runs the stub, whatever its `.env.staging` says.
2. **`OFAC_BLOCKLIST_PATH` points at a non-empty list.** Set it in the production `.env`
   to the bundled file:

   ```
   OFAC_BLOCKLIST_PATH=data/ofac-blocklist.json
   ```

With either one missing the container boots with a loud warning — `OFAC sanctions
screening inactive (private compliance module absent or OFAC_BLOCKLIST_PATH unset) —
deposit screening is a NO-OP` — and every depositor clears. Never leave it that way once
real deposits flow.

**How to check, without exec-ing into the container:** `deploy.sh` reports both at the end
of every deploy — whether the mount is `POPULATED` or `EMPTY`, and, when it is populated,
whether `OFAC_BLOCKLIST_PATH` is set. An empty mount is indistinguishable from a correct
one from outside, which is why the deploy says which case it was rather than leaving you
to guess. An empty directory is not a failure on a dev box or a fresh droplet: the
fallback is deliberate, and the deploy names it out loud.

Freshness of the list:

- `data/ofac-blocklist.json` is committed and **baked into the image**, so each deploy
  ships the list as of that build.
- The `Refresh OFAC blocklist` workflow (`.github/workflows/ofac-blocklist.yml`) refreshes
  the file daily and commits it back to `main` when it changes, so the next build stays
  current. `npm run refresh:ofac` updates it locally.
- **Between-deploy liveness (optional, more robust):** a host cron on the droplet can
  refresh the list into a path mounted into the container, so a new designation is picked
  up without waiting for a redeploy. The OFAC SDN crypto list changes a few times a year,
  so the per-deploy plus daily-commit baseline is adequate for launch.

## Go-live: new app (merge-to-main cutover)

**Decision (operator, 2026-07-14):** the cutover mechanism is **merge-to-main**, not a
new feature flag.

- `chainengine-migration` merges into `main`. The existing `release-please.yml` trigger
  (`on: push: branches: [main]`) picks up the new app's code on its next tagged release
  — no new workflow, no new trigger.
- The existing `release.sh` → tag → `:latest`/`:<version>` image → `deploy.sh VERSION`
  flow deploys it **unchanged**. There is no new wrapper script and no new deploy
  command; step-by-step, it is identical to the "Deploy flow" section above.
- **No code change is required for this cutover.** Unlike staging (which is gated behind
  `STAGING_FRONTEND=1` in `src/index.ts`), there is no `PROD_FRONTEND`-style flag added
  anywhere. The merge itself is the gate: once the new app's code is on `main` and
  released, `deploy.sh` ships it as *the* production app, because it is now what `main`
  contains. This item makes no `src/index.ts` or `.env-example` change, by design.
- This item does **not** perform the merge, does not tag a release, and does not run
  `deploy.sh`. Cutover execution is an operator-attended event.

## Droplet takeover and legacy decommission

**Decision (operator, 2026-07-14):** DROPLET TAKEOVER — no second droplet, no
coexistence period. Operator verbatim: *"we're ready to take over the droplet when we
launch, we don't need to worry about the legacy once we're ready to take over."*

The new app's production traffic runs on the **same** droplet, same `hyperbot_network`,
same Caddy, same `hyperbotcontained`/`hyperbot` container name and alias already used by
legacy prod (and already proven out by staging's `hyperbot-staging` sibling container on
this droplet). At cutover, the new app *becomes* what `deploy.sh` deploys as
`hyperbotcontained` — there's no separate "new app container" to stand up.

Ordered decommission checklist, to run **only after** the cutover release's `deploy.sh`
health check has gone green against `/api/health` (step 7 of "Deploy flow" above) and the
new app has served real traffic cleanly for an **operator-defined soak window** (do not
assume a specific number of hours/days — the operator sets this at go-live time):

1. Confirm `deploy.sh`'s blue-green swap completed (`hyperbotcontained` is running the
   new image; `docker logs hyperbotcontained` shows the new app, not the legacy one).
2. Confirm the soak window has passed and `noema.art`/`www.noema.art`/`app.noema.art`
   have been serving the new app without incident.
3. Identify and stop/remove anything that was legacy-only dead weight — from reading
   `deploy.sh`, the deploy pipeline as it exists today manages a **single** app
   container (`hyperbotcontained`) plus Caddy; the script's own header notes *"the
   legacy export/training/sweeper worker containers were removed with the JS nuke"*, so
   there is no separate legacy worker fleet left to tear down on this droplet as of this
   writing. Re-verify this on the droplet at decommission time (`docker ps -a`) in case
   anything was added since — do not assume the script's comment is still exhaustive.
4. Leave `deploy.sh`'s `:previous` image tag in place (it's the rollback path — removing
   it removes the safety net; `docker image prune` in the script only prunes *unused*
   images, so `:previous` survives normal deploy cycles).
5. No cron/systemd units are known to be legacy-app-specific on this droplet as of this
   writing (nothing in `deploy.sh` or `staging-deploy.md` references any); confirm on
   the droplet before assuming there's nothing to remove.

## Monitoring

Two checks already exist in the repo, independent of any decision in this item:

- **`GET /api/health`** (`src/index.ts:774`) — `{ ok: true, v: <BUILD_VERSION> }`.
- **`deploy.sh`'s own health-check-before-swap loop** (`health_check_app`, ~80 retries ×
  5s against `http://<alias>:4000/api/health`) — already gates every deploy; a failed
  health check aborts the swap with no downtime, per the "Deploy flow" section above.

**Decision (operator, 2026-07-14):** minimal v1 monitoring bar — an `/api/health` poll
loop plus an `ntfy` push on outcome (deploy result and/or health-check failure), mirroring
the ntfy-on-result pattern already used elsewhere in this operator's infra. This is
documented here as a **copy-pasteable shell pattern only** — it is NOT added as a script
file to this repo and NOT wired into `deploy.sh` by this item:

```bash
# Minimal prod health/ntfy loop — run manually or from a droplet-side cron/systemd
# timer, NOT part of this repo. Set NTFY_TOPIC to a private ntfy.sh topic.
NTFY_TOPIC="<your-topic>"
URL="https://noema.art/api/health"

if curl -sS -f -m 10 "${URL}" >/dev/null 2>&1; then
  curl -d "noema prod: health check OK" "ntfy.sh/${NTFY_TOPIC}" >/dev/null
else
  curl -d "noema prod: health check FAILED (${URL})" "ntfy.sh/${NTFY_TOPIC}" >/dev/null
fi
```

```bash
# Deploy-result notification — run by hand right after ./deploy.sh, or wrap the
# invocation: `./deploy.sh 4.1.0 && curl -d "noema prod: deploy 4.1.0 OK" ntfy.sh/<topic>
# || curl -d "noema prod: deploy 4.1.0 FAILED" ntfy.sh/<topic>`
```

**Explicitly deferred to post-launch, out of scope for this item:** an external uptime
service, error tracking, dashboards, or any automated wiring of the above snippets into
`deploy.sh` or a droplet-side scheduler. This item documents the pattern; it does not
stand it up.

## Launch checklist

Only items backed by facts established above:

- [ ] `chainengine-migration` merged into `main` (Go-live section) — operator-attended,
      not performed by this item.
- [ ] `release-please` PR created off that merge, reviewed, and merged (`./release.sh
      --merge` or manually) — triggers the image build.
- [ ] Image build (`release-please.yml`'s `build-and-push` job) green;
      `ghcr.io/monygroupcorp/noema:<version>` and `:latest` published.
- [ ] `ssh noema && ./deploy.sh <VERSION>` run; `deploy.sh`'s own health check against
      `/api/health` passed (blue-green swap completed, not aborted).
- [ ] OFAC deposit screening confirmed live from that deploy's own report — it logged
      `Compliance mount POPULATED` and did **not** log the `OFAC_BLOCKLIST_PATH is not
      set` note (see "OFAC deposit screening"). Real deposits must not open before this
      line is checked.
- [ ] Soak window (operator-defined at go-live time) observed with no incident on
      `noema.art`/`www.noema.art`/`app.noema.art`.
- [ ] Legacy decommission checklist (above) executed in order, after the soak window.
- [ ] Minimal ntfy monitoring pattern (above) in place — health-poll loop and/or
      deploy-result notification running somewhere (droplet cron/systemd or manual).
- [ ] Rollback path confirmed: `./deploy.sh previous` (or the prior explicit version)
      available via `deploy.sh`'s `:previous` tag, in case the launch needs to be
      reverted.
- [ ] DNS/TLS confirmed live (see below) — operator to confirm before go-live.

## DNS/TLS

**Not verified by this item.** Whether Caddy has actually issued valid TLS certificates
for `noema.art`/`www.noema.art`/`app.noema.art`, and whether DNS truly resolves to the
droplet for all three, requires a live check against the droplet (`ssh noema` plus a
cert/DNS check, e.g. `curl -vI https://noema.art` or inspecting Caddy's cert store) —
this item is a worktree-isolated documentation change and cannot safely perform a live
check. **Operator to confirm before go-live.**
