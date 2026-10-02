package main

import (
	"bytes"
	"errors"
	"log"
	"strings"
	"testing"
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
