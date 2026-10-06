// Tests for the REP-1 report surfaces and the noise endpoint: the
// HTTP contract (status codes, error hints, CSV shape) and the wiring
// into the hub's stores. The numbers themselves are covered by the
// internal/report unit tests; here the question is whether the API
// gathers the right records and answers with the right codes.

package api

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/alert"
	"github.com/Ruby570bocadito/bluetardigrade/internal/fleet"
	"github.com/Ruby570bocadito/bluetardigrade/internal/incident"
	"github.com/Ruby570bocadito/bluetardigrade/internal/lifecycle"
	"github.com/Ruby570bocadito/bluetardigrade/internal/report"
	"github.com/Ruby570bocadito/bluetardigrade/internal/store"
	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
)

func get(t *testing.T, url string) (int, string, http.Header) {
	t.Helper()
	res, err := http.Get(url)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	body, err := io.ReadAll(res.Body)
	if err != nil {
		t.Fatal(err)
	}
	return res.StatusCode, string(body), res.Header
}

func seedAlert(t *testing.T, h *Hub, id, rule, sev, host string, age time.Duration, tags ...string) {
	t.Helper()
	h.RecordAlert(alert.Alert{
		ID:        id,
		Timestamp: time.Now().UTC().Add(-age).Format(time.RFC3339Nano),
		RuleID:    rule,
		RuleName:  "rule " + rule,
		Severity:  sev,
		Host:      host,
		EventType: model.TypeProcessCreate,
		Summary:   "summary " + id,
		Tags:      tags,
		MatchedOn: []string{"image"},
	})
}

func TestReportCatalogListsKinds(t *testing.T) {
	_, addr := newTestHub(t)
	code, body, _ := get(t, "http://"+addr+"/api/reports")
	if code != http.StatusOK {
		t.Fatalf("catalog = %d", code)
	}
	var got reportCatalog
	if err := json.Unmarshal([]byte(body), &got); err != nil {
		t.Fatal(err)
	}
	kinds := map[string]bool{}
	for _, entry := range got.Reports {
		kinds[entry.Kind] = true
		if len(entry.Formats) == 0 {
			t.Fatalf("kind %s declares no formats", entry.Kind)
		}
	}
	for _, want := range []string{report.KindExecutive, report.KindIncident, report.KindFleet, report.KindSoc} {
		if !kinds[want] {
			t.Fatalf("catalog misses kind %s: %v", want, kinds)
		}
	}
}

func TestReportUnknownKindNamesValidOnes(t *testing.T) {
	_, addr := newTestHub(t)
	code, body, _ := get(t, "http://"+addr+"/api/reports/weekly-vibes")
	if code != http.StatusNotFound {
		t.Fatalf("unknown kind = %d", code)
	}
	for _, want := range []string{"executive", "incident", "fleet", "soc"} {
		if !strings.Contains(body, want) {
			t.Fatalf("404 hint misses %q: %s", want, body)
		}
	}
}

func TestReportExecutiveAggregatesSeededAlerts(t *testing.T) {
	h, addr := newTestHub(t)
	seedAlert(t, h, "0123456789abcdef", "R1", "high", "PC-1", time.Hour, "attack.credential-access")
	seedAlert(t, h, "0123456789abcdee", "R1", "high", "PC-1", 2*time.Hour)
	seedAlert(t, h, "0123456789abcded", "R2", "low", "PC-2", 3*time.Hour)
	if _, err := h.lifecycle.Set("0123456789abcdef", lifecycle.StatusClosed, "", "ana"); err != nil {
		t.Fatal(err)
	}
	code, body, _ := get(t, "http://"+addr+"/api/reports/executive?window=24h")
	if code != http.StatusOK {
		t.Fatalf("executive = %d: %s", code, body)
	}
	var rep report.Executive
	if err := json.Unmarshal([]byte(body), &rep); err != nil {
		t.Fatal(err)
	}
	if rep.Kind != report.KindExecutive || rep.AlertsTotal != 3 {
		t.Fatalf("executive = %+v", rep)
	}
	if rep.BySeverity["high"] != 2 || rep.ByStatus["closed"] != 1 || rep.ByStatus["new"] != 2 {
		t.Fatalf("aggregates = %+v %+v", rep.BySeverity, rep.ByStatus)
	}
	if rep.HostsAffected != 2 || rep.TopRules[0].RuleID != "R1" || rep.TopRules[0].Count != 2 {
		t.Fatalf("hosts/top = %d %+v", rep.HostsAffected, rep.TopRules)
	}
	if rep.Source != report.SourceRing || rep.OldestRecord == "" {
		t.Fatalf("ring honesty missing: source %q oldest %q", rep.Source, rep.OldestRecord)
	}
}

