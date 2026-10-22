package store

import (
	"fmt"
	"time"
)

// adReadAuditQCap bounds the stored needle: a search term is a
// handful of characters; a hostile body is not worth disk space.
const adReadAuditQCap = 128

// ADReadAuditRow is one audited read of a directory user record.
// Status is "ok" or "error" (the snapshot query failed): attempts are
// audited like successes, the same contract as query_audit.
type ADReadAuditRow struct {
	TS      time.Time
	Remote  string
	Account string
	Q       string
	Status  string
	Rows    int
}

// migrateADReadAudit creates the directory-read audit table. It runs
// from Open with the writer handle, like every other migration.
func (s *Store) migrateADReadAudit() error {
	const schema = `
CREATE TABLE IF NOT EXISTS ad_read_audit (
        id      INTEGER PRIMARY KEY AUTOINCREMENT,
        ts      INTEGER NOT NULL,
        remote  TEXT NOT NULL DEFAULT '',
        account TEXT NOT NULL DEFAULT '',
        q       TEXT NOT NULL DEFAULT '',
        status  TEXT NOT NULL DEFAULT '',
        rows    INTEGER NOT NULL DEFAULT 0
);
`
	if _, err := s.db.Exec(schema); err != nil {
		return fmt.Errorf("store: ad read audit schema: %w", err)
	}
	return nil
}

// RecordADReadAudit appends one audited user-record read. A store
// that cannot take the row is the caller's log line, never a reason
// to fail the read it audits (same contract as RecordQueryAudit).
func (s *Store) RecordADReadAudit(a ADReadAuditRow) error {
	q := []rune(a.Q)
	if len(q) > adReadAuditQCap {
		q = q[:adReadAuditQCap]
	}
	s.wmu.Lock()
	defer s.wmu.Unlock()
	if _, err := s.db.Exec(
		`INSERT INTO ad_read_audit (ts, remote, account, q, status, rows) VALUES (?,?,?,?,?,?)`,
		a.TS.Unix(), a.Remote, a.Account, string(q), a.Status, a.Rows,
	); err != nil {
		return fmt.Errorf("store: ad read audit: %w", err)
	}
	return nil
}
