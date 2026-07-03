#!/usr/bin/env bash
# TEE Runner entrypoint — runs as PID 1.
# Generates WireGuard keypair, starts tee-wg-server (userspace WG via gVisor —
# no /dev/net/tun or NET_ADMIN needed), starts gost SOCKS5+WS bridge, then runner.py.
set -euo pipefail

log() { echo "[entrypoint] $*"; }

# — Azure confidential-CVM path: session parameters arrive as VM tags (a deallocated
#   VM has no per-boot env channel — ConfidentialPodClient stamps tags, we read IMDS).
#   RunPod path injects real env vars, so this is skipped when SESSION_ID is set.
#   IMDS can be briefly unavailable / throttled (410/429/5xx) during early boot and
#   Azure documents that callers must retry — a headless runner (no SESSION_ID) never
#   calls back and the platform watchdog would kill the pod, so retry hard here.
if [ -z "${SESSION_ID:-}" ]; then
  IMDS_TAGS=""
  for _attempt in 1 2 3 4 5 6; do
    IMDS_TAGS=$(curl -sf -H "Metadata:true" --connect-timeout 2 \
      "http://169.254.169.254/metadata/instance/compute/tagsList?api-version=2021-02-01" || true)
    [ -n "$IMDS_TAGS" ] && break
    log "IMDS tags fetch attempt ${_attempt} failed — retrying"
    sleep 2
  done
  [ -z "$IMDS_TAGS" ] && log "WARNING: IMDS tags unavailable after 6 attempts — runner will start without session parameters"
  if [ -n "$IMDS_TAGS" ]; then
    eval "$(echo "$IMDS_TAGS" | python3 -c '
import json, shlex, sys
tags = {t["name"]: t["value"] for t in json.loads(sys.stdin.read() or "[]")}
for tag, var in [("noemaSessionId", "SESSION_ID"), ("noemaPlatformCallback", "PLATFORM_CALLBACK"),
                 ("noemaWgClientPubkey", "WG_CLIENT_PUBKEY"), ("noemaRunnerToken", "RUNNER_TOKEN")]:
    if tag in tags:
        print(f"export {var}={shlex.quote(tags[tag])}")
')"
    log "session parameters loaded from Azure IMDS tags (session ${SESSION_ID:-unset})"
  fi
fi

status() {
  local step="$1"
  log "status: $step"
  if [ -n "${PLATFORM_CALLBACK:-}" ] && [ -n "${SESSION_ID:-}" ]; then
    local token_field=""
    [ -n "${RUNNER_TOKEN:-}" ] && token_field=",\"runnerToken\":\"${RUNNER_TOKEN}\""
    curl -sf -X POST "${PLATFORM_CALLBACK}/runner/status" \
      -H "Content-Type: application/json" \
      -d "{\"sessionId\":\"${SESSION_ID}\",\"step\":\"${step}\"${token_field}}" || true
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

# tee-wg-server now serves the SOCKS5+WS proxy itself on :8080 (no gost needed).
# Give it a moment to bind, then confirm.
sleep 1
if ss -ulnp 2>/dev/null | grep -q ":51820 "; then
  log "UDP 51820 confirmed open"
else
  log "WARNING: UDP 51820 not yet visible in ss"
fi
status "gost_up"

# — Runner —
# tee-wg-server reverse-proxies vtun 10.13.0.1:7998 → 127.0.0.1:7998, so the
# runner binds to real loopback. It's not directly exposed (RunPod only proxies :8080).
export RUNNER_BIND="127.0.0.1:7998"
log "starting runner — session ${SESSION_ID:-local-dev} bind=${RUNNER_BIND}"
status "runner_start"
exec python3 /opt/runner/runner.py
