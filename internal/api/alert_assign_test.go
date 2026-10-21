package api

import (
	"bufio"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/alert"
	"github.com/Ruby570bocadito/bluetardigrade/internal/lifecycle"
)

func recordTestAlert(t *testing.T, h *Hub, id, host string) string {
	t.Helper()
	a := alert.Alert{
		ID: id, Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
		RuleID: "r1", RuleName: "test rule", Severity: "high",
		Host: host, EventID: "ev-1", EventType: "process.create",
		Summary: "s", MatchedOn: []string{"process.name"},
	}
	h.RecordAlert(a)
	return a.ID
}

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
	data := make([]byte, 0, 4096)
	buf := make([]byte, 4096)
	for {
		n, err := res.Body.Read(buf)
		data = append(data, buf[:n]...)
		if err != nil {
			break
		}
	}
	return res, string(data)
}

func TestAlertAssignFlow(t *testing.T) {
	h, addr := newTestHub(t)
	id := recordTestAlert(t, h, "0000000000000001", "LAB-TEST")
	base := fmt.Sprintf("http://%s", addr)

	res, body := postAssign(t, base+"/api/alerts/"+id+"/assign", `{"assignee":"ana","by":"beto"}`)
	if res.StatusCode != 200 {
		t.Fatalf("assign status = %d body=%s", res.StatusCode, body)
	}
	var entry map[string]any
	if err := json.Unmarshal([]byte(body), &entry); err != nil {
		t.Fatalf("entry body: %v (%s)", err, body)
	}
	if entry["alert_id"] != id || entry["assignee"] != "ana" || entry["assigned_by"] != "beto" {
		t.Fatalf("entry = %v", entry)
	}
	if _, err := entry["assigned_at"].(string); !err {
		t.Fatalf("assigned_at missing: %v", entry)
	}

	// The list overlay carries the assignment next to the (implicit new)
	// status: assigning is not triaging.
	var listed []map[string]any
	getJSON(t, base+"/api/alerts", &listed)
	if listed[0]["assignee"] != "ana" || listed[0]["status"] != "new" {
		t.Fatalf("overlay = %v / %v", listed[0]["assignee"], listed[0]["status"])
	}

	// Reassignment and unassignment round-trip.
	if res, body = postAssign(t, base+"/api/alerts/"+id+"/assign", `{"assignee":"carla","by":"beto"}`); res.StatusCode != 200 {
		t.Fatalf("reassign status = %d body=%s", res.StatusCode, body)
	}
	if res, _ = postAssign(t, base+"/api/alerts/"+id+"/assign", `{"assignee":"","by":"beto"}`); res.StatusCode != 200 {
		t.Fatal("unassign rejected")
	}
	listed = nil
	getJSON(t, base+"/api/alerts", &listed)
	if _, present := listed[0]["assignee"]; present {
		t.Fatalf("assignee survived unassign: %v", listed[0]["assignee"])
	}
}

func TestAlertAssignPreservesStatus(t *testing.T) {
	h, addr := newTestHub(t)
	id := recordTestAlert(t, h, "0000000000000002", "LAB-TEST")
	base := fmt.Sprintf("http://%s", addr)
	if res, _ := postStatus(t, base+"/api/alerts/"+id+"/status",
		`{"status":"acknowledged","note":"investigando","by":"ana"}`, ""); res.StatusCode != 200 {
		t.Fatal("ack rejected")
	}
	if res, _ := postAssign(t, base+"/api/alerts/"+id+"/assign", `{"assignee":"beto","by":"ana"}`); res.StatusCode != 200 {
		t.Fatal("assign rejected")
	}
	var listed []map[string]any
	getJSON(t, base+"/api/alerts", &listed)
	if listed[0]["status"] != "acknowledged" || listed[0]["status_note"] != "investigando" {
		t.Fatalf("assign wiped triage: %v / %v", listed[0]["status"], listed[0]["status_note"])
	}
	if listed[0]["assignee"] != "beto" {
		t.Fatalf("assignee = %v", listed[0]["assignee"])
	}
}

