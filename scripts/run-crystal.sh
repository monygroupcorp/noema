#!/bin/bash

###############################################################################
# run-crystal.sh
#
# Crystal TypeScript dev runner.
# Starts the crystal server via tsx (no compile step), waits for it to be
# ready, then launches the TUI dashboard in the foreground.
# Quitting the dashboard (Q or Ctrl-C) shuts the server down cleanly.
#
# Usage:
#   ./scripts/run-crystal.sh
#
# Required in .env or environment:
#   BOT_TOKEN     — Telegram bot token
#   MONGODB_URI   — MongoDB connection string
#
# Optional overrides:
#   PORT            — crystal server port (default: 3001)
#   DB_NAME         — MongoDB database name (default: noema)
#   LOG_LEVEL       — log verbosity: debug|info|warn|error (default: info)
#   INTERNAL_SECRET — dashboard auth token (default: dev-secret)
#   RUNPOD_API_KEY  — if set, RunPod pod client is enabled
###############################################################################

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$REPO_DIR"

# -----------------------------------------------------------------------------
# 1. Load .env
# -----------------------------------------------------------------------------
if [ -f .env ]; then
  echo "[run-crystal.sh] Loading .env"
  while IFS='=' read -r key value; do
    key="$(echo "$key" | xargs)"
    value="$(echo "$value" | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/")"
    if [[ -z "$key" || "$key" =~ ^# ]]; then continue; fi
    if [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
      # Env vars set before the script runs take precedence over .env
      if [ -z "${!key+x}" ]; then
        export "$key"="$value"
      fi
    fi
  done < <(grep -v '^\s*#' .env | grep '=')
else
  echo "[run-crystal.sh] No .env found — using existing environment"
fi

# -----------------------------------------------------------------------------
# 2. Dev defaults
# -----------------------------------------------------------------------------
export PORT="${PORT:-3001}"
export DB_NAME="${DB_NAME:-noema}"
export LOG_LEVEL="${LOG_LEVEL:-debug}"
export INTERNAL_SECRET="${INTERNAL_SECRET:-dev-secret}"
export DEV_FREE_EXECUTION="${DEV_FREE_EXECUTION:-1}"

# Suppress RunPod webhook URL in dev so the server doesn't wait for callbacks
# that will never come (set it in .env if you want to test the full async path)
export RUNPOD_WEBHOOK_URL="${RUNPOD_WEBHOOK_URL:-}"

# -----------------------------------------------------------------------------
# 3. Required vars check
# -----------------------------------------------------------------------------
if [ -z "${BOT_TOKEN:-}" ]; then
  echo "[run-crystal.sh] ERROR: BOT_TOKEN is not set. Add it to .env"
  exit 1
fi

if [ -z "${MONGODB_URI:-}" ]; then
  echo "[run-crystal.sh] ERROR: MONGODB_URI is not set. Add it to .env"
  exit 1
fi

echo "[run-crystal.sh] Port:     $PORT"
echo "[run-crystal.sh] DB:       $DB_NAME"
echo "[run-crystal.sh] LogLevel: $LOG_LEVEL"
if [ -n "${RUNPOD_API_KEY:-}" ]; then
  echo "[run-crystal.sh] RunPod:   enabled"
else
  echo "[run-crystal.sh] RunPod:   disabled (RUNPOD_API_KEY not set)"
fi

# -----------------------------------------------------------------------------
# 4. Cleanup on exit — kill crystal server when dashboard quits
# -----------------------------------------------------------------------------
CRYSTAL_PID=""

cleanup() {
  if [ -n "$CRYSTAL_PID" ]; then
    echo ""
    echo "[run-crystal.sh] Shutting down crystal server (pid $CRYSTAL_PID)..."
    kill "$CRYSTAL_PID" 2>/dev/null || true
    # Wait up to 4s for graceful exit, then force-kill
    for _ in 1 2 3 4; do
      sleep 1
      kill -0 "$CRYSTAL_PID" 2>/dev/null || { echo "[run-crystal.sh] Server stopped."; return; }
    done
    echo "[run-crystal.sh] Force-killing server..."
    kill -9 "$CRYSTAL_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# -----------------------------------------------------------------------------
# 5. Start crystal server via tsx (no compile step)
# -----------------------------------------------------------------------------
CRYSTAL_LOG="/tmp/crystal-dev.log"

# Fail fast if port is already in use — avoids silently connecting to a stale server
if lsof -ti :"$PORT" >/dev/null 2>&1; then
  STALE_PID=$(lsof -ti :"$PORT" 2>/dev/null)
  STALE_CMD=$(ps -p "$STALE_PID" -o comm= 2>/dev/null || echo "unknown")
  echo "[run-crystal.sh] ERROR: port $PORT already in use by pid $STALE_PID ($STALE_CMD)"
  echo "[run-crystal.sh] Stop it first, or unset PORT to use a different port."
  exit 1
fi

echo "[run-crystal.sh] Starting crystal server (raw logs → $CRYSTAL_LOG)..."
npx tsx src/index.ts > "$CRYSTAL_LOG" 2>&1 &
CRYSTAL_PID=$!

# Wait for the server to accept connections — verify it's OUR process on the port
MAX_WAIT=45
WAITED=0
echo -n "[run-crystal.sh] Waiting for :$PORT"
while ! (echo >/dev/tcp/localhost/$PORT) 2>/dev/null; do
  if ! kill -0 "$CRYSTAL_PID" 2>/dev/null; then
    echo ""
    echo "[run-crystal.sh] ERROR: Crystal server exited unexpectedly. Check $CRYSTAL_LOG"
    exit 1
  fi
  if [ $WAITED -ge $MAX_WAIT ]; then
    echo ""
    echo "[run-crystal.sh] ERROR: Crystal server did not start within ${MAX_WAIT}s."
    exit 1
  fi
  sleep 1
  WAITED=$((WAITED + 1))
  echo -n "."
done
echo " ready (${WAITED}s)"

# -----------------------------------------------------------------------------
# 6. Launch dashboard TUI (foreground — blocks until user quits)
# -----------------------------------------------------------------------------
echo "[run-crystal.sh] Launching dashboard — press Q to quit"
echo ""

NOEMA_URL="http://localhost:$PORT" \
INTERNAL_SECRET="$INTERNAL_SECRET" \
  node scripts/dashboard.js
