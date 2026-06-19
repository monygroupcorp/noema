# TEE WireGuard Tunnel — Debug Journal

**Dates**: 2026-06-13 → 2026-06-17
**Branch**: chainengine-migration
**Goal**: Browser↔GPU WireGuard tunnel on RunPod SECURE pods (no CAP_NET_ADMIN, no /dev/net/tun, no publicIp)

---

## Architecture in one picture

```
browser (WASM)
  asciimoth/socksgo client
  asciimoth/batchudp bind
  asciimoth/wgo WireGuard device
  asciimoth/gonnect-netstack/vtun (virtual TUN, no kernel module)
        |
        | WebSocket (wss://podId-8080.proxy.runpod.net)
        | RunPod SECURE HTTPS proxy
        v
pod:8080 — tee-wg-server
  asciimoth/socksgo SOCKS5+WS server  ←→  ProxySocks5UDPTun
  asciimoth/batchudp bind
  asciimoth/wgo WireGuard device
  asciimoth/gonnect-netstack/vtun
        |
        | HTTP (10.13.0.1:7998)
        v
runner.py (FastAPI, tunnel-only, unreachable from outside)
```

### Protocol: CmdGostUDPTun (0xF3)
Browser calls `ListenPacket("udp4", "0.0.0.0:0")` through the socksgo client.
Client sends SOCKS5 `CmdGostUDPTun` request over WebSocket.
Server binds a UDP listener, replies with its address.
`ProxySocks5UDPTun` runs bidirectionally: WS frame ↔ UDP packet to/from 127.0.0.1:51820 (the WG socket).

---

## Why this took so long — three stacked root causes

Each fix required: rebuild Docker image → push to registry → provision fresh RunPod SECURE pod → wait for boot → test → terminate. No way to hot-reload because RunPod caches `:latest` on the host. Every iteration costs real money.

---

### Root cause 1 — gost doesn't relay GostUDPTun packets

**Iteration count**: ~3–4 pod cycles before confirmation

**Setup**: `tee-wg-server` was a plain WireGuard binary. A separate `gost` process handled SOCKS5+WS on :8080 and was supposed to forward relayed UDP to `127.0.0.1:51820`.

**Symptom**: Zero WireGuard handshakes. `wg-server.log` showed only startup.

**Diagnosis**: Added `/debug/wglog` endpoint to `runner.py` to read `wg-server.log` without going through the tunnel. Queried it through a local `gost` tunnel to the pod's SOCKS5 proxy.

**Finding**: gost v3.2.6 accepts `CmdGostUDPTun` (0xF3) sessions at the TCP level. It does NOT forward the framed UDP packets downstream. The relay goroutine simply never runs for this command. Zero bytes ever arrived at the WireGuard socket.

**Fix**: Removed gost entirely. Rewrote `tee-wg-server/main.go` to embed a `socksgo.Server` directly:
```go
socks := &socksgo.Server{
    Auth:           (&protocol.AuthHandlers{}).Add(&protocol.NoAuthHandler{}),
    Handlers:       socksgo.DefaultCommandHandlers,
    PacketDialer:   osNet.PacketDial,
    PacketListener: osNet.ListenPacket,
    Dialer:         osNet.Dial,
}
```
Same library as the browser client → guaranteed protocol compatibility.

Removed gost from `Dockerfile` and `entrypoint.sh`.

---

### Root cause 2 — r.Context() cancelled immediately (goroutine bug)

**Iteration count**: ~2 pod cycles

**Setup**: Embedded socksgo server in `tee-wg-server`. WebSocket handler spawning a goroutine.

**Symptom**: Timing-out when trying to connect from local gost debug tunnel. wg-server.log still empty.

**Code that was wrong**:
```go
mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
    wsConn, _ := cws.Accept(w, r, ...)
    go socks.AcceptWS(r.Context(), wsConn, false)  // BUG
})
```

**Why it broke**: `http.Server` runs each handler in its own goroutine. Spawning another goroutine with `go` means the handler returns immediately. When the handler returns, `r.Context()` is cancelled. `cws.NetConn(ctx, conn, ...)` uses that context — the WebSocket is torn down before any SOCKS5 bytes exchange.

