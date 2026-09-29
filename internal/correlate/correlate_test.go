package correlate

import (
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/Ruby570bocadito/security-framework/internal/alert"
	"github.com/Ruby570bocadito/security-framework/pkg/model"
)

const seqYAML = `
- name: "Campana de prueba"
  id: "c0a5e7d1-1a2b-4c3d-8e4f-a5b6c7d8e9f0"
  description: "secuencia de test"
  severity: critical
  window: 5m
  tags: ["test"]
  steps:
    - rule: "Regla A"
    - rule: "Regla B"
    - rule: "Regla C"
`

func writeSeq(t *testing.T, body string) string {
	t.Helper()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "seq.yaml"), []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	return dir
}

type collector struct {
	mu     sync.Mutex
	alerts []alert.Alert
}

func (c *collector) emit(a alert.Alert) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.alerts = append(c.alerts, a)
}

func (c *collector) count() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return len(c.alerts)
}

func ev(host string, offset time.Duration) *model.Event {
	return &model.Event{
		ID:        "ev-" + host,
		Type:      model.TypeProcessCreate,
		Timestamp: time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC).Add(offset),
		Host:      host,
		User:      `CORP\jdoe`,
		Process:   &model.Process{PID: 1000, Name: "x.exe"},
	}
}

func TestSequenceCompletesOnSameHost(t *testing.T) {
	var c collector
	m, err := LoadDir(writeSeq(t, seqYAML), c.emit)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if m.Count() != 1 {
		t.Fatalf("sequences = %d, want 1", m.Count())
	}
	m.Observe(ev("H1", 0), "Regla B") // unordered steps
	m.Observe(ev("H1", time.Second), "Regla A")
	m.Observe(ev("H2", time.Second), "Regla C") // other host: no completion
	if c.count() != 0 {
		t.Fatalf("fired early on a different host")
	}
	m.Observe(ev("H1", 2*time.Second), "Regla C")
	if c.count() != 1 {
		t.Fatalf("sequence did not fire, alerts = %d", c.count())
	}
	a := c.alerts[0]
	if a.RuleName != "Campana de prueba" || a.Severity != "critical" || a.Host != "H1" {
		t.Fatalf("unexpected alert: %+v", a)
	}
	if len(a.MatchedOn) != 3 || a.MatchedOn[0] != "Regla A" {
		t.Fatalf("matched_on should list steps in order: %v", a.MatchedOn)
	}
	if a.Enrich == nil {
		t.Log("note: enrichment empty for test events (fine)")
	}
}

func TestWindowExpiryResetsProgress(t *testing.T) {
	var c collector
	m, _ := LoadDir(writeSeq(t, seqYAML), c.emit)
	m.Observe(ev("H1", 0), "Regla A")
	m.Observe(ev("H1", 6*time.Minute), "Regla B") // outside the 5m window
	m.Observe(ev("H1", 6*time.Minute+time.Second), "Regla C")
	if c.count() != 0 {
		t.Fatalf("stale progress completed the sequence")
	}
	// after the reset, a fresh complete set must fire
	m.Observe(ev("H1", 7*time.Minute), "Regla A")
	m.Observe(ev("H1", 7*time.Minute+time.Second), "Regla B")
	m.Observe(ev("H1", 7*time.Minute+2*time.Second), "Regla C")
	if c.count() != 1 {
		t.Fatalf("fresh chain did not fire after expiry reset")
	}
}

func TestReArmAfterCompletion(t *testing.T) {
	var c collector
	m, _ := LoadDir(writeSeq(t, seqYAML), c.emit)
	for round := 0; round < 2; round++ {
		m.Observe(ev("H1", time.Duration(round)*10*time.Minute), "Regla A")
		m.Observe(ev("H1", time.Duration(round)*10*time.Minute+time.Second), "Regla B")
		m.Observe(ev("H1", time.Duration(round)*10*time.Minute+2*time.Second), "Regla C")
	}
	if c.count() != 2 {
		t.Fatalf("re-armed chain should fire again, alerts = %d", c.count())
	}
}

func TestReloadPreservesProgress(t *testing.T) {
	var c collector
	dir := writeSeq(t, seqYAML)
	m, _ := LoadDir(dir, c.emit)
	m.Observe(ev("H1", 0), "Regla A")
	m.Observe(ev("H1", time.Second), "Regla B")
	if err := m.Reload(dir); err != nil {
		t.Fatalf("reload: %v", err)
	}
	m.Observe(ev("H1", 2*time.Second), "Regla C")
	if c.count() != 1 {
		t.Fatalf("reload lost in-flight progress, alerts = %d", c.count())
	}
}

func TestCompileValidation(t *testing.T) {
	cases := []string{
		`- name: "x"
  id: "y"
  severity: high
  steps:
    - rule: "solo uno"
`,
		`- name: "x"
  id: "y"
  severity: apocalyptic
  steps:
    - rule: "a"
    - rule: "b"
`,
		`- name: "x"
  id: "y"
  severity: high
  window: nunca
  steps:
    - rule: "a"
    - rule: "b"
`,
	}
	for i, body := range cases {
		if _, err := LoadDir(writeSeq(t, body), nil); err == nil {
			t.Fatalf("case %d: expected a validation error", i)
		}
	}
}
