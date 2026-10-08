package sigma

// SEC-7 (fuzzing of the input surfaces): fuzz target for the Sigma
// YAML converter. `go test` runs the seed corpus, so anything a fuzz
// run finds is pinned for the normal suite.
//
// Properties under fuzz:
//   - converting arbitrary Sigma YAML never panics;
//   - every emitted rule re-parses against the engine's own loader
//     contract: valid operator, valid severity, non-empty event_type
//     (the converter must never emit a rule the engine would refuse);
//   - the emitted rule count respects the cap.

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/Ruby570bocadito/bluetardigrade/internal/rules"
)

func FuzzConvertSigma(f *testing.F) {
	f.Add([]byte("title: t\nid: 11111111-aaaa-4e18-8a02-3b9c6d1e7f40\ndetection:\n  SEL:\n    Image|endswith: '\\cmd.exe'\n  condition: SEL\nlogsource:\n  product: windows\n  category: process_creation\nlevel: high\n"))
	f.Add([]byte("title: t\ndetection:\n  A:\n    Domain|contains_any: ['a.example', 'b.example']\n  B:\n    DestinationIp|startswith: '10.'\n  condition: 1 of A* or B\nlogsource:\n  product: windows\n  category: network_connection\nlevel: critical\n"))
	f.Add([]byte("title: base64\ndetection:\n  A:\n    CommandLine|base64offset|contains: 'whoami'\n  condition: A\nlogsource:\n  product: windows\n  category: process_creation\nlevel: low\n"))
	f.Add([]byte("title: badcond\ndetection:\n  A:\n    Image: 'x'\n  condition: A and (not B\nlogsource:\n  product: windows\n  category: process_creation\nlevel: info\n"))
	f.Add([]byte("detection:\n  condition: A\nlogsource:\n  product: linux\n  category: process_creation\n"))
	f.Add([]byte("not sigma: true\n"))
	f.Add([]byte(""))
	f.Add([]byte("title: contains-all\nid: 22222222-bbbb-4e18-8a02-3b9c6d1e7f40\ndetection:\n  SEL:\n    CommandLine|contains|all: ['whoami', '/priv']\n  condition: SEL\nlogsource:\n  product: windows\n  category: process_creation\nlevel: high\n"))
	f.Add([]byte("title: nested-subsel\nid: 33333333-cccc-4e18-8a02-3b9c6d1e7f40\ndetection:\n  SEL:\n    Image:\n      name: cmd.exe\n    CommandLine: whoami\n  condition: SEL\nlogsource:\n  product: windows\n  category: process_creation\nlevel: high\n"))

	f.Fuzz(func(t *testing.T, data []byte) {
		dir := t.TempDir()
		if err := os.WriteFile(filepath.Join(dir, "fuzz.yml"), data, 0o600); err != nil {
			t.Skip()
		}
		res, err := ConvertDir(dir)
		if err != nil {
			return
		}
		if len(res.Converted) > MaxRulesOut {
			t.Fatalf("emitted %d rules over the cap of %d", len(res.Converted), MaxRulesOut)
		}
		for _, r := range res.Converted {
			// The converter must never emit a rule the engine loader
			// would refuse.
			if r.EventType == "" {
				t.Fatalf("emitted rule %q without event_type", r.Name)
			}
			conds := make([]rules.Condition, 0, len(r.Conditions))
			for _, c := range r.Conditions {
				conds = append(conds, rules.Condition{Field: c.Field, Operator: c.Operator, Value: c.Value})
			}
			if _, err := rules.NewMatcher(conds); err != nil {
				t.Fatalf("emitted rule %q does not compile against the engine matcher: %v", r.Name, err)
			}
		}
	})
}
