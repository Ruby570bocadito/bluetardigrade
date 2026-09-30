package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/Ruby570bocadito/security-framework/internal/alert"
	"github.com/Ruby570bocadito/security-framework/internal/suppress"
	"github.com/Ruby570bocadito/security-framework/pkg/model"
)

// eventAt builds an event with explicit type/host/timestamp (the fields
// the filter axes act on).
func eventAt(id, evType, host string, ts time.Time) *model.Event {
	return &model.Event{
		ID:        id,
		Timestamp: ts,
		Type:      evType,
		Source:    "test",
		Host:      host,
	}
}

// alertAt builds an alert whose summary mentions its rule id, so free
// text and identity filters have a stable surface.
func alertAt(ruleID, severity, host string, ts time.Time) alert.Alert {
	return alert.Alert{
		Timestamp: ts.Format(time.RFC3339Nano),
		RuleID:    ruleID,
		RuleName:  "rule " + ruleID,
		Severity:  severity,
		Host:      host,
		EventID:   "ev-" + ruleID,
		EventType: "process.create",
		Summary:   "suspicious activity for " + ruleID,
		Tags:      []string{"attack.t1003.001", "attack.execution"},
	}
}

func TestEventsListFilters(t *testing.T) {
	h, addr := newTestHub(t)
	base := time.Now().UTC()
	h.RecordEvent(eventAt("ev-old", "file.create", "LAB-A", base.Add(-2*time.Hour)))
	h.RecordEvent(eventAt("ev-1", "process.create", "LAB-A", base))
	h.RecordEvent(eventAt("ev-2", "process.create", "LAB-B", base))
	h.RecordEvent(eventAt("ev-3", "network.connect", "LAB-B", base))

	cases := []struct {
		query string
		want  []string // expected ids, newest first
	}{
		{"host=lab-b", []string{"ev-3", "ev-2"}},          // host is case-insensitive
		{"type=process.create", []string{"ev-2", "ev-1"}}, // exact type
		{"since=60m", []string{"ev-3", "ev-2", "ev-1"}},   // relative window drops ev-old
		{"until=60m", []string{"ev-old"}},                 // inverse window
		{"q=zzz-nothing", nil},                            // no match stays empty
		{"q=lab-a", []string{"ev-1", "ev-old"}},           // host hit via free text
		{"host=lab-a&since=60m", []string{"ev-1"}},        // combined axes
		{"limit=1&host=lab-b", []string{"ev-3"}},          // limit applies AFTER filtering
	}
	for _, c := range cases {
		var got []map[string]any
		getJSON(t, fmt.Sprintf("http://%s/api/events?%s", addr, c.query), &got)
		ids := make([]string, 0, len(got))
		for _, e := range got {
			ids = append(ids, e["id"].(string))
		}
		if strings.Join(ids, ",") != strings.Join(c.want, ",") {
			t.Errorf("?%s: ids = %v, want %v", c.query, ids, c.want)
		}
	}
}

func TestAlertsListFilters(t *testing.T) {
	h, addr := newTestHub(t)
	now := time.Now().UTC()
	h.RecordAlert(alertAt("r-vss", "critical", "LAB-A", now))
	h.RecordAlert(alertAt("r-lsa", "high", "LAB-B", now))

	cases := []struct {
		query string
		want  []string
	}{
		{"host=LAB-A", []string{"r-vss"}},
		{"severity=critical", []string{"r-vss"}},
		{"severity=high,critical", []string{"r-lsa", "r-vss"}}, // ring order (same second)
		{"rule_id=r-lsa", []string{"r-lsa"}},
		{"q=r-vss", []string{"r-vss"}},
		{"q=attack.t1003", []string{"r-lsa", "r-vss"}}, // free text covers tags
		{"host=lab-b&severity=high", []string{"r-lsa"}},
	}
	for _, c := range cases {
		var got []map[string]any
		getJSON(t, fmt.Sprintf("http://%s/api/alerts?%s", addr, c.query), &got)
		ids := make([]string, 0, len(got))
		for _, a := range got {
			ids = append(ids, a["rule_id"].(string))
		}
		if strings.Join(ids, ",") != strings.Join(c.want, ",") {
			t.Errorf("?%s: rule_ids = %v, want %v", c.query, ids, c.want)
		}
	}
}