func TestReportExecutiveCSVIsEscapedAndTyped(t *testing.T) {
	h, addr := newTestHub(t)
	seedAlert(t, h, "0123456789abcdef", "=SUM(A1)", "high", "PC-1", time.Hour)
	code, body, header := get(t, "http://"+addr+"/api/reports/executive?format=csv")
	if code != http.StatusOK {
		t.Fatalf("csv = %d", code)
	}
	if ct := header.Get("Content-Type"); !strings.HasPrefix(ct, "text/csv") {
		t.Fatalf("content type = %q", ct)
	}
	if !strings.Contains(body, "'=SUM(A1)") {
		t.Fatalf("formula escape missing: %s", body)
	}
	if !strings.Contains(body, "alerts_total,1") {
		t.Fatalf("metric rows missing: %s", body)
	}
	if !strings.Contains(header.Get("Content-Disposition"), "executive-") {
		t.Fatalf("disposition = %q", header.Get("Content-Disposition"))
	}
}

func TestReportWindowValidationAnswers400(t *testing.T) {
	_, addr := newTestHub(t)
	for _, q := range []string{"?window=banana", "?window=5m", "?window=400d"} {
		code, body, _ := get(t, "http://"+addr+"/api/reports/executive"+q)
		if code != http.StatusBadRequest {
			t.Fatalf("%s = %d (%s)", q, code, body)
		}
	}
	code, _, _ := get(t, "http://"+addr+"/api/reports/executive?format=pdf")
	if code != http.StatusBadRequest {
		t.Fatalf("bad format = %d", code)
	}
}

func TestReportFleetCoverageWithAndWithoutTracker(t *testing.T) {
	h, addr := newTestHub(t)
	tracker := fleet.New()
	tracker.Observe(sampleEvent("ev1"), "127.0.0.1:40000", time.Now())
	h.SetFleet(tracker)
	h.RecordEvent(sampleEvent("ev1"))

	code, body, _ := get(t, "http://"+addr+"/api/reports/fleet?window=24h")
	if code != http.StatusOK {
		t.Fatalf("fleet = %d: %s", code, body)
	}
	var rep report.FleetCoverage
	if err := json.Unmarshal([]byte(body), &rep); err != nil {
		t.Fatal(err)
	}
	if !rep.Enabled || rep.Summary.Total != 1 || rep.Summary.NoSignalInWindow != 0 {
		t.Fatalf("fleet = %+v", rep.Summary)
	}
	if len(rep.Hosts) != 1 || rep.Hosts[0].EventsInWindow != 1 {
		t.Fatalf("hosts = %+v", rep.Hosts)
	}
}

func TestReportFleetWithoutTrackerStaysDisabled(t *testing.T) {
	_, addr := newTestHub(t)
	code, body, _ := get(t, "http://"+addr+"/api/reports/fleet")
	if code != http.StatusOK {
		t.Fatalf("fleet = %d", code)
	}
	var rep report.FleetCoverage
	if err := json.Unmarshal([]byte(body), &rep); err != nil {
		t.Fatal(err)
	}
	if rep.Enabled || rep.Summary.Total != 0 {
		t.Fatalf("disabled fleet must not invent coverage: %+v", rep)
	}
}

func TestReportSocBucketsSeededTriage(t *testing.T) {
	h, addr := newTestHub(t)
	seedAlert(t, h, "0123456789abcdef", "R1", "low", "PC-1", time.Hour)
	seedAlert(t, h, "0123456789abcdee", "R1", "low", "PC-2", 2*time.Hour)
	if _, err := h.lifecycle.Set("0123456789abcdef", lifecycle.StatusAcknowledged, "", "ana"); err != nil {
		t.Fatal(err)
	}
	code, body, _ := get(t, "http://"+addr+"/api/reports/soc?window=24h")
	if code != http.StatusOK {
		t.Fatalf("soc = %d: %s", code, body)
	}
	var rep report.SocActivity
	if err := json.Unmarshal([]byte(body), &rep); err != nil {
		t.Fatal(err)
	}
	if rep.Created != 2 || rep.Backlog.Acknowledged != 1 || rep.Backlog.New != 1 {
		t.Fatalf("soc = %+v", rep)
	}
	if rep.ByOperator["ana"] != 1 {
		t.Fatalf("by_operator = %v", rep.ByOperator)
	}
	if rep.MeanTimeToAckSeconds <= 0 {
		t.Fatalf("mtta = %v", rep.MeanTimeToAckSeconds)
	}
}

