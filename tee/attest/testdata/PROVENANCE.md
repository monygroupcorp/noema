# Fixture provenance

Every fixture here is **recorded reality** (fixture rule, `docs/tee-hardware-path.md` §2/§5).
Nothing in this directory is hand-authored to look like external evidence.

## SEV-SNP CPU attestation (rung 0 — vendor-published sample)

| File | Source | Fetched | SHA-256 (first 16) |
|---|---|---|---|
| `attestation.bin` | google/go-sev-guest `verify/testdata/attestation.bin` | 2026-07-06 | `377e6241d3b373ab` |
| `vcek.testcer` | google/go-sev-guest `verify/testdata/vcek.testcer` | 2026-07-06 | `0d057f9b6e29a69e` |
| `milan.testcer` | google/go-sev-guest `verify/testdata/milan.testcer` (ARK+ASK test root chain) | 2026-07-06 | `22e62f8d2c21a156` |
| `milanvlek.testcer` | google/go-sev-guest `verify/testdata/milanvlek.testcer` | 2026-07-06 | `3098f7e90ee7049b` |

Base URL: `https://raw.githubusercontent.com/google/go-sev-guest/main/verify/testdata/`

**Important:** `milan.testcer` is go-sev-guest's *test* ARK/ASK root, NOT AMD's production
root. Rung 0 verifies the chain validates to whatever root the policy injects; production
(rung 2+) pins AMD's real Milan/Genoa ARK. The root is injectable by design — never hardcoded.

The report's report_data is the go-sev-guest test vector (`0102030405` + zeros), NOT a real
WG-key binding. It exercises the PARSER and the SIGNATURE/CHAIN checks. The binding check
(§6.3) is tested with self-generated key→hash vectors; an end-to-end "real report whose
report_data == hash(our WG key)" fixture can only come from real hardware (rung 2 harvest).

## Pending harvest (later rungs)

- rung 2 (`harvest-snp.sh`): a real Azure DCas_v5 SNP report + MAA JWT + JWKS, with our WG
  key hash in report_data → the first end-to-end green `Verify()` fixture.
- rung 3 (`harvest-gpu.sh`): nvtrust GPU evidence, NRAS response, composite token.
