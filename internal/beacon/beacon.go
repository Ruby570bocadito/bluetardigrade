// Package beacon detects C2 beaconing in network.connect telemetry:
// one host reaching one destination at a conspicuously regular
// cadence. It is package A3 of the owner's roadmap ("detección de
// C2 beaconing") and the first behavioral detector in the engine —
// unlike rules (per-event predicates) or sequences (unordered step
// completion), beaconing is a property of the TIMING of many events,
// so it lives in its own tracker fed by the engine's event loop.
//
// Design notes:
//
//   - The detection algorithm is deliberately legible: per
//     (profile, host, destination) keep the last up to 64 connection
//     timestamps inside the profile's sliding window; once at least
//     min_count connections exist, compute the mean inter-arrival
//     interval and its coefficient of variation (CV = stddev/mean,
//     the standard regularity measure). CV at or under the profile's
//     max_jitter with a mean interval of at least min_interval is a
//     beacon. No ML, no magic numbers beyond the operator-visible
//     profile bounds — an analyst must be able to explain every alert.
//   - min_interval exists to protect against regular-but-benign
//     traffic: CDNs, load balancers and NTP pools also connect
//     regularly, but at sub-second cadences or against rotating
//     destination sets. It is the operator's main false-positive
//     knob and the shipped profiles always set it.
//   - State is bounded (MaxKeys, ringCap): the lesson the correlator
//     cap taught and A1 replicated. A hostile feed inventing unique
//     destinations must not grow the map without limit. Past the cap
//     the weakest keys are evicted first — fewest accumulated samples,
//     then stale ones, then the oldest — so a flood of one-connection
//     fake destinations can only ever evict other flood entries and
//     cannot wash out a key that has been building beacon evidence
//     (the same invariant A1 pinned for risk scores).
//   - Every Observe takes `now` (the engine's wall clock) as a
//     parameter: the tracker has no clock of its own (the A1 rule) and
//     tests are deterministic. Intervals are measured on the EVENT
//     time (model.Event.DetectionTime): arrival time measures the
//     transport — sensor batching, a Sysmon poll, an offline import
//     replaying a day of Zeek logs in seconds — not the beacon. Late
//     events are inserted in order; an event more than one window
//     older than the newest sample of its key is a discontinuity
//     (clock stepped back, a different capture) and restarts the
//     ring. The wall clock only decides which keys are dead weight.
//   - A beacon alert flows through the SAME alert.Manager pipeline as
//     rule and sequence alerts: dedup, lifecycle triage, store
//     persistence, webhook and console come for free, and the
//     operator allowlist (suppressions) silences a profile+host pair
//     exactly like any other rule id (the engine wires SetEmit with
//     the same suppression wrapper the correlator uses).
//   - Reload replaces the compiled profiles and keeps live state, but
//     prunes the states of profiles that no longer exist: config
//     churn must not silently exhaust the key cap with entries that
//     can never fire again.
package beacon

import (
	"fmt"
	"math"
	"net"
	"os"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/alert"
	"github.com/Ruby570bocadito/bluetardigrade/internal/rules"
	"github.com/Ruby570bocadito/bluetardigrade/internal/yamlcheck"
	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"

	"gopkg.in/yaml.v3"
)

// Bounds — every one names the failure mode it prevents, the same
// style as the correlator's caps. The exported mirrors let tests and
// operator tooling pin them the way MaxTrackedStates does.
const (
	// MaxKeys bounds the (profile, host, destination) state map.
	// Each entry holds at most ringCap timestamps, so the map is the
	// only unbounded dimension: without the cap a hostile feed
	// inventing unique destinations grows it without limit.
	MaxKeys = 8192

	// ringCap caps the timestamps kept per key. 64 samples give a
	// solid CV estimate while capping per-key memory; min_count above
	// the ring could never fire, so profile validation rejects it
	// (a control that silently can never fire is a misconfig, not a
	// knob — the loud-failure standard).
	ringCap = 64

	// MaxProfiles bounds the loaded profile set: Observe walks EVERY
	// profile on each network event, so the per-event cost is bounded
	// by construction at MaxProfiles constant-time operations.
	MaxProfiles = 64

	// maxFileBytes caps one beacons file before it is read (the
	// correlate package's own bound, for the same reason: os.ReadFile
	// has no limit of its own).
	maxFileBytes = 4 << 20 // 4 MiB
)

// RingCap is the per-key timestamp cap, exported for tests and
// operator docs (min_count must stay under it to ever fire).
const RingCap = ringCap

