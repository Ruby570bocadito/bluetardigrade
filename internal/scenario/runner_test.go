package scenario

import (
	"testing"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/alert"
	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
)

// ruleID comsvcs, ruleID procdump and the kill-chain that chains them
// live in the shipped pack: the runner tests use them through the real
// loaders so the whole detection path is exercised, not a stub.
const (
	comsvcsRuleID = "5b7e1f38-2c94-4d0a-b6e7-19a8c3d54f02"
	credTheftSeq  = "c0a5e7d1-1a2b-4c3d-8e4f-a5b6c7d8e9f0" // "Campana de robo de credenciales"
)

func newTestRunner(t *testing.T) *Runner {
	t.Helper()
	e, err := loadRules()
	if err != nil {
		t.Fatalf("rules: %v", err)
	}
	return &Runner{Rules: e, SeqDir: sequencesDir()}
}

// comsvcsDump returns an inert LSASS-dump event that the shipped
// comsvcs rule matches.
func comsvcsDump(pid int) *model.Event {
	return &model.Event{
		Type: model.TypeProcessCreate,
		Process: &model.Process{
			PID:         pid,
			Name:        "rundll32.exe",
			CommandLine: `rundll32.exe C:\Windows\System32\comsvcs.dll, MiniDump 744 C:\Windows\Temp\lsass.dmp full`,
		},
	}
}

// evs wraps model events as scenario declarations (the wrapper the
// YAML loader produces via the JSON round-trip).
func evs(list ...*model.Event) []Event {
	out := make([]Event, 0, len(list))
	for _, e := range list {
		out = append(out, Event{Event: e})
	}
	return out
}

func TestRunnerFiresRuleAndChainAlerts(t *testing.T) {
	rn := newTestRunner(t)
	sc := &Scenario{
		Name: "prueba de cadena", ID: "sim-runner-chain",
		Description: "dos volcados y el registro SAM completan la cadena de robo de credenciales",
		Host:        "LAB-SIM-RUN1", User: `CORP\sim`,
		Expected: []Expected{
			{RuleID: comsvcsRuleID},
			{RuleID: credTheftSeq},
		},
		Events: evs(
			comsvcsDump(4100),
			&model.Event{Type: model.TypeProcessCreate, Process: &model.Process{PID: 4101, Name: "procdump.exe",
				CommandLine: "procdump.exe -accepteula -ma lsass.exe C:\\Windows\\Temp\\lsass2.dmp"}},
			&model.Event{Type: model.TypeProcessCreate, Process: &model.Process{PID: 4102, Name: "reg.exe",
				CommandLine: "reg.exe save HKLM\\SAM C:\\Users\\Public\\sam.hiv"}},
		),
	}
	// finalize runs inside the loader in production; replicate it here
	if err := sc.finalize(time.Now()); err != nil {
		t.Fatalf("finalize: %v", err)
	}
	res, err := rn.Run(sc)
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if !res.Satisfied() {
		t.Fatalf("scenario not satisfied, missing: %v (fired: %v)", res.Missing(), res.Fired)
	}
	if res.Fired[comsvcsRuleID] != 1 || res.Fired[credTheftSeq] != 1 {
		t.Errorf("fired = %v, want one hit per expectation", res.Fired)
	}
	if len(res.Alerts) == 0 {
		t.Fatal("no alerts captured")
	}
	for _, a := range res.Alerts {
		if !alertHasTag(a, alert.SimulationTag) {
			t.Errorf("alert %s (rule %s) missing the %q tag: tags=%v",
				a.ID, a.RuleID, alert.SimulationTag, a.Tags)
		}
	}
}

func TestRunnerIsolatesScenarios(t *testing.T) {
	// One scenario advances one step of the credential-theft chain; a
	// second scenario on the same host must NOT complete the chain
	// with the previous run's leftover progress.
	rn := newTestRunner(t)
	step := func(id string) *Scenario {
		sc := &Scenario{
			Name: "paso aislado", ID: id,
			Description: "un solo paso, la cadena no debe completarse",
			Host:        "LAB-SIM-ISO1",
			Expected:    []Expected{{RuleID: comsvcsRuleID}},
			Events:      evs(comsvcsDump(4200)),
		}
		if err := sc.finalize(time.Now()); err != nil {
			t.Fatalf("finalize: %v", err)
		}
		return sc
	}
	first, err := rn.Run(step("sim-iso-a"))
	if err != nil {
		t.Fatalf("first Run: %v", err)
	}
	if first.Fired[credTheftSeq] != 0 {
		t.Fatalf("chain completed with a single step: %v", first.Fired)
	}
	second, err := rn.Run(step("sim-iso-b"))
	if err != nil {
		t.Fatalf("second Run: %v", err)
	}
	if second.Fired[credTheftSeq] != 0 {
		t.Errorf("chain state leaked across scenarios: fired=%v", second.Fired)
	}
}

func alertHasTag(a alert.Alert, tag string) bool {
	for _, t := range a.Tags {
		if t == tag {
			return true
		}
	}
	return false
}
