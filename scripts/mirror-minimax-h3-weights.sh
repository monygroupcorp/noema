#!/usr/bin/env bash
# =============================================================================
# mirror-minimax-h3-weights — put the MiniMax H3 weights on the models mirror
# =============================================================================
#
# The seven weights the noema-372 flows reference (seeds/intellae.ts). Each
# Intella lists the mirror FIRST and HuggingFace second, so until these land a
# cold pod falls through to HF and pulls ~56 GB from upstream on every run.
#
# The R2 key MUST equal the Intella's `dest`, because the seeded mirror URL is
# literally `${PUBLIC_URL}/${dest}`. The table below is that mapping — if you
# change a dest in the seeds, change it here or the mirror silently stops being
# used (the fetch just falls through to HF and gets slow, not broken, which is
# the failure mode worth naming).
#
# Usage:
#   export R2_ACCOUNT_ID=… R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=…
#   ./scripts/mirror-minimax-h3-weights.sh              # upload, then verify
#   ./scripts/mirror-minimax-h3-weights.sh --verify     # verify only, no upload
#   ./scripts/mirror-minimax-h3-weights.sh --dry-run
#
# Resumable: rclone skips a file already present at the same size, so a killed
# run is restarted by running it again. ~56 GB total.
# =============================================================================
set -euo pipefail

SRC="${SRC:-/mnt/scratch/minimax/comfy-models}"
BUCKET="${R2_MODELS_BUCKET:-models}"
PUBLIC_URL="${R2_MODELS_PUBLIC_URL:-https://models.miladystation2.net}"

# dest (== R2 key == Intella.dest) — order matches seeds/intellae.ts
FILES=(
  "diffusion_models/minimax_h3_fl2va_pruned_int8_convrot.safetensors"
  "diffusion_models/minimax_h3_ref2va_pruned_int8_convrot.safetensors"
  "text_encoders/qwen3vl_32b_minimax_h3_int8_convrot.safetensors"
  "vae/minimax_h3_video_vae_fp16.safetensors"
  "vae/minimax_h3_audio_vae_fp32.safetensors"
  "loras/minimax_h3_fl2v_turbo_4step_v1.0_768p_comfyui_bf16.safetensors"
  "loras/minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors"
)

VERIFY_ONLY=0
DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --verify|--verify-only) VERIFY_ONLY=1 ;;
    --dry-run) DRY_RUN=1 ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

need_env() {
  local missing=()
  for v in R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY; do
    [[ -n "${!v:-}" ]] || missing+=("$v")
  done
  if (( ${#missing[@]} )); then
    echo "missing env: ${missing[*]}" >&2
    echo "these are the MODELS-bucket credentials, not the app's R2_BUCKET_NAME creds" >&2
    exit 1
  fi
}

# rclone, configured entirely from the environment so nothing is written to disk.
# Falls back to the official image, since the box has docker even where rclone is absent.
rc() {
  local -a env_args=(
    -e RCLONE_CONFIG_R2_TYPE=s3
    -e RCLONE_CONFIG_R2_PROVIDER=Cloudflare
    -e RCLONE_CONFIG_R2_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
    -e RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
    -e RCLONE_CONFIG_R2_ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
    # R2 ignores ACLs and errors on some of them; keep the request clean.
    -e RCLONE_CONFIG_R2_NO_CHECK_BUCKET=true
  )
  if command -v rclone >/dev/null 2>&1; then
    local -a exports=()
    for e in "${env_args[@]}"; do [[ "$e" == "-e" ]] || exports+=("$e"); done
    env "${exports[@]}" rclone "$@"
  else
    docker run --rm "${env_args[@]}" -v "$SRC:$SRC:ro" rclone/rclone "$@"
  fi
}

if (( ! VERIFY_ONLY )); then
  need_env
  for f in "${FILES[@]}"; do
    local_path="$SRC/$f"
    [[ -f "$local_path" ]] || { echo "MISSING LOCALLY: $local_path" >&2; exit 1; }
    size=$(stat -c%s "$local_path")
    echo "== $f ($(numfmt --to=iec --suffix=B "$size"))"
    if (( DRY_RUN )); then
      echo "   dry-run: would copy → r2:$BUCKET/$f"
      continue
    fi
    # copyto (not copy) so the destination key is exact — copy would nest the basename.
    rc copyto "$local_path" "r2:$BUCKET/$f" \
      --s3-chunk-size 64M \
      --s3-upload-concurrency 8 \
      --progress \
      --stats-one-line
  done
fi

# ── Verify against the PUBLIC url the seeds actually use ────────────────────
# Uploading to the right bucket is not the same as being reachable at the URL a
# pod will fetch; a bucket that is not bound to the public hostname passes the
# upload and fails every generation. So check the public URL, not the API.
echo
echo "== verifying ${PUBLIC_URL}"
fail=0
for f in "${FILES[@]}"; do
  remote_len=$(curl -sIL --max-time 30 "$PUBLIC_URL/$f" \
    | tr -d '\r' | awk 'tolower($1)=="content-length:"{v=$2} END{print v}')
  if [[ -z "${remote_len:-}" ]]; then
    echo "  UNREACHABLE  $f"; fail=1; continue
  fi
  if [[ -f "$SRC/$f" ]]; then
    local_len=$(stat -c%s "$SRC/$f")
    if [[ "$remote_len" != "$local_len" ]]; then
      echo "  SIZE MISMATCH $f (remote $remote_len, local $local_len)"; fail=1; continue
    fi
  fi
  echo "  ok  $f  ($(numfmt --to=iec --suffix=B "$remote_len"))"
done

if (( fail )); then
  echo
  echo "mirror incomplete — the flows will fall through to HuggingFace on every cold pod." >&2
  exit 1
fi
echo
echo "mirror complete — all seven weights reachable at the URLs seeds/intellae.ts points at."
