package api

import (
	"bufio"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/Ruby570bocadito/security-framework/internal/alert"
	"github.com/Ruby570bocadito/security-framework/internal/rules"
	"github.com/Ruby570bocadito/security-framework/pkg/model"
)

func newTestHub(t *testing.T) (*Hub, string) {
	t.Helper()
	h, err := New("127.0.0.1:0")
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	go func() { _ = h.Run() }()
	t.Cleanup(h.Shutdown)
	return h, h.Addr()
}

func sampleEvent(id string) *model.Event {
	return &model.Event{
		ID:        id,
		Timestamp: time.Now().UTC(),
		Type:      model.TypeProcessCreate,
		Source:    "test",
		Host:      "LAB-TEST",
		Process:   &model.Process{PID: 42, Name: "powershell.exe"},
	}
}

func getJSON(t *testing.T, url string, out any) {
	t.Helper()
	res, err := http.Get(url)
	if err != nil {
		t.Fatalf("GET %s: %v", url, err)
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		t.Fatalf("GET %s: status %d", url, res.StatusCode)
	}
	if err := json.NewDecoder(res.Body).Decode(out); err != nil {
		t.Fatalf("decode %s: %v", url, err)
	}
}

func TestStatsAndRings(t *testing.T) {
	h, addr := newTestHub(t)
	re, err := rules.LoadDir("../../rules")
	if err != nil {
		t.Fatalf("LoadDir: %v", err)
	}
	h.SetRules(re)
	h.SetCounters(func() (uint64, uint64) { return 3, 1 })

	h.RecordEvent(sampleEvent("ev-1"))
	h.RecordEvent(sampleEvent("ev-2"))
	h.RecordAlert(alert.Alert{
		Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
		RuleID:    "r1", RuleName: "test rule", Severity: "critical",
		Host: "LAB-TEST", EventID: "ev-2", EventType: "process.create",
		Summary: "s", MatchedOn: []string{"process.name"},
	})

	var stats map[string]any
	getJSON(t, fmt.Sprintf("http://%s/api/stats", addr), &stats)
	if stats["events_total"].(float64) != 3 {
		t.Errorf("events_total = %v, want 3", stats["events_total"])
	}
	if stats["dropped"].(float64) != 1 {
		t.Errorf("dropped = %v, want 1", stats["dropped"])
	}
	if stats["alerts_total"].(float64) != 1 {
		t.Errorf("alerts_total = %v, want 1", stats["alerts_total"])
	}
	if stats["mode"] != "engine" {
		t.Errorf("mode = %v, want engine", stats["mode"])
	}
	bySev := stats["by_severity"].(map[string]any)
	if bySev["critical"].(float64) != 1 {
		t.Errorf("by_severity[critical] = %v, want 1", bySev["critical"])
	}

	var events []*model.Event
	getJSON(t, fmt.Sprintf("http://%s/api/events", addr), &events)
	if len(events) != 2 || events[0].ID != "ev-2" || events[1].ID != "ev-1" {
		t.Errorf("events newest-first wrong: %+v", events)
	}

	var alerts []map[string]any
	getJSON(t, fmt.Sprintf("http://%s/api/alerts", addr), &alerts)
	if len(alerts) != 1 || alerts[0]["rule_id"] != "r1" {
		t.Errorf("alerts wrong: %+v", alerts)
	}
}

func TestRulesEndpointShape(t *testing.T) {
	h, addr := newTestHub(t)
	re, err := rules.LoadDir("../../rules")
	if err != nil {
		t.Fatalf("LoadDir: %v", err)
	}
	h.SetRules(re)

	var rulesOut []map[string]any
	getJSON(t, fmt.Sprintf("http://%s/api/rules", addr), &rulesOut)
	if len(rulesOut) < 3 {
		t.Fatalf("expected at least 3 rules, got %d", len(rulesOut))
	}
	found := false
	for _, r := range rulesOut {
		if r["mitre"] == "T1059.001" {
			found = true
			if r["tactic"] != "Execution" {
				t.Errorf("tactic = %v, want Execution", r["tactic"])
			}
			if _, ok := r["conditions"].([]any); !ok {
				t.Errorf("conditions not a list")
			}
		}
	}
	if !found {
		t.Errorf("T1059.001 rule missing from /api/rules")
	}
}

func TestSSEStream(t *testing.T) {
	h, addr := newTestHub(t)

	req, _ := http.NewRequest("GET", fmt.Sprintf("http://%s/api/stream", addr), nil)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("stream GET: %v", err)
	}
	defer res.Body.Close()
	if !strings.HasPrefix(res.Header.Get("Content-Type"), "text/event-stream") {
		t.Fatalf("content-type = %q", res.Header.Get("Content-Type"))
	}

	frames := make(chan string, 8)
	go func() {
		sc := bufio.NewScanner(res.Body)
		var cur strings.Builder
		for sc.Scan() {
			line := sc.Text()
			cur.WriteString(line + "\n")
			if line == "" {
				frames <- cur.String()
				cur.Reset()
			}
		}
	}()

	// give the subscriber a moment to register, then publish
	time.Sleep(150 * time.Millisecond)
	h.RecordEvent(sampleEvent("ev-sse-1"))

	deadline := time.After(3 * time.Second)
	for {
		select {
		case f := <-frames:
			if strings.Contains(f, "event: event") && strings.Contains(f, "ev-sse-1") {
				return // got the live frame
			}
		case <-deadline:
			t.Fatal("did not receive the SSE event frame in time")
		}
	}
}
