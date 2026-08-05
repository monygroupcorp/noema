package attest

import (
	"crypto/subtle"
	"crypto/x509"
	"fmt"
)

// CheckStatus is the outcome of one conformance check.
type CheckStatus int

const (
	// StatusPass — the check was evaluated and held.
	StatusPass CheckStatus = iota
	// StatusFail — the check was evaluated and did NOT hold. Fatal to sealing.
	StatusFail
	// StatusPending — the check could not be evaluated at this rung (e.g. GPU evidence not
	// present yet). Pending is NOT Pass: a Pending required check keeps Sealed false.
	StatusPending
)

func (s CheckStatus) String() string {
	switch s {
	case StatusPass:
		return "pass"
	case StatusFail:
		return "fail"
	default:
		return "pending"
	}
}

// Check names — stable identifiers matching docs/tee-hardware-path.md §6.
const (
	CheckChain       = "chain"       // §6.1 VCEK→ASK→ARK links to the trusted root
	CheckReportSig   = "reportSig"   // §6.2 VCEK signed the report
	CheckMeasurement = "measurement" // §6.3 report.Measurement == golden
	CheckBinding     = "binding"     // §6.4 report_data == hash(wgServerPubKey)
	CheckGPU         = "gpu"         // §6.5 H100 evidence, CC-On (rung 3)
	CheckComposite   = "composite"   // §6.6 CPU/GPU share the session nonce (rung 3)
)

// Check is one line of the conformance verdict.
type Check struct {
	Name   string
	Status CheckStatus
	Detail string
}

// Result is the full verdict. Sealed is the ONLY thing a production caller may trust to show
// a user "sealed": it requires every check to Pass. CPUVerified is the rung-2 subset (the CPU
// enclave is proven; GPU is pending), used by CPU-CVM test harnesses that have no H100.
type Result struct {
	Checks []Check
}

// Evidence is everything the browser collected to verify a session. CPU fields are required;
// GPU fields are nil until rung 3, which keeps the GPU checks Pending (fail-closed).
type Evidence struct {
	SNPReport []byte            // raw attestation report bytes
	VCEK      *x509.Certificate // chip endorsement key
	ASK       *x509.Certificate // AMD SEV signing key
	ARK       *x509.Certificate // AMD root key (self-signed)
	GPU       []byte            // nvtrust/NRAS composite evidence — nil ⇒ gpu/composite Pending
}

// Policy is the trust configuration. GoldenMeasurement and TrustedARK are the two anchors a
// deployment pins; both are injected so the same verifier serves the rung-0 test root and the
// rung-2+ AMD production root without a code change.
type Policy struct {
	GoldenMeasurement []byte            // 48 bytes — the published reproducible-build measurement
	TrustedARK        *x509.Certificate // the AMD root this deployment anchors to
}

// Verify runs the six conformance checks and returns a per-check verdict. It is pure: no I/O,
// no clock, no globals. It never panics on malformed input — a parse failure is a failed
// check, not a crash — because this runs on adversary-supplied bytes in the browser.
func Verify(ev Evidence, pol Policy, rawWGServerPubKey []byte) Result {
	var res Result
	add := func(name string, st CheckStatus, detail string) { res.Checks = append(res.Checks, Check{name, st, detail}) }

	// Parse first. A report we cannot parse fails every CPU check — there is nothing to trust.
	report, err := ParseSNPReport(ev.SNPReport)
	if err != nil {
		add(CheckChain, StatusFail, "no parseable report")
		add(CheckReportSig, StatusFail, err.Error())
		add(CheckMeasurement, StatusFail, "no parseable report")
		add(CheckBinding, StatusFail, "no parseable report")
		add(CheckGPU, StatusPending, "GPU evidence not evaluated (CPU report unparseable)")
		add(CheckComposite, StatusPending, "not evaluated")
		return res
	}

	// 1. chain — VCEK→ASK→ARK links to the trusted root.
	if ev.VCEK == nil || ev.ASK == nil || ev.ARK == nil || pol.TrustedARK == nil {
		add(CheckChain, StatusFail, "missing VCEK/ASK/ARK or no trusted root in policy")
	} else if err := VerifyChain(ev.VCEK, ev.ASK, ev.ARK, pol.TrustedARK); err != nil {
		add(CheckChain, StatusFail, err.Error())
	} else {
		add(CheckChain, StatusPass, "VCEK chains to trusted ARK")
	}

	// 2. reportSig — the report is signed by the VCEK. Only meaningful once the VCEK is
	//    trusted (check 1), but evaluate it independently so a failure localizes cleanly.
	if ev.VCEK == nil {
		add(CheckReportSig, StatusFail, "no VCEK")
	} else if err := VerifyReportSignature(report, ev.VCEK); err != nil {
		add(CheckReportSig, StatusFail, err.Error())
	} else {
		add(CheckReportSig, StatusPass, "report signed by VCEK")
	}

	// 3. measurement — the enclave running is exactly the published build.
	if len(pol.GoldenMeasurement) != len(report.Measurement) {
		add(CheckMeasurement, StatusFail, "policy has no/short golden measurement")
	} else if subtle.ConstantTimeCompare(report.Measurement, pol.GoldenMeasurement) != 1 {
		add(CheckMeasurement, StatusFail, "measurement != golden")
	} else {
		add(CheckMeasurement, StatusPass, "measurement matches golden")
	}

	// 4. binding — the tunnel terminates in THIS enclave.
	if err := VerifyBinding(report.ReportData, rawWGServerPubKey); err != nil {
		add(CheckBinding, StatusFail, err.Error())
	} else {
		add(CheckBinding, StatusPass, "report_data binds to WG server key")
	}

	// 5 & 6. GPU + composite — pending until real H100 evidence exists (rung 3). Pending, not
	//        Pass: the model runs on the GPU, so a sealed claim REQUIRES the GPU half. A
	//        CPU-only attestation is honestly "CPU enclave verified, not yet sealed".
	if len(ev.GPU) == 0 {
		add(CheckGPU, StatusPending, "no GPU evidence (rung 3)")
		add(CheckComposite, StatusPending, "no GPU evidence (rung 3)")
	} else {
		add(CheckGPU, StatusPending, "GPU verification not yet implemented (rung 3)")
		add(CheckComposite, StatusPending, "composite verification not yet implemented (rung 3)")
	}
	return res
}

// Sealed reports whether EVERY check passed — the only signal a production caller may surface
// as "sealed" to a user. Any Fail or Pending ⇒ false (fail-closed).
func (r Result) Sealed() bool {
	for _, c := range r.Checks {
		if c.Status != StatusPass {
			return false
		}
	}
	return len(r.Checks) > 0
}

// CPUVerified reports whether the four CPU-side checks passed (chain, reportSig, measurement,
// binding), regardless of the GPU checks. Used by rung-2 CPU-CVM harnesses to assert the CPU
// enclave end-to-end when no H100 exists. NOT a user-facing "sealed" signal.
func (r Result) CPUVerified() bool {
	need := map[string]bool{CheckChain: true, CheckReportSig: true, CheckMeasurement: true, CheckBinding: true}
	seen := 0
	for _, c := range r.Checks {
		if need[c.Name] {
			if c.Status != StatusPass {
				return false
			}
			seen++
		}
	}
	return seen == len(need)
}

// Failures returns the names of checks that failed (not pending) — for logging why a session
// did not seal.
func (r Result) Failures() []string {
	var out []string
	for _, c := range r.Checks {
		if c.Status == StatusFail {
			out = append(out, fmt.Sprintf("%s: %s", c.Name, c.Detail))
		}
	}
	return out
}
