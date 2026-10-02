package correlate

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/alert"
	"github.com/Ruby570bocadito/bluetardigrade/internal/rules"
	"github.com/Ruby570bocadito/bluetardigrade/internal/yamlcheck"
	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
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

// TestStatesCountsInFlight pins the /api/stats contract source: States()
// returns live (sequence, host) chains, completions and re-arms release
// them, and MaxTrackedStates is the exported view of the cap.
func TestStatesCountsInFlight(t *testing.T) {
	var c collector
	m, _ := LoadDir(writeSeq(t, seqYAML), c.emit)
	if m.States() != 0 {
		t.Fatalf("fresh manager must report 0 in-flight states, got %d", m.States())
	}
	m.Observe(ev("H1", 0), "Regla A")
	m.Observe(ev("H2", 0), "Regla A")
	if m.States() != 2 {
		t.Fatalf("two partial chains must report 2 states, got %d", m.States())
	}
	// completion deletes the (sequence, host) state (re-arm)
	m.Observe(ev("H1", time.Second), "Regla B")
	m.Observe(ev("H1", 2*time.Second), "Regla C")
	if m.States() != 1 {
		t.Fatalf("completed chain must release its state, got %d", m.States())
	}
	if c.count() != 1 {
		t.Fatalf("completion must fire exactly once, got %d", c.count())
	}
	if MaxTrackedStates != maxTrackedStates || MaxTrackedStates <= 0 {
		t.Fatalf("MaxTrackedStates must mirror the internal cap, got %d", MaxTrackedStates)
	}
}

// ---- load-time hardening (ronda 2026-09-30) ----------------------------

// TestLoadRejectsOversizedFile: os.ReadFile has no bound, so the size
// check must fire BEFORE the read — a multi-gigabyte sequence file is
// a config bug, not something to read whole into memory first.
func TestLoadRejectsOversizedFile(t *testing.T) {
	dir := t.TempDir()
	big := bytes.Repeat([]byte("# padding\n"), (maxFileBytes/10)+1)
	if err := os.WriteFile(filepath.Join(dir, "big.yaml"), big, 0o600); err != nil {
		t.Fatal(err)
	}
	_, err := LoadDir(dir, nil)
	if err == nil || !strings.Contains(err.Error(), "byte cap") {
		t.Fatalf("oversized file must be rejected naming the cap, got: %v", err)
	}
}

// TestLoadRejectsDeepNesting: yaml.v3 decodes recursively and flow
// nesting costs 1 byte per level, so a tiny file can attempt stack
// exhaustion (a process crash, not a config error). The byte-level
// pre-scan must reject it loudly.
func TestLoadRejectsDeepNesting(t *testing.T) {
	dir := t.TempDir()
	deep := strings.Repeat("[", yamlcheck.MaxNestingDepth+1)
	if err := os.WriteFile(filepath.Join(dir, "deep.yaml"), []byte(deep), 0o600); err != nil {
		t.Fatal(err)
	}
	_, err := LoadDir(dir, nil)
	if err == nil || !strings.Contains(err.Error(), "nesting deeper") {
		t.Fatalf("deep nesting must be rejected, got: %v", err)
	}
}

// TestLoadRejectsTooManySequences: Observe walks EVERY sequence on
// each rule hit, so the loaded set size bounds the per-hit cost by
// construction. More than the cap is a config bug the load names.
func TestLoadRejectsTooManySequences(t *testing.T) {
	dir := t.TempDir()
	var b strings.Builder
	for i := 0; i <= maxSequences; i++ {
		fmt.Fprintf(&b, "- name: \"s%d\"\n  id: \"id-%d\"\n  severity: low\n  steps:\n    - rule: \"a%d\"\n    - rule: \"b%d\"\n", i, i, i, i)
	}
	if err := os.WriteFile(filepath.Join(dir, "many.yaml"), []byte(b.String()), 0o600); err != nil {
		t.Fatal(err)
	}
	_, err := LoadDir(dir, nil)
	if err == nil || !strings.Contains(err.Error(), "load cap") {
		t.Fatalf("sequence count must be capped, got: %v", err)
	}
}

// TestLoadRejectsTooManySteps: the other half of the per-hit cost
// bound — one chain with a huge step list scans every step per hit.
func TestLoadRejectsTooManySteps(t *testing.T) {
	dir := t.TempDir()
	var b strings.Builder
	b.WriteString("- name: \"wide\"\n  id: \"wide-1\"\n  severity: low\n  steps:\n")
	for i := 0; i <= maxStepsPerSequence; i++ {
		fmt.Fprintf(&b, "    - rule: \"r%d\"\n", i)
	}
	if err := os.WriteFile(filepath.Join(dir, "wide.yaml"), []byte(b.String()), 0o600); err != nil {
		t.Fatal(err)
	}
	_, err := LoadDir(dir, nil)
	if err == nil || !strings.Contains(err.Error(), "step cap") {
		t.Fatalf("step count must be capped, got: %v", err)
	}
}

