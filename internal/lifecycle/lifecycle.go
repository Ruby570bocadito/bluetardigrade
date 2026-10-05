// Package lifecycle tracks the operator triage state of alerts
// (new -> acknowledged -> closed, with an optional note). It is the
// persistence behind POST /api/alerts/{id}/status and the status
// overlay merged into GET /api/alerts.
//
// Design notes:
//
//   - The store is the source of truth for STATUS; the alert ring
//     (internal/api, 256 entries) stays the source of truth for the
//     alert CONTENT. Merging happens at read time, so statuses
//     outlive ring eviction.
//   - Persistence is a single JSON file written atomically
//     (temp file + rename) on every mutation. Alert triage is a
//     human-paced, low-frequency operation, so write-through costs
//     nothing and buys crash safety: no shutdown hook can lose a
//     close note.
//   - Without a file path the store is memory-only: statuses survive
//     while the process lives and reset on restart. The engine flag
//     -lifecycle makes that explicit and configurable.
//   - Entries are capped (MaxEntries, FIFO eviction of the oldest).
//     When the SQLite store lands (roadmap phase 2) alerts and
//     lifecycle move into it together; until then the cap keeps the
//     file bounded.
package lifecycle

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// Status is the triage state of one alert. "new" is implicit: an
// alert without an entry is new, so no entries are written for it.
type Status string

const (
	// StatusNew is the implicit state of an alert without a triage
	// entry: seen, not yet worked by an operator.
	StatusNew Status = "new"
	// StatusAcknowledged marks an alert an operator has picked up:
	// work in progress, still open.
	StatusAcknowledged Status = "acknowledged"
	// StatusClosed marks an alert an operator has resolved; closed
	// alerts stay in the store for the audit trail but leave the
	// risk score (the KPI models what the engine saw, not what the
	// operator decided).
	StatusClosed Status = "closed"
)

// MaxEntries bounds the store (and the persisted file). Past the cap,
// the OLDEST entries are evicted: triage state of the oldest alerts is
// the least valuable, and an unbounded file on a long-lived engine is
// a slow leak.
const MaxEntries = 10000

// Limits for the free-text fields: enough for a real investigation
// note, small enough that one hostile request cannot fatten the file.
const (
	MaxNoteLen = 2000
	MaxByLen   = 200
)

// ErrPersistFailed marks the Set errors that mean "in-memory state
// updated but the file write failed": the API turns them into 500s
// while every other Set error is a client-side 400. Classification
// goes through errors.Is, never through message text — a message-
// matching router would let error wording (present or future) decide
// status codes.
var ErrPersistFailed = errors.New("lifecycle: persisted state NOT saved")

// Valid reports whether s is a status the API accepts. "new" is
// accepted as an explicit REOPEN: it removes any special-casing on
// the client side (reopen == set status new) and keeps the wire
// vocabulary to exactly the three documented states.
func Valid(s Status) bool {
	switch s {
	case StatusNew, StatusAcknowledged, StatusClosed:
		return true
	}
	return false
}

// Entry is one lifecycle record. At is RFC 3339 UTC (Nano precision).
type Entry struct {
	AlertID string `json:"alert_id"`
	Status  Status `json:"status"`
	Note    string `json:"note,omitempty"`
	By      string `json:"by,omitempty"`
	At      string `json:"at"`
}

type fileFormat struct {
	Version int     `json:"version"`
	Entries []Entry `json:"entries"`
}

// Store holds the lifecycle entries. Safe for concurrent use.
type Store struct {
	mu      sync.Mutex
	path    string // empty = memory only
	entries map[string]Entry
	order   []string // alert ids in insertion order (oldest first)
}

