package api

import (
        "bufio"
        "encoding/csv"
        "encoding/json"
        "fmt"
        "io"
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
                        Summary: "mimikatz \"sekurlsa::logonpasswords\"",
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
        if !strings.Contains(header, "severity") || !strings.Contains(header, "message") {
                t.Errorf("cabecera inesperada: %v", rows[0])
        }
        // the comma inside "persistencia, clave Run" must be quoted, not split
        if rows[1][3] != "persistencia, clave Run" {
                t.Errorf("campo con coma mal escapado: %q", rows[1][3])
        }
        if rows[2][1] != "critical" || rows[2][11] != "false" {
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
