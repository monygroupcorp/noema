package attest

import (
	"crypto/ecdsa"
	"crypto/sha512"
	"crypto/x509"
	"encoding/pem"
	"errors"
	"fmt"
)

// Report signature (§6.2) and endorsement-cert chain (§6.1).
//
// SNP signs the report with the VCEK (Versioned Chip Endorsement Key). The VCEK cert chains
// VCEK → ASK (AMD SEV Signing Key) → ARK (AMD Root Key, self-signed). The ARK is the trust
// anchor: at rung 0 the policy injects go-sev-guest's TEST ARK; production (rung 2+) pins
// AMD's real Milan/Genoa ARK. The root is ALWAYS injected, never hardcoded here.

var (
	// ErrReportSignature is returned when the VCEK did not sign the report.
	ErrReportSignature = errors.New("attest: SNP report signature invalid")
	// ErrUnsupportedSigAlgo is returned for a SignatureAlgo the verifier does not implement.
	ErrUnsupportedSigAlgo = errors.New("attest: unsupported SNP signature algorithm")
	// ErrChain is returned when the VCEK→ASK→ARK chain does not cryptographically link.
	ErrChain = errors.New("attest: VCEK certificate chain does not verify")
)

// VerifyReportSignature checks that vcek's key signed the report's signed region with
// ECDSA-P384/SHA-384 (the only algorithm SNP defines). This proves the report was produced by
// the endorsed chip — but says nothing about WHICH chip until VerifyChain anchors the VCEK.
func VerifyReportSignature(r *SNPReport, vcek *x509.Certificate) error {
	if r.SignatureAlgo != sigAlgoECDSAP384SHA384 {
		return fmt.Errorf("%w: %d", ErrUnsupportedSigAlgo, r.SignatureAlgo)
	}
	pub, ok := vcek.PublicKey.(*ecdsa.PublicKey)
	if !ok {
		return fmt.Errorf("%w: VCEK is not an ECDSA key", ErrReportSignature)
	}
	digest := sha512.Sum384(r.SignedRegion())
	if !ecdsa.Verify(pub, digest[:], r.SigR, r.SigS) {
		return ErrReportSignature
	}
	return nil
}

// VerifyChain checks the cryptographic linkage VCEK → ASK → ARK and that ARK is the injected
// trust anchor (self-signed). It verifies SIGNATURES only — the RFC 5280 path policy (KeyUsage,
// path-len, validity window) and the AMD TCB-extension cross-check against the report's
// reported_tcb are deferred to rung 2 (documented in docs/tee-hardware-path.md §4). Signature
// linkage is the load-bearing trust fact; the policy refinements narrow an already-linked chain.
func VerifyChain(vcek, ask, ark, trustedARK *x509.Certificate) error {
	// ARK must be exactly the anchor the policy trusts, and self-signed.
	if !ark.Equal(trustedARK) {
		return fmt.Errorf("%w: ARK is not the trusted root", ErrChain)
	}
	if err := signedBy(ark, ark); err != nil {
		return fmt.Errorf("%w: ARK not self-signed: %v", ErrChain, err)
	}
	if err := signedBy(ask, ark); err != nil {
		return fmt.Errorf("%w: ASK not signed by ARK: %v", ErrChain, err)
	}
	if err := signedBy(vcek, ask); err != nil {
		return fmt.Errorf("%w: VCEK not signed by ASK: %v", ErrChain, err)
	}
	return nil
}

// signedBy verifies child's signature was produced by parent's key, without imposing x509 CA
// path-policy constraints (AMD's cert profile does not set the KeyUsage bits Go's full
// verifier requires). This is the cryptographic-linkage primitive.
func signedBy(child, parent *x509.Certificate) error {
	return parent.CheckSignature(child.SignatureAlgorithm, child.RawTBSCertificate, child.Signature)
}

// ParseCertDER parses a single DER-encoded X.509 certificate (e.g. a VCEK).
func ParseCertDER(der []byte) (*x509.Certificate, error) {
	return x509.ParseCertificate(der)
}

// ParseCertsPEM parses every CERTIFICATE block in a PEM bundle, in file order. AMD ships the
// ASK+ARK chain this way (ASK first, ARK second).
func ParseCertsPEM(pemBytes []byte) ([]*x509.Certificate, error) {
	var certs []*x509.Certificate
	rest := pemBytes
	for {
		var block *pem.Block
		block, rest = pem.Decode(rest)
		if block == nil {
			break
		}
		if block.Type != "CERTIFICATE" {
			continue
		}
		c, err := x509.ParseCertificate(block.Bytes)
		if err != nil {
			return nil, err
		}
		certs = append(certs, c)
	}
	if len(certs) == 0 {
		return nil, errors.New("attest: no certificates in PEM bundle")
	}
	return certs, nil
}
