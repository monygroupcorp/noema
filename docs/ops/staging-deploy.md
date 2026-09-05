# Staging Deploy — Runbook (source of truth)

**staging.noema.art** serves the **crystal server** (`dist/index.js` ← `src/index.ts`),
which serves BOTH the `/v1` API and the **new React frontend** (`src/platforms/web/app`).
One container, one process.

## The facts (so nobody has to re-discover them)

- **Host:** `noema` in `~/.ssh/config` (hostname `hyperbot`). It's a
  DigitalOcean droplet. `staging.noema.art` resolves here.
- **Source of truth for ops lives on the droplet at `/opt/noema/`** — NOT in the repo,
  NOT in `/root`. The repo copies and `/root/hyperbot/*` are stale.
  - **`~/deploy-staging.sh` (i.e. `/root/deploy-staging.sh`) is the command you actually run.**
    It's a thin wrapper: `cd /opt/noema && git pull` (pulls the latest ops config) then calls
    `/opt/noema/deploy-staging.sh`. **Always invoke the `/root` wrapper — do NOT run the inner
    `/opt/noema/deploy-staging.sh` directly** (it skips the `git pull`). (Incident 2026-06-19:
    running the inner script directly recreated the container against stale state.)
  - `/opt/noema/deploy-staging.sh` — the inner script the wrapper calls (pulls the `:staging`
    image + recreates the container).
  - `/opt/noema/Caddyfile` — the live reverse-proxy config (mounted into `caddy_proxy`).
  - `/opt/noema/.env.staging` — the container env (**contains `STAGING_FRONTEND=1`**).
- **Container:** `hyperbot-staging` on docker network `hyperbot_network`, image
  `ghcr.io/monygroupcorp/noema:staging`.
- **Caddy:** `staging.noema.art { reverse_proxy hyperbot-staging:4000 }` (catch-all — both
  `/` and `/v1` go to the container).
- **The frontend gate:** the server serves the React app only when **`STAGING_FRONTEND=1`**
  (already set in `/opt/noema/.env.staging`). Without it, no frontend (legacy behavior).
  Serving code: `src/index.ts`, just before `app.listen` — `express.static(app/dist)` +
  an SPA fallback that skips `/v1|/api|/webhooks|/telegram|/widget`.

## Deploy flow (every change)

1. **Build:** push to the `staging` branch → CI (`.github/workflows/staging.yml`) builds and
   pushes `ghcr.io/monygroupcorp/noema:staging`. (Staging tracks `chainengine-migration`;
   a push is a clean fast-forward — `git push origin HEAD:staging`.)
2. **Wait** for the build to go green: `gh run list --branch staging --limit 1`.
3. **Deploy (manual, on the droplet) — run the `/root` wrapper, NOT the inner script:**
   ```bash
   ssh noema './deploy-staging.sh'
   ```
   It pulls `:staging`, recreates `hyperbot-staging` with `.env.staging`, health-checks
   `/api/health`, and prints logs (look for `[web] serving React app from …`).
4. **Verify:** `curl -s -o /dev/null -w '%{http_code}\n' -H 'Accept: text/html' https://staging.noema.art/`
   should be `200`; `…/v1/flows` should be `200`.

## The web app

- Lives at `src/platforms/web/app` (Vite + React + TS). Built in its own Dockerfile stage
  (`app-builder`); `dist` copied to `src/platforms/web/app/dist` in the image.
- Talks to `/v1` **same-origin** in production (no proxy). The Vite proxy in
  `vite.config.ts` is **dev-only** (`npm run dev`, points at staging for convenience).
- Excluded from the backend `tsc` (root `tsconfig.json` `exclude`) — it has its own jsx tsconfig.

## Known drift to clean up (tracked)

- [ ] Repo `deploy-staging.sh` was stale (`crystal-staging`/`crystal_network`) — **fixed to
      match the live one** so it's no longer a footgun.
- [ ] Repo `Caddyfile` and `/root/hyperbot/Caddyfile` are stale; the live config is
      `/opt/noema/Caddyfile`. Consider making the repo the source and syncing on deploy.
- [ ] No auto-deploy. Optional: add an SSH step to `staging.yml` to run
      `/opt/noema/deploy-staging.sh` after the image push (needs a deploy key secret), so
      "push to staging = deployed."

## OFAC deposit screening (compliance)

Screening is on only when **both** of these hold. Either one alone is a NO-OP that clears
every address, so do not read one of them as evidence the gate is live.

1. **The private compliance module is mounted.** `src/compliance/SanctionsScreen.ts` in this
   repo ships only the port and the permissive stub; the real Set-backed screen and the SDN
   loader are not published here (ADR-0012 §49) and are bind-mounted into the container at
   deploy. `deploy.sh` does this for production; `deploy-staging.sh` and
   `docker-compose.prod.yml`'s `staging` service deliberately do not, so **staging always
   runs the permissive stub** no matter what its `.env.staging` says.
2. **`OFAC_BLOCKLIST_PATH` points at a non-empty list.** Set it to the bundled file:

   ```
   OFAC_BLOCKLIST_PATH=data/ofac-blocklist.json
   ```

If either is missing the container boots with a LOUD warning and screening is a NO-OP —
never leave it that way once real deposits flow.

**How to check, without exec-ing into the container:** `deploy.sh` reports both at the end
of every deploy — whether the mount is populated or empty, and, when it is populated,
whether `OFAC_BLOCKLIST_PATH` is set. An empty mount looks identical to a correct one from
outside, which is why the deploy says which case it was rather than leaving you to guess.

Freshness:
- `data/ofac-blocklist.json` is committed and **baked into the image**, so each deploy
  ships the list as of that build.
- The `Refresh OFAC blocklist` GitHub Action (`.github/workflows/ofac-blocklist.yml`)
  refreshes the file daily and commits changes to `main`, so the repo (and the next build)
  stays current. Run `npm run refresh:ofac` to update locally.
- **Between-deploy liveness (optional, more robust):** add a host cron on the droplet that
  runs the refresh into a path mounted into the container, so a new OFAC designation is
  picked up without waiting for a redeploy. The OFAC SDN crypto-list changes rarely (a few
  times a year), so the per-deploy + daily-commit baseline is adequate for launch.

## Production (for contrast)

`noema.art` / `app.noema.art` → `hyperbot:4000` (the prod container). Prod is **not** gated
to the new app (no `STAGING_FRONTEND`). Prod releases go through `release.sh` (main →
release-please → `:latest` → `deploy.sh`), a different path from staging.
