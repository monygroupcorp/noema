#!/bin/bash
# crystallog.sh — launch the Crystal dashboard TUI pointed at staging
#
# Usage:
#   ./crystallog.sh                    # staging (default)
#   ./crystallog.sh --local            # localhost:4000
#   ./crystallog.sh --url <url>        # custom URL

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env.staging"

# --- defaults ---
NOEMA_URL="https://staging.noema.art"

# Load secret from .env.staging or local .env if not already in environment
for f in "${ENV_FILE}" "${SCRIPT_DIR}/.env"; do
  if [[ -z "${INTERNAL_SECRET:-}" && -f "${f}" ]]; then
    val=$(grep -E '^INTERNAL_SECRET=' "${f}" | cut -d= -f2- | tr -d '"' || true)
    [[ -n "${val}" ]] && INTERNAL_SECRET="${val}"
  fi
done
INTERNAL_SECRET="${INTERNAL_SECRET:-}"

# --- arg parsing ---
while [[ $# -gt 0 ]]; do
  case "$1" in
    --local)    NOEMA_URL="http://localhost:4000"; shift ;;
    --url)      NOEMA_URL="$2"; shift 2 ;;
    --secret)   INTERNAL_SECRET="$2"; shift 2 ;;
    *) echo "Usage: $0 [--local] [--url <url>] [--secret <secret>]"; exit 1 ;;
  esac
done

export NOEMA_URL
export INTERNAL_SECRET

echo "[crystallog] Connecting to ${NOEMA_URL}"
exec node "${SCRIPT_DIR}/scripts/dashboard.js"
