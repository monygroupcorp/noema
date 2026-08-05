# TEE WireGuard Tunnel — Handoff

**Date**: 2026-06-17  
**Branch**: chainengine-migration  
**Status**: All known bugs fixed. Not yet verified end-to-end on RunPod. Pick up here.

---

## Victory condition

Browser opens `tee/browser/index.html` → clicks Start Private Session → WireGuard tunnel
establishes through RunPod SECURE pod → `/setup` through tunnel succeeds → inference streams.

That is the complete test. Everything below is how to get there.

---

## What's deployed and ready

| Thing | State |
|-------|-------|
| `monygroup/tee-runner:latest` | Pushed 2026-06-17. All three WG bugs fixed. |
| `tee/browser/app.wasm` | Rebuilt 2026-06-17. `GostUDPTun=true`, `InsecureUDP=true` set. |
| `tee/browser/index.html` | Full UI: keygen → provision → poll → wgConnect → setup → infer. |
| Platform (`src/`) | `handleRunnerReady` sets `proxyUrl`/`endpoint` correctly. Routes wired at `/v1/sessions/tee` and `/runner/ready`. |

**The three bugs that were killing handshakes** (all fixed, see `docs/spikes/tee-wg-debug.md` for detail):
1. gost v3.2.6 accepted CmdGostUDPTun connections but silently dropped packets → replaced with embedded socksgo server
2. `go socks.AcceptWS(r.Context(), ...)` in goroutine → r.Context() cancelled immediately → removed `go`
3. `socks5+wss://` URL sets IsTLS=true → IsUDPAllowed()=false → batchudp.Open() returns ErrUDPDisallowed, WireGuard has no bind, sends nothing → fixed with `GostUDPTun=true; InsecureUDP=true`

---

## Step 1 — Enable TEE provisioner on staging

SSH in and check `.env.staging`:

```bash
ssh root@64.227.15.104
grep -E "TEE_|RUNPOD" /opt/noema/.env.staging
```

These three vars must be set:

```
TEE_IMAGE_ID=monygroup/tee-runner:latest
TEE_PLATFORM_CALLBACK=https://staging.noema.art
RUNPOD_API_KEY=<from .env on local repo, or already in .env.staging>
```

The RUNPOD_API_KEY is in `/home/rth/projects/main/noema-crystal/.env` locally. If it's missing from `.env.staging`, add it. If the other two are missing, add them and redeploy staging.

---

## Step 2 — Deploy staging if needed

Platform routes are already in place. Only redeploy if you changed platform code.

```bash
# from local repo:
git push origin chainengine-migration:staging
ssh root@64.227.15.104 "cd /opt/noema && ./deploy-staging.sh"
```

---

## Step 3 — Serve the browser UI locally

```bash
cd /home/rth/projects/main/noema-crystal/tee/browser
python3 -m http.server 9000
```

Open http://127.0.0.1:9000/ in browser.

---

## Step 4 — Run the test

In the browser UI:

1. **Platform URL**: `https://staging.noema.art`  
2. **Auth token**: a valid animaId session token from staging (or leave blank if auth is bypassed in dev)  
3. **Click "Start Private Session"** — this does keygen → `POST /v1/sessions/tee` → polls until ready → `wgConnect`

The UI polls `GET /v1/sessions/tee/:id` every 5 seconds. Session goes `provisioning → ready` when the pod boots and calls back to `/runner/ready`. That callback sets `proxyUrl` and `endpoint` on the session.

Pod boot takes 60–120 seconds on RunPod SECURE. The UI will show "poll: status=provisioning" in logs.

**When the session is ready** the UI automatically calls `wgConnect` with:
```json
{
  "proxyUrl":        "socks5+wss://{podId}-8080.proxy.runpod.net",
  "localTunnelAddr": "10.13.0.2",
  "localPrivateKey": "<generated>",
  "listenPort":      0,
  "peerPublicKey":   "<from runner>",
  "peerEndpoint":    "127.0.0.1:51820",
  "peerAllowedIPs":  "10.13.0.1/32",
  "peerKeepalive":   25
}
```

---

## Step 5 — Read the logs

**Browser console / UI logs panel**: Look for WASM log lines. Key ones:
```
[APP] tunnel up local=10.13.0.2 peer=...
[WG/INFO] ...
[WG/DEBUG] ...
```

