# TEE Hardware Path — Working Document

**Status:** ACTIVE — rung 0 largely done (`tee/attest/`), rung 1 next, rung 2 blocked on Azure (§8)
**Updated:** 2026-07-06
**Goal:** the sealed-pod tier becomes a real enclave (SEV-SNP CVM + H100 CC-On, browser-verified
attestation) with the property that **live iteration on the H100 can only surface Azure's bugs,
never ours** — every seam that can be verified cheaper, is.

Companion docs: `docs/tee-runner.md` (runner architecture), `docs/tee-hardening-plan.md`
(pre-hardware hardening items), `docs/ops/staging-deploy.md` (deploy runbook).
This document supersedes the gitignored `docs/plans/2026-07-02-tee-hardware-path.md` as the
tracked source of truth; carried decisions are restated in §9 so nothing depends on that file.

**This document IS the TEE todo.** No parallel list — one source of truth. The `[ ]`/`[x]`
boxes in §4 (ladder), §7 (ops), §8 (Azure) are the live task state; check them as work lands.
The block below is the only thing you read to know the next move; update it whenever the front
of the work changes.

### ▶ NEXT (as of 2026-07-06)

Free work, no Azure needed — pick up here:
1. **Rung 1 — reproducible guest image in QEMU** (§4 rung 1). The measured-boot image + a
   determinism gate (build twice → identical measurement). Unblocks the golden-measurement
   number the verifier's `Policy.GoldenMeasurement` will pin.
2. **Wire `tee/attest` into the browser WASM build** (go.work / replace) so the verifier the
   `wgConnect` path calls is the tested package — the gate wiring, ahead of real evidence.

Blocked on you (do in parallel, off the critical path):
- **Azure Founders Hub application** (§8) — unblocks rungs 2–3; can cover the whole ladder.
- **Staging image pin** to `tee-runner:0703a` (§7) — flips token enforcement strict.

---

## 1. Where we are (done / verified)

| What | State |
|---|---|
| `TeePodProvisioner` interface (provision / probe / terminate / `ingress()`) | ✅ built |
| `ConfidentialPodClient` — Azure CVM pool: tag-via-IMDS session params, `Microsoft.Resources` merge-tags, start confirmed to `running`, deallocate confirmed by power state | ✅ built, ARM-stubbed tests |
| Runner-token auth on `/runner/*` (grace + ratchet, §6), gated `/debug/*` | ✅ built |
| Ready watchdog (20 min), probe-kill `ended` race fix, ended-session pod guards | ✅ built |
| High-effort review — 10 findings, 8 fixed | ✅ 2026-07-03 |
| **Live regression on staging** — phase 1 through `/v1/sessions/tee` (grace path, ingress, wglog proxy, teardown) + phase 2 direct-pod on `tee-runner:0703a` (token echo, wglog 401/200/401) | ✅ **PASS 2026-07-04**, ~$0.15, zero orphans |
| Marketing/legal copy relabeled transit-private until attestation ships | ✅ |
| Staging `TEE_IMAGE_ID` pinned to `monygroup/tee-runner:0703a` | ☐ ops, one-liner in §7 |

Live iteration to date found exactly three bugs, all of the same species — a wrong assumption
about the far side of a seam (ARM tag PATCH replaces; probe-killed pod's dying `ended`;
deploy-order token coupling). That species is what this document's method exists to kill.

---

## 2. The method

Three rules, no exceptions:

1. **Fakes may only replay recorded reality.** No hand-written mock encodes a belief about an
   external surface. Each seam gets a harvest script (§5) that records real responses into repo
   fixtures; unit tests consume fixtures. Suspected drift → re-harvest for pennies, don't debug
   live for dollars.
2. **The verifier is the spec.** The browser-side verification is a pure function
   `verify(evidence, goldenMeasurement, wgPubKey) → sealed | rejected`. It is written FIRST, as a
   conformance suite over fixtures (§6). Pod-side `_get_attestation()` is done when its real
   output passes the suite — the verifier judges the producer, not eyeballs.
3. **Nothing ascends a rung until green on the rung below.** Each rung is ~10× the cost of the
   previous (§4).

---

## 3. Seam inventory

Every piece of the hardware path sits behind one of six external surfaces:

| # | Seam | What can betray us | Cheapest place reality exists |
|---|---|---|---|
| S1 | ARM control plane (start / deallocate LRO / tags / instanceView) | API semantics vs our fake | DCas_v5 CPU-CVM (~$0.10/hr) |
| S2 | IMDS `tagsList` → entrypoint | format, early-boot availability | DCas_v5 |
| S3 | Guest boot chain (reproducible image, measured boot) | build determinism, initrd/rootfs plumbing | local QEMU (free) |
| S4 | CPU attestation (`/dev/sev-guest` SNP report, MAA JWT) | report format, VCEK chain, `report_data` | DCas_v5 — **real SEV-SNP** |
| S5 | GPU attestation (CC-On, nvtrust evidence, NRAS/RIM) | evidence format, RIM matching | **H100 only** (+ NVIDIA sample evidence first) |
| S6 | Browser verification (WASM) | nothing external — pure math | fixtures (free) |

