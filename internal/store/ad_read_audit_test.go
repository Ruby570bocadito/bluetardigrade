package store

import (
	"strings"
	"testing"
	"time"
)

// SEC-9: the directory-read audit row persists with its needle capped
// (runes, never a mid-rune byte cut) and everything else verbatim.
func TestRecordADReadAuditCapsNeedle(t *testing.T) {
	s, err := Open(t.TempDir() + "/adaudit.db")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer s.Close()

	long := "a-needle-" + strings.Repeat("ñ", 300)
	if err := s.RecordADReadAudit(ADReadAuditRow{
		TS: time.Now().UTC(), Remote: "10.0.0.9", Account: "ana", Q: long, Status: "ok", Rows: 3,
	}); err != nil {
		t.Fatalf("RecordADReadAudit: %v", err)
	}
	var remote, account, q, status string
	var rows int
	if err := s.db.QueryRow(`SELECT remote, account, q, status, rows FROM ad_read_audit`).Scan(&remote, &account, &q, &status, &rows); err != nil {
		t.Fatalf("read back: %v", err)
	}
	if remote != "10.0.0.9" || account != "ana" || status != "ok" || rows != 3 {
		t.Errorf("row = %q/%q/%q/%d, want the recorded fields intact", remote, account, status, rows)
	}
	if n := len([]rune(q)); n > adReadAuditQCap {
		t.Errorf("stored needle holds %d runes, cap is %d", n, adReadAuditQCap)
	}
}

// SEC-9: the retention window ages out the audit tables and the AD
// posture history (seconds timestamps) together with events/alerts
// (nanoseconds), keeping the fresh rows.
func TestPruneCoversAuditTables(t *testing.T) {
	s, err := Open(t.TempDir() + "/prune-audit.db")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer s.Close()

	now := time.Now()
	old := now.Add(-48 * time.Hour)
	fresh := now.Add(-time.Hour)

	for _, ts := range []time.Time{old, fresh} {
		if err := s.RecordQueryAudit(QueryAuditRow{TS: ts, SQL: "SELECT 1", Status: "ok"}); err != nil {
			t.Fatalf("RecordQueryAudit: %v", err)
		}
		if err := s.RecordADReadAudit(ADReadAuditRow{TS: ts, Remote: "10.1.1.1", Account: "ana", Q: "ana", Status: "ok", Rows: 1}); err != nil {
			t.Fatalf("RecordADReadAudit: %v", err)
		}
	}
	if err := s.SaveADPostureJSON(old.Unix(), 50, `{"score":50}`); err != nil {
		t.Fatalf("SaveADPostureJSON old: %v", err)
	}
	if err := s.SaveADPostureJSON(fresh.Unix(), 60, `{"score":60}`); err != nil {
		t.Fatalf("SaveADPostureJSON fresh: %v", err)
	}

	dEv, dAl, dAu, err := s.Prune(24 * time.Hour)
	if err != nil {
		t.Fatalf("Prune: %v", err)
	}
	if dEv != 0 || dAl != 0 {
		t.Errorf("events/alerts pruned = %d/%d, want 0/0", dEv, dAl)
	}
	if dAu != 3 {
		t.Errorf("audit rows pruned = %d, want 3 (one per table)", dAu)
	}
	for _, table := range []string{"query_audit", "ad_read_audit", "ad_posture_history"} {
		var n int
		if err := s.db.QueryRow(`SELECT COUNT(*) FROM ` + table).Scan(&n); err != nil {
			t.Fatalf("count %s: %v", table, err)
		}
		if n != 1 {
			t.Errorf("%s keeps %d rows, want 1 (the fresh one)", table, n)
		}
	}
}
