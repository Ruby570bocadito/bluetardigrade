package scenrun

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/rules"
)

// The battery tests run against the REAL shipped detection pack (the
// same discipline as internal/scenario's own tests): a stubbed rule
// engine would validate the service against fiction. The comsvcs rule
// below is the shipped LSASS-dump detection the scenario library
// already exercises.
const comsvcsRuleID = "5b7e1f38-2c94-4d0a-b6e7-19a8c3d54f02"

func loadShippedRules(t *testing.T) func() *rules.Engine {
	t.Helper()
	e, err := rules.LoadDir(filepath.Join("..", "..", "rules"))
	if err != nil {
		t.Fatalf("rules: %v", err)
	}
	return func() *rules.Engine { return e }
}

// writeLibrary drops a scenario library into a temp directory and
// returns its path. Scenarios reference the shipped comsvcs rule.
func writeLibrary(t *testing.T, files map[string]string) string {
	t.Helper()
	dir := t.TempDir()
	for name, body := range files {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o600); err != nil {
			t.Fatalf("write %s: %v", name, err)
		}
	}
	return dir
}

const okScenario = `
- name: volcado de lsass con comsvcs (scenrun)
  id: sim-scenrun-ok
  description: escenario de prueba del servicio de ejecucion bajo demanda
  attack: [t1003.001]
  host: LAB-SIM-SCENRUN-OK
  expected:
  - rule: ` + comsvcsRuleID + `
  events:
  - type: process.create
    process:
      pid: 4100
      name: rundll32.exe
      command_line: "rundll32.exe C:\\Windows\\System32\\comsvcs.dll, MiniDump 744 C:\\Windows\\Temp\\lsass.dmp full"
`

const silentScenario = `
- name: proceso benigno (scenrun)
  id: sim-scenrun-silent
  description: no dispara nada; la expectativa debe quedar como missing
  attack: [t1003.001]
  host: LAB-SIM-SCENRUN-SILENT
  expected:
  - rule: ` + comsvcsRuleID + `
  events:
  - type: process.create
    process:
      pid: 4101
      name: notepad.exe
      command_line: notepad.exe
`

const catalogScenario = `
- name: expectativa inexistente (scenrun)
  id: sim-scenrun-catalog
  description: nombra una regla retirada; debe fallar como catalog, no como missing
  attack: [t1003.001]
  host: LAB-SIM-SCENRUN-CATALOG
  expected:
  - rule: 00000000-0000-4000-8000-000000000000
  events:
  - type: process.create
    process:
      pid: 4102
      name: notepad.exe
      command_line: notepad.exe
`

