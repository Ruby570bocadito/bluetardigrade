package store

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"

	"github.com/Ruby570bocadito/bluetardigrade/internal/alert"
	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
)

// Increase this when the derived search vocabulary changes. Legacy databases
// have user_version=0; JSON evidence, row identities and timestamps stay intact.
const searchIndexVersion = 1

func (s *Store) migrateSearchIndex() error {
	var version int
	if err := s.db.QueryRow("PRAGMA user_version").Scan(&version); err != nil {
		return fmt.Errorf("store: read search index version: %w", err)
	}
	if version == searchIndexVersion {
		return nil
	}
	if version > searchIndexVersion {
		return fmt.Errorf("store: unsupported search index version %d", version)
	}
	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("store: begin search migration: %w", err)
	}
	defer tx.Rollback()
	if err := rebuildSearchTable(tx, "events", func(raw []byte) (string, error) {
		var event model.Event
		if err := json.Unmarshal(raw, &event); err != nil {
			return "", err
		}
		return eventHaystack(&event), nil
	}); err != nil {
		return err
	}
	if err := rebuildSearchTable(tx, "alerts", func(raw []byte) (string, error) {
		var record alert.Alert
		if err := json.Unmarshal(raw, &record); err != nil {
			return "", err
		}
		return alertHaystack(record), nil
	}); err != nil {
		return err
	}
	if _, err := tx.Exec(fmt.Sprintf("PRAGMA user_version = %d", searchIndexVersion)); err != nil {
		return fmt.Errorf("store: save search index version: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("store: commit search migration: %w", err)
	}
	return nil
}

// A bounded keyset scan avoids holding the full history in memory. Only the
// derived search column is updated; payloads (including unknown fields), row
// ordering and any retained evidence are never rewritten or replaced.
func rebuildSearchTable(tx *sql.Tx, table string, decode func([]byte) (string, error)) error {
	statement, err := tx.Prepare("UPDATE " + table + " SET search = ? WHERE rowid = ?")
	if err != nil {
		return fmt.Errorf("store: prepare %s search migration: %w", table, err)
	}
	defer statement.Close()
	var after int64
	first := true
	for {
		query := "SELECT rowid, json FROM " + table
		var args []any
		if !first {
			query += " WHERE rowid > ?"
			args = append(args, after)
		}
		rows, err := tx.Query(query+" ORDER BY rowid LIMIT 256", args...)
		if err != nil {
			return fmt.Errorf("store: read %s search migration: %w", table, err)
		}
		type update struct {
			row    int64
			search string
		}
		batch := make([]update, 0, 256)
		for rows.Next() {
			var row int64
			var raw []byte
			if err := rows.Scan(&row, &raw); err != nil {
				_ = rows.Close()
				return fmt.Errorf("store: scan %s search migration: %w", table, err)
			}
			trimmed := bytes.TrimSpace(raw)
			if len(trimmed) == 0 || trimmed[0] != '{' {
				_ = rows.Close()
				return fmt.Errorf("store: invalid %s evidence at row %d during search migration", table, row)
			}
			search, err := decode(raw)
			if err != nil {
				_ = rows.Close()
				return fmt.Errorf("store: decode %s evidence at row %d during search migration: %w", table, row, err)
			}
			batch = append(batch, update{row, search})
		}
		readErr := rows.Err()
		closeErr := rows.Close()
		if readErr != nil {
			return fmt.Errorf("store: read %s search migration: %w", table, readErr)
		}
		if closeErr != nil {
			return fmt.Errorf("store: close %s search migration: %w", table, closeErr)
		}
		for _, entry := range batch {
			if _, err := statement.Exec(entry.search, entry.row); err != nil {
				return fmt.Errorf("store: update %s search migration: %w", table, err)
			}
			after = entry.row
		}
		if len(batch) < 256 {
			return nil
		}
		first = false
	}
}
