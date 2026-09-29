// Package suppress implements the operator allowlist: YAML entries that
// silence one rule (optionally on one host) until an optional expiration
// instant. It exists for the two maintenance scenarios where an alert is
// correct but unwanted: a sanctioned change window (the rule fires while
// an admin legitimately does the work) and a host with a permanent,
// accepted exception. Entries live in a single suppressions.yaml file
// hot-reloaded on the same ticker as rules and sequences, so editing the
// file is enough to re-arm the engine — no restart, no write API.
package suppress

import (
	"fmt"
	"os"
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
	RuleID  string `yaml:"rule_id" json:"rule_id"`
	Host    string `yaml:"host" json:"host,omitempty"`
	Reason  string `yaml:"reason" json:"reason,omitempty"`
	Expires string `yaml:"expires" json:"expires,omitempty"`
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
	mu      sync.RWMutex
	entries []Parsed
	path    string
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
	m.mu.Lock()
	m.entries = entries
	m.path = path
	m.mu.Unlock()
	return nil
}

// Path returns the file the current set was loaded from.
func (m *Manager) Path() string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.path
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
		if strings.TrimSpace(e.RuleID) == "" && strings.TrimSpace(e.Host) == "" {
			return nil, fmt.Errorf("suppress: %s entry #%d: rule_id and host are both empty (nothing would match - fix or delete the entry)", path, i+1)
		}
		p := Parsed{
			RuleID:   strings.TrimSpace(e.RuleID),
			Host:     strings.ToLower(strings.TrimSpace(e.Host)),
			Reason:   strings.TrimSpace(e.Reason),
			Line:     i + 1,
			rawUntil: strings.TrimSpace(e.Expires),
		}
		if p.rawUntil != "" {
			t, err := time.Parse(time.RFC3339, p.rawUntil)
			if err != nil {
				return nil, fmt.Errorf("suppress: %s entry #%d: expires %q is not RFC 3339 (e.g. 2026-10-02T00:00:00Z): %w", path, i+1, p.rawUntil, err)
			}
			p.Expires = t
		}
		out = append(out, p)
	}
	return out, nil
}
