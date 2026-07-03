#!/bin/bash
set -euo pipefail

# ------------------------------------------------------------------
# Noema Production Deploy — Registry-Based
#
# Usage:
#   ./deploy.sh [VERSION]
#
#   VERSION defaults to "latest". Examples:
#     ./deploy.sh           # deploys :latest
#     ./deploy.sh 4.1.0     # deploys :4.1.0
#     ./deploy.sh 4.0.0     # rollback to :4.0.0
#
# Deploys the single crystal app container (blue-green) behind Caddy.
# The legacy export/training/sweeper worker containers were removed with
# the JS nuke; hung-pod recovery is now handled in-app (Census wall-clock
# billing + idle reaper).
# ------------------------------------------------------------------

DEPLOY_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${DEPLOY_ROOT}/.env"

# Registry
REGISTRY="ghcr.io/monygroupcorp/noema"
VERSION="${1:-latest}"
IMAGE="${REGISTRY}:${VERSION}"

# Containers
APP_CONTAINER="hyperbotcontained"
NETWORK_NAME="hyperbot_network"
CONTAINER_ALIAS="hyperbot"

# Caddy
CADDY_CONTAINER="caddy_proxy"
CADDY_IMAGE="caddy:latest"
CADDYFILE_PATH="${DEPLOY_ROOT}/Caddyfile"

# Logging / maintenance
LOG_DIR="/var/log/hyperbot"
LOG_FILE="${LOG_DIR}/hyperbot.log"
MAINT_DIR="/var/run/hyperbot"
MAINT_FLAG="${MAINT_DIR}/maintenance.flag"

# Keystore
KEYSTORE_SCRIPT="${DEPLOY_ROOT}/keystore/loadKeystore.js"
KEYSTORE_PATH="/etc/account/STATIONTHIS"

# Health check tuning
HEALTH_CHECK_RETRIES="${HEALTH_CHECK_RETRIES:-80}"
HEALTH_CHECK_DELAY="${HEALTH_CHECK_DELAY:-5}"

# Graceful shutdown: 35s allows the app's in-flight cleanup + buffer
STOP_TIMEOUT=35

MAINTENANCE_ENABLED=0

# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------

load_env_var() {
  local var_name="$1"
  local current="${!var_name:-}"
  if [[ -n "${current}" ]]; then printf '%s' "${current}"; return; fi
  if [[ -f "${ENV_FILE}" ]]; then
    local value
    value=$(grep -E "^${var_name}=" "${ENV_FILE}" | tail -n1 | sed -E "s/^${var_name}=//" | tr -d '\r\"'"'"'' || true)
    if [[ -n "${value}" ]]; then printf '%s' "${value}"; return; fi
  fi
  printf ''
}

mkdir -p "${LOG_DIR}" "${MAINT_DIR}"

log() { echo "[deploy] $1" | tee -a "${LOG_FILE}"; }

run_logged() {
  local desc="$1"; shift
  log "$desc"
  "$@" >> "${LOG_FILE}" 2>&1
}

rotate_logs() {
  if [[ -f "${LOG_FILE}" ]]; then
    tail -n 1000 "${LOG_FILE}" > "${LOG_FILE}.tmp" && mv "${LOG_FILE}.tmp" "${LOG_FILE}"
  fi
}

# ------------------------------------------------------------------
# Maintenance mode
# ------------------------------------------------------------------

enable_maintenance() {
  if [[ "${MAINTENANCE_ENABLED}" == "1" ]]; then return; fi
  : > "${MAINT_FLAG}"
  MAINTENANCE_ENABLED=1
  log "Maintenance flag enabled."
}

disable_maintenance() {
  if [[ "${MAINTENANCE_ENABLED}" == "0" ]]; then return; fi
  rm -f "${MAINT_FLAG}"
  MAINTENANCE_ENABLED=0
  log "Maintenance flag cleared."
}

