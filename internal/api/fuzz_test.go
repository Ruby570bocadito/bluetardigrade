package api

// SEC-7 (fuzzing of the input surfaces): fuzz targets for the shared
// query filters of the telemetry endpoints. `go test` runs the seed
// corpus.
//
// Properties under fuzz:
//   - splitCSV never panics, never yields an empty or unpadded item,
//     and returns nil for a blank input.
//   - parseTimeParam never panics; an accepted RFC 3339 value
//     round-trips, an accepted duration is positive and lands in the
//     past, and only an empty value yields the zero time.
//   - parseRecordFilter over arbitrary query strings never panics and
//     either answers 400 or a filter whose matching helpers answer
//     without panic for representative records; any severity it keeps
//     is one of the five rule severities.

import (
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
	"unicode"

	"github.com/Ruby570bocadito/bluetardigrade/internal/alert"
	"github.com/Ruby570bocadito/bluetardigrade/internal/rules"
	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
)

func FuzzSplitCSV(f *testing.F) {
	f.Add("info,low,medium,high,critical")
	f.Add("low")
	f.Add(" low , HIGH ")
	f.Add("a,,b")
	f.Add(",")
	f.Add("")
	f.Add("   ")
	f.Add(",,")

	f.Fuzz(func(t *testing.T, s string) {
		got := splitCSV(s)
		if strings.TrimSpace(s) == "" {
			if got != nil {
				t.Fatalf("splitCSV(%q) = %v, want nil for blank input", s, got)
			}
			return
		}
		for _, item := range got {
			if item == "" {
				t.Fatalf("splitCSV(%q) yielded an empty item", s)
			}
			if item != strings.TrimSpace(item) {
				t.Fatalf("splitCSV(%q) yielded an unpadded item %q", s, item)
			}
		}
	})
}

func FuzzParseTimeParam(f *testing.F) {
	f.Add("2026-09-30T12:00:00Z")
	f.Add("2026-09-30T12:00:00+02:00")
	f.Add("90m")
	f.Add("24h")
	f.Add("2h45m")
	f.Add("+90m")
	f.Add("-90m")
	f.Add("0s")
	f.Add("1e100h")
	f.Add("")
	f.Add("   ")
	f.Add("yesterday")
	f.Add("2026-13-40")

	f.Fuzz(func(t *testing.T, s string) {
		got, err := parseTimeParam(s)
		if err != nil {
			if !strings.Contains(err.Error(), strings.TrimSpace(s)) {
				t.Fatalf("parseTimeParam(%q) error %q does not name the offending value", s, err)
			}
			return
		}
		if s == "" || strings.TrimSpace(s) == "" {
			if !got.IsZero() {
				t.Fatalf("parseTimeParam(%q) returned a non-zero time for a blank input", s)
			}
			return
		}
		if t2, err2 := time.Parse(time.RFC3339, strings.TrimSpace(s)); err2 == nil {
			if !got.Equal(t2) {
				t.Fatalf("parseTimeParam(%q) = %v, want the parsed RFC 3339 value %v", s, got, t2)
			}
			return
		}
		if d, err2 := time.ParseDuration(strings.TrimSpace(s)); err2 == nil && d > 0 {
			if !got.Before(time.Now()) {
				t.Fatalf("parseTimeParam(%q) = %v, want now minus a positive duration", s, got)
			}
			return
		}
		t.Fatalf("parseTimeParam(%q) accepted a value in neither supported format", s)
	})
}

// FuzzParseRecordFilter drives the full filter parser with arbitrary
// query strings and then exercises the match helpers on representative
// records, the same path the list and export endpoints run.
func FuzzParseRecordFilter(f *testing.F) {
	f.Add("host=PC-01", "severity=high,critical", "rule_id=R-100", "type=process", "q=mimikatz", "since=90m", "until=2026-09-30T12:00:00Z")
	f.Add("", "", "", "", "", "", "")
	f.Add("host=%C2%ADpc", "severity=LOW", "", "type=%1Fevent", "q=%1F", "since=1h", "")
	f.Add("host=x&host=y", "severity=info", "", "", "", "since=2026-09-30T12:00:00Z", "since=2026-09-30T11:00:00Z")
	f.Add("", "severity=bogus", "", "", "", "", "")
	f.Add("", "", "", "", "q=%zz", "since=nope", "")

	f.Fuzz(func(t *testing.T, host, severity, ruleID, typ, q, since, until string) {
		target := "/api/events?" + host + "&" + severity + "&" + ruleID + "&" + typ + "&" + q + "&" + since + "&" + until
		// net/http never hands a handler a request line it cannot
		// parse: the target may hold no spaces or control runes, and
		// an unparseable URI never reaches a handler. Skip those the
		// same way the server layer would reject them, so the fuzz
		// property covers the filter, not httptest's request builder.
		if strings.IndexFunc(target, func(r rune) bool { return unicode.IsSpace(r) || r < 0x20 || r == 0x7f }) >= 0 {
			t.Skip()
		}
		if _, err := url.Parse(target); err != nil {
			t.Skip()
		}
		req := httptest.NewRequest("GET", target, nil)
		rec := httptest.NewRecorder()
		filter, ok := parseRecordFilter(rec, req)
		if !ok {
			if rec.Code != 400 {
				t.Fatalf("rejected filter answered %d, want 400", rec.Code)
			}
			return
		}
		if rec.Code != 200 {
			t.Fatalf("accepted filter answered %d, want 200", rec.Code)
		}
		for _, s := range filter.sevs {
			switch s {
			case rules.SevInfo, rules.SevLow, rules.SevMedium, rules.SevHigh, rules.SevCritical:
			default:
				t.Fatalf("filter kept invalid severity %q", s)
			}
		}
		// The match helpers must answer for representative records
		// without panic, whichever bounds the query set.
		a := alert.Alert{
			ID: "a1", Timestamp: "2026-10-05T10:00:00Z", RuleID: "R-100",
			RuleName: "lsass", Severity: rules.SevHigh, Host: "PC-01",
			EventType: "process", Summary: "access to lsass", Tags: []string{"t"},
		}
		ev := &model.Event{
			ID: "e1", Type: "process", Source: "sensor", Host: "PC-01",
			Timestamp:  time.Date(2026, 10, 5, 10, 0, 0, 0, time.UTC),
			Attributes: map[string]string{"process_name": "mimikatz.exe"},
		}
		ts, okTime := filter.alertTime(a)
		_ = filter.matchAlert(a, ts)
		_ = filter.matchEvent(ev)
		// alertTime answers the parse question, not membership:
		// with no bounds set every record is included (ts zero,
		// ok); with a bound set, a parseable timestamp must come
		// back unchanged so the window can judge it. Whether the
		// record then falls inside or outside the window is
		// inWindow's own decision, not asserted here.
		parsed, _ := time.Parse(time.RFC3339Nano, a.Timestamp)
		if filter.since.IsZero() && filter.until.IsZero() {
			if !okTime || !ts.IsZero() {
				t.Fatalf("no bounds set: alertTime = (%v, %v), want (zero, true)", ts, okTime)
			}
			return
		}
		if !okTime || !ts.Equal(parsed) {
			t.Fatalf("bounds set: alertTime = (%v, %v), want (%v, true)", ts, okTime, parsed)
		}
	})
}
