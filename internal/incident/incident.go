// Package incident groups related alerts into an investigation case:
// title, severity, status, owner, the affected hosts, the alert ids and
// a timeline of notes. It is the persistence behind /api/incidents.
//
// Design notes (same standard as internal/lifecycle):
//
//   - One JSON file written atomically (temp file + rename) on every
//     mutation. Case work is human-paced, so write-through is free and
//     no shutdown hook can lose a note.
//   - Without a path the store is memory-only and says so.
//   - A malformed file is fatal at load: silently starting empty would
//     drop the cases an operator believes are recorded.
//   - Every mutation appends a timeline entry (creation, status and
//     severity changes, alerts added, notes), so the case carries its
//     own audit trail.
//   - Free text is length-capped and the store is bounded, so one
//     hostile request cannot fatten the file.
package incident

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

// Status is the case state. Any transition is allowed (a contained
// case can be reopened); closing stamps ClosedAt, reopening clears it.
type Status string

const (
	StatusOpen          Status = "open"
	StatusInvestigating Status = "investigating"
	StatusContained     Status = "contained"
	StatusClosed        Status = "closed"
)

// Limits on the store and on every client-supplied field.
const (
	MaxIncidents     = 2000
	MaxAlerts        = 1000
	MaxHosts         = 200
	MaxTimeline      = 1000
	MaxTitleLen      = 200
	MaxSummaryLen    = 4000
	MaxNoteLen       = 4000
	MaxByLen         = 200
	MaxHostLen       = 253
	maxAlertsPerCall = 500
)

var (
	// ErrNotFound marks an unknown incident id (the API answers 404).
	ErrNotFound = errors.New("incident: not found")
	// ErrPersistFailed marks mutations applied in memory whose file
	// write failed (the API answers 500); classified with errors.Is.
	ErrPersistFailed = errors.New("incident: persisted state NOT saved")
	// ErrFull marks a store at MaxIncidents (the API answers 409).
	ErrFull = errors.New("incident: store is full, close and archive cases first")
)

var (
	idPattern      = regexp.MustCompile(`^[0-9a-f]{16}$`)
	alertIDPattern = regexp.MustCompile(`^[0-9a-f]{16}$`)
)

// ValidID reports whether s has the incident id shape (16 hex).
func ValidID(s string) bool { return idPattern.MatchString(s) }

// ValidStatus reports whether s is a documented case state.
func ValidStatus(s Status) bool {
	switch s {
	case StatusOpen, StatusInvestigating, StatusContained, StatusClosed:
		return true
	}
	return false
}

var severityRank = map[string]int{"info": 0, "low": 1, "medium": 2, "high": 3, "critical": 4}

// ValidSeverity reports whether s is an alert severity.
func ValidSeverity(s string) bool {
	_, ok := severityRank[s]
	return ok
}

// Entry is one timeline line. Kind is created, status, severity,
// owner, alerts or note; Text is human readable.
type Entry struct {
	At   string `json:"at"`
	By   string `json:"by,omitempty"`
	Kind string `json:"kind"`
	Text string `json:"text"`
}

// Incident is one case as served by the API.
type Incident struct {
	ID        string   `json:"id"`
	Title     string   `json:"title"`
	Summary   string   `json:"summary,omitempty"`
	Severity  string   `json:"severity"`
	Status    Status   `json:"status"`
	Owner     string   `json:"owner,omitempty"`
	Hosts     []string `json:"hosts"`
	AlertIDs  []string `json:"alert_ids"`
	Timeline  []Entry  `json:"timeline"`
	CreatedAt string   `json:"created_at"`
	UpdatedAt string   `json:"updated_at"`
	ClosedAt  string   `json:"closed_at,omitempty"`
}

// Create is the POST /api/incidents body.
type Create struct {
	Title    string   `json:"title"`
	Summary  string   `json:"summary"`
	Severity string   `json:"severity"`
	Owner    string   `json:"owner"`
	By       string   `json:"by"`
	AlertIDs []string `json:"alert_ids"`
	Hosts    []string `json:"hosts"`
}

// Patch is the PATCH /api/incidents/{id} body; nil fields are left as
// they are.
type Patch struct {
	Title    *string `json:"title"`
	Summary  *string `json:"summary"`
	Severity *string `json:"severity"`
	Status   *Status `json:"status"`
	Owner    *string `json:"owner"`
	By       string  `json:"by"`
}

