// Package correlate assembles individual rule hits into multi-stage
// kill-chain alerts. A sequence (YAML in sequences/) names the rules
// that together describe one campaign; when every step has been seen
// on the same host inside the window, a single high-signal alert is
// emitted through the alert.Manager pipeline. Steps are unordered and
// the manager survives rule hot-reloads without losing progress.
//
// Window semantics: each step remembers the event time of its most
// recent hit, and a chain completes when every step is present AND the
// spread between the oldest and the newest of those times fits in the
// window. Measuring the spread over real event times (instead of
// "since the first match") means a stale early hit cannot anchor the
// window and swallow the real attack that follows it, and an event
// that arrives out of order (offline import, skewed clock) cannot
// stitch steps days apart into one chain.
package correlate

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode"

	"github.com/Ruby570bocadito/bluetardigrade/internal/alert"
	"github.com/Ruby570bocadito/bluetardigrade/internal/rules"
	"github.com/Ruby570bocadito/bluetardigrade/internal/yamlcheck"
	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"

	"gopkg.in/yaml.v3"
)

// Step references one contributing rule by its exact name.
type Step struct {
	Rule string `yaml:"rule"`
}

// Sequence is the YAML definition of one kill chain.
type Sequence struct {
	Name        string   `yaml:"name"`
	ID          string   `yaml:"id"`
	Description string   `yaml:"description"`
	Severity    string   `yaml:"severity"`
	Window      string   `yaml:"window"`
	Tags        []string `yaml:"tags"`
	Steps       []Step   `yaml:"steps"`
}

type compiled struct {
	seq    Sequence
	window time.Duration
}

type state struct {
	// at maps a matched step index to the event time of its most
	// recent hit. Only times are kept (never the event itself): a
	// state lives until its chain completes or is reclaimed, and
	// ingest lines can carry up to 1 MiB, so a hostile feed must not
	// be able to park one full event per tracked state.
	at map[int]time.Time
	// expires is the WALL-clock instant after which the state is dead
	// weight (last update + window). It only drives reclamation of the
	// tracking cap; completion is decided on event times.
	expires time.Time
}

// span returns the spread between the oldest and newest step times.
func (st *state) span() time.Duration {
	var lo, hi time.Time
	for _, t := range st.at {
		if lo.IsZero() || t.Before(lo) {
			lo = t
		}
		if hi.IsZero() || t.After(hi) {
			hi = t
		}
	}
	return hi.Sub(lo)
}

// reclaimEvery rate-limits the full-map sweep that runs when a new
// chain finds the tracking cap full: a cap full of LIVE states must
// not turn every rule hit into an O(maxTrackedStates) scan.
const reclaimEvery = time.Second

// Manager tracks per-host progress of every sequence.
type Manager struct {
	mu          sync.Mutex
	seqs        []*compiled
	state       map[stateKey]*state
	emit        func(alert.Alert)
	now         func() time.Time // wall clock; nil = time.Now (tests inject)
	lastReclaim time.Time
}

func (m *Manager) clock() time.Time {
	if m.now != nil {
		return m.now()
	}
	return time.Now()
}

// stateKey identifies one in-flight chain. A struct, not the old
// "seqID|host" string concatenation: a feed-controlled host containing
// '|' could alias two (sequence, host) pairs onto the same entry and
// merge progress across sequences. Hosts are lowercased for the same
// reason suppress.Manager lowercases them — Windows reports hostnames
// in arbitrary case, and one machine must own one chain regardless of
// which case the sensor emitted today.
type stateKey struct {
	seqID string
	host  string // lowercased
}

// maxTrackedStates bounds the per-(sequence, host) progress map. A
// hostile or misconfigured feed can invent hostnames at will, and each
// new host would otherwise pin a state entry forever (kill chains that
// never complete would otherwise never be deleted): past the cap,
// states whose window elapsed on the wall clock are reclaimed first,
// and only if the map is still full do NEW hosts stop being tracked.
// Sweep runs the same reclamation periodically from the engine.
// Reload prunes states of sequences that no longer exist, so config
// churn (renames, removals) cannot silently exhaust the cap with
// entries that can never complete. Exported as MaxTrackedStates so
// /api/stats can report it: an operator watching correlator_states
// approach the cap knows correlation is about to stop covering new
// hosts (the silent-detection-loss failure mode).
const maxTrackedStates = 8192

