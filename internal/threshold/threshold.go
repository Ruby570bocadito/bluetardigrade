// Package threshold implements volumetric detection: alerts when MANY
// occurrences of the same predicate happen within one time window,
// optionally grouped by a field (brute force, mass deletion, port
// scans, credential spraying). Package A2 of the roadmap.
//
// Window model (dictamen 04, Q1 — ACCEPTED WITH CONDITION; cifras
// corregidas por la adenda vinculante 11h02, O2):
//
// Fixed-window counters per key, NOT sliding timestamp rings. The
// boundary trade-off is DOCUMENTED AND ACCEPTED behavior: a burst
// straddling a window edge can count up to 2×(count-1) events across
// 2×T before the rollover — for volumetric DETECTION the cost is one
// extra alert, never a missed one (fail2ban makes the same trade).
// The fixed window keeps per-key state at a flat struct: keyState is
// ~56 B (int + two time.Time) and Go maps add ~24-32 B per entry, so
// the 8192-key worst case is ~0.65-0.72 MB — the <1 MB bound HOLDS
// (the "48 B / 393 KB" figures of the dictamen underestimated the map
// overhead). Beaconing (A3), where the boundary IS the signal, keeps
// its sliding ring — that is why they are two packages, not one.
//
// Time model: windows and cooldowns run on the EVENT time
// (model.Event.DetectionTime), not on arrival. An offline import of a
// day of firewall or honeypot logs reaches the engine in seconds; on
// arrival time every source IP that dropped 50 packets over 24 hours
// looked like a 5-minute burst. Late events that fall less than one
// window behind the current window start are counted in it (normal
// reordering between sources); an event more than a window behind is a
// discontinuity (clock stepped back, another capture) and restarts the
// key. The engine wall clock (Observe's now) only decides which keys
// are dead weight and stamps the alert's raise time.
//
// Bounds (design §3 + dictamen Q2, all load- or admission-enforced):
//
//	MaxRules 64          unbounded per-event walk cost
//	MaxKeys 8192         hostile group_by values growing the map forever
//	MaxKeysPerRule 2048  CROSS-RULE EVICTION DoS: one rule under a
//	                     key-flood (e.g. spoofed source IPs) must not
//	                     be able to wash out evidence other rules are
//	                     accumulating — no rule owns more than 25%
//	                     of the table
//	MaxCount 4096        a threshold that can never fire = silent control
//	MaxWindow 24h        windows with no operational meaning
//	MaxKeysPerHost 2048  v1.1 cuotas por equipo: the same ceiling per
//	                     HOST — one noisy machine cannot fill the
//	                     shared table the others report into
//	maxFileBytes 4 MiB   same input standard as beacon/correlate
//
// Eviction policy (F1, adenda vinculante 11h02 — sustituye la
// semántica del dictamen 10h45):
//
//  1. The per-rule quota is an ADMISSION CEILING only: a rule at
//     MaxKeysPerRule admits NO new keys — events that would create
//     key 2049 are dropped for that rule while its existing keys keep
//     counting and firing normally. Monopoly is bounded to 25% of the
//     table BY CONSTRUCTION; no eviction path can bypass it.
//  2. When the GLOBAL cap is saturated and a new key must be admitted:
//     fully expired keys of ANY rule are purged first (dead evidence);
//     if none, weakest-first GLOBAL (lowest count, tie-break smallest
//     key), never the newly-arrived key (risk-tracker rule). A flood
//     always contributes the weakest keys of the map, so it washes
//     out only itself; the quota prevents PREEMPTIVE monopoly.
//  3. Defensive: even if no rule ever reached the quota, a saturated
//     global cap follows the same weakest-first-global path — there is
//     no no-op eviction branch and no "offending rule" selection.
//
// Cost note (O1, accepted precedent like risk's evictColdest): the
// weakest-first scan is O(keys) but ONLY runs on admission with a
// saturated map — never on the happy per-event path.
package threshold

