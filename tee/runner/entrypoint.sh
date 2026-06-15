#!/usr/bin/env bash
# TEE Runner entrypoint — replaces setup-phase2.sh for containerised deployments.
# Runs as PID 1. Starts WireGuard, gost, then hands off to the runner.
set -euo pipefail

log() { echo "[entrypoint] $*"; }

# — WireGuard server keypair —
# Generated fresh at every boot. Private key is consumed directly by wg and
# never written to disk — it exists only in kernel memory for the session lifetime.
WG_PRIVATE=$(wg genkey)
WG_PUBLIC=$(echo "$WG_PRIVATE" | wg pubkey)
echo "$WG_PUBLIC" > /tmp/tee-wg-server.pub
log "WireGuard public key: $WG_PUBLIC"

# — WireGuard interface —
ip link add wg-tee-server type wireguard
ip addr add 10.13.0.1/24 dev wg-tee-server
echo "$WG_PRIVATE" | wg set wg-tee-server listen-port 51820 private-key /dev/stdin
ip link set wg-tee-server up
log "wg-tee-server up — 10.13.0.1/24, port 51820"

# Clear the private key from shell memory
unset WG_PRIVATE

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

# — Runner —
log "starting runner — session ${SESSION_ID:-local-dev}"
exec python3 /opt/runner/runner.py
