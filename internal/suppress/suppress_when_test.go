package suppress

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
)

const whenTestRule = "f0de8115"

func whenEvent(cmd string) *model.Event {
	return &model.Event{
		Type:    model.TypeProcessCreate,
		Host:    "LAB-WKS-01",
		Process: &model.Process{PID: 100, Name: "powershell.exe", CommandLine: cmd},
	}
}

func loadWhen(t *testing.T, yaml string) *Manager {
	t.Helper()
	p := filepath.Join(t.TempDir(), "suppressions.yaml")
	if err := os.WriteFile(p, []byte(yaml), 0o600); err != nil {
		t.Fatal(err)
	}
	m := New()
	if err := m.LoadFile(p); err != nil {
		t.Fatalf("LoadFile: %v", err)
	}
	return m
}

// TestWhenMatchesOnlyNamedShape: a conditional entry silences the rule
// for the exact invocation shape it names (the clipboard reader), and a
// DIFFERENT Get-CommandLine still alerts — the §2.3 done-criterion.
func TestWhenMatchesOnlyNamedShape(t *testing.T) {
	m := loadWhen(t, `
- rule_id: `+whenTestRule+`
  host: LAB-WKS-01
  when:
    - field: process.command_line
      operator: eq
      value: 'powershell.exe -NoProfile -Command Get-Clipboard -Raw'
  reason: asistente de desarrollo que lee el portapapeles
`)
	now := time.Now()

	ok, entry := m.SuppressedAt(whenTestRule, "lab-wks-01", now)
	if !ok {
		t.Fatal("entry did not match rule/host at all")
	}
	if !entry.Conditional() {
		t.Fatal("entry should be conditional")
	}
	if !entry.MatchesEvent(whenEvent("powershell.exe -NoProfile -Command Get-Clipboard -Raw")) {
		t.Fatal("the named invocation shape must match")
	}
	if entry.MatchesEvent(whenEvent("powershell.exe -NoProfile -Command Get-Clipboard -Format List")) {
		t.Fatal("a different command line must NOT match — the rule keeps firing there")
	}
}

func TestWhenUnconditionalNilEvent(t *testing.T) {
	m := loadWhen(t, `
- rule_id: `+whenTestRule+`
`)
	_, entry := m.SuppressedAt(whenTestRule, "any", time.Now())
	if entry.Conditional() {
		t.Fatal("plain entry must not be conditional")
	}
	if !entry.MatchesEvent(nil) {
		t.Fatal("unconditional entry matches even without an event (aggregates)")
	}
}

// TestWhenNilEventNeverMatches: aggregated alerts carry no single
// event, so a conditional entry stays inert there — an alert the
// operator still sees, never a lost signal.
func TestWhenNilEventNeverMatches(t *testing.T) {
	m := loadWhen(t, `
- rule_id: `+whenTestRule+`
  when:
    - field: process.name
      operator: ieq
      value: notepad.exe
`)
	_, entry := m.SuppressedAt(whenTestRule, "any", time.Now())
	if entry.MatchesEvent(nil) {
		t.Fatal("a conditional entry must not match a nil event (aggregated alert)")
	}
	match := whenEvent("")
	match.Process.Name = "notepad.exe"
	if !entry.MatchesEvent(match) {
		t.Fatal("sanity: the same entry with a matching event field must match")
	}
}

func TestWhenAndSemantics(t *testing.T) {
	m := loadWhen(t, `
- rule_id: `+whenTestRule+`
  when:
    - field: process.name
      operator: eq
      value: powershell.exe
    - field: enrichment.image_origin
      operator: eq
      value: userland
`)
	_, entry := m.SuppressedAt(whenTestRule, "any", time.Now())
	ev := whenEvent("x")
	ev.Enrichment = map[string]string{"image_origin": "system"} // one condition fails
	if entry.MatchesEvent(ev) {
		t.Fatal("ALL conditions must hold (AND), one failing kills the match")
	}
	ev.Enrichment["image_origin"] = "userland"
	if !entry.MatchesEvent(ev) {
		t.Fatal("both conditions hold now: must match")
	}
}

// TestWhenMissingFieldNeverMatches mirrors the rule-engine contract:
// events without the field never satisfy a condition on it — a
// suppression must not go silent just because a sensor omitted a field.
func TestWhenMissingFieldNeverMatches(t *testing.T) {
	m := loadWhen(t, `
- rule_id: `+whenTestRule+`
  when:
    - field: process.command_line
      operator: contains
      value: Get-Clipboard
`)
	_, entry := m.SuppressedAt(whenTestRule, "any", time.Now())
	ev := whenEvent("")
	ev.Process.CommandLine = "" // no command line at all
	if entry.MatchesEvent(ev) {
		t.Fatal("missing field must never match the condition")
	}
}

