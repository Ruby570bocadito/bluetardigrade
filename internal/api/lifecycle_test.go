package api

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/Ruby570bocadito/security-framework/internal/alert"
	"github.com/Ruby570bocadito/security-framework/internal/lifecycle"
)

func postStatus(t *testing.T, url, body, token string) (*http.Response, string) {
	t.Helper()
	req, err := http.NewRequest(http.MethodPost, url, strings.NewReader(body))
	if err != nil {
		t.Fatalf("NewRequest: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("POST %s: %v", url, err)
	}
	defer res.Body.Close()
	data, err := io.ReadAll(res.Body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	return res, string(data)
}

func TestAlertLifecycleFlow(t *testing.T) {
	h, addr := newTestHub(t)
	h.RecordAlert(alert.Alert{
		Timestamp: time.Now().UTC().Format(time.RFC3339Nano), RuleID: "r1", RuleName: "test rule",
		Severity: "critical", Host: "LAB-TEST", EventID: "ev-1",
		EventType: "process.create", Summary: "s", MatchedOn: []string{"process.name"},
	})

	// the recorded alert must carry an id (16 hex) and answer as "new"
	var listed []map[string]any
	getJSON(t, fmt.Sprintf("http://%s/api/alerts", addr), &listed)
	if len(listed) != 1 {
		t.Fatalf("alerts listed = %d, want 1", len(listed))
	}
	id, _ := listed[0]["id"].(string)
	if len(id) != 16 {
		t.Fatalf("alert id = %q, want 16 chars", id)
	}
	if listed[0]["status"] != "new" {
		t.Fatalf("default status = %v, want new", listed[0]["status"])
	}

	// acknowledge with a note
	base := fmt.Sprintf("http://%s", addr)
	res, body := postStatus(t, base+"/api/alerts/"+id+"/status",
		`{"status":"acknowledged","note":"investigando","by":"ana"}`, "")
	if res.StatusCode != 200 {
		t.Fatalf("ack status = %d body=%s", res.StatusCode, body)
	}
	var entry map[string]any
	if err := json.Unmarshal([]byte(body), &entry); err != nil {
		t.Fatalf("entry body: %v (%s)", err, body)
	}
	if entry["status"] != "acknowledged" || entry["alert_id"] != id {
		t.Fatalf("entry = %v", entry)
	}

	// close, then read the merged view
	if res, body = postStatus(t, base+"/api/alerts/"+id+"/status",
		`{"status":"closed","note":"falso positivo"}`, ""); res.StatusCode != 200 {
		t.Fatalf("close status = %d body=%s", res.StatusCode, body)
	}
	getJSON(t, base+"/api/alerts", &listed)
	if listed[0]["status"] != "closed" || listed[0]["status_note"] != "falso positivo" {
		t.Fatalf("merged view = %v %v", listed[0]["status"], listed[0]["status_note"])
	}

	// reopen (status new is a valid explicit transition)
	if res, _ = postStatus(t, base+"/api/alerts/"+id+"/status", `{"status":"new"}`, ""); res.StatusCode != 200 {
		t.Fatal("reopen rejected")
	}
	getJSON(t, base+"/api/alerts", &listed)
	if listed[0]["status"] != "new" {
		t.Fatalf("reopened status = %v", listed[0]["status"])
	}

	// lifecycle targets the STORE, not the ring: an evicted/unseen id
	// can still be triaged (alerts_total > ring size is routine)
	if res, _ = postStatus(t, base+"/api/alerts/ffffffffffffffff/status", `{"status":"closed"}`, ""); res.StatusCode != 200 {
		t.Fatal("status for an alert outside the ring rejected")
	}
}

func TestAlertLifecycleBadRequests(t *testing.T) {
	_, addr := newTestHub(t)
	base := fmt.Sprintf("http://%s", addr)

	cases := []struct {
		name, path, body, wantErr string
	}{
		{"bad id", "/api/alerts/ZZZ/status", `{"status":"closed"}`, "malformed alert id"},
		{"empty body", "/api/alerts/ffffffffffffffff/status", ``, "invalid JSON"},
		{"unknown status", "/api/alerts/ffffffffffffffff/status", `{"status":"resolved"}`, "invalid status"},
		{"missing status", "/api/alerts/ffffffffffffffff/status", `{"note":"hi"}`, "invalid status"},
		{"oversized note", "/api/alerts/ffffffffffffffff/status",
			`{"status":"closed","note":"` + strings.Repeat("x", lifecycle.MaxNoteLen+1) + `"}`, "note longer"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			res, body := postStatus(t, base+tc.path, tc.body, "")
			if res.StatusCode != 400 {
				t.Fatalf("status = %d, want 400 (body=%s)", res.StatusCode, body)
			}
			var errPayload map[string]string
			if err := json.Unmarshal([]byte(body), &errPayload); err != nil || !strings.Contains(errPayload["error"], tc.wantErr) {
				t.Fatalf("error body %q does not mention %q", body, tc.wantErr)
			}
		})
	}
}

func TestAlertLifecycleAuthGated(t *testing.T) {
	h, addr := newTestHub(t)
	h.SetToken("sekrit")
	base := fmt.Sprintf("http://%s", addr)

	res, body := postStatus(t, base+"/api/alerts/ffffffffffffffff/status", `{"status":"closed"}`, "")
	if res.StatusCode != 401 {
		t.Fatalf("status = %d, want 401", res.StatusCode)
	}
	if !strings.Contains(res.Header.Get("WWW-Authenticate"), "Bearer") {
		t.Fatal("missing WWW-Authenticate challenge")
	}
	if !strings.Contains(body, "unauthorized") {
		t.Fatalf("body = %q", body)
	}
	// wrong token: same 401
	res, _ = postStatus(t, base+"/api/alerts/ffffffffffffffff/status", `{"status":"closed"}`, "wrong")
	if res.StatusCode != 401 {
		t.Fatalf("wrong token status = %d, want 401", res.StatusCode)
	}
	// right token: through
	res, _ = postStatus(t, base+"/api/alerts/ffffffffffffffff/status", `{"status":"closed"}`, "sekrit")
	if res.StatusCode != 200 {
		t.Fatalf("authed status = %d, want 200", res.StatusCode)
	}
}

func TestAlertLifecycleSSEBroadcast(t *testing.T) {
	_, addr := newTestHub(t)
	streamURL := fmt.Sprintf("http://%s/api/stream", addr)
	req, _ := http.NewRequest(http.MethodGet, streamURL, nil)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("stream: %v", err)
	}
	defer res.Body.Close()
	frames := bufio.NewScanner(res.Body)

	postStatus(t, fmt.Sprintf("http://%s/api/alerts/ffffffffffffffff/status", addr),
		`{"status":"acknowledged","by":"ops"}`, "")

	// scan line by line until the lifecycle event frame shows up (the
	// stream opens with retry/heartbeat lines, so one Read is never enough)
	var entry map[string]any
	found := false
	for frames.Scan() {
		if strings.TrimSpace(frames.Text()) != "event: alert_lifecycle" {
			continue
		}
		found = true
		for frames.Scan() {
			line := frames.Text()
			if strings.HasPrefix(line, "data: ") {
				if err := json.Unmarshal([]byte(strings.TrimPrefix(line, "data: ")), &entry); err != nil {
					t.Fatalf("data decode: %v", err)
				}
				break
			}
		}
		break
	}
	if !found {
		t.Fatal("no alert_lifecycle SSE frame received")
	}
	if entry["alert_id"] != "ffffffffffffffff" || entry["status"] != "acknowledged" {
		t.Fatalf("broadcast entry = %v", entry)
	}
}

