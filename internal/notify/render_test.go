package notify

import (
	"strings"
	"testing"
)

func TestSeverityRankLadder(t *testing.T) {
	cases := map[string]int{
		"info":     rankInfo,
		"low":      rankLow,
		"medium":   rankMedium,
		"high":     rankHigh,
		"critical": rankCritical,
		"banana":   rankInfo - 1,
		"":         rankInfo - 1,
	}
	for sev, want := range cases {
		if got := severityRank(sev); got != want {
			t.Fatalf("severityRank(%q) = %d, want %d", sev, got, want)
		}
	}
	if parseSeverity("") != rankAny {
		t.Fatal("empty min_severity must map to rankAny (no floor)")
	}
	if !validSeverity("critical") || validSeverity("extreme") {
		t.Fatal("validSeverity contract broken")
	}
}

func TestRenderTextShape(t *testing.T) {
	a := sampleAlert()
	want := "[CRITICAL] LSASS dump via comsvcs @ LAB-WKS-01 — rundll32.exe requested MiniDump of lsass (user: alice)"
	if got := renderText(a); got != want {
		t.Fatalf("renderText =\n  %q\nwant\n  %q", got, want)
	}

	a.User = ""
	if strings.Contains(renderText(a), "user:") {
		t.Fatal("missing user must be omitted, not rendered as a placeholder")
	}

	a.Summary = ""
	got := renderText(a)
	if !strings.Contains(got, " — process.create") {
		t.Fatalf("missing summary must fall back to event type: %q", got)
	}
}

func TestTruncateIsRuneSafe(t *testing.T) {
	s := strings.Repeat("á", 100)
	got := truncate(s, 50)
	if runes := len([]rune(got)); runes != 50 {
		t.Fatalf("truncate produced %d runes, want 50", runes)
	}
	if !strings.HasSuffix(got, "…") {
		t.Fatal("clamped string must carry an ellipsis")
	}
	if short := truncate("short", 50); short != "short" {
		t.Fatalf("short strings must pass through untouched, got %q", short)
	}
	// The classic byte-cut bug: cutting mid-rune yields invalid UTF-8.
	if got := truncate("áááá", 2); !strings.Contains(got, "á") {
		t.Fatalf("rune-unsafe cut: %q", got)
	}
}

func TestMailBodyCarriesFullPayload(t *testing.T) {
	body := renderMailBody(sampleAlert())
	for _, want := range []string{
		"[CRITICAL] LSASS dump via comsvcs @ LAB-WKS-01",
		"---\n",
		`"id":"LAB-0001"`,
		`"severity":"critical"`,
	} {
		if !strings.Contains(body, want) {
			t.Fatalf("mail body missing %q", want)
		}
	}
}
