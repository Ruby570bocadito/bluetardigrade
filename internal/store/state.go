package store

// Engine state that must survive a restart besides events and alerts:
// the machine inventory (internal/fleet) and the per-host baseline of
// what was already seen (internal/baseline). Both are small keyed sets,
// stored as opaque JSON documents or plain rows; the owning packages
// decide their meaning.

import (
	"fmt"
	"strings"
	"time"
)

const stateSchema = `
CREATE TABLE IF NOT EXISTS fleet_hosts (
        host    TEXT PRIMARY KEY,
        updated INTEGER NOT NULL,
        json    TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS baseline (
        host       TEXT NOT NULL,
        kind       TEXT NOT NULL,
        value      TEXT NOT NULL,
        first_seen INTEGER NOT NULL,
        PRIMARY KEY (host, kind, value)
);
CREATE TABLE IF NOT EXISTS baseline_hosts (
        host       TEXT PRIMARY KEY,
        first_seen INTEGER NOT NULL
);
`

func (s *Store) migrateState() error {
	if _, err := s.db.Exec(stateSchema); err != nil {
		return fmt.Errorf("store: state schema: %w", err)
	}
	return nil
}

// SaveFleetHosts upserts one JSON document per host (key: lowercase host).
func (s *Store) SaveFleetHosts(docs map[string][]byte) error {
	if len(docs) == 0 {
		return nil
	}
	s.wmu.Lock()
	defer s.wmu.Unlock()
	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("store: fleet begin: %w", err)
	}
	now := time.Now().UnixNano()
	for host, doc := range docs {
		if _, err := tx.Exec(`INSERT INTO fleet_hosts (host, updated, json) VALUES (?, ?, ?)
                        ON CONFLICT(host) DO UPDATE SET updated = excluded.updated, json = excluded.json`,
			strings.ToLower(host), now, string(doc)); err != nil {
			tx.Rollback()
			return fmt.Errorf("store: fleet upsert: %w", err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("store: fleet commit: %w", err)
	}
	return nil
}

// DeleteFleetHosts removes retired hosts.
func (s *Store) DeleteFleetHosts(hosts []string) error {
	s.wmu.Lock()
	defer s.wmu.Unlock()
	for _, host := range hosts {
		if _, err := s.db.Exec(`DELETE FROM fleet_hosts WHERE host = ?`, strings.ToLower(host)); err != nil {
			return fmt.Errorf("store: fleet delete: %w", err)
		}
	}
	return nil
}

// LoadFleetHosts returns every stored host document.
func (s *Store) LoadFleetHosts() (map[string][]byte, error) {
	rows, err := s.db.Query(`SELECT host, json FROM fleet_hosts`)
	if err != nil {
		return nil, fmt.Errorf("store: fleet load: %w", err)
	}
	defer rows.Close()
	out := map[string][]byte{}
	for rows.Next() {
		var host, doc string
		if err := rows.Scan(&host, &doc); err != nil {
			return nil, fmt.Errorf("store: fleet scan: %w", err)
		}
		out[host] = []byte(doc)
	}
	return out, rows.Err()
}

// BaselineEntry is one value already seen on a host (kind: "process"...).
type BaselineEntry struct {
	Host      string
	Kind      string
	Value     string
	FirstSeen time.Time
}

// AddBaseline records entries; existing ones keep their first_seen.
func (s *Store) AddBaseline(entries []BaselineEntry) error {
	if len(entries) == 0 {
		return nil
	}
	s.wmu.Lock()
	defer s.wmu.Unlock()
	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("store: baseline begin: %w", err)
	}
	for _, e := range entries {
		if _, err := tx.Exec(`INSERT OR IGNORE INTO baseline (host, kind, value, first_seen) VALUES (?, ?, ?, ?)`,
			strings.ToLower(e.Host), e.Kind, e.Value, e.FirstSeen.UnixNano()); err != nil {
			tx.Rollback()
			return fmt.Errorf("store: baseline insert: %w", err)
		}
		if _, err := tx.Exec(`INSERT OR IGNORE INTO baseline_hosts (host, first_seen) VALUES (?, ?)`,
			strings.ToLower(e.Host), e.FirstSeen.UnixNano()); err != nil {
			tx.Rollback()
			return fmt.Errorf("store: baseline host: %w", err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("store: baseline commit: %w", err)
	}
	return nil
}

// LoadBaseline returns every stored entry and when each host was first seen.
func (s *Store) LoadBaseline() ([]BaselineEntry, map[string]time.Time, error) {
	hosts := map[string]time.Time{}
	hr, err := s.db.Query(`SELECT host, first_seen FROM baseline_hosts`)
	if err != nil {
		return nil, nil, fmt.Errorf("store: baseline hosts: %w", err)
	}
	for hr.Next() {
		var host string
		var ns int64
		if err := hr.Scan(&host, &ns); err != nil {
			hr.Close()
			return nil, nil, fmt.Errorf("store: baseline hosts scan: %w", err)
		}
		hosts[host] = time.Unix(0, ns)
	}
	hr.Close()
	rows, err := s.db.Query(`SELECT host, kind, value, first_seen FROM baseline`)
	if err != nil {
		return nil, nil, fmt.Errorf("store: baseline load: %w", err)
	}
	defer rows.Close()
	var out []BaselineEntry
	for rows.Next() {
		var e BaselineEntry
		var ns int64
		if err := rows.Scan(&e.Host, &e.Kind, &e.Value, &ns); err != nil {
			return nil, nil, fmt.Errorf("store: baseline scan: %w", err)
		}
		e.FirstSeen = time.Unix(0, ns)
		out = append(out, e)
	}
	return out, hosts, rows.Err()
}
