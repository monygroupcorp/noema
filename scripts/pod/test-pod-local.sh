#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# test-pod-local.sh — emulate a RunPod pod LOCALLY to debug the runner/bootstrap
# without burning GPU $ (ADR-0007). Runs the real fundamentum base image as a
# local container, runs the SAME bootstrap SecurePodClient does, starts runner.py,
# then drives a real job through it — `vllm serve` + inference included if a GPU is
# present. The one thing it does NOT replicate is RunPod's SSH-injection layer
# (so it can't catch "image has no sshd" — that's handled by using a known
# SSH-ready base); everything after SSH it exercises end-to-end.
#
# Usage:
#   scripts/pod/test-pod-local.sh                 # full run (vLLM / Qwen3-VL)
#   KEEP=1 scripts/pod/test-pod-local.sh          # leave the container up after
#   REPO=... DEST=... PROMPT=... IMAGE_URL=...     # override the test job
#
# Mirrors the prod path: image + bootstrap from src/crystal/seeds/fundamenta.ts
# (FUNDAMENTUM_QWEN_VL_VLLM) + SecurePodClient._bootstrapVllm.
# ---------------------------------------------------------------------------
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."   # repo root

IMG="${IMG:-runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04}"
NAME="${NAME:-noema-pod-local}"
VOL="${VOL:-noema-model-cache}"             # persist the model pull across runs
REPO="${REPO:-Qwen/Qwen3-VL-8B-Instruct}"
DEST="${DEST:-transformers/qwen3-vl-8b}"
PROMPT="${PROMPT:-Describe this image in one sentence.}"
IMAGE_URL="${IMAGE_URL:-https://picsum.photos/id/237/512/512}"
# BOOTSTRAP_ONLY=1 stops after /health — validates image tools, pip install vllm, and
# runner.py boot WITHOUT any GPU work (no `vllm serve`, no model load). Safe to run while
# the GPU is busy. Drops --gpus so it can't even reserve the card.
GPU_FLAG=""
if [ "${BOOTSTRAP_ONLY:-0}" != "1" ]; then
  nvidia-smi >/dev/null 2>&1 && GPU_FLAG="--gpus all"
fi

say() { echo -e "\n\033[1;36m== $* ==\033[0m"; }
fail() { echo -e "\033[1;31mFAIL: $*\033[0m"; dump_logs; exit 1; }
dump_logs() {
  echo "--- /tmp/runner.log ---"; docker exec "$NAME" sh -c 'tail -40 /tmp/runner.log 2>/dev/null' || true
  echo "--- /tmp/vllm.log ---";   docker exec "$NAME" sh -c 'tail -40 /tmp/vllm.log 2>/dev/null'   || true
}
cleanup() { [ "${KEEP:-0}" = "1" ] && { echo "(KEEP=1 — leaving $NAME up)"; return; }; docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

say "1. start pod container ($IMG ${GPU_FLAG:-CPU-only})"
docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" $GPU_FLAG -p 8080:8080 -v "$VOL":/root/models "$IMG" sleep infinity \
  || fail "could not start container (image pull failed?)"

say "2. bootstrap (mirror _bootstrapVllm)"
docker exec "$NAME" bash -lc 'which git || (apt-get update -qq && apt-get install -y -qq git)' || fail "git install"
echo "   pip install vllm huggingface_hub boto3 (this is the step that reveals torch/CUDA conflicts) ..."
docker exec "$NAME" bash -lc 'pip install vllm huggingface_hub boto3 -q' || fail "pip install vllm — likely a torch/CUDA version conflict on this base image; bump the image tag"

say "3. ship runner.py + start it"
docker cp scripts/pod/runner.py "$NAME":/root/runner.py || fail "docker cp runner.py"
docker exec -d "$NAME" bash -lc 'RUNPOD_POD_ID=local MODEL_ROOT=/root/models RUNNER_VRAM_GB=24 python3 /root/runner.py >> /tmp/runner.log 2>&1'

say "4. wait for /health"
for i in $(seq 1 30); do
  if curl -sf --max-time 3 localhost:8080/health >/dev/null 2>&1; then
    echo "   ready: $(curl -s localhost:8080/health)"; break
  fi
  [ "$i" = "30" ] && fail "runner /health never came up"
  sleep 1
done

if [ "${BOOTSTRAP_ONLY:-0}" = "1" ]; then
  say "BOOTSTRAP_ONLY — image tools + pip install vllm + runner boot + /health all PASS (no GPU touched)"
  exit 0
fi

say "5. submit a vLLM job (downloads $REPO -> vllm serve -> inference)"
JOB=$(cat <<JSON
{ "jobId": "local-1", "runtime": "vLLM",
  "inference": { "prompt": "$PROMPT", "media": [{"type":"image","ref":"$IMAGE_URL"}],
                 "genParams": { "max_tokens": 128, "temperature": 0.2 } },
  "models": [ { "role": "lm", "dest": "$DEST", "repo": "$REPO" } ] }
JSON
)
curl -sf --max-time 15 -X POST localhost:8080/job -H 'Content-Type: application/json' -d "$JOB" \
  || fail "POST /job rejected"
echo "   job accepted; first run downloads ~18GB + loads the model — watching..."

say "6. poll until terminal (model download + load can take many minutes the first time)"
for i in $(seq 1 240); do
  R=$(curl -s --max-time 5 localhost:8080/job/local-1 2>/dev/null)
  ST=$(echo "$R" | python3 -c "import sys,json;print(json.load(sys.stdin).get('status',''))" 2>/dev/null)
  case "$ST" in
    completed) say "COMPLETED"; echo "$R" | python3 -m json.tool; exit 0 ;;
    failed)    echo "$R" | python3 -m json.tool; fail "job failed (see logs)" ;;
  esac
  [ $((i % 6)) = 0 ] && echo "   [$((i*10))s] status=$ST"
  sleep 10
done
fail "job did not finish within 40 min"
