// Package suppress implements the operator allowlist: YAML entries that
// silence one rule (optionally on one host) until an optional expiration
// instant. It exists for the two maintenance scenarios where an alert is
// correct but unwanted: a sanctioned change window (the rule fires while
// an admin legitimately does the work) and a host with a permanent,
// accepted exception. Entries live in a single suppressions.yaml file
// hot-reloaded on the same ticker as rules and sequences, so editing the
// file is enough to re-arm the engine — no restart. When the engine runs
// with -api-write, the API write surface (internal/api) edits the SAME
// file through SaveFile and reloads it immediately, so hand edits and
// API edits share one source of truth.
package suppress

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"gopkg.in/yaml.v3"
)

// Entry is one suppression rule of the YAML file.
//
// Semantics:
//   - rule_id and host are exact matches (host compared case-insensitively:
//     Windows reports hostnames in arbitrary case). An empty host matches
//     every host, an empty rule_id matches every rule — at least one of
//     them must be set, or LoadFile rejects the entry.
//   - expires (RFC 3339, optional): after that instant the entry stops
//     matching and Active reports it as expired. An entry without expires
//     stays active until it is removed from the file.
//   - reason is documentation for the next operator who reads the file.
type Entry struct {
	RuleID  string `yaml:"rule_id,omitempty" json:"rule_id"`
	Host    string `yaml:"host,omitempty" json:"host,omitempty"`
	Reason  string `yaml:"reason,omitempty" json:"reason,omitempty"`
	Expires string `yaml:"expires,omitempty" json:"expires,omitempty"`
}

// NormalizeEntry applies the canonical form the YAML loader enforces:
// surrounding whitespace trimmed everywhere, host lowercased (Windows
// reports hostnames in arbitrary case). Every write path funnels
// through it so the file never stores a variant spelling of an entry.
func NormalizeEntry(e Entry) Entry {
	return Entry{
		RuleID:  strings.TrimSpace(e.RuleID),
		Host:    strings.ToLower(strings.TrimSpace(e.Host)),
		Reason:  strings.TrimSpace(e.Reason),
		Expires: strings.TrimSpace(e.Expires),
	}
}

// ValidateEntry applies the same acceptance rules the YAML loader
// enforces, with path-free messages so API clients get actionable 400s:
// rule_id and host must not both be empty (the entry would match
// nothing) and expires, when set, must be RFC 3339. Callers that write
// the file (SaveFile, the API) must validate FIRST: a set the engine
// would reject on the next hot-reload must never reach the disk.
func ValidateEntry(e Entry) error {
	if e.RuleID == "" && e.Host == "" {
		return fmt.Errorf("rule_id and host are both empty (nothing would match - fix or delete the entry)")
	}
	if e.Expires != "" {
		if _, err := time.Parse(time.RFC3339, e.Expires); err != nil {
			return fmt.Errorf("expires %q is not RFC 3339 (e.g. 2026-10-02T00:00:00Z): %w", e.Expires, err)
		}
	}
	return nil
}

// Parsed is an entry with its expiration resolved and precomputed for
// the hot path (Active runs once per rule hit).
type Parsed struct {
	RuleID   string
	Host     string // lowercased for comparison; "" matches any host
	Reason   string
	Expires  time.Time // zero = no expiration
	Line     int       // 1-based YAML document index, for error messages
	rawUntil string    // original Expires string, for the API snapshot
}

// Expired reports whether the entry's expiration instant has passed.
func (p Parsed) Expired(now time.Time) bool {
	return !p.Expires.IsZero() && now.After(p.Expires)
}

// Manager holds the active suppression set. LoadFile swaps the whole
// set atomically (hot reload), SuppressedAt is the only lookup the
// engine needs on the alert path.
type Manager struct {
	mu        sync.RWMutex
	entries   []Parsed
	path      string
	loadedMod time.Time // mtime of the file at the last successful load (zero = loaded with no file on disk)
}

// New returns an empty manager. The engine uses one manager for the
// process lifetime and replaces its contents on every reload.
func New() *Manager { return &Manager{} }

// Count returns how many non-expired entries are loaded.
func (m *Manager) Count(now time.Time) int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	n := 0
	for _, e := range m.entries {
		if !e.Expired(now) {
			n++
		}
	}
	return n
}

// SuppressedAt reports whether a rule/host pair is currently silenced,
// and if so returns the entry that matched (for engine logs).
func (m *Manager) SuppressedAt(ruleID, host string, now time.Time) (bool, Parsed) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	hostLow := strings.ToLower(strings.TrimSpace(host))
	for _, e := range m.entries {
		if e.Expired(now) {
			continue
		}
		if e.RuleID != "" && e.RuleID != ruleID {
			continue
		}
		if e.Host != "" && e.Host != hostLow {
			continue
		}
		// both fields empty was rejected at load; here at least one matched
		return true, e
	}
	return false, Parsed{}
}

// Snapshot returns the non-expired entries for observability endpoints
// (GET /api/suppressions), oldest first.
func (m *Manager) Snapshot(now time.Time) []Entry {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make([]Entry, 0, len(m.entries))
	for _, e := range m.entries {
		if e.Expired(now) {
			continue
		}
		out = append(out, Entry{RuleID: e.RuleID, Host: e.Host, Reason: e.Reason, Expires: e.rawUntil})
	}
	return out
}