import (
	"fmt"
	"os"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/alert"
	"github.com/Ruby570bocadito/bluetardigrade/internal/rules"
	"github.com/Ruby570bocadito/bluetardigrade/internal/yamlcheck"
	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"

	"gopkg.in/yaml.v3"
)

// Hard bounds (see package doc).
const (
	MaxRules       = 64
	MaxKeys        = 8192
	MaxKeysPerRule = MaxKeys / 4 // dictamen Q2: 25% quota, no rule may monopolize
	MaxKeysPerHost = MaxKeys / 4 // v1.1 cuotas por equipo: the same ceiling per HOST, one noisy
	// machine may not monopolize the shared table either
	MaxCount     = 4096
	MaxWindow    = 24 * time.Hour
	maxFileBytes = 4 << 20
	MinCount     = 2
)

// Definition is one threshold rule as written in thresholds.yaml.
type Definition struct {
	Name        string            `yaml:"name"`
	ID          string            `yaml:"id"`
	Description string            `yaml:"description,omitempty"`
	Severity    string            `yaml:"severity"`
	EventType   string            `yaml:"event_type"`
	Conditions  []rules.Condition `yaml:"conditions,omitempty"` // empty = every event of the type counts
	Threshold   Spec              `yaml:"threshold"`
	Cooldown    string            `yaml:"cooldown,omitempty"`
	Tags        []string          `yaml:"tags,omitempty"`
}

// Spec is the aggregation block.
type Spec struct {
	Count   int    `yaml:"count"`
	Window  string `yaml:"window"`
	GroupBy string `yaml:"group_by,omitempty"` // dotted path over the event schema
}

// compiled is a validated, matcher-armed definition.
type compiled struct {
	def      Definition
	matcher  *rules.Matcher
	window   time.Duration
	cooldown time.Duration
}

// key is the aggregation identity. A struct, never a concatenated
// string (correlator lesson: fields carrying hostile separators must
// not be able to collide).
type key struct {
	ruleID string
	host   string
	group  string
}

// keyState is the fixed-window counter (~48 B, no pointers).
type keyState struct {
	count       int
	windowStart time.Time // event time
	lastFired   time.Time // event time
	seen        time.Time // wall clock of the last observation (expiry only)
	// simulated is set as soon as any event of the key carries the
	// simulation tag (detection validation, SIM-1): the volumetric
	// alert is tagged in turn so a lab replay is never real evidence.
	simulated bool
}

// Detector holds the compiled definitions and the bounded key table.
// Safe for concurrent use.
type Detector struct {
	mu      sync.Mutex
	defs    []compiled
	byID    map[string]*compiled
	keys    map[key]*keyState
	perRule map[string]int
	// perHost is the per-host twin of perRule (v1.1 cuotas por
	// equipo): the quota is an admission ceiling per host, and a
	// host whose keys all expired recovers itself (dead evidence
	// is purged before the refusal).
	perHost       map[string]int
	quotaRejected uint64            // host-quota refusals since startup
	quotaHosts    map[string]uint64 // refusal tally by host, capped

	emit  func(alert.Alert)
	fired atomic.Uint64
}

// LoadFile parses, validates and compiles a thresholds YAML file
// (a list of Definitions). A malformed file is an ERROR, never a
// silent empty detector: an operator who armed a threshold must not
// believe it is running (the suppressions/beacons standard).
func LoadFile(path string) (*Detector, error) {
	defs, byID, err := loadFile(path)
	if err != nil {
		return nil, err
	}
	return newDetector(defs, byID), nil
}

func newDetector(defs []compiled, byID map[string]*compiled) *Detector {
	return &Detector{
		defs:       defs,
		byID:       byID,
		keys:       map[key]*keyState{},
		perRule:    map[string]int{},
		perHost:    map[string]int{},
		quotaHosts: map[string]uint64{},
	}
}

