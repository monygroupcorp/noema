// Package attest is the browser-side attestation verifier for NOEMA sealed sessions.
//
// It is a PURE function of its inputs — verify(evidence, policy, wgServerPubKey) → result —
// with no I/O, no clock, no js/wasm dependency, so `go test` exercises the identical code the
// browser WASM client (tee/browser) ships. The verifier IS the spec
// (docs/tee-hardware-path.md §6): the pod-side _get_attestation() is "done" when its real
// output makes Verify return a sealed result. The verifier judges the producer, not eyeballs.
//
// Six checks gate a sealed session; ALL must hold or the session is not sealed (fail-closed):
//
//	1. chain        — VCEK endorsement cert chains to the AMD root (policy-injected).
//	2. reportSig    — the SNP report is signed by that VCEK.
//	3. measurement  — report.Measurement == the published golden measurement.
//	4. binding      — report.ReportData == hash(wgServerPubKey): the tunnel terminates HERE.
//	5. gpu          — H100 evidence chains to NVIDIA and asserts CC-On.        (rung 3)
//	6. composite    — CPU and GPU evidence share the session nonce.            (rung 3)
//
// Fail-closed invariants:
//   - There is no "assume valid" path. Missing/failed evidence ⇒ not sealed.
//   - Checks that cannot be evaluated at the current rung (GPU before real H100 evidence)
//     are Pending, and Pending is NOT Pass — Result.Sealed stays false. A caller that only
//     needs the CPU enclave proven (rung-2 CPU-CVM testing) uses Result.CPUVerified().
//   - Nothing session-variable lives inside the measurement; per-session identity is bound
//     through ReportData (check 4), so one golden measurement covers every model and session.
package attest
