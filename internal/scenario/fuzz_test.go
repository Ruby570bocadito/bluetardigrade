package scenario

// SEC-7: fuzzing the scenario library loader. Every CI run and every
// on-demand battery run parses these YAML files, and the replay trusts
// what the loader returns, so the loader's output contract is the
// property under fuzz: LoadFile either fails loud or hands back
// scenarios that are fully valid — ids in shape, LAB-SIM hosts, known
// event types only, non-zero timestamps, the simulation tag on every
// event, no duplicate expectations — and LoadDir over a directory with
// the same file returns exactly the same scenarios.

import (
	"os"
	"path/filepath"
	"slices"
	"testing"

	"github.com/Ruby570bocadito/bluetardigrade/internal/alert"
)

var validScenarioYAML = []byte(`
- name: "Volcado de prueba"
  id: "sim-fuzz-dump"
  description: "Secuencia sintetica de prueba."
  host: "LAB-SIM-T1"
  attack: ["T1003.001"]
  expected:
    - rule: "5b7e1f38-2c94-4d0a-b6e7-19a8c3d54f02"
  events:
    - type: process.create
      process:
        pid: 4104
        name: "rundll32.exe"
    - type: network.connect
      host: "LAB-SIM-T2"
      network:
        protocol: "tcp"
        destination_ip: "203.0.113.9"
        destination_port: 4444
`)

func FuzzLoadScenarioFile(f *testing.F) {
	f.Add(validScenarioYAML)
	f.Add([]byte(`[]`))
	f.Add([]byte(`- name: x`))
	f.Add([]byte(`not yaml: [`))
	f.Add([]byte(`- name: "x"
  id: "sim-fuzz-bad"
  description: "d"
  host: "EVIL-1"
  expected:
    - rule: "r"
  events:
    - type: process.create`))
	f.Add([]byte(`- name: "x"
  id: "sim-fuzz-unknown"
  description: "d"
  host: "LAB-SIM-T1"
  expcted:
    - rule: "r"
  events:
    - type: process.create`))
	f.Add([]byte(`- name: "x"
  id: "sim-fuzz-types"
  description: "d"
  host: "LAB-SIM-T1"
  expected:
    - rule: "r"
  events:
    - type: 42`))
	f.Add([]byte(`- name: "x"
  id: "sim-fuzz-null"
  description: "d"
  host: "LAB-SIM-T1"
  expected:
    - rule: "r"
  events: [~]`))
	f.Add([]byte(`a: &a ["x"]
b: *a`))

	f.Fuzz(func(t *testing.T, data []byte) {
		if len(data) > maxFileBytes {
			return
		}
		dir := t.TempDir()
		path := filepath.Join(dir, "fuzz.yaml")
		if err := os.WriteFile(path, data, 0o644); err != nil {
			t.Fatal(err)
		}
		list, err := LoadFile(path)
		if err != nil {
			return // failing loud is always acceptable
		}
		for _, sc := range list {
			if !idPattern.MatchString(sc.ID) {
				t.Fatalf("loader returned scenario %q with id %q outside the id shape", sc.Name, sc.ID)
			}
			if !isSimHost(sc.Host) || sc.Host == "" {
				t.Fatalf("scenario %q loaded with non-simulation host %q", sc.ID, sc.Host)
			}
			if len(sc.Expected) == 0 || len(sc.Events) == 0 {
				t.Fatalf("scenario %q loaded without expectations or events", sc.ID)
			}
			seenExp := map[string]bool{}
			for _, e := range sc.Expected {
				if stringsBlank(e.RuleID) {
					t.Fatalf("scenario %q loaded an expectation without a rule", sc.ID)
				}
				if seenExp[e.RuleID] {
					t.Fatalf("scenario %q loaded duplicate expectation %q", sc.ID, e.RuleID)
				}
				seenExp[e.RuleID] = true
				if e.Min < 0 {
					t.Fatalf("scenario %q loaded negative min for %q", sc.ID, e.RuleID)
				}
			}
			for i, w := range sc.Events {
				if w.Event == nil {
					t.Fatalf("scenario %q event %d loaded empty", sc.ID, i)
				}
				ev := w.Event
				if !knownTypes[ev.Type] {
					t.Fatalf("scenario %q event %d loaded type %q outside the schema", sc.ID, i, ev.Type)
				}
				if ev.Timestamp.IsZero() {
					t.Fatalf("scenario %q event %d loaded without a timestamp", sc.ID, i)
				}
				if !isSimHost(ev.Host) {
					t.Fatalf("scenario %q event %d loaded with host %q outside %s", sc.ID, i, ev.Host, HostPrefix)
				}
				if !slices.Contains(ev.Tags, alert.SimulationTag) {
					t.Fatalf("scenario %q event %d loaded without the simulation tag", sc.ID, i)
				}
			}
		}
		// A directory containing the same file must yield the same
		// scenarios (LoadDir is what the battery and the CI walk).
		viaDir, err := LoadDir(dir)
		if err != nil {
			t.Fatalf("LoadDir refused what LoadFile accepted: %v", err)
		}
		if len(viaDir) != len(list) {
			t.Fatalf("LoadDir returned %d scenarios, LoadFile %d", len(viaDir), len(list))
		}
		for i := range list {
			if viaDir[i].ID != list[i].ID || len(viaDir[i].Events) != len(list[i].Events) {
				t.Fatalf("LoadDir[%d] = %q/%d events, LoadFile = %q/%d events",
					i, viaDir[i].ID, len(viaDir[i].Events), list[i].ID, len(list[i].Events))
			}
		}
	})
}

func stringsBlank(s string) bool {
	for _, r := range s {
		if r != ' ' && r != '\t' {
			return false
		}
	}
	return true
}
