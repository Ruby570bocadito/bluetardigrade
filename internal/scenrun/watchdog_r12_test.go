package scenrun

// Tests de regresión Ronda 12 (sesión 100agentes-3, agente 47): el
// watchdog del timeout libera s.current (adiós al 409 eterno) y un
// pánico en el replay ya no mata el motor.

import (
	"strings"
	"testing"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/scenario"
)

func waitStatus(t *testing.T, s *Service, runID string, want Status) *Run {
	t.Helper()
	deadline := time.Now().Add(15 * time.Second)
	for {
		r, err := s.RunDetail(runID)
		if err != nil {
			t.Fatalf("RunDetail: %v", err)
		}
		if r != nil && r.Status == want {
			return r
		}
		if time.Now().After(deadline) {
			t.Fatalf("run %s did not reach %s in time (status=%v)", runID, want, r.Status)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

// H2: timeout_ms era un parámetro muerto — el replay colgado dejaba el
// run "running" para siempre y todo POST siguiente respondía 409.
func TestScenrunTimeoutFreesCurrent(t *testing.T) {
	dir := writeLibrary(t, map[string]string{"ok.yaml": okScenario})
	s := New(dir, "", Deps{Rules: loadShippedRules(t)})

	release := make(chan struct{})
	s.runOneFn = func(*scenario.Runner, *scenario.Catalog, *scenario.Scenario) ScenarioResult {
		<-release // cuelga el replay: el watchdog debe ganar
		return ScenarioResult{}
	}

	run, err := s.Start(StartOptions{TimeoutMS: 1000})
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	r := waitStatus(t, s, run.ID, StatusError)
	if !strings.Contains(r.Error, "timeout") {
		t.Fatalf("error detail must name the timeout: %+v", r)
	}
	if s.CurrentRunID() != "" {
		t.Fatalf("s.current must be freed after the watchdog fires, got %q", s.CurrentRunID())
	}
	// el 409 se desbloqueó: un segundo Start en el MISMO servicio arranca
	close(release)
	run2, err := s.Start(StartOptions{})
	if err != nil {
		t.Fatalf("second Start must not 409: %v", err)
	}
	_ = run2
}

// H4: un pánico en la goroutine del replay mataba el proceso entero.
func TestScenrunPanicMarksError(t *testing.T) {
	dir := writeLibrary(t, map[string]string{"ok.yaml": okScenario})
	s := New(dir, "", Deps{Rules: loadShippedRules(t)})
	s.runOneFn = func(*scenario.Runner, *scenario.Catalog, *scenario.Scenario) ScenarioResult {
		panic("regla rota")
	}

	run, err := s.Start(StartOptions{})
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	r := waitStatus(t, s, run.ID, StatusError)
	if !strings.Contains(r.Error, "regla rota") {
		t.Fatalf("error detail must carry the panic: %+v", r)
	}
	if s.CurrentRunID() != "" {
		t.Fatalf("s.current must be freed after a panic, got %q", s.CurrentRunID())
	}
}
