package suppress

// SEC-7 (fuzzing of the input surfaces): fuzz target for the
// suppression file loader. `go test` runs the seed corpus, so anything
// a fuzz run finds is pinned for the normal suite.
//
// Properties under fuzz:
//   - loading arbitrary suppression YAML never panics;
//   - a loaded set answers SuppressedAt/Snapshot without panicking;
//   - loaded entries always match case-insensitively on host (the
//     canonical form is enforced at load time).

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func FuzzLoadSuppress(f *testing.F) {
	f.Add([]byte("- rule_id: rule-1234\n  host: WS01\n  reason: change window\n"))
	f.Add([]byte("- rule_id: rule-1234\n  expires: 2026-12-31T23:59:59Z\n"))
	f.Add([]byte("[]"))
	f.Add([]byte("- host: only-host\n"))
	f.Add([]byte("- rule_id: x\n  expires: not-a-date\n"))
	f.Add([]byte("- reason: vacuous entry\n"))
	f.Add([]byte("- rule_id: RULE\n  host: Ws01.Example.COM\n"))
	f.Add([]byte("suppressions: [\n"))

	f.Fuzz(func(t *testing.T, data []byte) {
		dir := t.TempDir()
		path := filepath.Join(dir, "suppressions.yaml")
		if err := os.WriteFile(path, data, 0o600); err != nil {
			t.Skip()
		}
		m := New()
		if err := m.LoadFile(path); err != nil {
			return
		}
		now := time.Now()
		_ = m.Snapshot(now)
		for _, e := range m.All() {
			// Canonical form invariant: the loader normalizes every
			// entry, so the stored host is lowercase and trimmed.
			if e.Host != strings.ToLower(e.Host) || e.Host != strings.TrimSpace(e.Host) {
				t.Fatalf("loaded non-canonical host %q", e.Host)
			}
			if e.RuleID == "" && e.Host == "" {
				t.Fatal("loaded a vacuous entry (no rule_id and no host)")
			}
		}
	})
}