// TestCompileRejectsAbsurdWindow: a window that never passes pins one
// tracked state per host until maxTrackedStates is exhausted — the
// silent detection loss the cap exists to prevent. The load must name
// the abuse instead of absorbing it.
func TestCompileRejectsAbsurdWindow(t *testing.T) {
	body := `
- name: "eterno"
  id: "eterno-1"
  severity: high
  window: 87600h
  steps:
    - rule: "a"
    - rule: "b"
`
	_, err := LoadDir(writeSeq(t, body), nil)
	if err == nil || !strings.Contains(err.Error(), "cap") {
		t.Fatalf("window over maxWindow must be rejected, got: %v", err)
	}
}

// TestIdentitySanity: ids, names, tags and step rules reach logs, the
// console and webhook consumers through every alert — bounded length
// and zero control runes (a \x1b would be terminal injection into the
// engine's own log output; a \n would forge log lines). Descriptions
// never leave the process, so only their length is bounded.
func TestIdentitySanity(t *testing.T) {
	cases := []struct {
		name string
		body string
		want string
	}{
		{"id over rune cap", "- name: \"x\"\n  id: \"" + strings.Repeat("i", maxIDRunes+1) + "\"\n  severity: high\n  steps:\n    - rule: \"a\"\n    - rule: \"b\"\n", "rune cap"},
		{"id with ANSI escape", "- name: \"x\"\n  id: \"\\u001b[31mevil\"\n  severity: high\n  steps:\n    - rule: \"a\"\n    - rule: \"b\"\n", "control rune"},
		{"name with newline", "- name: \"x\\n[FAKE LOG LINE]\"\n  id: \"ok\"\n  severity: high\n  steps:\n    - rule: \"a\"\n    - rule: \"b\"\n", "control rune"},
		{"tag with control rune", "- name: \"x\"\n  id: \"ok\"\n  severity: high\n  tags: [\"a\\x07b\"]\n  steps:\n    - rule: \"a\"\n    - rule: \"b\"\n", "control rune"},
		{"step rule with control rune", "- name: \"x\"\n  id: \"ok\"\n  severity: high\n  steps:\n    - rule: \"a\\tb\"\n    - rule: \"b\"\n", "control rune"},
		{"description over cap", "- name: \"x\"\n  id: \"ok\"\n  description: \"" + strings.Repeat("d", maxDescriptionRunes+1) + "\"\n  severity: high\n  steps:\n    - rule: \"a\"\n    - rule: \"b\"\n", "rune cap"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := LoadDir(writeSeq(t, tc.body), nil)
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("want error containing %q, got: %v", tc.want, err)
			}
		})
	}
}

// TestTooManyTagsRejected: the tag list is copied into every emitted
// alert, so both the count and each tag's length are capped.
func TestTooManyTagsRejected(t *testing.T) {
	tags := make([]string, maxTags+1)
	for i := range tags {
		tags[i] = fmt.Sprintf("\"t%d\"", i)
	}
	body := "- name: \"x\"\n  id: \"ok\"\n  severity: high\n  tags: [" + strings.Join(tags, ",") + "]\n  steps:\n    - rule: \"a\"\n    - rule: \"b\"\n"
	_, err := LoadDir(writeSeq(t, body), nil)
	if err == nil || !strings.Contains(err.Error(), "tag cap") {
		t.Fatalf("tag count must be capped, got: %v", err)
	}
}

// TestStepsWithoutRule: the config-drift report feeds the engine's
// WARNING — sorted, deduplicated, and empty when everything resolves.
func TestStepsWithoutRule(t *testing.T) {
	var c collector
	m, _ := LoadDir(writeSeq(t, seqYAML), c.emit) // steps: Regla A/B/C
	missing := m.StepsWithoutRule(map[string]bool{"Regla A": true, "Regla B": true, "Extra": true})
	if len(missing) != 1 || missing[0] != "Regla C" {
		t.Fatalf("missing = %v, want [Regla C]", missing)
	}
	all := m.StepsWithoutRule(map[string]bool{"Regla A": true, "Regla B": true, "Regla C": true})
	if len(all) != 0 {
		t.Fatalf("fully-resolved steps must report nothing, got %v", all)
	}
}