func TestReportIncidentBundlesCase(t *testing.T) {
	h, addr := newTestHub(t)
	seedAlert(t, h, "0123456789abcdef", "R1", "high", "PC-1", time.Hour)
	inc, err := h.incidents.Create(incident.Create{
		Title: "Caso laboratorio", Severity: "high", By: "ana",
		AlertIDs: []string{"0123456789abcdef", "ffffffffffffffff"},
	})
	if err != nil {
		t.Fatal(err)
	}

	code, body, _ := get(t, "http://"+addr+"/api/reports/incident?id="+inc.ID)
	if code != http.StatusOK {
		t.Fatalf("incident = %d: %s", code, body)
	}
	var rep report.IncidentReport
	if err := json.Unmarshal([]byte(body), &rep); err != nil {
		t.Fatal(err)
	}
	if rep.Kind != report.KindIncident || rep.Incident.Title != "Caso laboratorio" {
		t.Fatalf("case = %+v", rep.Incident)
	}
	if len(rep.Alerts) != 2 || !rep.Alerts[0].Found || rep.Alerts[1].Found {
		t.Fatalf("alerts = %+v", rep.Alerts)
	}
	if rep.Alerts[0].Status != "new" {
		t.Fatalf("overlay missing: %+v", rep.Alerts[0])
	}
	if rep.Incident.Status != string(incident.StatusOpen) {
		t.Fatalf("status = %q", rep.Incident.Status)
	}

	// window is rejected for this kind: a case bundle is point in time
	code, _, _ = get(t, "http://"+addr+"/api/reports/incident?id="+inc.ID+"&window=24h")
	if code != http.StatusBadRequest {
		t.Fatalf("incident+window = %d", code)
	}
	// unknown id -> 404, malformed id -> 400
	code, _, _ = get(t, "http://"+addr+"/api/reports/incident?id=ffffffffffffffff")
	if code != http.StatusNotFound {
		t.Fatalf("unknown incident = %d", code)
	}
	code, _, _ = get(t, "http://"+addr+"/api/reports/incident?id=nope")
	if code != http.StatusBadRequest {
		t.Fatalf("malformed id = %d", code)
	}
}

func TestNoiseEndpointAggregatesSeededEvents(t *testing.T) {
	h, addr := newTestHub(t)
	for i := 0; i < 3; i++ {
		ev := sampleEvent(fmt.Sprintf("vantage-%d", i))
		ev.Timestamp = time.Now().UTC().Add(-time.Duration(i+1) * time.Minute)
		ev.Process = &model.Process{PID: i, Name: "vantage.exe", Image: `C:\Program Files\Lenovo\vantage.exe`}
		h.RecordEvent(ev)
	}
	for i := 0; i < 2; i++ {
		ev := sampleEvent(fmt.Sprintf("dns-%d", i))
		ev.Timestamp = time.Now().UTC().Add(-time.Duration(i+1) * time.Minute)
		ev.Process = nil
		ev.Network = &model.Network{Protocol: "dns", Domain: "Update.Example.com"}
		h.RecordEvent(ev)
	}
	code, body, _ := get(t, "http://"+addr+"/api/noise?window=1h")
	if code != http.StatusOK {
		t.Fatalf("noise = %d: %s", code, body)
	}
	var rep report.Noise
	if err := json.Unmarshal([]byte(body), &rep); err != nil {
		t.Fatal(err)
	}
	if rep.Kind != report.KindNoise || rep.Scanned.Events != 5 || rep.Host != "" {
		t.Fatalf("envelope = %+v", rep)
	}
	if len(rep.Processes) != 1 || rep.Processes[0].Count != 3 ||
		rep.Processes[0].Image != `c:\program files\lenovo\vantage.exe` {
		t.Fatalf("processes = %+v", rep.Processes)
	}
	if len(rep.Domains) != 1 || rep.Domains[0].Domain != "update.example.com" || rep.Domains[0].Count != 2 {
		t.Fatalf("domains = %+v", rep.Domains)
	}
	if rep.Rules == nil {
		t.Fatalf("rules must default to an empty list, not null")
	}
}

