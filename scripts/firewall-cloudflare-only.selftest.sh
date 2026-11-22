#!/usr/bin/env bash
# =============================================================================
# firewall-cloudflare-only.selftest.sh — regression test for the DOCKER-USER
# rule generation in firewall-cloudflare-only.sh. No root, no live firewall,
# no network: it sources the real script with
# FIREWALL_CLOUDFLARE_ONLY_SOURCE_FUNCTIONS_ONLY=1 (which makes that script
# define its functions and return immediately, before touching ufw/iptables
# or fetching anything) and exercises them against fake `iptables`/
# `ip6tables` shell functions that simulate a numbered DOCKER-USER chain in
# a scratch file.
#
# Guards the 2026-11-22 bug: a reply packet answering the app container's
# OWN outbound call (e.g. to the RunPod API on :443) carries
# ctorigdstport=443 regardless of direction, so without an ESTABLISHED/
# RELATED short-circuit and --ctdir ORIGINAL on the Cloudflare rules, that
# reply would hit the DROP meant only for inbound traffic — breaking every
# outbound HTTPS call the app makes. See the real script's file header.
#
# Run directly: ./scripts/firewall-cloudflare-only.selftest.sh
# =============================================================================

set -euo pipefail

SELFTEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FAIL=0

assert() {
  local desc="$1" ok="$2"
  if [[ "${ok}" -eq 0 ]]; then
    echo "ok   - ${desc}"
  else
    echo "FAIL - ${desc}"
    FAIL=1
  fi
}

WORKDIR="$(mktemp -d)"
trap 'rm -rf "${WORKDIR}"' EXIT

CHAIN_STATE="${WORKDIR}/chain.txt"
CALL_LOG="${WORKDIR}/calls.log"
printf '1\tRETURN     all  --  0.0.0.0/0            0.0.0.0/0\n' > "${CHAIN_STATE}"
: > "${CALL_LOG}"

# Fake iptables/ip6tables: maintains CHAIN_STATE as a simulated numbered
# DOCKER-USER chain, same as a real `iptables -L DOCKER-USER -n
# --line-numbers` would print (line number, tab, rule text) — close enough
# for remove_docker_user_rules's `awk '{print $1}'` line-number extraction
# and docker_user_rule_specs' tag grep to behave identically to the real
# thing.
fake_bin() {
  echo "CALL $*" >> "${CALL_LOG}"
  case "$1" in
    -nL) return 0 ;;
    -L)
      cat "${CHAIN_STATE}"
      ;;
    -I)
      shift 3 # -I DOCKER-USER 1
      local newrule="$*"
      { echo "NEW	${newrule}"; cat "${CHAIN_STATE}"; } > "${WORKDIR}/_next"
      awk -F'\t' '{ $1=NR; print $1"\t"$2 }' OFS='\t' "${WORKDIR}/_next" > "${CHAIN_STATE}"
      ;;
    -D)
      local n="$3"
      awk -F'\t' -v n="${n}" '$1!=n' "${CHAIN_STATE}" > "${WORKDIR}/_next"
      awk -F'\t' '{ $1=NR; print $1"\t"$2 }' OFS='\t' "${WORKDIR}/_next" > "${CHAIN_STATE}"
      ;;
  esac
}
iptables() { fake_bin "$@"; }
ip6tables() { fake_bin "$@"; }

CIDR_FILE="${WORKDIR}/cidrs.txt"
cat > "${CIDR_FILE}" << 'EOF'
173.245.48.0/20
103.21.244.0/22
EOF

export FIREWALL_CLOUDFLARE_ONLY_SOURCE_FUNCTIONS_ONLY=1
# shellcheck source=firewall-cloudflare-only.sh
source "${SELFTEST_DIR}/firewall-cloudflare-only.sh"

remove_docker_user_rules iptables
insert_docker_user_rules iptables "${CIDR_FILE}" eth0
FIRST_PASS="$(cat "${CHAIN_STATE}")"

echo "--- chain after first apply ---"
echo "${FIRST_PASS}"

