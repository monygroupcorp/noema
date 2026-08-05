#!/usr/bin/env bash
# Tear down the local Phase 1 test environment.

set -euo pipefail

TMPDIR="/tmp/tee-local"

echo "==> stopping wstunnel processes (Phase 1)"
[ -f "$TMPDIR/wstunnel-server.pid" ] && kill "$(cat $TMPDIR/wstunnel-server.pid)" 2>/dev/null || true
[ -f "$TMPDIR/wstunnel-client.pid" ] && kill "$(cat $TMPDIR/wstunnel-client.pid)" 2>/dev/null || true
pkill -f wstunnel 2>/dev/null || true

echo "==> stopping gost (Phase 2)"
[ -f "$TMPDIR/gost.pid" ] && kill "$(cat $TMPDIR/gost.pid)" 2>/dev/null || true
pkill -f "gost.*socks5" 2>/dev/null || true

echo "==> removing WireGuard interfaces (requires sudo)"
sudo ip link del wg-tee-server 2>/dev/null || true
sudo ip link del wg-tee-client 2>/dev/null || true

echo "==> cleaning up"
rm -rf "$TMPDIR"
rm -f /tmp/tee-wg-server.pub

echo "done"
