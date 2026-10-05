package scenario

import (
	"fmt"
	"io"

	"github.com/Ruby570bocadito/bluetardigrade/internal/alert"
	"github.com/Ruby570bocadito/bluetardigrade/internal/correlate"
	"github.com/Ruby570bocadito/bluetardigrade/internal/enrich"
	"github.com/Ruby570bocadito/bluetardigrade/internal/rules"
)

// Runner replays scenarios through an in-process detection stack with
// the exact production order the engine loop applies: enrichment
// first, then rule evaluation, then the correlator — and every alert
// travels the SAME alert.Manager path (dedup, actions, tagging) as a
// production alert. The correlator is rebuilt per scenario: two
// scenarios sharing a step rule must never stitch a chain across the
// scenario boundary.
type Runner struct {
	// Rules is the compiled rule set the scenarios are validated
	// against (the shipped pack in CI, or an operator's own).
	Rules *rules.Engine
	// SeqDir is the kill-chain sequences directory. Empty disables
	// chain detection (rule-only scenarios still replay).
	SeqDir string
}

// Result is the outcome of one in-process replay.
type Result struct {
	Scenario *Scenario
	// Fired maps each raised alert's ID (shipped rule ID or sequence
	// ID) to how many alerts of that ID the replay produced.
	Fired map[string]int
	// Alerts lists every alert raised, in raise order. The CI net
	// asserts every one of them carries the simulation tag.
	Alerts []alert.Alert
}

// Satisfied reports whether every expectation of the scenario fired.
func (r *Result) Satisfied() bool {
	return len(r.Missing()) == 0
}

// Missing returns the expectations that did not reach their minimum,
// in declaration order.
func (r *Result) Missing() []Expected {
	if r == nil {
		return nil
	}
	var missing []Expected
	for _, e := range r.Scenario.Expected {
		if r.Fired[e.RuleID] < e.MinOrDefault() {
			missing = append(missing, e)
		}
	}
	return missing
}

// Run replays one scenario and returns what fired. The scenario
// events are the loader's own slice: replay MUTATES them (enrichment
// writes into ev.Enrichment, exactly like the engine loop). A second
// Run of the same *Scenario therefore needs a fresh LoadDir — the CI
// net and the CLI replay both reload per run.
func (rn *Runner) Run(sc *Scenario) (*Result, error) {
	if rn == nil || rn.Rules == nil {
		return nil, fmt.Errorf("scenario: runner sin reglas")
	}
	captured := &capture{}
	mgr := alert.New(io.Discard, captured.add)
	corr, err := rn.loadCorrelator(mgr.Emit)
	if err != nil {
		return nil, err
	}
	res := &Result{Scenario: sc, Fired: map[string]int{}}
	en := enrich.New()
	// Same order as the engine loop (cmd/engine/run.go): enrich, then
	// evaluate; per hit: raise the alert, then feed the correlator.
	for i := range sc.Events {
		ev := sc.Events[i].Event
		if ev == nil {
			continue // validated by the loader; defensive only
		}
		en.Apply(ev)
		for _, hit := range rn.Rules.Evaluate(ev) {
			mgr.Raise(ev, hit)
			if corr != nil {
				corr.Observe(ev, hit.Rule.Name)
			}
		}
	}
	for _, a := range captured.alerts {
		res.Fired[a.RuleID]++
	}
	res.Alerts = captured.alerts
	return res, nil
}

// loadCorrelator compiles the sequences directory, wired to the alert
// manager. A missing directory means no chains (the sequences-dir
// convention); a broken file is a loud error, same as the engine.
func (rn *Runner) loadCorrelator(emit func(alert.Alert)) (*correlate.Manager, error) {
	if rn.SeqDir == "" {
		return nil, nil
	}
	return correlate.LoadDir(rn.SeqDir, emit)
}

// capture collects the alerts the pipeline raises.
type capture struct {
	alerts []alert.Alert
}

func (c *capture) add(a alert.Alert) {
	c.alerts = append(c.alerts, a)
}
