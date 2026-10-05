package api

// Endpoint tests for the detection-validation surface (SIM-4): the
// disarmed contract (501 + hint, never a misleading 404), the armed
// round trip against the REAL shipped rule pack (the same discipline
// as internal/scenrun's own tests), and the 409 single-run guard.

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/rules"
	"github.com/Ruby570bocadito/bluetardigrade/internal/scenrun"
)

const (
	comsvcsRuleID = "5b7e1f38-2c94-4d0a-b6e7-19a8c3d54f02"
	// The hub routes demand a JSON body decoder; the run body is
	// optional, so POST with an empty body launches the whole battery.
)

func scenarioAPILibrary(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	ok := `
- name: volcado de lsass con comsvcs (api)
  id: sim-api-ok
  description: escenario de prueba del endpoint de ejecucion
  attack: [t1003.001]
  host: LAB-SIM-API-OK
  expected:
  - rule: ` + comsvcsRuleID + `
  events:
  - type: process.create
    process:
      pid: 4200
      name: rundll32.exe
      command_line: "rundll32.exe C:\\Windows\\System32\\comsvcs.dll, MiniDump 744 C:\\Windows\\Temp\\lsass.dmp full"
`
	silent := `
- name: proceso benigno (api)
  id: sim-api-silent
  description: no dispara nada; debe salir como missing
  attack: [t1003.001]
  host: LAB-SIM-API-SILENT
  expected:
  - rule: ` + comsvcsRuleID + `
  events:
  - type: process.create
    process:
      pid: 4201
      name: notepad.exe
      command_line: notepad.exe
`
	for name, body := range map[string]string{"ok.yaml": ok, "silent.yaml": silent} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o600); err != nil {
			t.Fatalf("write %s: %v", name, err)
		}
	}
	return dir
}

func newScenarioHub(t *testing.T) (*Hub, string) {
	t.Helper()
	h, addr := newTestHub(t)
	e, err := rules.LoadDir(filepath.Join("..", "..", "rules"))
	if err != nil {
		t.Fatalf("rules: %v", err)
	}
	h.SetScenarios(scenrun.New(scenarioAPILibrary(t), "", scenrun.Deps{
		Rules: func() *rules.Engine { return e },
	}))
	return h, addr
}

func callJSON(t *testing.T, method, url, body string) (int, string) {
	t.Helper()
	var rd io.Reader
	if body != "" {
		rd = strings.NewReader(body)
	}
	req, err := http.NewRequest(method, url, rd)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", method, url, err)
	}
	defer res.Body.Close()
	data, err := io.ReadAll(res.Body)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	return res.StatusCode, string(data)
}

func TestScenarioRoutesDisarmedAnswer501(t *testing.T) {
	h, addr := newTestHub(t)
	_ = h
	for _, tc := range []struct{ method, path string }{
		{"GET", "/api/scenarios"},
		{"POST", "/api/scenarios/run"},
		{"GET", "/api/scenarios/runs"},
		{"GET", "/api/scenarios/runs/run-0123456789abcdef"},
	} {
		code, body := callJSON(t, tc.method, fmt.Sprintf("http://%s%s", addr, tc.path), "")
		if code != http.StatusNotImplemented {
			t.Fatalf("%s %s: status %d, want 501", tc.method, tc.path, code)
		}
		if !strings.Contains(body, "scenario validation is not armed") ||
			!strings.Contains(body, "-scenarios") {
			t.Fatalf("%s %s: body %q", tc.method, tc.path, body)
		}
	}
}