Load-bearing fact: Azure's **DCas_v5** confidential VMs are the same ARM API, IMDS, measured
boot, `/dev/sev-guest`, and MAA as the NCC H100 — minus the GPU — at ~$0.10/hr. Five of six
seams collapse onto it. `ConfidentialPodClient` does not know or care that a pool VM has no GPU.

---

## 4. The ladder

### Rung 0 — fixtures (free) — **mostly DONE 2026-07-06** (`tee/attest/`, Go, 22 tests, 81% cov)
- [x] `scripts/tee-harvest/` scaffolding + fixture layout (Go `testdata/` convention, not
      `tests/fixtures/tee/` — the verifier is Go, so fixtures live with the package; §5 updated)
- [x] Conformance suite skeleton over vendor-published sample evidence (`verify.go`, six checks,
      fail-closed, `Sealed()` vs `CPUVerified()`)
- [x] SNP report parser against the AMD ABI, validated by parsing a real report (`snp.go`)
- [x] Report signature verification (`signature.go`) — **real VCEK verifies the real report**
      (the parser's ABI understanding is proven against hardware output)
- [x] VCEK→ASK→ARK chain verification against the real go-sev-guest chain (injectable root)
- [x] `report_data == hash(wgServerPubKey)` binding (`binding.go`) — canonical
      `SHA-512(rawWGpubkey)`, both directions + tamper vectors, constant-time
- [ ] MAA JWT verification against recorded JWKS — **deferred to rung 2** (needs a real MAA
      token; the raw-VCEK path above is the alternative and is fully covered now)
- [ ] Replace remaining hand-written ARM fake behaviors with fixture replays — as harvests land (rung 2)
- [ ] Wire `tee/attest` into the browser WASM build (go.work / replace) — integration, rung 2/3
- **Exit (met for CPU seam):** conformance suite green on real fixtures; every external format in
  tests is a recording, not a belief. The one all-CPU-green `Verify()` fixture (real report whose
  report_data == hash(our key)) is intentionally left for the rung-2 harvest — cannot exist without
  real hardware, and faking it would violate the fixture rule.

### Rung 1 — local guest image (free)
- [ ] Reproducible guest image build (measured boot; runner + tee-wg-server inside; model weights
      pulled at runtime through the tunnel — **one** golden measurement covers every model)
- [ ] Boots in QEMU: entrypoint runs, IMDS mock consumed, runner up, callbacks fire against a local stub
- [ ] Build twice → identical measurement (determinism gate in CI)
- **Exit:** image boots hermetically; measurement is reproducible byte-for-byte.

### Rung 2 — DCas_v5 CPU-CVM (~$0.10/hr)
- [ ] Azure sub + service principal + 1–2 pool DCas_v5 CVMs (§8) — `ConfidentialPodClient` unchanged
- [ ] Harvest S1/S2/S4: real ARM LRO sequences, real `tagsList`, real SNP reports + MAA tokens → fixtures
- [ ] Full lifecycle through `/v1/sessions/tee` on the CPU-CVM pool: tags → IMDS → runner → ready → billed → deallocate-confirmed
- [ ] Real `_get_attestation()` (CPU half): SNP report with wg-key binding in `report_data`
- [ ] Browser verifies a **real CPU attestation end-to-end** (conformance suite against live evidence)
- [ ] Deferred hardening lands HERE, before any H100 exists to orphan: session persistence +
      startup reconciliation of pool/session state (`tee-hardening-plan.md` §2), runner token off
      VM tags (readable via Reader RBAC — move to a channel outside tags)
- **Exit:** everything except the GPU is live-verified; total rung spend target **< $10**.

### Rung 3 — NCC H100 ($6.98/hr)
- [ ] Quota for NCCads_H100_v5 (East US 2 / West Europe)
- [ ] Hour 1 = harvest run: CC-On state, nvtrust GPU evidence, NRAS verification, composite
      (Intel Trust Authority `get_token_v2` preferred) → fixtures; any bug found goes back to rung 0
- [ ] Conformance suite green against live composite evidence; `attesting` phase carries real attestation
- [ ] Publish golden measurement + the conformance suite as the third-party verification instructions
- [ ] Flip copy transit-private → hardware-verifiable, tier by tier (only for shipped surfaces)
- **Exit:** browser-verified sealed session on real hardware; target **< 10 H100-hours (~$70)**.

---

## 5. Fixture harvest registry

One script per seam family in `scripts/tee-harvest/`; outputs are committed fixtures under
`tee/attest/testdata/` (Go `testdata/` convention — the verifier is a Go package, so fixtures
live with it; go tooling ignores the dir). Every fixture is logged in
`tee/attest/testdata/PROVENANCE.md` (source + fetch date + hash); no provenance ⇒ not a fixture.

| Script | Rung | Runs against | Records |
|---|---|---|---|
| `fetch-sample-evidence.sh` | 0 | go-sev-guest samples | SNP report + VCEK/ASK/ARK chain — **DONE 2026-07-06** |
| `harvest-arm.ts` | 2 | ARM control plane | start/deallocate LRO status sequences, instanceView, tags merge, error bodies (409/404/429) |
| `harvest-snp.sh` | 2 | inside rung-2 guest | real SNP report (our `report_data` binding), MAA JWT + JWKS |
| `harvest-gpu.sh` | 3 | rung-3 pod, hour 1 | nvtrust evidence bundle, NRAS response, RIM data, composite token |

Fixture rule: filenames carry harvest date + api-version; tests fail loudly if a fixture is
older than a stated trust window rather than silently passing on stale reality.

---

## 6. Conformance suite (the verifier IS the spec)

`verify(evidence, golden, wgPubKey)` — ALL must hold or the session is **not sealed**:

1. CPU report signature chains to the AMD root (VCEK path), report is an SNP attestation, TCB acceptable
2. `measurement == golden` (the published reproducible-build value)
3. `report_data == SHA-512/256(wgServerPubKey)` — the tunnel terminates in THIS enclave
4. GPU evidence chains to NVIDIA, RIM-matched, **CC-On** asserted
5. Composite binding: CPU and GPU evidence share the session nonce
6. Every tamper vector rejects: wrong measurement, wrong key hash, stale/replayed evidence, CC-Off, truncated chains

Fail-closed invariants: `ATTESTATION_STUB` is removed — absence/failure of evidence means the UI
never says "sealed"; nothing session-variable is inside the measurement (session params ride
tags/IMDS outside the enclave identity, bound via `report_data`).

The published third-party verification instructions (rung 3) ARE this suite — the transparency
artifact and the test suite are the same object.

---

## 7. Standing ops items

- Pin staging to the token-echoing image and redeploy (until then, sessions run grace mode):
  `ssh noema "sed -i 's|^TEE_IMAGE_ID=.*|TEE_IMAGE_ID=monygroup/tee-runner:0703a|' /opt/noema/.env.staging && ./deploy-staging.sh"`
- Remove the token **grace path** (`CrystalApi._runnerTokenOk`) once no pre-token runner image
  can boot anywhere (after the pin above is live everywhere).
- Rebuild + retag `tee-runner` whenever `tee/` changes; regression drivers from 2026-07-04 are the
  template (session via `/v1/sessions/tee` + direct-pod probe of the debug gate).

## 8. Azure prerequisites (user actions)

- [ ] **Azure Founders Hub application** — $1k–5k credits, no funding requirement; do this FIRST,
      it can cover the entire ladder
- [ ] Subscription + service principal (`TEE_AZURE_*` env; see `src/index.ts` — ALL vars incl.
      `TEE_AZURE_INGRESS_TEMPLATE` required, partial config warns and disables)
- [ ] 1–2 × DCas_v5 CVMs for rung 2 (trivial quota)
- [ ] NCCads_H100_v5 quota request (East US 2 / West Europe) — start it early, approval lags
- [ ] DNS/TLS for the ingress template (e.g. `socks5+wss://{vm}.tee.noema.art/?gost&insecureudp`)

## 9. Carried decisions (settled 2026-07-02, restated so the gitignored plan isn't load-bearing)

1. Confidential tier is a **sibling backend** (`ConfidentialPodClient`) behind `TeePodProvisioner`,
   not a flag on the RunPod path; `container.ts` picks by config, confidential wins.
2. Hardware floor **H100** (consumer Ada has no CC mode); substrate **Azure NCCads_H100_v5**
   (SEV-SNP + H100 NVL CC-On), ~$6.98/hr East US 2.
3. **Pure on-demand, no warm pool** — pool = pre-created deallocated CVMs (disk-only ~$15/mo);
   allocate on session open, deallocate-confirmed on close. Warm pool only ever as an explicit
   metrics-gated decision.
4. **WG-key-to-attestation binding is non-negotiable** — the enclave is worthless if the browser
   can't prove the tunnel terminates inside it (§6 check 3).
5. **Measurement = reproducible CVM measurement**, not a Docker digest; runner stays generic so
   one golden measurement covers all models.
6. Interim honesty: all marketing/legal surfaces claim **transit-private** only, until the rung-3
   exit criteria are met.
