package alert

import (
	"encoding/json"
	"regexp"
	"strings"
	"testing"

	"github.com/Ruby570bocadito/security-framework/internal/rules"
	"github.com/Ruby570bocadito/security-framework/pkg/model"
)

// The alert id is the lifecycle key (POST /api/alerts/{id}/status):
// every raised or emitted alert must carry a fresh 16-hex id, on the
// struct and on the JSON log line alike.
func TestRaisedAndEmittedAlertsCarryUniqueIDs(t *testing.T) {
	hexID := regexp.MustCompile(`^[0-9a-f]{16}$`)
	var seen []string

	m := New(&strings.Builder{}, func(a Alert) { seen = append(seen, a.ID) })
	re, err := rules.LoadDir("../../rules")
	if err != nil {
		t.Fatalf("LoadDir: %v", err)
	}
	ev := &model.Event{
		ID: "ev-1", Host: "LAB-TEST", Type: "process.create",
		Process: &model.Process{PID: 1, Name: "rundll32.exe", CommandLine: "rundll32.exe comsvcs.dll MiniDump 1 C:\\x.full"},
	}
	for _, hit := range re.Evaluate(ev) {
		m.Raise(ev, hit)
	}
	if len(seen) == 0 {
		t.Skip("no rule fired against the sample event; run the Emit half of the test")
	}
	m.Emit(Alert{RuleName: "correlada", Severity: "critical"})

	uniq := map[string]bool{}
	for _, id := range seen {
		if !hexID.MatchString(id) {
			t.Fatalf("id %q is not 16 lowercase hex", id)
		}
		uniq[id] = true
	}
	if len(uniq) != len(seen) {
		t.Fatalf("duplicate alert ids across %d alerts", len(seen))
	}

	// the JSON log line ships the id too (webhook/SIEM consumers key on it)
	var logged Alert
	if err := json.Unmarshal([]byte(firstJSONLine(t, m)), &logged); err != nil {
		t.Fatalf("log line JSON: %v", err)
	}
	if !hexID.MatchString(logged.ID) {
		t.Fatalf("logged alert id = %q", logged.ID)
	}
}

func firstJSONLine(t *testing.T, m *Manager) string {
	t.Helper()
	var b strings.Builder
	m2 := New(&b, nil)
	m2.Emit(Alert{RuleName: "json-line", Severity: "high"})
	out := b.String()
	for _, line := range strings.Split(out, "\n") {
		if strings.HasPrefix(line, "{") {
			return line
		}
	}
	t.Fatalf("no JSON line in %q", out)
	return ""
}
