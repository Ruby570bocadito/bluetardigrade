package correlate

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
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

// otherSeqYAML is a second, independent sequence (different id and
// steps) used to prove pruning is selective in Reload.
const otherSeqYAML = `
- name: "Cadena ajena"
  id: "bb02c3d4-5e6f-4a7b-8c9d-0e1f2a3b4c5d"
  description: "secuencia independiente de test"
  severity: high
  window: 5m
  steps:
    - rule: "R3"
    - rule: "R4"
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

// TestHostKeyCaseInsensitive: one machine, arbitrary hostname case per
// event — the chain must be shared (same decision suppress.Manager
// already made for the allowlist) and the alert keeps the firing
// event's original casing for display.
func TestHostKeyCaseInsensitive(t *testing.T) {
	var c collector
	m, _ := LoadDir(writeSeq(t, seqYAML), c.emit)
	m.Observe(ev("WEB-01", 0), "Regla A")
	m.Observe(ev("web-01", time.Second), "Regla B")
	m.Observe(ev("Web-01", 2*time.Second), "Regla C")
	if c.count() != 1 {
		t.Fatalf("case variants of one host must share one chain, alerts = %d", c.count())
	}
	if a := c.alerts[0]; a.Host != "Web-01" {
		t.Fatalf("alert host = %q, want the firing event's own casing", a.Host)
	}
}

// TestPipeInHostDoesNotAliasStates is the regression test for the old
// "seqID|host" string key: with sequences "a" and "a|b" on the books, a
// hostile feed sending hosts "b|c" and "c" aliased both onto the same
// progress entry and could advance one sequence's chain with the
// other's steps.
func TestPipeInHostDoesNotAliasStates(t *testing.T) {
	two := `
- name: "S1"
  id: "a"
  severity: high
  window: 5m
  steps:
    - rule: "R1"
    - rule: "R2"
- name: "S2"
  id: "a|b"
  severity: high
  window: 5m
  steps:
    - rule: "R3"
    - rule: "R4"
`
	var c collector
	m, err := LoadDir(writeSeq(t, two), c.emit)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	m.Observe(ev("b|c", 0), "R1")         // S1 progress on host "b|c"
	m.Observe(ev("c", time.Second), "R3") // S2 progress on host "c"
	if len(m.state) != 2 {
		t.Fatalf("states = %d, want 2 (no aliasing between sequences/hosts)", len(m.state))
	}
	m.Observe(ev("b|c", 2*time.Second), "R2")
	if c.count() != 1 {
		t.Fatalf("S1 must complete independently of S2's progress")
	}
	if a := c.alerts[0]; a.RuleName != "S1" {
		t.Fatalf("fired %q, want S1", a.RuleName)
	}
}

// TestReloadPrunesRemovedSequences: progress of a sequence removed from
// disk can never complete, so it must not survive the reload counting
// against maxTrackedStates forever. The surviving sequence must keep
// tracking new hosts and completing chains after the prune.
func TestReloadPrunesRemovedSequences(t *testing.T) {
	dir := t.TempDir()
	fA := filepath.Join(dir, "a.yaml")
	fB := filepath.Join(dir, "b.yaml")
	if err := os.WriteFile(fA, []byte(seqYAML), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(fB, []byte(otherSeqYAML), 0o600); err != nil {
		t.Fatal(err)
	}
	var c collector
	m, _ := LoadDir(dir, c.emit)
	m.Observe(ev("H1", 0), "Regla A") // progress of the doomed sequence
	m.Observe(ev("H2", 0), "R3")      // progress of the surviving one
	if len(m.state) != 2 {
		t.Fatalf("want 2 in-flight states, have %d", len(m.state))
	}
	if err := os.Remove(fA); err != nil {
		t.Fatal(err)
	}
	if err := m.Reload(dir); err != nil {
		t.Fatalf("reload: %v", err)
	}
	if len(m.state) != 1 {
		t.Fatalf("stale state of a removed sequence survived reload (%d entries)", len(m.state))
	}
	// the surviving sequence still tracks NEW hosts...
	m.Observe(ev("H3", 0), "R3")
	if len(m.state) != 2 {
		t.Fatalf("new host not tracked after the prune")
	}
	// ...and still completes chains
	m.Observe(ev("H2", time.Second), "R4")
	if c.count() != 1 {
		t.Fatalf("surviving sequence lost its progress")
	}
	if a := c.alerts[0]; a.RuleName != "Cadena ajena" {
		t.Fatalf("fired %q, want Cadena ajena", a.RuleName)
	}
}

// TestReloadKeepsSurvivingProgress guards the prune against being
// over-eager: sequences still on disk must keep their in-flight
// progress even when OTHER sequences are removed in the same reload.
func TestReloadKeepsSurvivingProgress(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "a.yaml"), []byte(seqYAML), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "b.yaml"), []byte(otherSeqYAML), 0o600); err != nil {
		t.Fatal(err)
	}
	var c collector
	m, _ := LoadDir(dir, c.emit)
	m.Observe(ev("H1", 0), "Regla A")
	m.Observe(ev("H1", time.Second), "R3") // progress of the doomed sequence
	if len(m.state) != 2 {
		t.Fatalf("both sequences should have in-flight progress, have %d", len(m.state))
	}
	if err := os.Remove(filepath.Join(dir, "b.yaml")); err != nil {
		t.Fatal(err)
	}
	if err := m.Reload(dir); err != nil {
		t.Fatalf("reload: %v", err)
	}
	if len(m.state) != 1 {
		t.Fatalf("want only the surviving sequence's state, have %d", len(m.state))
	}
	m.Observe(ev("H1", 2*time.Second), "Regla B")
	m.Observe(ev("H1", 3*time.Second), "Regla C")
	if c.count() != 1 {
		t.Fatalf("surviving sequence lost its in-flight progress")
	}
}

// TestDuplicateSequenceIDRejected: two files claiming the same
// sequence id would silently share one progress entry and fire every
// completion twice — a config bug the load must name, not absorb.
func TestDuplicateSequenceIDRejected(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "a.yaml"), []byte(seqYAML), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "b.yaml"), []byte(seqYAML), 0o600); err != nil {
		t.Fatal(err)
	}
	_, err := LoadDir(dir, nil)
	if err == nil {
		t.Fatalf("duplicate id must be rejected")
	}
	if !strings.Contains(err.Error(), "duplicate id") {
		t.Fatalf("error should name the duplicate id: %v", err)
	}
}

// TestStateCapStopsTrackingNewHosts pins the documented cap behavior:
// past maxTrackedStates the map stops GROWING (new hosts are skipped),
// it never evicts — visibility of already-tracked chains wins.
func TestStateCapStopsTrackingNewHosts(t *testing.T) {
	var c collector
	m, _ := LoadDir(writeSeq(t, seqYAML), c.emit)
	for i := 0; i < maxTrackedStates; i++ {
		m.Observe(ev(fmt.Sprintf("h%d", i), 0), "Regla A")
	}
	if len(m.state) != maxTrackedStates {
		t.Fatalf("states = %d, want %d", len(m.state), maxTrackedStates)
	}
	m.Observe(ev("overflow-host", 0), "Regla A")
	if len(m.state) != maxTrackedStates {
		t.Fatalf("cap must stop new hosts, not grow past %d", maxTrackedStates)
	}
}