**Fix**: Remove `go`, block the handler:
```go
mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
    wsConn, _ := cws.Accept(w, r, ...)
    socks.AcceptWS(r.Context(), wsConn, false)  // blocks until session ends
})
```

**Subsidiary bug found in the same phase**: Field name `osNet.DialPacket` doesn't exist; correct is `osNet.PacketDial`. Compile error.

---

### Root cause 3 — IsUDPAllowed()=false, zero packets from browser

**Iteration count**: unknown (couldn't even confirm packets left the browser)

**Setup**: r.Context() fix deployed, socksgo server correct. wg-server.log showed startup but zero connection logs.

**Symptom**: `wgConnect` returned "tunnel up" (success). But nothing arrived at the pod. No WebSocket connections, no WireGuard packets, nothing.

**Diagnosis path**: No connection-level logging on server side, so couldn't distinguish "browser connected but WG didn't work" from "browser never connected at all". Added ws logging:
```go
log.Printf("ws: connection from %s path=%s", r.RemoteAddr, r.URL.Path)
log.Printf("ws: socks5 session started")
log.Printf("ws: socks5 session ended: %v", err)
```
Still seeing nothing in logs → packets never left the browser.

**Root cause trace**:

```
cfg.ProxyURL = "socks5+wss://podId-8080.proxy.runpod.net"
socksClient, _ := socksgo.ClientFromURL(cfg.ProxyURL)
```

`ClientFromURL` → `ClientFromURLObj` → `ClientFromURLObjSafe`:
```go
_, isTLS, isWS := internal.ParseScheme(u.Scheme)
// scheme = "socks5+wss" → isTLS=true (wss implies TLS)
client.TLS = isTLS  // true

// GostUDPTun NOT set — requires ?gost in URL
// InsecureUDP NOT set — requires ?insecureudp in URL
```

Then at Open() time, `batchudp.listenNet` calls:
```go
conn, err = s.network.ListenUDPConfig(ctx, listenConfig(), "udp4", "0.0.0.0:0")
```

Which eventually hits:
```go
func (c *Client) setupUDPTun5(ctx, laddr, raddr) (Socks5UDPClient, error) {
    if !c.IsUDPAllowed() {
        return nil, ErrUDPDisallowed  // <-- here
    }
    // ...
}

func (c *Client) IsUDPAllowed() bool {
    return !c.IsTLS() || c.InsecureUDP
    // = !true || false = false
}
```

`batchudp.Open()` receives `ErrUDPDisallowed` (not `EAFNOSUPPORT`) → returns error.
WireGuard's device.Up() swallows the bind failure, returns nil anyway.
`wgConnect` resolves "tunnel up" — browser thinks it's connected.
But WireGuard has no socket. Zero packets ever sent.

**The naming confusion**: `InsecureUDP` is named for the risk of plaintext UDP alongside an encrypted control channel. In GostUDPTun mode, UDP IS the control channel — it's tunneled inside the WSS stream. There is no separate plaintext path. The flag is safe here.

**Fix** (`tee/browser/main.go`):
```go
socksClient, err := socksgo.ClientFromURL(cfg.ProxyURL)
// ...
socksClient.Filter = nil
socksClient.GostUDPTun = true   // force Gost UDP TUN (else falls through to ErrUDPDisallowed)
socksClient.InsecureUDP = true  // UDP is tunneled through WSS, no plaintext risk
```

Also rebuilt `tee/browser/app.wasm`.

---

## Files changed across this whole run

| File | What changed |
|------|-------------|
| `tee/runner/Dockerfile` | removed gost download step |
| `tee/runner/entrypoint.sh` | removed gost startup |
| `tee/runner/runner.py` | added `/debug/wglog`, `/debug/netstat`, `wgServerLog` in ready signal |
| `tee/wg-server/go.mod` | added socksgo, batchudp, gonnect-netstack, wgo, coder/websocket |
| `tee/wg-server/main.go` | full rewrite: embedded socksgo server replaces gost; ws session logging |
| `tee/browser/main.go` | `GostUDPTun=true`, `InsecureUDP=true` after `ClientFromURL` |
| `tee/browser/app.wasm` | rebuilt |
| `src/allocutio/api/CrystalApi.ts` | `wgServerLog` in `RunnerReadySignal`; set `proxyUrl`/`endpoint` on session |

---

## Current state (2026-06-17) — session 1 end

All three root causes patched. `monygroup/tee-runner:latest` pushed with rc3 fix.
`tee/browser/app.wasm` rebuilt.

**Not yet verified end-to-end on RunPod.** Need to provision a fresh pod and confirm:
1. wg-server.log shows `ws: connection from ...` (SOCKS5 session arrives at server)
2. wg-server.log shows `[tee-wg] peer ... handshake initiated/completed`
3. `wgRequest` through tunnel returns a response from runner.py

---

## Session 2 (2026-06-17) — Root cause 4 investigation

**Cost**: ~$10 in RunPod GPU time. Up to 3 pods ran simultaneously due to missing pod-kill discipline (stale sessions accumulating). **Process failure.**

### What was confirmed working
- Platform billing/metering: `economy.insufficient_signa` correctly raised when balance at zero.
- RunPod health check restart loop: fixed. Adding `/health` route and non-WS 200 fallback on `/` stopped the pod-restart-every-6-min cycle.
- `monygroup/tee-runner:latest` image is stable: pod starts once, stays up, wg-server serves correctly on :8080.
- Python SOCKS5+WS debug script (`/tmp/wg_debug.py`) reaches the pod's `/debug/wglog` endpoint reliably.

### Symptom after session 1 fixes
Browser reports "tunnel up" but no `ws: connection from ...` ever appears in wg-server.log.
WireGuard loops: "Sending handshake initiation (try N)" indefinitely.

### New finding: browser WASM not opening any WebSocket

Added `window.WebSocket` interceptor to `index.html` (installs before WASM runs, logs `[WS]` lines to UI panel). Result: **zero `[WS]` lines** during a full `wgConnect` → handshake-retry cycle.

The browser WASM never calls `window.WebSocket`, yet `dev.Up()` returns nil ("tunnel up").

### Narrowed culprit

`batchudp.Open()` calls `listenNet("udp4")` → `socksClient.ListenUDPConfig` → `ListenPacket` → `setupUDPTun5`. If `setupUDPTun5` opens a WebSocket, it must call `coder/websocket.Dial` → `wsjs.New` → `window.WebSocket.New(url, protos)`, which my interceptor would catch.

Either:
- `setupUDPTun5` is not being called (GostUDPTun not taking effect)
- OR `setupUDPTun5` is called but its WebSocket path is bypassed
- OR `Open()` is completing via a different code path in WASM that doesn't touch `window.WebSocket`

**Unresolved.** Investigation cut due to $10 cost overrun and simultaneous pod accumulation.

---

## Root cause 4 — systematic resolution strategy

### Diagnosis gap

All previous debugging was blind: no log until AFTER a real $3.29/hr RunPod pod boots. We need to close the observability gap locally before spending more pod cycles.

### Step 1 — Reproduce locally (zero cost)

Run `tee-wg-server` locally (not in RunPod, no GPU). It just needs Go — no CUDA.

```bash
cd tee/wg-server
WG_PRIVATE_KEY=$(wg genkey) WG_CLIENT_PUBKEY=$(wg genkey | wg pubkey) go run . &
```

Now the server is on `ws://localhost:8080`. Change `proxyUrl` to `socks5+ws://localhost:8080` in the browser (or serve `index.html` locally with a dummy session that hardcodes that URL). No RunPod, no cost, instant restart.

### Step 2 — Add WS probe to index.html BEFORE wgConnect

The `window.WebSocket` interceptor proved zero WS calls happen. The next question is: does `batchudp.Open()` even try? Add this after `wgGenerateKeys` resolves and before `wgConnect` is called:

```javascript
// Probe: does a manual WebSocket to the proxy URL open?
const probe = new WebSocket(proxyUrl.replace('socks5+wss://', 'wss://').replace('socks5+ws://', 'ws://') + '/');
probe.onopen  = () => { log('[PROBE] WS open — proxy reachable'); probe.close(); };
probe.onerror = () => log('[PROBE] WS error — proxy unreachable or CORS');
```

This isolates "is the proxy URL reachable from the browser" from "does the WASM code path work".

### Step 3 — Verify GostUDPTun is actually set in the running WASM

The WASM is a binary blob. Grep it for the string `GostUDPTun` (Go compiler embeds field names in type info):

```bash
strings tee/browser/app.wasm | grep -i "gost\|insecureudp\|plaintext UDP"
```

If `"plaintext UDP is disallowed"` appears, the error string is compiled in. If `GostUDPTun` appears in metadata, the field is present. This proves the binary matches the source.

### Step 4 — Add explicit bind verification to wgConnect

After `dev.Up()`, before returning "tunnel up", send one WireGuard handshake initiation explicitly and confirm the WS connection appears at the server-side within 1 second. If it doesn't, fail loudly:

In `tee/browser/main.go`, add after `dev.Up()`:
```go
// Verify the bind actually opened a socket — dev.Up() doesn't surface bind errors.
// We can't call Open() directly but we can check that packets leave.
// For now: log immediately if no send path exists.
logLine("app", fmt.Sprintf("device up; bind type: %T", conn.NewDefaultBind(network)))
```

Better: expose a `wgBindStatus` function that returns whether `s.ipv4` is set on the bind, to directly confirm the UDP tunnel is wired.

### Step 5 — If WASM path is confirmed broken, switch to wss:// URL query parameters

socksgo's `ClientFromURL` supports `?gost&insecureudp` in the URL itself:
```
socks5+wss://host:port/?gost&insecureudp
```

The platform sets `proxyUrl` in `CrystalApi.ts`. Change:
```typescript
session.proxyUrl = `socks5+wss://${session.podId}-8080.proxy.runpod.net`
```
to:
```typescript
session.proxyUrl = `socks5+wss://${session.podId}-8080.proxy.runpod.net/?gost&insecureudp`
```

Then `ClientFromURL` sets `GostUDPTun=true` and `InsecureUDP=true` from the URL query. This bypasses the manual field-set in `main.go` and removes the dependency on compile-time state.

### Step 6 — Only then test on RunPod

Only spin a pod once steps 1–5 confirm the tunnel handshakes locally. Expected: one pod, one session, WS connection appears in wg-server.log within 5 seconds of wgConnect.

### Pod discipline (non-negotiable from here)
- Kill the current pod BEFORE provisioning a new one, without exception.
- The platform must not issue a new `TeeProvisioner.provision()` call if an active session exists for the same animaId. Check `TeeProvisioner.ts`.
- Add a TTL to sessions: if runner heartbeat stops, terminate the pod via the RunPod REST API automatically.

---

## Session 3 (2026-06-17) — Local end-to-end verification (PASS)

**Cost**: $0. No pods. All work on localhost.

### What was done

1. **Native Go test** (`tee/native-test/`): full end-to-end in pure Go. No browser, no WASM. Server subprocess + socksgo GostUDPTun client + WireGuard device. Confirmed handshake completes. PASS.

2. **Playwright headless Chromium test**: served `index.html` on `:19000`, ran actual WASM in headless Chromium against local tee-wg-server on `:18088`/`:15182`. All five checks passed:
   - WS probe reachable ✓
   - WASM WS open attempt ✓ (the `window.WebSocket` interceptor fired from WASM)
   - WASM WS connected ✓
   - Tunnel up ✓
   - WG handshake — `peer(kaoi…2a2c) - Received handshake response` ✓

### Root causes that turned out NOT to be real

After the previous session concluded "WASM never opens a WebSocket (root cause 4)", investigation revealed:

1. **`teeLog` doesn't call `console.log`** — all `[WS]`, `[PROBE]`, and `[UI]` log lines went to the DOM log panel only. Playwright's `page.on('console')` listens to `console.log`, not DOM mutations. So "no `[WS] open attempt` in Playwright output" didn't mean the WebSocket never opened — it meant the observer was blind. Fixed: `window.teeLog` now also calls `console.log`.

2. **WS probe URL double-slash** — `proxyUrl.replace(/\?.*$/, '') + '/'` on `socks5+ws://host:port/?query` gives `ws://host:port//` (double-slash). Server responded 307. Fixed: strip trailing slash before appending: `base.replace(/\/$/, '') + '/'`.

3. **Wrong WG peer endpoint** — `localConnect()` hardcoded `127.0.0.1:51820` but the browser test server listened on port 15182. WG packets were being tunneled to port 51820 (nothing listening). Handshake initiation sent but no response possible. Fixed: added `#localPeerEndpoint` field to Section 0 with configurable endpoint; Playwright fills it with the correct port.

### What this proves

GostUDPTun is working correctly in the WASM build. The code path from `batchudp.Open()` → `socksgo.ListenUDPConfig` → `setupUDPTun5` → `coder/websocket.Dial` → `window.WebSocket.New` is intact and functional.

The "root cause 4" from the previous session was a **test instrumentation gap**, not a code bug.

### Files added/changed in session 3

| File | What changed |
|------|-------------|
| `tee/native-test/main.go` | new — full native Go end-to-end test |
| `tee/native-test/go.mod` | new — module for native test |
| `tee/browser/index.html` | `teeLog` → also `console.log`; probe URL double-slash fix; `#localPeerEndpoint` field; `peerEndpoint` reads from field |

---

---

## Session 4 (2026-06-18) — Autonomous test loop; server confirmed working

### Problem with previous debugging approach

Every iteration required: push image → user spins pod → user waits → user copies logs into chat → I analyze → propose fix → repeat. Pod sits burning GPU cash while I think. No way to close the loop fast.

### New approach: autonomous test script

`tee/scripts/test-runpod.mjs` — runs entirely without user involvement:
1. Provisions a RunPod SECURE pod via REST API
2. Polls for runtime
3. Tests: HTTP health, wglog, WS upgrade, SOCKS5 handshake, wglog after
4. Terminates the pod
5. Prints a verdict

Run it:
```bash
export RUNPOD_API_KEY=...
node tee/scripts/test-runpod.mjs
```

Optional env:
- `TEE_IMAGE` — Docker image (default: `monygroup/tee-runner:0617b`)
- `GPU_TYPE_ID` — RunPod GPU type
- `PLATFORM_CALLBACK` — URL for runner/ready (default: staging.noema.art)

### Why previous pods had empty wglogs

`entrypoint.sh` redirects tee-wg-server via `>/tmp/wg-server.log 2>&1`. In some container environments this fd redirect is silently lost. Fixed in `0617b` by having the Go binary open the file explicitly:

```go
if lf, err := os.OpenFile("/tmp/wg-server.log", os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644); err == nil {
    log.SetOutput(io.MultiWriter(os.Stderr, lf))
}
```

### Why previous pods may have used stale images

We were pushing to `:latest`, which RunPod caches on its hosts. A new pod on a previously-used host gets the old image. Fixed by using versioned tags (`monygroup/tee-runner:0617b`) which force a fresh pull every time.

### First autonomous test result (pod x22wdiklmw0jl9, image 0617b)

```
HTTP /health      : OK
wglog before WS   : HAS CONTENT         ← log fix working
WS upgrade /       : UPGRADED (101)      ← WebSocket works
WS upgrade /ws-test: UPGRADED (101)
SOCKS5 over WS    : (pending)
wglog after WS    : HAS CONTENT

Server: cloudflare   ← this pod goes through Cloudflare (not RunPod's nginx)
Upgrade header forwarded correctly — no stripping on this pod
```

Wglog after WS tests showed:
```
http: GET / Upgrade="websocket" WsKey=true from=100.64.1.64:52638
ws: connection from 100.64.1.64:52638 path=/
ws: socks5 session started
ws: socks5 session ended: EOF
```

**Upgrade header was NOT stripped** on this pod. Different RunPod hosts route differently: some through Cloudflare (Upgrade forwarded), some through RunPod's own nginx (Upgrade stripped). Our restoration fix (`Upgrade="" + WsKey present → restore`) handles both cases.

### Current state

Server-side fully confirmed working on image `0617b`:
- ✅ tee-wg-server starts and logs correctly
- ✅ WS upgrade returns 101
- ✅ SOCKS5 session opens and closes cleanly
- ✅ SOCKS5 handshake (NoAuth `05 01 00` → `05 00`) — confirmed on pod 4ylikpi3cpjggq
- ❓ WireGuard handshake — requires full WASM client

**Next**: browser test against platform configured with `TEE_IMAGE_ID=monygroup/tee-runner:0617b`.
Set on the droplet's `.env`, then `./deploy-staging.sh`. Start a TEE session. If wglog shows
`ws: socks5 session started`, the tunnel is working end-to-end.

---

## Open unknowns after verification

- RunPod's HTTPS proxy: will it keep WebSocket alive for the lifetime of a long WG session? Any idle timeout?
- Does `batchudp` udp6 path cause issues in browser WASM? (Guarded by `singleStackUDPNetwork` returning `EAFNOSUPPORT` for udp6)
- WireGuard peer `allowed-ips` set at pod boot from `WG_CLIENT_PUBKEY` env — does the client key match what the browser generates? (Platform sets `WG_CLIENT_PUBKEY` from the connect request)
- Hardware attestation (deferred — Phase 3, separate TEE-capable hardware)

---

## Session 5 (2026-06-18) — Chrome h2 ALPN hypothesis investigated; server-side fully proven

### What was tested

Improved the autonomous test script (`tee/scripts/test-runpod.mjs`) with:
- Multi-GPU fallback: `GPU_TYPES` array (RTX 4090 → RTX 3090 → RTX A4000)
- Health retry loop after pod-running event (polls `/health: 200` before starting tests)
- Chrome simulation test: establishes h2 TLS connection, reads `SETTINGS_ENABLE_CONNECT_PROTOCOL`, then does a separate `http/1.1`-only WS upgrade to simulate Chrome's fallback

Ran two successful tests on RTX 4090 pods (`2bzyt254fvjbwc`, `eif4001igchy6x`).

### h2 ALPN hypothesis: DEBUNKED

**Hypothesis going in**: Chrome offers `['h2', 'http/1.1']` in ALPN → Cloudflare selects h2 →
`SETTINGS_ENABLE_CONNECT_PROTOCOL=0` → Chrome can't do h2 Extended CONNECT → WS fails →
Chrome falls back to http/1.1 but re-offers `['h2', 'http/1.1']` → infinite loop → 1006.

**Result from Chrome simulation test**:
```
h2 ALPN negotiated: h2
SETTINGS_ENABLE_CONNECT_PROTOCOL: NOT SET (=0)
h1 fallback WS result: UPGRADED (101)   ← WS succeeds on http/1.1 fallback
h1 fallback ALPN: http/1.1
detail: SETTINGS_ENABLE_CONNECT_PROTOCOL=0 → Chrome falls back to http/1.1 → WS succeeds ✓
```

Chrome's h2→http/1.1 WS fallback opens a NEW TLS connection with ALPN=`['http/1.1']` only.
Cloudflare respects the http/1.1-only ALPN, returns 101. The theory was wrong.

### Current confirmed state with image 0617b

```
HTTP /health                : OK
wglog before WS             : HAS CONTENT
WS upgrade / (http/1.1)     : UPGRADED (101)
Chrome sim (h2→h1 fallback) : UPGRADED (101)  [ENABLE_CONNECT=0, h1ALPN=http/1.1]
WS upgrade /ws-test         : UPGRADED (101)
SOCKS5 over WS              : OK — NoAuth accepted (05 00)
wglog after all tests       : HAS CONTENT
```

**Server-side is fully working.** All known failure modes are eliminated. The browser 1006
failures from previous sessions were with a pre-0617b image (gost-based SOCKS5, Upgrade header
stripping). Image 0617b has:
- Integrated socksgo server (same library as WASM client, guaranteed protocol compatibility)
- Upgrade header restoration when RunPod proxy strips it
- io.MultiWriter direct log file write (belt-and-suspenders alongside shell redirect)

### RTX 3090 timing issue (test-only)

RTX 3090 pods returned 404 at 6 seconds after pod-running event. Root cause: RunPod marks a pod
as `RUNNING` when the container starts, not when tee-wg-server binds port 8080. On slower machines
or cold image pulls, 6 seconds isn't enough.

**This does NOT affect the platform**: the platform waits for the `/runner/ready` callback from
runner.py, which fires ~3 seconds AFTER tee-wg-server starts. By then, port 8080 is always bound.
Fixed in the test script only (health-check retry loop).

### Next: browser test

**Action required** — on the staging droplet:
```bash
# Verify TEE image is set
grep TEE_IMAGE_ID /opt/noema/.env
# If not monygroup/tee-runner:0617b, update and restart:
# TEE_IMAGE_ID=monygroup/tee-runner:0617b
```

Then open `https://staging.noema.art/tee` in Chrome. Expected success log:
```
[PROBE] WS reachable ✓        ← WS layer confirmed
tunnel connected — tunnel up  ← wgConnect resolved
[WG/DEBUG] handshake ...      ← WG handshake (after first traffic)
```

If the probe fires `[PROBE] WS unreachable`, the server is down or the image is wrong.
If wgConnect times out on vtun, something in the WASM path is broken.
If it says "tunnel up" but requests fail, the WG handshake didn't complete.

---

## Session 6 (2026-06-18) — End-to-end browser tunnel CONFIRMED

### Result

Full browser→pod tunnel working in Chrome against a live RunPod SECURE pod (`2g46llpd55ahra`).

```
[WS] opened  → 2g46llpd55ahra-8080.proxy.runpod.net/    ← WebSocket up
[WG/DEBUG] UDP bind has been updated                      ← SOCKS5 GostUDPTun wired
[WG/DEBUG] peer(btOl…GjRc) - Sending handshake initiation
[WG/DEBUG] Interface state was Down, requested Up, now Up
[APP] tunnel up local=10.13.0.2 peer=btOlOVLIg3LO7y3lhILzTuDg2zPyml1AihMIcWoGjRc=
[WG/DEBUG] peer(btOl…GjRc) - Received handshake response  ← WG handshake complete
```

Then "Setup Model" was clicked with the default essentia (which has local machine paths).
Runner.py received the request and returned a 500 — confirmed by the JSON parse error:
`SyntaxError: Unexpected token 'I', "Internal S"... is not valid JSON`

This proves **HTTP through the WireGuard tunnel works**. The 500 is from the essentia
pointing to paths that don't exist on the pod (`/home/rth/projects/ai/llama.cpp/...`).

### Complete stack proven

| Layer | Status |
|-------|--------|
| Browser WASM load | ✓ |
| WG key generation | ✓ |
| Platform session provision (`/v1/sessions/tee`) | ✓ |
| RunPod pod boot + runner/ready callback | ✓ |
| WebSocket to pod (via Cloudflare, h2→h1 fallback) | ✓ |
| SOCKS5 GostUDPTun session | ✓ |
| WireGuard handshake | ✓ |
| HTTP request through tunnel → runner.py | ✓ |

### Staging server state

- Image: `ghcr.io/monygroupcorp/noema:staging` (built 2026-06-18T10:04 UTC)
- TEE image: `monygroup/tee-runner:0617b` (set in `/opt/noema/.env.staging`)
- Duplicate `TEE_IMAGE_ID` entries in `.env.staging` — last value wins in Node.js (0617b wins)
- All TEE routes live: `/v1/sessions/tee`, `/runner/ready`, `/runner/heartbeat`, etc.

### Next phase: runner.py model execution

The tunnel is done. What remains:

1. **Fix runner.py 500 → JSON**: Setup errors should return `{"error": "..."}` not a plain 500.
   FastAPI exception handler needed.

2. **Test with a real model on the pod**: The essentia needs paths that exist on RunPod.
   Options:
   - Download a model at setup time (slow but flexible)
   - Bake a small model into the Docker image
   - Mount a network volume

3. **Runner probe timeout**: `readyProbe` polls until the model server binds. Timeout is 120s.
   Need the model server to be reachable at `readyProbe` URL before that.

4. **Inference through tunnel**: Once setup returns `{"status":"ready","port":N}`, wgRequest
   to `http://10.13.0.1:N/v1/chat/completions` should stream tokens back.

---

## Session 7 (2026-06-19) — Inference path analysis + systematic fixes

### What was confirmed in session 7

Session 7 continued directly from session 6's confirmed browser→tunnel→runner.py HTTP path.
Setup Model was clicked. The model downloaded successfully via `huggingface-cli`. Setup then
failed with:

```
setup failed: Error: {"error":"[Errno 2] No such file or directory: 'python'"}
```

This confirmed: HuggingFace GGUF download works. The `install[]` step (pip install) must have
also succeeded (or was fast enough). The failure was in the `launchTemplate` execution.

### Systematic gap analysis

Rather than chasing each error one at a time, a full gap audit was done against the
confirmed architecture before touching code.

**Gap 1: `python` not in PATH**
- Dockerfile installs `python3.11` + `python3-pip`. Binary is `/usr/bin/python3`, not `python`.
- `launchTemplate` calls `python -m llama_cpp.server ...`
- Fix: `ln -sf /usr/bin/python3 /usr/local/bin/python` in Dockerfile

**Gap 2: `pip` not in PATH**
- `python3-pip` installs `pip3` only. The install step calls `pip install ...`
- Fix: `ln -sf /usr/bin/pip3 /usr/local/bin/pip` in Dockerfile

**Gap 3: Inference port unreachable through tunnel** *(architectural)*
- `main.go` creates one reverse proxy: `vtun:7998 → localhost:7998`
- This is the ONLY bridge from the gVisor netstack to the real kernel network stack
- llama-server launched on `--host 0.0.0.0 --port 8000` binds to the real kernel stack
- Packets destined for `10.13.0.1:8000` through the tunnel arrive at the gVisor vtun but
  nothing is listening there — they are dropped
- The browser's `run()` was calling `http://10.13.0.1:{port}/v1/chat/completions` directly
- Fix: add `/infer/{essentiaId}/{path:path}` streaming proxy endpoint to runner.py;
  browser calls `http://10.13.0.1:7998/infer/{essentiaId}/v1/chat/completions`

**Gap 4: Install errors silent**
- `_run()` used `create_subprocess_exec` without capturing stderr
- On failure, only `rc=1` surfaced — no hint what went wrong
- Fix: capture stderr, include last 2000 chars in RuntimeError

### Files changed

| File | Change |
|------|--------|
| `tee/runner/Dockerfile` | Added `python` + `pip` symlinks in RUN step |
| `tee/runner/runner.py` | `_run()` captures stderr; added `/infer/{id}/{path}` streaming proxy |
| `tee/browser/index.html` | `launchTemplate` default → `python3`; `run()` uses proxy URL; `inferEssentiaId` tracked |

### Image

`monygroup/tee-runner:0619a` — pushed 2026-06-19

### Expected next test flow

1. Start Session → pod boots → runner/ready → WS probe → status=ready
2. Setup Model → pip install (llama-cpp-python wheel, ~30s) → download GGUF (~60s) → launch llama-server → readyProbe 200 → `{"status":"ready","port":8000}`
3. Run → `wgStream` → `http://10.13.0.1:7998/infer/qwen2.5-0.5b/v1/chat/completions` → runner.py proxy → `http://127.0.0.1:8000/v1/chat/completions` → SSE tokens stream back

### Remaining unknowns after this session

- Does `wgStream` (browser WASM) correctly handle SSE chunked responses through the tunnel?
  It's called with a streaming callback but has never been exercised end-to-end.
- Does the `/setup` HTTP call (blocking for 2-5 min during install+download+probe) timeout
  anywhere? `wgRequest` in the WASM may have a hardcoded timeout.
- RunPod WS proxy idle timeout: will Cloudflare keep the SOCKS5 WebSocket alive for a
  5-minute blocking setup call with no data flowing?

---

## Process lessons

**Tag images with commit SHA, not `:latest`**. RunPod caches `:latest` on the host. New pod, same host = old image. Tag `monygroup/tee-runner:$(git rev-parse --short HEAD)` and pass the tag to the RunPod API.

**Kill the old pod before testing a new one.** No exceptions. Check `runpod.io/console` before any new provision.

**Separate diagnostic path from the broken path**. When the SOCKS5 tunnel is broken, querying `/debug/wglog` through the SOCKS5 tunnel doesn't work. Need a healthcheck endpoint on a different port (or stdout-only diagnostics at boot that show in RunPod pod logs).

**Read library source before wiring**. `IsUDPAllowed()`, `GostUDPTun`, and the `?gost` URL parameter are all in `client.go`. 30 minutes of reading would have found root cause 3 before ever deploying to RunPod.

**Don't trust "tunnel up"**. WireGuard's `device.Up()` does not surface `Open()` failures to the caller. "Tunnel up" just means the vtun was configured, not that any socket exists. Add an explicit bind check at startup.

**Test locally first**. `tee-wg-server` runs locally with no RunPod dependency. There is no reason the WASM↔server path requires a cloud GPU pod to diagnose. Future sessions start with `go run ./tee/wg-server` on localhost.
