package suppress

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestValidateEntry(t *testing.T) {
	cases := []struct {
		name    string
		entry   Entry
		wantErr string // empty = must pass
	}{
		{"rule only", Entry{RuleID: "r1"}, ""},
		{"host only", Entry{Host: "LAB-1"}, ""},
		{"rule and host", Entry{RuleID: "r1", Host: "LAB-1"}, ""},
		{"full entry", Entry{RuleID: "r1", Host: "lab-1", Reason: "rw", Expires: "2026-10-02T00:00:00Z"}, ""},
		{"both empty", Entry{}, "both empty"},
		{"whitespace only", Entry{RuleID: "   ", Host: "  "}, "both empty"},
		{"bad expires", Entry{RuleID: "r1", Expires: "tomorrow"}, "not RFC 3339"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			// real call sites (parseFile, SaveFile, the API) all funnel
			// entries through NormalizeEntry before validating
			err := ValidateEntry(NormalizeEntry(c.entry))
			if c.wantErr == "" {
				if err != nil {
					t.Fatalf("ValidateEntry(%+v) = %v, want nil", c.entry, err)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), c.wantErr) {
				t.Fatalf("ValidateEntry(%+v) = %v, want it to contain %q", c.entry, err, c.wantErr)
			}
		})
	}
}

func TestNormalizeEntry(t *testing.T) {
	got := NormalizeEntry(Entry{RuleID: "  r1 ", Host: "  LAB-WKS-01 ", Reason: " rw ", Expires: " 2026-10-02T00:00:00Z "})
	want := Entry{RuleID: "r1", Host: "lab-wks-01", Reason: "rw", Expires: "2026-10-02T00:00:00Z"}
	if got != want {
		t.Fatalf("NormalizeEntry = %+v, want %+v", got, want)
	}
}

func TestAllIncludesExpired(t *testing.T) {
	m := New()
	p := write(t, `
- rule_id: r-active
- rule_id: r-expired
  expires: 2020-01-01T00:00:00Z
`)
	if err := m.LoadFile(p); err != nil {
		t.Fatal(err)
	}
	if got := len(m.All()); got != 2 {
		t.Fatalf("All() = %d entries, want 2 (expired included)", got)
	}
	if got := len(m.Snapshot(now)); got != 1 {
		t.Fatalf("Snapshot() = %d entries, want 1 (expired filtered)", got)
	}
}

func TestSaveFileRoundTrip(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "suppressions.yaml")
	in := []Entry{
		{RuleID: "vss-delete", Host: "LAB-WKS-01", Reason: "change window", Expires: "2026-10-02T00:00:00Z"},
		{Host: "noisy-lab-05", Reason: "lab machine"},
	}
	if err := SaveFile(p, in); err != nil {
		t.Fatalf("SaveFile: %v", err)
	}
	m := New()
	if err := m.LoadFile(p); err != nil {
		t.Fatalf("LoadFile after SaveFile: %v", err)
	}
	if ok, _ := m.SuppressedAt("vss-delete", "lab-wks-01", now); !ok {
		t.Error("entry 1 must survive the save/load round trip")
	}
	if ok, _ := m.SuppressedAt("anything", "NOISY-LAB-05", now); !ok {
		t.Error("host-only entry must survive the save/load round trip")
	}
	data, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	// host-only entries must not gain a rule_id: "" line (omitempty),
	// so the file stays in the same shape an operator would hand-write
	if strings.Contains(string(data), `rule_id: ""`) {
		t.Errorf("saved file contains an empty rule_id line:\n%s", data)
	}
}

func TestSaveFilePreservesExistingMode(t *testing.T) {
	if runtime.GOOS == "windows" {
		// NTFS does not enforce POSIX permission bits: the preserved
		// 0644 mode reads back as 0666 on Windows, so the expectation
		// below cannot hold there.
		t.Skip("POSIX file permission semantics not enforceable on Windows")
	}
	dir := t.TempDir()
	p := filepath.Join(dir, "suppressions.yaml")
	if err := os.WriteFile(p, []byte("- rule_id: old\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := SaveFile(p, []Entry{{RuleID: "new"}}); err != nil {
		t.Fatalf("SaveFile: %v", err)
	}
	st, err := os.Stat(p)
	if err != nil {
		t.Fatal(err)
	}
	if st.Mode().Perm() != 0o644 {
		t.Fatalf("existing file mode = %v, want 0644 preserved", st.Mode().Perm())
	}
	// a brand-new file is created operator-private
	p2 := filepath.Join(dir, "fresh.yaml")
	if err := SaveFile(p2, []Entry{{RuleID: "new"}}); err != nil {
		t.Fatalf("SaveFile fresh: %v", err)
	}
	st2, err := os.Stat(p2)
	if err != nil {
		t.Fatal(err)
	}
	if st2.Mode().Perm() != 0o600 {
		t.Fatalf("new file mode = %v, want 0600", st2.Mode().Perm())
	}
}

func TestSaveFileRejectsVacuousEntry(t *testing.T) {
	p := filepath.Join(t.TempDir(), "suppressions.yaml")
	err := SaveFile(p, []Entry{{RuleID: "good"}, {Reason: "matches nothing"}})
	if err == nil || !strings.Contains(err.Error(), "both empty") {
		t.Fatalf("SaveFile with vacuous entry = %v, want 'both empty' error", err)
	}
	if _, statErr := os.Stat(p); !os.IsNotExist(statErr) {
		t.Errorf("a rejected write must not leave a file behind: %v", statErr)
	}
}

func TestSaveFileTempFilesCleanedUp(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "suppressions.yaml")
	if err := SaveFile(p, []Entry{{RuleID: "r1"}}); err != nil {
		t.Fatal(err)
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 {
		names := make([]string, 0, len(entries))
		for _, e := range entries {
			names = append(names, e.Name())
		}
		t.Fatalf("directory holds %d files after SaveFile (%v), want only the target", len(entries), names)
	}
}

func TestSaveFileFailsOutsideUnwritableDir(t *testing.T) {
	p := filepath.Join(t.TempDir(), "no", "such", "dir", "suppressions.yaml")
	if err := SaveFile(p, []Entry{{RuleID: "r1"}}); err == nil {
		t.Fatal("SaveFile in a nonexistent directory must fail loudly")
	}
}

// The API write path edits All() output and saves it back: expired
// entries must still be there afterwards (verified end to end).
func TestSaveFileKeepsExpiredEntries(t *testing.T) {
	p := write(t, "- rule_id: r-expired\n  expires: 2020-01-01T00:00:00Z\n")
	m := New()
	if err := m.LoadFile(p); err != nil {
		t.Fatal(err)
	}
	entries := append(m.All(), Entry{RuleID: "r-new"})
	if err := SaveFile(p, entries); err != nil {
		t.Fatal(err)
	}
	if err := m.LoadFile(p); err != nil {
		t.Fatal(err)
	}
	if got := len(m.All()); got != 2 {
		t.Fatalf("All() = %d entries after re-save, want 2 (expired kept)", got)
	}
	if ok, _ := m.SuppressedAt("r-new", "h", time.Now()); !ok {
		t.Error("new entry must be active after re-save")
	}
}