func TestExportFilters(t *testing.T) {
	h, addr := newTestHub(t)
	base := time.Now().UTC()
	h.RecordAlert(alertAt("r-vss", "critical", "LAB-A", base))
	h.RecordAlert(alertAt("r-lsa", "high", "LAB-B", base))
	h.RecordEvent(eventAt("ev-old", "file.create", "LAB-A", base.Add(-2*time.Hour)))
	h.RecordEvent(eventAt("ev-1", "process.create", "LAB-B", base))

	// alerts export: only the filtered subset crosses the wire
	res, body := fetchBody(t, fmt.Sprintf("http://%s/api/alerts/export?host=lab-a", addr))
	if res.StatusCode != 200 || !strings.Contains(body, "r-vss") || strings.Contains(body, "r-lsa") {
		t.Errorf("alerts export ?host: status=%d body=%q", res.StatusCode, body)
	}
	// ...in CSV too
	_, csvBody := fetchBody(t, fmt.Sprintf("http://%s/api/alerts/export?severity=high&format=csv", addr))
	if !strings.Contains(csvBody, "r-lsa") || strings.Contains(csvBody, "r-vss") {
		t.Errorf("alerts csv ?severity: body=%q", csvBody)
	}
	// events export with a relative since window
	_, evBody := fetchBody(t, fmt.Sprintf("http://%s/api/events/export?since=60m", addr))
	if strings.Contains(evBody, "ev-old") || !strings.Contains(evBody, "ev-1") {
		t.Errorf("events export ?since: body=%q", evBody)
	}
	// free text on events export
	_, qBody := fetchBody(t, fmt.Sprintf("http://%s/api/events/export?q=lab-a", addr))
	if strings.Contains(qBody, "ev-1") || !strings.Contains(qBody, "ev-old") {
		t.Errorf("events export ?q: body=%q", qBody)
	}
}

// Regression (04-A): an alert whose Timestamp string cannot be parsed
// used to be dropped from ring-mode listings AND exports even when the
// query set no since/until at all — the parse error silently hid a
// record from a query that never asked about time. Without time bounds
// every record must be visible; with a bound set, an unreadable
// timestamp still cannot prove membership.
func TestAlertUnparseableTimestampVisibility(t *testing.T) {
	h, addr := newTestHub(t)
	now := time.Now().UTC()

	h.RecordAlert(alertAt("r-parse-ok", "high", "LAB-A", now))
	bad := alertAt("r-parse-bad", "high", "LAB-A", now)
	bad.Timestamp = "not-a-timestamp"
	h.RecordAlert(bad)

	var got []map[string]any
	getJSON(t, fmt.Sprintf("http://%s/api/alerts", addr), &got)
	if len(got) != 2 {
		t.Fatalf("list without time bounds = %d records, want 2 (an unparseable timestamp must not hide the alert)", len(got))
	}
	getJSON(t, fmt.Sprintf("http://%s/api/alerts?since=60m", addr), &got)
	if len(got) != 1 || got[0]["rule_id"].(string) != "r-parse-ok" {
		t.Fatalf("list with since=60m = %v, want only r-parse-ok", got)
	}
	_, body := fetchBody(t, fmt.Sprintf("http://%s/api/alerts/export", addr))
	if !strings.Contains(body, "r-parse-ok") || !strings.Contains(body, "r-parse-bad") {
		t.Fatalf("export without time bounds lost records: %q", body)
	}
	_, body = fetchBody(t, fmt.Sprintf("http://%s/api/alerts/export?since=60m", addr))
	if strings.Contains(body, "r-parse-bad") || !strings.Contains(body, "r-parse-ok") {
		t.Fatalf("export with since=60m included the unparseable record: %q", body)
	}
}

func TestFilterValidation(t *testing.T) {
	_, addr := newTestHub(t)
	cases := []string{
		"/api/alerts?severity=apocalyptic",
		"/api/alerts?since=yesterday",
		"/api/events?until=2026-09-30T12:00:00Z&since=2026-09-30T13:00:00Z", // until < since
		"/api/alerts/export?since=-30m",                                     // negative duration rejected
	}
	for _, path := range cases {
		res, _ := fetchBody(t, "http://"+addr+path)
		if res.StatusCode != http.StatusBadRequest {
			t.Errorf("%s: status = %d, want 400", path, res.StatusCode)
		}
	}
}

func TestSuppressionsEndpoint(t *testing.T) {
	h, addr := newTestHub(t)

	// without a manager wired: empty but well-formed
	var empty suppressPayload
	getJSON(t, fmt.Sprintf("http://%s/api/suppressions", addr), &empty)
	if empty.Active != 0 || len(empty.Entries) != 0 {
		t.Errorf("empty payload = %+v", empty)
	}

	m := suppress.New()
	p := writeSuppressFile(t, `
- rule_id: r-vss
  host: LAB-A
  reason: change window
- rule_id: r-expired
  expires: 2020-01-01T00:00:00Z
`)
	if err := m.LoadFile(p); err != nil {
		t.Fatal(err)
	}
	h.SetSuppressions(m)

	var got suppressPayload
	getJSON(t, fmt.Sprintf("http://%s/api/suppressions", addr), &got)
	if got.Active != 1 {
		t.Errorf("active = %d, want 1 (expired excluded)", got.Active)
	}
	if len(got.Entries) != 1 || got.Entries[0].RuleID != "r-vss" || got.Entries[0].Reason != "change window" {
		b, _ := json.Marshal(got)
		t.Errorf("entries = %s", b)
	}

	var stats map[string]any
	getJSON(t, fmt.Sprintf("http://%s/api/stats", addr), &stats)
	if stats["suppressions_active"].(float64) != 1 {
		t.Errorf("stats suppressions_active = %v, want 1", stats["suppressions_active"])
	}
}

func writeSuppressFile(t *testing.T, content string) string {
	t.Helper()
	p := t.TempDir() + "/suppressions.yaml"
	if err := os.WriteFile(p, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	return p
}
