#!/usr/bin/env bash
# TEE Runner entrypoint — runs as PID 1.
# Starts WireGuard (wireguard-go userspace), gost SOCKS5+WS bridge, then runner.py.
set -uo pipefail

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

# — WireGuard server keypair —
status "wg_keygen"
WG_PRIVATE=$(wg genkey)
WG_PUBLIC=$(echo "$WG_PRIVATE" | wg pubkey)
echo "$WG_PUBLIC" > /tmp/tee-wg-server.pub
echo "$WG_PRIVATE" > /tmp/wg-priv.tmp
chmod 600 /tmp/wg-priv.tmp
unset WG_PRIVATE
log "WireGuard public key: $WG_PUBLIC"

# — Userspace WireGuard (wireguard-go, no kernel module needed) —
status "wg_iface_create"
WG_I_PREFER_BUGGY_USERSPACE_TO_POLISHED_KMOD=1 wireguard-go wg-tee-server >/tmp/wg-go.log 2>&1 &
WG_GO_PID=$!
sleep 3  # give wireguard-go time to create the UAPI socket

# Diagnose wireguard-go startup
if kill -0 $WG_GO_PID 2>/dev/null; then
  log "wireguard-go running (pid $WG_GO_PID)"
else
  log "wireguard-go EXITED — output: $(cat /tmp/wg-go.log)"
  status "wg_go_failed"
fi
log "wireguard-go log: $(cat /tmp/wg-go.log)"
log "tun device: $(ls -la /dev/net/tun 2>/dev/null || echo 'not found')"
log "uapi socket: $(ls -la /var/run/wireguard/ 2>/dev/null || echo 'no socket dir')"

# — wg set: configure keys + listen port via UAPI socket (no NET_ADMIN needed) —
status "wg_configure"
if wg set wg-tee-server listen-port 51820 private-key /tmp/wg-priv.tmp 2>/tmp/wg-err.txt; then
  log "wg set OK (listen-port 51820)"
else
  log "wg set FAILED: $(cat /tmp/wg-err.txt)"
  status "wg_configure_failed"
fi
rm -f /tmp/wg-priv.tmp

# Pre-register browser peer if provided by the provisioner
if [ -n "${WG_CLIENT_PUBKEY:-}" ]; then
  wg set wg-tee-server peer "$WG_CLIENT_PUBKEY" allowed-ips 10.13.0.2/32 && \
    log "pre-registered browser peer → 10.13.0.2" || \
    log "peer register failed (non-fatal)"
fi

# — ip addr/link: needs NET_ADMIN; best-effort, log outcome —
WG_NET_OK=true

status "wg_addr_add"
if ip addr add 10.13.0.1/24 dev wg-tee-server 2>/tmp/ip-err.txt; then
  log "ip addr add OK"
else
  WG_NET_OK=false
  log "ip addr add FAILED (no NET_ADMIN?): $(cat /tmp/ip-err.txt)"
  status "wg_net_admin_missing"
fi

if [ "$WG_NET_OK" = "true" ]; then
  status "wg_link_up"
  if ip link set wg-tee-server up 2>/tmp/ip-err.txt; then
    log "wg-tee-server up — 10.13.0.1/24, port 51820"
    status "wireguard_up"
  else
    WG_NET_OK=false
    log "ip link set up FAILED: $(cat /tmp/ip-err.txt)"
    status "wg_link_failed"
  fi
fi

# — gost SOCKS5+WS bridge —
GOST_PORT="${GOST_PORT:-8080}"
gost -L "socks5+ws://:${GOST_PORT}?bind=true" &
log "gost SOCKS5+WS bridge on :${GOST_PORT}"
status "gost_up"

# — Runner —
# When WireGuard is up, bind runner on the tunnel IP (only reachable via WG peers).
# Otherwise fall back to loopback — runner still calls /runner/ready fine.
if [ "$WG_NET_OK" = "true" ]; then
  export RUNNER_BIND="10.13.0.1:7998"
else
  export RUNNER_BIND="127.0.0.1:7998"
fi
log "starting runner — session ${SESSION_ID:-local-dev} wg_net_ok=${WG_NET_OK} bind=${RUNNER_BIND}"
status "runner_start"
exec python3 /opt/runner/runner.py