// MaxTrackedStates is the hard cap of in-flight (sequence, host)
// chains the correlator will track (see maxTrackedStates).
const MaxTrackedStates = maxTrackedStates

// Load-time hardening: sequences/ is configuration, but configuration
// is an attack surface too — a hostile or hand-edited file must fail
// LOUDLY at load instead of degrading a running engine. Each bound
// names the failure mode it prevents; the exported mirrors let tests
// and operator tooling pin them the way MaxTrackedStates does.
const (
	// maxFileBytes caps one sequence file. os.ReadFile has no bound of
	// its own: a multi-gigabyte file would be read whole into memory
	// before any other check could run. The flow-nesting cap moved to
	// internal/yamlcheck together with the alias-bomb guard.
	maxFileBytes = 4 << 20 // 4 MiB

	// maxSequences caps the loaded set: Observe walks EVERY sequence on
	// each rule hit, so the per-hit cost is bounded by construction at
	// maxSequences × maxStepsPerSequence comparisons.
	maxSequences = 512

	// maxStepsPerSequence caps one chain's step list (same per-hit cost
	// as maxSequences).
	maxStepsPerSequence = 64

	// maxWindow caps the completion window. A chain whose window never
	// expires pins one tracked state per host until the window passes:
	// enough hosts and maxTrackedStates is exhausted, silently stopping
	// correlation for new hosts. Seven days is far beyond any campaign
	// the v0.1 sequences are designed for and still small enough that
	// stuck states recover on their own.
	maxWindow = 7 * 24 * time.Hour

	// maxIDRunes is the identity cap for sequence id/name and for step
	// rule names — the same standard the ingest applies to feed
	// identities (host 255, user 256, id 128 runes). These strings
	// reach logs, the console and webhook consumers through every
	// emitted alert.
	maxIDRunes = 128

	// maxDescriptionRunes keeps one description from pinning kilobytes
	// per sequence for the life of the process. Descriptions never
	// leave the process (alerts do not carry them), so only length is
	// bounded here — control runes are allowed.
	maxDescriptionRunes = 512

	// maxTags / maxTagRunes bound the tag list copied into every
	// emitted alert (tags DO leave the process, so each one is also
	// control-rune checked in compile).
	maxTags     = 16
	maxTagRunes = 64
)

// Exported mirrors of the load-time caps (precedent: MaxTrackedStates).
const (
	MaxSequences        = maxSequences
	MaxStepsPerSequence = maxStepsPerSequence
	MaxWindow           = maxWindow
	MaxFileBytes        = maxFileBytes
)

// LoadDir compiles every sequence file under dir. emit is called once
// per completed sequence (wire it to alert.Manager.Emit).
func LoadDir(dir string, emit func(alert.Alert)) (*Manager, error) {
	m := &Manager{state: map[stateKey]*state{}, emit: emit}
	if err := m.load(dir); err != nil {
		return nil, err
	}
	return m, nil
}

// Reload atomically swaps the sequence set, preserving in-flight
// progress (rules hot-reload every 15s and sequences must be able to
// span several of those cycles).
func (m *Manager) Reload(dir string) error {
	fresh := &Manager{state: m.state, emit: m.emit}
	if err := fresh.load(dir); err != nil {
		return err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	// Prune progress of sequences that no longer exist on disk: their
	// states can never complete, yet each counted against
	// maxTrackedStates forever — enough removals/renames would exhaust
	// the cap and silently stop correlation for NEW hosts (detection
	// loss, not just memory). Only reached on a successful load: a
	// failed reload keeps the previous sequence set AND its progress.
	alive := make(map[string]bool, len(fresh.seqs))
	for _, c := range fresh.seqs {
		alive[c.seq.ID] = true
	}
	for k := range m.state {
		if !alive[k.seqID] {
			delete(m.state, k)
		}
	}
	m.seqs = fresh.seqs
	return nil
}

// Count returns the number of loaded sequences.
func (m *Manager) Count() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.seqs)
}

// States returns how many (sequence, host) chains are in flight right
// now. Exposed through /api/stats so the MaxTrackedStates cap is
// observable from outside the process: at the cap, NEW hosts silently
// stop being tracked and the only symptom is correlation that never
// fires for them.
func (m *Manager) States() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.state)
}

