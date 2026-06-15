#!/usr/bin/env bash
# Build the TEE browser WASM shim.
# Outputs: app.wasm, wasm_exec.js (both must be served alongside index.html)
#
# Requirements:
#   go 1.22+  (GOOS=js GOARCH=wasm)
#   internet access on first run (go mod tidy fetches deps)
#
# Usage:
#   bash tee/browser/build.sh         # from repo root
#   cd tee/browser && bash build.sh   # or from here

set -euo pipefail

cd "$(dirname "$0")"

echo "==> tidy deps"
GOOS=js GOARCH=wasm go mod tidy

echo "==> compile WASM"
GOOS=js GOARCH=wasm go build -o app.wasm .

echo "==> copy wasm_exec.js from GOROOT"
GOROOT=$(go env GOROOT)
if [ -f "$GOROOT/lib/wasm/wasm_exec.js" ]; then
  cp -f "$GOROOT/lib/wasm/wasm_exec.js" .
elif [ -f "$GOROOT/misc/wasm/wasm_exec.js" ]; then
  cp -f "$GOROOT/misc/wasm/wasm_exec.js" .
else
  echo "ERROR: wasm_exec.js not found in GOROOT=$GOROOT" >&2
  exit 1
fi

echo "==> done"
echo "   app.wasm     $(du -sh app.wasm | cut -f1)"
echo "   wasm_exec.js $(du -sh wasm_exec.js | cut -f1)"
echo ""
echo "Serve with:"
echo "   python3 -m http.server 9000   (from tee/browser/)"
echo "   then open http://127.0.0.1:9000/"
