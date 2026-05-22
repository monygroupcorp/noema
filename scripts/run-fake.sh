#!/bin/bash
###############################################################################
# run-fake.sh — local dev with SIMULATED pods (no GPU, no cost).
#
# Runs the Crystal bot with DEV_FAKE_POD: every /make simulates the full pod
# lifecycle (provisioning → bulletin → download → delivery) and returns a sample
# image — instantly and for $0. Telegram runs in long-polling mode (no tunnel).
#
# Setup: create scripts/../.env.fake (gitignored) with a TEST bot + DB:
#     BOT_TOKEN=<a throwaway test bot token, NOT the prod bot>
#     MONGODB_URI=<local or a scratch test DB>
# Then: ./scripts/run-fake.sh
#
# It deliberately does NOT load the prod .env, and unsets WEBHOOK_URL /
# TELEGRAM_WEBHOOK_URL so the fake webhook hits localhost and Telegram polls.
###############################################################################
set -euo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

[ -f .env.fake ] && { set -a; . ./.env.fake; set +a; }

: "${BOT_TOKEN:?set BOT_TOKEN (use a TEST bot, not prod) in .env.fake}"
: "${MONGODB_URI:?set MONGODB_URI (local or scratch DB) in .env.fake}"

export DEV_FAKE_POD=1            # simulate pods — no real GPU, no cost
export DEV_FREE_EXECUTION=1      # skip the balance check in dev
export DB_NAME="${DB_NAME:-noema_fake}"
export PORT="${PORT:-3001}"
unset WEBHOOK_URL TELEGRAM_WEBHOOK_URL   # localhost webhook + Telegram long-polling

echo "[run-fake] DEV_FAKE_POD on — pods are simulated, no GPU will be provisioned, \$0."
echo "[run-fake] DB=$DB_NAME  PORT=$PORT  (Telegram polling)"
exec npx tsx src/index.ts
