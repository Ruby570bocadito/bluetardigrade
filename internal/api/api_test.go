package api

import (
	"bufio"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/alert"
	"github.com/Ruby570bocadito/bluetardigrade/internal/baseline"
	"github.com/Ruby570bocadito/bluetardigrade/internal/beacon"
	"github.com/Ruby570bocadito/bluetardigrade/internal/correlate"
	"github.com/Ruby570bocadito/bluetardigrade/internal/intel"
	"github.com/Ruby570bocadito/bluetardigrade/internal/notify"
	"github.com/Ruby570bocadito/bluetardigrade/internal/rules"
	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
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
	h.SetCounters(func() (uint64, uint64, uint64) { return 3, 1, 2 })

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

func exportAlerts() []alert.Alert {
	now := time.Now().UTC()
	return []alert.Alert{
		{
			Timestamp: now.Add(-2 * time.Minute).Format(time.RFC3339Nano),
			RuleID:    "r1", RuleName: "persistencia, clave Run", Severity: "high",
			Host: "LAB-TEST", User: "ana", EventID: "ev-1", EventType: "registry.set",
			Summary: `reg add "HKCU\Run" /v x`, Message: "Persistencia en LAB-TEST",
			Notify: true, MatchedOn: []string{"registry.key", "registry.operation"},
			Tags: []string{"attack.t1547.001", "attack.persistence"},
		},
		{
			Timestamp: now.Add(-1 * time.Minute).Format(time.RFC3339Nano),
			RuleID:    "r2", RuleName: "lsass", Severity: "critical",
			Host: "LAB-TEST", EventID: "ev-2", EventType: "process.access",
			Summary:   "mimikatz \"sekurlsa::logonpasswords\"",
			MatchedOn: []string{"target.name"},
		},
	}
}

func TestAlertsExportNDJSON(t *testing.T) {
	h, addr := newTestHub(t)
	for _, a := range exportAlerts() {
		h.RecordAlert(a)
	}

	res, err := http.Get(fmt.Sprintf("http://%s/api/alerts/export?format=ndjson", addr))
	if err != nil {
		t.Fatalf("export: %v", err)
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		t.Fatalf("export status %d", res.StatusCode)
	}
	if !strings.HasPrefix(res.Header.Get("Content-Disposition"), `attachment; filename="alerts-`) {
		t.Errorf("content-disposition = %q", res.Header.Get("Content-Disposition"))
	}

	var got []alert.Alert
	sc := bufio.NewScanner(res.Body)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" {
			continue
		}
		var a alert.Alert
		if err := json.Unmarshal([]byte(line), &a); err != nil {
			t.Fatalf("linea ndjson invalida %q: %v", line, err)
		}
		got = append(got, a)
	}
	if err := sc.Err(); err != nil {
		t.Fatalf("scanner: %v", err)
	}
	// chronological order, oldest first, full payload preserved
	if len(got) != 2 || got[0].RuleID != "r1" || got[1].RuleID != "r2" {
		t.Fatalf("orden/cantidad ndjson incorrectos: %+v", got)
	}
	if got[0].Message != "Persistencia en LAB-TEST" || !got[0].Notify {
		t.Errorf("campos message/notify perdidos: %+v", got[0])
	}
}

func TestAlertsExportCSVMessageNotify(t *testing.T) {
	h, addr := newTestHub(t)
	for _, a := range exportAlerts() {
		h.RecordAlert(a)
	}

	res, err := http.Get(fmt.Sprintf("http://%s/api/alerts/export?format=csv", addr))
	if err != nil {
		t.Fatalf("export: %v", err)
	}
	defer res.Body.Close()
	if !strings.HasPrefix(res.Header.Get("Content-Type"), "text/csv") {
		t.Fatalf("content-type = %q", res.Header.Get("Content-Type"))
	}
	rows, err := csv.NewReader(res.Body).ReadAll()
	if err != nil {
		t.Fatalf("csv parse: %v", err)
	}
	if len(rows) != 3 {
		t.Fatalf("filas = %d, want 3 (cabecera + 2 alertas)", len(rows))
	}
	header := strings.Join(rows[0], ",")
	if !strings.Contains(header, "severity") || !strings.Contains(header, "message") || !strings.Contains(header, "status") {
		t.Errorf("cabecera inesperada: %v", rows[0])
	}
	// r6 layout: id(0) status(1) timestamp(2) severity(3) rule_id(4) rule_name(5)...
	// the comma inside the rule name "persistencia, clave Run" must be quoted
	if rows[1][5] != "persistencia, clave Run" {
		t.Errorf("campo con coma mal escapado: %q", rows[1][5])
	}
	if rows[2][3] != "critical" || rows[2][13] != "false" {
		t.Errorf("fila lsass incorrecta: %v", rows[2])
	}
}