// Profile is the YAML definition of one beacon detector. Several
// profiles can coexist (e.g. a strict HTTPS/HTTP one and a laxer DNS
// one); each fires independently.
type Profile struct {
	Name        string   `yaml:"name"`
	ID          string   `yaml:"id"`
	Description string   `yaml:"description"`
	Severity    string   `yaml:"severity"`
	Window      string   `yaml:"window"`       // sliding window, e.g. 15m
	MinCount    int      `yaml:"min_count"`    // connections in-window before judging
	MaxJitter   float64  `yaml:"max_jitter"`   // CV ceiling, 0 < x <= 1
	MinInterval string   `yaml:"min_interval"` // mean-interval floor, e.g. 2s (empty = any cadence)
	Ports       []int    `yaml:"ports"`        // optional destination-port allowlist; empty = any
	Cooldown    string   `yaml:"cooldown"`     // per-key re-fire silence; empty = window
	Tags        []string `yaml:"tags"`
}

type compiled struct {
	p           Profile
	window      time.Duration
	minInterval time.Duration
	cooldown    time.Duration
	ports       map[int]bool
}

// keyState is the per-(profile, host, destination) evidence ring.
// It never pins the events themselves (ingest lines can carry up to
// 1 MiB): timestamps only, the same slim-evidence principle the
// correlator's state applies.
type keyState struct {
	times     []time.Time // connection event times, oldest first
	lastFired time.Time   // event time of the last fire; zero until the key fired once
	seen      time.Time   // wall clock of the last observation (staleness only)
	// simulated is set as soon as any connection of the key carries
	// the simulation tag (detection validation, SIM-1): the beacon
	// alert is tagged in turn so a lab replay is never real evidence.
	simulated bool
}

// insertSorted adds t to times keeping them in ascending order (the
// common in-order case is a plain append).
func insertSorted(times []time.Time, t time.Time) []time.Time {
	i := sort.Search(len(times), func(i int) bool { return times[i].After(t) })
	times = append(times, time.Time{})
	copy(times[i+1:], times[i:])
	times[i] = t
	return times
}

// beaconKey identifies one tracked destination. A struct, not a
// concatenated string: the correlator's lesson — a feed-controlled
// field containing the separator must not be able to alias two
// (profile, host, dest) pairs onto one entry.
type beaconKey struct {
	profileID string
	host      string // lowercased
	dest      string // lowercased domain (preferred) or IP
	port      int
}

// Manager evaluates network events against the loaded profiles.
// Safe for concurrent use.
type Manager struct {
	mu    sync.Mutex
	profs []*compiled
	state map[beaconKey]*keyState
	emit  func(alert.Alert)
	fired uint64
}

// LoadFile compiles the profiles in one YAML file. emit is called
// once per detected beacon (wire it to alert.Manager.Emit through the
// suppression wrapper, exactly like the correlator's).
func LoadFile(path string, emit func(alert.Alert)) (*Manager, error) {
	m := &Manager{state: map[beaconKey]*keyState{}, emit: emit}
	if err := m.load(path); err != nil {
		return nil, err
	}
	return m, nil
}

// Reload atomically replaces the profile set. Live state is kept (a
// hot-reload must not reset detection mid-session) but the states of
// profiles that no longer exist are pruned: they can never fire
// again and would leak toward the key cap.
func (m *Manager) Reload(path string) error {
	fresh := &Manager{state: map[beaconKey]*keyState{}, emit: m.emit}
	if err := fresh.load(path); err != nil {
		return err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	alive := map[string]bool{}
	for _, c := range fresh.profs {
		alive[c.p.ID] = true
	}
	for k := range m.state {
		if !alive[k.profileID] {
			delete(m.state, k)
		}
	}
	m.profs = fresh.profs
	return nil
}

// Count returns the number of loaded profiles.
func (m *Manager) Count() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.profs)
}

// Names returns the sorted profile names (startup banner, smoke logs).
func (m *Manager) Names() []string {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]string, 0, len(m.profs))
	for _, c := range m.profs {
		out = append(out, c.p.Name)
	}
	sort.Strings(out)
	return out
}

// Fired returns the total number of beacon alerts emitted since
// startup (across reloads — it is a detection counter, not a config
// counter).
func (m *Manager) Fired() uint64 {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.fired
}

