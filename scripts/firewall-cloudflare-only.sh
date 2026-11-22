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
# Applied 2026-11-21 and found NOT to hold: Caddy's 80/443 are Docker-
# published (0.0.0.0:80->container, 0.0.0.0:443->container), so inbound
# connections to those ports are DNAT'd and traverse the FORWARD chain, not
# INPUT — ufw only filters INPUT, so none of the rules above ever see this
# traffic. Docker inserts a jump to the DOCKER-USER chain at the top of
# FORWARD specifically so operators can filter forwarded/published-port
# traffic before Docker's own (wide-open, by design) rules accept it; this
# script also rewrites DOCKER-USER (iptables + ip6tables) the same way it
# rewrites ufw — Cloudflare ranges ACCEPTed, everything else to 80/443
# DROPped — which is the layer that actually gates Docker-forwarded traffic.
# Matched on `-m conntrack --ctorigdstport` (the port the client originally
# dialed, before any DNAT) rather than `--dport`, so this holds regardless of
# what internal port Caddy's container maps 80/443 onto. Every such rule is
# scoped to `-i <public interface>` (autodetected via the default route), so
# it can only match traffic arriving from the internet, never a container's
# own outbound/return traffic (which arrives via the bridge interface,
# docker0/br-*, not the public NIC) — container egress is never touched.
#
# Fixed 2026-11-22 (first DOCKER-USER cut was wrong): `--ctorigdstport`
# matches a connection's ORIGINAL destination port regardless of which
# direction the current packet is travelling. So a reply packet answering
# the app container's OWN outbound call to some external :443 service (the
# RunPod API, Stripe, Mongo Atlas, ...) still carries ctorigdstport=443, and
# that reply arrives on the public interface (that's where internet traffic
# lands) — it matched our DROP, breaking every outbound HTTPS call the app
# makes. Fixed two ways, per Docker's own documented DOCKER-USER pattern:
# (1) every chain gets a first, unscoped `-m conntrack --ctstate
# ESTABLISHED,RELATED -j RETURN`, so already-tracked traffic (including
# replies to container-initiated connections) short-circuits past our
# Cloudflare check entirely; (2) belt-and-suspenders, the Cloudflare
# ACCEPT/DROP rules also add `--ctdir ORIGINAL`, so even if something slipped
# past (1) it still can't match a reply-direction packet. Neither change
# touches container egress — egress packets arrive via the bridge interface,
# never `-i <public iface>`, so they never reach these rules either way.
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
#   ./firewall-cloudflare-only.sh --dry-run       # print the plan, change nothing (root not required —
#                                                  # reading live DOCKER-USER state to preview removals IS
#                                                  # skipped without root, so a non-root dry-run only shows
#                                                  # what would be inserted, not what stale rules would go)
#
# Installed on the droplet, this is also what
# ops/systemd/noema-firewall-cloudflare.{service,timer} run daily — Cloudflare
# rotates these ranges occasionally, not often, but a stale allow-list would
# eventually either lock Cloudflare out or (worse, silently) leave a range
# Cloudflare no longer uses still allowed.
#
# scripts/firewall-cloudflare-only.selftest.sh sources this file (with
# FIREWALL_CLOUDFLARE_ONLY_SOURCE_FUNCTIONS_ONLY=1, which makes it return
# right after defining the functions below, before touching ufw/iptables or
# the network) to regression-test the DOCKER-USER rule generation against a
# simulated chain — no root, no live firewall, no network.
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

run() {
  if [[ "${DRY_RUN}" -eq 1 ]]; then
    echo "[dry-run] $*"
  else
    echo "+ $*"
    "$@"
  fi
}

# --- DOCKER-USER rule generation (pure functions — no live state, no I/O
# beyond the CIDR file already fetched and validated by the caller) ---

# One chain's rules, in desired TOP-TO-BOTTOM order (one spec per line): an
# unscoped ESTABLISHED,RELATED short-circuit first (so replies to the
# container's own outbound connections never reach the Cloudflare check at
# all — see the file header), then per port: Cloudflare ACCEPTs, then a
# catch-all DROP. `--ctdir ORIGINAL` on the Cloudflare rules is belt-and-
# suspenders: even a packet that somehow reached this point without being
# ESTABLISHED/RELATED still can't match unless it's travelling in the
# connection's original (client-to-server) direction. `-i ${iface}` keeps
# the Cloudflare rules to inbound-from-the-internet only.
docker_user_rule_specs() {
  local cidr_file="$1" iface="$2"
  local port cidr
  echo "-m conntrack --ctstate ESTABLISHED,RELATED -j RETURN"
  for port in "${PORTS[@]}"; do
    while IFS= read -r cidr; do
      [[ -z "${cidr}" ]] && continue
      echo "-i ${iface} -p tcp -m conntrack --ctorigdstport ${port} --ctdir ORIGINAL -s ${cidr} -j ACCEPT"
    done < "${cidr_file}"
    echo "-i ${iface} -p tcp -m conntrack --ctorigdstport ${port} --ctdir ORIGINAL -j DROP"
  done
}

