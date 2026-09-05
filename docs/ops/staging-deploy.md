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

**Staging always runs the permissive stub.** The real sanctions screen lives in the private
compliance module, which reaches a container as a deploy-time bind mount; `deploy-staging.sh`
and `docker-compose.prod.yml`'s `staging` service deliberately do not mount it, because staging
is not a deposit boundary. No value of `OFAC_BLOCKLIST_PATH` in `.env.staging` changes that, so
staging is not a place to test whether screening works.

The two preconditions for the screen actually being live, how to read them off a deploy's own
report, and how the blocklist stays fresh are in `docs/ops/production-deploy.md` under "OFAC
deposit screening (compliance)" — production is where the gate matters and where it is
configured.

## Production (for contrast)

`noema.art` / `app.noema.art` → `hyperbot:4000` (the prod container). Prod is **not** gated
to the new app (no `STAGING_FRONTEND`). Prod releases go through `release.sh` (main →
release-please → `:latest` → `deploy.sh`), a different path from staging.