func TestAlertsExportDefaultAndBadFormat(t *testing.T) {
	h, addr := newTestHub(t)
	h.RecordAlert(exportAlerts()[0])

	// no format param -> defaults to ndjson
	res, err := http.Get(fmt.Sprintf("http://%s/api/alerts/export", addr))
	if err != nil {
		t.Fatalf("export: %v", err)
	}
	body, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if res.StatusCode != 200 || !strings.Contains(string(body), `"rule_id":"r1"`) {
		t.Errorf("export por defecto incorrecto: status=%d body=%q", res.StatusCode, body)
	}

	// unknown format -> 400, no download headers
	res2, err := http.Get(fmt.Sprintf("http://%s/api/alerts/export?format=xml", addr))
	if err != nil {
		t.Fatalf("export xml: %v", err)
	}
	defer res2.Body.Close()
	if res2.StatusCode != http.StatusBadRequest {
		t.Errorf("format=xml status = %d, want 400", res2.StatusCode)
	}
}

// TestBearerAuth covers the API token standard set alongside the ingest
// auth: /api/health stays open for liveness probes (the engine itself
// and the console bridge use it), every other /api route answers 401
// with a JSON error without a valid bearer and serves data with it.
func TestBearerAuth(t *testing.T) {
	h, err := New("127.0.0.1:0")
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	h.SetToken("s3cret-api")
	go func() { _ = h.Run() }()
	t.Cleanup(h.Shutdown)
	base := "http://" + h.Addr()

	// liveness probe stays open
	res, err := http.Get(base + "/api/health")
	if err != nil {
		t.Fatalf("health: %v", err)
	}
	io.Copy(io.Discard, res.Body)
	res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("health without token: status %d, want 200 (probe must stay open)", res.StatusCode)
	}

	cases := []struct {
		name string
		auth string
		want int
	}{
		{"missing header", "", http.StatusUnauthorized},
		{"wrong token", "Bearer nope", http.StatusUnauthorized},
		{"wrong scheme", "Basic s3cret-api", http.StatusUnauthorized},
		{"valid token", "Bearer s3cret-api", http.StatusOK},
	}
	for _, tc := range cases {
		req, _ := http.NewRequest(http.MethodGet, base+"/api/stats", nil)
		if tc.auth != "" {
			req.Header.Set("Authorization", tc.auth)
		}
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("%s: %v", tc.name, err)
		}
		body, _ := io.ReadAll(res.Body)
		res.Body.Close()
		if res.StatusCode != tc.want {
			t.Fatalf("%s: status = %d, want %d", tc.name, res.StatusCode, tc.want)
		}
		if tc.want == http.StatusUnauthorized && !strings.Contains(string(body), "unauthorized") {
			t.Fatalf("%s: body %q should explain the unauthorized", tc.name, body)
		}
	}

	// with the token the endpoint really serves data, not just 200s
	req, _ := http.NewRequest(http.MethodGet, base+"/api/events", nil)
	req.Header.Set("Authorization", "Bearer s3cret-api")
	res, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("events with token: %v", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("events with token: status %d, want 200", res.StatusCode)
	}
	var out []map[string]any
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		t.Fatalf("events with token: body is not JSON: %v", err)
	}
}