type fileFormat struct {
	Version   int        `json:"version"`
	Incidents []Incident `json:"incidents"`
}

// Store holds the incidents. Safe for concurrent use.
type Store struct {
	mu    sync.Mutex
	path  string
	items map[string]*Incident
	now   func() time.Time
}

// New loads the store from path ("" = memory only; a missing file is a
// first run).
func New(path string) (*Store, error) {
	s := &Store{path: path, items: map[string]*Incident{}, now: time.Now}
	if path == "" {
		return s, nil
	}
	data, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return s, nil
		}
		return nil, fmt.Errorf("incident: read %s: %w", path, err)
	}
	var f fileFormat
	if err := json.Unmarshal(data, &f); err != nil {
		return nil, fmt.Errorf("incident: malformed JSON in %s: %w", path, err)
	}
	if f.Version != 1 {
		return nil, fmt.Errorf("incident: %s: unsupported format version %d (want 1)", path, f.Version)
	}
	for i := range f.Incidents {
		inc := f.Incidents[i]
		if !ValidID(inc.ID) || !ValidStatus(inc.Status) || !ValidSeverity(inc.Severity) || inc.Title == "" {
			return nil, fmt.Errorf("incident: %s: invalid incident %q", path, inc.ID)
		}
		if _, dup := s.items[inc.ID]; dup {
			continue
		}
		if inc.Hosts == nil {
			inc.Hosts = []string{}
		}
		if inc.AlertIDs == nil {
			inc.AlertIDs = []string{}
		}
		s.items[inc.ID] = &inc
	}
	return s, nil
}

// Persistent reports whether the store writes to a file.
func (s *Store) Persistent() bool { return s.path != "" }

// Counts returns open (not closed) and total incidents.
func (s *Store) Counts() (open, total int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, inc := range s.items {
		if inc.Status != StatusClosed {
			open++
		}
	}
	return open, len(s.items)
}

// List returns every incident, most recently updated first.
func (s *Store) List() []Incident {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]Incident, 0, len(s.items))
	for _, inc := range s.items {
		out = append(out, clone(inc))
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].UpdatedAt != out[j].UpdatedAt {
			return out[i].UpdatedAt > out[j].UpdatedAt
		}
		return out[i].ID < out[j].ID
	})
	return out
}

// Get returns one incident.
func (s *Store) Get(id string) (Incident, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	inc, ok := s.items[id]
	if !ok {
		return Incident{}, ErrNotFound
	}
	return clone(inc), nil
}

// Create validates and records a new incident.
func (s *Store) Create(c Create) (Incident, error) {
	c.Title = strings.TrimSpace(c.Title)
	if c.Severity == "" {
		c.Severity = "medium"
	}
	if err := checkLen(c.Title, MaxTitleLen, "title"); err != nil {
		return Incident{}, err
	}
	if err := checkLen(c.Summary, MaxSummaryLen, "summary"); err != nil {
		return Incident{}, err
	}
	if err := checkLen(c.Owner, MaxByLen, "owner"); err != nil {
		return Incident{}, err
	}
	if err := checkLen(c.By, MaxByLen, "by"); err != nil {
		return Incident{}, err
	}
	if c.Title == "" {
		return Incident{}, errors.New("incident: title is required")
	}
	if !ValidSeverity(c.Severity) {
		return Incident{}, fmt.Errorf("incident: invalid severity %q (critical, high, medium, low, info)", c.Severity)
	}
	alerts, err := cleanAlertIDs(c.AlertIDs)
	if err != nil {
		return Incident{}, err
	}
	hosts, err := cleanHosts(c.Hosts)
	if err != nil {
		return Incident{}, err
	}
	id, err := newID()
	if err != nil {
		return Incident{}, err
	}
	at := s.stamp()
	inc := &Incident{
		ID: id, Title: c.Title, Summary: c.Summary, Severity: c.Severity, Status: StatusOpen, Owner: c.Owner,
		Hosts: hosts, AlertIDs: alerts, CreatedAt: at, UpdatedAt: at,
		Timeline: []Entry{{At: at, By: c.By, Kind: "created", Text: fmt.Sprintf("Incidente abierto con %d alertas", len(alerts))}},
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.items) >= MaxIncidents {
		return Incident{}, ErrFull
	}
	s.items[id] = inc
	return s.commitLocked(inc)
}

