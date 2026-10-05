package scenario

import (
	"fmt"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Ruby570bocadito/bluetardigrade/internal/alert"
	"github.com/Ruby570bocadito/bluetardigrade/internal/correlate"
	"github.com/Ruby570bocadito/bluetardigrade/internal/rules"
)

// The library under test lives at the repository root, next to rules/
// and sequences/ (the tests run from internal/scenario).
const repoRoot = "../.."

func scenariosDir() string { return filepath.Join(repoRoot, "scenarios") }

func sequencesDir() string { return filepath.Join(repoRoot, "sequences") }

func loadRules() (*rules.Engine, error) { return rules.LoadDir(filepath.Join(repoRoot, "rules")) }

func loadSequences() (*correlate.Manager, error) {
	return correlate.LoadDir(filepath.Join(repoRoot, "sequences"), nil)
}

func newCatalog() (*Catalog, error) {
	e, err := loadRules()
	if err != nil {
		return nil, err
	}
	corr, err := loadSequences()
	if err != nil {
		return nil, err
	}
	var ruleIDs, seqIDs []string
	for _, r := range e.Snapshot() {
		ruleIDs = append(ruleIDs, r.ID)
	}
	for _, s := range corr.Snapshot() {
		seqIDs = append(seqIDs, s.ID)
	}
	return NewCatalog(ruleIDs, seqIDs), nil
}

// TestScenarioLibraryDetects is the CI regression net (SIM-2): every
// scenario replays through the real detection stack (shipped rules,
// enrichment, correlator, alert pipeline) and EVERY expectation must
// fire. A scenario that stops detecting breaks the build, so a
// detection regression can never land silently. It also asserts the
// simulation tag end to end: every alert the replay raises must carry
// it, whatever emitter built the alert.
func TestScenarioLibraryDetects(t *testing.T) {
	cat, err := newCatalog()
	if err != nil {
		t.Fatalf("catalog: %v", err)
	}
	list, err := LoadDir(scenariosDir())
	if err != nil {
		t.Fatalf("loading scenarios: %v", err)
	}
	if len(list) < 100 {
		t.Fatalf("library too small: %d scenarios (the pack covers rules and chains)", len(list))
	}
	rn := &Runner{Rules: mustRules(t), SeqDir: filepath.Join(repoRoot, "sequences")}
	for _, sc := range list {
		sc := sc
		t.Run(sc.ID, func(t *testing.T) {
			if missing := cat.MissingExpectations(sc); len(missing) > 0 {
				t.Fatalf("expectations unknown to the shipped pack: %v", missing)
			}
			res, err := rn.Run(sc)
			if err != nil {
				t.Fatalf("replay: %v", err)
			}
			if !res.Satisfied() {
				var parts []string
				for _, e := range res.Missing() {
					parts = append(parts, fmt.Sprintf("%s (min %d, fired %d)", e.RuleID, e.MinOrDefault(), res.Fired[e.RuleID]))
				}
				t.Fatalf("the scenario no longer detects: %s", strings.Join(parts, "; "))
			}
			for _, a := range res.Alerts {
				if !alertHasTag(a, alert.SimulationTag) {
					t.Errorf("alert raised WITHOUT the %q tag: rule=%s host=%s tags=%v",
						alert.SimulationTag, a.RuleID, a.Host, a.Tags)
				}
			}
		})
	}
}

// TestScenarioLibraryCoversEveryDetection enforces the SIM-2 goal: one
// scenario per shipped rule and per kill-chain. A new rule or sequence
// without its scenario breaks the build, so the library grows with the
// pack instead of rotting behind it.
func TestScenarioLibraryCoversEveryDetection(t *testing.T) {
	list, err := LoadDir(scenariosDir())
	if err != nil {
		t.Fatalf("loading scenarios: %v", err)
	}
	covered := map[string]bool{}
	for _, sc := range list {
		for _, e := range sc.Expected {
			covered[e.RuleID] = true
		}
	}
	e := mustRules(t)
	var uncoveredRules []string
	for _, r := range e.Snapshot() {
		if !covered[r.ID] {
			uncoveredRules = append(uncoveredRules, fmt.Sprintf("%s (%s)", r.ID, r.Name))
		}
	}
	corr, err := loadSequences()
	if err != nil {
		t.Fatalf("sequences: %v", err)
	}
	var uncoveredSeqs []string
	for _, s := range corr.Snapshot() {
		if !covered[s.ID] {
			uncoveredSeqs = append(uncoveredSeqs, fmt.Sprintf("%s (%s)", s.ID, s.Name))
		}
	}
	if len(uncoveredRules) > 0 || len(uncoveredSeqs) > 0 {
		t.Fatalf("shipped detections without a scenario: rules=[%s] sequences=[%s]",
			strings.Join(uncoveredRules, "; "), strings.Join(uncoveredSeqs, "; "))
	}
}

func mustRules(t *testing.T) *rules.Engine {
	t.Helper()
	e, err := loadRules()
	if err != nil {
		t.Fatalf("rules: %v", err)
	}
	return e
}

// A final guard on the loader determinism the CI net relies on.
func TestLibraryReloadsStable(t *testing.T) {
	first, err := LoadDir(scenariosDir())
	if err != nil {
		t.Fatalf("first load: %v", err)
	}
	second, err := LoadDir(scenariosDir())
	if err != nil {
		t.Fatalf("second load: %v", err)
	}
	if len(first) != len(second) {
		t.Fatalf("load count drifted: %d vs %d", len(first), len(second))
	}
	for i := range first {
		if first[i].ID != second[i].ID {
			t.Fatalf("load order drifted at %d: %s vs %s", i, first[i].ID, second[i].ID)
		}
	}
}
