package suppress

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

var now = time.Date(2026, 9, 30, 12, 0, 0, 0, time.UTC)

func write(t *testing.T, content string) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "suppressions.yaml")
	if err := os.WriteFile(p, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestMissingFileIsEmptySet(t *testing.T) {
	m := New()
	if err := m.LoadFile(filepath.Join(t.TempDir(), "nope.yaml")); err != nil {
		t.Fatalf("missing file must not error: %v", err)
	}
	if m.Count(now) != 0 {
		t.Fatalf("count = %d, want 0", m.Count(now))
	}
	if active, _ := m.SuppressedAt("vss-delete", "LAB-WKS-01", now); active {
		t.Fatal("empty set must not suppress anything")
	}
}

func TestExactRuleAndHost(t *testing.T) {
	m := New()
	p := write(t, `
- rule_id: vss-delete
  host: LAB-WKS-01
  reason: change window
`)
	if err := m.LoadFile(p); err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		rule, host string
		want       bool
	}{
		{"vss-delete", "LAB-WKS-01", true},
		{"vss-delete", "lab-wks-01", true},  // host is case-insensitive
		{"vss-delete", "LAB-WKS-02", false}, // other host
		{"other-rule", "LAB-WKS-01", false}, // other rule
		{"other-rule", "other-host", false},
	}
	for _, c := range cases {
		if got, _ := m.SuppressedAt(c.rule, c.host, now); got != c.want {
			t.Errorf("SuppressedAt(%q, %q) = %v, want %v", c.rule, c.host, got, c.want)
		}
	}
}

func TestWildcardFields(t *testing.T) {
	m := New()
	p := write(t, `
# all hosts of one rule
- rule_id: vss-delete
- host: noisy-lab-05
  reason: lab machine, everything allowed
`)
	if err := m.LoadFile(p); err != nil {
		t.Fatal(err)
	}
	if ok, _ := m.SuppressedAt("vss-delete", "anywhere", now); !ok {
		t.Error("entry with only rule_id must match any host")
	}
	if ok, _ := m.SuppressedAt("anything", "NOISY-LAB-05", now); !ok {
		t.Error("entry with only host must match any rule")
	}
	if ok, _ := m.SuppressedAt("anything", "other", now); ok {
		t.Error("entry with only host must not match a different host")
	}
}

func TestExpiration(t *testing.T) {
	m := New()
	future := now.Add(time.Hour).Format(time.RFC3339)
	past := now.Add(-time.Hour).Format(time.RFC3339)
	p := write(t, `
- rule_id: r-active
  expires: `+future+`
- rule_id: r-expired
  expires: `+past+`
`)
	if err := m.LoadFile(p); err != nil {
		t.Fatal(err)
	}
	if ok, _ := m.SuppressedAt("r-active", "h", now); !ok {
		t.Error("future expires must stay active")
	}
	if ok, _ := m.SuppressedAt("r-expired", "h", now); ok {
		t.Error("past expires must stop matching")
	}
	// expired entries disappear from the observable surface
	if m.Count(now) != 1 {
		t.Fatalf("count = %d, want 1 (only the non-expired entry)", m.Count(now))
	}
	snap := m.Snapshot(now)
	if len(snap) != 1 || snap[0].RuleID != "r-active" {
		t.Fatalf("snapshot = %+v, want only r-active", snap)
	}
}

func TestReloadReplacesSet(t *testing.T) {
	m := New()
	p := write(t, "- rule_id: a\n")
	if err := m.LoadFile(p); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte("- rule_id: b\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := m.LoadFile(p); err != nil {
		t.Fatal(err)
	}
	if ok, _ := m.SuppressedAt("a", "h", now); ok {
		t.Error("old entry must be gone after reload")
	}
	if ok, _ := m.SuppressedAt("b", "h", now); !ok {
		t.Error("new entry must be active after reload")
	}
}

func TestMalformedInputsAreErrors(t *testing.T) {
	cases := map[string]string{
		"invalid yaml":           "- rule_id: [unclosed",
		"vacuous entry":          "- reason: matches nothing\n",
		"bad expires format":     "- rule_id: a\n  expires: tomorrow\n",
		"entry is not a mapping": "- 42\n",
	}
	name := "case"
	for label, content := range cases {
		t.Run(label, func(t *testing.T) {
			name = label
			m := New()
			p := write(t, content)
			if err := m.LoadFile(p); err == nil {
				t.Fatalf("%s: expected error, got nil", name)
			}
			// a failed load must not clobber the previous good set
			if m.Count(now) != 0 {
				t.Errorf("%s: failed load changed the active set", name)
			}
		})
	}
}

func TestSnapshotRoundTrip(t *testing.T) {
	m := New()
	p := write(t, `
- rule_id: vss-delete
  host: LAB-WKS-01
  reason: "ventana de cambio"
  expires: 2026-10-02T00:00:00Z
`)
	if err := m.LoadFile(p); err != nil {
		t.Fatal(err)
	}
	snap := m.Snapshot(now)
	if len(snap) != 1 {
		t.Fatalf("len = %d, want 1", len(snap))
	}
	e := snap[0]
	if e.RuleID != "vss-delete" || e.Host != "lab-wks-01" {
		t.Errorf("rule/host = %q/%q", e.RuleID, e.Host)
	}
	if e.Reason != "ventana de cambio" || e.Expires != "2026-10-02T00:00:00Z" {
		t.Errorf("reason/expires = %q/%q", e.Reason, e.Expires)
	}
}
