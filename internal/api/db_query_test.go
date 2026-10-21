package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/alert"
	"github.com/Ruby570bocadito/bluetardigrade/internal/store"
	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
)

// dbQueryPost runs the request against the REAL hub listener (mux,
// auth and the unscopedOnly wrapper included) — the same pattern the
// other surface tests use.
func dbQueryPost(t *testing.T, addr string, body any) (int, string) {
	t.Helper()
	raw, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	res, err := http.Post("http://"+addr+"/api/db/query", "application/json", bytes.NewReader(raw))
	if err != nil {
		t.Fatalf("POST /api/db/query: %v", err)
	}
	defer res.Body.Close()
	raw, err = io.ReadAll(res.Body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	return res.StatusCode, string(raw)
}

// dbQueryTestHub starts a hub with an armed-free store seeded with one
// event and one alert; arming is per-test via h.EnableDBQuery().
func dbQueryTestHub(t *testing.T) (*Hub, string, *store.Store) {
	t.Helper()
	h, addr := newTestHub(t)
	st, err := store.Open(t.TempDir() + "/query.db")
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })
	h.SetStore(st)
	seed := &model.Event{
		ID: "ev-1", Timestamp: time.Now().UTC(), Type: model.TypeProcessCreate,
		Source: "test", Host: "LAB-A",
		Process: &model.Process{PID: 1, Name: "powershell.exe", CommandLine: "whoami /priv"},
	}
	if err := st.InsertEvent(seed); err != nil {
		t.Fatalf("InsertEvent: %v", err)
	}
	if err := st.InsertAlert(alert.Alert{
		Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
		RuleID:    "r-1", RuleName: "test rule", Severity: "high",
		Host: "LAB-A", EventID: "ev-1", EventType: model.TypeProcessCreate,
		Summary: "did a thing", MatchedOn: []string{"process.name"},
	}); err != nil {
		t.Fatalf("InsertAlert: %v", err)
	}
	return h, addr, st
}

func TestDbQueryDisabledByDefault(t *testing.T) {
	h, addr, _ := dbQueryTestHub(t)
	_ = h
	code, body := dbQueryPost(t, addr, dbQueryRequest{SQL: "SELECT 1"})
	if code != http.StatusForbidden {
		t.Fatalf("status %d, want 403 while disarmed", code)
	}
	if !strings.Contains(body, "-api-db-query") {
		t.Fatalf("403 must name the arming flag: %s", body)
	}
}

func TestDbQueryRequiresStore(t *testing.T) {
	h, addr, _ := dbQueryTestHub(t)
	h.store = nil
	h.EnableDBQuery()
	code, _ := dbQueryPost(t, addr, dbQueryRequest{SQL: "SELECT 1"})
	if code != http.StatusNotImplemented {
		t.Fatalf("status %d, want 501 without -store", code)
	}
}

func TestDbQueryRoundTrip(t *testing.T) {
	h, addr, _ := dbQueryTestHub(t)
	h.EnableDBQuery()

	code, body := dbQueryPost(t, addr, dbQueryRequest{
		SQL: "SELECT host, COUNT(*) AS n FROM events GROUP BY host ORDER BY host",
	})
	if code != http.StatusOK {
		t.Fatalf("status %d: %s", code, body)
	}
	var reply dbQueryReply
	if err := json.Unmarshal([]byte(body), &reply); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(reply.Columns) != 2 || reply.Columns[0] != "host" || reply.Columns[1] != "n" {
		t.Fatalf("columns: %v", reply.Columns)
	}
	if reply.RowCount != 1 || len(reply.Rows) != 1 {
		t.Fatalf("rows: %d/%d", reply.RowCount, len(reply.Rows))
	}
	// the store lowercases hosts on insert (same normalization the
	// API filters rely on), so the row comes back as "lab-a"
	if reply.Rows[0][0] != "lab-a" {
		t.Fatalf("host value: %#v", reply.Rows[0][0])
	}
	if n, ok := reply.Rows[0][1].(float64); !ok || n != 1 {
		t.Fatalf("count value: %#v", reply.Rows[0][1])
	}
	if reply.Truncated {
		t.Fatal("unexpected truncation")
	}
}

