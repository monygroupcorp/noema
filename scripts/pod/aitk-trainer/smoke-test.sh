#!/usr/bin/env bash
# =============================================================================
# smoke-test.sh — prove the aitk-trainer IMAGE trains, locally, before any push
# =============================================================================
#
# Runs the REAL pod entrypoint (scripts/pod/aitktrainer.py) INSIDE the built image on the
# local GPU — the same path a pod runs, minus RunPod/SSH. Generates the config the launcher
# would (buildAitkConfig, pod-side dataset path), feeds the already-staged koh manifest, and
# does a tiny 10-step train. Proves: baked /aitk clone + deps + torch/CUDA + weight pull +
# train + R2 upload all work in the image. NO pod spend (uses the local 4090). Tiny R2 spend
# (one LoRA upload). The completion webhook is pointed at a dead URL (logged, ignored).
#
# Pre-reqs:
#   - image built:        IMAGE=monygroup/aitk-klein:0623a (or PUSH=0 ./build-and-push.sh first)
#   - dataset staged:     scripts/.koh-manifest.json  (run: node --env-file=.env --import tsx scripts/stage-koh-r2.ts)
#   - R2 creds in .env;   a free GPU (nvidia-smi)
#
# Usage:
#   IMAGE=monygroup/aitk-klein:0623a scripts/pod/aitk-trainer/smoke-test.sh
# =============================================================================
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$REPO"

IMAGE="${IMAGE:-monygroup/aitk-klein:$(date +%m%d)a}"
HF_CACHE="${HF_CACHE:-$HOME/.cache/huggingface}"
MANIFEST_FILE="${MANIFEST_FILE:-scripts/.koh-manifest.json}"
DATASET_DIR="/aitk/dataset"          # must match buildAitkConfig datasetPath AND aitktrainer AITK_DATASET_DIR
STEPS="${STEPS:-10}"

[ -f "$MANIFEST_FILE" ] || { echo "missing $MANIFEST_FILE — run scripts/stage-koh-r2.ts first"; exit 1; }
[ -f .env ] || { echo "missing .env (R2 creds)"; exit 1; }
docker image inspect "$IMAGE" >/dev/null 2>&1 || { echo "image not found: $IMAGE (build it first)"; exit 1; }

echo "==> generating the training config (buildAitkConfig, datasetPath=$DATASET_DIR, steps=$STEPS)"
CONFIG_B64=$(node --import tsx -e "
  import('$REPO/src/crystal/aitkConfig.ts').then(m => {
    const mod = m.default ?? m   // tsx -e dynamic-import interop surfaces named exports under default
    const yaml = mod.buildAitkConfig({ name: 'smoke', datasetPath: '$DATASET_DIR', triggerWord: 'koh', baseModel: 'klein-4b', steps: $STEPS })
    process.stdout.write(Buffer.from(yaml, 'utf8').toString('base64'))
  })
")
MANIFEST_B64=$(base64 -w0 "$MANIFEST_FILE")

# R2 creds from .env (only the R2_* the pod needs).
set -a; . ./.env; set +a
R2_ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"

echo "==> running aitktrainer.py inside $IMAGE (10-step koh train; first run pulls ~25GB weights)"
docker run --rm --gpus all --shm-size 8g \
  -v "$REPO/scripts/pod/aitktrainer.py":/root/aitktrainer.py:ro \
  -v "$HF_CACHE":/root/.cache/huggingface \
  -e AITK_JOB_ID=smoke \
  -e AITK_CONFIG_B64="$CONFIG_B64" \
  -e AITK_MANIFEST_B64="$MANIFEST_B64" \
  -e AITK_DATASET_DIR="$DATASET_DIR" \
  -e AITK_STEPS="$STEPS" \
  -e AITK_GPU_IDS=0 \
  -e NOEMA_ACTUM_ID=smoke \
  -e NOEMA_STATUS_URL= \
  -e NOEMA_WEBHOOK_URL=http://127.0.0.1:9/dead \
  -e RUNPOD_POD_ID=smoke \
  -e R2_ENDPOINT="$R2_ENDPOINT" \
  -e R2_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" \
  -e R2_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
  -e R2_BUCKET_NAME="$R2_BUCKET_NAME" \
  -e R2_PUBLIC_URL="${R2_PUBLIC_URL:-}" \
  --entrypoint bash "$IMAGE" -lc \
  'python3 /root/aitktrainer.py; rc=$?; echo "=== aitktrainer exit=$rc ==="; ls -la /aitk/output/smoke/ 2>/dev/null; exit $rc'

echo "==> SMOKE PASS: the image trained a LoRA and uploaded it (see 'uploaded LoRA →' above)."
echo "    push it:  scripts/pod/aitk-trainer/build-and-push.sh"