func TestScenarioEndpointsRoundTrip(t *testing.T) {
	h, addr := newScenarioHub(t)
	_ = h
	base := fmt.Sprintf("http://%s", addr)

	// library
	code, body := callJSON(t, "GET", base+"/api/scenarios", "")
	if code != http.StatusOK {
		t.Fatalf("library: status %d body %s", code, body)
	}
	var lib struct {
		Armed     bool                   `json:"armed"`
		Count     int                    `json:"count"`
		Scenarios []scenrun.ScenarioView `json:"scenarios"`
	}
	if err := json.Unmarshal([]byte(body), &lib); err != nil {
		t.Fatalf("library decode: %v", err)
	}
	if !lib.Armed || lib.Count != 2 || len(lib.Scenarios) != 2 {
		t.Fatalf("library: %+v", lib)
	}

	// run: empty body = whole battery
	code, body = callJSON(t, "POST", base+"/api/scenarios/run", "")
	if code != http.StatusAccepted {
		t.Fatalf("run: status %d body %s", code, body)
	}
	var launched scenrun.Run
	if err := json.Unmarshal([]byte(body), &launched); err != nil {
		t.Fatalf("run decode: %v", err)
	}
	if launched.Status != scenrun.StatusRunning || launched.Total != 2 {
		t.Fatalf("launched: %+v", launched)
	}

	// second launch while in flight -> 409 naming the run (racy: the
	// battery may finish first, so only assert when it is still 202
	// territory; the deterministic guard lives in internal/scenrun)
	code, body = callJSON(t, "POST", base+"/api/scenarios/run", "")
	if code == http.StatusConflict && !strings.Contains(body, launched.ID) {
		t.Fatalf("409 body must name the current run: %q", body)
	}

	// wait for completion through the detail endpoint
	var done *scenrun.Run
	deadline := time.Now().Add(10 * time.Second)
	for {
		code, body = callJSON(t, "GET", base+"/api/scenarios/runs/"+launched.ID, "")
		if code != http.StatusOK {
			t.Fatalf("detail: status %d body %s", code, body)
		}
		done = &scenrun.Run{}
		if err := json.Unmarshal([]byte(body), done); err != nil {
			t.Fatalf("detail decode: %v", err)
		}
		if done.Status == scenrun.StatusCompleted {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("run did not complete in time")
		}
		time.Sleep(5 * time.Millisecond)
	}
	if done.Detected != 1 || done.Missing != 1 || done.PassRate != 0.5 {
		t.Fatalf("summary: %+v", done)
	}
	statuses := map[string]scenrun.Status{}
	for _, r := range done.Results {
		statuses[r.ScenarioID] = r.Status
	}
	if statuses["sim-api-ok"] != scenrun.StatusDetected || statuses["sim-api-silent"] != scenrun.StatusMissing {
		t.Fatalf("statuses: %+v", statuses)
	}

	// history lists the run, newest first, summaries only
	code, body = callJSON(t, "GET", base+"/api/scenarios/runs?limit=10", "")
	if code != http.StatusOK {
		t.Fatalf("history: status %d body %s", code, body)
	}
	var hist struct {
		Runs []scenrun.Run `json:"runs"`
	}
	if err := json.Unmarshal([]byte(body), &hist); err != nil {
		t.Fatalf("history decode: %v", err)
	}
	if len(hist.Runs) != 1 || hist.Runs[0].ID != launched.ID || hist.Runs[0].Results != nil {
		t.Fatalf("history: %+v", hist.Runs)
	}

	// filter: only the passing scenario
	code, body = callJSON(t, "POST", base+"/api/scenarios/run",
		`{"only":["sim-api-ok"],"timeout_ms":1000}`)
	if code != http.StatusAccepted {
		t.Fatalf("filtered run: status %d body %s", code, body)
	}
	var filtered scenrun.Run
	if err := json.Unmarshal([]byte(body), &filtered); err != nil {
		t.Fatalf("filtered decode: %v", err)
	}
	if filtered.Total != 1 {
		t.Fatalf("filtered total: %+v", filtered)
	}

	// unknown scenario id -> 400 naming it
	code, body = callJSON(t, "POST", base+"/api/scenarios/run", `{"only":["sim-nope"]}`)
	if code != http.StatusBadRequest || !strings.Contains(body, "sim-nope") {
		t.Fatalf("unknown id: status %d body %s", code, body)
	}

	// unknown run id -> 404 (valid shape, absent)
	code, _ = callJSON(t, "GET", base+"/api/scenarios/runs/run-0123456789abcdef", "")
	if code != http.StatusNotFound {
		t.Fatalf("unknown run detail: status %d", code)
	}
	// malformed run id -> 400
	code, _ = callJSON(t, "GET", base+"/api/scenarios/runs/nope", "")
	if code != http.StatusBadRequest {
		t.Fatalf("malformed run id: status %d", code)
	}
	// bad body -> 400
	code, _ = callJSON(t, "POST", base+"/api/scenarios/run", "{not json")
	if code != http.StatusBadRequest {
		t.Fatalf("bad body: status %d", code)
	}
	// bad limit -> 400
	code, _ = callJSON(t, "GET", base+"/api/scenarios/runs?limit=x", "")
	if code != http.StatusBadRequest {
		t.Fatalf("bad limit: status %d", code)
	}
}
