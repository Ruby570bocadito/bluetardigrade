package actions

import (
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/Ruby570bocadito/security-framework/internal/alert"
	"github.com/Ruby570bocadito/security-framework/internal/rules"
	"github.com/Ruby570bocadito/security-framework/pkg/model"
)

func sampleInputs() Inputs {
	return Inputs{
		Host:      "LAB-WKS-01",
		User:      "ana",
		Rule:      "Acceso a memoria de LSASS",
		Severity:  "critical",
		EventType: "process.access",
		Summary:   "mimikatz.exe",
	}
}

func TestRenderSubstitutesEveryPlaceholder(t *testing.T) {
	got := Render("{severity} en {host}: {rule} ({event_type}) por {user} - {summary}", sampleInputs())
	want := "critical en LAB-WKS-01: Acceso a memoria de LSASS (process.access) por ana - mimikatz.exe"
	if got != want {
		t.Fatalf("render = %q, want %q", got, want)
	}
}

func TestRenderMissingUserIsDesconocido(t *testing.T) {
	in := sampleInputs()
	in.User = ""
	got := Render("proceso {user} en {host}", in)
	if got != "proceso desconocido en LAB-WKS-01" {
		t.Fatalf("render = %q, want usuario sustituido por 'desconocido'", got)
	}
}

func TestRenderLeavesUnknownPlaceholdersIntact(t *testing.T) {
	got := Render("checksum {sha256} host {host}", sampleInputs())
	if got != "checksum {sha256} host LAB-WKS-01" {
		t.Fatalf("render = %q; los placeholders desconocidos no deben tocarse", got)
	}
}

func TestRenderEmptyTemplate(t *testing.T) {
	if got := Render("", sampleInputs()); got != "" {
		t.Fatalf("render vacio = %q, want \"\"", got)
	}
}

func TestPrepareRendersMessageAndNotify(t *testing.T) {
	d := New(nil)
	a := alert.Alert{
		Host: "LAB-WKS-01", User: "ana",
		RuleName: "Acceso a memoria de LSASS", Severity: "critical",
		EventType: "process.access", Summary: "mimikatz.exe",
	}
	acts := []rules.Action{
		{Type: "alert", Config: map[string]string{
			"message": "Robo de credenciales en {host} por {user}",
			"notify":  "true",
		}},
	}
	d.Prepare(&a, acts)
	if a.Message != "Robo de credenciales en LAB-WKS-01 por ana" {
		t.Fatalf("message = %q", a.Message)
	}
	if !a.Notify {
		t.Fatal("notify = false, want true")
	}
}

func TestPrepareWithoutActionsLeavesAlertUntouched(t *testing.T) {
	d := New(nil)
	a := alert.Alert{Host: "h", Summary: "s"}
	d.Prepare(&a, nil)
	if a.Message != "" || a.Notify {
		t.Fatalf("alerta modificada sin acciones: message=%q notify=%v", a.Message, a.Notify)
	}
}

func TestWebhookDeliversRenderedAlert(t *testing.T) {
	type received struct {
		auth    string
		body    []byte
		ctype   string
		ua      string
		payload map[string]any
	}
	ch := make(chan received, 1)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		var payload map[string]any
		_ = json.Unmarshal(body, &payload)
		ch <- received{auth: r.Header.Get("Authorization"), body: body, ctype: r.Header.Get("Content-Type"), ua: r.Header.Get("User-Agent"), payload: payload}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer srv.Close()

	d := New(log.New(os.Stderr, "[TEST] ", 0))
	a := alert.Alert{RuleID: "d37e8fa6", RuleName: "Acceso a memoria de LSASS", Severity: "critical", Host: "LAB-WKS-01", Summary: "mimikatz.exe"}
	acts := []rules.Action{
		{Type: "alert", Config: map[string]string{"message": "Robo en {host}", "notify": "true"}},
		{Type: "webhook", Config: map[string]string{"url": srv.URL + "/hook", "secret": "s3cret", "timeout": "2s"}},
	}
	d.Prepare(&a, acts)

	select {
	case got := <-ch:
		if got.auth != "Bearer s3cret" {
			t.Fatalf("authorization = %q, want Bearer s3cret", got.auth)
		}
		if got.ctype != "application/json" {
			t.Fatalf("content-type = %q", got.ctype)
		}
		if !strings.HasPrefix(got.ua, "security-framework") {
			t.Fatalf("user-agent = %q", got.ua)
		}
		if msg, _ := got.payload["message"].(string); msg != "Robo en LAB-WKS-01" {
			t.Fatalf("payload message = %v, want mensaje renderizado", got.payload["message"])
		}
		if notify, _ := got.payload["notify"].(bool); !notify {
			t.Fatalf("payload notify = %v, want true", got.payload["notify"])
		}
		if rule, _ := got.payload["rule_name"].(string); rule != "Acceso a memoria de LSASS" {
			t.Fatalf("payload rule_name = %v", got.payload["rule_name"])
		}
	case <-time.After(3 * time.Second):
		t.Fatal("el webhook no recibio la alerta a tiempo")
	}
}

