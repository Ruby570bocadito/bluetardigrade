package rules

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
)

// TestExcludeKnownSoftware (§2.2): a rule with exclude_known_software
// does not fire on events the engine enriched with known_software, and
// still fires on everything else. The default stays false — no
// existing rule changes behavior.
func TestExcludeKnownSoftware(t *testing.T) {
	on := true
	dir := writeRuleDir(t, []Rule{{
		Name: "unexpected software", ID: "aaaa1111", Severity: SevLow,
		EventType: model.TypeProcessCreate,
		Conditions: []Condition{
			{Field: "process.name", Operator: "endswith", Value: ".exe"},
		},
		ExcludeKnownSoftware: &on,
	}})
	e, err := LoadDir(dir)
	if err != nil {
		t.Fatal(err)
	}

	knownEv := &model.Event{
		Type: model.TypeProcessCreate, Host: "LAB-1",
		Process:    &model.Process{PID: 1, Name: "vantage.exe"},
		Enrichment: map[string]string{"known_software": "Lenovo Vantage"},
	}
	if hits := e.Evaluate(knownEv); len(hits) != 0 {
		t.Fatalf("a known-software event must not fire an opted-out rule (got %d hits)", len(hits))
	}

	plainEv := &model.Event{
		Type: model.TypeProcessCreate, Host: "LAB-1",
		Process: &model.Process{PID: 1, Name: "unknown.exe"},
	}
	if hits := e.Evaluate(plainEv); len(hits) != 1 {
		t.Fatalf("the same rule must fire on a non-known event (got %d hits)", len(hits))
	}

	// an empty label does not count as known
	emptyEv := &model.Event{
		Type: model.TypeProcessCreate, Host: "LAB-1",
		Process:    &model.Process{PID: 1, Name: "unknown.exe"},
		Enrichment: map[string]string{"known_software": ""},
	}
	if hits := e.Evaluate(emptyEv); len(hits) != 1 {
		t.Fatalf("an empty known_software label must not opt out (got %d hits)", len(hits))
	}
}

func TestExcludeKnownSoftwareDefaultsOff(t *testing.T) {
	dir := writeRuleDir(t, []Rule{{
		Name: "normal rule", ID: "aaaa2222", Severity: SevLow,
		EventType: model.TypeProcessCreate,
		Conditions: []Condition{
			{Field: "process.name", Operator: "endswith", Value: ".exe"},
		},
	}})
	e, err := LoadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	knownEv := &model.Event{
		Type: model.TypeProcessCreate, Host: "LAB-1",
		Process:    &model.Process{PID: 1, Name: "vantage.exe"},
		Enrichment: map[string]string{"known_software": "Lenovo Vantage"},
	}
	if hits := e.Evaluate(knownEv); len(hits) != 1 {
		t.Fatal("without the opt-in flag, a known-software event still fires the rule")
	}
}

// TestExcludeKnownSoftwareYAMLRoundTrip pins the YAML key name the
// docs advertise.
func TestExcludeKnownSoftwareYAMLRoundTrip(t *testing.T) {
	dir := t.TempDir()
	yml := `- name: unexpected software
  id: aaaa3333
  severity: low
  event_type: process.create
  exclude_known_software: true
  conditions:
    - field: process.name
      operator: endswith
      value: ".exe"
`
	if err := os.WriteFile(filepath.Join(dir, "r.yaml"), []byte(yml), 0o600); err != nil {
		t.Fatal(err)
	}
	e, err := LoadDir(dir)
	if err != nil {
		t.Fatalf("LoadDir: %v", err)
	}
	for _, r := range e.Snapshot() {
		if r.ID == "aaaa3333" && !r.ExcludesKnownSoftware() {
			t.Fatal("exclude_known_software: true did not survive the YAML round-trip")
		}
	}
}
