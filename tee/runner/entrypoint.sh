#!/usr/bin/env bash
# TEE Runner entrypoint — runs as PID 1.
# Generates WireGuard keypair, starts tee-wg-server (userspace WG via gVisor —
# no /dev/net/tun or NET_ADMIN needed), starts gost SOCKS5+WS bridge, then runner.py.
set -euo pipefail

log() { echo "[entrypoint] $*"; }

status() {
  local step="$1"
  log "status: $step"
  if [ -n "${PLATFORM_CALLBACK:-}" ] && [ -n "${SESSION_ID:-}" ]; then
    curl -sf -X POST "${PLATFORM_CALLBACK}/runner/status" \
      -H "Content-Type: application/json" \
      -d "{\"sessionId\":\"${SESSION_ID}\",\"step\":\"${step}\"}" || true
  fi
}

status "entrypoint_start"

# — WireGuard keypair —
status "wg_keygen"
WG_PRIVATE=$(wg genkey)
WG_PUBLIC=$(echo "$WG_PRIVATE" | wg pubkey)
echo "$WG_PUBLIC" > /tmp/tee-wg-server.pub
log "WireGuard public key: $WG_PUBLIC"

# — tee-wg-server: userspace WireGuard (gVisor netstack, no kernel module / NET_ADMIN) —
# Listens on UDP 51820 for WireGuard handshakes and data.
# Proxies decrypted HTTP from vtun 10.13.0.1:7998 → runner 127.0.0.1:7998.
status "wg_start"
WG_PRIVATE_KEY="$WG_PRIVATE" \
WG_CLIENT_PUBKEY="${WG_CLIENT_PUBKEY:-}" \
RUNNER_UPSTREAM="http://127.0.0.1:7998" \
  tee-wg-server >/tmp/wg-server.log 2>&1 &
WG_SERVER_PID=$!
unset WG_PRIVATE
log "tee-wg-server started (pid $WG_SERVER_PID)"

# Give wg-server time to bind UDP 51820 and set up the vtun
sleep 2

if kill -0 $WG_SERVER_PID 2>/dev/null; then
  status "wireguard_up"
  log "tee-wg-server running — UDP 51820, vtun 10.13.0.1/24"
else
  log "tee-wg-server FAILED — log: $(cat /tmp/wg-server.log)"
  status "wg_server_failed"
fi

# — Verify tee-wg-server is actually listening on UDP 51820 —
if ss -ulnp 2>/dev/null | grep -q ":51820 "; then
  log "UDP 51820 confirmed open"
else
  log "WARNING: UDP 51820 not yet visible in ss (may still be fine)"
fi

# — gost SOCKS5+WS bridge (browser → pod, proxies WG UDP to 127.0.0.1:51820) —
GOST_PORT="${GOST_PORT:-8080}"
gost -L "socks5+ws://:${GOST_PORT}?bind=true&udp=true" &
log "gost SOCKS5+WS bridge on :${GOST_PORT}"
status "gost_up"

# — Runner —
# tee-wg-server reverse-proxies vtun 10.13.0.1:7998 → 127.0.0.1:7998, so the
# runner binds to real loopback. It's not directly exposed (RunPod only proxies :8080).
export RUNNER_BIND="127.0.0.1:7998"
log "starting runner — session ${SESSION_ID:-local-dev} bind=${RUNNER_BIND}"
status "runner_start"
exec python3 /opt/runner/runner.py