func waitCompleted(t *testing.T, s *Service, runID string) *Run {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for {
		r, err := s.RunDetail(runID)
		if err != nil {
			t.Fatalf("RunDetail: %v", err)
		}
		if r != nil && r.Status == StatusCompleted {
			return r
		}
		if time.Now().After(deadline) {
			t.Fatalf("run %s did not complete in time", runID)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func TestServiceRunsBatteryAndKeepsHistory(t *testing.T) {
	dir := writeLibrary(t, map[string]string{"ok.yaml": okScenario})
	s := New(dir, "", Deps{Rules: loadShippedRules(t)})

	views, err := s.Library()
	if err != nil {
		t.Fatalf("Library: %v", err)
	}
	if len(views) != 1 || views[0].ID != "sim-scenrun-ok" {
		t.Fatalf("library: got %+v", views)
	}
	if len(views[0].Expected) != 1 || views[0].Expected[0].Rule != comsvcsRuleID || views[0].Expected[0].Min != 1 {
		t.Fatalf("expected view: got %+v", views[0].Expected)
	}
	if views[0].Events != 1 {
		t.Fatalf("events: got %d", views[0].Events)
	}

	run, err := s.Start(StartOptions{})
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	if run.Status != StatusRunning || run.Total != 1 {
		t.Fatalf("launched run: %+v", run)
	}
	done := waitCompleted(t, s, run.ID)
	if len(done.Results) != 1 {
		t.Fatalf("results: %+v", done.Results)
	}
	res := done.Results[0]
	if res.Status != StatusDetected {
		t.Fatalf("scenario %s: status %s (%s)", res.ScenarioID, res.Status, res.Detail)
	}
	if done.Detected != 1 || done.PassRate != 1 || done.DurationMS < 0 {
		t.Fatalf("summary: %+v", done)
	}
	if res.Untagged != 0 {
		t.Fatalf("untagged alerts: %d", res.Untagged)
	}
	// history: the completed run leads the list, without results
	hist, err := s.History(10)
	if err != nil {
		t.Fatalf("History: %v", err)
	}
	if len(hist) != 1 || hist[0].ID != run.ID || hist[0].Results != nil {
		t.Fatalf("history: %+v", hist)
	}
}

func TestServiceReportsMissingAndCatalog(t *testing.T) {
	dir := writeLibrary(t, map[string]string{
		"silent.yaml":  silentScenario,
		"catalog.yaml": catalogScenario,
	})
	logs := &capture{}
	s := New(dir, "", Deps{Rules: loadShippedRules(t), Logf: logs.printf})

	run, err := s.Start(StartOptions{TimeoutMS: 1000})
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	done := waitCompleted(t, s, run.ID)
	if done.Missing != 1 || done.CatalogErr != 1 || done.Detected != 0 {
		t.Fatalf("summary: %+v", done)
	}
	byID := map[string]ScenarioResult{}
	for _, r := range done.Results {
		byID[r.ScenarioID] = r
	}
	silent := byID["sim-scenrun-silent"]
	if silent.Status != StatusMissing || len(silent.Missing) != 1 {
		t.Fatalf("silent: %+v", silent)
	}
	if m := silent.Missing[0]; m.Rule != comsvcsRuleID || m.Expected != 1 || m.Fired != 0 {
		t.Fatalf("missing detail: %+v", m)
	}
	cat := byID["sim-scenrun-catalog"]
	if cat.Status != StatusCatalog || cat.Detail == "" {
		t.Fatalf("catalog: %+v", cat)
	}
	if !strings.Contains(logs.String(), "completed") {
		t.Fatalf("run completion was not logged: %q", logs.String())
	}
}

func TestServiceOnlyFilterAndUnknownID(t *testing.T) {
	dir := writeLibrary(t, map[string]string{"ok.yaml": okScenario, "silent.yaml": silentScenario})
	s := New(dir, "", Deps{Rules: loadShippedRules(t)})

	if _, err := s.Start(StartOptions{Only: []string{"sim-nope"}}); err == nil || !strings.Contains(err.Error(), "sim-nope") {
		t.Fatalf("unknown id: err=%v", err)
	}
	run, err := s.Start(StartOptions{Only: []string{"sim-scenrun-ok"}})
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	done := waitCompleted(t, s, run.ID)
	if done.Total != 1 || done.Results[0].ScenarioID != "sim-scenrun-ok" {
		t.Fatalf("filtered run: %+v", done)
	}
}

func TestServiceRejectsSecondRunWhileInFlight(t *testing.T) {
	dir := writeLibrary(t, map[string]string{"ok.yaml": okScenario})
	s := New(dir, "", Deps{Rules: loadShippedRules(t)})
	// Simulate an in-flight run without racing the executor: the
	// guard is the same mutex the API hits.
	s.current = &Run{ID: "run-fake", Status: StatusRunning}
	defer func() { s.current = nil }()

	if _, err := s.Start(StartOptions{}); !errors.Is(err, ErrRunning) {
		t.Fatalf("concurrent Start: err=%v", err)
	}
}

func TestNilServiceIsNotArmed(t *testing.T) {
	var s *Service
	if _, err := s.Library(); !errors.Is(err, ErrNotArmed) {
		t.Fatalf("Library: err=%v", err)
	}
	if _, err := s.Start(StartOptions{}); !errors.Is(err, ErrNotArmed) {
		t.Fatalf("Start: err=%v", err)
	}
	if _, err := s.History(5); !errors.Is(err, ErrNotArmed) {
		t.Fatalf("History: err=%v", err)
	}
	if _, err := s.RunDetail("run-x"); !errors.Is(err, ErrNotArmed) {
		t.Fatalf("RunDetail: err=%v", err)
	}
	if s.Dir() != "" {
		t.Fatalf("Dir: %q", s.Dir())
	}
}

func TestServiceLoadErrorsSurfaceLoud(t *testing.T) {
	empty := t.TempDir()
	s := New(empty, "", Deps{Rules: loadShippedRules(t)})
	if _, err := s.Library(); err == nil || !strings.Contains(err.Error(), "no hay escenarios") {
		t.Fatalf("empty library: err=%v", err)
	}
	if _, err := s.Start(StartOptions{}); err == nil {
		t.Fatalf("Start on empty library: err=nil")
	}
	broken := writeLibrary(t, map[string]string{"bad.yaml": "- id: not-a-scenario\n"})
	s2 := New(broken, "", Deps{Rules: loadShippedRules(t)})
	if _, err := s2.Library(); err == nil || !strings.Contains(err.Error(), "bad.yaml") {
		t.Fatalf("broken library: err=%v", err)
	}
}

func TestServiceFailsFastWithoutRules(t *testing.T) {
	dir := writeLibrary(t, map[string]string{"ok.yaml": okScenario})
	s := New(dir, "", Deps{})
	if _, err := s.Start(StartOptions{}); err == nil || !strings.Contains(err.Error(), "reglas") {
		t.Fatalf("no rules: err=%v", err)
	}
	s2 := New(dir, "", Deps{Rules: func() *rules.Engine { return nil }})
	if _, err := s2.Start(StartOptions{}); err == nil || !strings.Contains(err.Error(), "reglas") {
		t.Fatalf("nil rules: err=%v", err)
	}
}

// capture collects Logf lines for assertions.
type capture struct {
	mu  sync.Mutex
	buf strings.Builder
}

func (c *capture) printf(format string, args ...any) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.buf.WriteString(format + "\n")
}

func (c *capture) String() string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.buf.String()
}

func TestServiceUsesSinkWhenAttached(t *testing.T) {
	dir := writeLibrary(t, map[string]string{"ok.yaml": okScenario})
	sink := &fakeSink{}
	s := New(dir, "", Deps{Rules: loadShippedRules(t), Sink: sink})

	run, err := s.Start(StartOptions{})
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	waitCompleted(t, s, run.ID)

	deadline := time.Now().Add(5 * time.Second)
	for len(sink.runs) == 0 {
		if time.Now().After(deadline) {
			t.Fatalf("sink never received the run")
		}
		time.Sleep(5 * time.Millisecond)
	}
	if sink.runs[0].Detected != 1 || sink.runs[0].Status != StatusCompleted {
		t.Fatalf("sink run: %+v", sink.runs[0])
	}
}

type fakeSink struct {
	mu   sync.Mutex
	runs []*Run
}

func (f *fakeSink) SaveScenarioRun(r *Run) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	cp := *r
	f.runs = append(f.runs, &cp)
	return nil
}