# DOCKER-USER always ends in a Docker-managed RETURN (and may hold other
# rules); every insert here uses "-I DOCKER-USER 1", so to land in the
# desired top-to-bottom order we must issue the inserts in the REVERSE of
# that order — the last command run ends up physically first.
insert_docker_user_rules() {
  local bin="$1" cidr_file="$2" iface="$3"
  local specs=()
  mapfile -t specs < <(docker_user_rule_specs "${cidr_file}" "${iface}")
  local i
  for ((i = ${#specs[@]} - 1; i >= 0; i--)); do
    # Safe to word-split: every token here is an iface name, a flag, a
    # port number, or a CIDR — none contain spaces or glob characters.
    # shellcheck disable=SC2086
    run "${bin}" -I DOCKER-USER 1 ${specs[$i]} -m comment --comment "${TAG}"
  done
}

remove_docker_user_rules() {
  local bin="$1"
  local nums
  nums="$("${bin}" -L DOCKER-USER -n --line-numbers 2>/dev/null | grep -F "${TAG}" | awk '{print $1}' | sort -rn || true)"
  [[ -z "${nums}" ]] && return 0
  local n
  for n in ${nums}; do
    run "${bin}" -D DOCKER-USER "${n}"
  done
}

if [[ "${FIREWALL_CLOUDFLARE_ONLY_SOURCE_FUNCTIONS_ONLY:-0}" == "1" ]]; then
  return 0 2>/dev/null || exit 0
fi

if ! command -v ufw >/dev/null 2>&1; then
  echo "[firewall-cloudflare] ufw not found on this host — this script only drives ufw." >&2
  echo "[firewall-cloudflare] see docs/ops/origin-firewall-cloudflare.md for the iptables fallback." >&2
  exit 1
fi

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

# --- DOCKER-USER: the chain that actually gates Docker-forwarded ports ---
# (see the file header — ufw's INPUT rules above never see Docker-published
# 80/443 traffic at all).

IFACE_V4="$(ip route show default 2>/dev/null | awk '/^default/ {print $5; exit}')"
if [[ -z "${IFACE_V4}" ]]; then
  echo "[firewall-cloudflare] could not determine the public IPv4 interface (ip route show default) — skipping the DOCKER-USER layer entirely; ufw rules alone do not gate Docker-published ports" >&2
else
  IFACE_V6="$(ip -6 route show default 2>/dev/null | awk '/^default/ {print $5; exit}')"
  if [[ -z "${IFACE_V6}" ]]; then
    echo "[firewall-cloudflare] WARNING: no IPv6 default route found (ip -6 route show default) — assuming the IPv6 DOCKER-USER rules should use the same public interface as IPv4 (${IFACE_V4}); verify this holds if this host ever gets a separate IPv6 uplink" >&2
    IFACE_V6="${IFACE_V4}"
  fi

  apply_docker_user_chain() {
    local bin="$1" cidr_file="$2" family="$3" iface="$4"
    if ! command -v "${bin}" >/dev/null 2>&1; then
      echo "[firewall-cloudflare] WARNING: ${bin} not found — ${family} traffic to a Docker-published 80/443 is not gated by this script" >&2
      return 0
    fi
    if [[ "${DRY_RUN}" -eq 1 ]]; then
      # Reading live chain state (to preview what stale cf-origin-lock rules
      # would be removed) needs root; a non-root --dry-run can't do that, so
      # it only shows the insert plan, not the removal half.
      echo "[firewall-cloudflare] ${family} (${bin}): DOCKER-USER insert plan via ${iface} — run as root to also see what existing rules would be removed first:"
      insert_docker_user_rules "${bin}" "${cidr_file}" "${iface}"
      return 0
    fi
    if ! "${bin}" -nL DOCKER-USER >/dev/null 2>&1; then
      echo "[firewall-cloudflare] WARNING: no DOCKER-USER chain for ${bin} (missing, or this isn't root) — ${family} traffic to a Docker-published 80/443 is not gated by this script" >&2
      return 0
    fi
    remove_docker_user_rules "${bin}"
    insert_docker_user_rules "${bin}" "${cidr_file}" "${iface}"
  }

  apply_docker_user_chain iptables "${V4_FILE}" "IPv4" "${IFACE_V4}"
  apply_docker_user_chain ip6tables "${V6_FILE}" "IPv6" "${IFACE_V6}"
fi

echo "[firewall-cloudflare] done$([ "${DRY_RUN}" -eq 1 ] && echo ' (dry run, nothing changed)')"