// Tracked reports how many keys currently hold in-window evidence,
// i.e. the width of the live signal. Keys whose last connection is
// older than their profile's window are NOT counted (their evidence
// is stale) even though their ring still occupies state.
func (m *Manager) Tracked(now time.Time) int {
	m.mu.Lock()
	defer m.mu.Unlock()
	byID := make(map[string]*compiled, len(m.profs))
	for _, c := range m.profs {
		byID[c.p.ID] = c
	}
	n := 0
	for k, st := range m.state {
		c := byID[k.profileID]
		if c == nil || len(st.times) == 0 {
			continue
		}
		if now.Sub(st.seen) <= c.window {
			n++
		}
	}
	return n
}

// SetEmit wires (or rewires) the emission callback, so the engine can
// attach the suppression wrapper after loading (the same order the
// correlator uses: LoadDir first, SetEmit once the allowlist exists).
func (m *Manager) SetEmit(emit func(alert.Alert)) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.emit = emit
}

// Observe feeds one event into every profile. Only network.connect
// events with a destination participate; everything else is a no-op.
// Firing respects the per-key cooldown; the caller must pass
// non-decreasing timestamps.
func (m *Manager) Observe(ev *model.Event, now time.Time) {
	if ev == nil || ev.Type != model.TypeNetworkConnect || ev.Network == nil {
		return
	}
	n := ev.Network
	// A DNS query is not a connection: applications re-resolve names on
	// a timer (record TTLs, connectivity checks), which reads as a
	// perfect cadence. The connection that follows a lookup is what
	// counts, and it carries the domain (Sysmon, and the ETW sensor's DNS
	// memory).
	if strings.EqualFold(n.Protocol, "dns") {
		return
	}
	dest := strings.ToLower(n.Domain)
	if dest == "" {
		ip := net.ParseIP(strings.TrimSpace(n.DestinationIP))
		// loopback, link-local (the router's DNS on fe80::), multicast:
		// local plumbing, never a C2 destination
		if ip != nil && (ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsMulticast() || ip.IsUnspecified()) {
			return
		}
		dest = strings.ToLower(n.DestinationIP)
	}
	if dest == "" {
		return
	}
	port := n.DestinationPort
	host := strings.ToLower(ev.Host)
	t := ev.DetectionTime(now)

	m.mu.Lock()
	emit := m.emit
	var fired []alert.Alert
	for _, c := range m.profs {
		if len(c.ports) > 0 && !c.ports[port] {
			continue
		}
		key := beaconKey{profileID: c.p.ID, host: host, dest: dest, port: port}
		st := m.state[key]
		if st == nil {
			// Admission past the cap: drop fully stale keys first
			// (they are dead evidence), then evict the coldest key.
			// A newly observed key is by definition the freshest —
			// it can never be its own eviction victim.
			if len(m.state) >= MaxKeys {
				m.reclaimLocked(c, now)
			}
			st = &keyState{}
			m.state[key] = st
		}
		st.seen = now
		if alert.EventIsSimulated(ev) {
			st.simulated = true
		}
		// a sample more than one window older than the newest one is
		// a discontinuity, not a late arrival: restart the ring
		if n := len(st.times); n > 0 && st.times[n-1].Sub(t) > c.window {
			st.times = st.times[:0]
			st.lastFired = time.Time{}
		}
		st.times = insertSorted(st.times, t)
		// window prune: drop samples older than the profile window,
		// measured back from the newest event time of the key
		cutoff := st.times[len(st.times)-1].Add(-c.window)
		drop := 0
		for drop < len(st.times) && st.times[drop].Before(cutoff) {
			drop++
		}
		if drop > 0 {
			st.times = append(st.times[:0], st.times[drop:]...)
		}
		// ring cap: keep the freshest ringCap samples
		if len(st.times) > ringCap {
			st.times = append(st.times[:0], st.times[len(st.times)-ringCap:]...)
		}
		if len(st.times) < c.p.MinCount {
			continue
		}
		mean, cv, ok := regularity(st.times)
		if !ok || cv > c.p.MaxJitter || mean < c.minInterval {
			continue
		}
		newest := st.times[len(st.times)-1]
		if !st.lastFired.IsZero() && newest.Sub(st.lastFired) < c.cooldown {
			continue
		}
		st.lastFired = newest
		m.fired++
		fired = append(fired, m.fire(c, ev, dest, port, len(st.times), mean, cv, st.simulated))
	}
	m.mu.Unlock()
	// Deliver OUTSIDE mu (the accumulated O1, acta 22h46 §1.4): the
	// pipeline takes the hub lock and can block on SQLite, webhook and
	// risk — holding beacon.mu through it made every /api/stats read
	// (Tracked/Fired) queue behind delivery. Detection decisions and
	// their state mutations stay atomic under mu; only delivery moves
	// out. A single Observe emits its own firings in detection order and
	// the engine observes from one goroutine, so delivery order on every
	// real path is unchanged. emit was captured under mu, so SetEmit
	// stays race-free.
	for _, a := range fired {
		if emit != nil {
			emit(a)
		}
	}
}