func (f *fakeSink) LoadScenarioRuns(limit int) ([]Run, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []Run
	for i := len(f.runs) - 1; i >= 0 && len(out) < limit; i-- {
		out = append(out, *f.runs[i])
	}
	return out, nil
}

func (f *fakeSink) LoadScenarioRun(id string) (*Run, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, r := range f.runs {
		if r.ID == id {
			cp := *r
			return &cp, nil
		}
	}
	return nil, nil
}

// The run id is a wire contract: GET /api/scenarios/runs/{id} accepts
// only "run-" plus 16 lowercase hex characters. Every id the service
// can mint — the crypto/rand one AND the wall-clock fallback that
// takes over when the OS entropy source is broken — must satisfy it,
// or the run becomes unpollable through the detail route the moment
// the fallback fires. The pre-fix fallback ("run-%d" of UnixNano,
// 19 decimal digits) fails the fallback rows below.
func TestRunIDsMatchWireContract(t *testing.T) {
	if !validRunID(newRunID()) {
		t.Fatalf("minted id %q does not match the run-id wire shape", newRunID())
	}
	for _, n := range []int64{0, 1, time.Now().UnixNano(), 1 << 62, 1<<63 - 1} {
		id := fallbackRunID(n)
		if !validRunID(id) {
			t.Fatalf("fallback id %q (stamp %d) does not match the run-id wire shape", id, n)
		}
		if !ValidRunID(id) {
			t.Fatalf("exported guard disagrees with the service about %q", id)
		}
	}
	for _, malformed := range []string{"", "run-", "run-abc", "run-0123456789ABCDEF", "run-0123456789abcdef0", "1728..", "run-0123456789abcdeg"} {
		if ValidRunID(malformed) {
			t.Fatalf("malformed id %q accepted", malformed)
		}
	}
}