// TestShippedSequencesStillLoad pins the shipped config against the new
// load-time caps AND cross-checks every step against the shipped rules:
// a step naming a rule that does not exist is exactly the drift the
// StepsWithoutRule WARNING exists to catch, and the shipped tree must
// never ship with it.
func TestShippedSequencesStillLoad(t *testing.T) {
	seqDir := filepath.Join("..", "..", "sequences")
	if _, err := os.Stat(seqDir); err != nil {
		t.Skip("shipped sequences dir not present")
	}
	m, err := LoadDir(seqDir, nil)
	if err != nil {
		t.Fatalf("shipped sequences must load under the new caps: %v", err)
	}
	if m.Count() != 4 {
		t.Fatalf("shipped sequences = %d, want 4", m.Count())
	}
	eng, err := rules.LoadDir(filepath.Join("..", "..", "rules"))
	if err != nil {
		t.Skipf("shipped rules dir not loadable here: %v", err)
	}
	known := map[string]bool{}
	for _, r := range eng.Snapshot() {
		known[r.Name] = true
	}
	if missing := m.StepsWithoutRule(known); len(missing) != 0 {
		t.Fatalf("shipped sequences reference rules that do not exist: %v", missing)
	}
}

// ---- window semantics over event times (review 2026-10-02) -------------

// A stale early hit of one step must not anchor the window: the real
// hit of that step inside the window refreshes it, and the chain fires
// when the three real steps fit in the window.
func TestStaleEarlyHitDoesNotAnchorWindow(t *testing.T) {
	var c collector
	m, _ := LoadDir(writeSeq(t, seqYAML), c.emit)
	m.Observe(ev("H1", 0), "Regla A")                            // benign, old
	m.Observe(ev("H1", 4*time.Minute), "Regla A")                // real step A
	m.Observe(ev("H1", 5*time.Minute+30*time.Second), "Regla B") // real B
	m.Observe(ev("H1", 6*time.Minute), "Regla C")                // A..C span 2m
	if c.count() != 1 {
		t.Fatalf("A,B,C inside 2 minutes must fire a 5m chain, alerts = %d", c.count())
	}
	if !strings.Contains(c.alerts[0].Summary, "2m0s") {
		t.Fatalf("summary must report the real 2m span: %q", c.alerts[0].Summary)
	}
}

// An event older than the recorded progress (offline import, skewed
// clock) must not complete a chain whose steps are far apart in time.
func TestOutOfOrderEventDoesNotStitchDistantSteps(t *testing.T) {
	var c collector
	m, _ := LoadDir(writeSeq(t, seqYAML), c.emit)
	m.Observe(ev("H1", 72*time.Hour), "Regla A")
	m.Observe(ev("H1", 0), "Regla B") // three days earlier
	m.Observe(ev("H1", 72*time.Hour+time.Second), "Regla C")
	if c.count() != 0 {
		t.Fatalf("steps three days apart completed a 5m chain")
	}
	// a fresh B inside the window completes it
	m.Observe(ev("H1", 72*time.Hour+2*time.Second), "Regla B")
	if c.count() != 1 {
		t.Fatalf("in-window B must complete the chain, alerts = %d", c.count())
	}
}

// A late, OLDER hit of an already-matched step must not push recorded
// progress back in time.
func TestOlderHitDoesNotRewindStep(t *testing.T) {
	var c collector
	m, _ := LoadDir(writeSeq(t, seqYAML), c.emit)
	m.Observe(ev("H1", 10*time.Minute), "Regla A")
	m.Observe(ev("H1", 0), "Regla A") // late arrival, older
	m.Observe(ev("H1", 11*time.Minute), "Regla B")
	m.Observe(ev("H1", 12*time.Minute), "Regla C")
	if c.count() != 1 {
		t.Fatalf("older duplicate rewound step A, alerts = %d", c.count())
	}
}

// Chains whose window elapsed on the wall clock are reclaimed: by the
// periodic Sweep, and on admission when the cap is full, so long
// uptimes do not silently stop correlation for new hosts.
func TestExpiredStatesAreReclaimed(t *testing.T) {
	var c collector
	m, _ := LoadDir(writeSeq(t, seqYAML), c.emit)
	wall := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	m.now = func() time.Time { return wall }
	for i := 0; i < maxTrackedStates; i++ {
		m.Observe(ev(fmt.Sprintf("h%d", i), 0), "Regla A")
	}
	if m.States() != maxTrackedStates {
		t.Fatalf("states = %d, want the cap", m.States())
	}
	wall = wall.Add(6 * time.Minute) // past the 5m window
	m.Observe(ev("late-host", 6*time.Minute), "Regla A")
	if m.States() != 1 {
		t.Fatalf("admission at the cap must reclaim expired states, states = %d", m.States())
	}
	wall = wall.Add(6 * time.Minute)
	if n := m.Sweep(wall); n != 1 || m.States() != 0 {
		t.Fatalf("Sweep removed %d, states left %d; want 1 and 0", n, m.States())
	}
}
