#!/usr/bin/env bash
# =============================================================================
# firewall-cloudflare-only.sh — restrict tcp/80 and tcp/443 on this host to
# Cloudflare's published IP ranges (origin-firewall lock for the noema
# droplet, 64.227.15.104).
# =============================================================================
#
# Problem this closes: noema.art/www/app/staging sit behind Cloudflare, but
# the droplet's own ufw rules still accept 80/443 from anywhere, so
# `curl --resolve <host>:443:64.227.15.104 https://<host>/` gets the real
# site directly, bypassing Cloudflare's proxy/WAF entirely.
#
# What this does: fetches Cloudflare's current IPv4 + IPv6 ranges
# (https://www.cloudflare.com/ips-v4, /ips-v6) and rewrites this host's ufw
# rules for 80/443 to allow only those ranges, denying everyone else. SSH
# (or any other port) is never touched.
#
# Idempotent / safe to re-run: on each run it removes only
#   (a) rules it previously added itself (tagged "cf-origin-lock"), and
#   (b) any pre-existing rule that blanket-allows a *raw numeric* 80/443
#       port spec (e.g. "80/tcp", "80,443/tcp") from literally "Anywhere" —
#       such a rule, if left in place, would shadow the restriction below it
#       since ufw/netfilter matches top-down and an earlier ALLOW wins over
#       a later DENY.
# before re-adding the current Cloudflare ranges plus a catch-all deny.
# Every port/source combination this script removes already resolves to an
# ALLOW on 80 or 443 from the whole internet — deleting one can only make
# the host MORE restrictive, never less, so a false-positive match here
# cannot cause a lockout.
#
# What it deliberately does NOT try to resolve: an ufw *application
# profile* (e.g. "Nginx Full") that happens to cover 80/443. Those are
# logged as a warning instead of auto-removed — see the runbook
# (docs/ops/origin-firewall-cloudflare.md) for the manual check.
#
# Aborts without touching the firewall if either range fetch fails, is
# empty, or contains a line that doesn't look like a CIDR — a bad fetch
# must never be treated as "Cloudflare now has zero ranges".
#
# Usage:
#   sudo ./firewall-cloudflare-only.sh            # apply
#   sudo ./firewall-cloudflare-only.sh --dry-run  # print the ufw commands, change nothing
#
# Installed on the droplet, this is also what
# ops/systemd/noema-firewall-cloudflare.{service,timer} run daily — Cloudflare
# rotates these ranges occasionally, not often, but a stale allow-list would
# eventually either lock Cloudflare out or (worse, silently) leave a range
# Cloudflare no longer uses still allowed.
# =============================================================================

set -euo pipefail

TAG="cf-origin-lock"
IPV4_URL="https://www.cloudflare.com/ips-v4"
IPV6_URL="https://www.cloudflare.com/ips-v6"
PORTS=(80 443)

DRY_RUN=0
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=1
fi

if ! command -v ufw >/dev/null 2>&1; then
  echo "[firewall-cloudflare] ufw not found on this host — this script only drives ufw." >&2
  echo "[firewall-cloudflare] see docs/ops/origin-firewall-cloudflare.md for the iptables fallback." >&2
  exit 1
fi

run() {
  if [[ "${DRY_RUN}" -eq 1 ]]; then
    echo "[dry-run] $*"
  else
    echo "+ $*"
    "$@"
  fi
}

WORKDIR="$(mktemp -d)"
trap 'rm -rf "${WORKDIR}"' EXIT

fetch_ranges() {
  local url="$1" out="$2" family="$3"
  curl -fsS --max-time 15 "${url}" -o "${out}"
  if [[ ! -s "${out}" ]]; then
    echo "[firewall-cloudflare] ${family}: empty response from ${url}, aborting without changing the firewall" >&2
    exit 1
  fi
  while IFS= read -r line; do
    [[ -z "${line}" ]] && continue
    if [[ "${family}" == "v4" ]]; then
      if [[ ! "${line}" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}/[0-9]{1,2}$ ]]; then
        echo "[firewall-cloudflare] ${family}: '${line}' doesn't look like a CIDR, aborting without changing the firewall" >&2
        exit 1
      fi
    else
      if [[ ! "${line}" =~ ^[0-9a-fA-F:]+/[0-9]{1,3}$ ]]; then
        echo "[firewall-cloudflare] ${family}: '${line}' doesn't look like a CIDR, aborting without changing the firewall" >&2
        exit 1
      fi
    fi
  done < "${out}"
}

