package store

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"path/filepath"
	"testing"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/alert"
	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
)

func TestLegacySearchUpgradePreservesEvidenceAndRebuildsBothTables(t *testing.T) {
	path := filepath.Join(t.TempDir(), "history.db")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	e := &model.Event{ID: "legacy-event", Timestamp: time.Now().UTC(), Type: model.TypeNetworkAlert, Source: "suricata", Host: "LAB", Attributes: map[string]string{"ids_signature": "Señal de prueba"}}
	a := alert.Alert{ID: "0123456789abcdef", Timestamp: e.Timestamp.Format(time.RFC3339Nano), RuleID: "legacy-rule", Host: e.Host, Source: e.Source, Attributes: e.Attributes}
	if err := s.InsertEvent(e); err != nil {
		t.Fatal(err)
	}
	if err := s.InsertAlert(a); err != nil {
		t.Fatal(err)
	}
	// Unknown evidence fields and saved state must not disappear when the
	// derived search index is rebuilt from the known model fields.
	addUnknown := func(table string) string {
		t.Helper()
		var raw string
		if err := s.db.QueryRow("SELECT json FROM " + table).Scan(&raw); err != nil {
			t.Fatal(err)
		}
		var payload map[string]json.RawMessage
		if err := json.Unmarshal([]byte(raw), &payload); err != nil {
			t.Fatal(err)
		}
		payload["extension"] = json.RawMessage(`{"original_evidence":"keep exactly"}`)
		payload["status"] = json.RawMessage(`"closed"`)
		updated, err := json.Marshal(payload)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := s.db.Exec("UPDATE "+table+" SET json = ?, search = 'legacy haystack'", string(updated)); err != nil {
			t.Fatal(err)
		}
		return string(updated)
	}
	eventJSON, alertJSON := addUnknown("events"), addUnknown("alerts")
	if _, err := s.db.Exec("PRAGMA user_version = 0"); err != nil {
		t.Fatal(err)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	s, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	for _, needle := range []string{e.ID, "suricata", "Señal"} {
		got, err := s.QueryEvents(EventQuery{Q: needle, Limit: 10})
		if err != nil || len(got) != 1 || got[0].ID != e.ID {
			t.Fatalf("legacy event q=%q: %d rows, error=%v", needle, len(got), err)
		}
	}
	for _, needle := range []string{a.ID, "suricata", "Señal"} {
		got, err := s.QueryAlerts(AlertQuery{Q: needle, Limit: 10})
		if err != nil || len(got) != 1 || got[0].ID != a.ID {
			t.Fatalf("legacy alert q=%q: %d rows, error=%v", needle, len(got), err)
		}
	}
	for table, expected := range map[string]string{"events": eventJSON, "alerts": alertJSON} {
		var raw string
		if err := s.db.QueryRow("SELECT json FROM " + table).Scan(&raw); err != nil || raw != expected {
			t.Fatalf("%s evidence changed: error=%v\nwant=%s\ngot=%s", table, err, expected, raw)
		}
	}
	if events, alerts := s.Counts(); events != 1 || alerts != 1 {
		t.Fatalf("migration changed record counts: %d/%d", events, alerts)
	}
	var version int
	if err := s.db.QueryRow("PRAGMA user_version").Scan(&version); err != nil || version != 1 {
		t.Fatalf("search migration marker=%d, error=%v", version, err)
	}
}

func TestCurrentSearchVersionDoesNotRewriteHistoryOnRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "history.db")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.InsertEvent(ev("current-event", "LAB", model.TypeProcessCreate, "observed", time.Now())); err != nil {
		t.Fatal(err)
	}
	if err := s.InsertAlert(alert.Alert{ID: "0123456789abcdef"}); err != nil {
		t.Fatal(err)
	}
	// Any repeated backfill, even one assigning the existing value, fails.
	for _, table := range []string{"events", "alerts"} {
		if _, err := s.db.Exec("CREATE TRIGGER reject_reindex_" + table + " BEFORE UPDATE ON " + table + " BEGIN SELECT RAISE(FAIL, 'unexpected repeated backfill'); END"); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	s, err = Open(path)
	if err != nil {
		t.Fatalf("current database was reindexed: %v", err)
	}
	defer s.Close()
	var version int
	if err := s.db.QueryRow("PRAGMA user_version").Scan(&version); err != nil || version != 1 {
		t.Fatalf("missing migration marker=%d, error=%v", version, err)
	}
}

func TestFailedSearchMigrationLeavesAllEvidenceAndVersionUntouched(t *testing.T) {
	path := filepath.Join(t.TempDir(), "history.db")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.InsertEvent(ev("legacy-event", "LAB", model.TypeProcessCreate, "observed", time.Now())); err != nil {
		t.Fatal(err)
	}
	if err := s.InsertAlert(alert.Alert{ID: "0123456789abcdef"}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec("UPDATE events SET search = 'legacy'; UPDATE alerts SET json = 'invalid', search = 'legacy'; PRAGMA user_version = 0"); err != nil {
		t.Fatal(err)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	opened, err := Open(path)
	if opened != nil {
		_ = opened.Close()
	}
	if err == nil {
		t.Fatal("corrupt historical evidence must reject the migration without partially reindexing it")
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var version int
	if err := db.QueryRow("PRAGMA user_version").Scan(&version); err != nil || version != 0 {
		t.Fatalf("failed migration advanced version=%d: %v", version, err)
	}
	for _, table := range []string{"events", "alerts"} {
		var search string
		if err := db.QueryRow("SELECT search FROM " + table).Scan(&search); err != nil || search != "legacy" {
			t.Fatalf("failed migration rewrote %s search=%q: %v", table, search, err)
		}
	}
}

func TestLegacySearchMigrationTraversesMultipleBatches(t *testing.T) {
	path := filepath.Join(t.TempDir(), "history.db")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	tx, err := s.db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	for index := 0; index < 270; index++ {
		id := fmt.Sprintf("legacy-%03d", index)
		raw := fmt.Sprintf(`{"id":%q,"type":"process.create","source":"sysmon","host":"LAB"}`, id)
		if _, err := tx.Exec("INSERT INTO events (id,ts,json,search) VALUES (?,0,?,'legacy')", id, raw); err != nil {
			t.Fatal(err)
		}
		alertID := fmt.Sprintf("%016x", index+1)
		if _, err := tx.Exec("INSERT INTO alerts (ts,json,search) VALUES (0,?,'legacy')", fmt.Sprintf(`{"id":%q,"source":"sysmon"}`, alertID)); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := tx.Exec("PRAGMA user_version = 0"); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	s, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	for _, index := range []int{0, 255, 256, 269} {
		events, err := s.QueryEvents(EventQuery{Q: fmt.Sprintf("legacy-%03d", index), Limit: 10})
		if err != nil || len(events) != 1 {
			t.Fatalf("event row %d was skipped: %d matches, %v", index, len(events), err)
		}
		alerts, err := s.QueryAlerts(AlertQuery{Q: fmt.Sprintf("%016x", index+1), Limit: 10})
		if err != nil || len(alerts) != 1 {
			t.Fatalf("alert row %d was skipped: %d matches, %v", index, len(alerts), err)
		}
	}
	if events, alerts := s.Counts(); events != 270 || alerts != 270 {
		t.Fatalf("migration changed historical counts: %d/%d", events, alerts)
	}
}