func TestAlertExportCarriesLifecycle(t *testing.T) {
	h, addr := newTestHub(t)
	h.RecordAlert(alert.Alert{
		Timestamp: time.Now().UTC().Format(time.RFC3339Nano), RuleID: "r1", RuleName: "test rule",
		Severity: "high", Host: "LAB-TEST", EventID: "ev-1",
		EventType: "process.create", Summary: "s", MatchedOn: []string{"process.name"},
	})
	var listed []map[string]any
	getJSON(t, fmt.Sprintf("http://%s/api/alerts", addr), &listed)
	id, _ := listed[0]["id"].(string)
	postStatus(t, fmt.Sprintf("http://%s/api/alerts/%s/status", addr, id),
		`{"status":"closed","note":"dup","by":"ops"}`, "")

	// JSONL export flattens the same overlay
	res, err := http.Get(fmt.Sprintf("http://%s/api/alerts/export", addr))
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var exported map[string]any
	if err := json.NewDecoder(res.Body).Decode(&exported); err != nil {
		t.Fatalf("jsonl decode: %v", err)
	}
	if exported["id"] != id || exported["status"] != "closed" || exported["status_note"] != "dup" {
		t.Fatalf("exported = %v", exported)
	}

	// CSV carries the id/status columns
	res2, err := http.Get(fmt.Sprintf("http://%s/api/alerts/export?format=csv", addr))
	if err != nil {
		t.Fatal(err)
	}
	defer res2.Body.Close()
	csvData, _ := io.ReadAll(res2.Body)
	if !strings.HasPrefix(string(csvData), "id,status,timestamp,") {
		t.Fatalf("csv header = %q", strings.SplitN(string(csvData), "\n", 2)[0])
	}
	if !strings.Contains(string(csvData), "closed") {
		t.Fatalf("csv row misses the status: %q", string(csvData))
	}
}
