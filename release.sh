#!/bin/bash
set -euo pipefail

# ------------------------------------------------------------------
# Noema Release Helper
#
# Usage:
#   ./release.sh           # push current branch, show release-please PR
#   ./release.sh --merge   # push + wait for PR + merge (one fell swoop)
#   ./release.sh --status  # show PR status without pushing
# ------------------------------------------------------------------

MERGE=0
STATUS_ONLY=0

for arg in "$@"; do
  case "$arg" in
    --merge)  MERGE=1 ;;
    --status) STATUS_ONLY=1 ;;
    *) echo "Unknown argument: $arg"; exit 1 ;;
  esac
done

if ! command -v gh &>/dev/null; then
  echo "Error: gh (GitHub CLI) is required. Install from https://cli.github.com/"
  exit 1
fi

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)

if [[ "${STATUS_ONLY}" == "0" ]]; then
  if [[ "${CURRENT_BRANCH}" != "main" ]]; then
    echo "Warning: current branch is '${CURRENT_BRANCH}', not 'main'."
    echo "release-please only triggers on pushes to main."
    read -rp "Push anyway? [y/N] " confirm
    [[ "${confirm}" =~ ^[Yy]$ ]] || exit 0
  fi
  echo "Pushing ${CURRENT_BRANCH} to origin..."
  git push origin "${CURRENT_BRANCH}"
  echo "Pushed."
fi

# Poll for the release-please PR.
# After a push, CI takes ~30-60s to create/update it.
echo ""
echo "Looking for release-please PR..."
MAX_WAIT=120
POLL_INTERVAL=5
ELAPSED=0
PR_COUNT=0
PR_JSON=""

while [[ "${PR_COUNT}" == "0" && "${ELAPSED}" -lt "${MAX_WAIT}" ]]; do
  PR_JSON=$(gh pr list \
    --repo "${REPO}" \
    --state open \
    --search "release-please" \
    --json number,title,url \
    --limit 1)
  PR_COUNT=$(echo "${PR_JSON}" | python3 -c "import json,sys; print(len(json.loads(sys.stdin.read())))" 2>/dev/null || echo "0")
  if [[ "${PR_COUNT}" == "0" ]]; then
    printf "  waiting for release-please CI... (%ds)\r" "${ELAPSED}"
    sleep "${POLL_INTERVAL}"
    ELAPSED=$((ELAPSED + POLL_INTERVAL))
  fi
done
echo ""

if [[ "${PR_COUNT}" == "0" ]]; then
  echo "No release-please PR appeared after ${MAX_WAIT}s."
  echo "All changes may already be released, or CI may have failed."
  exit 0
fi

PR_NUMBER=$(echo "${PR_JSON}" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(d[0]['number'])")
PR_TITLE=$(echo "${PR_JSON}" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(d[0]['title'])")
PR_URL=$(echo "${PR_JSON}" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(d[0]['url'])")

echo "=== Release PR ========================================="
echo "  #${PR_NUMBER}: ${PR_TITLE}"
echo "  ${PR_URL}"
echo "========================================================"

if [[ "${MERGE}" == "0" ]]; then
  echo ""
  echo "To merge and trigger the Docker build:"
  echo "  ./release.sh --merge"
  exit 0
fi

echo ""
echo "Merging PR #${PR_NUMBER}..."
gh pr merge "${PR_NUMBER}" --merge --delete-branch

VERSION=$(echo "${PR_TITLE}" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || echo "")

echo ""
echo "=== Merged! ============================================"
if [[ -n "${VERSION}" ]]; then
  echo "  Version: ${VERSION}"
  echo ""
  echo "Docker build is running. Once done, deploy with:"
  echo "  ./deploy.sh ${VERSION}"
else
  echo "Docker build is running. Once done, deploy with:"
  echo "  ./deploy.sh latest"
fi
echo "========================================================"
echo ""
gh run list --limit 3
