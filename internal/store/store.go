// Package store persists events and alerts to a SQLite database so
// telemetry outlives the in-memory rings of the API hub. It is the
// phase-2 storage stone: opt-in via the engine's -store flag, WAL
// journalling, pure-Go driver (modernc.org/sqlite) so the Docker build
// and the CI stay cgo-free.
//
// Design notes:
//   - The full record is stored as its JSON payload (the wire format
//     of pkg/model) and indexed columns (ts, host, type, severity,
//     rule_id) exist only to filter and order. Reads unmarshal the
//     JSON back, so what an API consumer receives is byte-shape
//     identical to the live feed.
//   - A lowercase `search` column mirrors the free-text haystack of
//     the API filters (same field lists), joined with \x1f so a query
//     can never match across two field boundaries by accident.
//   - Writes are serialized by a mutex; the DB runs in WAL mode with
//     a busy timeout, so HTTP readers never block the engine loop.
package store

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	_ "modernc.org/sqlite" // pure-Go SQLite driver (registered as "sqlite")

	"github.com/Ruby570bocadito/security-framework/internal/alert"
	"github.com/Ruby570bocadito/security-framework/pkg/model"
)

// fieldSep joins the search haystack parts; a control character that
// cannot appear inside a filter needle, so "ab cd" never matches
// "...ab\x1fcd..." across two fields.
const fieldSep = "\x1f"

// Store is an open SQLite persistence handle.
type Store struct {
	db *sql.DB

	wmu sync.Mutex // serializes writes (single-writer discipline)

	events int64 // live row counts, maintained by insert/prune
	alerts int64
}

// EventQuery is the filter form of the API telemetry parameters for
// events (same semantics as the hub's recordFilter).
type EventQuery struct {
	Host  string // exact, case-insensitive
	Type  string // exact event type
	Q     string // free-text substring, case-insensitive
	Since time.Time
	Until time.Time
	Limit int // must be > 0; results come newest-first
}

// AlertQuery is the filter form for alerts.
type AlertQuery struct {
	Host       string
	Severities []string // accepted severities, case-insensitive (empty = any)
	RuleID     string   // exact
	Q          string
	Since      time.Time
	Until      time.Time
	Limit      int
}

// Open opens (creating if needed) the SQLite file and applies the
// schema. WAL + busy_timeout keep concurrent API readers off the
// engine's write path; synchronous=NORMAL is the documented WAL
// pairing (durable across app crashes, may lose the last commits on
// power loss — the right trade for telemetry).
func Open(path string) (*Store, error) {
	// SQLite creates new database files with 0644: the full ingested
	// history (command lines, users, hosts) must not be readable by
	// every local account, so the file is pre-created 0600 when it
	// does not exist yet. Existing files keep their mode — the
	// operator may have set it deliberately. The -wal/-shm siblings
	// SQLite manages itself inherit the process umask; deployments
	// behind multi-user hosts should set a restrictive umask.
	if err := ensurePrivateFile(path); err != nil {
		return nil, fmt.Errorf("store: create %s: %w", path, err)
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("store: open %s: %w", path, err)
	}
	// A single connection keeps the per-connection pragmas honest and
	// sqlite's own serialization happy: this engine writes from one
	// loop and readers share the same handle.
	db.SetMaxOpenConns(1)
	for _, pragma := range []string{
		"PRAGMA journal_mode=WAL",
		"PRAGMA synchronous=NORMAL",
		"PRAGMA busy_timeout=5000",
	} {
		if _, err := db.Exec(pragma); err != nil {
			db.Close()
			return nil, fmt.Errorf("store: %s: %w", pragma, err)
		}
	}
	schema := `
CREATE TABLE IF NOT EXISTS events (
        id     TEXT PRIMARY KEY,
        ts     INTEGER NOT NULL,
        type   TEXT NOT NULL DEFAULT '',
        host   TEXT NOT NULL DEFAULT '',
        search TEXT NOT NULL DEFAULT '',
        json   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_ts_idx ON events(ts);
CREATE TABLE IF NOT EXISTS alerts (
        seq      INTEGER PRIMARY KEY AUTOINCREMENT,
        ts       INTEGER NOT NULL,
        severity TEXT NOT NULL DEFAULT '',
        rule_id  TEXT NOT NULL DEFAULT '',
        host     TEXT NOT NULL DEFAULT '',
        search   TEXT NOT NULL DEFAULT '',
        json     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS alerts_ts_idx ON alerts(ts);
CREATE INDEX IF NOT EXISTS alerts_rule_idx ON alerts(rule_id);
`
	if _, err := db.Exec(schema); err != nil {
		db.Close()
		return nil, fmt.Errorf("store: schema: %w", err)
	}
	s := &Store{db: db}
	// seed the live counters with what is already on disk (a restart
	// keeps serving history, so the stats must reflect it)
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM events`).Scan(&s.events); err != nil {
		db.Close()
		return nil, fmt.Errorf("store: count events: %w", err)
	}
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM alerts`).Scan(&s.alerts); err != nil {
		db.Close()
		return nil, fmt.Errorf("store: count alerts: %w", err)
	}
	return s, nil
}

