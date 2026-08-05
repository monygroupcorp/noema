# tee-harvest — record real external evidence into fixtures

The fixture rule (`docs/tee-hardware-path.md` §2): **fakes may only replay recorded reality.**
No hand-written mock encodes a belief about an external surface. These scripts run once against
the real surface and snapshot the actual responses into fixtures the conformance suite consumes.

Fixtures live in `tee/attest/testdata/` (Go `testdata/` convention — `go test` finds them
relative to the package; go tooling ignores the dir). Each is logged in
`tee/attest/testdata/PROVENANCE.md` with source + fetch date + hash. A fixture without
provenance is not a fixture — it's a fake, and it doesn't belong here.

## Scripts

| Script | Rung | Runs against | Records |
|---|---|---|---|
| `fetch-sample-evidence.sh` | 0 | vendor-published samples (go-sev-guest) | SNP report + VCEK/ARK/ASK chain — DONE 2026-07-06 |
| `harvest-snp.sh` | 2 | Azure DCas_v5 CVM | real SNP report (our WG-key binding) + MAA JWT + JWKS |
| `harvest-arm.ts` | 2 | Azure ARM control plane | start/deallocate LRO sequences, instanceView, tags-merge, error bodies |
| `harvest-gpu.sh` | 3 | NCC H100 pod (hour 1) | nvtrust evidence, NRAS response, RIM data, composite token |

Re-harvest for pennies when reality drifts; never debug live for dollars. Fixtures carry the
api-version / fetch date in `PROVENANCE.md`; tests fail loudly on a fixture older than its
stated trust window rather than passing silently on stale reality.
