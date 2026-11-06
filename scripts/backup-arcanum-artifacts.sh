#!/usr/bin/env bash
# =============================================================================
# backup-arcanum-artifacts.sh — off-box backup of the arcanum ceremony state
# =============================================================================
#
# What this protects: /opt/noema/arcanum-artifacts (the compiled circuit +
# Phase-2-init zkey) and /opt/noema/arcanum-ceremony (contributor .zkey files,
# content-addressed by sha256). Both live only on the production droplet.
# Unlike every other piece of app state, they are NOT reproducible from
# MongoDB: a contributor's .zkey cannot be regenerated, and losing it before
# the ceremony finalizes leaves the chain head permanently unextendable (see
# deploy.sh's CEREMONY_DIR comment). MongoDB itself is Atlas-hosted and
# off-box already; this script exists because these two directories are the
# one thing on this droplet that isn't.
#
# Run by noema-backup-arcanum.timer (systemd), daily. Safe to run by hand.
# Pushes a timestamped tarball to the existing R2_PRIVATE_OUTPUTS_BUCKET under
# backups/arcanum/ — no new cloud resource, reuses the app's own R2
# credentials from .env via rclone's env-var remote config, so the key never
# touches a config file on disk. Old backups are not deleted by this script;
# retention is left to an R2 lifecycle rule if the operator wants one.
#
# Requires rclone (apt install rclone).
# =============================================================================

set -euo pipefail

DEPLOY_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${DEPLOY_ROOT}/.env"

SRC_DIRS=(/opt/noema/arcanum-artifacts /opt/noema/arcanum-ceremony)
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
WORKDIR="$(mktemp -d)"
trap 'rm -rf "${WORKDIR}"' EXIT

TARBALL="${WORKDIR}/arcanum-backup-${STAMP}.tar.gz"

echo "[backup-arcanum] packing $(IFS=,; echo "${SRC_DIRS[*]}") -> ${TARBALL}"
tar -czf "${TARBALL}" "${SRC_DIRS[@]}"

if [[ -f "${ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a
fi

: "${R2_ACCOUNT_ID:?R2_ACCOUNT_ID not set (expected in ${ENV_FILE})}"
: "${R2_ACCESS_KEY_ID:?R2_ACCESS_KEY_ID not set (expected in ${ENV_FILE})}"
: "${R2_SECRET_ACCESS_KEY:?R2_SECRET_ACCESS_KEY not set (expected in ${ENV_FILE})}"
: "${R2_PRIVATE_OUTPUTS_BUCKET:?R2_PRIVATE_OUTPUTS_BUCKET not set (expected in ${ENV_FILE})}"

export RCLONE_CONFIG_R2BACKUP_TYPE="s3"
export RCLONE_CONFIG_R2BACKUP_PROVIDER="Cloudflare"
export RCLONE_CONFIG_R2BACKUP_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID}"
export RCLONE_CONFIG_R2BACKUP_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY}"
export RCLONE_CONFIG_R2BACKUP_ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
export RCLONE_CONFIG_R2BACKUP_ACL="private"

DEST="r2backup:${R2_PRIVATE_OUTPUTS_BUCKET}/backups/arcanum/"

echo "[backup-arcanum] uploading ${TARBALL} -> ${DEST}"
rclone copy "${TARBALL}" "${DEST}" --no-traverse

echo "[backup-arcanum] done: ${DEST}$(basename "${TARBALL}")"
