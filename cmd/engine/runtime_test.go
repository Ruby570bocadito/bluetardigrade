package main

import (
	"bytes"
	"errors"
	"log"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/suppress"
	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
)

// Hot-reload output: silent while nothing changes, one line per size
// change, one FAILED line per distinct error, and a line on recovery.
func TestReloadReporterOnlyReportsChanges(t *testing.T) {
	var out, logs bytes.Buffer
	prevOut, prevFlags := log.Writer(), log.Flags()
	log.SetOutput(&logs)
	log.SetFlags(0)
	defer func() { log.SetOutput(prevOut); log.SetFlags(prevFlags) }()

	r := reloadReporter{name: "rules", count: 75, out: &out}
	for i := 0; i < 5; i++ {
		r.report(75, nil)
	}
	if out.Len() != 0 {
		t.Fatalf("unchanged reloads printed: %q", out.String())
	}
	r.report(76, nil)
	if strings.Count(out.String(), "rules reloaded (76 active)") != 1 {
		t.Fatalf("size change not announced once: %q", out.String())
	}
	broken := errors.New("rules/x.yaml: yaml: line 3: mapping values are not allowed")
	r.report(76, broken)
	r.report(76, broken)
	if strings.Count(logs.String(), "rules reload FAILED") != 1 {
		t.Fatalf("a persistent error must be logged once: %q", logs.String())
	}
	r.report(76, errors.New("another error"))
	if strings.Count(logs.String(), "rules reload FAILED") != 2 {
		t.Fatalf("a new error must be logged: %q", logs.String())
	}
	out.Reset()
	r.report(76, nil)
	if !strings.Contains(out.String(), "rules reloaded (76 active)") {
		t.Fatalf("recovery not announced: %q", out.String())
	}
	quiet := reloadReporter{name: "rules", count: 1, quiet: true, out: &out}
	out.Reset()
	quiet.report(2, nil)
	if out.Len() != 0 {
		t.Fatalf("interactive panel mode printed: %q", out.String())
	}
}

// Two conditional suppressions for the same rule: the second must be
// tried when the first does not match the event, and an aggregated
// alert (nil event) is silenced only by an unconditional entry.
func TestSuppressedTriesEveryEntryOfTheRule(t *testing.T) {
	path := filepath.Join(t.TempDir(), "suppressions.yaml")
	body := `
- rule_id: r-1
  when:
    - {field: process.command_line, operator: contains, value: "alpha"}
  reason: first shape
- rule_id: r-1
  when:
    - {field: process.command_line, operator: contains, value: "beta"}
  reason: second shape
- rule_id: r-2
  when:
    - {field: process.command_line, operator: contains, value: "alpha"}
  reason: conditional
- rule_id: r-2
  host: SRV-01
  reason: whole host
`
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	m := suppress.New()
	if err := m.LoadFile(path); err != nil {
		t.Fatal(err)
	}
	ev := func(cmd string) *model.Event {
		return &model.Event{Type: model.TypeProcessCreate, Host: "SRV-01",
			Process: &model.Process{PID: 1, Name: "tool.exe", CommandLine: cmd}}
	}
	now := time.Now()
	if !suppressed(m, "r-1", "SRV-01", ev("tool.exe beta"), now) {
		t.Error("the second conditional entry was never evaluated")
	}
	if suppressed(m, "r-1", "SRV-01", ev("tool.exe gamma"), now) {
		t.Error("an invocation no entry names was suppressed")
	}
	if !suppressed(m, "r-2", "SRV-01", ev("tool.exe gamma"), now) {
		t.Error("a conditional entry hid the later unconditional one")
	}
	if suppressed(m, "r-1", "SRV-01", nil, now) || !suppressed(m, "r-2", "SRV-01", nil, now) {
		t.Error("aggregated alerts: only the unconditional entry silences")
	}
	if suppressed(nil, "r-1", "SRV-01", nil, now) {
		t.Error("nil manager means the feature is off")
	}
}
