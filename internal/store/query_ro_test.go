package store

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
)

func seedEvents(t *testing.T, st *Store, n int) {
	t.Helper()
	for i := 0; i < n; i++ {
		ev := &model.Event{
			ID:        fmt.Sprintf("ev-%03d", i),
			Timestamp: time.Now().UTC().Add(time.Duration(i) * time.Second),
			Type:      model.TypeProcessCreate,
			Source:    "test",
			Host:      "LAB-A",
			Process:   &model.Process{PID: i + 1, Name: "powershell.exe"},
		}
		if err := st.InsertEvent(ev); err != nil {
			t.Fatalf("InsertEvent: %v", err)
		}
	}
}

func TestQueryROReadsStoredEvents(t *testing.T) {
	st := openTestStore(t)
	seedEvents(t, st, 3)

	cols, rows, truncated, err := st.QueryRO(context.Background(), "SELECT id, host FROM events ORDER BY ts", 10)
	if err != nil {
		t.Fatalf("QueryRO: %v", err)
	}
	if truncated {
		t.Fatal("unexpected truncation")
	}
	if len(cols) != 2 || cols[0] != "id" || cols[1] != "host" {
		t.Fatalf("columns: %v", cols)
	}
	if len(rows) != 3 {
		t.Fatalf("rows: %d", len(rows))
	}
	// text comes back as string, never as []byte
	id0, ok := rows[0][0].(string)
	if !ok || id0 != "ev-000" {
		t.Fatalf("first id: %#v", rows[0][0])
	}
}

func TestQueryRORejectsWritesAtTheDriverLayer(t *testing.T) {
	st := openTestStore(t)
	seedEvents(t, st, 1)

	// The API guard should never let one through; this proves the
	// LAST line of defense holds on its own: the read-only handle
	// refuses writes even when asked directly.
	for _, stmt := range []string{
		"INSERT INTO events (id, ts, type, host, search, json) VALUES ('x', 0, '', '', '', '{}')",
		"DELETE FROM events",
		"UPDATE events SET host = 'pwned'",
		"CREATE TABLE pwned (id TEXT)",
	} {
		if _, _, _, err := st.QueryRO(context.Background(), stmt, 10); err == nil {
			t.Fatalf("write accepted through the read-only handle: %s", stmt)
		}
	}
	events, alerts := st.Counts()
	if events != 1 || alerts != 0 {
		t.Fatalf("evidence changed: %d events, %d alerts", events, alerts)
	}
}

func TestQueryROTruncatesAtMaxRows(t *testing.T) {
	st := openTestStore(t)
	seedEvents(t, st, 5)

	_, rows, truncated, err := st.QueryRO(context.Background(), "SELECT id FROM events", 2)
	if err != nil {
		t.Fatalf("QueryRO: %v", err)
	}
	if !truncated || len(rows) != 2 {
		t.Fatalf("truncated=%v rows=%d", truncated, len(rows))
	}

	_, rows, truncated, err = st.QueryRO(context.Background(), "SELECT id FROM events", 50)
	if err != nil {
		t.Fatalf("QueryRO: %v", err)
	}
	if truncated || len(rows) != 5 {
		t.Fatalf("truncated=%v rows=%d", truncated, len(rows))
	}

	if _, _, _, err := st.QueryRO(context.Background(), "SELECT 1", 0); err == nil {
		t.Fatal("maxRows=0 must be refused")
	}
}

func TestQueryAuditRecordsAndPrunes(t *testing.T) {
	st := openTestStore(t)

	if err := st.RecordQueryAudit(QueryAuditRow{
		TS: time.Now().UTC(), Remote: "127.0.0.1:1", SQL: "SELECT 1", Status: "ok", Rows: 1, DurationMS: 2,
	}); err != nil {
		t.Fatalf("RecordQueryAudit ok: %v", err)
	}
	if err := st.RecordQueryAudit(QueryAuditRow{
		TS: time.Now().UTC(), Remote: "127.0.0.1:2", SQL: "DELETE FROM events", Status: "rejected", Error: "verb delete",
	}); err != nil {
		t.Fatalf("RecordQueryAudit rejected: %v", err)
	}

	_, rows, _, err := st.QueryRO(context.Background(), "SELECT status, remote FROM query_audit ORDER BY id", 10)
	if err != nil {
		t.Fatalf("read audit: %v", err)
	}
	if len(rows) != 2 {
		t.Fatalf("audit rows: %d", len(rows))
	}
	if rows[0][0] != "ok" || rows[1][0] != "rejected" {
		t.Fatalf("statuses: %v %v", rows[0][0], rows[1][0])
	}
	if rows[1][1] != "127.0.0.1:2" {
		t.Fatalf("remote: %v", rows[1][1])
	}

	// the cap: one row beyond it pushes the oldest out
	for i := 0; i < auditKeepRows+25; i++ {
		if err := st.RecordQueryAudit(QueryAuditRow{TS: time.Now().UTC(), SQL: "SELECT 1", Status: "ok"}); err != nil {
			t.Fatalf("RecordQueryAudit %d: %v", i, err)
		}
	}
	_, rows, _, err = st.QueryRO(context.Background(), "SELECT COUNT(*) FROM query_audit", 10)
	if err != nil {
		t.Fatalf("count: %v", err)
	}
	if got, _ := rows[0][0].(int64); got != auditKeepRows {
		t.Fatalf("audit table holds %v rows, cap is %d", rows[0][0], auditKeepRows)
	}
}

func TestQueryAuditTruncatesStatementText(t *testing.T) {
	st := openTestStore(t)
	big := "SELECT '" + strings.Repeat("x", auditSQLCap*2) + "'"
	if err := st.RecordQueryAudit(QueryAuditRow{TS: time.Now().UTC(), SQL: big, Status: "ok"}); err != nil {
		t.Fatalf("RecordQueryAudit: %v", err)
	}
	_, rows, _, err := st.QueryRO(context.Background(), "SELECT LENGTH(sql) FROM query_audit", 10)
	if err != nil {
		t.Fatalf("read audit: %v", err)
	}
	if got, _ := rows[0][0].(int64); got != auditSQLCap {
		t.Fatalf("stored statement length %v, cap is %d", rows[0][0], auditSQLCap)
	}
}
