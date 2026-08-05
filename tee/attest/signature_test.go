package attest

import (
	"errors"
	"testing"
)

// The real report is the ORACLE: if the offsets, signed-region length, and little-endian→
// big-endian r/s conversion are all correct, the genuine VCEK verifies the genuine report. A
// green here means the parser's understanding of the ABI matches real hardware.
func TestVerifyReportSignatureRealReport(t *testing.T) {
	r, err := ParseSNPReport(mustRead(t, "attestation.bin"))
	if err != nil {
		t.Fatal(err)
	}
	vcek, _, _ := realChain(t)
	if err := VerifyReportSignature(r, vcek); err != nil {
		t.Fatalf("real VCEK should verify the real report — offsets/encoding are wrong if not: %v", err)
	}
}

func TestVerifyReportSignatureRejectsTamper(t *testing.T) {
	raw := append([]byte(nil), mustRead(t, "attestation.bin")...)
	raw[offMeasure] ^= 0x01 // flip one bit of the measurement — inside the signed region
	r, err := ParseSNPReport(raw)
	if err != nil {
		t.Fatal(err)
	}
	vcek, _, _ := realChain(t)
	if err := VerifyReportSignature(r, vcek); err != ErrReportSignature {
		t.Fatalf("a tampered report must fail signature verification, got %v", err)
	}
}

func TestVerifyReportSignatureRejectsUnsupportedAlgo(t *testing.T) {
	r, err := ParseSNPReport(mustRead(t, "attestation.bin"))
	if err != nil {
		t.Fatal(err)
	}
	r.SignatureAlgo = 99
	vcek, _, _ := realChain(t)
	if err := VerifyReportSignature(r, vcek); !errors.Is(err, ErrUnsupportedSigAlgo) {
		t.Fatalf("unsupported algo must be rejected, got %v", err)
	}
}

func TestVerifyChainRealChain(t *testing.T) {
	vcek, ask, ark := realChain(t)
	if err := VerifyChain(vcek, ask, ark, ark); err != nil {
		t.Fatalf("the real VCEK→ASK→ARK chain must verify: %v", err)
	}
}

func TestVerifyChainRejectsWrongRoot(t *testing.T) {
	vcek, ask, ark := realChain(t)
	// Anchor to the VCEK (not the ARK) — ark.Equal(trusted) must fail.
	if err := VerifyChain(vcek, ask, ark, vcek); err == nil {
		t.Fatal("chain must fail when the trusted root is not the ARK")
	}
}

func TestVerifyChainRejectsSwappedCerts(t *testing.T) {
	vcek, _, ark := realChain(t)
	// Pass the VCEK where the ASK belongs — VCEK did not sign the ASK, so linkage breaks.
	if err := VerifyChain(vcek, vcek, ark, ark); err == nil {
		t.Fatal("chain must fail when an intermediate is wrong")
	}
}
