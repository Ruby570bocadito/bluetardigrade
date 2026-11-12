// Package store: read-only query surface over the evidence database (M-4): the API's
// db-query handler runs ONE statement per request through a dedicated
// handle opened mode=ro with query_only on top, so nothing that reaches
// SQLite from this path can write, whatever the statement says. The
// handle is lazy (first query opens it) and never inherits the writer
// pool: WAL lets the two coexist, so a long analysis query never
// blocks the detection loop's inserts.

package store

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"modernc.org/sqlite"
	sqlite3 "modernc.org/sqlite/lib"
)

// Memory bounds of the read-only surface. The row cap alone bounds
// nothing: one row can hold a value of any size, and a value can be
// computed (hex(zeroblob(N)), a group_concat over the whole table)
// rather than read.
const (
	// roMaxValueBytes is the SQLite length limit of the connection a
	// query runs on: the engine refuses to build a larger string or
	// blob ("string or blob too big"), before it exists in memory.
	roMaxValueBytes = 16 << 20
	// roMaxResultBytes is the budget of one buffered result; past it
	// the result is truncated like past the row cap.
	roMaxResultBytes = 32 << 20
)

// auditKeepRows caps the query_audit table: it is operator telemetry
// (who queried what, when, with what result), not evidence, so the
// oldest entries fall off beyond the cap — the same trade the respond
// audit file makes with its size ceiling.
const auditKeepRows = 1000

// auditSQLCap bounds the statement text kept per audit row so one
// oversized query cannot bloat the table.
const auditSQLCap = 4096

// QueryAuditRow is one audited query attempt. Status is "ok",
// "rejected" (the API guard refused the statement) or "error" (the
// statement ran and failed). Denials are audited like successes: the
// trail exists to answer "who ran what", including attempts.
type QueryAuditRow struct {
	TS         time.Time
	Remote     string
	SQL        string
	Status     string
	Rows       int
	DurationMS int64
	Error      string
}

// migrateQueryAudit creates the audit table. It runs from Open with
// the writer handle, before the read-only surface can exist.
func (s *Store) migrateQueryAudit() error {
	const schema = `
CREATE TABLE IF NOT EXISTS query_audit (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        ts          INTEGER NOT NULL,
        remote      TEXT NOT NULL DEFAULT '',
        sql         TEXT NOT NULL,
        status      TEXT NOT NULL DEFAULT '',
        rows        INTEGER NOT NULL DEFAULT 0,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        error       TEXT NOT NULL DEFAULT ''
);
`
	if _, err := s.db.Exec(schema); err != nil {
		return fmt.Errorf("store: query audit schema: %w", err)
	}
	return nil
}

// readOnly returns the dedicated read-only handle, opening it on first
// use. mode=ro stops SQLite at the VFS level and query_only(1) makes
// every connection in the pool refuse writes even if a future driver
// change relaxed the open mode: two independent layers, because the
// guard above this one is software and this one is not.
func (s *Store) readOnly() (*sql.DB, error) {
	s.roOnce.Do(func() {
		dsn := "file:" + s.path + "?mode=ro&_pragma=busy_timeout(5000)&_pragma=query_only(1)"
		db, err := sql.Open("sqlite", dsn)
		if err != nil {
			s.roErr = fmt.Errorf("store: open read-only handle: %w", err)
			return
		}
		db.SetMaxOpenConns(2)
		db.SetMaxIdleConns(2)
		if err := db.Ping(); err != nil {
			db.Close()
			s.roErr = fmt.Errorf("store: read-only handle: %w", err)
			return
		}
		s.roDB = db
	})
	if s.roDB == nil && s.roErr == nil {
		return nil, fmt.Errorf("store: closed")
	}
	return s.roDB, s.roErr
}

// QueryRO runs one statement on the read-only handle and returns up to
// maxRows rows (the caller's guard already clamps it; this is the last
// line of defense against an unbounded scan being buffered whole) and
// at most roMaxResultBytes of values. When the statement yields more,
// truncated reports true and the extra rows are never read. Values come back as nil, int64, float64 or
// string (driver []byte is copied to string so the JSON encoder never
// base64-hides a text column).
func (s *Store) QueryRO(ctx context.Context, statement string, maxRows int) (cols []string, rows [][]any, truncated bool, err error) {
	if maxRows <= 0 {
		return nil, nil, false, fmt.Errorf("store: maxRows must be positive")
	}
	db, err := s.readOnly()
	if err != nil {
		return nil, nil, false, err
	}
	// The length limit belongs to a connection, not to the pool: the
	// query runs on the one it was just set on.
	conn, err := db.Conn(ctx)
	if err != nil {
		return nil, nil, false, err
	}
	defer conn.Close()
	if _, err := sqlite.Limit(conn, sqlite3.SQLITE_LIMIT_LENGTH, roMaxValueBytes); err != nil {
		return nil, nil, false, fmt.Errorf("store: read-only length limit: %w", err)
	}
	rs, err := conn.QueryContext(ctx, statement)
	if err != nil {
		return nil, nil, false, err
	}
	defer rs.Close()
	cols, err = rs.Columns()
	if err != nil {
		return nil, nil, false, err
	}
	out := make([][]any, 0, min(maxRows, 64))
	used := 0
	for rs.Next() {
		if len(out) == maxRows {
			truncated = true
			break
		}
		raw := make([]any, len(cols))
		ptrs := make([]any, len(cols))
		for i := range raw {
			ptrs[i] = &raw[i]
		}
		if err := rs.Scan(ptrs...); err != nil {
			return nil, nil, false, err
		}
		size := 0
		for i, v := range raw {
			switch x := v.(type) {
			case []byte:
				raw[i] = string(x)
				size += len(x)
			case string:
				size += len(x)
			default:
				size += 8
			}
		}
		if used+size > roMaxResultBytes {
			truncated = true
			break
		}
		used += size
		out = append(out, raw)
	}
	// After an early stop the iteration ended on purpose; Err is only
	// meaningful when the loop ran to completion.
	if !truncated {
		if err := rs.Err(); err != nil {
			return nil, nil, false, err
		}
	}
	return cols, out, truncated, nil
}

// RecordQueryAudit appends one attempt to the audit table through the
// WRITER handle (the read-only surface cannot write, by construction)
// and prunes it to auditKeepRows. Serialized behind the same mutex as
// the evidence writes so the single-writer discipline holds.
func (s *Store) RecordQueryAudit(a QueryAuditRow) error {
	text := a.SQL
	if len(text) > auditSQLCap {
		text = text[:auditSQLCap]
	}
	s.wmu.Lock()
	defer s.wmu.Unlock()
	if _, err := s.w.Exec(
		`INSERT INTO query_audit (ts, remote, sql, status, rows, duration_ms, error) VALUES (?,?,?,?,?,?,?)`,
		a.TS.Unix(), a.Remote, text, a.Status, a.Rows, a.DurationMS, a.Error,
	); err != nil {
		return fmt.Errorf("store: query audit: %w", err)
	}
	if _, err := s.w.Exec(
		`DELETE FROM query_audit WHERE id NOT IN (SELECT id FROM query_audit ORDER BY id DESC LIMIT ?)`,
		auditKeepRows,
	); err != nil {
		return fmt.Errorf("store: query audit prune: %w", err)
	}
	return nil
}
