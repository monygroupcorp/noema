#!/usr/bin/env bash
# Post-deploy authenticated verification for Tier B #1/#4/#5/#6/#7 against staging.
# Prereq: staging is on the username+password build (register returns a session, not
# "verification_sent"). Run: bash verify-authed.sh
set -uo pipefail
B="${API_ORIGIN:-https://staging.noema.art}"
SFX=$(head -c4 /dev/urandom | xxd -p)
UA="qa_wire_a_$SFX"; UB="qa_wire_b_$SFX"; PW="test-$(head -c8 /dev/urandom | xxd -p)"
jq(){ python3 -c "import sys,json;d=json.load(sys.stdin);print(eval(sys.argv[1]))" "$1"; }

echo "### 0. auth mode check"
REG=$(curl -s -m30 -X POST "$B/v1/auth/register" -H 'content-type: application/json' -d "{\"username\":\"$UA\",\"password\":\"$PW\"}")
echo "$REG" | head -c 300; echo
if echo "$REG" | grep -qi 'verification_sent\|email'; then
  echo "!! staging still on email-verify auth — NOT the new build. Stop."; exit 1
fi
TA=$(echo "$REG" | jq "d['session']['token']"); AID=$(echo "$REG" | jq "d['animaId']")
RB=$(curl -s -m30 -X POST "$B/v1/auth/register" -H 'content-type: application/json' -d "{\"username\":\"$UB\",\"password\":\"$PW\"}")
TB=$(echo "$RB" | jq "d['session']['token']"); BID=$(echo "$RB" | jq "d['animaId']")
HA=(-H "authorization: Bearer $TA"); HJ=(-H 'content-type: application/json')
echo "A=$AID  B=$BID"

echo; echo "### 4. named identity (GET /v1/me, /v1/me/status)"
curl -s -m20 "$B/v1/me" "${HA[@]}" | head -c 300; echo
curl -s -m20 "$B/v1/me/status" "${HA[@]}" | head -c 200; echo

echo; echo "### 7. teams create → list → add B → get → remove B"
T=$(curl -s -m20 -X POST "$B/v1/teams" "${HA[@]}" "${HJ[@]}" -d '{"nomen":"qa squad"}'); echo "$T" | head -c 300; echo
TID=$(echo "$T" | jq "d['team']['id']")
curl -s -m20 "$B/v1/teams" "${HA[@]}" | head -c 200; echo
curl -s -m20 -X POST "$B/v1/teams/$TID/members" "${HA[@]}" "${HJ[@]}" -d "{\"animaId\":\"$BID\"}" | head -c 300; echo
curl -s -m20 -X DELETE "$B/v1/teams/$TID/members/$BID" "${HA[@]}" | head -c 300; echo

echo; echo "### 6. sponsorships create A→B → list → pause → resume"
S=$(curl -s -m20 -X POST "$B/v1/sponsorships" "${HA[@]}" "${HJ[@]}" -d "{\"beneficiaryAnimaId\":\"$BID\",\"grant\":\"100\",\"cadence\":\"monthly\"}"); echo "$S" | head -c 300; echo
SID=$(echo "$S" | jq "d['sponsorship']['id']")
curl -s -m20 "$B/v1/sponsorships" "${HA[@]}" | head -c 200; echo
curl -s -m20 -X POST "$B/v1/sponsorships/$SID/pause"  "${HA[@]}" | head -c 200; echo
curl -s -m20 -X POST "$B/v1/sponsorships/$SID/resume" "${HA[@]}" | head -c 200; echo

echo; echo "### 5. model import (public HF LoRA URL)"
curl -s -m120 -X POST "$B/v1/models/import" "${HA[@]}" "${HJ[@]}" \
  -d '{"url":"https://huggingface.co/ostris/ikea-instructions-lora-sdxl","genus":"lora"}' | head -c 400; echo
curl -s -m20 "$B/v1/me/models" "${HA[@]}" | head -c 300; echo

echo; echo "### 1. FLUX run (NEEDS balance) — quote then dispatch + stream"
BAL=$(curl -s -m20 "$B/v1/me/status" "${HA[@]}" | jq "d['balanceImpetus']")
echo "balance(impetus)=$BAL"
curl -s -m20 -X POST "$B/v1/runs/quote" "${HA[@]}" "${HJ[@]}" -d '{"modusId":"flux-schnell","aditus":{"prompt":"a teapot"}}' | head -c 200; echo
if [ "${BAL:-0}" = "0" ]; then
  echo ">> A has 0 balance — fund $AID (deposit or grant), then dispatch:"
  echo "   curl -X POST $B/v1/runs -H 'authorization: Bearer $TA' -H 'content-type: application/json' -d '{\"modusId\":\"flux-schnell\",\"aditus\":{\"prompt\":\"a teapot\"}}'"
  echo "   then stream: curl -N $B/v1/runs/<id>/stream -H 'authorization: Bearer $TA'"
else
  RUN=$(curl -s -m20 -X POST "$B/v1/runs" "${HA[@]}" "${HJ[@]}" -d '{"modusId":"flux-schnell","aditus":{"prompt":"a teapot on a windowsill"}}')
  echo "$RUN" | head -c 300; echo
  RID=$(echo "$RUN" | jq "d['run']['id']")
  echo ">> streaming $RID (ctrl-c after complete) ..."
  curl -sN -m300 "$B/v1/runs/$RID/stream" "${HA[@]}"
fi
echo; echo "### done. tokens: TA=$TA  (A=$AID B=$BID)"
