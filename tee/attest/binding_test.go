package attest

import (
	"bytes"
	"crypto/sha512"
	"testing"
)

func TestExpectedReportDataIsSHA512(t *testing.T) {
	key := bytes.Repeat([]byte{0xAB}, 32)
	got, err := ExpectedReportData(key)
	if err != nil {
		t.Fatal(err)
	}
	want := sha512.Sum512(key)
	if !bytes.Equal(got, want[:]) {
		t.Errorf("ExpectedReportData is not SHA-512 of the key")
	}
	if len(got) != 64 {
		t.Errorf("report_data length: got %d want 64", len(got))
	}
}

func TestExpectedReportDataRejectsBadKeyLength(t *testing.T) {
	for _, n := range []int{0, 31, 33, 64} {
		if _, err := ExpectedReportData(make([]byte, n)); err == nil {
			t.Errorf("expected error for key length %d", n)
		}
	}
}

func TestVerifyBindingRoundTrip(t *testing.T) {
	key := bytes.Repeat([]byte{0x11}, 32)
	rd, _ := ExpectedReportData(key)
	if err := VerifyBinding(rd, key); err != nil {
		t.Errorf("correct binding should verify: %v", err)
	}
}

func TestVerifyBindingRejectsWrongKey(t *testing.T) {
	rd, _ := ExpectedReportData(bytes.Repeat([]byte{0x11}, 32))
	otherKey := bytes.Repeat([]byte{0x22}, 32)
	if err := VerifyBinding(rd, otherKey); err != ErrBindingMismatch {
		t.Errorf("mismatched key must fail with ErrBindingMismatch, got %v", err)
	}
}

func TestVerifyBindingRejectsTamperedReportData(t *testing.T) {
	key := bytes.Repeat([]byte{0x11}, 32)
	rd, _ := ExpectedReportData(key)
	for _, i := range []int{0, 31, 63} { // flip a bit at the front, middle, end
		bad := append([]byte(nil), rd...)
		bad[i] ^= 0x01
		if err := VerifyBinding(bad, key); err != ErrBindingMismatch {
			t.Errorf("tamper at byte %d must fail, got %v", i, err)
		}
	}
}

func TestVerifyBindingRejectsShortReportData(t *testing.T) {
	key := bytes.Repeat([]byte{0x11}, 32)
	if err := VerifyBinding(make([]byte, 32), key); err != ErrBindingMismatch {
		t.Errorf("short report_data must fail, got %v", err)
	}
}
