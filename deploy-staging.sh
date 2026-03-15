#!/bin/bash
set -euo pipefail

# ------------------------------------------------------------------
# Noema Staging Deploy
#
# Usage:
#   ./deploy-staging.sh
#
# Pulls the :staging image from GHCR and restarts the staging
# container. No workers, no keystore, no maintenance mode.
# ------------------------------------------------------------------

DEPLOY_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${DEPLOY_ROOT}/.env.staging"

# Registry
REGISTRY="ghcr.io/monygroupcorp/noema"
IMAGE="${REGISTRY}:staging"

# Container
STAGING_CONTAINER="hyperbot-staging"
NETWORK_NAME="hyperbot_network"
CONTAINER_ALIAS="hyperbot-staging"

# Health check tuning
HEALTH_CHECK_RETRIES="${HEALTH_CHECK_RETRIES:-30}"
HEALTH_CHECK_DELAY="${HEALTH_CHECK_DELAY:-3}"

# Logging
LOG_DIR="/var/log/hyperbot"
LOG_FILE="${LOG_DIR}/hyperbot-staging.log"
mkdir -p "${LOG_DIR}"

log() { echo "[staging-deploy] $1" | tee -a "${LOG_FILE}"; }

# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------

stop_container_if_exists() {
  local name="$1"
  if docker ps -a --format '{{.Names}}' | grep -q "^${name}$"; then
    log "Stopping ${name}..."
    docker stop --time 10 "${name}" >> "${LOG_FILE}" 2>&1
    docker rm "${name}" >> "${LOG_FILE}" 2>&1
  fi
}

ensure_network() {
  if ! docker network inspect "${NETWORK_NAME}" >/dev/null 2>&1; then
    log "Creating docker network ${NETWORK_NAME}..."
    docker network create "${NETWORK_NAME}" >> "${LOG_FILE}" 2>&1
  fi
}

health_check() {
  local retries="${HEALTH_CHECK_RETRIES}"
  local delay="${HEALTH_CHECK_DELAY}"
  log "Checking health (${retries} × ${delay}s)..."

  while (( retries > 0 )); do
    if docker run --rm --network "${NETWORK_NAME}" curlimages/curl:8.5.0 \
      -sS -f "http://${CONTAINER_ALIAS}:4000/api/health" >/dev/null 2>&1; then
      log "Health check passed."
      return 0
    fi
    retries=$((retries - 1))
    sleep "${delay}"
  done

  log "Health check FAILED."
  return 1
}

# ==================================================================
# DEPLOY SEQUENCE
# ==================================================================

log "=== Staging deploy started ==="

# 1. Verify env file exists
if [[ ! -f "${ENV_FILE}" ]]; then
  log "Missing ${ENV_FILE} — create it on the droplet first."
  exit 1
fi

# 2. Pull image
log "Pulling ${IMAGE}..."
docker pull "${IMAGE}" 2>&1 | tee -a "${LOG_FILE}"

# 3. Stop existing staging container
stop_container_if_exists "${STAGING_CONTAINER}"

# 4. Ensure network
ensure_network

# 5. Start staging container
log "Starting staging container..."
docker run -d \
  --env-file "${ENV_FILE}" \
  --network "${NETWORK_NAME}" \
  --network-alias "${CONTAINER_ALIAS}" \
  --name "${STAGING_CONTAINER}" \
  --restart unless-stopped \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  "${IMAGE}" >> "${LOG_FILE}" 2>&1

# 6. Health check
if ! health_check; then
  log "Staging health check failed; dumping logs:"
  docker logs "${STAGING_CONTAINER}" 2>&1 | tail -n 100 | tee -a "${LOG_FILE}" || true
  log "=== Staging deploy FAILED ==="
  exit 1
fi

# 7. Cleanup
docker image prune -f >> "${LOG_FILE}" 2>&1 || true

log "Staging container logs:"
docker logs --tail 15 "${STAGING_CONTAINER}" 2>&1 | tee -a "${LOG_FILE}" || true

log "=== Staging deploy finished (${IMAGE}) ==="