// SequenceInfo is the read-only view of one loaded sequence served by
// GET /api/sequences. WindowSeconds is the effective window (the
// configured one, or the 5-minute default compile applies).
type SequenceInfo struct {
	ID            string
	Name          string
	Description   string
	Severity      string
	WindowSeconds int
	Tags          []string
	Steps         []string // rule names, in declared order (order is display-only; matching is unordered)
}

// Snapshot returns the currently loaded sequences, sorted by ID,
// hot-reload aware. The copies are shallow but detached from the
// manager state: callers may hold them past a Reload safely.
func (m *Manager) Snapshot() []SequenceInfo {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]SequenceInfo, 0, len(m.seqs))
	for _, c := range m.seqs {
		steps := make([]string, 0, len(c.seq.Steps))
		for _, s := range c.seq.Steps {
			steps = append(steps, s.Rule)
		}
		out = append(out, SequenceInfo{
			ID:            c.seq.ID,
			Name:          c.seq.Name,
			Description:   c.seq.Description,
			Severity:      c.seq.Severity,
			WindowSeconds: int(c.window / time.Second),
			Tags:          append([]string(nil), c.seq.Tags...),
			Steps:         steps,
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

// SetEmit wires (or rewires) the completion callback, so main can
// validate the sequences directory before the alert manager exists.
func (m *Manager) SetEmit(emit func(alert.Alert)) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.emit = emit
}

// Names returns the loaded sequence names, sorted, for logging.
func (m *Manager) Names() []string {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]string, 0, len(m.seqs))
	for _, c := range m.seqs {
		out = append(out, c.seq.Name)
	}
	return out
}

// StepsWithoutRule returns the sorted unique rule names referenced by
// the loaded sequences that are absent from known (built from the
// rules engine's snapshot). A step naming a rule that never fires
// makes its chain impossible to complete: on a host where the OTHER
// steps matched, the half-built state sits pinned until the window
// expires — and re-arms on the next hit — quietly contributing to
// maxTrackedStates exhaustion (silent detection loss). The engine
// logs the result as a WARNING on startup and on every reload so the
// config bug is named instead of absorbed. Rules present but disabled
// are NOT reported: disabling a rule is an operator decision, and a
// chain waiting on it resumes the moment it is re-enabled.
func (m *Manager) StepsWithoutRule(known map[string]bool) []string {
	m.mu.Lock()
	defer m.mu.Unlock()
	seen := map[string]bool{}
	missing := []string{}
	for _, c := range m.seqs {
		for _, st := range c.seq.Steps {
			if st.Rule == "" || known[st.Rule] || seen[st.Rule] {
				continue
			}
			seen[st.Rule] = true
			missing = append(missing, st.Rule)
		}
	}
	sort.Strings(missing)
	return missing
}

// Observe feeds one rule hit into every sequence that references it.
// Completing a sequence emits one alert and re-arms the chain.
func (m *Manager) Observe(ev *model.Event, ruleName string) {
	if ev == nil || ruleName == "" {
		return
	}
	m.mu.Lock()
	wall := m.clock()
	ts := ev.Timestamp
	if ts.IsZero() {
		ts = wall
	}
	emit := m.emit
	var completed []alert.Alert
	for _, c := range m.seqs {
		if !c.references(ruleName) {
			continue
		}
		key := stateKey{seqID: c.seq.ID, host: strings.ToLower(ev.Host)}
		st := m.state[key]
		if st == nil {
			if len(m.state) >= maxTrackedStates && !m.reclaimLocked(wall, false) {
				continue
			}
			st = &state{at: map[int]time.Time{}}
		}
		// Pick the step this hit advances: an unmatched step naming
		// the rule wins; otherwise the matched one holding the OLDEST
		// time is refreshed, but only by a newer hit (a late, older
		// event never pushes recorded progress back in time).
		stepIdx := -1
		for i, s := range c.seq.Steps {
			if s.Rule != ruleName {
				continue
			}
			prev, seen := st.at[i]
			if !seen {
				stepIdx = i
				break
			}
			if ts.After(prev) && (stepIdx < 0 || prev.Before(st.at[stepIdx])) {
				stepIdx = i
			}
		}
		if stepIdx < 0 {
			continue
		}
		st.at[stepIdx] = ts
		st.expires = wall.Add(c.window)
		if len(st.at) == len(c.seq.Steps) {
			if span := st.span(); span <= c.window {
				completed = append(completed, m.fire(c, span, ev))
				delete(m.state, key) // re-arm
				continue
			}
		}
		m.state[key] = st
	}
	m.mu.Unlock()
	// Deliver OUTSIDE mu (the accumulated O1, acta 22h46 §1.4 — the
	// same pattern beacon had): the pipeline takes the hub lock and
	// can block on SQLite, webhook and risk, and no stats read should
	// queue behind delivery under this manager's lock. Chain state
	// transitions stay atomic under mu; only delivery moves out. One
	// Observe emits its completions in detection order and the engine
	// observes from one goroutine, so delivery order on every real
	// path is unchanged. emit was captured under mu, so SetEmit stays
	// race-free.
	for _, a := range completed {
		if emit != nil {
			emit(a)
		}
	}
}

