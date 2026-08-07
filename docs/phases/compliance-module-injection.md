# Compliance module injection (private module → production container)

The real OFAC sanctions screen and the CSAM/NCMEC moderation gate live in a **private, gitignored**
module at `src/private/compliance` (its own git repository, checked out into this repo's ignored
`src/private/` path — see ADR-0012 §49). This public repository ships only the ports plus
fail-closed / permissive **stubs**.

At boot, `src/index.ts` performs a guarded dynamic import of `./private/compliance/index.js`. The
path is held in a variable so a public build never statically resolves it. If the import fails, the
app logs a loud warning and runs on the stubs.

The image is built by GitHub Actions from a checkout of the **public** repo, where the module is
gitignored and therefore not in the build context. It can never arrive via the image. It is injected
at deploy time as a **read-only bind mount**, so the module reaches the container without ever
entering the published artifact.

`deploy.sh` mounts:

```
-v "${COMPLIANCE_DIR}:/usr/src/app/dist/private/compliance:ro"
```

`COMPLIANCE_DIR` defaults to `/opt/noema/private/compliance` on the host and is overridable by
environment variable. `deploy.sh` creates it if missing, so an unprovisioned host deploys normally.

## An empty mount is safe, and deliberately so

If `COMPLIANCE_DIR` is empty (dev box, staging, a fresh droplet), the dynamic import fails, the app
falls back to its stubs, and the existing warnings are logged — exactly the behaviour that predates
this mount. Nothing hard-fails. Do not "fix" the mount into a required dependency.

Because an empty mount looks identical to a correct one from outside the container, `deploy.sh`
logs which case occurred (`Compliance mount POPULATED` / `Compliance mount EMPTY`) after the swap.
Read that line rather than exec-ing into the container.

## Provisioning procedure

Run steps 1–2 on a machine whose checkout **contains** `src/private/compliance`; steps 3–5 on the
deploy host.

1. **Build.** The module is TypeScript; the runtime imports JavaScript. `tsconfig.json` has
   `"include": ["src/**/*"]` with `rootDir: src` / `outDir: dist`, and **tsc does not consult
   `.gitignore`** — so an ordinary build compiles the private module along with everything else:

   ```
   npm run build
   ```

   This emits `dist/private/compliance/*.js`. There is no separate build to invent.

2. **Verify the output exists** before copying anything:

   ```
   ls dist/private/compliance/index.js
   ```

3. **Copy the compiled directory** to the deploy host:

   ```
   rsync -a --delete dist/private/compliance/ <host>:/opt/noema/private/compliance/
   ```

   Copy the **compiled** `dist/private/compliance/`, never the TypeScript sources — the runtime
   imports `index.js`.

4. **Point the sanctions screen at its blocklist.** The mount alone is not enough:
   `configureSanctionsScreen` reads `OFAC_BLOCKLIST_PATH` and returns `null` when it is unset,
   leaving the permissive no-op screen active. Add to `/opt/noema/.env`:

   ```
   OFAC_BLOCKLIST_PATH=/usr/src/app/data/ofac-blocklist.json
   ```

   The blocklist file already ships **inside the image** (`data/ofac-blocklist.json`). It does not
   need mounting — only pointing at.

5. **Deploy** (`./deploy.sh`) and check the boot log (below).

### Dependencies

None to install. The module imports only Node builtins (`node:assert/strict`, `node:crypto`,
`node:fs`, `node:test`, `node:worker_threads`). `jimp` and `onnxruntime-node` are present in the
image's `node_modules` regardless.

## What this turns on — OFAC only

The private barrel exports four **independent** entry points — `configureSanctionsScreen`,
`configureModerationGate`, `configurePromptGuard`, `configureCsamReviewReporter` — and each returns
`null` unless its own configuration is present. Mounting the module therefore does **not** switch on
CSAM detection or the input prompt guard; with no hash set / classifier configured they stay `null`
and keep their current stubs, and public publishing remains fail-closed (`denyModerationGate`).

Turning those on is a separate, deliberate decision. Do not set `CSAM_HASHSET_PATH`,
`MODERATION_MANUAL_REVIEW` or `MODERATION_ALLOW_UNSCANNED` as a side effect of this procedure.

## Boot-log verification

After a deploy with a populated mount and `OFAC_BLOCKLIST_PATH` set, these lines must **disappear**:

```
OFAC sanctions screening inactive (private compliance module absent or OFAC_BLOCKLIST_PATH unset) — deposit screening is a NO-OP.
Private compliance module (src/private/compliance) not present — CSAM/NCMEC + OFAC screening unavailable in this build.
```

and the fail-closed publishing line must **remain**:

```
No CSAM/NCMEC scanner active (private compliance module absent or unconfigured) — public publishing (feed/marketplace) is DENIED (fail-closed).
```

Those two facts together are how you confirm the mount turned on OFAC *only*.

## Re-provisioning

The mount is **host state**, in the same class as `deploy.sh` itself on the droplet. Nothing
automates it:

- Whenever the private module changes, repeat steps 1–3 and redeploy. A deploy alone will **not**
  refresh it — the host directory is the source of truth for the container.
- A stale mount is silent. `deploy.sh` can report populated vs empty, not fresh vs stale.
- The blocklist data file is a separate concern; it ships in the image and is refreshed by rebuilding.
