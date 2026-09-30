package api

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/Ruby570bocadito/security-framework/internal/respond"
)

// respondSleeper starts a real `sleep 30` (the same helper pattern the
// respond tests use) and waits for its image link.
func respondSleeper(t *testing.T) *exec.Cmd {
	t.Helper()
	cmd := exec.Command("sleep", "30")
	if err := cmd.Start(); err != nil {
		t.Skipf("cannot spawn sleep: %v", err)
	}
	t.Cleanup(func() {
		if cmd.Process != nil {
			_ = cmd.Process.Kill()
			_ = cmd.Wait()
		}
	})
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if _, err := os.Readlink("/proc/" + strconv.Itoa(cmd.Process.Pid) + "/exe"); err == nil {
			return cmd
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("sleeper image link never resolved")
	return nil
}

func respondHostNameForTest() string {
	hn, err := os.Hostname()
	if err != nil || hn == "" {
		return "localhost"
	}
	return hn
}

// armedRespondHub builds a hub with an armed kill surface (token off:
// the bearer layer is the middleware's job and is covered elsewhere)
// and an operators allowlist with one name.
func armedRespondHub(t *testing.T) string {
	t.Helper()
	h, base := newTestHub(t)
	a, err := respond.OpenAudit(filepath.Join(t.TempDir(), "audit.jsonl"))
	if err != nil {
		t.Fatalf("OpenAudit: %v", err)
	}
	t.Cleanup(func() { _ = a.Close() })
	m := respond.NewManager(respondHostNameForTest(), a)
	f := filepath.Join(t.TempDir(), "ops.yaml")
	if err := os.WriteFile(f, []byte("version: 1\nnames:\n  - ana\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := m.LoadOperators(f); err != nil {
		t.Fatalf("LoadOperators: %v", err)
	}
	h.EnableRespondKill(m)
	return base
}

// postKill posts one kill request and returns status, decoded body
// and the raw body (drained before close).
func postKill(t *testing.T, base string, body any) (int, map[string]any, string) {
	t.Helper()
	raw, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	res, err := http.Post("http://"+base+"/api/respond/kill", "application/json", bytes.NewReader(raw))
	if err != nil {
		t.Fatalf("POST: %v", err)
	}
	defer res.Body.Close()
	data, err := io.ReadAll(res.Body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	var out map[string]any
	if len(data) > 0 {
		_ = json.Unmarshal(data, &out)
	}
	return res.StatusCode, out, string(data)
}

// disarmed: the route answers a REAL 404, identical to any unknown
// path — no 403/405 hint of a hidden surface (design §2.1).
func TestRespondKillDisarmedIsReal404(t *testing.T) {
	_, base := newTestHub(t)
	res, err := http.Post("http://"+base+"/api/respond/kill", "application/json", strings.NewReader("{}"))
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusNotFound {
		t.Fatalf("disarmed kill must be 404, got %d", res.StatusCode)
	}
}

// structural mistakes are 400 and never reach the manager.
func TestRespondKillStructural400(t *testing.T) {
	base := armedRespondHub(t)
	code, _, _ := postKill(t, base, map[string]any{"pid": 4242})
	if code != http.StatusBadRequest {
		t.Fatalf("missing host must be 400, got %d", code)
	}
	code2, _, _ := postKill(t, base, map[string]any{"host": "x", "pid": 1, "operator": "ana", "reason": "r"})
	if code2 != http.StatusBadRequest {
		t.Fatalf("missing process_name must be 400, got %d", code2)
	}
}

// happy path: 200 (NOT 202 — R7a), executed, action_id + mechanism,
// the process really dies.
func TestRespondKillExecuted(t *testing.T) {
	base := armedRespondHub(t)
	cmd := respondSleeper(t)
	code, out, _ := postKill(t, base, map[string]any{
		"host":         respondHostNameForTest(),
		"pid":          cmd.Process.Pid,
		"process_name": "sleep",
		"operator":     "ana",
		"reason":       "api test",
		"rule_id":      "thr-test",
	})
	if code != http.StatusOK {
		t.Fatalf("want 200 (R7a: sync contract, never 202), got %d (%v)", code, out)
	}
	if out["status"] != "executed" || out["signal"] != "SIGKILL" {
		t.Fatalf("bad payload: %v", out)
	}
	if id, _ := out["action_id"].(string); len(id) != 32 {
		t.Fatalf("action_id missing: %v", out)
	}
	if mech, _ := out["mechanism"].(string); mech != "pidfd" && mech != "fallback" {
		t.Fatalf("mechanism must be recorded (R1): %v", out)
	}
	// reap the killed child (SIGKILL leaves a zombie until Wait);
	// timeout = the signal did not land
	done := make(chan struct{})
	go func() { _ = cmd.Wait(); close(done) }()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("target survived an executed kill")
	}
}

// a semantic denial reaches the client with the manager's code.
func TestRespondKillDeniedOperator(t *testing.T) {
	base := armedRespondHub(t)
	code, out, _ := postKill(t, base, map[string]any{
		"host":         respondHostNameForTest(),
		"pid":          4242,
		"process_name": "sleep",
		"operator":     "eve",
		"reason":       "not allowlisted",
	})
	if code != http.StatusForbidden || out["error"] != "operator_not_allowed" {
		t.Fatalf("want 403 operator_not_allowed, got %d (%v)", code, out)
	}
}

// R3 through the wire: a remote host label never becomes a local kill.
func TestRespondKillHostMismatch(t *testing.T) {
	base := armedRespondHub(t)
	code, out, _ := postKill(t, base, map[string]any{
		"host":         "some-other-host",
		"pid":          4242,
		"process_name": "sleep",
		"operator":     "ana",
		"reason":       "remote replay",
	})
	if code != http.StatusForbidden || out["error"] != "host_mismatch" {
		t.Fatalf("want 403 host_mismatch, got %d (%v)", code, out)
	}
}
