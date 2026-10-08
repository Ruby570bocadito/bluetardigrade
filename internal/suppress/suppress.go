// Package suppress implements the operator allowlist: YAML entries that
// silence one rule (optionally on one host) until an optional expiration
// instant, optionally narrowed to events whose fields match a set of
// conditions (§2.3 supresiones con condiciones — the same operators the
// rule engine evaluates, so "suppress this exactly" is expressible
// without silencing the whole rule). It exists for the maintenance
// scenarios where an alert is correct but unwanted: a sanctioned change
// window (the rule fires while an admin legitimately does the work), a
// host with a permanent, accepted exception, and one noisy invocation
// shape of an otherwise useful rule. Entries live in a single
// suppressions.yaml file hot-reloaded on the same ticker as rules and
// sequences, so editing the file is enough to re-arm the engine — no
// restart. When the engine runs with -api-write, the API write surface
// (internal/api) edits the SAME file through SaveFile and reloads it
// immediately, so hand edits and API edits share one source of truth.
package suppress

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/rules"
	"github.com/Ruby570bocadito/bluetardigrade/internal/yamlcheck"
	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"

	"gopkg.in/yaml.v3"
)

// Cond is one suppression condition: a field/operator/value predicate
// over the triggering event, evaluated with the SAME operator set and
// semantics the rule engine uses (the conditions compile into a
// rules.Matcher — one source of truth for what an operator means).
// Operators are the rule engine's closed set (eq, neq, contains,
// contains_any, startswith, endswith, regex, in, not_in, gt, lt and
// the case-insensitive i* variants); an unknown operator fails the
// load LOUDLY, exactly like a rule with one.
type Cond struct {
	Field    string `yaml:"field" json:"field"`
	Operator string `yaml:"operator" json:"operator"`
	Value    any    `yaml:"value,omitempty" json:"value,omitempty"`
}

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
//   - when (optional): event-field conditions AND-ed together. The entry
//     only silences a hit whose event satisfies EVERY condition. Entries
//     with conditions are evaluated where the triggering event exists
//     (the rule path, intel and baseline novelty alerts); aggregated
//     alerts (kill-chains, beaconing, volumetric) carry no single event,
//     so a conditional entry never silences one — the failure direction
//     is an alert the operator still sees, never a lost signal.
//   - reason is documentation for the next operator who reads the file.
type Entry struct {
	RuleID  string `yaml:"rule_id,omitempty" json:"rule_id"`
	Host    string `yaml:"host,omitempty" json:"host,omitempty"`
	When    []Cond `yaml:"when,omitempty" json:"when,omitempty"`
	Reason  string `yaml:"reason,omitempty" json:"reason,omitempty"`
	Expires string `yaml:"expires,omitempty" json:"expires,omitempty"`
}

// NormalizeEntry applies the canonical form the YAML loader enforces:
// surrounding whitespace trimmed everywhere (condition fields and
// operators too — values are data and pass through untouched), host
// lowercased (Windows reports hostnames in arbitrary case). Every
// write path funnels through it so the file never stores a variant
// spelling of an entry.
func NormalizeEntry(e Entry) Entry {
	var when []Cond
	if len(e.When) > 0 {
		when = make([]Cond, 0, len(e.When))
		for _, c := range e.When {
			when = append(when, Cond{Field: strings.TrimSpace(c.Field), Operator: strings.TrimSpace(c.Operator), Value: c.Value})
		}
	}
	return Entry{
		RuleID:  strings.TrimSpace(e.RuleID),
		Host:    strings.ToLower(strings.TrimSpace(e.Host)),
		When:    when,
		Reason:  strings.TrimSpace(e.Reason),
		Expires: strings.TrimSpace(e.Expires),
	}
}