func loadFile(path string) ([]compiled, map[string]*compiled, error) {
	info, err := os.Stat(path)
	if err != nil {
		return nil, nil, fmt.Errorf("threshold: stat %s: %w", path, err)
	}
	if info.Size() > maxFileBytes {
		return nil, nil, fmt.Errorf("threshold: %s: fichero mayor de %d bytes", path, maxFileBytes)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, nil, fmt.Errorf("threshold: read %s: %w", path, err)
	}
	if err := yamlcheck.Guard(path, data); err != nil {
		return nil, nil, err
	}
	var defs []Definition
	if err := yaml.Unmarshal(data, &defs); err != nil {
		return nil, nil, fmt.Errorf("threshold: %s: YAML invalido: %w", path, err)
	}
	if len(defs) > MaxRules {
		return nil, nil, fmt.Errorf("threshold: %s: %d definiciones (max %d)", path, len(defs), MaxRules)
	}
	compileds := make([]compiled, 0, len(defs))
	for i := range defs {
		c, err := compileDef(&defs[i])
		if err != nil {
			return nil, nil, fmt.Errorf("threshold: %s: definicion %d (%q): %w", path, i, defs[i].Name, err)
		}
		compileds = append(compileds, *c)
	}
	byID := map[string]*compiled{}
	for i := range compileds {
		if _, dup := byID[compileds[i].def.ID]; dup {
			return nil, nil, fmt.Errorf("threshold: %s: id duplicado %q", path, compileds[i].def.ID)
		}
		byID[compileds[i].def.ID] = &compileds[i]
	}
	return compileds, byID, nil
}

func compileDef(def *Definition) (*compiled, error) {
	switch {
	case strings.TrimSpace(def.Name) == "":
		return nil, fmt.Errorf("sin name")
	case strings.TrimSpace(def.ID) == "":
		return nil, fmt.Errorf("sin id")
	case len(def.ID) > 128:
		return nil, fmt.Errorf("id mayor de 128 caracteres")
	case def.Severity != rules.SevInfo && def.Severity != rules.SevLow &&
		def.Severity != rules.SevMedium && def.Severity != rules.SevHigh &&
		def.Severity != rules.SevCritical:
		return nil, fmt.Errorf("severity %q invalida (info|low|medium|high|critical)", def.Severity)
	case strings.TrimSpace(def.EventType) == "":
		return nil, fmt.Errorf("sin event_type")
	case def.Threshold.Count < MinCount:
		return nil, fmt.Errorf("threshold.count %d menor que %d (un conteo de 1 es una regla, no un umbral)", def.Threshold.Count, MinCount)
	case def.Threshold.Count > MaxCount:
		return nil, fmt.Errorf("threshold.count %d mayor que %d (un umbral que nunca dispara es un control mudo)", def.Threshold.Count, MaxCount)
	}
	window, err := time.ParseDuration(def.Threshold.Window)
	if err != nil {
		return nil, fmt.Errorf("threshold.window %q no es una duracion valida", def.Threshold.Window)
	}
	if window <= 0 || window > MaxWindow {
		return nil, fmt.Errorf("threshold.window %s fuera de rango (0 < w <= %s)", window, MaxWindow)
	}
	cooldown := time.Duration(0)
	if def.Cooldown != "" {
		cooldown, err = time.ParseDuration(def.Cooldown)
		if err != nil {
			return nil, fmt.Errorf("cooldown %q no es una duracion valida", def.Cooldown)
		}
		if cooldown < 0 || cooldown > MaxWindow {
			return nil, fmt.Errorf("cooldown %s fuera de rango (0 <= c <= %s)", cooldown, MaxWindow)
		}
	}
	matcher, err := rules.NewMatcher(def.Conditions)
	if err != nil {
		return nil, fmt.Errorf("conditions: %w", err)
	}
	return &compiled{
		def:      *def,
		matcher:  matcher,
		window:   window,
		cooldown: cooldown,
	}, nil
}