# 1. ESTABLISHED,RELATED short-circuit is present and is the very first rule.
line1="$(awk -F'\t' '$1==1 {print $2}' "${CHAIN_STATE}")"
case "${line1}" in
  *"--ctstate ESTABLISHED,RELATED -j RETURN"*) assert "rule 1 is the ESTABLISHED,RELATED short-circuit" 0 ;;
  *) assert "rule 1 is the ESTABLISHED,RELATED short-circuit (got: ${line1})" 1 ;;
esac
case "${line1}" in
  *" -i "*) assert "the ESTABLISHED,RELATED rule is NOT scoped to an interface (must see both directions)" 1 ;;
  *) assert "the ESTABLISHED,RELATED rule is NOT scoped to an interface (must see both directions)" 0 ;;
esac

# 2. Every Cloudflare ACCEPT/DROP rule carries --ctdir ORIGINAL.
cf_rule_count=$(grep -c -- '-j ACCEPT\|-j DROP' "${CHAIN_STATE}")
cf_rule_with_ctdir=$(grep -c -- '--ctdir ORIGINAL' "${CHAIN_STATE}")
assert "every ACCEPT/DROP rule (${cf_rule_count}) carries --ctdir ORIGINAL (${cf_rule_with_ctdir})" $(( cf_rule_count == cf_rule_with_ctdir ? 0 : 1 ))

# 3. Ordering: ESTABLISHED,RELATED, then port-80 ACCEPTs, then DROP 80, then
#    port-443 ACCEPTs, then DROP 443, then the pre-existing RETURN.
mapfile -t LINES < <(cut -f2 "${CHAIN_STATE}")
expected_tail="RETURN     all  --  0.0.0.0/0            0.0.0.0/0"
ordering_ok=0
[[ "${LINES[0]}" == *"ESTABLISHED,RELATED -j RETURN"* ]] || ordering_ok=1
[[ "${LINES[1]}" == *"ctorigdstport 80 --ctdir ORIGINAL -s 173.245.48.0/20 -j ACCEPT"* ]] || ordering_ok=1
[[ "${LINES[2]}" == *"ctorigdstport 80 --ctdir ORIGINAL -s 103.21.244.0/22 -j ACCEPT"* ]] || ordering_ok=1
[[ "${LINES[3]}" == *"ctorigdstport 80 --ctdir ORIGINAL -j DROP"* ]] || ordering_ok=1
[[ "${LINES[4]}" == *"ctorigdstport 443 --ctdir ORIGINAL -s 173.245.48.0/20 -j ACCEPT"* ]] || ordering_ok=1
[[ "${LINES[5]}" == *"ctorigdstport 443 --ctdir ORIGINAL -s 103.21.244.0/22 -j ACCEPT"* ]] || ordering_ok=1
[[ "${LINES[6]}" == *"ctorigdstport 443 --ctdir ORIGINAL -j DROP"* ]] || ordering_ok=1
[[ "${LINES[7]}" == "${expected_tail}" ]] || ordering_ok=1
assert "top-to-bottom order is ESTABLISHED/RELATED, 80 ACCEPTs, DROP 80, 443 ACCEPTs, DROP 443, pre-existing RETURN" "${ordering_ok}"

# 4. Idempotent: a second refresh (remove + reinsert) yields a byte-identical chain.
remove_docker_user_rules iptables
insert_docker_user_rules iptables "${CIDR_FILE}" eth0
SECOND_PASS="$(cat "${CHAIN_STATE}")"
if [[ "${FIRST_PASS}" == "${SECOND_PASS}" ]]; then
  assert "re-running remove+insert produces a byte-identical chain (idempotent, no duplicate accumulation)" 0
else
  assert "re-running remove+insert produces a byte-identical chain (idempotent, no duplicate accumulation)" 1
  diff <(echo "${FIRST_PASS}") <(echo "${SECOND_PASS}") || true
fi

echo
if [[ "${FAIL}" -eq 0 ]]; then
  echo "firewall-cloudflare-only.selftest.sh: all assertions passed"
else
  echo "firewall-cloudflare-only.selftest.sh: FAILED"
fi
exit "${FAIL}"
