package attest

import (
	"bytes"
	"testing"
)

// realEvidence builds an Evidence + Policy from the sample fixtures with the golden set to the
// report's actual measurement, so the CPU checks that CAN pass at rung 0 (chain, reportSig,
// measurement) do pass. Binding cannot pass here: the sample report's report_data is the
// go-sev-guest test vector, not a hash of any WG key we hold — the first all-CPU-green
// fixture must be harvested from real hardware (rung 2).
func realEvidence(t *testing.T) (Evidence, Policy) {
	t.Helper()
	report, err := ParseSNPReport(mustRead(t, "attestation.bin"))
	if err != nil {
		t.Fatal(err)
	}
	vcek, ask, ark := realChain(t)
	ev := Evidence{SNPReport: mustRead(t, "attestation.bin"), VCEK: vcek, ASK: ask, ARK: ark}
	pol := Policy{GoldenMeasurement: append([]byte(nil), report.Measurement...), TrustedARK: ark}
	return ev, pol
}

func statusOf(r Result, name string) CheckStatus {
	for _, c := range r.Checks {
		if c.Name == name {
			return c.Status
		}
	}
	return StatusFail
}

func TestVerifyRealCPUChecksPass(t *testing.T) {
	ev, pol := realEvidence(t)
	res := Verify(ev, pol, bytes.Repeat([]byte{0x01}, 32))

	// The three CPU checks provable at rung 0 with a sample report.
	for _, name := range []string{CheckChain, CheckReportSig, CheckMeasurement} {
		if got := statusOf(res, name); got != StatusPass {
			t.Errorf("%s: got %s want pass — %v", name, got, res.Failures())
		}
	}
	// Binding fails (sample report_data isn't our key hash); GPU pending.
	if statusOf(res, CheckBinding) != StatusFail {
		t.Errorf("binding should fail on the sample report")
	}
	if statusOf(res, CheckGPU) != StatusPending || statusOf(res, CheckComposite) != StatusPending {
		t.Errorf("GPU/composite must be pending at rung 0")
	}
	// Not sealed (binding fails, GPU pending) — and CPU not fully verified (binding fails).
	if res.Sealed() {
		t.Errorf("must NOT report sealed with binding failing and GPU pending")
	}
	if res.CPUVerified() {
		t.Errorf("CPUVerified must be false while binding fails")
	}
}

// The binding-pass branch of Verify, proven independently. This report is DERIVED from the
// real one with report_data overwritten to hash(key): its signature is therefore intentionally
// broken, and the test asserts exactly that — binding PASS while reportSig FAIL — so nothing is
// faked into a false green.
func TestVerifyBindingBranchPassesWhenReportDataMatches(t *testing.T) {
	key := bytes.Repeat([]byte{0x42}, 32)
	rd, _ := ExpectedReportData(key)

	raw := append([]byte(nil), mustRead(t, "attestation.bin")...)
	copy(raw[offReportData:offReportData+64], rd) // overwrite report_data → breaks the signature
	report, _ := ParseSNPReport(raw)
	vcek, ask, ark := realChain(t)
	ev := Evidence{SNPReport: raw, VCEK: vcek, ASK: ask, ARK: ark}
	pol := Policy{GoldenMeasurement: append([]byte(nil), report.Measurement...), TrustedARK: ark}

	res := Verify(ev, pol, key)
	if statusOf(res, CheckBinding) != StatusPass {
		t.Errorf("binding must pass when report_data == hash(key)")
	}
	if statusOf(res, CheckReportSig) != StatusFail {
		t.Errorf("signature MUST fail on the derived report — else the test is dishonest")
	}
	if res.Sealed() {
		t.Errorf("still not sealed: signature broke and GPU pending")
	}
}

func TestVerifyRejectsWrongGolden(t *testing.T) {
	ev, pol := realEvidence(t)
	pol.GoldenMeasurement = bytes.Repeat([]byte{0xFF}, 48)
	res := Verify(ev, pol, bytes.Repeat([]byte{0x01}, 32))
	if statusOf(res, CheckMeasurement) != StatusFail {
		t.Errorf("wrong golden must fail the measurement check")
	}
}

func TestVerifyRejectsWrongRoot(t *testing.T) {
	ev, pol := realEvidence(t)
	pol.TrustedARK = ev.VCEK // not the ARK
	res := Verify(ev, pol, bytes.Repeat([]byte{0x01}, 32))
	if statusOf(res, CheckChain) != StatusFail {
		t.Errorf("wrong trusted root must fail the chain check")
	}
}

func TestVerifyUnparseableReportFailsClosed(t *testing.T) {
	_, pol := realEvidence(t)
	res := Verify(Evidence{SNPReport: []byte{0x00, 0x01}}, pol, bytes.Repeat([]byte{0x01}, 32))
	if res.Sealed() || res.CPUVerified() {
		t.Errorf("an unparseable report must never seal")
	}
	if statusOf(res, CheckReportSig) != StatusFail {
		t.Errorf("unparseable report must fail reportSig")
	}
}

func TestVerifyEmptyResultNotSealed(t *testing.T) {
	// Defensive: a zero Result must never read as sealed.
	if (Result{}).Sealed() {
		t.Fatal("empty result must not be sealed")
	}
}