// Sweep drops every in-flight chain whose window elapsed on the wall
// clock without progress, and reports how many it removed. The engine
// calls it on its maintenance cadence so /api/stats reports live
// chains, not chains that can no longer complete.
func (m *Manager) Sweep(now time.Time) int {
	m.mu.Lock()
	defer m.mu.Unlock()
	before := len(m.state)
	m.reclaimLocked(now, true)
	return before - len(m.state)
}

// reclaimLocked deletes expired states (rate-limited unless force) and
// reports whether the map has room for a new one. Caller holds mu.
func (m *Manager) reclaimLocked(now time.Time, force bool) bool {
	if force || now.Sub(m.lastReclaim) >= reclaimEvery {
		m.lastReclaim = now
		for k, st := range m.state {
			if now.After(st.expires) {
				delete(m.state, k)
			}
		}
	}
	return len(m.state) < maxTrackedStates
}

// references reports whether any step of the sequence names rule.
func (c *compiled) references(rule string) bool {
	for _, s := range c.seq.Steps {
		if s.Rule == rule {
			return true
		}
	}
	return false
}

// fire builds the sequence alert for a completed chain. Caller holds
// mu; the returned alert is delivered by Observe AFTER mu is released —
// the pipeline takes the hub lock and can block, and no stats read
// should queue behind that (see Observe).
func (m *Manager) fire(c *compiled, span time.Duration, ev *model.Event) alert.Alert {
	steps := make([]string, 0, len(c.seq.Steps))
	for _, s := range c.seq.Steps {
		steps = append(steps, s.Rule)
	}
	span = span.Round(time.Second)
	a := alert.Alert{
		Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
		RuleID:    c.seq.ID,
		RuleName:  c.seq.Name,
		Severity:  c.seq.Severity,
		Host:      ev.Host,
		User:      ev.User,
		EventID:   ev.ID,
		EventType: ev.Type,
		Summary: fmt.Sprintf("%s en %d pasos: %s",
			strings.Join(steps, " -> "), len(steps), span),
		MatchedOn: steps,
		Tags:      c.seq.Tags,
		Enrich:    ev.Enrichment,
	}
	return a
}

// load parses every .yaml/.yml file under dir into compiled sequences.
func (m *Manager) load(dir string) error {
	seqs := []*compiled{}
	seen := map[string]string{} // sequence id -> origin file
	err := filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			return nil
		}
		ext := strings.ToLower(filepath.Ext(path))
		if ext != ".yaml" && ext != ".yml" {
			return nil
		}
		// Bound the file BEFORE reading it: os.ReadFile has no limit of
		// its own, so an oversized sequence file would be read whole
		// into memory before any other check could run.
		if info.Size() > maxFileBytes {
			return fmt.Errorf("%s: file is %d bytes, over the %d byte cap", path, info.Size(), maxFileBytes)
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		// resource-bomb guard (alias expansion + flow nesting), shared
		// with every other YAML loader through internal/yamlcheck.
		if err := yamlcheck.Guard(path, data); err != nil {
			return err
		}
		var list []Sequence
		if err := yaml.Unmarshal(data, &list); err != nil {
			return fmt.Errorf("%s: %w", path, err)
		}
		for _, s := range list {
			c, err := compile(s)
			if err != nil {
				return fmt.Errorf("%s: sequence %q: %w", path, s.Name, err)
			}
			// Duplicate ids are always a config bug: both sequences
			// would silently share one progress entry (steps of one
			// advance the other) and every completion would fire twice.
			if prev, dup := seen[s.ID]; dup {
				return fmt.Errorf("%s: sequence %q: duplicate id %q (already loaded from %s)", path, s.Name, s.ID, prev)
			}
			seen[s.ID] = path
			if len(seqs) >= maxSequences {
				return fmt.Errorf("%s: sequence %q: %d sequences is over the load cap (%d)", path, s.Name, len(seqs)+1, maxSequences)
			}
			seqs = append(seqs, c)
		}
		return nil
	})
	if err != nil {
		return err
	}
	m.seqs = seqs
	return nil
}

