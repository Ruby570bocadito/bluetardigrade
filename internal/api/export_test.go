package api

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/Ruby570bocadito/security-framework/internal/alert"
	"github.com/Ruby570bocadito/security-framework/pkg/model"
)

func fetchBody(t *testing.T, url string) (*http.Response, string) {
	t.Helper()
	res, err := http.Get(url)
	if err != nil {
		t.Fatalf("GET %s: %v", url, err)
	}
	defer res.Body.Close()
	body := readAll(t, res)
	return res, body
}

func readAll(t *testing.T, res *http.Response) string {
	t.Helper()
	var b strings.Builder
	buf := make([]byte, 4096)
	for {
		n, err := res.Body.Read(buf)
		b.Write(buf[:n])
		if err != nil {
			break
		}
	}
	return b.String()
}

func TestAlertsExportJSONL(t *testing.T) {
	h, addr := newTestHub(t)
	h.RecordAlert(alert.Alert{
		Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
		RuleID:    "r-1", RuleName: "regla prueba", Severity: "high",
		Host: "LAB-TEST", EventID: "ev-9", EventType: "process.create",
		Summary: "powershell.exe -enc AAAA", MatchedOn: []string{"process.name", "process.command_line"},
		Tags: []string{"attack.t1059.001", "attack.execution"},
	})

	res, body := fetchBody(t, fmt.Sprintf("http://%s/api/alerts/export", addr))
	if ct := res.Header.Get("Content-Type"); ct != "application/x-ndjson" {
		t.Fatalf("content-type = %q, want application/x-ndjson", ct)
	}
	if cd := res.Header.Get("Content-Disposition"); !strings.Contains(cd, "alerts-") || !strings.Contains(cd, ".jsonl") {
		t.Fatalf("content-disposition = %q", cd)
	}
	lines := strings.Split(strings.TrimSpace(body), "\n")
	if len(lines) != 1 {
		t.Fatalf("expected 1 JSONL line, got %d", len(lines))
	}
	var a map[string]any
	if err := json.Unmarshal([]byte(lines[0]), &a); err != nil {
		t.Fatalf("line is not JSON: %v", err)
	}
	if a["rule_id"] != "r-1" || a["severity"] != "high" {
		t.Fatalf("alert payload mismatch: %+v", a)
	}
}

func TestAlertsExportCSV(t *testing.T) {
	h, addr := newTestHub(t)
	h.RecordAlert(alert.Alert{
		Timestamp: "2026-01-02T03:04:05Z",
		RuleID:    "r-2", RuleName: "regla csv", Severity: "critical",
		Host: "LAB-TEST", EventID: "ev-10", EventType: "process.create",
		Summary: "=cmd|'/c calc'!A0", MatchedOn: []string{"process.name"},
		Tags: []string{"attack.t1003.001"},
	})

	res, body := fetchBody(t, fmt.Sprintf("http://%s/api/alerts/export?format=csv", addr))
	if ct := res.Header.Get("Content-Type"); !strings.HasPrefix(ct, "text/csv") {
		t.Fatalf("content-type = %q, want text/csv", ct)
	}
	cr := csv.NewReader(strings.NewReader(body))
	rows, err := cr.ReadAll()
	if err != nil {
		t.Fatalf("csv parse: %v", err)
	}
	if len(rows) != 2 {
		t.Fatalf("expected header + 1 row, got %d rows", len(rows))
	}
	header := rows[0]
	if header[0] != "timestamp" || header[1] != "severity" || header[3] != "rule_name" {
		t.Fatalf("unexpected header: %v", header)
	}
	row := rows[1]
	if row[1] != "critical" || row[3] != "regla csv" {
		t.Fatalf("unexpected row values: %v", row)
	}
	// formula injection must be neutralized: leading '=' gets a quote prefix
	if !strings.HasPrefix(row[7], "'=") {
		t.Fatalf("summary not sanitized against formula injection: %q", row[7])
	}
}

func TestEventsExportJSONLAndCSV(t *testing.T) {
	h, addr := newTestHub(t)
	ev := sampleEvent("ev-x")
	ev.Process.CommandLine = "powershell.exe -nop"
	ev.Network = &model.Network{DestinationIP: "10.0.0.5", DestinationPort: 443}
	h.RecordEvent(ev)

	// JSONL round-trips the full event
	res, body := fetchBody(t, fmt.Sprintf("http://%s/api/events/export", addr))
	if ct := res.Header.Get("Content-Type"); ct != "application/x-ndjson" {
		t.Fatalf("jsonl content-type = %q", ct)
	}
	var back model.Event
	if err := json.Unmarshal([]byte(strings.TrimSpace(body)), &back); err != nil {
		t.Fatalf("jsonl parse: %v", err)
	}
	if back.ID != "ev-x" || back.Process.CommandLine != "powershell.exe -nop" {
		t.Fatalf("round-trip mismatch: %+v", back)
	}

	// CSV flattens the nested structures into stable columns
	_, body = fetchBody(t, fmt.Sprintf("http://%s/api/events/export?format=csv", addr))
	cr := csv.NewReader(strings.NewReader(body))
	rows, err := cr.ReadAll()
	if err != nil {
		t.Fatalf("csv parse: %v", err)
	}
	if len(rows) != 2 {
		t.Fatalf("expected header + 1 row, got %d", len(rows))
	}
	get := func(col string) string {
		for i, name := range rows[0] {
			if name == col {
				return rows[1][i]
			}
		}
		t.Fatalf("column %q missing", col)
		return ""
	}
	if get("process_name") != "powershell.exe" || get("process_pid") != "42" {
		t.Fatalf("process columns wrong: %v", rows[1])
	}
	if get("network_destination") != "10.0.0.5" || get("network_port") != "443" {
		t.Fatalf("network columns wrong: %v", rows[1])
	}
}

func TestExportRejectsUnknownFormat(t *testing.T) {
	_, addr := newTestHub(t)
	res, _ := fetchBody(t, fmt.Sprintf("http://%s/api/alerts/export?format=xml", addr))
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", res.StatusCode)
	}
}

func TestWebhookStatsInStatsPayload(t *testing.T) {
	h, addr := newTestHub(t)
	h.SetWebhookStats(func() (uint64, uint64, uint64) { return 7, 2, 1 })

	var stats map[string]any
	getJSON(t, fmt.Sprintf("http://%s/api/stats", addr), &stats)
	if stats["webhook_sent"].(float64) != 7 || stats["webhook_failed"].(float64) != 2 || stats["webhook_dropped"].(float64) != 1 {
		t.Fatalf("webhook stats wrong: %+v", stats)
	}
}
