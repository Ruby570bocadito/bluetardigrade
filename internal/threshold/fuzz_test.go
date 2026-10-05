package threshold

// SEC-7 (fuzzing of the input surfaces): fuzz target for the threshold
// definition loader. `go test` runs the seed corpus, so anything a fuzz
// run finds is pinned for the normal suite.
//
// Properties under fuzz:
//   - loading arbitrary threshold YAML never panics;
//   - a successfully loaded detector evaluates a representative event
//     without panicking and keeps its own load-time invariants (at
//     most MaxRules definitions, unique IDs).

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
)

func FuzzLoadThreshold(f *testing.F) {
	f.Add([]byte("- id: brute\n  name: brute\n  event_type: network.connect\n  count: 10\n  window: 5m\n  group_by: network.source_ip\n  severity: high\n"))
	f.Add([]byte("- id: x\n  name: x\n  event_type: process.create\n  count: 1\n  window: 1s\n  severity: low\n"))
	f.Add([]byte("[]"))
	f.Add([]byte("- id: y\n  name: y\n  event_type: t\n  count: 999999999999999999999\n  window: 9999h\n  severity: info\n"))
	f.Add([]byte("- id: dup\n  name: a\n  event_type: t\n  count: 2\n  window: 1m\n  severity: info\n- id: dup\n  name: b\n  event_type: t\n  count: 2\n  window: 1m\n  severity: info\n"))
	f.Add([]byte("- id: z\n  event_type: t\n  count: 2\n  window: 1m\n"))
	f.Add([]byte("nope: [\n"))

	f.Fuzz(func(t *testing.T, data []byte) {
		dir := t.TempDir()
		path := filepath.Join(dir, "thresholds.yaml")
		if err := os.WriteFile(path, data, 0o600); err != nil {
			t.Skip()
		}
		d, err := LoadFile(path)
		if err != nil {
			return
		}
		if len(d.defs) > MaxRules {
			t.Fatalf("loaded %d definitions over the cap of %d", len(d.defs), MaxRules)
		}
		ids := map[string]bool{}
		for _, c := range d.defs {
			if ids[c.def.ID] {
				t.Fatalf("loaded duplicated definition id %q", c.def.ID)
			}
			ids[c.def.ID] = true
		}
		// Whatever loaded must evaluate safely.
		d.Observe(&model.Event{ID: "f", Type: "process.create", Host: "h", Process: &model.Process{Name: "x.exe"}}, time.Now())
	})
}
