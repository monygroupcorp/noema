#!/usr/bin/env bash
# Phase 1 local validation setup.
# Creates two WireGuard peers on this machine (server=pod side, client=user side)
# with wstunnel bridging WebSocket→UDP in between — matching the production topology.
#
# Requires:
#   sudo pacman -S wireguard-tools
#   wstunnel binary in PATH (see https://github.com/erebe/wstunnel/releases)
#
# Network layout:
#   wg-tee-server  10.13.0.1/24  (the pod side — runner API binds here)
#   wg-tee-client  10.13.0.2/24  (the user side — test requests come from here)
#   wstunnel server: ws://127.0.0.1:8080  → udp://127.0.0.1:51820
#   wstunnel client: udp://127.0.0.1:51821 → ws://127.0.0.1:8080
#   wg-tee-client endpoint: 127.0.0.1:51821 (via wstunnel)
#
# Ports:
#   51820  WireGuard UDP (server peer)
#   51821  wstunnel client local UDP (what wg-tee-client connects to)
#   8080   wstunnel WebSocket
#   7999   platform stub
#   7998   runner API (tunnel-local, 10.13.0.1:7998)
#   8000+  inference servers (vLLM etc, tunnel-local)

set -euo pipefail

WG_SERVER_IF="wg-tee-server"
WG_CLIENT_IF="wg-tee-client"
WG_SERVER_IP="10.13.0.1"
WG_CLIENT_IP="10.13.0.2"
WG_PORT=51820
WSTUNNEL_WS_PORT=8080
WSTUNNEL_CLIENT_UDP=51821
TMPDIR="/tmp/tee-local"

mkdir -p "$TMPDIR"

echo "==> generating WireGuard keypairs"

# Server keypair
SERVER_PRIV=$(wg genkey)
SERVER_PUB=$(echo "$SERVER_PRIV" | wg pubkey)
echo "$SERVER_PUB" > "$TMPDIR/server.pub"
cp "$TMPDIR/server.pub" /tmp/tee-wg-server.pub  # runner reads this

# Client keypair
CLIENT_PRIV=$(wg genkey)
CLIENT_PUB=$(echo "$CLIENT_PRIV" | wg pubkey)
echo "$CLIENT_PUB" > "$TMPDIR/client.pub"

echo "   server pubkey: $SERVER_PUB"
echo "   client pubkey: $CLIENT_PUB"

echo "==> writing WireGuard configs"

cat > "$TMPDIR/server.conf" <<EOF
[Interface]
PrivateKey = ${SERVER_PRIV}
ListenPort = ${WG_PORT}

[Peer]
PublicKey = ${CLIENT_PUB}
AllowedIPs = ${WG_CLIENT_IP}/32
EOF

cat > "$TMPDIR/client.conf" <<EOF
[Interface]
PrivateKey = ${CLIENT_PRIV}
ListenPort = 0

[Peer]
PublicKey = ${SERVER_PUB}
Endpoint = 127.0.0.1:${WSTUNNEL_CLIENT_UDP}
AllowedIPs = ${WG_SERVER_IP}/32
PersistentKeepalive = 25
EOF

echo "==> bringing up WireGuard interfaces (requires sudo)"

sudo ip link del "$WG_SERVER_IF" 2>/dev/null || true
sudo ip link del "$WG_CLIENT_IF" 2>/dev/null || true

sudo ip link add dev "$WG_SERVER_IF" type wireguard
sudo ip address add "${WG_SERVER_IP}/24" dev "$WG_SERVER_IF"
sudo wg setconf "$WG_SERVER_IF" "$TMPDIR/server.conf"
sudo ip link set "$WG_SERVER_IF" up

sudo ip link add dev "$WG_CLIENT_IF" type wireguard
sudo ip address add "${WG_CLIENT_IP}/24" dev "$WG_CLIENT_IF"
sudo wg setconf "$WG_CLIENT_IF" "$TMPDIR/client.conf"
sudo ip link set "$WG_CLIENT_IF" up

echo "==> starting wstunnel server (WebSocket→UDP bridge)"
# wstunnel server: listens on ws://0.0.0.0:8080, routes to local UDP
pkill -f "wstunnel server" 2>/dev/null || true
wstunnel server "ws://0.0.0.0:${WSTUNNEL_WS_PORT}" \
  --restrict-to "127.0.0.1:${WG_PORT}" \
  > "$TMPDIR/wstunnel-server.log" 2>&1 &
echo $! > "$TMPDIR/wstunnel-server.pid"
echo "   wstunnel server pid: $(cat $TMPDIR/wstunnel-server.pid)"

echo "==> starting wstunnel client (local UDP→WebSocket)"
pkill -f "wstunnel client.*51821" 2>/dev/null || true
wstunnel client \
  -L "udp://127.0.0.1:${WSTUNNEL_CLIENT_UDP}:127.0.0.1:${WG_PORT}" \
  "ws://127.0.0.1:${WSTUNNEL_WS_PORT}" \
  > "$TMPDIR/wstunnel-client.log" 2>&1 &
echo $! > "$TMPDIR/wstunnel-client.pid"
echo "   wstunnel client pid: $(cat $TMPDIR/wstunnel-client.pid)"

sleep 1

echo "==> verifying tunnel"
if ping -c 1 -W 2 "$WG_SERVER_IP" -I "$WG_CLIENT_IF" > /dev/null 2>&1; then
  echo "   tunnel OK — $WG_CLIENT_IP can reach $WG_SERVER_IP"
else
  echo "   WARNING: ping failed — check wstunnel logs at $TMPDIR/"
fi

echo ""
echo "Setup complete. Next steps:"
echo ""
echo "  1. Start the platform stub:"
echo "     cd tee/platform-stub && python stub.py"
echo ""
echo "  2. Start the runner (in a new terminal):"
echo "     cd tee/runner && RUNNER_BIND=${WG_SERVER_IP}:7998 python runner.py"
echo ""
echo "  3. Install an inference server (from another terminal):"
echo "     curl -s -X POST http://${WG_SERVER_IP}:7998/setup \\"
echo "       -H 'Content-Type: application/json' \\"
echo "       -d '{\"server\":\"vllm\",\"model\":\"Qwen/Qwen2.5-7B-Instruct\"}'"
echo ""
echo "  4. Run the inference test:"
echo "     bash tee/scripts/test-inference.sh"
echo ""
echo "Logs: $TMPDIR/"
