package api

// Integration tests for the SQLite store wiring: when a store is
// attached, the telemetry endpoints read the persistent history
// instead of the in-memory rings, and /api/stats reports the store.

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/alert"
	"github.com/Ruby570bocadito/bluetardigrade/internal/store"
	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
)

func TestFailedPersistenceIsVisibleInStatsAndMetrics(t *testing.T) {
	st, err := store.Open(t.TempDir() + "/failed.db")
	if err != nil {
		t.Fatal(err)
	}
	h, addr := newTestHub(t)
	h.SetStore(st)
	// Inject a real write failure while the hub keeps accepting telemetry.
	if err := st.Close(); err != nil {
		t.Fatal(err)
	}
	h.RecordEvent(&model.Event{ID: "failed-event", Timestamp: time.Now().UTC(), Type: model.TypeProcessCreate, Host: "fixture"})
	h.RecordAlert(alert.Alert{ID: "failed-alert", Timestamp: time.Now().UTC().Format(time.RFC3339Nano), RuleID: "fixture-rule", Severity: "high"})
	var stats map[string]any
	getJSON(t, "http://"+addr+"/api/stats", &stats)
	if stats["store_write_failures"] != float64(2) || stats["store_enabled"] != true || stats["events_buffered"] != float64(1) {
		t.Fatalf("lost evidence not surfaced: %+v", stats)
	}
	res, err := http.Get("http://" + addr + "/metrics")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(res.Body)
	if !strings.Contains(string(body), "sf_store_write_failures_total 2\n") {
		t.Fatalf("missing failed-write counter: %s", body)
	}
}

func TestStoreBackedTelemetry(t *testing.T) {
	path := t.TempDir() + "/api.db"
	st, err := store.Open(path)
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	h, addr := newTestHub(t)
	h.SetStore(st)

	h.RecordEvent(&model.Event{
		ID: "ev-1", Timestamp: time.Now().UTC(), Type: model.TypeProcessCreate,
		Source: "test", Host: "LAB-A",
		Process: &model.Process{PID: 1, Name: "powershell.exe", CommandLine: "whoami /priv"},
	})
	h.RecordEvent(&model.Event{
		ID: "ev-2", Timestamp: time.Now().UTC(), Type: model.TypeNetworkConnect,
		Source: "test", Host: "LAB-B",
		Network: &model.Network{DestinationIP: "10.0.0.9", DestinationPort: 443},
	})
	h.RecordAlert(alert.Alert{
		Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
		RuleID:    "r-1", RuleName: "test rule", Severity: "high",
		Host: "LAB-A", EventID: "ev-1", EventType: model.TypeProcessCreate,
		Summary: "did a thing", MatchedOn: []string{"process.name"},
	})

	// stats expose the store and its live counts
	var stats map[string]any
	getJSON(t, "http://"+addr+"/api/stats", &stats)
	if stats["store_enabled"] != true {
		t.Fatalf("store_enabled = %v, want true", stats["store_enabled"])
	}
	if stats["store_events"].(float64) != 2 || stats["store_alerts"].(float64) != 1 {
		t.Fatalf("store counts = %v/%v, want 2/1", stats["store_events"], stats["store_alerts"])
	}

	// lists read from the store: host filter (case-insensitive) hits
	// the persisted rows, not just the ring
	var events []*model.Event
	getJSON(t, "http://"+addr+"/api/events?host=lab-a", &events)
	if len(events) != 1 || events[0].ID != "ev-1" {
		t.Fatalf("store-backed events: got %d, want [ev-1]", len(events))
	}
	// free-text filter over the stored haystack
	getJSON(t, "http://"+addr+"/api/events?q=whoami", &events)
	if len(events) != 1 || events[0].ID != "ev-1" {
		t.Fatalf("store-backed q filter: got %d, want [ev-1]", len(events))
	}

	// alerts: severity filter from the store
	var alerts []alert.Alert
	getJSON(t, "http://"+addr+"/api/alerts?severity=high", &alerts)
	if len(alerts) != 1 || alerts[0].RuleID != "r-1" {
		t.Fatalf("store-backed alerts: got %d, want [r-1]", len(alerts))
	}

	// export keeps the chronological oldest-first JSONL contract
	res, err := http.Get("http://" + addr + "/api/alerts/export?format=jsonl")
	if err != nil {
		t.Fatalf("export GET: %v", err)
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(res.Body)
	lines := strings.Split(strings.TrimRight(string(body), "\n"), "\n")
	if len(lines) != 1 || !strings.Contains(lines[0], `"rule_id":"r-1"`) {
		t.Fatalf("store-backed export: %d lines, want 1 with r-1 (%q)", len(lines), body)
	}

	// restart: a fresh hub on the same file serves the history
	if err := st.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}
	st2, err := store.Open(path)
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	defer st2.Close()
	h2, addr2 := newTestHub(t)
	h2.SetStore(st2)
	var revived []*model.Event
	getJSON(t, "http://"+addr2+"/api/events", &revived)
	if len(revived) != 2 {
		t.Fatalf("history across restart: got %d events, want 2", len(revived))
	}
	var stats2 map[string]any
	getJSON(t, "http://"+addr2+"/api/stats", &stats2)
	if stats2["store_events"].(float64) != 2 {
		t.Fatalf("counts not seeded after restart: %v", stats2["store_events"])
	}
	// JSON contract unchanged: the round-tripped event marshals like
	// the wire format (revived[0] is the newest: ev-2, network.connect)
	raw, err := json.Marshal(revived[0])
	if err != nil || !strings.Contains(string(raw), `"type":"network.connect"`) {
		t.Fatalf("round-trip event malformed: %s, err %v", raw, err)
	}
}

