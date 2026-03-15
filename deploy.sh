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
WORKER_CONTAINER="hyperbotworker"
WORKER_ALIAS="hyperbot-worker"
TRAINING_WORKER_CONTAINER="hyperbottraining"
TRAINING_WORKER_ALIAS="hyperbot-training"
SWEEPER_CONTAINER="hyperbotsweeper"
SWEEPER_ALIAS="hyperbot-sweeper"
SWEEPER_INTERVAL="${SWEEPER_INTERVAL_SECONDS:-900}"

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

# Worker control
INTERNAL_API_URL="http://${CONTAINER_ALIAS}:4000/internal/v1/data"
WORKER_WAIT_TIMEOUT="${WORKER_WAIT_TIMEOUT:-1800}"
WORKER_POLL_INTERVAL="${WORKER_POLL_INTERVAL:-15}"

# Health check tuning
HEALTH_CHECK_RETRIES="${HEALTH_CHECK_RETRIES:-80}"
HEALTH_CHECK_DELAY="${HEALTH_CHECK_DELAY:-5}"

# Graceful shutdown: 35s allows credit worker 30s cleanup + buffer
STOP_TIMEOUT=35

WORKER_PAUSED=0
WORKER_RESUMED=0
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

INTERNAL_API_KEY_ADMIN="$(load_env_var INTERNAL_API_KEY_ADMIN)"

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
# Worker control (via export-worker-control.js inside running container)
# ------------------------------------------------------------------

worker_ctl() {
  local cmd="$1"; shift
  if [[ -z "${INTERNAL_API_KEY_ADMIN}" ]]; then
    log "INTERNAL_API_KEY_ADMIN not set; skipping worker ${cmd}."
    return 1
  fi
  if ! docker ps --format '{{.Names}}' | grep -q "^${APP_CONTAINER}$"; then
    log "Container ${APP_CONTAINER} not running; cannot execute worker ${cmd}."
    return 1
  fi
  local output
  output=$(docker exec "${APP_CONTAINER}" \
    env INTERNAL_API_BASE="http://localhost:4000/internal/v1/data" \
    INTERNAL_API_KEY_ADMIN="${INTERNAL_API_KEY_ADMIN}" \
    node /usr/src/app/scripts/export-worker-control.js "$cmd" "$@" 2>> "${LOG_FILE}")
  if [[ -n "${output}" ]]; then
    printf '%s\n' "${output}" >> "${LOG_FILE}"
    printf '%s\n' "${output}"
  fi
}

pause_worker() {
  if [[ -z "${INTERNAL_API_KEY_ADMIN}" ]]; then
    log "INTERNAL_API_KEY_ADMIN not set; skipping worker pause."
    return
  fi
  if worker_ctl pause "deploy" >/dev/null; then
    WORKER_PAUSED=1
    log "Worker pause acknowledged."
  else
    log "Warning: unable to pause worker; proceeding."
  fi
}

wait_for_worker_idle() {
  if [[ -z "${INTERNAL_API_KEY_ADMIN}" ]]; then return; fi
  log "Waiting for worker to become idle..."
  local start_ts
  start_ts=$(date +%s)
  while true; do
    local status_json
    status_json=$(worker_ctl status || true)
    if [[ -z "${status_json}" ]]; then
      log "Warning: unable to query worker status; assuming idle."
      return
    fi
    local state currentJob
    state=$(printf '%s' "${status_json}" | python3 -c 'import json,sys; obj=json.loads(sys.stdin.read()); print(obj.get("status",""))' 2>/dev/null || printf '')
    currentJob=$(printf '%s' "${status_json}" | python3 -c 'import json,sys; obj=json.loads(sys.stdin.read()); print(obj.get("activeJobId",""))' 2>/dev/null || printf '')
    log "Worker status: ${state:-unknown} ${currentJob:+(job ${currentJob})}"
    if [[ "${state}" != "busy" ]]; then return; fi
    local now elapsed
    now=$(date +%s)
    elapsed=$((now - start_ts))
    if (( elapsed > WORKER_WAIT_TIMEOUT )); then
      if [[ "${FORCE_DEPLOY:-0}" == "1" ]]; then
        log "Worker still busy after ${elapsed}s but FORCE_DEPLOY=1; continuing."
        return
      fi
      log "Worker still busy after ${elapsed}s; aborting deploy."
      exit 1
    fi
    sleep "${WORKER_POLL_INTERVAL}"
  done
}

