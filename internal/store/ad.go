package store

// Active Directory snapshot (TODO AD-1, read-only connector): one row
// per directory object the last successful sync saw, plus the direct
// group-membership edges and the posture-score history (TODO AD-2).
// Everything is replaced on every completed sync inside ONE
// transaction, so the tables always describe one consistent snapshot
// of the directory: no half-synced mixture of old and new objects, no
// objects that vanished from AD lingering forever.
//
// The `json` column keeps the full attribute document (same discipline
// as events/alerts: indexed columns filter and order, the JSON payload
// is the wire record). The security-relevant attributes the connector
// reads (userAccountControl, pwdLastSet, ...) are promoted to typed
// columns so the posture analysis can do its work in SQL-assisted Go
// without decoding every row.

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
)

// AD kinds.
const (
	ADKindUser     = "user"
	ADKindGroup    = "group"
	ADKindComputer = "computer"
	ADKindOU       = "ou"
)

// ADObject is one directory object as stored and served. Raw carries
// the attributes verbatim (the JSON wire document); the typed fields
// above it are the ones the API and the posture analysis use often
// enough to deserve columns.
type ADObject struct {
	DN          string            `json:"dn"`
	Kind        string            `json:"kind"`
	Name        string            `json:"name"` // sAMAccountName (or the OU's name)
	SID         string            `json:"sid,omitempty"`
	UAC         int64             `json:"user_account_control"`
	AdminCount  int64             `json:"admin_count"`
	PwdLastSet  int64             `json:"pwd_last_set_unix"` // unix seconds, 0 = never/unknown
	LastLogon   int64             `json:"last_logon_unix"`   // unix seconds, 0 = never/unknown
	SPNCount    int               `json:"spn_count"`
	EncTypes    int64             `json:"enc_types"` // msDS-SupportedEncryptionTypes, 0 = unset (RC4 fallback)
	OS          string            `json:"os,omitempty"`
	WhenChanged int64             `json:"when_changed_unix"` // unix seconds, 0 = unknown
	Attributes  map[string]string `json:"attributes,omitempty"`
}

// adSearchKeep builds the free-text haystack of one object row (same
// field-separator discipline as the events/alerts haystack).
func adSearchKeep(o *ADObject) string {
	return strings.ToLower(o.Name) + fieldSep + strings.ToLower(o.DN) + fieldSep + strings.ToLower(o.OS)
}

// ADGroupEdge is one DIRECT membership as the directory states it
// (group DN -> member DN). Nested membership is derived, never stored
// as truth: the posture analysis walks the edges at sync time.
type ADGroupEdge struct {
	GroupDN  string
	MemberDN string
}

const adSchema = `
CREATE TABLE IF NOT EXISTS ad_objects (
        dn           TEXT PRIMARY KEY,
        kind         TEXT NOT NULL DEFAULT '',
        name         TEXT NOT NULL DEFAULT '',
        sid          TEXT NOT NULL DEFAULT '',
        uac          INTEGER NOT NULL DEFAULT 0,
        admin_count  INTEGER NOT NULL DEFAULT 0,
        pwd_last_set INTEGER NOT NULL DEFAULT 0,
        last_logon   INTEGER NOT NULL DEFAULT 0,
        spn_count    INTEGER NOT NULL DEFAULT 0,
        enc_types    INTEGER NOT NULL DEFAULT 0,
        os           TEXT NOT NULL DEFAULT '',
        when_changed INTEGER NOT NULL DEFAULT 0,
        search       TEXT NOT NULL DEFAULT '',
        json         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ad_objects_kind_idx ON ad_objects(kind);
CREATE TABLE IF NOT EXISTS ad_group_edges (
        group_dn  TEXT NOT NULL,
        member_dn TEXT NOT NULL,
        PRIMARY KEY (group_dn, member_dn)
);
CREATE INDEX IF NOT EXISTS ad_group_edges_member_idx ON ad_group_edges(member_dn COLLATE NOCASE);
CREATE TABLE IF NOT EXISTS ad_posture_history (
        seq  INTEGER PRIMARY KEY AUTOINCREMENT,
        at   INTEGER NOT NULL,
        score INTEGER NOT NULL,
        json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ad_posture_history_at_idx ON ad_posture_history(at);
`

// adPostureKept caps the posture history: one score per sync at the
// smallest documented interval (5 minutes) is 288 rows a day; 500 rows
// is well over a day of worst-case history and a year of real use at
// the default 15-minute interval. Same bookkeeping rationale as
// scenario_runs.
const adPostureKept = 500

func (s *Store) migrateAD() error {
	if _, err := s.db.Exec(adSchema); err != nil {
		return fmt.Errorf("store: ad schema: %w", err)
	}
	return nil
}