// TestFreeTextSeparatorNeedleSameAnswerRingAndStore: the store joins
// its search column with \x1f so a needle can never cross field
// boundaries; the same rune arriving URL-encoded as %1F must not
// forge that crossing — otherwise the same question gets different
// answers depending on whether -store is on. The needle is stripped
// at parseRecordFilter, the chokepoint both backends share.
func TestFreeTextSeparatorNeedleSameAnswerRingAndStore(t *testing.T) {
	mkEvent := func() *model.Event {
		return &model.Event{
			ID: "ev-sep", Timestamp: time.Now().UTC(), Type: model.TypeProcessCreate,
			Source: "test", Host: "ALPHA", User: "bravo",
			Process: &model.Process{PID: 1, Name: "lsass.exe"},
		}
	}
	// ring mode
	h, addr := newTestHub(t)
	h.RecordEvent(mkEvent())
	// store mode
	st, err := store.Open(t.TempDir() + "/parity.db")
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	defer st.Close()
	h2, addr2 := newTestHub(t)
	h2.SetStore(st)
	h2.RecordEvent(mkEvent())

	// sanity: the plain needle finds the event on BOTH backends
	var ringHits, storeHits []*model.Event
	getJSON(t, "http://"+addr+"/api/events?q=alpha", &ringHits)
	getJSON(t, "http://"+addr2+"/api/events?q=alpha", &storeHits)
	if len(ringHits) != 1 || len(storeHits) != 1 {
		t.Fatalf("sanity q=alpha: ring=%d store=%d, want 1/1", len(ringHits), len(storeHits))
	}
	// the separator-carrying needle crosses fields on NEITHER
	// backend: "alpha<sep>bravo" spans the adjacent host|user
	// haystack parts, so a forgeable separator would answer 1 on
	// the store while the per-field ring answers 0
	getJSON(t, "http://"+addr+"/api/events?q=alpha%1Fbravo", &ringHits)
	getJSON(t, "http://"+addr2+"/api/events?q=alpha%1Fbravo", &storeHits)
	if len(ringHits) != 0 || len(storeHits) != 0 {
		t.Fatalf("separator needle: ring=%d store=%d, want 0/0", len(ringHits), len(storeHits))
	}
}
