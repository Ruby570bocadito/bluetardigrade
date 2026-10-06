package main

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Ruby570bocadito/bluetardigrade/internal/secretfile"
)

// The operator-facing cycle: stdin in, SEC-2 envelope on disk, and a
// single confirmation line that never echoes the secret.
func TestSecretWriteRoundTrip(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "ad-bind.secret")
	var out bytes.Buffer
	if err := runSecretWrite(strings.NewReader("s3cr3t-pw-7f3a\n"), &out, path); err != nil {
		t.Fatalf("runSecretWrite: %v", err)
	}
	if strings.Contains(out.String(), "s3cr3t-pw-7f3a") {
		t.Fatalf("the confirmation output must never contain the secret, got: %s", out.String())
	}
	got, warnings, err := secretfile.Read(path)
	if err != nil {
		t.Fatalf("read back: %v", err)
	}
	if string(got) != "s3cr3t-pw-7f3a" {
		t.Errorf("round-trip = %q, want %q", got, "s3cr3t-pw-7f3a")
	}
	secretfile.Zero(got)
	if len(warnings) != 0 {
		t.Errorf("a freshly written envelope must carry no warnings, got %v", warnings)
	}
}

func TestSecretWriteRejectsEmptyStdin(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "ad-bind.secret")
	var out bytes.Buffer
	if err := runSecretWrite(strings.NewReader("\r\n"), &out, path); err == nil {
		t.Fatal("empty stdin must be refused, not written as an empty secret")
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Error("a refused write must not leave a file behind")
	}
}

func TestSecretWriteRefusesNothingWithoutClobbering(t *testing.T) {
	// A failed write (empty stdin) must not destroy the previous
	// credential: temp+rename+Sync, the enrollment pattern.
	dir := t.TempDir()
	path := filepath.Join(dir, "ad-bind.secret")
	var out bytes.Buffer
	if err := runSecretWrite(strings.NewReader("first\n"), &out, path); err != nil {
		t.Fatalf("first write: %v", err)
	}
	if err := runSecretWrite(strings.NewReader(""), &out, path); err == nil {
		t.Fatal("empty stdin must fail")
	}
	got, _, err := secretfile.Read(path)
	if err != nil {
		t.Fatalf("read back after failed write: %v", err)
	}
	if string(got) != "first" {
		t.Errorf("the failed write must not clobber the previous secret, got %q", got)
	}
	secretfile.Zero(got)
}
