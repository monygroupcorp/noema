package attest

import (
	"crypto/sha512"
	"crypto/subtle"
	"errors"
	"fmt"
)

// The binding check (docs/tee-hardware-path.md §6.4, carried decision 4 — "non-negotiable").
//
// A real enclave is worthless if the browser cannot prove the WireGuard tunnel terminates
// INSIDE that enclave. So the runner generates its WG server keypair inside the enclave and,
// when it requests the SNP report, sets the 64-byte REPORT_DATA field to a hash of the WG
// server public key. The browser recomputes that hash from the key it is about to hand the
// tunnel and requires an exact match before completing the WireGuard handshake. An attacker
// who MITMs the tunnel cannot forge this: they cannot make the enclave sign a report binding
// THEIR key without being the enclave.
//
// Canonical convention (this verifier defines it; the runner MUST satisfy it):
//
//	REPORT_DATA = SHA-512(rawWGServerPubKey)
//
// where rawWGServerPubKey is the 32-byte Curve25519 public key. SHA-512 is chosen because its
// digest is exactly 64 bytes — it fills REPORT_DATA with no padding ambiguity.
const wgPubKeyLen = 32

var (
	// ErrKeyLength is returned when the WG public key is not 32 raw bytes.
	ErrKeyLength = errors.New("attest: WG server public key must be 32 raw bytes")
	// ErrBindingMismatch is returned when REPORT_DATA does not equal SHA-512(wgPubKey).
	ErrBindingMismatch = errors.New("attest: report_data does not bind to the WG server key")
)

// ExpectedReportData is the REPORT_DATA a correct runner must embed for this WG server key.
// Exported so the runner side (and its tests) reference one definition, never a second copy.
func ExpectedReportData(rawWGServerPubKey []byte) ([]byte, error) {
	if len(rawWGServerPubKey) != wgPubKeyLen {
		return nil, fmt.Errorf("%w: got %d", ErrKeyLength, len(rawWGServerPubKey))
	}
	sum := sha512.Sum512(rawWGServerPubKey)
	return sum[:], nil
}

// VerifyBinding checks that reportData (the 64 REPORT_DATA bytes from a parsed SNP report)
// equals SHA-512 of the WG server public key the browser is about to trust. Constant-time
// compare — a binding check is a security boundary, not a convenience.
func VerifyBinding(reportData, rawWGServerPubKey []byte) error {
	want, err := ExpectedReportData(rawWGServerPubKey)
	if err != nil {
		return err
	}
	if len(reportData) != len(want) || subtle.ConstantTimeCompare(reportData, want) != 1 {
		return ErrBindingMismatch
	}
	return nil
}
