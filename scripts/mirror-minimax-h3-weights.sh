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
# Credentials come from the repo's .env — no exports needed:
#   ./scripts/mirror-minimax-h3-weights.sh              # upload, then verify
#   ./scripts/mirror-minimax-h3-weights.sh --verify     # verify only, no upload
#   ./scripts/mirror-minimax-h3-weights.sh --dry-run
#
# It looks for .env at $ENV_FILE, then the repo root, then the MAIN worktree's root
# (a linked worktree has no .env of its own — it is gitignored and never copied over).
# Anything already exported wins over the file, so a one-off override still works:
#   R2_MODELS_BUCKET=other-bucket ./scripts/mirror-minimax-h3-weights.sh
#
# Values are read, never echoed. The script prints which file it used and which keys
# it found by NAME only.
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

# ── .env loading ───────────────────────────────────────────────────────────
# Parsed, never sourced: sourcing an env file EXECUTES it, and a stray backtick or
# $(…) in a secret would run as code. This reads one key at a time and does no
# expansion at all.
env_file() {
  local -a candidates=()
  [[ -n "${ENV_FILE:-}" ]] && candidates+=("$ENV_FILE")
  local root common
  root=$(git rev-parse --show-toplevel 2>/dev/null) && candidates+=("$root/.env")
  # In a linked worktree --git-common-dir points at the MAIN checkout's .git, whose
  # parent is the main worktree — where the gitignored .env actually lives.
  common=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null) \
    && candidates+=("$(dirname "$common")/.env")
  local f
  for f in "${candidates[@]}"; do
    [[ -f "$f" ]] && { printf '%s' "$f"; return 0; }
  done
  return 1
}

read_env_key() {  # <file> <KEY> — value to stdout, never logged
  local file="$1" key="$2" line val
  line=$(grep -E "^[[:space:]]*(export[[:space:]]+)?${key}[[:space:]]*=" "$file" 2>/dev/null | tail -n 1) || true
  [[ -n "$line" ]] || return 1
  val=${line#*=}
  val=${val#"${val%%[![:space:]]*}"}          # ltrim
  case "$val" in
    \"*) val=${val#\"}; val=${val%%\"*} ;;    # double-quoted
    \'*) val=${val#\'}; val=${val%%\'*} ;;    # single-quoted
    *)   val=${val%% \#*}                      # unquoted inline comment
         val=${val%"${val##*[![:space:]]}"}   # rtrim
         ;;
  esac
  val=${val%$'\r'}                             # CRLF-safe
  [[ -n "$val" ]] || return 1
  printf '%s' "$val"
}

need_env() {
  local wanted=(R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_MODELS_BUCKET R2_MODELS_PUBLIC_URL)
  local file found=() v val
  if file=$(env_file); then
    echo "== credentials from $file"
    for v in "${wanted[@]}"; do
      # An exported value always wins, so a one-off override is not silently ignored.
      [[ -n "${!v:-}" ]] && continue
      if val=$(read_env_key "$file" "$v"); then
        export "$v=$val"
        found+=("$v")
      fi
    done
    (( ${#found[@]} )) && echo "   loaded: ${found[*]}" || echo "   loaded: (nothing new — all already exported)"
  else
    echo "== no .env found; relying on the environment" >&2
  fi

  # Re-read the two that carry defaults, now that .env has had its say.
  BUCKET="${R2_MODELS_BUCKET:-$BUCKET}"
  PUBLIC_URL="${R2_MODELS_PUBLIC_URL:-$PUBLIC_URL}"

  local missing=()
  for v in R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY; do
    [[ -n "${!v:-}" ]] || missing+=("$v")
  done
  if (( ${#missing[@]} )); then
    echo "missing: ${missing[*]}" >&2
    echo "not in the environment and not in the .env this script found" >&2
    exit 1
  fi
  echo "   bucket: $BUCKET   public: $PUBLIC_URL"
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

# Verify mode still needs the .env, for the bucket + public URL it may carry.
(( VERIFY_ONLY )) && need_env || true

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
