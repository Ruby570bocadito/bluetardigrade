package alert

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
)

func TestConsoleCannotForgeLinesAndJSONPreservesEvidence(t *testing.T) {
	var out bytes.Buffer
	m := New(&out, nil)
	m.colored = false
	a := Alert{Severity: "high", RuleID: "r1\nforged", Host: "lab\rfake", Summary: "\x1b[2Jevil\n[ALERT] fake"}
	m.writeConsole(a)
	if strings.Count(out.String(), "\n") != 1 || strings.ContainsAny(out.String(), "\x1b\r") {
		t.Fatalf("terminal injection survived: %q", out.String())
	}
	out.Reset()
	m.writeJSON(a)
	var decoded Alert
	if err := json.Unmarshal(out.Bytes(), &decoded); err != nil || decoded.Summary != a.Summary || decoded.Host != a.Host {
		t.Fatalf("structured evidence was modified: %+v (%v)", decoded, err)
	}
}