// Field length caps shared by every write path (API and YAML loader).
// They bound one hostile or careless request: a rule id is an engine
// identifier (8 hex display, 36-char UUID at the most), 253 is the
// DNS hostname limit, and a reason is documentation for the next
// operator, not a paste target. Without them an authenticated writer
// could fatten the control file (and every reload that parses it)
// with a single request. Generous enough that no legitimate operator
// file is rejected; the loader fails loudly if one ever is.
const (
	MaxRuleIDLen  = 128
	MaxHostLen    = 253
	MaxReasonLen  = 2000
	MaxExpiresLen = 40 // RFC 3339 with nanoseconds and offset fits in ~35

	// §2.3 condition caps. An entry is a handful of predicates over the
	// triggering event, not a second rule engine: 8 AND-ed conditions
	// are more than any "suppress this exactly" needs (the console's
	// button fills one or two), and the field/value caps bound what one
	// authenticated write can fatten the file with. Values are data:
	// a command line legitimately runs long, so 2000 matches the
	// reason cap instead of the id caps.
	MaxConditions   = 8
	MaxFieldLen     = 128
	MaxValueLen     = 2000
	MaxValueListLen = 16
)

// MaxEntries bounds the set the WRITE API may persist (SaveFile
// callers). Silencing is a human-paced operation on a ruleset of
// dozens; a cap keeps a hostile or buggy client from growing the file
// one entry per request until the disk fills. Operator hand-edits of
// the file are NOT capped (the operator already holds the pen).
const MaxEntries = 1000

// ValidateEntry applies the same acceptance rules the YAML loader
// enforces, with path-free messages so API clients get actionable 400s:
// rule_id and host must not both be empty (the entry would match
// nothing), every field stays within its cap, expires, when set,
// must be RFC 3339, and every when condition must carry a field, a
// SUPPORTED operator (the same closed set the rule engine evaluates —
// an unknown one would silence nothing while looking armed) and a
// value within the caps. Callers that write the file (SaveFile, the
// API) must validate FIRST: a set the engine would reject on the next
// hot-reload must never reach the disk.
func ValidateEntry(e Entry) error {
	if e.RuleID == "" && e.Host == "" {
		return fmt.Errorf("rule_id and host are both empty (nothing would match - fix or delete the entry)")
	}
	if len(e.RuleID) > MaxRuleIDLen {
		return fmt.Errorf("rule_id longer than %d characters", MaxRuleIDLen)
	}
	if len(e.Host) > MaxHostLen {
		return fmt.Errorf("host longer than %d characters", MaxHostLen)
	}
	if len(e.Reason) > MaxReasonLen {
		return fmt.Errorf("reason longer than %d characters", MaxReasonLen)
	}
	if len(e.Expires) > MaxExpiresLen {
		return fmt.Errorf("expires longer than %d characters", MaxExpiresLen)
	}
	if len(e.When) > MaxConditions {
		return fmt.Errorf("when carries %d conditions, over the %d cap", len(e.When), MaxConditions)
	}
	for i, c := range e.When {
		if c.Field == "" {
			return fmt.Errorf("when condition #%d: field is empty", i+1)
		}
		if len(c.Field) > MaxFieldLen {
			return fmt.Errorf("when condition #%d: field longer than %d characters", i+1, MaxFieldLen)
		}
		if c.Operator == "" {
			return fmt.Errorf("when condition #%d (%s): operator is empty", i+1, c.Field)
		}
		if !rules.IsValidOperator(c.Operator) {
			return fmt.Errorf("when condition #%d (%s): operator %q no soportado", i+1, c.Field, c.Operator)
		}
		if err := validateCondValue(i, c); err != nil {
			return err
		}
	}
	if e.Expires != "" {
		if _, err := time.Parse(time.RFC3339, e.Expires); err != nil {
			return fmt.Errorf("expires %q is not RFC 3339 (e.g. 2026-10-02T00:00:00Z): %w", e.Expires, err)
		}
	}
	return nil
}