// LoadFile parses path and swaps it in as the active set. A missing file
// is not an error (the feature is simply off) and yields an empty set;
// malformed YAML or a vacuous entry (no rule_id and no host) IS an error
// so a typo cannot silently disable a control the operator believes is on.
func (m *Manager) LoadFile(path string) error {
	entries, err := parseFile(path)
	if err != nil {
		return err
	}
	var mod time.Time
	if st, err := os.Stat(path); err == nil {
		mod = st.ModTime()
	}
	m.mu.Lock()
	m.entries = entries
	m.path = path
	m.loadedMod = mod
	m.mu.Unlock()
	return nil
}

// ReloadIfChanged re-reads path when the file on disk changed since the
// last load (mtime moved, appeared, or vanished). Write surfaces call it
// right before their read-modify-write so an API write always operates
// on the freshest disk state: without it, a hand edit made between two
// hot-reload ticks (up to the full reload interval) would be silently
// clobbered by SaveFile's next full rewrite - the file is the source of
// truth, and the API is just one of its editors.
//
// It returns true when the set was reloaded. A parse error surfaces to
// the caller UNCHANGED: overwriting a file that does not parse would
// destroy an operator's in-progress edit, so the caller must refuse the
// write instead (the engine's own hot-reload keeps the previous set on
// the same condition - the write surface cannot be more permissive).
func (m *Manager) ReloadIfChanged(path string) (bool, error) {
	st, err := os.Stat(path)
	if err != nil && !os.IsNotExist(err) {
		return false, fmt.Errorf("suppress: stat %s: %w", path, err)
	}
	var mod time.Time
	if st != nil {
		mod = st.ModTime()
	}
	m.mu.RLock()
	sameState := path == m.path && mod.Equal(m.loadedMod)
	m.mu.RUnlock()
	if sameState {
		return false, nil
	}
	if err := m.LoadFile(path); err != nil {
		return false, err
	}
	return true, nil
}

// Path returns the file the current set was loaded from.
func (m *Manager) Path() string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.path
}

// All returns every loaded entry, expired ones included, oldest first —
// the full on-disk set, unlike Snapshot which filters expired entries.
// Write paths need this to edit the file without silently dropping
// entries that merely ran out of clock: an expired change-window entry
// is history the operator may still want to read in the YAML.
func (m *Manager) All() []Entry {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make([]Entry, 0, len(m.entries))
	for _, e := range m.entries {
		out = append(out, Entry{RuleID: e.RuleID, Host: e.Host, Reason: e.Reason, Expires: e.rawUntil})
	}
	return out
}

// SaveFile atomically replaces the contents of path with entries: the
// YAML goes to a temp file in the same directory and is renamed over
// the target, so a crash mid-write can never leave a truncated control
// file behind and the hot-reload ticker only ever reads the old or the
// new set, never a half-written one. Every entry is normalized and
// validated first — a set the engine would reject on the next reload
// must not reach the disk. A file that does not exist yet is created
// 0600 (it silences detections, so it is operator-private); an existing
// file keeps its mode.
func SaveFile(path string, entries []Entry) error {
	clean := make([]Entry, 0, len(entries))
	for i, e := range entries {
		e = NormalizeEntry(e)
		if err := ValidateEntry(e); err != nil {
			return fmt.Errorf("suppress: entry #%d: %w", i+1, err)
		}
		clean = append(clean, e)
	}
	data, err := yaml.Marshal(clean)
	if err != nil {
		return fmt.Errorf("suppress: marshal: %w", err)
	}
	dir := filepath.Dir(path)
	mode := os.FileMode(0o600)
	if st, err := os.Stat(path); err == nil {
		mode = st.Mode().Perm()
	}
	tmp, err := os.CreateTemp(dir, ".suppressions-*")
	if err != nil {
		return fmt.Errorf("suppress: temp file in %s: %w", dir, err)
	}
	tmpName := tmp.Name()
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		os.Remove(tmpName)
		return fmt.Errorf("suppress: write %s: %w", tmpName, err)
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		os.Remove(tmpName)
		return fmt.Errorf("suppress: sync %s: %w", tmpName, err)
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmpName)
		return fmt.Errorf("suppress: close %s: %w", tmpName, err)
	}
	if err := os.Chmod(tmpName, mode); err != nil {
		os.Remove(tmpName)
		return fmt.Errorf("suppress: chmod %s: %w", tmpName, err)
	}
	if err := os.Rename(tmpName, path); err != nil {
		os.Remove(tmpName)
		return fmt.Errorf("suppress: rename %s -> %s: %w", tmpName, path, err)
	}
	return nil
}

func parseFile(path string) ([]Parsed, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil // no file: suppression disabled, not an error
		}
		return nil, fmt.Errorf("suppress: read %s: %w", path, err)
	}
	var raw []Entry
	if err := yaml.Unmarshal(data, &raw); err != nil {
		return nil, fmt.Errorf("suppress: parse %s: %w", path, err)
	}
	out := make([]Parsed, 0, len(raw))
	for i, e := range raw {
		e = NormalizeEntry(e)
		if err := ValidateEntry(e); err != nil {
			return nil, fmt.Errorf("suppress: %s entry #%d: %w", path, i+1, err)
		}
		p := Parsed{
			RuleID:   e.RuleID,
			Host:     e.Host,
			Reason:   e.Reason,
			Line:     i + 1,
			rawUntil: e.Expires,
		}
		if e.Expires != "" {
			t, err := time.Parse(time.RFC3339, e.Expires)
			if err != nil {
				return nil, fmt.Errorf("suppress: %s entry #%d: %w", path, i+1, err)
			}
			p.Expires = t
		}
		out = append(out, p)
	}
	return out, nil
}