// New creates a store, loading the JSON file when path is non-empty
// and the file exists. A malformed file is an ERROR, not a silent
// empty store: the operator closed alerts on purpose, and resurrecting
// them as "new" would quietly undo triage work (same standard as the
// suppressions file: fail loudly, never fail open).
func New(path string) (*Store, error) {
	s := &Store{path: path, entries: map[string]Entry{}}
	if path == "" {
		return s, nil
	}
	data, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return s, nil // first run: nothing to load
		}
		return nil, fmt.Errorf("lifecycle: read %s: %w", path, err)
	}
	var f fileFormat
	if err := json.Unmarshal(data, &f); err != nil {
		return nil, fmt.Errorf("lifecycle: malformed JSON in %s: %w", path, err)
	}
	if f.Version != 1 {
		return nil, fmt.Errorf("lifecycle: %s: unsupported format version %d (want 1)", path, f.Version)
	}
	for _, e := range f.Entries {
		if e.AlertID == "" || !Valid(e.Status) {
			return nil, fmt.Errorf("lifecycle: %s: invalid entry (alert_id=%q status=%q)", path, e.AlertID, e.Status)
		}
		if _, dup := s.entries[e.AlertID]; dup {
			continue // first entry wins; a later duplicate never re-slots the order
		}
		s.entries[e.AlertID] = e
		s.order = append(s.order, e.AlertID)
	}
	return s, nil
}

// Set records the new status of one alert and persists the store.
// Validation errors (status, field lengths) are returned, not
// swallowed: the API turns them into 400s.
func (s *Store) Set(id string, st Status, note, by string) (Entry, error) {
	if id == "" {
		return Entry{}, errors.New("lifecycle: empty alert id")
	}
	if !Valid(st) {
		return Entry{}, fmt.Errorf("lifecycle: invalid status %q (valid: new, acknowledged, closed)", st)
	}
	if len(note) > MaxNoteLen {
		return Entry{}, fmt.Errorf("lifecycle: note longer than %d characters", MaxNoteLen)
	}
	if len(by) > MaxByLen {
		return Entry{}, fmt.Errorf("lifecycle: by longer than %d characters", MaxByLen)
	}
	e := Entry{AlertID: id, Status: st, Note: note, By: by, At: time.Now().UTC().Format(time.RFC3339Nano)}

	s.mu.Lock()
	defer s.mu.Unlock()
	if _, exists := s.entries[id]; !exists {
		s.order = append(s.order, id)
	}
	s.entries[id] = e
	// FIFO eviction BEFORE writing keeps the file at or under the cap
	// even when entries churn.
	for len(s.order) > MaxEntries {
		oldest := s.order[0]
		s.order = s.order[1:]
		delete(s.entries, oldest)
	}
	if err := s.persistLocked(); err != nil {
		// The in-memory state is already updated: serving the new
		// status is still correct while the process lives, but the
		// operator must know it will NOT survive a restart.
		return e, fmt.Errorf("%w: %w", ErrPersistFailed, err)
	}
	return e, nil
}

// Get returns the entry for an alert, if any. No entry = the alert is
// implicitly new (callers render that default themselves).
func (s *Store) Get(id string) (Entry, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	e, ok := s.entries[id]
	return e, ok
}

// Count returns the number of tracked entries (all statuses).
func (s *Store) Count() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.entries)
}

// List returns every entry oldest-first (insertion order). Read-only
// reporting view (REP-1 SOC activity): triage actions are human-paced,
// so a full copy per report request costs nothing and keeps the
// report builders free of store internals.
func (s *Store) List() []Entry {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]Entry, 0, len(s.order))
	for _, id := range s.order {
		if e, ok := s.entries[id]; ok {
			out = append(out, e)
		}
	}
	return out
}

// persistLocked writes the file atomically: temp file in the same
// directory + rename, so a crash mid-write leaves either the old file
// or the new one, never a truncated mix. Memory-only stores skip it.
func (s *Store) persistLocked() error {
	if s.path == "" {
		return nil
	}
	f := fileFormat{Version: 1, Entries: make([]Entry, 0, len(s.order))}
	for _, id := range s.order {
		if e, ok := s.entries[id]; ok {
			f.Entries = append(f.Entries, e)
		}
	}
	data, err := json.MarshalIndent(&f, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return err
	}
	// A unique temp name (create-then-rename) instead of the fixed
	// "<path>.tmp": a second writer iterating the same directory would
	// otherwise race on the same scratch file and a torn rename could
	// lose one store's state. The engine's single-instance guard makes
	// this rare, not impossible.
	tmp, err := os.CreateTemp(filepath.Dir(s.path), filepath.Base(s.path)+".tmp-*")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		os.Remove(tmpName)
		return err
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmpName)
		return err
	}
	if err := os.Chmod(tmpName, 0o600); err != nil {
		os.Remove(tmpName)
		return err
	}
	return os.Rename(tmpName, s.path)
}