func TestNoiseHostFilterAndLimit(t *testing.T) {
	h, addr := newTestHub(t)
	ev1 := sampleEvent("hosted-1")
	ev1.Host = "PC-1"
	ev1.Process = &model.Process{PID: 1, Name: "a.exe", Image: `C:\a.exe`}
	ev2 := sampleEvent("hosted-2")
	ev2.Host = "PC-2"
	ev2.Process = &model.Process{PID: 2, Name: "b.exe", Image: `C:\b.exe`}
	h.RecordEvent(ev1)
	h.RecordEvent(ev2)

	code, body, _ := get(t, "http://"+addr+"/api/noise?window=1h&host=pc-1")
	if code != http.StatusOK {
		t.Fatalf("noise = %d", code)
	}
	var rep report.Noise
	if err := json.Unmarshal([]byte(body), &rep); err != nil {
		t.Fatal(err)
	}
	if rep.Host != "pc-1" || rep.Scanned.Events != 1 || len(rep.Processes) != 1 || rep.Processes[0].Image != `c:\a.exe` {
		t.Fatalf("host filter: %+v", rep)
	}
}

func TestNoiseWindowValidation(t *testing.T) {
	_, addr := newTestHub(t)
	// Go durations: 1000h is past the noise window max (720h = 30d).
	code, body, _ := get(t, "http://"+addr+"/api/noise?window=1000h")
	if code != http.StatusBadRequest || !strings.Contains(body, "out of range") {
		t.Fatalf("noise window = %d (%s)", code, body)
	}
	code, _, _ = get(t, "http://"+addr+"/api/noise")
	if code != http.StatusOK {
		t.Fatalf("default window = %d", code)
	}
}

// The truncated flag belongs to the store SCAN, not to the filtered
// set: when the window holds more events than one scan may read, a
// host-filtered report must still say so, or it silently undercounts
// while claiming the whole window (found by Seguridad A reviewing the
// round-1 report code).
func TestNoiseHostFilterKeepsScanTruncationHonest(t *testing.T) {
	h, addr := newTestHub(t)
	st, err := store.Open(t.TempDir() + "/noise-trunc.db")
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	h.SetStore(st)

	base := time.Now().UTC().Add(-time.Hour)
	total := reportScanLimit + 1 // one event beyond what a scan may read
	batch := make([]*model.Event, 0, 500)
	for i := 0; i < total; i++ {
		host := "pc-a"
		if i == total-1 { // the NEWEST event: a filtered host must survive the cap
			host = "pc-b"
		}
		ev := &model.Event{
			ID:        fmt.Sprintf("trunc-%06d", i),
			Timestamp: base.Add(time.Duration(i) * time.Millisecond).UTC(),
			Type:      model.TypeProcessCreate,
			Source:    "test",
			Host:      host,
			Process:   &model.Process{PID: i + 1, Name: "a.exe", Image: `C:\a.exe`},
		}
		batch = append(batch, ev)
		if len(batch) == 500 || i == total-1 {
			if res := st.InsertEvents(batch); len(res.Failed) > 0 || len(res.Conflicts) > 0 {
				t.Fatalf("seed insert: failed=%v conflicts=%v", res.Failed, res.Conflicts)
			}
			batch = batch[:0]
		}
	}

	// Host pc-b has exactly one event and it is inside the scan, but the
	// window holds more events than one scan reads: truncated must stay
	// true even though the filtered set is tiny.
	code, body, _ := get(t, "http://"+addr+"/api/noise?window=24h&host=pc-b")
	if code != http.StatusOK {
		t.Fatalf("noise host filter = %d: %s", code, body)
	}
	var rep report.Noise
	if err := json.Unmarshal([]byte(body), &rep); err != nil {
		t.Fatal(err)
	}
	if rep.Scanned.Events != 1 || len(rep.Processes) != 1 {
		t.Fatalf("host filter aggregates: %+v", rep.Scanned)
	}
	if !rep.Scanned.Truncated {
		t.Fatalf("a capped scan filtered to one host must stay truncated: %+v", rep.Scanned)
	}
	// The unfiltered view of the same window agrees.
	code, body, _ = get(t, "http://"+addr+"/api/noise?window=24h")
	if code != http.StatusOK {
		t.Fatalf("noise = %d: %s", code, body)
	}
	var all report.Noise
	if err := json.Unmarshal([]byte(body), &all); err != nil {
		t.Fatal(err)
	}
	if all.Scanned.Events != reportScanLimit || !all.Scanned.Truncated {
		t.Fatalf("unfiltered scan: %+v, want %d events and truncated", all.Scanned, reportScanLimit)
	}
}