// ReplaceADSnapshot atomically installs one complete directory
// snapshot: every previous object and edge is dropped and the new ones
// inserted in a single transaction. Readers see either the old or the
// new snapshot, never a mixture (WAL: readers do not block writers).
func (s *Store) ReplaceADSnapshot(objects []*ADObject, edges []ADGroupEdge) error {
	s.wmu.Lock()
	defer s.wmu.Unlock()
	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("store: ad snapshot begin: %w", err)
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`DELETE FROM ad_objects`); err != nil {
		return fmt.Errorf("store: ad snapshot clear objects: %w", err)
	}
	if _, err := tx.Exec(`DELETE FROM ad_group_edges`); err != nil {
		return fmt.Errorf("store: ad snapshot clear edges: %w", err)
	}
	insertObj, err := tx.Prepare(`INSERT INTO ad_objects
                (dn, kind, name, sid, uac, admin_count, pwd_last_set, last_logon, spn_count, enc_types, os, when_changed, search, json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
	if err != nil {
		return fmt.Errorf("store: ad snapshot prepare: %w", err)
	}
	defer insertObj.Close()
	for _, o := range objects {
		doc, err := json.Marshal(o)
		if err != nil {
			return fmt.Errorf("store: ad object %s: %w", o.DN, err)
		}
		if _, err := insertObj.Exec(o.DN, o.Kind, o.Name, o.SID, o.UAC, o.AdminCount,
			o.PwdLastSet, o.LastLogon, o.SPNCount, o.EncTypes, o.OS, o.WhenChanged,
			adSearchKeep(o), string(doc)); err != nil {
			return fmt.Errorf("store: ad object %s: %w", o.DN, err)
		}
	}
	insertEdge, err := tx.Prepare(`INSERT INTO ad_group_edges (group_dn, member_dn) VALUES (?, ?)`)
	if err != nil {
		return fmt.Errorf("store: ad edges prepare: %w", err)
	}
	defer insertEdge.Close()
	for _, e := range edges {
		if _, err := insertEdge.Exec(e.GroupDN, e.MemberDN); err != nil {
			return fmt.Errorf("store: ad edge %s: %w", e.GroupDN, err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("store: ad snapshot commit: %w", err)
	}
	return nil
}

// ADCounts returns the per-kind row counts of the current snapshot.
func (s *Store) ADCounts() (users, groups, computers, ous int64, err error) {
	rows, err := s.db.Query(`SELECT kind, COUNT(*) FROM ad_objects GROUP BY kind`)
	if err != nil {
		return 0, 0, 0, 0, fmt.Errorf("store: ad counts: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var kind string
		var n int64
		if err := rows.Scan(&kind, &n); err != nil {
			return 0, 0, 0, 0, fmt.Errorf("store: ad counts: %w", err)
		}
		switch kind {
		case ADKindUser:
			users = n
		case ADKindGroup:
			groups = n
		case ADKindComputer:
			computers = n
		case ADKindOU:
			ous = n
		}
	}
	return users, groups, computers, ous, rows.Err()
}

// ADObjectsPage is one filtered page of the snapshot plus the total
// that matches (so a paginated console can size its pager honestly).
type ADObjectsPage struct {
	Total   int         `json:"total"`
	Offset  int         `json:"offset"`
	Objects []*ADObject `json:"objects"`
}

// QueryADObjects serves one page of one kind, newest-change first,
// filtered by the free-text needle over (name, dn, os). The needle is
// a SUBSTRING search (likeNeedle), never a filter interpreter: there
// is no LDAP injection surface from the console because the console
// query never reaches LDAP — it runs against the local snapshot.
func (s *Store) QueryADObjects(kind, q string, limit, offset int) (*ADObjectsPage, error) {
	if limit <= 0 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}
	base := `FROM ad_objects WHERE kind = ?`
	args := []any{kind}
	if q != "" {
		base += ` AND search LIKE ? ESCAPE '\'`
		args = append(args, likeNeedle(q))
	}
	var total int
	if err := s.db.QueryRow(`SELECT COUNT(*) `+base, args...).Scan(&total); err != nil {
		return nil, fmt.Errorf("store: ad objects count: %w", err)
	}
	rows, err := s.db.Query(`SELECT json `+base+` ORDER BY name COLLATE NOCASE, dn LIMIT ? OFFSET ?`,
		append(args, limit, offset)...)
	if err != nil {
		return nil, fmt.Errorf("store: ad objects query: %w", err)
	}
	defer rows.Close()
	page := &ADObjectsPage{Total: total, Offset: offset, Objects: []*ADObject{}}
	for rows.Next() {
		var doc string
		if err := rows.Scan(&doc); err != nil {
			return nil, fmt.Errorf("store: ad objects scan: %w", err)
		}
		var o ADObject
		if err := json.Unmarshal([]byte(doc), &o); err != nil {
			return nil, fmt.Errorf("store: ad objects decode: %w", err)
		}
		page.Objects = append(page.Objects, &o)
	}
	return page, rows.Err()
}

