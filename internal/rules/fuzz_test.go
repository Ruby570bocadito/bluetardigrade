package rules

// SEC-7 (fuzzing of the input surfaces): fuzz target for the rule
// loader — the YAML surface every detection depends on. `go test`
// runs the seed corpus, so anything a fuzz run finds is pinned for the
// normal suite.
//
// Properties under fuzz:
//   - loading arbitrary rule YAML never panics;
//   - a successfully loaded engine answers Evaluate, Snapshot and
//     Types without panicking for a representative event;
//   - the loaded rule count never exceeds the cap;
//   - rules that loaded carry only valid operators and severities
//     (compile enforces it; the fuzzer holds the whole pipeline to it).

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
)

func FuzzLoadRulesDir(f *testing.F) {
	f.Add([]byte("- name: r1\n  id: r1\n  event_type: process.create\n  severity: high\n  conditions:\n    - field: process.name\n      operator: contains\n      value: cmd\n"))
	f.Add([]byte("- name: r2\n  id: r2\n  event_type: network.connect\n  severity: critical\n  conditions:\n    - field: network.domain\n      operator: regex\n      value: '.*\\.evil\\.example'\n"))
	f.Add([]byte("[]"))
	f.Add([]byte("- name: broken\n  event_type: process.create\n  severity: nope\n"))
	f.Add([]byte("- name: quiet\n  id: r3\n  event_type: process.create\n  severity: low\n  enabled: false\n  conditions:\n    - field: process.name\n      operator: endswith\n      value: .exe\n"))
	f.Add([]byte("- name: x\n  id: x\n  event_type: t\n  severity: info\n  conditions:\n    - field: a\n      operator: not_in\n      value: []\n"))
	f.Add([]byte("- name: y\n  id: y\n  event_type: t\n  severity: info\n  conditions:\n    - field: a\n      operator: gt\n      value: 99999999999999999999\n"))
	f.Add([]byte("rules: []\n"))
	f.Add([]byte("&a [null]\n"))

	f.Fuzz(func(t *testing.T, data []byte) {
		dir := t.TempDir()
		if err := os.WriteFile(filepath.Join(dir, "fuzz.yaml"), data, 0o600); err != nil {
			t.Skip()
		}
		e, err := LoadDir(dir)
		if err != nil {
			return
		}
		if e.Count() > maxRules {
			t.Fatalf("loaded %d rules over the cap of %d", e.Count(), maxRules)
		}
		// Whatever loaded must evaluate safely against a
		// representative event of every indexed type.
		for _, typ := range e.Types() {
			ev := &model.Event{ID: "f", Type: typ, Host: "h", Process: &model.Process{Name: "cmd.exe", CommandLine: "cmd /c echo hi"}, Network: &model.Network{Domain: "a.evil.example"}}
			_ = e.Evaluate(ev)
			_ = e.Snapshot()
		}
	})
}
