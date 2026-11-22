#!/bin/bash

###############################################################################
# test-crystal.sh
#
# Entry point for `npm run test:crystal`. The crystal suite needs a real
# Mongo (transactions require a replica set — see MongoRedituum/settle) and
# until now that meant a hand seat with no MONGODB_URI configured just saw
# ECONNREFUSED on localhost:27017.
#
# If MONGODB_URI is already set (by .env, by CI, by a caller), this defers to
# it unchanged. Otherwise, when docker is available, it stands up the same
# single-node replica-set mongo:7 container CI uses
# (.github/workflows/ci.yml, job crystal-db) for the duration of the run and
# tears it down on exit.
###############################################################################

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_DIR"

# run-with-env.sh's own .env loader, so a .env-provided MONGODB_URI still wins.
if [ -f .env ]; then
  while IFS='=' read -r key value; do
    key="$(echo "$key" | xargs)"
    value="$(echo "$value" | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/")"
    if [[ -z "$key" || "$key" =~ ^# ]]; then continue; fi
    if [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
      export "$key"="$value"
    fi
  done < <(grep -v '^\s*#' .env | grep '=')
fi

CONTAINER=""
cleanup() {
  if [ -n "$CONTAINER" ]; then
    echo "[test-crystal.sh] Stopping ephemeral mongo ($CONTAINER)..."
    docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

if [ -z "${MONGO_PASS:-}" ] && [ -z "${MONGODB_URI:-}" ]; then
  if ! command -v docker >/dev/null 2>&1; then
    echo "[test-crystal.sh] ERROR: no MONGODB_URI/MONGO_PASS set and docker is not available to start one." >&2
    echo "[test-crystal.sh] Set MONGODB_URI in .env, or make docker reachable." >&2
    exit 1
  fi

  CONTAINER="crystal-test-mongo-$$"
  echo "[test-crystal.sh] No MONGODB_URI set — starting ephemeral replica-set mongo:7 ($CONTAINER)..."
  # Docker's default nofile ulimit (1024) is too low for this suite: ~200 test files each open
  # their own MongoClient against this one mongod, and WiredTiger panics ("Too many open
  # files") well before that ceiling under concurrent node:test execution.
  docker run -d --name "$CONTAINER" -p 27017:27017 --ulimit nofile=64000:64000 mongo:7 --replSet rs0 --bind_ip_all >/dev/null

  until docker exec "$CONTAINER" mongosh --quiet --eval 'db.runCommand({ ping: 1 })' >/dev/null 2>&1; do sleep 1; done
  docker exec "$CONTAINER" mongosh --quiet --eval 'rs.initiate({ _id: "rs0", members: [{ _id: 0, host: "127.0.0.1:27017" }] })' >/dev/null
  until [ "$(docker exec "$CONTAINER" mongosh --quiet --eval 'rs.status().myState')" = "1" ]; do sleep 1; done

  export MONGODB_URI="mongodb://127.0.0.1:27017/?replicaSet=rs0"
  echo "[test-crystal.sh] Ephemeral mongo ready."
fi

# Patterns are passed in by the caller (package.json's test:crystal script) rather than
# hardcoded here — tests/unit/architecture/testEnrolment.test.ts greps the test:crystal
# script string in package.json for the quoted globs to prove every test file is enrolled
# somewhere, and it would see none if they only lived in this file.
#
# Not `exec`: exec replaces this shell's process image, which would skip the EXIT trap above
# and leave the ephemeral container running.
./scripts/run-tests.sh "$@"
