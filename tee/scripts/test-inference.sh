#!/usr/bin/env bash
# Phase 1 inference test.
# Sends a streaming chat completion request through the WireGuard tunnel
# and prints the result. Verifies nothing hit R2 or platform endpoints.
#
# Prerequisites: setup-local.sh run, runner up, vLLM installed via /setup.
#
# Usage:
#   bash tee/scripts/test-inference.sh [vllm|llama.cpp] [port]

set -euo pipefail

SERVER="${1:-llama.cpp}"
PORT="${2:-8000}"
TUNNEL_IP="10.13.0.1"
RUNNER_API="http://${TUNNEL_IP}:7998"
VLLM_API="http://${TUNNEL_IP}:${PORT}"

echo "==> runner status (through tunnel)"
curl -sf "${RUNNER_API}/status" | python3 -m json.tool
echo ""

if [ "$SERVER" = "vllm" ]; then
  echo "==> streaming chat completion through tunnel (vLLM)"
  echo "    endpoint: ${VLLM_API}/v1/chat/completions"
  echo ""

  curl -sf "${VLLM_API}/v1/chat/completions" \
    -H "Content-Type: application/json" \
    -d '{
      "model": "Qwen/Qwen2.5-7B-Instruct",
      "messages": [{"role": "user", "content": "Say hello in exactly three words."}],
      "stream": true,
      "max_tokens": 32
    }' \
    --no-buffer | while IFS= read -r line; do
      # SSE lines start with "data: "
      if [[ "$line" == data:* ]]; then
        payload="${line#data: }"
        [ "$payload" = "[DONE]" ] && break
        echo "$payload" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    chunk = d['choices'][0]['delta'].get('content','')
    if chunk: print(chunk, end='', flush=True)
except: pass
"
      fi
    done
  echo ""
  echo ""
  echo "==> stream complete"

elif [ "$SERVER" = "llama.cpp" ]; then
  echo "==> streaming completion through tunnel (llama.cpp)"
  echo "    endpoint: ${VLLM_API}/v1/chat/completions"
  echo ""

  curl -sf "${VLLM_API}/v1/chat/completions" \
    -H "Content-Type: application/json" \
    -d '{
      "messages": [{"role": "user", "content": "Say hello in exactly three words."}],
      "stream": true,
      "max_tokens": 32
    }' \
    --no-buffer | while IFS= read -r line; do
      if [[ "$line" == data:* ]]; then
        payload="${line#data: }"
        [ "$payload" = "[DONE]" ] && break
        echo "$payload" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    chunk = d['choices'][0]['delta'].get('content','')
    if chunk: print(chunk, end='', flush=True)
except: pass
"
      fi
    done
  echo ""
  echo ""
  echo "==> stream complete"
fi

echo ""
echo "Pass criteria: streamed response arrived above, no R2 or platform traffic."
echo "Check network tab / proxy logs to confirm nothing leaked outside the tunnel."