func compile(s Sequence) (*compiled, error) {
	if s.Name == "" || s.ID == "" {
		return nil, fmt.Errorf("name and id are required")
	}
	// Identity sanity: id, name, tags and step rules reach logs, the
	// console and webhook consumers on every alert, so they get the
	// same treatment the ingest applies to feed identities — a bounded
	// length and zero control runes. A \x1b in an id would be terminal
	// injection into the engine's own log output; a \n would forge log
	// lines. Descriptions never leave the process (the alert does not
	// carry them), so only their length is bounded.
	for _, f := range []struct{ label, val string }{{"id", s.ID}, {"name", s.Name}} {
		if n := len([]rune(f.val)); n > maxIDRunes {
			return nil, fmt.Errorf("%s is %d runes, over the %d rune cap", f.label, n, maxIDRunes)
		}
		if r, ok := firstControlRune(f.val); ok {
			return nil, fmt.Errorf("%s contains control rune %q (U+%04X)", f.label, r, r)
		}
	}
	if n := len([]rune(s.Description)); n > maxDescriptionRunes {
		return nil, fmt.Errorf("description is %d runes, over the %d rune cap", n, maxDescriptionRunes)
	}
	if len(s.Tags) > maxTags {
		return nil, fmt.Errorf("%d tags is over the %d tag cap", len(s.Tags), maxTags)
	}
	for _, tg := range s.Tags {
		if n := len([]rune(tg)); n > maxTagRunes {
			return nil, fmt.Errorf("tag %q is %d runes, over the %d rune cap", tg, n, maxTagRunes)
		}
		if r, ok := firstControlRune(tg); ok {
			return nil, fmt.Errorf("tag contains control rune %q (U+%04X)", r, r)
		}
	}
	switch s.Severity {
	case rules.SevLow, rules.SevMedium, rules.SevHigh, rules.SevCritical:
	default:
		return nil, fmt.Errorf("invalid severity %q", s.Severity)
	}
	if len(s.Steps) < 2 {
		return nil, fmt.Errorf("at least 2 steps are required, got %d", len(s.Steps))
	}
	if len(s.Steps) > maxStepsPerSequence {
		return nil, fmt.Errorf("%d steps is over the %d step cap", len(s.Steps), maxStepsPerSequence)
	}
	for i, st := range s.Steps {
		if st.Rule == "" {
			return nil, fmt.Errorf("step %d: rule name is required", i)
		}
		if n := len([]rune(st.Rule)); n > maxIDRunes {
			return nil, fmt.Errorf("step %d: rule name is %d runes, over the %d rune cap", i, n, maxIDRunes)
		}
		if r, ok := firstControlRune(st.Rule); ok {
			return nil, fmt.Errorf("step %d: rule name contains control rune %q (U+%04X)", i, r, r)
		}
	}
	w := 5 * time.Minute
	if s.Window != "" {
		d, err := time.ParseDuration(s.Window)
		if err != nil || d <= 0 {
			return nil, fmt.Errorf("invalid window %q", s.Window)
		}
		// A chain whose window never expires pins one tracked state per
		// host until the window passes: enough hosts and the
		// maxTrackedStates cap is exhausted, silently stopping
		// correlation for new hosts. Window abuse is config-side, so the
		// load names it instead of absorbing it.
		if d > maxWindow {
			return nil, fmt.Errorf("window %q is over the %s cap (chains that never expire pin tracked states until maxTrackedStates is exhausted)", s.Window, maxWindow)
		}
		w = d
	}
	return &compiled{seq: s, window: w}, nil
}

// firstControlRune returns the first Unicode control rune (Cc: NUL,
// newlines, TAB, ESC/ANSI, DEL...) found in s, if any. Config strings
// that leave the process must not be able to forge log lines or
// inject terminal escapes.
func firstControlRune(s string) (rune, bool) {
	for _, r := range s {
		if unicode.IsControl(r) {
			return r, true
		}
	}
	return 0, false
}

// The YAML resource-bomb pre-scan (nesting depth + alias expansion)
// lives in internal/yamlcheck: one guard for every loader instead of
// the inline copies this package and the rules loader used to carry.
