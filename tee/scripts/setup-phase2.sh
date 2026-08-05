#!/usr/bin/env bash
# Phase 2 server-side setup.
# Brings up only wg-tee-server (the pod side) and starts gost as the
# SOCKS5+WebSocket bridge. The native wg-tee-client is gone — replaced
# by the browser WASM.
#
# Workflow:
#   1. Run this script (needs sudo for WG interface)
#   2. Open tee/browser/index.html, click "Generate Keys", copy the public key
#   3. Run the printed "wg addpeer" command to register the browser as a peer
#   4. In the browser, paste the server pubkey printed here, click Connect → Run
#
# Requirements:
#   sudo pacman -S wireguard-tools
#   gost v3 binary in PATH — https://github.com/go-gost/gost/releases
#     quick install: curl -fsSL https://github.com/go-gost/gost/releases/latest/download/gost_linux_amd64.tar.gz \
#                    | tar xz && sudo mv gost /usr/local/bin/
#
# Network layout:
#   wg-tee-server   10.13.0.1/24   WireGuard server (pod side)
#   gost            ws://0.0.0.0:8080  SOCKS5+WS bridge → udp//127.0.0.1:51820
#   browser WASM    10.13.0.2       replaces wg-tee-client

set -euo pipefail

if ! command -v gost &>/dev/null; then
  echo "ERROR: gost not found in PATH" >&2
  echo "Install: https://github.com/go-gost/gost/releases" >&2
  echo "  curl -fsSL https://github.com/go-gost/gost/releases/latest/download/gost_linux_amd64.tar.gz \\" >&2
  echo "    | tar xz && sudo mv gost /usr/local/bin/" >&2
  exit 1
fi

WG_SERVER_IF="wg-tee-server"
WG_SERVER_IP="10.13.0.1"
WG_CLIENT_IP="10.13.0.2"
WG_PORT=51820
GOST_WS_PORT=8080
TMPDIR="/tmp/tee-local"

mkdir -p "$TMPDIR"

echo "==> generating WireGuard server keypair"
SERVER_PRIV=$(wg genkey)
SERVER_PUB=$(echo "$SERVER_PRIV" | wg pubkey)
echo "$SERVER_PUB" > "$TMPDIR/server.pub"
cp "$TMPDIR/server.pub" /tmp/tee-wg-server.pub

echo "   server pubkey: $SERVER_PUB"

echo "==> writing server WireGuard config (no client peer yet)"
cat > "$TMPDIR/server.conf" <<EOF
[Interface]
PrivateKey = ${SERVER_PRIV}
ListenPort = ${WG_PORT}
EOF

echo "==> bringing up wg-tee-server (requires sudo)"
sudo ip link del "$WG_SERVER_IF" 2>/dev/null || true
sudo ip link add dev "$WG_SERVER_IF" type wireguard
sudo ip address add "${WG_SERVER_IP}/24" dev "$WG_SERVER_IF"
sudo wg setconf "$WG_SERVER_IF" "$TMPDIR/server.conf"
sudo ip link set "$WG_SERVER_IF" up
echo "   interface up: $WG_SERVER_IF ($WG_SERVER_IP/24)"

echo "==> starting gost SOCKS5+WS bridge (port $GOST_WS_PORT → UDP $WG_PORT)"
pkill -f "gost.*socks5.*ws.*$GOST_WS_PORT" 2>/dev/null || true
gost -L "socks5+ws://:${GOST_WS_PORT}?udp=true&udpBufferSize=4096&bind=true" \
  > "$TMPDIR/gost.log" 2>&1 &
echo $! > "$TMPDIR/gost.pid"
echo "   gost pid: $(cat $TMPDIR/gost.pid)"

sleep 1

echo ""
echo "========================================================"
echo "  Server public key: $SERVER_PUB"
echo "  Proxy URL for browser: socks5+ws://127.0.0.1:${GOST_WS_PORT}?bind=true&gost=true"
echo "  Peer endpoint for browser: 127.0.0.1:${WG_PORT}"
echo "========================================================"
echo ""
echo "Next steps:"
echo ""
echo "  1. Build + open the browser shim:"
echo "     cd tee/browser && bash build.sh && python3 -m http.server 9000"
echo "     open http://127.0.0.1:9000/"
echo ""
echo "  2. Click 'Generate Keys' in the browser. Copy the public key."
echo ""
echo "  3. Register the browser as a WireGuard peer (paste the pubkey):"
echo "     sudo wg set $WG_SERVER_IF peer <BROWSER-PUBKEY> allowed-ips ${WG_CLIENT_IP}/32"
echo ""
echo "  4. Paste the server public key above into the browser 'Server public key' field."
echo "     Click Connect, then Run."
echo ""
echo "  5. Start the runner and load a model (separate terminal):"
echo "     RUNNER_BIND=${WG_SERVER_IP}:7998 ATTESTATION_STUB=true \\"
echo "       tee/runner/.venv/bin/python tee/runner/runner.py"
echo "     curl -s -X POST http://${WG_SERVER_IP}:7998/setup \\"
echo "       -H 'Content-Type: application/json' \\"
echo "       -d '{\"server\":\"llama.cpp\",\"model\":\"/mnt/data/models/gguf/Huihui-Qwen3.6-27B-abliterated-ggml-model-Q4_K.gguf\"}'"
echo ""
echo "Logs: $TMPDIR/gost.log"