// The alert scan carries its own truncation flag: a window holding more
// alerts than one scan reads must say so even when the EVENT scan fits
// under the cap. Regression: handleNoise used to keep only the events
// scan's flag, so a store-backed window with plenty of alerts and few
// events presented partial top lists as complete.
func TestNoiseAlertScanTruncationIsReported(t *testing.T) {
	h, addr := newTestHub(t)
	st, err := store.Open(t.TempDir() + "/noise-alert-trunc.db")
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	h.SetStore(st)

	base := time.Now().UTC().Add(-time.Hour)
	for i := 0; i < reportScanLimit+1; i++ { // one alert beyond the scan cap
		a := alert.Alert{
			ID:        fmt.Sprintf("%016x", i),
			Timestamp: base.Add(time.Duration(i) * time.Millisecond).UTC().Format(time.RFC3339Nano),
			RuleID:    "noise-rule",
			Severity:  "low",
			Host:      "pc-a",
			Summary:   "alert-scan-truncation",
		}
		if err := st.InsertAlert(a); err != nil {
			t.Fatal(err)
		}
	}

	code, body, _ := get(t, "http://"+addr+"/api/noise?window=24h")
	if code != http.StatusOK {
		t.Fatalf("noise = %d: %s", code, body)
	}
	var rep report.Noise
	if err := json.Unmarshal([]byte(body), &rep); err != nil {
		t.Fatal(err)
	}
	if rep.Scanned.Alerts != reportScanLimit || !rep.Scanned.Truncated {
		t.Fatalf("an alert scan capped by its own budget must be truncated: %+v", rep.Scanned)
	}
}

// The decision recorded in the lifecycle store reaches /api/noise as
// false_positive_pct on the wire (the integration point IMP-B's
// screen consumes: POST /api/alerts/{id}/status with a decision, then
// the FP rate of that rule moves).
func TestNoiseCarriesDecisionFromLifecycle(t *testing.T) {
	h, addr := newTestHub(t)
	h.RecordAlert(alert.Alert{
		Timestamp: time.Now().UTC().Add(-time.Minute).Format(time.RFC3339Nano), RuleID: "R1", RuleName: "test rule",
		Severity: "low", Host: "LAB-TEST", EventID: "ev-1",
		EventType: "process.create", Summary: "s", MatchedOn: []string{"process.name"},
	})
	h.RecordAlert(alert.Alert{
		Timestamp: time.Now().UTC().Add(-2 * time.Minute).Format(time.RFC3339Nano), RuleID: "R1", RuleName: "test rule",
		Severity: "low", Host: "LAB-TEST", EventID: "ev-2",
		EventType: "process.create", Summary: "s", MatchedOn: []string{"process.name"},
	})
	var listed []map[string]any
	getJSON(t, fmt.Sprintf("http://%s/api/alerts", addr), &listed)
	ids := make([]string, 0, 2)
	for _, a := range listed {
		ids = append(ids, a["id"].(string))
	}
	if _, err := h.lifecycle.Set(ids[0], lifecycle.StatusClosed, lifecycle.DecisionFalsePositive, "fp", "ana"); err != nil {
		t.Fatalf("Set: %v", err)
	}
	code, body, _ := get(t, "http://"+addr+"/api/noise?window=1h")
	if code != http.StatusOK {
		t.Fatalf("noise = %d: %s", code, body)
	}
	if !strings.Contains(body, `"false_positive_pct":50`) {
		t.Fatalf("wire body does not carry the 50%% FP rate: %s", body)
	}
	var rep report.Noise
	if err := json.Unmarshal([]byte(body), &rep); err != nil {
		t.Fatal(err)
	}
	if len(rep.Rules) != 1 || rep.Rules[0].FalsePositivePct != 50.0 {
		t.Fatalf("rules = %+v", rep.Rules)
	}
}