resume_worker() {
  if [[ -z "${INTERNAL_API_KEY_ADMIN}" ]]; then return; fi
  if worker_ctl resume >/dev/null; then
    WORKER_RESUMED=1
    log "Worker resume acknowledged."
  else
    log "Warning: unable to resume worker."
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

# Safety net: resume worker + clear maintenance on unexpected exit
cleanup() {
  if [[ "${WORKER_PAUSED}" == "1" && "${WORKER_RESUMED}" == "0" ]]; then
    resume_worker || true
  fi
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
    # Caddy already running — reload config
    log "Reloading Caddy config..."
    docker cp "${CADDYFILE_PATH}" "${CADDY_CONTAINER}":/etc/caddy/Caddyfile
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

# ------------------------------------------------------------------
# Worker management
# ------------------------------------------------------------------

start_worker_container() {
  run_logged "Starting export worker container..." docker run -d \
    --env COLLECTION_EXPORT_PROCESSING_ENABLED=true \
    --env-file "${ENV_FILE}" \
    --network "${NETWORK_NAME}" \
    --network-alias "${WORKER_ALIAS}" \
    --name "${WORKER_CONTAINER}" \
    --restart unless-stopped \
    --cap-drop ALL \
    --security-opt no-new-privileges \
    "${IMAGE}" \
    node worker.js
}

ensure_worker_running() {
  if docker ps --format '{{.Names}}' | grep -q "^${WORKER_CONTAINER}$"; then
    log "Worker container already running."
    return
  fi
  log "Worker container not running; starting..."
  start_worker_container
}

start_training_worker_container() {
  local ssh_key_path
  ssh_key_path="$(load_env_var VASTAI_SSH_KEY_PATH)"
  local ssh_key_dir ssh_key_name container_ssh_dir="/home/node/.ssh/vastai"
  ssh_key_dir="$(dirname "${ssh_key_path}")"
  ssh_key_name="$(basename "${ssh_key_path}")"

  if [[ -z "${ssh_key_path}" ]]; then
    log "WARNING: VASTAI_SSH_KEY_PATH not set, training worker may fail SSH operations"
  fi

  if [[ -n "${ssh_key_path}" && -f "${ssh_key_path}" ]]; then
    log "Setting SSH key permissions for container node user (uid 1000)..."
    chmod 755 "${ssh_key_dir}"
    chown 1000:1000 "${ssh_key_path}" "${ssh_key_path}.pub" 2>/dev/null || true
    chmod 600 "${ssh_key_path}"
    chmod 644 "${ssh_key_path}.pub" 2>/dev/null || true
  fi

  run_logged "Starting VastAI training worker..." docker run -d \
    --env-file "${ENV_FILE}" \
    --env "VASTAI_SSH_KEY_PATH=${container_ssh_dir}/${ssh_key_name}" \
    --network "${NETWORK_NAME}" \
    --network-alias "${TRAINING_WORKER_ALIAS}" \
    --name "${TRAINING_WORKER_CONTAINER}" \
    --restart unless-stopped \
    --cap-drop ALL \
    --security-opt no-new-privileges \
    -v "${ssh_key_dir}:${container_ssh_dir}:ro" \
    "${IMAGE}" \
    node scripts/workers/vastaiTrainingWorker.js
}

ensure_training_worker_running() {
  local vastai_key
  vastai_key="$(load_env_var VASTAI_API_KEY)"
  if [[ -z "${vastai_key}" ]]; then
    log "VASTAI_API_KEY not set; skipping training worker."
    return
  fi
  if docker ps --format '{{.Names}}' | grep -q "^${TRAINING_WORKER_CONTAINER}$"; then
    log "Training worker already running."
    return
  fi
  log "Training worker not running; starting..."
  start_training_worker_container
}

start_sweeper_container() {
  run_logged "Starting instance sweeper..." docker run -d \
    --env-file "${ENV_FILE}" \
    --network "${NETWORK_NAME}" \
    --network-alias "${SWEEPER_ALIAS}" \
    --name "${SWEEPER_CONTAINER}" \
    --restart unless-stopped \
    --cap-drop ALL \
    --security-opt no-new-privileges \
    "${IMAGE}" \
    /bin/sh -c "while true; do sleep ${SWEEPER_INTERVAL}; node scripts/workers/instanceSweeper.js || true; done"
}

ensure_sweeper_running() {
  local vastai_key
  vastai_key="$(load_env_var VASTAI_API_KEY)"
  if [[ -z "${vastai_key}" ]]; then
    log "VASTAI_API_KEY not set; skipping sweeper."
    return
  fi
  if docker ps --format '{{.Names}}' | grep -q "^${SWEEPER_CONTAINER}$"; then
    log "Sweeper already running."
    return
  fi
  log "Sweeper not running; starting..."
  start_sweeper_container
}

# ==================================================================
# DEPLOY SEQUENCE
# ==================================================================

log "=== Noema deploy started (image: ${IMAGE}) ==="
rotate_logs

DEPLOY_WORKER_FLAG="${DEPLOY_WORKER:-0}"
DEPLOY_TRAINING_WORKER_FLAG="${DEPLOY_TRAINING_WORKER:-0}"

# 1. Pull image from registry
log "Pulling image ${IMAGE}..."
docker pull "${IMAGE}" 2>&1 | tee -a "${LOG_FILE}"

# 2. Pause export worker if requested
if [[ "${DEPLOY_WORKER_FLAG}" == "1" ]]; then
  pause_worker
  wait_for_worker_idle
else
  log "Skipping worker pause (DEPLOY_WORKER not set)."
fi

# 3. Enable maintenance mode
enable_maintenance

# 4. Load Ethereum signer private key (interactive — requires TTY)
log "Loading Ethereum signer private key..."
PRIVATE_KEY=$(node "${KEYSTORE_SCRIPT}" --path "${KEYSTORE_PATH}" < /dev/tty)
if [[ -z "${PRIVATE_KEY}" ]]; then
  log "Failed to load private key; aborting."
  exit 1
fi

# 5. Stop existing containers
log "Stopping application container..."
stop_container_if_exists "${APP_CONTAINER}"
if [[ "${DEPLOY_WORKER_FLAG}" == "1" ]]; then
  stop_container_if_exists "${WORKER_CONTAINER}"
fi
if [[ "${DEPLOY_TRAINING_WORKER_FLAG}" == "1" ]]; then
  stop_container_if_exists "${TRAINING_WORKER_CONTAINER}"
  stop_container_if_exists "${SWEEPER_CONTAINER}"
fi

# 6. Ensure infrastructure
ensure_network
start_caddy

# 7. Start new application container
run_logged "Starting application container (${IMAGE})..." docker run -d \
  --env ETHEREUM_SIGNER_PRIVATE_KEY="${PRIVATE_KEY}" \
  --env MAINTENANCE_MODE_FILE="${MAINT_FLAG}" \
  --env COLLECTION_EXPORT_PROCESSING_ENABLED=false \
  --env-file "${ENV_FILE}" \
  --network "${NETWORK_NAME}" \
  --network-alias "${CONTAINER_ALIAS}" \
  --restart unless-stopped \
  -v "${MAINT_DIR}:${MAINT_DIR}" \
  --name "${APP_CONTAINER}" \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  "${IMAGE}"

# 8. Health check — rollback on failure
if ! health_check_app; then
  log "Health check failed; collecting container logs..."
  docker logs "${APP_CONTAINER}" 2>&1 | tail -n 200 >> "${LOG_FILE}" || true
  log "Attempting rollback..."
  stop_container_if_exists "${APP_CONTAINER}"

  # Try the previous version tag if available
  ROLLBACK_IMAGE="${REGISTRY}:previous"
  if docker image inspect "${ROLLBACK_IMAGE}" >/dev/null 2>&1; then
    run_logged "Starting rollback container (${ROLLBACK_IMAGE})..." docker run -d \
      --env ETHEREUM_SIGNER_PRIVATE_KEY="${PRIVATE_KEY}" \
      --env MAINTENANCE_MODE_FILE="${MAINT_FLAG}" \
      --env-file "${ENV_FILE}" \
      --network "${NETWORK_NAME}" \
      --network-alias "${CONTAINER_ALIAS}" \
      --restart unless-stopped \
      -v "${MAINT_DIR}:${MAINT_DIR}" \
      --name "${APP_CONTAINER}" \
      --cap-drop ALL \
      --security-opt no-new-privileges \
      "${ROLLBACK_IMAGE}"
    log "Rollback container started. Deploy FAILED."
  else
    log "No rollback image available. Deploy FAILED."
  fi
  unset PRIVATE_KEY
  exit 1
fi

# 9. Clear private key from memory
unset PRIVATE_KEY

# 10. Disable maintenance
disable_maintenance

# 11. Ensure workers are running
ensure_worker_running
ensure_training_worker_running
ensure_sweeper_running

if [[ "${DEPLOY_WORKER_FLAG}" == "1" ]]; then
  resume_worker
fi

# 12. Tag current image as 'previous' for future rollbacks
docker tag "${IMAGE}" "${REGISTRY}:previous" >> "${LOG_FILE}" 2>&1 || true

# 13. Cleanup dangling images
docker image prune -f >> "${LOG_FILE}" 2>&1 || true

log "Deployment complete. Recent app logs:"
docker logs --tail 30 "${APP_CONTAINER}" 2>&1 | tee -a "${LOG_FILE}" || true

log "=== Noema deploy finished (${IMAGE}) ==="
