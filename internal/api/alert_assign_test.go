package api

// Assignment surface tests (TEAM-3 / M-1): the single route, the batch
// route, the GET /api/alerts filters and the SSE frame. Same harness as
// lifecycle_test.go (newTestHub + postStatus-style helpers).

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/alert"
	"github.com/Ruby570bocadito/bluetardigrade/internal/store"
)

func postAssign(t *testing.T, url, body string) (*http.Response, string) {
	t.Helper()
	req, err := http.NewRequest(http.MethodPost, url, strings.NewReader(body))
	if err != nil {
		t.Fatalf("NewRequest: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
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

func TestAlertAssignSingleFlow(t *testing.T) {
	h, addr := newTestHub(t)
	h.RecordAlert(alert.Alert{
		Timestamp: time.Now().UTC().Format(time.RFC3339Nano), RuleID: "r1", RuleName: "test rule",
		Severity: "critical", Host: "LAB-TEST", EventID: "ev-1",
		EventType: "process.create", Summary: "s", MatchedOn: []string{"process.name"},
	})
	base := fmt.Sprintf("http://%s", addr)

	var listed []map[string]any
	getJSON(t, base+"/api/alerts", &listed)
	if len(listed) != 1 {
		t.Fatalf("alerts listed = %d, want 1", len(listed))
	}
	id, _ := listed[0]["id"].(string)
	if len(id) != 16 {
		t.Fatalf("alert id = %q, want 16 chars", id)
	}

	// malformed id: 400 with the same shape as triage
	res, body := postAssign(t, base+"/api/alerts/nope/assign", `{"assignee":"ana","by":"carlos"}`)
	if res.StatusCode != 400 {
		t.Fatalf("malformed id status = %d body=%s", res.StatusCode, body)
	}

	// assign on an unseen id is legal for unrestricted callers (same
	// standard as triage) — it records and returns the entry
	res, body = postAssign(t, base+"/api/alerts/ffffffffffffffff/assign", `{"assignee":"ana","by":"carlos"}`)
	if res.StatusCode != 200 {
		t.Fatalf("assign unseen status = %d body=%s", res.StatusCode, body)
	}
	var entry map[string]any
	if err := json.Unmarshal([]byte(body), &entry); err != nil {
		t.Fatalf("entry body: %v (%s)", err, body)
	}
	if entry["assignee"] != "ana" || entry["assigned_by"] != "carlos" || entry["assigned_at"] == nil {
		t.Fatalf("entry = %v", entry)
	}

	// assign the real alert, then read the merged view
	res, body = postAssign(t, base+"/api/alerts/"+id+"/assign", `{"assignee":"bruno","by":"carlos"}`)
	if res.StatusCode != 200 {
		t.Fatalf("assign status = %d body=%s", res.StatusCode, body)
	}
	listed = nil // fresh slice: json.Unmarshal MERGES into reused maps
	getJSON(t, base+"/api/alerts", &listed)
	if listed[0]["assignee"] != "bruno" || listed[0]["assigned_by"] != "carlos" {
		t.Fatalf("view = %v", listed[0])
	}

	// triage must NOT clear the assignment
	res, body = postStatus(t, base+"/api/alerts/"+id+"/status", `{"status":"acknowledged","by":"bruno"}`, "")
	if res.StatusCode != 200 {
		t.Fatalf("ack status = %d body=%s", res.StatusCode, body)
	}
	listed = nil // fresh slice: json.Unmarshal MERGES into reused maps
	getJSON(t, base+"/api/alerts", &listed)
	if listed[0]["assignee"] != "bruno" || listed[0]["status"] != "acknowledged" {
		t.Fatalf("ack damaged the assignment: %v", listed[0])
	}

	// reassign over bruno, then unassign
	if res, body = postAssign(t, base+"/api/alerts/"+id+"/assign", `{"assignee":"ana","by":"carlos"}`); res.StatusCode != 200 {
		t.Fatalf("reassign status = %d body=%s", res.StatusCode, body)
	}
	res, body = postAssign(t, base+"/api/alerts/"+id+"/assign", `{"assignee":"","by":"carlos"}`)
	if res.StatusCode != 200 {
		t.Fatalf("unassign status = %d body=%s", res.StatusCode, body)
	}
	listed = nil // fresh slice: json.Unmarshal MERGES into reused maps
	getJSON(t, base+"/api/alerts", &listed)
	if _, has := listed[0]["assignee"]; has {
		t.Fatalf("unassign left assignee in the view: %v", listed[0])
	}

	// validation echoes the lifecycle limits
	long := strings.Repeat("x", 201)
	if res, _ = postAssign(t, base+"/api/alerts/"+id+"/assign", `{"assignee":"`+long+`"}`); res.StatusCode != 400 {
		t.Fatal("oversized assignee accepted")
	}
	if res, _ = postAssign(t, base+"/api/alerts/"+id+"/assign", `{"assignee":"ana","ids":["x"]}`); res.StatusCode != 400 {
		t.Fatal("ids accepted on the single route")
	}
	if res, _ = postAssign(t, base+"/api/alerts/"+id+"/assign", `{bogus`); res.StatusCode != 400 {
		t.Fatal("invalid JSON accepted")
	}
}

func TestAlertAssignBatch(t *testing.T) {
	h, addr := newTestHub(t)
	h.RecordAlert(alert.Alert{
		Timestamp: time.Now().UTC().Format(time.RFC3339Nano), RuleID: "r1", RuleName: "test rule",
		Severity: "critical", Host: "LAB-TEST", EventID: "ev-1",
		EventType: "process.create", Summary: "s", MatchedOn: []string{"process.name"},
	})
	base := fmt.Sprintf("http://%s", addr)
	var listed []map[string]any
	getJSON(t, base+"/api/alerts", &listed)
	id, _ := listed[0]["id"].(string)

	// mixed batch: one real, one unknown, one malformed — 200 with a
	// per-id split, and the real one actually assigned
	res, body := postAssign(t, base+"/api/alerts/assign-batch",
		fmt.Sprintf(`{"ids":["%s","aaaaaaaaaaaaaaaa","zz"],"assignee":"ana","by":"carlos"}`, id))
	if res.StatusCode != 200 {
		t.Fatalf("batch status = %d body=%s", res.StatusCode, body)
	}
	var out struct {
		Assigned []string `json:"assigned"`
		Failed   []struct {
			ID    string `json:"id"`
			Error string `json:"error"`
		} `json:"failed"`
	}
	if err := json.Unmarshal([]byte(body), &out); err != nil {
		t.Fatalf("batch body: %v (%s)", err, body)
	}
	if len(out.Assigned) != 1 || out.Assigned[0] != id {
		t.Fatalf("assigned = %v, want [%s] (%s)", out.Assigned, id, body)
	}
	if len(out.Failed) != 2 {
		t.Fatalf("failed = %d entries, want 2 (%s)", len(out.Failed), body)
	}
	listed = nil // fresh slice: json.Unmarshal MERGES into reused maps
	getJSON(t, base+"/api/alerts?assignee=ana", &listed)
	if len(listed) != 1 || listed[0]["id"] != id {
		t.Fatalf("assignee filter = %v", listed)
	}

	// unassign in batch clears it again
	res, body = postAssign(t, base+"/api/alerts/assign-batch",
		fmt.Sprintf(`{"ids":["%s"],"assignee":"","by":"carlos"}`, id))
	if res.StatusCode != 200 || !strings.Contains(body, `"assigned":["`+id+`"]`) {
		t.Fatalf("batch unassign = %d %s", res.StatusCode, body)
	}
	listed = nil // fresh slice: json.Unmarshal MERGES into reused maps
	getJSON(t, base+"/api/alerts?assignee=ana", &listed)
	if len(listed) != 0 {
		t.Fatalf("batch unassign left %d assigned", len(listed))
	}

	// contract guards: empty ids, too many ids, ids on missing field
	if res, _ = postAssign(t, base+"/api/alerts/assign-batch", `{"assignee":"ana"}`); res.StatusCode != 400 {
		t.Fatal("empty ids accepted")
	}
	many := `{"ids":[` + `"aaaaaaaaaaaaaaaa",` + strings.Repeat(`"bbbbbbbbbbbbbbbb",`, 500) + `"cccccccccccccccc"],"assignee":"a"}`
	if res, _ = postAssign(t, base+"/api/alerts/assign-batch", many); res.StatusCode != 400 {
		t.Fatal("oversized batch accepted")
	}
}

func TestAlertAssignFilters(t *testing.T) {
	h, addr := newTestHub(t)
	for _, sev := range []string{"critical", "low"} {
		h.RecordAlert(alert.Alert{
			Timestamp: time.Now().UTC().Format(time.RFC3339Nano), RuleID: "r-" + sev,
			RuleName: "rule " + sev, Severity: sev, Host: "LAB-TEST", EventID: "ev-" + sev,
			EventType: "process.create", Summary: sev, MatchedOn: []string{"process.name"},
		})
	}
	base := fmt.Sprintf("http://%s", addr)
	var listed []map[string]any
	getJSON(t, base+"/api/alerts", &listed)
	if len(listed) != 2 {
		t.Fatalf("alerts listed = %d, want 2", len(listed))
	}

	// the queue without filters shows both as unassigned
	getJSON(t, base+"/api/alerts?unassigned=true", &listed)
	if len(listed) != 2 {
		t.Fatalf("unassigned queue = %d, want 2", len(listed))
	}

	// assign the critical one
	critID, _ := listed[0]["id"].(string)
	if listed[0]["severity"] != "critical" {
		critID, _ = listed[1]["id"].(string)
	}
	if res, body := postAssign(t, base+"/api/alerts/"+critID+"/assign", `{"assignee":"Ana","by":"carlos"}`); res.StatusCode != 200 {
		t.Fatalf("assign = %d %s", res.StatusCode, body)
	}

	// «Mis alertas»: case-insensitive match
	getJSON(t, base+"/api/alerts?assignee=ana", &listed)
	if len(listed) != 1 || listed[0]["id"] != critID {
		t.Fatalf("mis alertas = %v", listed)
	}
	// queue shrinks to the other one
	getJSON(t, base+"/api/alerts?unassigned=true", &listed)
	if len(listed) != 1 || listed[0]["id"] == critID {
		t.Fatalf("unassigned queue = %v", listed)
	}
	// combinable with the existing filters
	getJSON(t, base+"/api/alerts?assignee=ANA&severity=critical", &listed)
	if len(listed) != 1 || listed[0]["id"] != critID {
		t.Fatalf("combined filters = %v", listed)
	}
	// unknown assignee: empty list, not an error
	getJSON(t, base+"/api/alerts?assignee=nadie", &listed)
	if len(listed) != 0 {
		t.Fatalf("unknown assignee = %v", listed)
	}
	// loud 400s: bad value and contradictory combination
	res, _ := http.Get(base + "/api/alerts?unassigned=yes")
	if res.StatusCode != 400 {
		t.Fatalf("unassigned=yes status = %d, want 400", res.StatusCode)
	}
	res.Body.Close()
	res, _ = http.Get(base + "/api/alerts?assignee=ana&unassigned=true")
	if res.StatusCode != 400 {
		t.Fatalf("contradictory filters status = %d, want 400", res.StatusCode)
	}
	res.Body.Close()
}

func TestAlertAssignSSEFrame(t *testing.T) {
	_, addr := newTestHub(t)
	streamURL := fmt.Sprintf("http://%s/api/stream", addr)
	req, _ := http.NewRequest(http.MethodGet, streamURL, nil)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("stream: %v", err)
	}
	defer res.Body.Close()
	frames := bufio.NewScanner(res.Body)

	postAssign(t, fmt.Sprintf("http://%s/api/alerts/ffffffffffffffff/assign", addr),
		`{"assignee":"ana","by":"carlos"}`)

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
		t.Fatal("no alert_lifecycle SSE frame for the assignment")
	}
	if entry["assignee"] != "ana" || entry["assigned_by"] != "carlos" {
		t.Fatalf("SSE entry = %v", entry)
	}
}

func TestAlertAssignStoreMode(t *testing.T) {
	h, addr := newTestHub(t)
	st, err := store.Open(t.TempDir() + "/assign.db")
	if err != nil {
		t.Fatalf("store: %v", err)
	}
	defer st.Close()
	h.SetStore(st)
	h.RecordAlert(alert.Alert{
		Timestamp: time.Now().UTC().Format(time.RFC3339Nano), RuleID: "r1", RuleName: "test rule",
		Severity: "critical", Host: "LAB-TEST", EventID: "ev-1",
		EventType: "process.create", Summary: "s", MatchedOn: []string{"process.name"},
	})
	base := fmt.Sprintf("http://%s", addr)

	var listed []map[string]any
	getJSON(t, base+"/api/alerts", &listed)
	if len(listed) != 1 {
		t.Fatalf("store alerts = %d, want 1", len(listed))
	}
	id, _ := listed[0]["id"].(string)

	if res, body := postAssign(t, base+"/api/alerts/"+id+"/assign", `{"assignee":"ana","by":"carlos"}`); res.StatusCode != 200 {
		t.Fatalf("store assign = %d %s", res.StatusCode, body)
	}
	getJSON(t, base+"/api/alerts?assignee=ana", &listed)
	if len(listed) != 1 || listed[0]["assignee"] != "ana" {
		t.Fatalf("store mis alertas = %v", listed)
	}
	getJSON(t, base+"/api/alerts?unassigned=true", &listed)
	if len(listed) != 0 {
		t.Fatalf("store queue = %v", listed)
	}
	// the batch route works on the store backend too
	res, body := postAssign(t, base+"/api/alerts/assign-batch",
		fmt.Sprintf(`{"ids":["%s"],"assignee":"","by":"carlos"}`, id))
	if res.StatusCode != 200 || !strings.Contains(body, `"assigned"`) {
		t.Fatalf("store batch = %d %s", res.StatusCode, body)
	}
	getJSON(t, base+"/api/alerts?unassigned=true", &listed)
	if len(listed) != 1 {
		t.Fatalf("store queue after unassign = %v", listed)
	}
}