// reclaimLocked frees one state slot: fully stale keys (no in-window
// evidence) go first in one pass; if none are stale the WEAKEST live
// key is evicted — fewest accumulated samples, tie-break oldest newest
// connection, then deterministic key order. Caller holds mu.
//
// Why fewest-samples: a hostile flood of unique destinations carries
// exactly one sample per key, so under count-first eviction the flood
// only ever consumes itself. Evicting by recency instead (the first
// draft) let one second of flood wash out a beaconing host that had
// merely paused — precisely the live-evidence-destroying failure the
// A1 review pinned for risk scores.
func (m *Manager) reclaimLocked(c *compiled, now time.Time) {
	byID := make(map[string]*compiled, len(m.profs))
	for _, pc := range m.profs {
		byID[pc.p.ID] = pc
	}
	// pass 1: drop every fully stale key (last connection older than
	// twice its window — generous margin so a beacon that pauses for
	// one window and resumes does not lose its ring mid-flight)
	for k, st := range m.state {
		pc := byID[k.profileID]
		if pc == nil || len(st.times) == 0 {
			delete(m.state, k) // orphaned or empty: dead weight
			continue
		}
		if now.Sub(st.seen) > 2*pc.window {
			delete(m.state, k)
		}
	}
	if len(m.state) < MaxKeys {
		return
	}
	// pass 2: evict the weakest live key (fewest samples, then oldest,
	// then key order for determinism)
	var victim beaconKey
	victimN, victimTime := -1, time.Time{}
	found := false
	for k, st := range m.state {
		n := len(st.times)
		t := st.times[n-1]
		if !found || n < victimN ||
			(n == victimN && t.Before(victimTime)) ||
			(n == victimN && t.Equal(victimTime) && lessKey(k, victim)) {
			victim, victimN, victimTime, found = k, n, t, true
		}
	}
	if found {
		delete(m.state, victim)
	}
}

// lessKey orders keys deterministically (profileID, host, dest, port).
func lessKey(a, b beaconKey) bool {
	if a.profileID != b.profileID {
		return a.profileID < b.profileID
	}
	if a.host != b.host {
		return a.host < b.host
	}
	if a.dest != b.dest {
		return a.dest < b.dest
	}
	return a.port < b.port
}

// regularity computes the mean inter-arrival interval and its
// coefficient of variation over the ring. ok is false with fewer
// than two intervals (nothing meaningful to spread) or a non-positive
// interval (zero/duplicated timestamps).
func regularity(times []time.Time) (mean time.Duration, cv float64, ok bool) {
	n := len(times)
	if n < 3 {
		return 0, 0, false
	}
	var total time.Duration
	for i := 1; i < n; i++ {
		d := times[i].Sub(times[i-1])
		if d <= 0 {
			return 0, 0, false
		}
		total += d
	}
	mean = total / time.Duration(n-1)
	if mean <= 0 {
		return 0, 0, false
	}
	m := mean.Seconds()
	var sumSq float64
	for i := 1; i < n; i++ {
		d := times[i].Sub(times[i-1]).Seconds()
		sumSq += (d - m) * (d - m)
	}
	sd := math.Sqrt(sumSq / float64(n-2))
	return mean, sd / m, true
}

// fire builds the beacon alert for one detection. simulated carries
// the key's simulated flag (any contributing connection tagged as
// detection validation): the alert is tagged in turn. Caller holds mu;
// the returned alert is delivered by Observe AFTER mu is released —
// the pipeline (RecordAlert) takes the hub lock and can block on
// SQLite, webhook and risk, and no stats read should queue behind
// that. With delivery outside mu there is no nested locking at all:
// the old "documented lock order" (detector.mu before hub.mu) is gone
// because the two locks are never held together.
func (m *Manager) fire(c *compiled, ev *model.Event, dest string, port, count int, mean time.Duration, cv float64, simulated bool) alert.Alert {
	a := alert.Alert{
		Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
		RuleID:    c.p.ID,
		RuleName:  c.p.Name,
		Severity:  c.p.Severity,
		Host:      ev.Host,
		User:      ev.User,
		EventID:   ev.ID,
		EventType: ev.Type,
		Summary: fmt.Sprintf("beacon hacia %s:%d: %d conexiones cada ~%s (jitter %.2f) en la ventana %s",
			dest, port, count, mean.Round(10*time.Millisecond), cv, c.p.Window),
		MatchedOn: []string{"destination", "interval", "jitter"},
		Tags:      c.p.Tags,
		Enrich:    ev.Enrichment,
	}
	if simulated {
		alert.MarkSimulated(&a)
	}
	return a
}