# Safety net: clear maintenance on unexpected exit
cleanup() {
  if [[ "${MAINTENANCE_ENABLED}" == "1" ]]; then
    disable_maintenance || true
  fi
}
trap cleanup EXIT

# ------------------------------------------------------------------
# Container lifecycle
# ------------------------------------------------------------------

stop_container_if_exists() {
  local name="$1"
  if docker ps -a --format '{{.Names}}' | grep -q "^${name}$"; then
    run_logged "Stopping ${name} (${STOP_TIMEOUT}s graceful)..." docker stop --time "${STOP_TIMEOUT}" "${name}"
    run_logged "Removing ${name}..." docker rm "${name}"
  fi
}

ensure_network() {
  if ! docker network inspect "${NETWORK_NAME}" >/dev/null 2>&1; then
    run_logged "Creating docker network ${NETWORK_NAME}..." docker network create "${NETWORK_NAME}"
  fi
}

start_caddy() {
  if docker ps --format '{{.Names}}' | grep -q "^${CADDY_CONTAINER}$"; then
    # Caddy already running with bind-mounted Caddyfile — just reload
    log "Reloading Caddy config..."
    docker exec "${CADDY_CONTAINER}" caddy reload --config /etc/caddy/Caddyfile >> "${LOG_FILE}" 2>&1 || true
    return
  fi
  run_logged "Starting Caddy reverse proxy..." docker rm -f "${CADDY_CONTAINER}" 2>/dev/null || true
  docker volume create caddy_data >/dev/null 2>&1 || true
  docker volume create caddy_config >/dev/null 2>&1 || true
  run_logged "Starting caddy..." docker run -d \
    --name "${CADDY_CONTAINER}" \
    --network "${NETWORK_NAME}" \
    --restart unless-stopped \
    -p 80:80 \
    -p 443:443 \
    -v "${CADDYFILE_PATH}":/etc/caddy/Caddyfile \
    -v caddy_data:/data \
    -v caddy_config:/config \
    "${CADDY_IMAGE}"
}

health_check_app() {
  local container="${1:-${APP_CONTAINER}}"
  local alias="${2:-${CONTAINER_ALIAS}}"
  local retries="${HEALTH_CHECK_RETRIES}"
  local delay="${HEALTH_CHECK_DELAY}"
  log "Checking health of ${container} (${retries} × ${delay}s)..."

  docker logs -f "${container}" 2>&1 &
  local log_pid=$!
  sleep 1

  while (( retries > 0 )); do
    if docker run --rm --network "${NETWORK_NAME}" curlimages/curl:8.5.0 \
      -sS -f "http://${alias}:4000/api/health" >/dev/null 2>&1; then
      kill "${log_pid}" 2>/dev/null || true
      wait "${log_pid}" 2>/dev/null || true
      log "Health check passed for ${container}."
      return 0
    fi
    retries=$((retries - 1))
    sleep "${delay}"
  done

  kill "${log_pid}" 2>/dev/null || true
  wait "${log_pid}" 2>/dev/null || true
  log "Health check FAILED for ${container}."
  return 1
}

# ==================================================================
# DEPLOY SEQUENCE
# ==================================================================

log "=== Noema deploy started (image: ${IMAGE}) ==="
rotate_logs

# 1. Free disk space before pull — remove all unused images (old versioned tags accumulate)
log "Pruning unused Docker images to free disk space..."
docker image prune -a -f >> "${LOG_FILE}" 2>&1 || true

# 2. Pull image from registry
log "Pulling image ${IMAGE}..."
docker pull "${IMAGE}" 2>&1 | tee -a "${LOG_FILE}"

# 3. Enable maintenance mode
enable_maintenance

# 4. Load Ethereum signer private key (interactive — requires TTY)
log "Loading Ethereum signer private key..."
PRIVATE_KEY=$(node "${KEYSTORE_SCRIPT}" --path "${KEYSTORE_PATH}" < /dev/tty)
if [[ -z "${PRIVATE_KEY}" ]]; then
  log "Failed to load private key; aborting."
  exit 1
fi

