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
#
# The DEPLOYED copy runs from /opt/noema/ ON THE DROPLET (ssh host `noema`) — that is the
# source of truth (it holds .env.staging with SERVE_WEB_APP=1, formerly STAGING_FRONTEND=1).
# Runbook + full context:
# docs/ops/staging-deploy.md.
# ------------------------------------------------------------------

DEPLOY_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${DEPLOY_ROOT}/.env.staging"

# Registry
REGISTRY="ghcr.io/monygroupcorp/noema"
IMAGE="${REGISTRY}:staging"

# Container — MUST match the live ops (Caddy routes staging.noema.art → hyperbot-staging)
STAGING_CONTAINER="hyperbot-staging"
NETWORK_NAME="hyperbot_network"
CONTAINER_ALIAS="hyperbot-staging"

# Health check tuning
HEALTH_CHECK_RETRIES="${HEALTH_CHECK_RETRIES:-30}"
HEALTH_CHECK_DELAY="${HEALTH_CHECK_DELAY:-3}"

# Arcanum ceremony custody — the trusted-setup chain's .zkey files (host state, deliberately
# NOT in the image; see docs/arcanum-ceremony.md). Staging gets its OWN custody dir, not
# production's /opt/noema/ceremony: staging runs against its own MONGODB_URI (.env.staging),
# so it has its own ceremony transcript, and pointing it at prod's custody would let a staging
# CEREMONY_OPEN/CEREMONY_REOPEN write into the live ceremony's keys. Read-write: the sequencer
# stores each verified contribution here as it lands. Empty is correct before a ceremony opens.
CEREMONY_DIR="${CEREMONY_DIR:-/opt/noema/ceremony-staging}"
CEREMONY_DIR_IN_CONTAINER="/var/lib/noema/ceremony"

# Arcanum circuit setup artifacts (host state, NOT in the image: arcanum_0000.zkey and
# arcanum.r1cs are gitignored — too large to commit, per docs/arcanum-ceremony.md). Read-only
# and identical for every environment (same circuit), so staging defaults to production's copy
# rather than requiring a second one on disk; override with ARCANUM_ARTIFACTS_DIR if that ever
# changes. The app only reads arcanum_0000.zkey from here, and only at boot, and only on the
# one deploy that sets CEREMONY_OPEN or CEREMONY_REOPEN.
ARCANUM_ARTIFACTS_DIR="${ARCANUM_ARTIFACTS_DIR:-/opt/noema/arcanum-artifacts}"
ARCANUM_ARTIFACTS_DIR_IN_CONTAINER="/var/lib/noema/arcanum-artifacts"

# Logging
LOG_DIR="/var/log/hyperbot"
LOG_FILE="${LOG_DIR}/hyperbot-staging.log"
mkdir -p "${LOG_DIR}"
# Empty is the correct state before a ceremony opens; it fills as contributions land.
mkdir -p "${CEREMONY_DIR}"

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
#
# RunPod SSH key: the key lives on the host (uid-1000/600 at /root/.ssh/runpod) and MUST be
# mounted into the container at the path the app reads (RUNPOD_SSH_KEY_PATH, default
# /home/node/.ssh/runpod). Without this mount the container can't SSH into SECURE pods and
# every pod run fails "SSH private key not found" (incident 2026-06-19). Override the host
# source with RUNPOD_SSH_KEY_SRC if the key moves; it must be readable by uid 1000 (node).
RUNPOD_SSH_KEY_SRC="${RUNPOD_SSH_KEY_SRC:-/root/.ssh/runpod}"
if [[ ! -f "${RUNPOD_SSH_KEY_SRC}" ]]; then
  log "WARNING: RunPod SSH key not found at ${RUNPOD_SSH_KEY_SRC} — SECURE pod runs will fail until it's mounted."
fi

# Logs go to the host journal so they outlive this container, which every deploy removes:
# `journalctl -t noema-staging`. See docs/ops/staging-deploy.md.
log "Starting staging container..."
docker run -d \
  --env-file "${ENV_FILE}" \
  --env CEREMONY_ZKEY_DIR="${CEREMONY_DIR_IN_CONTAINER}" \
  --env ARCANUM_ROOT_ZKEY_PATH="${ARCANUM_ARTIFACTS_DIR_IN_CONTAINER}/arcanum_0000.zkey" \
  -v "${RUNPOD_SSH_KEY_SRC}:/home/node/.ssh/runpod:ro" \
  -v "${CEREMONY_DIR}:${CEREMONY_DIR_IN_CONTAINER}" \
  -v "${ARCANUM_ARTIFACTS_DIR}:${ARCANUM_ARTIFACTS_DIR_IN_CONTAINER}:ro" \
  --network "${NETWORK_NAME}" \
  --network-alias "${CONTAINER_ALIAS}" \
  --name "${STAGING_CONTAINER}" \
  --restart unless-stopped \
  --log-driver journald \
  --log-opt tag=noema-staging \
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
