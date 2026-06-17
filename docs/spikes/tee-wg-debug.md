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

## Current state (2026-06-17)

All three root causes patched. `monygroup/tee-runner:latest` pushed with rc3 fix.
`tee/browser/app.wasm` rebuilt.

**Not yet verified end-to-end on RunPod.** Need to provision a fresh pod and confirm:
1. wg-server.log shows `ws: connection from ...` (SOCKS5 session arrives at server)
2. wg-server.log shows `[tee-wg] peer ... handshake initiated/completed`
3. `wgRequest` through tunnel returns a response from runner.py

---

## Open unknowns after verification

- RunPod's HTTPS proxy: will it keep WebSocket alive for the lifetime of a long WG session? Any idle timeout?
- Does `batchudp` udp6 path cause issues in browser WASM? (Guarded by `singleStackUDPNetwork` returning `EAFNOSUPPORT` for udp6)
- WireGuard peer `allowed-ips` set at pod boot from `WG_CLIENT_PUBKEY` env — does the client key match what the browser generates? (Platform sets `WG_CLIENT_PUBKEY` from the connect request)
- Hardware attestation (deferred — Phase 3, separate TEE-capable hardware)

---

## Process lessons

**Tag images with commit SHA, not `:latest`**. RunPod caches `:latest` on the host. New pod, same host = old image. Tag `monygroup/tee-runner:$(git rev-parse --short HEAD)` and pass the tag to the RunPod API.

**Separate diagnostic path from the broken path**. When the SOCKS5 tunnel is broken, querying `/debug/wglog` through the SOCKS5 tunnel doesn't work. Need a healthcheck endpoint on a different port (or stdout-only diagnostics at boot that show in RunPod pod logs).

**Read library source before wiring**. `IsUDPAllowed()`, `GostUDPTun`, and the `?gost` URL parameter are all in `client.go`. 30 minutes of reading would have found root cause 3 before ever deploying to RunPod.

**Don't trust "tunnel up"**. WireGuard's `device.Up()` does not surface `Open()` failures to the caller. "Tunnel up" just means the vtun was configured, not that any socket exists. Add an explicit bind check at startup.