# 5. Ensure infrastructure
ensure_network
start_caddy

# 6. Blue-green: start new container alongside old
NEW_CONTAINER="${APP_CONTAINER}-new"
NEW_ALIAS="${CONTAINER_ALIAS}-new"
stop_container_if_exists "${NEW_CONTAINER}"

run_logged "Starting new container (${IMAGE})..." docker run -d \
  --env ETHEREUM_SIGNER_PRIVATE_KEY="${PRIVATE_KEY}" \
  --env MAINTENANCE_MODE_FILE="${MAINT_FLAG}" \
  --env-file "${ENV_FILE}" \
  --network "${NETWORK_NAME}" \
  --network-alias "${NEW_ALIAS}" \
  --restart unless-stopped \
  -v "${MAINT_DIR}:${MAINT_DIR}" \
  --name "${NEW_CONTAINER}" \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  "${IMAGE}"

# 7. Health check new container — old keeps serving traffic
if ! health_check_app "${NEW_CONTAINER}" "${NEW_ALIAS}"; then
  log "Health check failed on new container; old container still serving."
  docker logs "${NEW_CONTAINER}" 2>&1 | tail -n 200 >> "${LOG_FILE}" || true
  stop_container_if_exists "${NEW_CONTAINER}"
  unset PRIVATE_KEY
  disable_maintenance
  log "Deploy ABORTED. No downtime occurred."
  exit 1
fi

# 8. Swap: disconnect old, reconnect new with production alias
log "Swapping traffic to new container..."
if docker ps --format '{{.Names}}' | grep -q "^${APP_CONTAINER}$"; then
  docker network disconnect "${NETWORK_NAME}" "${APP_CONTAINER}" >> "${LOG_FILE}" 2>&1 || true
fi
docker network disconnect "${NETWORK_NAME}" "${NEW_CONTAINER}" >> "${LOG_FILE}" 2>&1
docker network connect --alias "${CONTAINER_ALIAS}" "${NETWORK_NAME}" "${NEW_CONTAINER}" >> "${LOG_FILE}" 2>&1
log "Traffic swapped to new container."

# 9. Stop old container (capturing shutdown logs), then rename new
if docker ps -a --format '{{.Names}}' | grep -q "^${APP_CONTAINER}$"; then
  log "Stopping ${APP_CONTAINER} (${STOP_TIMEOUT}s graceful)..."
  docker stop --time "${STOP_TIMEOUT}" "${APP_CONTAINER}" >> "${LOG_FILE}" 2>&1
  OLD_SHUTDOWN_LOG="${LOG_DIR}/shutdown-$(date +%Y%m%d-%H%M%S).log"
  docker logs --tail 50 "${APP_CONTAINER}" >> "${OLD_SHUTDOWN_LOG}" 2>&1 || true
  grep -E "(Stopping Telegram|polling stopped|Graceful shutdown)" "${OLD_SHUTDOWN_LOG}" \
    | while read -r line; do log "  [old-container] ${line}"; done || true
  log "Removing ${APP_CONTAINER}..."
  docker rm "${APP_CONTAINER}" >> "${LOG_FILE}" 2>&1
fi
docker rename "${NEW_CONTAINER}" "${APP_CONTAINER}" >> "${LOG_FILE}" 2>&1
log "Container renamed to ${APP_CONTAINER}."

# 10. Clear private key from memory
unset PRIVATE_KEY

# 11. Disable maintenance
disable_maintenance

# 12. Tag current image as 'previous' for future rollbacks
docker tag "${IMAGE}" "${REGISTRY}:previous" >> "${LOG_FILE}" 2>&1 || true

# 13. Cleanup unused images (belt-and-suspenders after pre-pull prune)
docker image prune -a -f >> "${LOG_FILE}" 2>&1 || true

log "Deployment complete. Recent app logs:"
docker logs --tail 30 "${APP_CONTAINER}" 2>&1 | tee -a "${LOG_FILE}" || true

log "=== Noema deploy finished (${IMAGE}) ==="
