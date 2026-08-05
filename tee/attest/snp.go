package attest

import (
	"encoding/binary"
	"fmt"
	"math/big"
)

// SEV-SNP ATTESTATION_REPORT layout — offsets and sizes from the AMD SEV-SNP ABI
// Specification (Rev 1.55+), Table "ATTESTATION_REPORT Structure". These constants are the
// contract with real hardware; they are validated end-to-end by parsing a genuine report in
// snp_test.go (testdata/attestation.bin) and asserting the recorded field values.
const (
	snpReportLen  = 0x4A0 // 1184 bytes, the full report
	snpSignedLen  = 0x2A0 // 672 bytes signed by the VCEK (everything before the signature)
	offVersion    = 0x000 // u32
	offGuestSVN   = 0x004 // u32
	offPolicy     = 0x008 // u64
	offVMPL       = 0x030 // u32
	offSigAlgo    = 0x034 // u32
	offReportData = 0x050 // 64 bytes
	offMeasure    = 0x090 // 48 bytes
	offHostData   = 0x0C0 // 32 bytes
	offReportID   = 0x140 // 32 bytes
	offReportedTCB = 0x180 // u64
	offChipID     = 0x1A0 // 64 bytes
	offSignature  = 0x2A0 // 512 bytes: R[72] LE, S[72] LE, then reserved
	ecdsaFieldLen = 72    // per-component slot in the signature field
)

// sigAlgoECDSAP384SHA384 is SignatureAlgo == 1 — the only algorithm SNP defines today.
const sigAlgoECDSAP384SHA384 = 1

// SNPReport is a parsed SEV-SNP attestation report. Raw is retained so the signed region can
// be re-hashed for signature verification without a second parse.
type SNPReport struct {
	Raw          []byte
	Version      uint32
	GuestSVN     uint32
	Policy       uint64
	VMPL         uint32
	SignatureAlgo uint32
	ReportData   []byte // 64 bytes
	Measurement  []byte // 48 bytes
	HostData     []byte // 32 bytes
	ReportID     []byte // 32 bytes
	ReportedTCB  uint64
	ChipID       []byte // 64 bytes
	// SigR, SigS are the big-endian ECDSA components (converted from the report's little-endian
	// storage), ready for ecdsa.Verify.
	SigR *big.Int
	SigS *big.Int
}

// ParseSNPReport parses raw SNP attestation report bytes. It validates length and version but
// makes NO trust decision — parsing is not verification. A parsed report is untrusted data
// until Verify (chain + signature + measurement + binding) says otherwise.
func ParseSNPReport(raw []byte) (*SNPReport, error) {
	if len(raw) < snpReportLen {
		return nil, fmt.Errorf("attest: SNP report too short: got %d, need >= %d", len(raw), snpReportLen)
	}
	r := &SNPReport{
		Raw:           raw,
		Version:       binary.LittleEndian.Uint32(raw[offVersion:]),
		GuestSVN:      binary.LittleEndian.Uint32(raw[offGuestSVN:]),
		Policy:        binary.LittleEndian.Uint64(raw[offPolicy:]),
		VMPL:          binary.LittleEndian.Uint32(raw[offVMPL:]),
		SignatureAlgo: binary.LittleEndian.Uint32(raw[offSigAlgo:]),
		ReportData:    raw[offReportData : offReportData+64],
		Measurement:   raw[offMeasure : offMeasure+48],
		HostData:      raw[offHostData : offHostData+32],
		ReportID:      raw[offReportID : offReportID+32],
		ReportedTCB:   binary.LittleEndian.Uint64(raw[offReportedTCB:]),
		ChipID:        raw[offChipID : offChipID+64],
	}
	if r.Version < 2 {
		return nil, fmt.Errorf("attest: unsupported SNP report version %d (need >= 2)", r.Version)
	}
	r.SigR = leBytesToBig(raw[offSignature : offSignature+ecdsaFieldLen])
	r.SigS = leBytesToBig(raw[offSignature+ecdsaFieldLen : offSignature+2*ecdsaFieldLen])
	return r, nil
}

// SignedRegion is the byte range the VCEK signs — the report minus its signature field.
func (r *SNPReport) SignedRegion() []byte { return r.Raw[:snpSignedLen] }

// leBytesToBig converts a little-endian byte slot (SNP stores ECDSA r/s little-endian, zero-
// padded to 72 bytes) into a big-endian big.Int suitable for ecdsa.Verify.
func leBytesToBig(le []byte) *big.Int {
	be := make([]byte, len(le))
	for i := range le {
		be[len(le)-1-i] = le[i]
	}
	return new(big.Int).SetBytes(be)
}