func TestWebhookServerFailureIsLoggedNotPanic(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	d := New(nil)
	a := alert.Alert{Host: "h"}
	d.Prepare(&a, []rules.Action{{Type: "webhook", Config: map[string]string{"url": srv.URL}}})
	// delivery happens in the background; give it a beat and make sure
	// nothing panics and the process keeps going
	time.Sleep(200 * time.Millisecond)
}

func TestWebhookInvalidURLIsIgnored(t *testing.T) {
	d := New(nil)
	a := alert.Alert{Host: "h"}
	for _, bad := range []string{"", "ftp://x/y", "http://", "javascript:alert(1)", "notaurl"} {
		d.Prepare(&a, []rules.Action{{Type: "webhook", Config: map[string]string{"url": bad}}})
	}
	time.Sleep(100 * time.Millisecond) // nothing should have been dispatched
}

func TestUnknownActionTypeIsIgnored(t *testing.T) {
	d := New(nil)
	a := alert.Alert{Host: "h", Summary: "s"}
	d.Prepare(&a, []rules.Action{
		{Type: "sms", Config: map[string]string{"phone": "123"}},
		{Type: "", Config: nil}, // no-op, must not warn or fail
	})
	if a.Message != "" || a.Notify {
		t.Fatal("accion desconocida altero la alerta")
	}
}

// TestRaisePipelineEndToEnd wires the full engine path: a rule with
// actions fires on a real event through alert.Manager.Raise and the
// webhook receiver gets the rendered alert as JSON.
func TestRaisePipelineEndToEnd(t *testing.T) {
	ch := make(chan map[string]any, 1)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		var payload map[string]any
		_ = json.Unmarshal(body, &payload)
		ch <- payload
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	dir := t.TempDir()
	yaml := `
- name: "Robo de credenciales"
  id: "test-0001"
  severity: critical
  event_type: process.create
  conditions:
    - field: process.name
      operator: eq
      value: "mimikatz.exe"
  actions:
    - type: alert
      config:
        message: "Robo de credenciales en {host} por {user}"
        notify: "true"
    - type: webhook
      config:
        url: "` + srv.URL + `/siem"
  enabled: true
`
	if err := os.WriteFile(filepath.Join(dir, "r.yaml"), []byte(yaml), 0o600); err != nil {
		t.Fatal(err)
	}
	engine, err := rules.LoadDir(dir)
	if err != nil {
		t.Fatalf("LoadDir: %v", err)
	}

	var buf strings.Builder
	alerts := alert.New(&buf, nil)
	alerts.SetPreparer(New(nil).Prepare)

	ev := &model.Event{
		ID:   "ev-1",
		Type: model.TypeProcessCreate,
		Host: "LAB-WKS-01",
		User: "ana",
		Process: &model.Process{
			PID:  4242,
			Name: "mimikatz.exe",
		},
	}
	hits := engine.Evaluate(ev)
	if len(hits) != 1 {
		t.Fatalf("hits = %d, want 1", len(hits))
	}
	alerts.Raise(ev, hits[0])

	// the console JSON line must already carry the rendered message
	if !strings.Contains(buf.String(), "Robo de credenciales en LAB-WKS-01 por ana") {
		t.Fatalf("salida de consola sin mensaje renderizado:\n%s", buf.String())
	}
	// ...and the webhook receiver must get it too
	select {
	case payload := <-ch:
		if msg, _ := payload["message"].(string); msg != "Robo de credenciales en LAB-WKS-01 por ana" {
			t.Fatalf("webhook message = %v", payload["message"])
		}
		if notify, _ := payload["notify"].(bool); !notify {
			t.Fatalf("webhook notify = %v", payload["notify"])
		}
	case <-time.After(3 * time.Second):
		t.Fatal("el webhook no recibio la alerta del pipeline Raise")
	}
}