// Reload atomically replaces the definition set and prunes the keys of
// definitions that no longer exist (the beacon Reload convention:
// dead profiles leave no zombie state).
func (d *Detector) Reload(path string) error {
	defs, byID, err := loadFile(path)
	if err != nil {
		return err
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	d.defs = defs
	d.byID = byID
	for k := range d.keys {
		if _, ok := d.byID[k.ruleID]; !ok {
			d.deleteKeyLocked(k)
		}
	}
	return nil
}

// SetEmit wires (or rewires) the emission callback, so the engine can
// attach the suppression wrapper after loading (same order as the
// correlator and the beacon manager).
func (d *Detector) SetEmit(emit func(alert.Alert)) {
	d.mu.Lock()
	d.emit = emit
	d.mu.Unlock()
}

// Count returns the number of compiled definitions.
func (d *Detector) Count() int {
	d.mu.Lock()
	defer d.mu.Unlock()
	return len(d.defs)
}

// Names returns the sorted definition names (startup log surface).
func (d *Detector) Names() []string {
	d.mu.Lock()
	defer d.mu.Unlock()
	out := make([]string, 0, len(d.defs))
	for i := range d.defs {
		out = append(out, d.defs[i].def.Name)
	}
	sort.Strings(out)
	return out
}

// KeysTracked reports how many keys currently hold in-window evidence.
func (d *Detector) KeysTracked() int {
	d.mu.Lock()
	defer d.mu.Unlock()
	return len(d.keys)
}

// Fired returns the total alerts emitted since startup.
func (d *Detector) Fired() uint64 { return d.fired.Load() }

// Observe feeds one event into every definition whose event_type
// matches and whose conditions pass. Events that fail the predicate
// never count. The caller passes the clock (non-decreasing), exactly
// like the beacon manager.
func (d *Detector) Observe(ev *model.Event, now time.Time) {
	if ev == nil {
		return
	}
	fields := ev.FieldMap()
	host := strings.ToLower(ev.Host)
	t := ev.DetectionTime(now)
	d.mu.Lock()
	emit := d.emit
	var fired []alert.Alert
	for i := range d.defs {
		c := &d.defs[i]
		if c.def.EventType != ev.Type {
			continue
		}
		if !c.matcher.MatchFields(fields) {
			continue
		}
		group := ""
		if c.def.Threshold.GroupBy != "" {
			group = rules.AsString(rules.Lookup(fields, c.def.Threshold.GroupBy))
		}
		k := key{ruleID: c.def.ID, host: host, group: group}
		st := d.admitLocked(k, c, t, now)
		if st == nil {
			// F1: the rule is at its admission quota — the event is
			// dropped for THIS rule (other rules still see it) and its
			// existing keys keep counting and firing normally.
			continue
		}
		st.seen = now
		if alert.EventIsSimulated(ev) {
			st.simulated = true
		}
		switch {
		case t.Sub(st.windowStart) >= c.window:
			// fixed-window rollover: a window older than the period
			// is closed and the counter restarts from zero
			st.windowStart = t
			st.count = 0
		case st.windowStart.Sub(t) > c.window:
			// discontinuity: more than a window behind the current
			// window (clock stepped back, another capture) restarts
			// the key instead of being counted into a burst it never
			// belonged to
			st.windowStart = t
			st.count = 0
			st.lastFired = time.Time{}
		}
		st.count++
		// fire: the window reached the threshold AND the cooldown
		// (since the last fire for THIS key) has elapsed. Firing
		// resets the window, so a sustained flow raises one alert
		// per burst, not one per period.
		if st.count >= c.def.Threshold.Count && (st.lastFired.IsZero() || t.Sub(st.lastFired) >= c.cooldown) {
			fired = append(fired, d.fireLocked(c, ev, group, st, t, now))
		}
	}
	d.mu.Unlock()
	// Deliver OUTSIDE mu (the accumulated O1 — the
	// same pattern beacon and the correlator had): the pipeline takes
	// the hub lock and can block on SQLite, webhook and risk, and no
	// stats read should queue behind delivery under this detector's
	// lock. Window/cooldown state mutations stay atomic under mu; only
	// delivery moves out. One Observe emits its firings in detection
	// order and the engine observes from one goroutine, so delivery
	// order on every real path is unchanged. emit was captured under
	// mu, so SetEmit stays race-free.
	for _, a := range fired {
		if emit != nil {
			emit(a)
		}
	}
}

// admitLocked returns the state for k, creating it under the bound
// policy documented in the package doc. A nil return means the event
// is DROPPED for this rule (F1: quota = admission ceiling). Caller
// holds mu.
func (d *Detector) admitLocked(k key, _ *compiled, t, now time.Time) *keyState {
	if st, ok := d.keys[k]; ok {
		return st
	}
	// F1.1: quota is an ADMISSION CEILING, never an eviction trigger.
	// No key #2049 for a saturated rule — and no eviction path may
	// bypass this by making room.
	if d.perRule[k.ruleID] >= MaxKeysPerRule {
		return nil
	}
	// Host quota (v1.1 cuotas por equipo): the same admission ceiling
	// per host — a noisy machine cannot fill the table the others
	// report into. Dead evidence is purged first so a host whose
	// keys all expired recovers itself, without waiting for the
	// global cap to fill (the per-rule ceiling above stays a pure
	// ceiling: that semantics is the audited adenda behavior).
	if d.perHost[k.host] >= MaxKeysPerHost {
		d.purgeExpiredLocked(now)
		if d.perHost[k.host] >= MaxKeysPerHost {
			d.quotaRejectLocked(k.host)
			return nil
		}
	}
	// F1.2: global saturation — dead evidence (expired keys of ANY
	// rule) frees slots first.
	if len(d.keys) >= MaxKeys {
		d.purgeExpiredLocked(now)
	}
	// F1.2/F1.3: still saturated → weakest-first GLOBAL (lowest count,
	// deterministic tie-break), never the newly-arrived key. A flood
	// always contributes the weakest keys of the map, so it washes out
	// only itself.
	if len(d.keys) >= MaxKeys {
		d.evictWeakestGlobalLocked(k)
	}
	st := &keyState{windowStart: t, seen: now}
	d.keys[k] = st
	d.perRule[k.ruleID]++
	d.perHost[k.host]++
	return st
}

// purgeExpiredLocked deletes every key not observed for more than
// 2×window of wall-clock time. Caller holds mu.
func (d *Detector) purgeExpiredLocked(now time.Time) {
	for k, st := range d.keys {
		c := d.byID[k.ruleID]
		if c == nil {
			continue // unreachable: Reload prunes unknown rule ids
		}
		if now.Sub(st.seen) > 2*c.window {
			d.deleteKeyLocked(k)
		}
	}
}

// evictWeakestGlobalLocked frees one global slot by deleting the
// lowest-count key of the WHOLE table (F1.2: weakest-first global,
// without per-rule restrictions — a flood always contributes the
// weakest keys, so it washes out only itself). Ties: smallest key.
// The newcomer is not in the map yet, so it can never be its own
// victim (risk-tracker rule). Caller holds mu.
func (d *Detector) evictWeakestGlobalLocked(exclude key) {
	var weakest key
	found := false
	for k, st := range d.keys {
		if k == exclude {
			continue // defensive: the newcomer is never a victim
		}
		if !found || st.count < d.keys[weakest].count || (st.count == d.keys[weakest].count && lessKey(k, weakest)) {
			weakest, found = k, true
		}
	}
	if found {
		d.deleteKeyLocked(weakest)
	}
}

// deleteKeyLocked removes a key and keeps the per-rule tally honest.
func (d *Detector) deleteKeyLocked(k key) {
	if _, ok := d.keys[k]; !ok {
		return
	}
	delete(d.keys, k)
	if d.perRule[k.ruleID] <= 1 {
		delete(d.perRule, k.ruleID)
	} else {
		d.perRule[k.ruleID]--
	}
	if d.perHost[k.host] <= 1 {
		delete(d.perHost, k.host)
	} else {
		d.perHost[k.host]--
	}
}

// lessKey is the deterministic tie-break for evictions.
func lessKey(a, b key) bool {
	if a.ruleID != b.ruleID {
		return a.ruleID < b.ruleID
	}
	if a.host != b.host {
		return a.host < b.host
	}
	return a.group < b.group
}

// fireLocked applies the fire state transitions (cooldown, window
// reset, counter) and builds the alert. Caller holds mu; the returned
// alert is delivered by Observe AFTER mu is released — the pipeline
// takes the hub lock and can block, and no stats read should queue
// behind that (see Observe).
func (d *Detector) fireLocked(c *compiled, ev *model.Event, group string, st *keyState, t, now time.Time) alert.Alert {
	st.lastFired = t
	st.count = 0
	st.windowStart = t
	d.fired.Add(1)
	summary := fmt.Sprintf("umbral alcanzado: %d eventos de %s en la ventana %s",
		c.def.Threshold.Count, ev.Type, c.window)
	if group != "" {
		summary = fmt.Sprintf("umbral alcanzado: %d eventos de %s con %s=%q en la ventana %s",
			c.def.Threshold.Count, ev.Type, c.def.Threshold.GroupBy, group, c.window)
	}
	matched := []string{"threshold"}
	if c.def.Threshold.GroupBy != "" {
		matched = append(matched, c.def.Threshold.GroupBy)
	}
	a := alert.Alert{
		Timestamp:  now.UTC().Format(time.RFC3339Nano),
		RuleID:     c.def.ID,
		RuleName:   c.def.Name,
		Severity:   c.def.Severity,
		Host:       ev.Host,
		User:       ev.User,
		EventID:    ev.ID,
		EventType:  ev.Type,
		Source:     ev.Source,
		Attributes: ev.Attributes,
		Network:    ev.Network,
		Summary:    summary,
		MatchedOn:  matched,
		Tags:       c.def.Tags,
		Enrich:     ev.Enrichment,
	}
	if st.simulated {
		alert.MarkSimulated(&a)
	}
	return a
}

// group keys use rules.AsString: the canonical normalization the
// operators apply when matching field values, so a group_by key can
// never disagree with what an operator folded for the same field.

// maxQuotaHostEntries caps the refusal tally by host: honesty about
// WHICH host is being refused cannot itself become an unbounded map.
// Past the cap the total keeps counting every refusal; only the
// per-host attribution stops growing.
const maxQuotaHostEntries = 64

// quotaRejectLocked counts one host-quota refusal (total + capped
// per-host tally). Caller holds mu.
func (d *Detector) quotaRejectLocked(host string) {
	d.quotaRejected++
	if _, ok := d.quotaHosts[host]; !ok && len(d.quotaHosts) >= maxQuotaHostEntries {
		return // tally full: the total still counts every refusal
	}
	d.quotaHosts[host]++
}

// QuotaHost is one host's row of the refusal tally (always served as
// a copy — shared state leaves every read path as a copy).
type QuotaHost struct {
	Host     string
	Rejected uint64
}

// QuotaRejected returns how many new aggregation keys were refused
// because the HOST's own quota was full (v1.1 cuotas por equipo):
// the width of the noisy-host pressure on the shared table.
func (d *Detector) QuotaRejected() uint64 {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.quotaRejected
}

// QuotaHosts returns the capped per-host refusal tally as a copy:
// top-list merging is the API layer's job, so the manager serves the
// whole tally and stays out of presentation decisions.
func (d *Detector) QuotaHosts() map[string]uint64 {
	d.mu.Lock()
	defer d.mu.Unlock()
	out := make(map[string]uint64, len(d.quotaHosts))
	for h, n := range d.quotaHosts {
		out[h] = n
	}
	return out
}

// QuotaTopHosts returns the hosts with the most quota refusals, worst
// first, at most 8 rows, always a copy.
func (d *Detector) QuotaTopHosts() []QuotaHost {
	d.mu.Lock()
	defer d.mu.Unlock()
	out := make([]QuotaHost, 0, len(d.quotaHosts))
	for h, n := range d.quotaHosts {
		out = append(out, QuotaHost{Host: h, Rejected: n})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Rejected != out[j].Rejected {
			return out[i].Rejected > out[j].Rejected
		}
		return out[i].Host < out[j].Host
	})
	if len(out) > 8 {
		out = out[:8]
	}
	return out
}