// validateCondValue bounds one condition's value: a string stays under
// MaxValueLen, a list under MaxValueListLen items of MaxValueLen each.
// Any other JSON/YAML shape (numbers, booleans) passes through — the
// operators that consume them compare, never copy, and their length is
// bounded by the 8 KiB write-body cap.
func validateCondValue(i int, c Cond) error {
	switch v := c.Value.(type) {
	case string:
		if len(v) > MaxValueLen {
			return fmt.Errorf("when condition #%d (%s): value longer than %d characters", i+1, c.Field, MaxValueLen)
		}
	case []any:
		if len(v) > MaxValueListLen {
			return fmt.Errorf("when condition #%d (%s): value list has %d items, over the %d cap", i+1, c.Field, len(v), MaxValueListLen)
		}
		for j, item := range v {
			if s, ok := item.(string); ok && len(s) > MaxValueLen {
				return fmt.Errorf("when condition #%d (%s): list item #%d longer than %d characters", i+1, c.Field, j+1, MaxValueLen)
			}
		}
	}
	return nil
}

// Parsed is an entry with its expiration resolved, its conditions
// compiled and everything precomputed for the hot path (Active runs
// once per rule hit, MatchesEvent only when a conditional entry is
// the candidate).
type Parsed struct {
	RuleID   string
	Host     string // lowercased for comparison; "" matches any host
	When     []Cond // normalized conditions, for the API snapshot
	Reason   string
	Expires  time.Time      // zero = no expiration
	Line     int            // 1-based YAML document index, for error messages
	matcher  *rules.Matcher // nil when the entry has no conditions
	rawUntil string         // original Expires string, for the API snapshot
}

// Expired reports whether the entry's expiration instant has passed.
func (p Parsed) Expired(now time.Time) bool {
	return !p.Expires.IsZero() && now.After(p.Expires)
}

// Conditional reports whether the entry narrows its silence to events
// satisfying its conditions (a nil matcher means unconditional).
func (p Parsed) Conditional() bool { return p.matcher != nil }

// MatchesEvent evaluates the entry's conditions against the triggering
// event. An UNCONDITIONAL entry matches everything (true); a
// CONDITIONAL entry needs every condition to hold, and a nil event can
// never satisfy one — the caller passes nil where no single event
// exists (aggregated alerts) and the entry correctly stays inert there.
func (p Parsed) MatchesEvent(ev *model.Event) bool {
	if p.matcher == nil {
		return true
	}
	if ev == nil {
		return false
	}
	return p.matcher.Match(ev)
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
// and if so returns the entry that matched (for engine logs). When the
// matched entry is CONDITIONAL the caller decides with
// MatchesEvent: pass the triggering event where one exists, nil for
// aggregated alerts (a conditional entry then reports as not
// suppressed — the failure direction is an alert the operator still
// sees).
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
// (GET /api/suppressions), oldest first, with their conditions so the
// console can show what exactly is being silenced.
func (m *Manager) Snapshot(now time.Time) []Entry {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make([]Entry, 0, len(m.entries))
	for _, e := range m.entries {
		if e.Expired(now) {
			continue
		}
		out = append(out, Entry{RuleID: e.RuleID, Host: e.Host, When: e.When, Reason: e.Reason, Expires: e.rawUntil})
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
		out = append(out, Entry{RuleID: e.RuleID, Host: e.Host, When: e.When, Reason: e.Reason, Expires: e.rawUntil})
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
	// size-cap BEFORE reading (audit 5.16): hot-reload re-parses this
	// file every 15 s; refuse grown files before allocating for them.
	data, err := yamlcheck.ReadFileCapped(path, yamlcheck.MaxReadBytes)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil // no file: suppression disabled, not an error
		}
		return nil, fmt.Errorf("suppress: read %s: %w", path, err)
	}
	if err := yamlcheck.Guard(path, data); err != nil {
		return nil, err
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
			When:     e.When,
			Reason:   e.Reason,
			Line:     i + 1,
			rawUntil: e.Expires,
		}
		if len(e.When) > 0 {
			// Compile with the rule engine's own Matcher: the operators
			// mean EXACTLY what they mean in a rule, regexes compile
			// once here, and a bad one fails the load loudly.
			conds := make([]rules.Condition, 0, len(e.When))
			for _, c := range e.When {
				conds = append(conds, rules.Condition{Field: c.Field, Operator: c.Operator, Value: c.Value})
			}
			mtr, err := rules.NewMatcher(conds)
			if err != nil {
				return nil, fmt.Errorf("suppress: %s entry #%d: %w", path, i+1, err)
			}
			p.matcher = mtr
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
