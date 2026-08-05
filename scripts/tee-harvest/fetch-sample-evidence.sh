#!/usr/bin/env bash
# Rung 0 — fetch vendor-published sample SEV-SNP evidence into the fixture dir.
# Idempotent: re-run to refresh. Records real, verifiable reality (a genuine SNP
# report + a VCEK→ASK→ARK chain that actually validates), not a hand-authored fake.
# Provenance is logged in tee/attest/testdata/PROVENANCE.md.
set -euo pipefail

DEST="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../tee/attest/testdata" && pwd)"
BASE="https://raw.githubusercontent.com/google/go-sev-guest/main/verify/testdata"

for f in attestation.bin vcek.testcer milan.testcer milanvlek.testcer; do
  curl -fsSL -m 30 -o "${DEST}/${f}" "${BASE}/${f}"
  printf '  %-20s %6s bytes  sha256=%s\n' "$f" "$(wc -c < "${DEST}/${f}")" "$(sha256sum "${DEST}/${f}" | cut -c1-16)"
done
echo "fetched into ${DEST}"