// Delta de convergencia (ronda 20h10): tres garantías que el test
// anterior no cubre — el challenge WWW-Authenticate en cada 401, la
// aceptación del esquema en cualquier combinación de mayúsculas
// (RFC 7235) y el stream SSE autenticado entregando su primer frame.
func TestBearerAuthChallengeAndStream(t *testing.T) {
	h, addr := newTestHub(t)
	h.SetToken("s3cret-api")

	// todo 401 debe llevar el challenge estándar Bearer
	res, err := http.Get(fmt.Sprintf("http://%s/api/stats", addr))
	if err != nil {
		t.Fatalf("stats sin token: %v", err)
	}
	io.Copy(io.Discard, res.Body)
	res.Body.Close()
	if res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("stats sin token: status %d, want 401", res.StatusCode)
	}
	if ch := res.Header.Get("WWW-Authenticate"); !strings.HasPrefix(ch, "Bearer ") {
		t.Fatalf("WWW-Authenticate = %q, want Bearer challenge", ch)
	}

	// el esquema es case-insensitive: 'bearer' minúscula también entra
	req, _ := http.NewRequest(http.MethodGet, fmt.Sprintf("http://%s/api/stats", addr), nil)
	req.Header.Set("Authorization", "bearer s3cret-api")
	res2, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("stats con esquema minúscula: %v", err)
	}
	io.Copy(io.Discard, res2.Body)
	res2.Body.Close()
	if res2.StatusCode != http.StatusOK {
		t.Fatalf("stats con 'bearer' minúscula: status %d, want 200 (RFC 7235)", res2.StatusCode)
	}

	// stream SSE con credencial correcta entrega el primer frame
	req, _ = http.NewRequest(http.MethodGet, fmt.Sprintf("http://%s/api/stream", addr), nil)
	req.Header.Set("Authorization", "Bearer s3cret-api")
	res3, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("stream con token: %v", err)
	}
	defer res3.Body.Close()
	if res3.StatusCode != http.StatusOK {
		t.Fatalf("stream con token: status %d, want 200", res3.StatusCode)
	}
	buf := make([]byte, 64)
	first := make(chan error, 1)
	go func() {
		_, err := res3.Body.Read(buf)
		first <- err
	}()
	select {
	case err := <-first:
		if err != nil {
			t.Fatalf("stream primer frame: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("stream primer frame: timeout (sin retry frame)")
	}
}

// TestStatsCorrelatorCounters pins the kill-chain observability contract:
// without wiring the correlator the stats report zeros (correlator off is
// a valid state), and with wiring they carry live values straight from
// correlate.Manager.
func TestStatsCorrelatorCounters(t *testing.T) {
	h, addr := newTestHub(t)

	var stats map[string]any
	getJSON(t, fmt.Sprintf("http://%s/api/stats", addr), &stats)
	for _, k := range []string{"correlator_states", "correlator_sequences", "correlator_cap"} {
		if v, ok := stats[k]; !ok || v.(float64) != 0 {
			t.Fatalf("unwired correlator: %s = %v (ok=%v), want 0", k, v, ok)
		}
	}

	h.SetCorrelatorStats(func() (int, int, int) { return 7, 4, 8192 })
	getJSON(t, fmt.Sprintf("http://%s/api/stats", addr), &stats)
	if stats["correlator_states"].(float64) != 7 {
		t.Errorf("correlator_states = %v, want 7", stats["correlator_states"])
	}
	if stats["correlator_sequences"].(float64) != 4 {
		t.Errorf("correlator_sequences = %v, want 4", stats["correlator_sequences"])
	}
	if stats["correlator_cap"].(float64) != 8192 {
		t.Errorf("correlator_cap = %v, want 8192", stats["correlator_cap"])
	}
}

// TestStatsBeaconCounters pins the beaconing observability contract
// (A3): without wiring, zeros (detector off is a valid state); with
// wiring, live values straight from beacon.Manager.
func TestStatsBeaconCounters(t *testing.T) {
	h, addr := newTestHub(t)

	var stats map[string]any
	getJSON(t, fmt.Sprintf("http://%s/api/stats", addr), &stats)
	for _, k := range []string{"beacons_tracked", "beacons_cap", "beacons_fired"} {
		if v, ok := stats[k]; !ok || v.(float64) != 0 {
			t.Fatalf("unwired beacon detector: %s = %v (ok=%v), want 0", k, v, ok)
		}
	}

	h.SetBeaconStats(func() (int, int, uint64) { return 3, beacon.MaxKeys, 2 })
	getJSON(t, fmt.Sprintf("http://%s/api/stats", addr), &stats)
	if stats["beacons_tracked"].(float64) != 3 {
		t.Errorf("beacons_tracked = %v, want 3", stats["beacons_tracked"])
	}
	if stats["beacons_cap"].(float64) != float64(beacon.MaxKeys) {
		t.Errorf("beacons_cap = %v, want %d", stats["beacons_cap"], beacon.MaxKeys)
	}
	if stats["beacons_fired"].(float64) != 2 {
		t.Errorf("beacons_fired = %v, want 2", stats["beacons_fired"])
	}
}

// TestSequencesEndpoint pins the read-only kill-chain view: a nil
// manager (correlator off) serves an empty list - not a 404 - and a
// wired manager reflects its Snapshot() with the wire tags the spec
// documents (id, name, severity, window_seconds, steps...).
func TestSequencesEndpoint(t *testing.T) {
	h, addr := newTestHub(t)

	var out []map[string]any
	getJSON(t, fmt.Sprintf("http://%s/api/sequences", addr), &out)
	if len(out) != 0 {
		t.Fatalf("correlator off must serve an empty list, got %d", len(out))
	}

	m, err := correlate.LoadDir("../../sequences", nil)
	if err != nil {
		t.Fatalf("LoadDir: %v", err)
	}
	h.SetSequences(m)
	getJSON(t, fmt.Sprintf("http://%s/api/sequences", addr), &out)
	if len(out) != m.Count() {
		t.Fatalf("sequences = %d, want %d", len(out), m.Count())
	}
	// assert on a known shipped chain (files load in name order, so
	// position in the list is not part of the contract)
	var first map[string]any
	for _, seq := range out {
		if seq["name"] == "Campana de robo de credenciales" {
			first = seq
		}
	}
	if first == nil {
		t.Fatalf("shipped credential-theft chain missing from /api/sequences")
	}
	for _, k := range []string{"id", "name", "description", "severity", "window_seconds", "tags", "steps"} {
		if _, ok := first[k]; !ok {
			t.Errorf("sequence payload missing %q (spec drift)", k)
		}
	}
	if first["severity"] != "critical" {
		t.Errorf("severity = %v, want critical", first["severity"])
	}
	ws, ok := first["window_seconds"].(float64)
	if !ok || ws != 300 {
		t.Errorf("window_seconds = %v, want 300", first["window_seconds"])
	}
	steps, ok := first["steps"].([]any)
	if !ok || len(steps) != 3 {
		t.Errorf("steps = %v, want 3 rule names", first["steps"])
	}
}

// TestStatsCorrelatorClosureLockOrder is the regression for the AB-BA
// deadlock found in cross-review of f503b9d: handleStats used to call
// the correlator closure while holding h.mu, and the real closure
// enters correlate.Manager's mutex — while the chain-completion path
// (Observe -> fire -> alert emit -> RecordAlert) holds the correlator
// mutex and takes h.mu. One stats request plus one completing chain
// deadlocked both goroutines: the API hung AND every later Observe
// blocked behind the stuck completion (detection loss, not just a hung
// endpoint).
//
// The stand-in mutex reproduces both orders with the ordering pinned
// by signals, because a free-running race lets either side win h.mu
// and mask the bug: the completion goroutine first takes the stand-in
// and WAITS; only after the closure announces it is running (pre-fix
// that means h.mu is already captive) is RecordAlert allowed to
// proceed. Pre-fix the deadlock is then fully established — handler
// holds h.mu and waits for the stand-in, completion holds the stand-in
// and waits for h.mu — and the outer timeout turns the hang into a
// failing test instead of a stuck suite. Post-fix the closure runs
// after h.mu is released, RecordAlert completes freely and both
// orders compose.
//
// handleStats is invoked directly (httptest) instead of over TCP: the
// deadlock under test would also wedge the live server's Shutdown
// (which takes h.mu), and the regression must fail fast and leave the
// binary able to exit. The hub is built without newTestHub for the
// same reason — its t.Cleanup(Shutdown) would block on the captive
// h.mu; the unused listener dies with the test process.
func TestStatsCorrelatorClosureLockOrder(t *testing.T) {
	h, err := New("127.0.0.1:0")
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	var corrMu sync.Mutex
	closureEntered := make(chan struct{})
	h.SetCorrelatorStats(func() (int, int, int) {
		close(closureEntered)
		corrMu.Lock()
		defer corrMu.Unlock()
		return 3, 2, 8192
	})

	// The completion path: the alert pipeline takes h.mu while the
	// correlator mutex is held (RecordAlert — exactly what the engine's
	// emit wrapper does from inside correlate.Observe). It waits for the
	// closure to be running first, so h.mu is guaranteed captive when
	// RecordAlert attempts it (no race that would mask the bug).
	corrHeld := make(chan struct{})
	proceed := make(chan struct{})
	completed := make(chan struct{})
	go func() {
		defer close(completed)
		corrMu.Lock()
		defer corrMu.Unlock()
		close(corrHeld)
		<-proceed
		h.RecordAlert(alert.Alert{RuleID: "seq-1", RuleName: "cadena", Severity: rules.SevHigh})
	}()
	<-corrHeld // corrMu is held now, and stays held until RecordAlert returns

	done := make(chan int, 1)
	go func() {
		rec := httptest.NewRecorder()
		h.handleStats(rec, httptest.NewRequest(http.MethodGet, "/api/stats", nil))
		done <- rec.Code
	}()
	<-closureEntered // closure is running: pre-fix h.mu is captive right now
	close(proceed)   // now the completion path attempts RecordAlert
	select {
	case code := <-done:
		if code != 200 {
			t.Fatalf("GET /api/stats: status %d, want 200", code)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("/api/stats deadlocked against the correlator completion path: the closure must not run while h.mu is held")
	}
	<-completed
}

// --- /metrics (Prometheus text exposition, package D1) ---

// The endpoint is registered on the same mux wrapped by h.auth, so a
// token-protected engine must demand the Bearer credential here too.
// The challenge headers mirror /api/stats exactly.
func TestMetricsGatedByToken(t *testing.T) {
	h, err := New("127.0.0.1:0")
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	h.SetToken("s3cret-api")
	go func() { _ = h.Run() }()
	t.Cleanup(h.Shutdown)
	base := "http://" + h.Addr()

	cases := []struct {
		name string
		auth string
		want int
	}{
		{"missing header", "", http.StatusUnauthorized},
		{"wrong token", "Bearer nope", http.StatusUnauthorized},
		{"wrong scheme", "Basic s3cret-api", http.StatusUnauthorized},
		{"valid token", "Bearer s3cret-api", http.StatusOK},
	}
	for _, tc := range cases {
		req, _ := http.NewRequest(http.MethodGet, base+"/metrics", nil)
		if tc.auth != "" {
			req.Header.Set("Authorization", tc.auth)
		}
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("%s: %v", tc.name, err)
		}
		body, _ := io.ReadAll(res.Body)
		res.Body.Close()
		if res.StatusCode != tc.want {
			t.Fatalf("%s: status = %d, want %d", tc.name, res.StatusCode, tc.want)
		}
		if tc.want == http.StatusUnauthorized {
			if ch := res.Header.Get("WWW-Authenticate"); !strings.Contains(ch, "Bearer") {
				t.Fatalf("%s: WWW-Authenticate = %q, want a Bearer challenge", tc.name, ch)
			}
			if !strings.Contains(string(body), "unauthorized") {
				t.Fatalf("%s: body %q should explain the unauthorized", tc.name, body)
			}
		}
	}
}

// Core of the D1 acceptance criteria: /metrics exposes the SAME
// counters as /api/stats, no more and no less. Every numeric stats
// field must appear in the text output with the same value; if a
// future field lands in statsPayload but not in the renderer (or the
// other way round) this test fails until the views are reconciled.
func TestStatsHotHostsRanking(t *testing.T) {
	h, addr := newTestHub(t)
	mk := func(sev, host, rule string) alert.Alert {
		return alert.Alert{
			Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
			RuleID:    rule, RuleName: "rule " + rule, Severity: sev,
			Host: host, EventID: "ev-" + rule, EventType: "process.create",
			Summary: "s", MatchedOn: []string{"process.name"},
		}
	}
	h.RecordAlert(mk("critical", "PC-A", "r1")) // 10
	h.RecordAlert(mk("high", "PC-A", "r2"))     // 15
	h.RecordAlert(mk("low", "PC-B", "r3"))      // 1

	var stats map[string]any
	getJSON(t, fmt.Sprintf("http://%s/api/stats", addr), &stats)

	if got := stats["risk_hosts_tracked"].(float64); got != 2 {
		t.Fatalf("risk_hosts_tracked = %v, want 2", got)
	}
	hot, ok := stats["hot_hosts"].([]any)
	if !ok || len(hot) != 2 {
		t.Fatalf("hot_hosts = %#v, want 2 entries", stats["hot_hosts"])
	}
	first, _ := hot[0].(map[string]any)
	if first["host"] != "PC-A" || first["score"] != 15.0 || first["alerts"] != 2.0 {
		t.Fatalf("top host = %#v, want PC-A score 15 alerts 2", first)
	}
	if first["last_seen"] == "" {
		t.Fatal("top host last_seen empty")
	}
	second, _ := hot[1].(map[string]any)
	if second["host"] != "PC-B" {
		t.Fatalf("second host = %#v, want PC-B", second)
	}
}

func TestMetricsParityWithStats(t *testing.T) {
	h, addr := newTestHub(t)
	h.SetCounters(func() (uint64, uint64, uint64) { return 7, 2, 1 })
	h.SetIngestIdentityStats(func() (int, uint64) { return 3, 2 })
	h.SetWebhookStats(func() (uint64, uint64, uint64) { return 5, 1, 0 })
	h.SetNotifyStats(func() []notify.ChannelStats {
		return []notify.ChannelStats{
			{Name: "slack-lab", Type: "slack", Sent: 3, Failed: 1, Dropped: 2, Filtered: 4},
			{Name: "tg-lab", Type: "telegram", Sent: 5, Failed: 0, Dropped: 0, Filtered: 1},
		}
	})
	h.SetElasticStats(func() (uint64, uint64, uint64) { return 6, 3, 2 })
	h.SetSplunkStats(func() (uint64, uint64, uint64) { return 4, 2, 1 })
	h.SetCorrelatorStats(func() (int, int, int) { return 3, 4, 8192 })
	intelDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(intelDir, "lab.txt"), []byte("203.0.113.9\nmal.example.com\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	im, err := intel.Load(intelDir)
	if err != nil {
		t.Fatal(err)
	}
	im.Allow(intel.Hit{List: "lab", Value: "203.0.113.9"}, "LAB-TEST", time.Now())
	h.SetIntel(im)
	bt := baseline.New(time.Hour)
	bt.Observe(&model.Event{Host: "LAB-TEST", Type: model.TypeProcessCreate, Process: &model.Process{Name: "a.exe"}}, time.Now())
	h.SetBaseline(bt)
	h.RecordEvent(sampleEvent("ev-1"))
	h.RecordEvent(sampleEvent("ev-2"))
	h.RecordAlert(alert.Alert{
		Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
		RuleID:    "r1", RuleName: "test rule", Severity: "critical",
		Host: "LAB-TEST", EventID: "ev-2", EventType: "process.create",
		Summary: "s", MatchedOn: []string{"process.name"},
	})
	h.RecordAlert(alert.Alert{
		Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
		RuleID:    "r2", RuleName: "test rule 2", Severity: "low",
		Host: "LAB-TEST", EventID: "ev-1", EventType: "process.create",
		Summary: "s", MatchedOn: []string{"process.name"},
	})

	var stats map[string]any
	getJSON(t, fmt.Sprintf("http://%s/api/stats", addr), &stats)

	req, _ := http.NewRequest(http.MethodGet, fmt.Sprintf("http://%s/metrics", addr), nil)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("GET /metrics: %v", err)
	}
	defer res.Body.Close()
	if ct := res.Header.Get("Content-Type"); !strings.Contains(ct, "text/plain") {
		t.Fatalf("Content-Type = %q, want text/plain (Prometheus exposition)", ct)
	}
	body, _ := io.ReadAll(res.Body)
	text := string(body)

	// value of a metric line: "name{labels} value" -> last token
	metricValue := func(name string) (float64, bool) {
		for _, line := range strings.Split(text, "\n") {
			if strings.HasPrefix(line, name+" ") || strings.HasPrefix(line, name+"{") {
				fields := strings.Fields(line)
				if len(fields) == 0 {
					continue
				}
				v, err := strconv.ParseFloat(fields[len(fields)-1], 64)
				if err != nil {
					t.Fatalf("metric %s: unparsable value in line %q", name, line)
				}
				return v, true
			}
		}
		return 0, false
	}
	wantMetric := func(name string, jsonField string) {
		t.Helper()
		v, ok := metricValue(name)
		if !ok {
			t.Fatalf("metric %s missing from /metrics output", name)
		}
		raw, present := stats[jsonField]
		if !present {
			t.Fatalf("json field %s missing from /api/stats output", jsonField)
		}
		want, ok := raw.(float64)
		if !ok {
			t.Fatalf("json field %s is %T, want number", jsonField, raw)
		}
		if v != want {
			t.Fatalf("parity drift: %s = %v but /api/stats %s = %v", name, v, jsonField, want)
		}
	}

	wantMetric("sf_events_total", "events_total")
	wantMetric("sf_store_write_failures_total", "store_write_failures")
	wantMetric("sf_ingest_identities", "ingest_identities")
	wantMetric("sf_ingest_identity_violations_total", "ingest_identity_violations")
	wantMetric("sf_events_dropped_total", "dropped")
	wantMetric("sf_ingest_rejected_total", "ingest_rejected")
	wantMetric("sf_alerts_total", "alerts_total")
	wantMetric("sf_webhook_sent_total", "webhook_sent")
	wantMetric("sf_webhook_failed_total", "webhook_failed")
	wantMetric("sf_webhook_dropped_total", "webhook_dropped")
	wantMetric("sf_elastic_sent_total", "elastic_sent")
	wantMetric("sf_elastic_failed_total", "elastic_failed")
	wantMetric("sf_elastic_dropped_total", "elastic_dropped")
	wantMetric("sf_splunk_sent_total", "splunk_sent")
	wantMetric("sf_splunk_failed_total", "splunk_failed")
	wantMetric("sf_splunk_dropped_total", "splunk_dropped")
	wantMetric("sf_suppressions_active", "suppressions_active")
	wantMetric("sf_correlator_states", "correlator_states")
	wantMetric("sf_correlator_sequences", "correlator_sequences")
	wantMetric("sf_correlator_cap", "correlator_cap")
	wantMetric("sf_risk_hosts_tracked", "risk_hosts_tracked")
	wantMetric("sf_beacon_keys_tracked", "beacons_tracked")
	wantMetric("sf_beacon_cap", "beacons_cap")
	wantMetric("sf_beacons_fired_total", "beacons_fired")
	wantMetric("sf_intel_indicators", "intel_indicators")
	wantMetric("sf_intel_lists", "intel_lists")
	wantMetric("sf_intel_hits_total", "intel_hits")
	wantMetric("sf_baseline_hosts", "baseline_hosts")
	wantMetric("sf_baseline_hosts_learning", "baseline_learning")
	wantMetric("sf_baseline_novelties_total", "baseline_novelties")
	if stats["intel_indicators"] != float64(2) || stats["intel_hits"] != float64(1) || stats["baseline_learning"] != float64(1) {
		t.Fatalf("intel/baseline stats: %v %v %v", stats["intel_indicators"], stats["intel_hits"], stats["baseline_learning"])
	}

	// notify channels (C2): every JSON row must appear as four labeled
	// series with identical values, in sorted (deterministic) order.
	notifyRows, ok := stats["notify_channels"].([]any)
	if !ok || len(notifyRows) != 2 {
		t.Fatalf("stats notify_channels = %#v, want 2 rows", stats["notify_channels"])
	}
	first := notifyRows[0].(map[string]any)
	if first["name"] != "slack-lab" {
		t.Fatalf("first notify row = %v, want sorted-by-name slack-lab", first["name"])
	}
	notifyWant := map[string]map[string]float64{
		"slack-lab": {"sent": 3, "failed": 1, "dropped": 2, "filtered": 4},
		"tg-lab":    {"sent": 5, "failed": 0, "dropped": 0, "filtered": 1},
	}
	for _, row := range notifyRows {
		m := row.(map[string]any)
		name := m["name"].(string)
		for field, want := range notifyWant[name] {
			if got := m[field].(float64); got != want {
				t.Fatalf("notify %s %s = %v, want %v", name, field, got, want)
			}
			line := fmt.Sprintf("sf_notify_%s_total{channel=%q} ", field, name)
			idx := strings.Index(text, line)
			if idx < 0 {
				t.Fatalf("series %q missing from /metrics", line)
			}
			rest := text[idx+len(line):]
			end := strings.IndexAny(rest, "\n")
			got, err := strconv.ParseFloat(rest[:end], 64)
			if err != nil {
				t.Fatalf("series %q: unparsable value %q", line, rest[:end])
			}
			if got != want {
				t.Fatalf("parity drift: sf_notify_%s{channel=%q} = %v in /metrics, %v in /api/stats", field, name, got, want)
			}
		}
	}

	// by_severity: every severity present in the JSON must appear as a
	// labeled series with the same value.
	bySev := stats["by_severity"].(map[string]any)
	for sev, raw := range bySev {
		line := fmt.Sprintf(`sf_alerts_by_severity{severity=%q} `, sev)
		if !strings.Contains(text, line) {
			t.Fatalf("severity %q missing from /metrics output (want line prefix %q)", sev, line)
		}
		want, _ := raw.(float64)
		idx := strings.Index(text, line)
		rest := text[idx+len(line):]
		end := strings.IndexAny(rest, "\n")
		got, err := strconv.ParseFloat(rest[:end], 64)
		if err != nil {
			t.Fatalf("severity %q: unparsable value %q", sev, rest[:end])
		}
		if got != want {
			t.Fatalf("parity drift: by_severity[%q] = %v in /metrics, %v in /api/stats", sev, got, want)
		}
	}

	// host risk: one host scored, value matches the JSON top-1 entry
	hotLine := `sf_host_risk_score{host="LAB-TEST"} 11`
	if !strings.Contains(text, hotLine) {
		t.Fatalf("host risk series missing or wrong in /metrics (want %q):\n%s", hotLine, text)
	}
	if hot, ok := stats["hot_hosts"].([]any); !ok || len(hot) != 1 {
		t.Fatalf("stats hot_hosts = %#v, want exactly 1 entry", stats["hot_hosts"])
	}

	// every metric family must carry HELP and TYPE lines (validity of
	// the exposition format, not just its values)
	for _, name := range []string{"sf_events_total", "sf_alerts_total", "sf_alerts_by_severity", "sf_correlator_cap", "sf_host_risk_score", "sf_notify_sent_total", "sf_notify_filtered_total"} {
		if !strings.Contains(text, "# HELP "+name+" ") || !strings.Contains(text, "# TYPE "+name+" ") {
			t.Fatalf("metric %s lacks its HELP/TYPE lines:\n%s", name, text)
		}
	}
}

// A tokenless engine (default loopback deployment) keeps /metrics open,
// exactly like every /api route — the optional-auth model is uniform.
func TestMetricsOpenWithoutToken(t *testing.T) {
	_, addr := newTestHub(t)
	res, err := http.Get(fmt.Sprintf("http://%s/metrics", addr))
	if err != nil {
		t.Fatalf("GET /metrics: %v", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200 (no token configured)", res.StatusCode)
	}
	body, _ := io.ReadAll(res.Body)
	if !strings.Contains(string(body), "sf_uptime_seconds") {
		t.Fatalf("output lacks sf_uptime_seconds:\n%s", body)
	}
}

// Severity strings come from operator rule files. The exposition
// format only requires escaping backslash, double quote and newline
// inside label values; a hostile severity must not be able to forge
// extra label pairs or break the line structure.
func TestMetricsEscapesLabelValues(t *testing.T) {
	h, addr := newTestHub(t)
	h.RecordAlert(alert.Alert{
		Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
		RuleID:    "r1", RuleName: "hostile", Severity: "weird\"severity\n\\",
		Host: "LAB-TEST", EventID: "ev-1", EventType: "process.create",
		Summary: "s", MatchedOn: []string{"process.name"},
	})

	res, err := http.Get(fmt.Sprintf("http://%s/metrics", addr))
	if err != nil {
		t.Fatalf("GET /metrics: %v", err)
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(res.Body)
	text := string(body)

	// the raw control sequence must never survive: a literal newline
	// inside a label would terminate the sample line
	if strings.Contains(text, "weird\"severity\n") {
		t.Fatal("label value contains an unescaped quote+newline: exposition format broken")
	}
	// escaped form present, exactly one sample line for the family.
	// Raw string: the expected line after escapeLabelValue is
	//   sf_alerts_by_severity{severity="weird\"severity\n\\"} 1
	// (quote -> \", LF -> \n, trailing backslash -> \\).
	want := `sf_alerts_by_severity{severity="weird\"severity\n\\"} 1`
	if !strings.Contains(text, want) {
		t.Fatalf("escaped severity sample missing; want line containing %q, got:\n%s", want, text)
	}
	if n := strings.Count(text, "sf_alerts_by_severity{"); n != 1 {
		t.Fatalf("expected exactly 1 severity series, got %d:\n%s", n, text)
	}
}
