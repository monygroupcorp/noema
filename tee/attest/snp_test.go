package attest

import (
	"encoding/hex"
	"testing"
)

// Recorded field values extracted from the real report (testdata/attestation.bin) at harvest
// time — the parser must reproduce these exactly, which validates every offset against reality.
const (
	realMeasurementHex = "b07af9620f3b839b47996422ddec6058338951d984e312115131ea82705eaf5b6bdf8a9ece31a5a608eb0cf2e4872b01"
	realReportDataHex  = "0102030405000000000000000000000000000000000000000000000000000000" +
		"0000000000000000000000000000000000000000000000000000000000000000"
)

func TestParseRealReport(t *testing.T) {
	r, err := ParseSNPReport(mustRead(t, "attestation.bin"))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if r.Version != 2 {
		t.Errorf("version: got %d want 2", r.Version)
	}
	if r.SignatureAlgo != sigAlgoECDSAP384SHA384 {
		t.Errorf("sigAlgo: got %d want %d", r.SignatureAlgo, sigAlgoECDSAP384SHA384)
	}
	if r.VMPL != 0 {
		t.Errorf("vmpl: got %d want 0", r.VMPL)
	}
	if got := hex.EncodeToString(r.Measurement); got != realMeasurementHex {
		t.Errorf("measurement:\n got %s\nwant %s", got, realMeasurementHex)
	}
	if got := hex.EncodeToString(r.ReportData); got != realReportDataHex {
		t.Errorf("reportData:\n got %s\nwant %s", got, realReportDataHex)
	}
	if len(r.Measurement) != 48 || len(r.ReportData) != 64 || len(r.ChipID) != 64 {
		t.Errorf("field lengths wrong: meas=%d rd=%d chip=%d", len(r.Measurement), len(r.ReportData), len(r.ChipID))
	}
	// The signature components must be non-zero big-endian integers.
	if r.SigR.Sign() == 0 || r.SigS.Sign() == 0 {
		t.Errorf("signature r/s parsed as zero: r=%v s=%v", r.SigR, r.SigS)
	}
}

func TestParseRejectsShort(t *testing.T) {
	if _, err := ParseSNPReport(make([]byte, 100)); err == nil {
		t.Fatal("expected error on a short report")
	}
}

func TestParseRejectsOldVersion(t *testing.T) {
	raw := append([]byte(nil), mustRead(t, "attestation.bin")...)
	raw[0] = 1 // version = 1
	if _, err := ParseSNPReport(raw); err == nil {
		t.Fatal("expected error on version 1")
	}
}

// leBytesToBig converts SNP's little-endian storage to a big-endian integer.
func TestLEBytesToBig(t *testing.T) {
	// 0x01 0x02 little-endian is 0x0201.
	got := leBytesToBig([]byte{0x01, 0x02})
	if got.Int64() != 0x0201 {
		t.Errorf("got %#x want 0x0201", got.Int64())
	}
}
