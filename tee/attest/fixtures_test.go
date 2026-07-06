package attest

import (
	"crypto/x509"
	"os"
	"testing"
)

// Fixtures are recorded reality (see testdata/PROVENANCE.md). These loaders fail the test
// loudly if a fixture is missing rather than skipping — a missing fixture means the harvest
// step was not run, which is a real problem, not a reason to pass silently.

func mustRead(t *testing.T, name string) []byte {
	t.Helper()
	b, err := os.ReadFile("testdata/" + name)
	if err != nil {
		t.Fatalf("fixture %s: %v (run scripts/tee-harvest/fetch-sample-evidence.sh)", name, err)
	}
	return b
}

// realChain loads the go-sev-guest sample VCEK (DER) + ASK/ARK (PEM, in that order).
func realChain(t *testing.T) (vcek, ask, ark *x509.Certificate) {
	t.Helper()
	var err error
	if vcek, err = ParseCertDER(mustRead(t, "vcek.testcer")); err != nil {
		t.Fatalf("parse vcek: %v", err)
	}
	certs, err := ParseCertsPEM(mustRead(t, "milan.testcer"))
	if err != nil {
		t.Fatalf("parse milan chain: %v", err)
	}
	if len(certs) != 2 {
		t.Fatalf("milan.testcer: expected [ASK, ARK], got %d certs", len(certs))
	}
	return vcek, certs[0], certs[1]
}
