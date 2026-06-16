#!/usr/bin/env bash
# TEE Runner entrypoint — replaces setup-phase2.sh for containerised deployments.
# Runs as PID 1. Starts WireGuard, gost, then hands off to the runner.
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

# — WireGuard server keypair —
status "wg_keygen"
WG_PRIVATE=$(wg genkey)
WG_PUBLIC=$(echo "$WG_PRIVATE" | wg pubkey)
echo "$WG_PUBLIC" > /tmp/tee-wg-server.pub
echo "$WG_PRIVATE" > /tmp/wg-priv.tmp
chmod 600 /tmp/wg-priv.tmp
unset WG_PRIVATE
log "WireGuard public key: $WG_PUBLIC"

# — Userspace WireGuard via boringtun (no kernel wireguard module required) —
# Falls back cleanly: if ip addr/link fail we'll see the status step that stopped.
status "wg_iface_create"
# wireguard-go creates a userspace TUN interface — no kernel wireguard module needed.
WG_I_PREFER_BUGGY_USERSPACE_TO_POLISHED_KMOD=1 wireguard-go wg-tee-server &
sleep 2  # give wireguard-go time to bring up the TUN interface

status "wg_addr_add"
ip addr add 10.13.0.1/24 dev wg-tee-server

status "wg_configure"
wg set wg-tee-server listen-port 51820 private-key /tmp/wg-priv.tmp
rm -f /tmp/wg-priv.tmp

status "wg_link_up"
ip link set wg-tee-server up
log "wg-tee-server up (boringtun) — 10.13.0.1/24, port 51820"

status "wireguard_up"

# Pre-register the browser's WireGuard peer if supplied by the provisioner
if [ -n "${WG_CLIENT_PUBKEY:-}" ]; then
    wg set wg-tee-server peer "$WG_CLIENT_PUBKEY" allowed-ips 10.13.0.2/32
    log "pre-registered browser peer → 10.13.0.2"
fi

# — gost SOCKS5+WS bridge —
GOST_PORT="${GOST_PORT:-8080}"
gost -L "socks5+ws://:${GOST_PORT}?udp=true&udpBufferSize=4096&bind=true" &
GOST_PID=$!
log "gost SOCKS5+WS bridge on :${GOST_PORT} (pid $GOST_PID)"

status "gost_up"

# — Runner —
log "starting runner — session ${SESSION_ID:-local-dev}"
status "runner_start"
exec python3 /opt/runner/runner.py