func TestWhenUnknownOperatorFailsLoud(t *testing.T) {
	p := filepath.Join(t.TempDir(), "suppressions.yaml")
	yml := `
- rule_id: ` + whenTestRule + `
  when:
    - field: process.name
      operator: matches
      value: x
`
	if err := os.WriteFile(p, []byte(yml), 0o600); err != nil {
		t.Fatal(err)
	}
	err := New().LoadFile(p)
	if err == nil || !strings.Contains(err.Error(), "no soportado") {
		t.Fatalf("unknown operator must fail the load loudly, got %v", err)
	}
}

func TestWhenBadRegexFailsLoud(t *testing.T) {
	p := filepath.Join(t.TempDir(), "suppressions.yaml")
	yml := `
- rule_id: ` + whenTestRule + `
  when:
    - field: process.command_line
      operator: regex
      value: 'Get-Clipboard('
`
	if err := os.WriteFile(p, []byte(yml), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := New().LoadFile(p); err == nil {
		t.Fatal("bad regex in when must fail the load")
	}
}

func TestWhenCaps(t *testing.T) {
	many := make([]Cond, 0, MaxConditions+1)
	for i := 0; i <= MaxConditions; i++ {
		many = append(many, Cond{Field: "process.name", Operator: "eq", Value: "a"})
	}
	if err := ValidateEntry(Entry{RuleID: "r", When: many}); err == nil || !strings.Contains(err.Error(), "cap") {
		t.Fatalf("over-cap conditions must be rejected, got %v", err)
	}
	longField := Entry{RuleID: "r", When: []Cond{{Field: strings.Repeat("a", MaxFieldLen+1), Operator: "eq", Value: "v"}}}
	if err := ValidateEntry(longField); err == nil || !strings.Contains(err.Error(), "field longer") {
		t.Fatalf("over-cap field must be rejected, got %v", err)
	}
	longValue := Entry{RuleID: "r", When: []Cond{{Field: "f", Operator: "eq", Value: strings.Repeat("a", MaxValueLen+1)}}}
	if err := ValidateEntry(longValue); err == nil || !strings.Contains(err.Error(), "value longer") {
		t.Fatalf("over-cap value must be rejected, got %v", err)
	}
	emptyField := Entry{RuleID: "r", When: []Cond{{Field: "", Operator: "eq", Value: "v"}}}
	if err := ValidateEntry(emptyField); err == nil || !strings.Contains(err.Error(), "field is empty") {
		t.Fatalf("empty field must be rejected, got %v", err)
	}
}

// TestWhenSaveFileRoundTrip: the API write surface persists `when`
// through SaveFile and the reload compiles it — the console's
// "suppress this exactly" lives on this path.
func TestWhenSaveFileRoundTrip(t *testing.T) {
	p := filepath.Join(t.TempDir(), "suppressions.yaml")
	in := []Entry{{
		RuleID: whenTestRule,
		Host:   "LAB-WKS-01",
		When: []Cond{
			{Field: "process.command_line", Operator: "eq", Value: "powershell.exe -NoProfile -Command Get-Clipboard -Raw"},
			{Field: "process.name", Operator: "ieq", Value: "powershell.exe"},
		},
		Reason: "exact shape",
	}}
	if err := SaveFile(p, in); err != nil {
		t.Fatalf("SaveFile: %v", err)
	}
	m := New()
	if err := m.LoadFile(p); err != nil {
		t.Fatalf("LoadFile after SaveFile: %v", err)
	}
	ok, entry := m.SuppressedAt(whenTestRule, "lab-wks-01", time.Now())
	if !ok || !entry.Conditional() {
		t.Fatalf("round-trip lost the conditions (ok=%v conditional=%v)", ok, entry.Conditional())
	}
	if !entry.MatchesEvent(whenEvent("powershell.exe -NoProfile -Command Get-Clipboard -Raw")) {
		t.Fatal("round-trip conditions do not match their own shape")
	}
	// the snapshot the API serves carries the conditions verbatim
	snap := m.Snapshot(time.Now())
	if len(snap) != 1 || len(snap[0].When) != 2 || snap[0].When[0].Field != "process.command_line" {
		t.Fatalf("snapshot lost/mangled when: %+v", snap)
	}
}

func TestWhenExpiredDoesNotMatch(t *testing.T) {
	m := loadWhen(t, `
- rule_id: `+whenTestRule+`
  when:
    - field: process.name
      operator: eq
      value: powershell.exe
  expires: 2020-01-01T00:00:00Z
`)
	ok, _ := m.SuppressedAt(whenTestRule, "any", time.Now())
	if ok {
		t.Fatal("an expired conditional entry must not match (like any expired entry)")
	}
}
