//go:build unix

package suppress

// The explicit chmod inside SaveFile makes the final file mode
// independent of the process umask: a fresh file is 0600 (it silences
// detections, so it is operator-private) and an existing file keeps its
// operator-set mode. Without that chmod, a hostile umask (077) would
// silently degrade the "preserve mode" semantics: the temp file is born
// 0600&^umask and could never grow its permissions back.

import (
	"os"
	"path/filepath"
	"syscall"
	"testing"
)

func TestSaveFileModeIsUmaskProof(t *testing.T) {
	// fresh file under a permissive umask: exactly 0600
	old := syscall.Umask(0o000)
	p := filepath.Join(t.TempDir(), "fresh.yaml")
	if err := SaveFile(p, []Entry{{RuleID: "r1"}}); err != nil {
		t.Fatalf("SaveFile fresh: %v", err)
	}
	syscall.Umask(old)
	fi, err := os.Stat(p)
	if err != nil {
		t.Fatal(err)
	}
	if got := fi.Mode().Perm(); got != 0o600 {
		t.Fatalf("fresh suppressions file mode is %o, want 600 (it silences detections)", got)
	}

	// existing file under a hostile umask: the preserved mode survives,
	// because the explicit chmod re-applies it after the temp write
	existing := filepath.Join(t.TempDir(), "existing.yaml")
	if err := os.WriteFile(existing, []byte("- rule_id: keep\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(existing, 0o644); err != nil {
		t.Fatal(err) // seed under THIS process's umask, not the hostile one
	}
	old = syscall.Umask(0o077)
	if err := SaveFile(existing, []Entry{{RuleID: "r2"}}); err != nil {
		t.Fatalf("SaveFile existing: %v", err)
	}
	syscall.Umask(old)
	fi, err = os.Stat(existing)
	if err != nil {
		t.Fatal(err)
	}
	if got := fi.Mode().Perm(); got != 0o644 {
		t.Fatalf("existing file mode degraded to %o under umask 077, want untouched 644", got)
	}
}
