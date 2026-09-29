package alert

import (
	"strings"
	"testing"
	"time"

	"github.com/Ruby570bocadito/security-framework/internal/rules"
	"github.com/Ruby570bocadito/security-framework/pkg/model"
)

// truncateRunes must cut on rune boundaries: byte slicing corrupted
// command lines containing accented characters (mojibake in alerts).
func TestTruncateRunesKeepsUTF8Intact(t *testing.T) {
	s := "powershell.exe -c Write-Host 'óóóóóóóóóóóóóóóóóóóóóóóóóóóóóóóóóóóóóóóóóóóóóóóóóóóóóóóóóóóóóóóóóóóóóóóóóóóóóóóóóó'"
	got := truncateRunes(s, 80)
	if got == s {
		t.Fatal("truncateRunes did not truncate a long string")
	}
	if n := len([]rune(got)); n != 80 {
		t.Fatalf("truncateRunes produced %d runes, want 80", n)
	}
	// every rune survived: re-decoding must not yield replacement chars
	if strings.ContainsRune(got, '\ufffd') {
		t.Fatal("truncateRunes split a multi-byte sequence (U+FFFD found)")
	}
	if short := "corta"; truncateRunes(short, 80) != short {
		t.Fatal("truncateRunes must return short strings untouched")
	}
}

// summarize renders accented command lines without corrupting them.
func TestSummarizeTruncatesAccentedCommandLine(t *testing.T) {
	acc := strings.Repeat("á", 100)
	ev := &model.Event{Type: model.TypeProcessCreate,
		Process: &model.Process{Name: "cmd.exe", CommandLine: acc}}
	got := summarize(ev)
	if strings.ContainsRune(got, '\ufffd') {
		t.Fatal("summarize corrupted a non-ASCII command line")
	}
	if !strings.HasSuffix(got, "...") {
		t.Fatalf("summarize did not mark the truncation: %q", got)
	}
}

// The dedup map must never exceed the hard cap even under a flood of
// unique host/pid keys, and alerts must keep flowing (no dedup past
// the cap) instead of being silently swallowed.
func TestRaiseDedupMapIsBounded(t *testing.T) {
	m := New(&strings.Builder{}, nil)
	hits := []rules.Hit{{Rule: &rules.Rule{ID: "r1", Name: "n", Severity: rules.SevLow}}}
	for i := 0; i < dedupHardMax+5000; i++ {
		ev := &model.Event{ID: "e", Type: model.TypeProcessCreate, Host: "host-" + strings.Repeat("x", 4)}
		ev.Process = &model.Process{PID: i}
		m.Raise(ev, hits[0])
	}
	if len(m.seen) > dedupHardMax {
		t.Fatalf("dedup map grew to %d entries, cap is %d", len(m.seen), dedupHardMax)
	}
}

// Dedup within the TTL still drops repeated hits for the same key.
func TestRaiseDedupsWithinTTL(t *testing.T) {
	m := New(&strings.Builder{}, nil)
	ev := &model.Event{ID: "e", Type: model.TypeProcessCreate, Host: "h"}
	ev.Process = &model.Process{PID: 42}
	hit := rules.Hit{Rule: &rules.Rule{ID: "r1", Name: "n", Severity: rules.SevLow}}
	m.Raise(ev, hit)
	m.Raise(ev, hit)
	if got := m.seen["r1|h|42"]; time.Since(got) >= dedupTTL {
		t.Fatalf("dedup entry not stored correctly: %v", got)
	}
	// first-seen timestamp must be preserved (second Raise was dropped)
	time.Sleep(5 * time.Millisecond)
	m.Raise(ev, hit)
}