// load parses and compiles every profile in the file. Malformed
// configuration fails LOUDLY: the engine treats a beacon file it
// cannot parse as a startup-fatal config error (the suppressions and
// sequences standard — a detector the operator believes is armed must
// not silently stay off).
func (m *Manager) load(path string) error {
	info, err := os.Stat(path)
	if err != nil {
		return err
	}
	if info.Size() > maxFileBytes {
		return fmt.Errorf("%s: file is %d bytes, over the %d byte cap", path, info.Size(), maxFileBytes)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	if err := yamlcheck.Guard(path, data); err != nil {
		return err
	}
	var profs []Profile
	if err := yaml.Unmarshal(data, &profs); err != nil {
		return fmt.Errorf("%s: %w", path, err)
	}
	if len(profs) > MaxProfiles {
		return fmt.Errorf("%s: %d profiles, over the cap of %d", path, len(profs), MaxProfiles)
	}
	cs := make([]*compiled, 0, len(profs))
	seen := map[string]bool{}
	for i := range profs {
		c, err := compileProfile(&profs[i])
		if err != nil {
			return fmt.Errorf("%s: perfil %d (%q): %w", path, i, profs[i].Name, err)
		}
		if seen[c.p.ID] {
			return fmt.Errorf("%s: id de perfil duplicado %q", path, c.p.ID)
		}
		seen[c.p.ID] = true
		cs = append(cs, c)
	}
	m.profs = cs
	return nil
}

func compileProfile(p *Profile) (*compiled, error) {
	if p.Name == "" {
		return nil, fmt.Errorf("falta name")
	}
	if p.ID == "" {
		return nil, fmt.Errorf("falta id")
	}
	switch p.Severity {
	case rules.SevInfo, rules.SevLow, rules.SevMedium, rules.SevHigh, rules.SevCritical:
	default:
		return nil, fmt.Errorf("severidad invalida %q", p.Severity)
	}
	window, err := time.ParseDuration(p.Window)
	if err != nil || window <= 0 {
		return nil, fmt.Errorf("window %q: debe ser una duracion positiva (ej. 15m)", p.Window)
	}
	if p.MinCount < 2 {
		return nil, fmt.Errorf("min_count %d: un beacon es por definicion repetido (minimo 2)", p.MinCount)
	}
	if p.MinCount > ringCap {
		return nil, fmt.Errorf("min_count %d: nunca podria dispararse con el anillo de %d muestras", p.MinCount, ringCap)
	}
	if p.MaxJitter <= 0 || p.MaxJitter > 1 {
		return nil, fmt.Errorf("max_jitter %g: debe estar en (0, 1] — el techo de CV del perfil", p.MaxJitter)
	}
	minInterval := time.Duration(0)
	if p.MinInterval != "" {
		minInterval, err = time.ParseDuration(p.MinInterval)
		if err != nil || minInterval < 0 {
			return nil, fmt.Errorf("min_interval %q: debe ser una duracion no negativa", p.MinInterval)
		}
	}
	// cooldown default = window: never refire a key more often than
	// its own window unless the operator asks for it explicitly.
	cooldown := window
	if p.Cooldown != "" {
		cooldown, err = time.ParseDuration(p.Cooldown)
		if err != nil || cooldown <= 0 {
			return nil, fmt.Errorf("cooldown %q: debe ser una duracion positiva", p.Cooldown)
		}
	}
	ports := map[int]bool{}
	for _, pt := range p.Ports {
		if pt < 1 || pt > 65535 {
			return nil, fmt.Errorf("puerto %d fuera de rango", pt)
		}
		ports[pt] = true
	}
	return &compiled{
		p:           *p,
		window:      window,
		minInterval: minInterval,
		cooldown:    cooldown,
		ports:       ports,
	}, nil
}