// ensurePrivateFile pre-creates the database file with owner-only
// permissions when it does not exist yet (SQLite's own creation mode
// is 0644 minus umask, too open for evidence). A file created in
// between by someone else is accepted as-is.
func ensurePrivateFile(path string) error {
	if _, err := os.Stat(path); err == nil {
		return nil
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if os.IsExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	return f.Close()
}

// Close closes the database.
func (s *Store) Close() error { return s.db.Close() }

// Counts returns the live row counts (maintained incrementally; the
// values include rows that predate this process start).
func (s *Store) Counts() (events, alerts int64) {
	return atomic.LoadInt64(&s.events), atomic.LoadInt64(&s.alerts)
}

// InsertEvent persists one event. Re-inserting an existing ID
// replaces the row (sensor replays are idempotent) without inflating
// the row count.
func (s *Store) InsertEvent(ev *model.Event) error {
	payload, err := json.Marshal(ev)
	if err != nil {
		return fmt.Errorf("store: marshal event %s: %w", ev.ID, err)
	}
	s.wmu.Lock()
	defer s.wmu.Unlock()
	// DELETE+INSERT (not INSERT OR REPLACE) so the live counter can
	// account for replays: a replace must not look like a new row.
	res, err := s.db.Exec(`DELETE FROM events WHERE id = ?`, ev.ID)
	if err != nil {
		return fmt.Errorf("store: replace-lookup event %s: %w", ev.ID, err)
	}
	existed, _ := res.RowsAffected()
	_, err = s.db.Exec(
		`INSERT INTO events (id, ts, type, host, search, json)
                 VALUES (?, ?, ?, ?, ?, ?)`,
		ev.ID, ev.Timestamp.UnixNano(), ev.Type, ev.Host,
		eventHaystack(ev), string(payload),
	)
	if err != nil {
		return fmt.Errorf("store: insert event %s: %w", ev.ID, err)
	}
	atomic.AddInt64(&s.events, 1-existed)
	return nil
}

// InsertAlert persists one alert. Alerts have no natural key, so
// every raised alert is a new row (the dedup TTL lives upstream).
func (s *Store) InsertAlert(a alert.Alert) error {
	payload, err := json.Marshal(a)
	if err != nil {
		return fmt.Errorf("store: marshal alert: %w", err)
	}
	ts := time.Now()
	if parsed, perr := time.Parse(time.RFC3339Nano, a.Timestamp); perr == nil {
		ts = parsed
	}
	s.wmu.Lock()
	defer s.wmu.Unlock()
	_, err = s.db.Exec(
		`INSERT INTO alerts (ts, severity, rule_id, host, search, json)
                 VALUES (?, ?, ?, ?, ?, ?)`,
		ts.UnixNano(), a.Severity, a.RuleID, a.Host,
		alertHaystack(a), string(payload),
	)
	if err != nil {
		return fmt.Errorf("store: insert alert: %w", err)
	}
	atomic.AddInt64(&s.alerts, 1)
	return nil
}

// QueryEvents returns up to q.Limit events, newest first. The JSON
// payload is authoritative: results round-trip the exact records that
// were ingested.
func (s *Store) QueryEvents(q EventQuery) ([]*model.Event, error) {
	where, args := eventWhere(q)
	rows, err := s.db.Query(
		`SELECT json FROM events `+where+`
                 ORDER BY ts DESC, rowid DESC LIMIT `+strconv.Itoa(clampLimit(q.Limit)),
		args...)
	if err != nil {
		return nil, fmt.Errorf("store: query events: %w", err)
	}
	defer rows.Close()
	var out []*model.Event
	for rows.Next() {
		var payload string
		if err := rows.Scan(&payload); err != nil {
			return nil, fmt.Errorf("store: scan event: %w", err)
		}
		ev := &model.Event{}
		if err := json.Unmarshal([]byte(payload), ev); err != nil {
			return nil, fmt.Errorf("store: unmarshal event: %w", err)
		}
		out = append(out, ev)
	}
	return out, rows.Err()
}

// QueryAlerts returns up to q.Limit alerts, newest first.
func (s *Store) QueryAlerts(q AlertQuery) ([]alert.Alert, error) {
	where, args := alertWhere(q)
	rows, err := s.db.Query(
		`SELECT json FROM alerts `+where+`
                 ORDER BY ts DESC, seq DESC LIMIT `+strconv.Itoa(clampLimit(q.Limit)),
		args...)
	if err != nil {
		return nil, fmt.Errorf("store: query alerts: %w", err)
	}
	defer rows.Close()
	var out []alert.Alert
	for rows.Next() {
		var payload string
		if err := rows.Scan(&payload); err != nil {
			return nil, fmt.Errorf("store: scan alert: %w", err)
		}
		a := alert.Alert{}
		if err := json.Unmarshal([]byte(payload), &a); err != nil {
			return nil, fmt.Errorf("store: unmarshal alert: %w", err)
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// Prune deletes rows older than the retention window and reports how
// many were removed per table. A retention of 0 (keep forever) is a
// no-op handled by the caller.
func (s *Store) Prune(retention time.Duration) (events, alerts int64, err error) {
	cutoff := time.Now().Add(-retention).UnixNano()
	s.wmu.Lock()
	defer s.wmu.Unlock()
	res, err := s.db.Exec(`DELETE FROM events WHERE ts < ?`, cutoff)
	if err != nil {
		return 0, 0, fmt.Errorf("store: prune events: %w", err)
	}
	events, _ = res.RowsAffected()
	res, err = s.db.Exec(`DELETE FROM alerts WHERE ts < ?`, cutoff)
	if err != nil {
		return events, 0, fmt.Errorf("store: prune alerts: %w", err)
	}
	alerts, _ = res.RowsAffected()
	atomic.AddInt64(&s.events, -events)
	atomic.AddInt64(&s.alerts, -alerts)
	return events, alerts, nil
}

// ------------------------------------------------------------- where

func eventWhere(q EventQuery) (string, []any) {
	conds := []string{}
	var args []any
	if q.Host != "" {
		conds = append(conds, `host = ? COLLATE NOCASE`)
		args = append(args, q.Host)
	}
	if q.Type != "" {
		conds = append(conds, `type = ?`)
		args = append(args, q.Type)
	}
	if !q.Since.IsZero() {
		conds = append(conds, `ts >= ?`)
		args = append(args, q.Since.UnixNano())
	}
	if !q.Until.IsZero() {
		conds = append(conds, `ts <= ?`)
		args = append(args, q.Until.UnixNano())
	}
	if q.Q != "" {
		conds = append(conds, `search LIKE ? ESCAPE '\'`)
		args = append(args, likeNeedle(q.Q))
	}
	where := "WHERE " + strings.Join(conds, " AND ")
	if len(conds) == 0 {
		where = ""
	}
	return where, args
}

func alertWhere(q AlertQuery) (string, []any) {
	conds := []string{}
	var args []any
	if q.Host != "" {
		conds = append(conds, `host = ? COLLATE NOCASE`)
		args = append(args, q.Host)
	}
	if len(q.Severities) > 0 {
		// severity values arrive validated from the API layer; compare
		// case-insensitively via LOWER on both sides, bound as parameters
		marks := make([]string, len(q.Severities))
		for i, sev := range q.Severities {
			marks[i] = "?"
			args = append(args, strings.ToLower(sev))
		}
		conds = append(conds, `LOWER(severity) IN (`+strings.Join(marks, ",")+`)`)
	}
	if q.RuleID != "" {
		conds = append(conds, `rule_id = ?`)
		args = append(args, q.RuleID)
	}
	if !q.Since.IsZero() {
		conds = append(conds, `ts >= ?`)
		args = append(args, q.Since.UnixNano())
	}
	if !q.Until.IsZero() {
		conds = append(conds, `ts <= ?`)
		args = append(args, q.Until.UnixNano())
	}
	if q.Q != "" {
		conds = append(conds, `search LIKE ? ESCAPE '\'`)
		args = append(args, likeNeedle(q.Q))
	}
	where := "WHERE " + strings.Join(conds, " AND ")
	if len(conds) == 0 {
		where = ""
	}
	return where, args
}

// likeNeedle lowercases the needle and escapes the LIKE wildcards so
// a query containing % or _ stays a literal.
func likeNeedle(q string) string {
	r := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return "%" + r.Replace(strings.ToLower(q)) + "%"
}

func clampLimit(n int) int {
	if n <= 0 {
		return 1
	}
	if n > 10000 {
		return 10000
	}
	return n
}

// ----------------------------------------------------------- haystacks

// eventHaystack mirrors api.eventHaystack (same field list) so the
// free-text filter behaves identically whether it runs against the
// in-memory ring or the store. Fields are lowercased here so the
// stored column is already folded: SQLite's LIKE (and its LOWER())
// only folds ASCII, so relying on the engine would diverge from the
// API's Unicode-aware filter the first time a host, user or domain
// carries an accent — the needle arrives Unicode-lowercased from the
// API layer, and only a Unicode-lowercased haystack matches it.
func eventHaystack(ev *model.Event) string {
	parts := []string{ev.ID, ev.Type, ev.Source, ev.Host, ev.User}
	if ev.Process != nil {
		parts = append(parts, ev.Process.Name, ev.Process.CommandLine)
	}
	if ev.File != nil {
		parts = append(parts, ev.File.Path)
	}
	if ev.Network != nil {
		parts = append(parts, ev.Network.DestinationIP, ev.Network.Domain)
	}
	if ev.Registry != nil {
		parts = append(parts, ev.Registry.Key, ev.Registry.ValueName)
	}
	if ev.Target != nil {
		parts = append(parts, ev.Target.Name)
	}
	for i, p := range parts {
		parts[i] = strings.ToLower(p)
	}
	return strings.Join(parts, fieldSep)
}

// alertHaystack mirrors api.alertHaystack (same field list), already
// Unicode-lowercased at write time — see eventHaystack for why the
// fold cannot be left to SQLite's LIKE.
func alertHaystack(a alert.Alert) string {
	parts := []string{
		a.RuleID, a.RuleName, a.Host, a.User, a.Summary, a.Message,
		a.EventType, a.Severity,
		strings.Join(a.Tags, " "), strings.Join(a.MatchedOn, " "),
	}
	for i, p := range parts {
		parts[i] = strings.ToLower(p)
	}
	return strings.Join(parts, fieldSep)
}