func TestDbQueryRejectsWritesAndAuditsThem(t *testing.T) {
	h, addr, st := dbQueryTestHub(t)
	h.EnableDBQuery()

	code, _ := dbQueryPost(t, addr, dbQueryRequest{SQL: "DELETE FROM events"})
	if code != http.StatusBadRequest {
		t.Fatalf("status %d, want 400 for a write", code)
	}
	events, _ := st.Counts()
	if events != 1 {
		t.Fatalf("evidence changed: %d events", events)
	}

	// the attempt is audited
	_, rows, _, err := st.QueryRO(context.Background(), "SELECT status, sql FROM query_audit ORDER BY id", 10)
	if err != nil {
		t.Fatalf("read audit: %v", err)
	}
	if len(rows) != 1 || rows[0][0] != "rejected" {
		t.Fatalf("audit rows: %#v", rows)
	}
	if !strings.Contains(rows[0][1].(string), "DELETE") {
		t.Fatalf("audit sql: %#v", rows[0][1])
	}
}

func TestDbQueryAuditSuccessToo(t *testing.T) {
	h, addr, st := dbQueryTestHub(t)
	h.EnableDBQuery()

	if code, body := dbQueryPost(t, addr, dbQueryRequest{SQL: "SELECT 1"}); code != http.StatusOK {
		t.Fatalf("status %d: %s", code, body)
	}
	_, rows, _, err := st.QueryRO(context.Background(), "SELECT status, rows, duration_ms FROM query_audit", 10)
	if err != nil {
		t.Fatalf("read audit: %v", err)
	}
	if len(rows) != 1 || rows[0][0] != "ok" {
		t.Fatalf("audit rows: %#v", rows)
	}
	if n, _ := rows[0][1].(int64); n != 1 {
		t.Fatalf("audited row count: %#v", rows[0][1])
	}
}

func TestDbQueryClampsRowsAndTimeout(t *testing.T) {
	h, addr, st := dbQueryTestHub(t)
	h.EnableDBQuery()
	for i := 2; i <= 4; i++ {
		if err := st.InsertEvent(&model.Event{
			ID: fmt.Sprintf("ev-%d", i), Timestamp: time.Now().UTC(), Type: model.TypeProcessCreate,
			Source: "test", Host: "LAB-A",
			Process: &model.Process{PID: i, Name: "powershell.exe"},
		}); err != nil {
			t.Fatalf("InsertEvent: %v", err)
		}
	}

	// max_rows below the row count truncates and says so
	code, body := dbQueryPost(t, addr, dbQueryRequest{SQL: "SELECT id FROM events", MaxRows: 2})
	if code != http.StatusOK {
		t.Fatalf("status %d: %s", code, body)
	}
	var reply dbQueryReply
	if err := json.Unmarshal([]byte(body), &reply); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !reply.Truncated || reply.RowCount != 2 {
		t.Fatalf("truncated=%v rows=%d", reply.Truncated, reply.RowCount)
	}

	// absurd values clamp instead of erroring
	for _, req := range []dbQueryRequest{
		{SQL: "SELECT 1", MaxRows: 1 << 30, TimeoutMS: 1 << 30},
		{SQL: "SELECT 1", MaxRows: -5, TimeoutMS: -5},
	} {
		if code, body := dbQueryPost(t, addr, req); code != http.StatusOK {
			t.Fatalf("status %d for %+v: %s", code, req, body)
		}
	}
}

func TestDbQueryRuntimeErrorIsABadRequest(t *testing.T) {
	h, addr, _ := dbQueryTestHub(t)
	h.EnableDBQuery()

	code, body := dbQueryPost(t, addr, dbQueryRequest{SQL: "SELECT * FROM no_such_table"})
	if code != http.StatusBadRequest {
		t.Fatalf("status %d, want 400: %s", code, body)
	}
	if !strings.Contains(body, "no_such_table") {
		t.Fatalf("error must carry the driver message: %s", body)
	}
}

func TestDbQueryBadJSON(t *testing.T) {
	h, addr, _ := dbQueryTestHub(t)
	h.EnableDBQuery()

	res, err := http.Post("http://"+addr+"/api/db/query", "application/json", strings.NewReader("{not json"))
	if err != nil {
		t.Fatalf("POST: %v", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("status %d, want 400", res.StatusCode)
	}
}
