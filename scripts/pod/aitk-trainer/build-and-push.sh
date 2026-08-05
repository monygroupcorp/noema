#!/usr/bin/env bash
# =============================================================================
# build-and-push.sh — build + publish the aitk-trainer image to Docker Hub
# =============================================================================
#
# Mirrors the TEE-runner publish flow (manual docker build + push to the monygroup/ org;
# no CI — the image changes rarely). The build needs NO GPU. Run a local smoke test
# (./smoke-test.sh) on the 4090 BEFORE pushing.
#
# Usage:
#   ./build-and-push.sh                  # build + push monygroup/aitk-klein:<dated-tag>
#   PUSH=0 ./build-and-push.sh           # build only (no push)
#   TAG=0623a ./build-and-push.sh        # explicit tag
#   IMAGE=monygroup/aitk-klein ./build-and-push.sh
# =============================================================================
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"

IMAGE="${IMAGE:-monygroup/aitk-klein}"
TAG="${TAG:-$(date +%m%d)a}"          # e.g. 0623a — dated like tee-runner:0619a
REF="${IMAGE}:${TAG}"

echo "==> building ${REF} (context: ${HERE})"
docker build -t "${REF}" "${HERE}"

if [ "${PUSH:-1}" = "1" ]; then
  echo "==> pushing ${REF}"
  docker push "${REF}"
  echo "==> pushed ${REF}"
  echo "    set AITK_REMOTE_IMAGE=${REF} in the deploy env to use it."
else
  echo "==> built ${REF} (PUSH=0 — not pushed)"
fi
