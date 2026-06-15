#!/usr/bin/env bash
# Create venvs for the runner and platform stub.
# Run once before starting anything.

set -euo pipefail

TEE_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> creating runner venv"
python3 -m venv "$TEE_DIR/runner/.venv"
"$TEE_DIR/runner/.venv/bin/pip" install -q -r "$TEE_DIR/runner/requirements.txt"
echo "   done: $TEE_DIR/runner/.venv"

echo "==> creating platform-stub venv"
python3 -m venv "$TEE_DIR/platform-stub/.venv"
"$TEE_DIR/platform-stub/.venv/bin/pip" install -q fastapi uvicorn
echo "   done: $TEE_DIR/platform-stub/.venv"

echo ""
echo "Start commands:"
echo "  platform stub:  $TEE_DIR/platform-stub/.venv/bin/python $TEE_DIR/platform-stub/stub.py"
echo "  runner:         RUNNER_BIND=10.13.0.1:7998 ATTESTATION_STUB=true $TEE_DIR/runner/.venv/bin/python $TEE_DIR/runner/runner.py"
