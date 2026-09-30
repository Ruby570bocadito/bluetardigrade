package alert

import (
	"strings"
	"testing"

	"github.com/Ruby570bocadito/security-framework/internal/rules"
)

// The ANSI constants were corrupted once (round 1 of the audit): every
// constant held the bare ESC byte with no SGR parameters, so the colored
// console line emitted raw ESC garbage instead of colors. These tests
// pin the EXACT escape sequences by literal value — they must fail if
// the constants are ever stripped again. The expected sequences are
// built by CONCATENATION (esc + "[35m", not "\x1b[35m" in one literal)
// so that the same class of bracket-stripping corruption cannot silently
// rewrite the expectations either.

const esc = "\x1b"

// expectedConsoleLine renders the exact bytes writeConsole must emit for
// a colored alert of the given severity color/bold combination.
func expectedConsoleLine(bold, color, ruleID, summary, host string) string {
	name := color
	if bold != "" {
		name = bold + color
	}
	return name + "[ALERT]" + esc + "[0m" + " " +
		color + "CRITICAL" + esc + "[0m" + " " +
		esc + "[90m" + ruleID + esc + "[0m" + " " +
		summary + " " +
		esc + "[90m" + "host=" + host + esc + "[0m" + "\n"
}

func renderColored(t *testing.T, severity string) string {
	t.Helper()
	b := &strings.Builder{}
	m := &Manager{out: b, colored: true} // direct literal: bypasses isTerminal
	m.writeConsole(Alert{
		RuleID:   "rule-1",
		Severity: severity,
		Host:     "lab",
		Summary:  "sum",
	})
	return b.String()
}

// TestColoredConsoleLineExactBytes pins the full colored line for the
// critical severity: bold+magenta on the [ALERT] tag, magenta on the
// severity word, grey on rule id and host, and a real SGR reset after
// each colored run. Pre-fix (bare ESC constants) this failed on the very
// first assertion: no "[35m" / "[1m" / "[0m" bytes existed in the output.
func TestColoredConsoleLineExactBytes(t *testing.T) {
	got := renderColored(t, rules.SevCritical)
	want := expectedConsoleLine(esc+"[1m", esc+"[35m", "rule-1", "sum", "lab")
	if got != want {
		t.Fatalf("colored console line wrong.\n got: %q\nwant: %q", got, want)
	}
}

// TestSeverityColorSequences pins every severity to its documented SGR
// sequence, so a corrupted constant cannot pass by luck on one branch.
func TestSeverityColorSequences(t *testing.T) {
	cases := []struct {
		severity string
		bold     string
		color    string
	}{
		{rules.SevCritical, esc + "[1m", esc + "[35m"},
		{rules.SevHigh, esc + "[1m", esc + "[31m"},
		{rules.SevMedium, "", esc + "[33m"},
		{rules.SevLow, "", esc + "[36m"},
		{"desconocida", "", esc + "[90m"}, // default branch: grey
	}
	for _, c := range cases {
		color, name := severityColor(c.severity)
		wantName := c.color
		if c.bold != "" {
			wantName = c.bold + c.color
		}
		if color != c.color || name != wantName {
			t.Errorf("severity %q: got (%q, %q), want (%q, %q)",
				c.severity, color, name, c.color, wantName)
		}
	}
}

// TestPlainConsoleLineUnchanged guards the non-colored branch: the plain
// line must never carry escape bytes at all.
func TestPlainConsoleLineUnchanged(t *testing.T) {
	b := &strings.Builder{}
	m := &Manager{out: b, colored: false}
	m.writeConsole(Alert{RuleID: "rule-1", Severity: "critical", Host: "lab", Summary: "sum"})
	got := b.String()
	if strings.ContainsRune(got, '\x1b') {
		t.Fatalf("plain console line carries escape bytes: %q", got)
	}
	want := "[ALERT] CRITICAL rule-1 sum host=lab\n"
	if got != want {
		t.Fatalf("plain console line changed.\n got: %q\nwant: %q", got, want)
	}
}
