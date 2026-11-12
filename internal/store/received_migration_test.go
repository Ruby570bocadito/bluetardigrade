package store

import (
	"database/sql"
	"testing"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/alert"
	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
)

// age rewrites when a row reached the store, the way time would.
func age(t *testing.T, s *Store, table string, by time.Duration) {
	t.Helper()
	if _, err := s.w.Exec(`UPDATE `+table+` SET received_at = received_at - ?`, int64(by)); err != nil {
		t.Fatal(err)
	}
}

// Retention follows the arrival, not the clock of whoever sent the
// record: a backdated event is not gone at the next pass, and one dated
// in the future is not kept for ever.
func TestPruneIgnoresTheDeclaredTimestamp(t *testing.T) {
	s := openTestStore(t)
	now := time.Now().UTC()
	if err := s.InsertEvent(ev("backdated", "H1", model.TypeProcessCreate, "x", now.Add(-90*24*time.Hour))); err != nil {
		t.Fatal(err)
	}
	if err := s.InsertAlert(alert.Alert{Timestamp: now.Add(-90 * 24 * time.Hour).Format(time.RFC3339Nano), RuleID: "r", Severity: "low", Host: "H1"}); err != nil {
		t.Fatal(err)
	}
	if dEv, dAl, _, err := s.Prune(24 * time.Hour); err != nil || dEv != 0 || dAl != 0 {
		t.Fatalf("a backdated record that just arrived was pruned: ev=%d al=%d err=%v", dEv, dAl, err)
	}

	if err := s.InsertEvent(ev("future", "H1", model.TypeProcessCreate, "y", time.Date(2100, 1, 1, 0, 0, 0, 0, time.UTC))); err != nil {
		t.Fatal(err)
	}
	if err := s.InsertAlert(alert.Alert{Timestamp: "2100-01-01T00:00:00Z", RuleID: "r", Severity: "low", Host: "H1"}); err != nil {
		t.Fatal(err)
	}
	age(t, s, "events", 48*time.Hour)
	age(t, s, "alerts", 48*time.Hour)
	if dEv, dAl, _, err := s.Prune(24 * time.Hour); err != nil || dEv != 2 || dAl != 2 {
		t.Fatalf("records older than the window by arrival: pruned ev=%d al=%d err=%v, want 2/2", dEv, dAl, err)
	}
}

// A record dated far ahead sorts as "arrived now" instead of sitting on
// top of every listing, an impossible year does not wrap around, and the
// evidence keeps the timestamp it declared.
func TestFutureTimestampDoesNotStayOnTop(t *testing.T) {
	s := openTestStore(t)
	year2100 := time.Date(2100, 1, 1, 0, 0, 0, 0, time.UTC)
	for _, e := range []*model.Event{
		ev("future", "H1", model.TypeProcessCreate, "x", year2100),
		ev("overflow", "H1", model.TypeProcessCreate, "x", time.Date(9000, 1, 1, 0, 0, 0, 0, time.UTC)),
		ev("ancient", "H1", model.TypeProcessCreate, "x", time.Date(1500, 1, 1, 0, 0, 0, 0, time.UTC)),
	} {
		if err := s.InsertEvent(e); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.InsertAlert(alert.Alert{Timestamp: "2100-01-01T00:00:00Z", RuleID: "future", Severity: "low", Host: "H1"}); err != nil {
		t.Fatal(err)
	}
	time.Sleep(5 * time.Millisecond)
	if err := s.InsertEvent(ev("latest", "H1", model.TypeProcessCreate, "y", time.Now().UTC())); err != nil {
		t.Fatal(err)
	}
	if err := s.InsertAlert(alert.Alert{Timestamp: time.Now().UTC().Format(time.RFC3339Nano), RuleID: "latest", Severity: "low", Host: "H1"}); err != nil {
		t.Fatal(err)
	}
	evs, err := s.QueryEvents(EventQuery{Limit: 10})
	if err != nil || len(evs) != 4 {
		t.Fatalf("events: %d, err %v", len(evs), err)
	}
	if evs[0].ID != "latest" || evs[3].ID != "ancient" {
		t.Fatalf("order = %s, %s, %s, %s; want latest first and ancient last", evs[0].ID, evs[1].ID, evs[2].ID, evs[3].ID)
	}
	for _, e := range evs {
		if e.ID == "future" && !e.Timestamp.Equal(year2100) {
			t.Fatalf("the stored evidence lost its declared timestamp: %v", e.Timestamp)
		}
	}
	als, err := s.QueryAlerts(AlertQuery{Limit: 10})
	if err != nil || len(als) != 2 || als[0].RuleID != "latest" {
		t.Fatalf("alerts = %+v, err %v; want the latest first", als, err)
	}
}

// A database written before received_at existed gains the column on
// Open; rows take their declared time, or the migration time when that
// is in the future.
func TestReceivedAtMigratesALegacyDatabase(t *testing.T) {
	path := t.TempDir() + "/legacy.db"
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	past := time.Now().Add(-time.Hour).UnixNano()
	future := time.Date(2100, 1, 1, 0, 0, 0, 0, time.UTC).UnixNano()
	raw, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	for _, stmt := range []string{
		`DROP INDEX events_received_idx`,
		`DROP INDEX alerts_received_idx`,
		`ALTER TABLE events DROP COLUMN received_at`,
		`ALTER TABLE alerts DROP COLUMN received_at`,
	} {
		if _, err := raw.Exec(stmt); err != nil {
			t.Fatalf("%s: %v", stmt, err)
		}
	}
	const doc = `{"id":"x","type":"t","timestamp":"2026-01-01T00:00:00Z"}`
	if _, err := raw.Exec(`INSERT INTO events (id, ts, json) VALUES ('past', ?, ?), ('future', ?, ?)`, past, doc, future, doc); err != nil {
		t.Fatal(err)
	}
	if _, err := raw.Exec(`INSERT INTO alerts (ts, json) VALUES (?, '{}'), (?, '{}')`, past, future); err != nil {
		t.Fatal(err)
	}
	raw.Close()

	before := time.Now().UnixNano()
	s, err = Open(path)
	if err != nil {
		t.Fatalf("open the legacy database: %v", err)
	}
	defer s.Close()
	var gotPast, gotFuture int64
	if err := s.db.QueryRow(`SELECT received_at FROM events WHERE id = 'past'`).Scan(&gotPast); err != nil {
		t.Fatal(err)
	}
	if err := s.db.QueryRow(`SELECT received_at FROM events WHERE id = 'future'`).Scan(&gotFuture); err != nil {
		t.Fatal(err)
	}
	if gotPast != past {
		t.Errorf("legacy row: received_at = %d, want its ts %d", gotPast, past)
	}
	if gotFuture < before || gotFuture > time.Now().UnixNano() {
		t.Errorf("legacy row dated 2100: received_at = %d, want the migration time", gotFuture)
	}
	var unset int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM alerts WHERE received_at <= 0 OR received_at > ?`, time.Now().UnixNano()).Scan(&unset); err != nil || unset != 0 {
		t.Errorf("alerts left without a usable received_at: %d (err %v)", unset, err)
	}
	// nothing that just migrated is older than the window by arrival
	// except the row that really is an hour old
	if dEv, dAl, _, err := s.Prune(30 * time.Minute); err != nil || dEv != 1 || dAl != 1 {
		t.Errorf("prune after migration: ev=%d al=%d err=%v, want 1/1", dEv, dAl, err)
	}
}