// Update applies a patch and records each change in the timeline.
func (s *Store) Update(id string, p Patch) (Incident, error) {
	if err := checkLen(p.By, MaxByLen, "by"); err != nil {
		return Incident{}, err
	}
	if p.Title != nil {
		if err := checkLen(*p.Title, MaxTitleLen, "title"); err != nil {
			return Incident{}, err
		}
		if strings.TrimSpace(*p.Title) == "" {
			return Incident{}, errors.New("incident: title cannot be empty")
		}
	}
	if p.Summary != nil {
		if err := checkLen(*p.Summary, MaxSummaryLen, "summary"); err != nil {
			return Incident{}, err
		}
	}
	if p.Owner != nil {
		if err := checkLen(*p.Owner, MaxByLen, "owner"); err != nil {
			return Incident{}, err
		}
	}
	if p.Severity != nil && !ValidSeverity(*p.Severity) {
		return Incident{}, fmt.Errorf("incident: invalid severity %q", *p.Severity)
	}
	if p.Status != nil && !ValidStatus(*p.Status) {
		return Incident{}, fmt.Errorf("incident: invalid status %q (open, investigating, contained, closed)", *p.Status)
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	inc, ok := s.items[id]
	if !ok {
		return Incident{}, ErrNotFound
	}
	at := s.stamp()
	add := func(kind, text string) {
		inc.Timeline = append(inc.Timeline, Entry{At: at, By: p.By, Kind: kind, Text: text})
	}
	if p.Title != nil && strings.TrimSpace(*p.Title) != inc.Title {
		inc.Title = strings.TrimSpace(*p.Title)
		add("note", "Titulo cambiado a «"+inc.Title+"»")
	}
	if p.Summary != nil {
		inc.Summary = *p.Summary
	}
	if p.Severity != nil && *p.Severity != inc.Severity {
		add("severity", fmt.Sprintf("Severidad %s -> %s", inc.Severity, *p.Severity))
		inc.Severity = *p.Severity
	}
	if p.Owner != nil && *p.Owner != inc.Owner {
		owner := *p.Owner
		if owner == "" {
			add("owner", "Responsable retirado")
		} else {
			add("owner", "Responsable: "+owner)
		}
		inc.Owner = owner
	}
	if p.Status != nil && *p.Status != inc.Status {
		add("status", fmt.Sprintf("Estado %s -> %s", inc.Status, *p.Status))
		inc.Status = *p.Status
		if inc.Status == StatusClosed {
			inc.ClosedAt = at
		} else {
			inc.ClosedAt = ""
		}
	}
	inc.UpdatedAt = at
	return s.commitLocked(inc)
}

// AddAlerts links alerts (and their hosts) to an incident. Ids already
// present are skipped; the severity rises to the given one when higher.
func (s *Store) AddAlerts(id string, alertIDs, hosts []string, severity, by string) (Incident, error) {
	if len(alertIDs) > maxAlertsPerCall {
		return Incident{}, fmt.Errorf("incident: at most %d alerts per request", maxAlertsPerCall)
	}
	alerts, err := cleanAlertIDs(alertIDs)
	if err != nil {
		return Incident{}, err
	}
	cleanH, err := cleanHosts(hosts)
	if err != nil {
		return Incident{}, err
	}
	if err := checkLen(by, MaxByLen, "by"); err != nil {
		return Incident{}, err
	}
	if severity != "" && !ValidSeverity(severity) {
		return Incident{}, fmt.Errorf("incident: invalid severity %q", severity)
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	inc, ok := s.items[id]
	if !ok {
		return Incident{}, ErrNotFound
	}
	added := 0
	for _, a := range alerts {
		if !contains(inc.AlertIDs, a) {
			if len(inc.AlertIDs) >= MaxAlerts {
				return Incident{}, fmt.Errorf("incident: an incident holds at most %d alerts", MaxAlerts)
			}
			inc.AlertIDs = append(inc.AlertIDs, a)
			added++
		}
	}
	for _, h := range cleanH {
		if !contains(inc.Hosts, h) && len(inc.Hosts) < MaxHosts {
			inc.Hosts = append(inc.Hosts, h)
		}
	}
	at := s.stamp()
	if added > 0 {
		inc.Timeline = append(inc.Timeline, Entry{At: at, By: by, Kind: "alerts", Text: fmt.Sprintf("%d alertas añadidas", added)})
	}
	if severity != "" && severityRank[severity] > severityRank[inc.Severity] {
		inc.Timeline = append(inc.Timeline, Entry{At: at, By: by, Kind: "severity", Text: fmt.Sprintf("Severidad %s -> %s por las alertas añadidas", inc.Severity, severity)})
		inc.Severity = severity
	}
	inc.UpdatedAt = at
	return s.commitLocked(inc)
}

// AddNote appends an analyst note to the timeline.
func (s *Store) AddNote(id, text, by string) (Incident, error) {
	text = strings.TrimSpace(text)
	if text == "" {
		return Incident{}, errors.New("incident: note text is required")
	}
	if len(text) > MaxNoteLen {
		return Incident{}, fmt.Errorf("incident: note longer than %d characters", MaxNoteLen)
	}
	if err := checkLen(by, MaxByLen, "by"); err != nil {
		return Incident{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	inc, ok := s.items[id]
	if !ok {
		return Incident{}, ErrNotFound
	}
	at := s.stamp()
	inc.Timeline = append(inc.Timeline, Entry{At: at, By: by, Kind: "note", Text: text})
	inc.UpdatedAt = at
	return s.commitLocked(inc)
}

// commitLocked trims the timeline, persists and returns a copy. The
// in-memory change stands even when the write fails (like lifecycle):
// the caller reports ErrPersistFailed so the operator knows it will not
// survive a restart.
func (s *Store) commitLocked(inc *Incident) (Incident, error) {
	if over := len(inc.Timeline) - MaxTimeline; over > 0 {
		inc.Timeline = append([]Entry(nil), inc.Timeline[over:]...)
	}
	out := clone(inc)
	if err := s.persistLocked(); err != nil {
		return out, fmt.Errorf("%w: %w", ErrPersistFailed, err)
	}
	return out, nil
}

func (s *Store) stamp() string { return s.now().UTC().Format(time.RFC3339Nano) }

func (s *Store) persistLocked() error {
	if s.path == "" {
		return nil
	}
	f := fileFormat{Version: 1, Incidents: make([]Incident, 0, len(s.items))}
	for _, inc := range s.items {
		f.Incidents = append(f.Incidents, *inc)
	}
	sort.Slice(f.Incidents, func(i, j int) bool { return f.Incidents[i].CreatedAt < f.Incidents[j].CreatedAt })
	data, err := json.MarshalIndent(&f, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(s.path), filepath.Base(s.path)+".tmp-*")
	if err != nil {
		return err
	}
	name := tmp.Name()
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		os.Remove(name)
		return err
	}
	if err := tmp.Close(); err != nil {
		os.Remove(name)
		return err
	}
	if err := os.Chmod(name, 0o600); err != nil {
		os.Remove(name)
		return err
	}
	return os.Rename(name, s.path)
}

func clone(inc *Incident) Incident {
	out := *inc
	out.Hosts = append([]string{}, inc.Hosts...)
	out.AlertIDs = append([]string{}, inc.AlertIDs...)
	out.Timeline = append([]Entry{}, inc.Timeline...)
	return out
}

func checkLen(v string, max int, field string) error {
	if len(v) > max {
		return fmt.Errorf("incident: %s longer than %d characters", field, max)
	}
	return nil
}

func cleanAlertIDs(ids []string) ([]string, error) {
	out := []string{}
	for _, id := range ids {
		if !alertIDPattern.MatchString(id) {
			return nil, fmt.Errorf("incident: malformed alert id %q (16 lowercase hex)", id)
		}
		if !contains(out, id) {
			out = append(out, id)
		}
	}
	if len(out) > MaxAlerts {
		return nil, fmt.Errorf("incident: an incident holds at most %d alerts", MaxAlerts)
	}
	return out, nil
}

func cleanHosts(hosts []string) ([]string, error) {
	out := []string{}
	for _, h := range hosts {
		h = strings.TrimSpace(h)
		if h == "" {
			continue
		}
		if len(h) > MaxHostLen || strings.ContainsAny(h, "\r\n\t") {
			return nil, fmt.Errorf("incident: invalid host %q", h)
		}
		if !contains(out, h) && len(out) < MaxHosts {
			out = append(out, h)
		}
	}
	return out, nil
}

func contains(list []string, v string) bool {
	for _, x := range list {
		if strings.EqualFold(x, v) {
			return true
		}
	}
	return false
}

func newID() (string, error) {
	var b [8]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", fmt.Errorf("incident: id: %w", err)
	}
	return hex.EncodeToString(b[:]), nil
}