// ADObjectByDN finds one object by its distinguished name
// (case-insensitive: AD DNs are case-preserving but not case-sensitive).
func (s *Store) ADObjectByDN(dn string) (*ADObject, error) {
	row := s.db.QueryRow(`SELECT json FROM ad_objects WHERE dn = ? COLLATE NOCASE`, dn)
	var doc string
	if err := row.Scan(&doc); err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("store: ad object by dn: %w", err)
	}
	var o ADObject
	if err := json.Unmarshal([]byte(doc), &o); err != nil {
		return nil, fmt.Errorf("store: ad object by dn decode: %w", err)
	}
	return &o, nil
}

// ADGroupEdges returns every DIRECT membership edge of the snapshot.
// Memory note: bounded by the connector's object cap — one edge per
// (group, member) pair the directory states, and the cap stops the
// sync long before an unbounded directory could exhaust the engine.
func (s *Store) ADGroupEdges() ([]ADGroupEdge, error) {
	rows, err := s.db.Query(`SELECT group_dn, member_dn FROM ad_group_edges`)
	if err != nil {
		return nil, fmt.Errorf("store: ad edges: %w", err)
	}
	defer rows.Close()
	out := []ADGroupEdge{}
	for rows.Next() {
		var e ADGroupEdge
		if err := rows.Scan(&e.GroupDN, &e.MemberDN); err != nil {
			return nil, fmt.Errorf("store: ad edges scan: %w", err)
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// SaveADPostureJSON records one computed posture run (score + full
// findings document) and prunes the history beyond adPostureKept.
// The JSON is produced by the ad package (store stays schema-free
// about findings — same discipline as the scenario results).
func (s *Store) SaveADPostureJSON(at int64, score int, doc string) error {
	s.wmu.Lock()
	defer s.wmu.Unlock()
	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("store: ad posture begin: %w", err)
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`INSERT INTO ad_posture_history (at, score, json) VALUES (?, ?, ?)`,
		at, score, doc); err != nil {
		return fmt.Errorf("store: ad posture insert: %w", err)
	}
	if _, err := tx.Exec(`DELETE FROM ad_posture_history WHERE seq NOT IN
                (SELECT seq FROM ad_posture_history ORDER BY seq DESC LIMIT ?)`, adPostureKept); err != nil {
		return fmt.Errorf("store: ad posture prune: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("store: ad posture commit: %w", err)
	}
	return nil
}

// ADPosturePoint is one history entry (no findings document).
type ADPosturePoint struct {
	At    int64 `json:"at"`
	Score int   `json:"score"`
}

// ADPostureHistory returns the latest posture scores, oldest first,
// capped to limit (most recent wins).
func (s *Store) ADPostureHistory(limit int) ([]ADPosturePoint, error) {
	if limit <= 0 || limit > adPostureKept {
		limit = adPostureKept
	}
	rows, err := s.db.Query(`SELECT at, score FROM
                (SELECT at, score FROM ad_posture_history ORDER BY seq DESC LIMIT ?)
                ORDER BY at ASC`, limit)
	if err != nil {
		return nil, fmt.Errorf("store: ad posture history: %w", err)
	}
	defer rows.Close()
	out := []ADPosturePoint{}
	for rows.Next() {
		var p ADPosturePoint
		if err := rows.Scan(&p.At, &p.Score); err != nil {
			return nil, fmt.Errorf("store: ad posture history scan: %w", err)
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// LatestADPosture returns the most recent posture document (unix
// seconds, score, raw JSON) or ok=false when no sync has computed one
// yet.
func (s *Store) LatestADPosture() (at int64, score int, doc string, ok bool, err error) {
	row := s.db.QueryRow(`SELECT at, score, json FROM ad_posture_history ORDER BY seq DESC LIMIT 1`)
	var d string
	if err := row.Scan(&at, &score, &d); err != nil {
		if err == sql.ErrNoRows {
			return 0, 0, "", false, nil
		}
		return 0, 0, "", false, fmt.Errorf("store: ad posture latest: %w", err)
	}
	return at, score, d, true, nil
}

// SizeBytes reports the on-disk size of the whole database file as
// SQLite itself accounts it (page_count × page_size): the WAL and SHM
// siblings are transient and not part of the durable store size.
// (SET-3: the console's platform-status view serves this verbatim.)
func (s *Store) SizeBytes() (int64, error) {
	var pageCount, pageSize int64
	if err := s.db.QueryRow(`PRAGMA page_count`).Scan(&pageCount); err != nil {
		return 0, fmt.Errorf("store: size page_count: %w", err)
	}
	if err := s.db.QueryRow(`PRAGMA page_size`).Scan(&pageSize); err != nil {
		return 0, fmt.Errorf("store: size page_size: %w", err)
	}
	return pageCount * pageSize, nil
}