If you see `wgConnect` resolve "tunnel up" but nothing happens after — that's the old bug (fixed). With the fix, you should also see WireGuard debug output in the UI logs panel.

**Pod wg-server.log** — readable via:
```bash
# local gost tunnel to pod (replace PODID):
gost -L tcp://127.0.0.1:9001/127.0.0.1:7998 \
     -F "socks5+wss://PODID-8080.proxy.runpod.net:443"
curl http://127.0.0.1:9001/debug/wglog
```

Look for:
```
ws: connection from ...           ← SOCKS5 session arrived at server
ws: socks5 session started
[tee-wg] peer ... handshake initiated
[tee-wg] peer ... handshake completed
```

If you see `ws: connection from ...` but no handshake lines — WG packets are flowing but handshake is failing. Check peer public key mismatch.

If you see NOTHING in wg-server.log — SOCKS5 is not connecting. Check `proxyUrl` in the session response.

---

## What the platform endpoints do

```
POST /v1/sessions/tee
  body: { gpuClass, wgClientPublicKey }
  → returns { session: { sessionId, status: 'provisioning' } }

GET /v1/sessions/tee/:id
  → returns { session: TeeSessionView }
  → when ready: { sessionId, status: 'ready', serverPublicKey, endpoint, proxyUrl, tunnelIp }

POST /runner/ready          ← called BY the pod, not by browser
  body: { sessionId, endpoint, wgPublicKey, wgServerLog? }
  → sets session to 'ready', populates proxyUrl/endpoint

POST /runner/heartbeat      ← called BY the pod every 60s
POST /runner/ended          ← called BY the pod at shutdown
```

Auth on `/v1/sessions/tee` requires a valid animaId session. On staging you can get a token from the normal login flow. If you want to test without auth, temporarily bypass in apiRouter.ts (don't commit).

---

## If WG handshake succeeds but /setup fails

The `/setup` request goes through the tunnel to `http://10.13.0.1:7998/setup`. If it fails:

- **Connection refused**: runner.py not bound to 10.13.0.1:7998. Check `RUNNER_BIND` env in entrypoint.sh.
- **404**: runner.py started but something wrong with the endpoint path. Check runner logs via `/debug/wglog` (which also includes runner.py stdout if piped — it doesn't currently).
- **Timeout**: WG tunnel is up but routing to 10.13.0.1 isn't working. The vtun IP is `10.13.0.1/24` — allowed IPs on the browser side must include `10.13.0.1/32`.

The UI hardcodes `peerAllowedIPs: '10.13.0.1/32'` which is correct.

---

## Terminate the pod when done

Always terminate manually — pods are billed while running:

```bash
curl -X DELETE https://rest.runpod.io/v1/pods/PODID \
  -H "Authorization: Bearer $RUNPOD_API_KEY"
```

Or the session heartbeat will eventually stop and the pod may idle indefinitely.

---

## Key files

```
tee/browser/main.go          browser WASM source (GostUDPTun+InsecureUDP fix is here)
tee/browser/app.wasm         compiled WASM (serve alongside index.html + wasm_exec.js)
tee/browser/index.html       browser UI (full flow: keygen → provision → tunnel → infer)
tee/wg-server/main.go        Go binary in pod (socksgo server, WG device, vtun, HTTP proxy)
tee/runner/runner.py         FastAPI runner in pod (setup/stop/status, /runner/ready signal)
tee/runner/entrypoint.sh     pod PID 1 (keygen → wg-server → runner.py)
src/crystal/TeeProvisioner.ts RunPod pod provisioner (REST v1 SECURE pod creation)
src/allocutio/api/CrystalApi.ts  provisionTeeSession, handleRunnerReady, TeeSession state
src/index.ts                 /v1/sessions/tee routes, /runner/ready route
```

---

## If something is still broken

Diagnostics in priority order:

1. **Check staging logs** for `[tee] runner ready` → confirms pod called back and session transitioned
2. **Check wg-server.log via gost tunnel** → confirms SOCKS5 layer is working
3. **Browser WASM logs** → WireGuard debug output, any error from wgConnect
4. **Add more logging** if needed — both runner.py and wg-server.log get passed in the ready signal to staging logs

The debug journal at `docs/spikes/tee-wg-debug.md` has the full history of what was tried and why each fix was made. Read it before spending money on another pod cycle.
