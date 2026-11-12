package store

import (
	"database/sql"
	"fmt"
	"time"
)

// migrateReceivedAt gives events and alerts the received_at column the
// retention runs on (see Prune). The step is keyed on the column itself
// rather than on PRAGMA user_version, which versions the derived search
// vocabulary: it is idempotent, and it also repairs rows an older
// binary wrote into an already migrated file, which carry the default
// 0 and would otherwise be pruned at once.
//
// A row that predates the column has no recorded arrival: it takes its
// declared time, or the migration time when that lies in the future, so
// a record dated years ahead starts ageing now instead of never.
func (s *Store) migrateReceivedAt() error {
	s.wmu.Lock()
	defer s.wmu.Unlock()
	now := time.Now().UnixNano()
	for _, table := range []string{"events", "alerts"} {
		has, err := hasColumn(s.w, table, "received_at")
		if err != nil {
			return fmt.Errorf("store: inspect %s: %w", table, err)
		}
		if !has {
			if _, err := s.w.Exec(`ALTER TABLE ` + table + ` ADD COLUMN received_at INTEGER NOT NULL DEFAULT 0`); err != nil {
				return fmt.Errorf("store: add %s.received_at: %w", table, err)
			}
		}
		if _, err := s.w.Exec(`CREATE INDEX IF NOT EXISTS ` + table + `_received_idx ON ` + table + `(received_at)`); err != nil {
			return fmt.Errorf("store: index %s.received_at: %w", table, err)
		}
		if _, err := s.w.Exec(`UPDATE `+table+` SET received_at = MAX(1, MIN(ts, ?)) WHERE received_at = 0`, now); err != nil {
			return fmt.Errorf("store: backfill %s.received_at: %w", table, err)
		}
	}
	return nil
}

// hasColumn reports whether table has a column of that name. The table
// name is a package literal, never caller input.
func hasColumn(db *sql.DB, table, column string) (bool, error) {
	rows, err := db.Query(`SELECT name FROM pragma_table_info('` + table + `')`)
	if err != nil {
		return false, err
	}
	defer rows.Close()
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return false, err
		}
		if name == column {
			return true, nil
		}
	}
	return false, rows.Err()
}
