//go:build windows

package secretfile

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// SEG-B checklist, "ida y vuelta del sobre en el job Windows": this
// test runs in the CI Windows job and exercises the real DPAPI calls
// (CryptProtectData / CryptUnprotectData with the LOCAL_MACHINE
// scope) through Write and Read.
func TestDPAPIWriteReadRoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "ad-bind.secret")
	if err := Write(path, []byte(testSecret)); err != nil {
		t.Fatalf("Write: %v", err)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read envelope: %v", err)
	}
	if !strings.Contains(string(raw), `"scheme":"dpapi"`) {
		t.Fatalf("the on-disk envelope must declare the dpapi scheme, got: %s", raw)
	}
	got, warnings, err := Read(path)
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	if string(got) != testSecret {
		t.Fatalf("DPAPI round-trip mismatch: got %q, want %q", got, testSecret)
	}
	if len(warnings) != 0 {
		t.Fatalf("a DPAPI envelope on Windows must carry no warnings, got %v", warnings)
	}
	Zero(got)
}

// The DPAPI blob must never contain the plaintext outside the API: the
// on-disk ciphertext must not leak the secret it protects.
func TestDPAPICiphertextDoesNotContainSecret(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "ad-bind.secret")
	if err := Write(path, []byte(testSecret)); err != nil {
		t.Fatalf("Write: %v", err)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read envelope: %v", err)
	}
	if strings.Contains(string(raw), testSecret) {
		t.Fatal("the DPAPI ciphertext must not contain the plaintext secret")
	}
}