func TestAlertAssignBadRequests(t *testing.T) {
	_, addr := newTestHub(t)
	base := fmt.Sprintf("http://%s", addr)
	cases := []struct {
		name, path, body, wantErr string
	}{
		{"bad id", "/api/alerts/ZZZ/assign", `{"assignee":"ana"}`, "malformed alert id"},
		{"empty body", "/api/alerts/ffffffffffffffff/assign", ``, "invalid JSON"},
		{"oversized assignee", "/api/alerts/ffffffffffffffff/assign",
			`{"assignee":"` + strings.Repeat("x", lifecycle.MaxAssigneeLen+1) + `"}`, "assignee longer"},
		{"oversized by", "/api/alerts/ffffffffffffffff/assign",
			`{"assignee":"ana","by":"` + strings.Repeat("x", lifecycle.MaxByLen+1) + `"}`, "by longer"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			res, body := postAssign(t, base+tc.path, tc.body)
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

func TestAlertAssignBulk(t *testing.T) {
	h, addr := newTestHub(t)
	good1 := recordTestAlert(t, h, "0000000000000003", "LAB-TEST")
	good2 := recordTestAlert(t, h, "0000000000000004", "LAB-TEST")
	base := fmt.Sprintf("http://%s", addr)

	// One malformed id fails alone; a duplicate id is one write, not two.
	body := fmt.Sprintf(`{"ids":["%s","zzz","%s","%s"],"assignee":"ana","by":"beto"}`, good1, good2, good1)
	res, raw := postAssign(t, base+"/api/alerts/assign", body)
	if res.StatusCode != 200 {
		t.Fatalf("bulk status = %d body=%s", res.StatusCode, raw)
	}
	var out struct {
		Assigned int `json:"assigned"`
		Failed   int `json:"failed"`
		Results  []struct {
			AlertID string          `json:"alert_id"`
			OK      bool            `json:"ok"`
			Entry   lifecycle.Entry `json:"entry"`
			Error   string          `json:"error"`
		} `json:"results"`
	}
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		t.Fatalf("bulk body: %v (%s)", err, raw)
	}
	if out.Assigned != 2 || out.Failed != 1 || len(out.Results) != 3 {
		t.Fatalf("bulk summary = %d/%d results=%d", out.Assigned, out.Failed, len(out.Results))
	}
	for _, r := range out.Results {
		if r.AlertID == "zzz" {
			if r.OK || !strings.Contains(r.Error, "malformed") {
				t.Fatalf("malformed id result = %+v", r)
			}
			continue
		}
		if !r.OK || r.Entry.Assignee != "ana" {
			t.Fatalf("expected assignment for %s: %+v", r.AlertID, r)
		}
	}
	// The duplicate never produced a second result row.
	count := 0
	for _, r := range out.Results {
		if r.AlertID == good1 {
			count++
		}
	}
	if count != 1 {
		t.Fatalf("duplicate id produced %d results", count)
	}
}

func TestAlertAssignBulkValidation(t *testing.T) {
	_, addr := newTestHub(t)
	base := fmt.Sprintf("http://%s", addr)
	if res, body := postAssign(t, base+"/api/alerts/assign", `{"assignee":"ana"}`); res.StatusCode != 400 || !strings.Contains(body, "at least one") {
		t.Fatalf("empty ids: %d %s", res.StatusCode, body)
	}
	ids := `["` + strings.Repeat("ffffffffffffffff\", \"", 200) + "ffffffffffffffff\"]"
	if res, body := postAssign(t, base+"/api/alerts/assign", `{"ids":`+ids+`,"assignee":"ana"}`); res.StatusCode != 400 || !strings.Contains(body, "limit is") {
		t.Fatalf("over-cap batch: %d %s", res.StatusCode, body)
	}
}

// A caller limited to host groups may only assign the alerts of its
// machines: any other id answers like one that does not exist.
func TestAlertAssignScoped(t *testing.T) {
	_, addr, ids := scopedHub(t, false)
	base := fmt.Sprintf("http://%s", addr)
	madrid := "madrid"

	res, body := scoped(t, http.MethodPost, base+"/api/alerts/"+ids["PC-MAD-01"]+"/assign", &madrid, `{"assignee":"ana","by":"beto"}`)
	if res != 200 {
		t.Fatalf("in-scope assign = %d body=%s", res, body)
	}
	res, body = scoped(t, http.MethodPost, base+"/api/alerts/"+ids["PC-BCN-02"]+"/assign", &madrid, `{"assignee":"ana","by":"beto"}`)
	if res != http.StatusNotFound || !strings.Contains(body, "unknown alert id") {
		t.Fatalf("out-of-scope assign = %d body=%s", res, body)
	}
	// The batch applies the same rule per id without blocking the rest.
	res, body = scoped(t, http.MethodPost, base+"/api/alerts/assign", &madrid,
		fmt.Sprintf(`{"ids":["%s","%s"],"assignee":"ana","by":"beto"}`, ids["PC-MAD-01"], ids["PC-BCN-02"]))
	if res != 200 {
		t.Fatalf("scoped bulk = %d body=%s", res, body)
	}
	var out struct {
		Assigned int `json:"assigned"`
		Failed   int `json:"failed"`
	}
	if err := json.Unmarshal([]byte(body), &out); err != nil {
		t.Fatal(err)
	}
	if out.Assigned != 1 || out.Failed != 1 {
		t.Fatalf("scoped bulk summary = %d/%d", out.Assigned, out.Failed)
	}
}

// The queues behind «Mis alertas» and the unassigned column: the
// assignment filter on the list (ring mode) and on the search (the
// scan the console's table uses).
func TestAlertAssigneeFilter(t *testing.T) {
	h, addr := newTestHub(t)
	mine := recordTestAlert(t, h, "0000000000000005", "LAB-TEST")
	other := recordTestAlert(t, h, "0000000000000006", "LAB-TEST")
	recordTestAlert(t, h, "0000000000000007", "LAB-TEST")
	base := fmt.Sprintf("http://%s", addr)
	if res, _ := postAssign(t, base+"/api/alerts/"+mine+"/assign", `{"assignee":"ana","by":"beto"}`); res.StatusCode != 200 {
		t.Fatal("assign rejected")
	}
	if res, _ := postAssign(t, base+"/api/alerts/"+other+"/assign", `{"assignee":"beto","by":"carla"}`); res.StatusCode != 200 {
		t.Fatal("assign rejected")
	}

	var listed []map[string]any
	getJSON(t, base+"/api/alerts?assignee=ana", &listed)
	if len(listed) != 1 || listed[0]["id"] != mine {
		t.Fatalf("mine = %d rows (%v)", len(listed), listed)
	}
	listed = nil
	getJSON(t, base+"/api/alerts?assignee=none", &listed)
	if len(listed) != 1 || listed[0]["id"] != "0000000000000007" {
		t.Fatalf("unassigned queue = %d rows", len(listed))
	}
	listed = nil
	getJSON(t, base+"/api/alerts?assignee=ANA", &listed) // case-insensitive
	if len(listed) != 1 || listed[0]["id"] != mine {
		t.Fatalf("case-insensitive mine = %d rows", len(listed))
	}

	// The search endpoint scans, so its queue views are exact too.
	var page struct {
		Items []map[string]any `json:"items"`
	}
	getJSON(t, base+"/api/alerts/search?assignee=none", &page)
	if len(page.Items) != 1 || page.Items[0]["id"] != "0000000000000007" {
		t.Fatalf("search unassigned = %d rows", len(page.Items))
	}
	page.Items = nil
	getJSON(t, base+"/api/alerts/search?assignee=ana&status=open", &page)
	if len(page.Items) != 1 || page.Items[0]["id"] != mine {
		t.Fatalf("search mine+open = %d rows", len(page.Items))
	}
}

func TestAlertExportAssigneeFilter(t *testing.T) {
	h, addr := newTestHub(t)
	mine := recordTestAlert(t, h, "0000000000000008", "LAB-TEST")
	recordTestAlert(t, h, "0000000000000009", "LAB-TEST")
	base := fmt.Sprintf("http://%s", addr)
	if res, _ := postAssign(t, base+"/api/alerts/"+mine+"/assign", `{"assignee":"ana","by":"beto"}`); res.StatusCode != 200 {
		t.Fatal("assign rejected")
	}
	res, err := http.Get(base + "/api/alerts/export?assignee=ana")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var exported map[string]any
	if err := json.NewDecoder(res.Body).Decode(&exported); err != nil {
		t.Fatalf("jsonl decode: %v", err)
	}
	if exported["id"] != mine || exported["assignee"] != "ana" {
		t.Fatalf("exported = %v", exported)
	}
	res2, err := http.Get(base + "/api/alerts/export?assignee=none")
	if err != nil {
		t.Fatal(err)
	}
	defer res2.Body.Close()
	var other map[string]any
	if err := json.NewDecoder(res2.Body).Decode(&other); err != nil {
		t.Fatalf("jsonl decode: %v", err)
	}
	if other["id"] == mine {
		t.Fatalf("unassigned export leaked an assigned alert: %v", other)
	}
}

// Live consoles learn about assignments through the SAME alert_lifecycle
// frame the status endpoint uses (one topic, one handler on the console
// side): the frame must carry the assignee fields.
func TestAlertAssignSSEBroadcast(t *testing.T) {
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
		`{"assignee":"ana","by":"ops"}`)

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
	if entry["assignee"] != "ana" || entry["assigned_by"] != "ops" {
		t.Fatalf("broadcast entry = %v", entry)
	}
}