V4_FILE="${WORKDIR}/ips-v4"
V6_FILE="${WORKDIR}/ips-v6"
fetch_ranges "${IPV4_URL}" "${V4_FILE}" "v4"
fetch_ranges "${IPV6_URL}" "${V6_FILE}" "v6"

echo "[firewall-cloudflare] fetched $(wc -l < "${V4_FILE}" | tr -d ' ') IPv4 + $(wc -l < "${V6_FILE}" | tr -d ' ') IPv6 ranges"

STATUS="$(ufw status numbered 2>/dev/null || true)"
NUMBERED_LINES="$(grep -E '^\[' <<<"${STATUS}" || true)"

# A "To" field is a raw port spec (what this script knows how to read) if it's
# digits/commas/colons optionally followed by /tcp or /udp — e.g. "80/tcp",
# "80,443/tcp", "443". Anything else (e.g. "Nginx Full") is an app profile.
is_raw_port_spec() {
  local f="${1% (v6)}"
  [[ "${f}" =~ ^[0-9]+(,[0-9]+)*(/(tcp|udp))?$ ]]
}

to_field_of() {
  sed -E 's/^\[ *[0-9]+\] *//' <<<"$1" | sed -E 's/ *ALLOW IN.*$//' | xargs echo -n
}

# Warn (don't touch) any app-profile rule open to Anywhere that might cover 80/443.
if [[ -n "${NUMBERED_LINES}" ]]; then
  while IFS= read -r line; do
    grep -qE 'ALLOW IN' <<<"${line}" || continue
    grep -qE 'Anywhere( \(v6\))?[[:space:]]*(#.*)?$' <<<"${line}" || continue
    to_field="$(to_field_of "${line}")"
    if [[ -n "${to_field}" ]] && ! is_raw_port_spec "${to_field}"; then
      echo "[firewall-cloudflare] WARNING: ufw rule allows from Anywhere via app profile '${to_field}' — not auto-checked for 80/443 coverage, verify by hand (ufw app info \"${to_field}\"): ${line}" >&2
    fi
  done <<< "${NUMBERED_LINES}"
fi

# Collect rule numbers to delete: our own tagged rules, plus any raw numeric
# 80/443 port spec left ALLOW-from-Anywhere that we didn't tag.
TO_DELETE=()
if [[ -n "${NUMBERED_LINES}" ]]; then
  while IFS= read -r line; do
    num="$(grep -oE '^\[ *[0-9]+\]' <<<"${line}" | grep -oE '[0-9]+' || true)"
    [[ -z "${num}" ]] && continue

    if grep -qE "# ${TAG}\$" <<<"${line}"; then
      TO_DELETE+=("${num}")
      continue
    fi

    grep -qE 'ALLOW IN' <<<"${line}" || continue
    grep -qE 'Anywhere( \(v6\))?[[:space:]]*(#.*)?$' <<<"${line}" || continue

    to_field="$(to_field_of "${line}")"
    is_raw_port_spec "${to_field}" || continue
    port_part="${to_field% (v6)}"
    port_part="${port_part%/tcp}"
    port_part="${port_part%/udp}"

    for p in "${PORTS[@]}"; do
      if grep -qE "(^|,)${p}(,|\$)" <<<"${port_part}"; then
        TO_DELETE+=("${num}")
        break
      fi
    done
  done <<< "${NUMBERED_LINES}"
fi

if [[ "${#TO_DELETE[@]}" -gt 0 ]]; then
  mapfile -t TO_DELETE_SORTED < <(printf '%s\n' "${TO_DELETE[@]}" | sort -rnu)
  for num in "${TO_DELETE_SORTED[@]}"; do
    run ufw --force delete "${num}"
  done
fi

for port in "${PORTS[@]}"; do
  while IFS= read -r cidr; do
    [[ -z "${cidr}" ]] && continue
    run ufw allow from "${cidr}" to any port "${port}" proto tcp comment "${TAG}"
  done < "${V4_FILE}"
  while IFS= read -r cidr; do
    [[ -z "${cidr}" ]] && continue
    run ufw allow from "${cidr}" to any port "${port}" proto tcp comment "${TAG}"
  done < "${V6_FILE}"
  run ufw deny "${port}/tcp" comment "${TAG}"
done

if [[ "${DRY_RUN}" -eq 0 ]]; then
  run ufw reload
fi

echo "[firewall-cloudflare] done$([ "${DRY_RUN}" -eq 1 ] && echo ' (dry run, nothing changed)')"
