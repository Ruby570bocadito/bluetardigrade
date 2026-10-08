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

	// MaxKeysPerHost is the per-host twin of MaxKeys (v1.1 cuotas
	// por equipo): the same admission ceiling per host, so one noisy
	// machine scanning unique destinations cannot fill the table the
	// others' beacons live in. Dead evidence is reclaimed before the
	// refusal, so a host whose keys all went stale recovers itself.
	reclaimEvery   = time.Second // rate limit for quota-path sweeps (sesión 100agentes-2)
	MaxKeysPerHost = MaxKeys / 4

	// ringCap caps the timestamps kept per key. 64 samples give a
	// solid CV estimate while capping per-key memory; min_count above
	// the ring could never fire, so profile validation rejects it
	// (a control that silently can never fire is a misconfig, not a
	// knob — the loud-failure standard).
	ringCap = 64
	// aliasMax bounds the IP->domain alias table (sesión
	// 100agentes-3, agente 52): a flood of unique IPs must not grow it
	// without limit — same lesson as MaxKeys.
	aliasMax = 4096
	// aliasTTL: an alias not refreshed for 10m is stale — DNS
	// re-resolutions rotate C2 IPs; a frozen mapping would pin hosts
	// to dead domains.
	aliasTTL = 10 * time.Minute

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
	// ExcludeDomains lists services whose keep-alives are regular by
	// design (a messaging app polling its server every minute). A
	// destination domain equal to an entry or under it is not tracked
	// by this profile. Connections known only by IP are never excluded.
	ExcludeDomains []string `yaml:"exclude_domains"`
}

// maxExcludeDomains bounds the exclusion list of one profile: it is
// walked for every connection.
const maxExcludeDomains = 256

type compiled struct {
	p           Profile
	window      time.Duration
	minInterval time.Duration
	cooldown    time.Duration
	ports       map[int]bool
	excluded    []string // lowercased domains, without "*." or a trailing dot
	// excludedSuf mirrors excluded as ".<domain>" so excludes()
	// never concatenates per event (sesion 100agentes-3, agente 34
	// H4: techo 64x256 dominios = ~16k allocs/evento).
	excludedSuf []string
}

// excludes reports whether domain is one of the profile's excluded
// services or a subdomain of one.
func (c *compiled) excludes(domain string) bool {
	for _, d := range c.excluded {
		if domain == d {
			return true
		}
	}
	for _, s := range c.excludedSuf {
		if strings.HasSuffix(domain, s) {
			return true
		}
	}
	return false
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

// aliasEntry is one IP->domain mapping (sesión 100agentes-3): the
// ETW sensor and Sysmon DNS memory report the same C2 as
// domain+IP (connect after resolution) or IP only (E3) — the alias
// merges both into ONE beacon key instead of splitting the evidence.
type aliasEntry struct {
	domain string // lowercased, trailing dot trimmed
	seen   time.Time
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
	// perHost is the per-host share tally of the key table (v1.1
	// cuotas por equipo) -- see MaxKeysPerHost.
	perHost       map[string]int
	quotaRejected uint64                // host-quota refusals since startup
	sampledEvict  uint64                // sampled evictions under a full table (rate-limited reclaim, agente 34 H1)
	quotaHosts    map[string]uint64     // refusal tally by host, capped
	alias         map[string]aliasEntry // canonical IP -> last DNS domain seen with it (agente 52)
	emit          func(alert.Alert)
	fired         uint64
	// lastReclaim rate-limits the quota-path reclaim sweep (sesión
	// 100agentes-2, agente 19): un host en su cuota pagaba un
	// reclaim O(MaxKeys=8192) + rebuild de byID POR EVENTO — un
	// escáner con destinos únicos sostenidos convertía la cuota en
	// un hotspot de CPU.
	lastReclaim time.Time
}

// LoadFile compiles the profiles in one YAML file. emit is called
// once per detected beacon (wire it to alert.Manager.Emit through the
// suppression wrapper, exactly like the correlator's).
func LoadFile(path string, emit func(alert.Alert)) (*Manager, error) {
	m := &Manager{state: map[beaconKey]*keyState{}, alias: map[string]aliasEntry{}, emit: emit, perHost: map[string]int{}, quotaHosts: map[string]uint64{}}
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
	// read the emit callback UNDER m.mu (audit 5.3): Observe runs on
	// the ingest path and touches the same field; the race was
	// latent in the current wiring, not absent.
	m.mu.Lock()
	emit := m.emit
	m.mu.Unlock()
	fresh := &Manager{state: map[beaconKey]*keyState{}, emit: emit, perHost: map[string]int{}, quotaHosts: map[string]uint64{}}
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
			m.dropStateLocked(k)
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

// SampledEvictions counts the bounded-sample evictions done under a
// full table between reclaim sweeps (sesion 100agentes-3): the total
// pressure a destination flood put on the key table.
func (m *Manager) SampledEvictions() uint64 {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.sampledEvict
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
	// The Windows DNS Client service (svchost.exe) resolves names for
	// every process and talks to the configured resolver on 53/853 at
	// a steady pace (TCP retries, keep-alives): the host's own DNS
	// plumbing. DNS tunnels show in the DNS query events instead, and a
	// process that talks to port 53 itself is still tracked.
	if (n.DestinationPort == 53 || n.DestinationPort == 853) && ev.Process != nil && strings.EqualFold(ev.Process.Name, "svchost.exe") {
		return
	}
	// Trailing dot: an FQDN form of the same host ("evil.com.")
	// must not open a second key nor evade exclude_domains (sesion
	// 100agentes-3, agente 34 H2).
	dest := strings.TrimSuffix(strings.ToLower(n.Domain), ".")
	destFromIP := false
	if dest == "" {
		ip := net.ParseIP(strings.TrimSpace(n.DestinationIP))
		// loopback, link-local (the router's DNS on fe80::), multicast:
		// local plumbing, never a C2 destination
		if ip != nil && (ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsMulticast() || ip.IsUnspecified()) {
			return
		}
		if ip == nil {
			// Sysmon emits zone-ids ("fe80::1%12") and transport junk
			// reaches Network fields: an unparseable destination is
			// not a beacon signal and must not skip the plumbing
			// filter above by falling through as a raw key (agente
			// 34 H3).
			return
		}
		// Canonical form: "::ffff:93.184.216.34" and "93.184.216.34"
		// are the same C2 and share one key (agente 34 H2; the
		// CHANGELOG documents Sysmon emitting the mapped form).
		dest = strings.ToLower(ip.String())
		destFromIP = true
	}
	if dest == "" {
		return
	}
	port := n.DestinationPort
	host := strings.ToLower(ev.Host)
	t := ev.DetectionTime(now)

	m.mu.Lock()
	emit := m.emit
	// Alias dominio/IP (sesión 100agentes-3, agente 52): un destino
	// conocido solo por IP hereda el dominio de la última resolución
	// DNS que lo trajo, así que el tráfico E3 (solo IP) y el ETW
	// (dominio + IP tras resolver) caen en la MISMA clave beacon en
	// vez de partir la evidencia de un mismo C2.
	aliasIP := ""
	destIsDomain := n.Domain != ""
	if destFromIP {
		if ae, ok := m.alias[dest]; ok && now.Sub(ae.seen) < aliasTTL {
			aliasIP, dest, destIsDomain = dest, ae.domain, true
		}
	} else if n.DestinationIP != "" {
		// dominio + IP tras resolver (Sysmon/ETW post-DNS): siembra el
		// alias IP->dominio para que el E3 posterior (solo IP) converja
		if ip := net.ParseIP(strings.TrimSpace(n.DestinationIP)); ip != nil &&
			!ip.IsLoopback() && !ip.IsLinkLocalUnicast() &&
			!ip.IsLinkLocalMulticast() && !ip.IsMulticast() && !ip.IsUnspecified() {
			m.observeAliasLocked(ip.String(), dest, now)
		}
	}
	var fired []alert.Alert
	for _, c := range m.profs {
		if len(c.ports) > 0 && !c.ports[port] {
			continue
		}
		if destIsDomain && c.excludes(dest) {
			continue
		}
		key := beaconKey{profileID: c.p.ID, host: host, dest: dest, port: port}
		st := m.state[key]
		if st == nil {
			// Host quota (v1.1 cuotas por equipo): the same admission
			// ceiling per host -- one noisy machine scanning unique
			// destinations cannot fill the table the others' beacons
			// live in. Reclaim runs first so a host whose keys all
			// went stale recovers itself instead of staying blocked.
			if m.perHost[host] >= MaxKeysPerHost {
				if now.Sub(m.lastReclaim) >= reclaimEvery {
					m.lastReclaim = now
					m.reclaimLocked(c, now)
				}
				if m.perHost[host] >= MaxKeysPerHost {
					m.quotaRejectLocked(host)
					continue
				}
			}
			// Admission past the cap: drop fully stale keys first
			// (they are dead evidence), then evict the coldest key.
			// A newly observed key is by definition the freshest --
			// it can never be its own eviction victim.
			// Cost control (sesion 100agentes-3, agente 34 H1): the
			// full reclaim runs rate-limited, and between sweeps a
			// SAMPLED weakest eviction (64 keys, same comparator)
			// frees the slot -- admission is never refused (the
			// hot-key bootstrap contract, pinned by
			// TestBoundsFloodEvictionKeepsHotKey) yet a full table
			// costs O(64) per event instead of O(MaxKeys).
			if len(m.state) >= MaxKeys {
				if now.Sub(m.lastReclaim) >= reclaimEvery {
					m.lastReclaim = now
					m.reclaimLocked(c, now)
				}
				if len(m.state) >= MaxKeys {
					m.evictWeakestSampledLocked()
				}
			}
			st = &keyState{}
			m.state[key] = st
			m.perHost[host]++
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
			// the restart discards the ring: the SIM tag dies with
			// it, or real traffic on the same key is suppressed as
			// simulated forever (sesion 100agentes-3, agente 34 H5)
			st.simulated = false
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
		fired = append(fired, m.fire(c, ev, dest, aliasIP, port, len(st.times), mean, cv, st.simulated))
	}
	m.mu.Unlock()
	// Deliver OUTSIDE mu (the accumulated O1): the
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
			m.dropStateLocked(k) // orphaned or empty: dead weight
			continue
		}
		if now.Sub(st.seen) > 2*pc.window {
			m.dropStateLocked(k)
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
		m.dropStateLocked(victim)
	}
}

// evictWeakestSampledLocked frees one slot by evicting the weakest
// key of a bounded map sample (64 entries, same comparator as
// reclaimLocked pass 2: fewest samples, then oldest, then key order).
// Admission must never be refused -- a beacon building evidence
// against a flood has to win its slot -- but a permanently full table
// must not pay a full-map scan per event (sesion 100agentes-3,
// agente 34 H1). Caller holds mu.
func (m *Manager) evictWeakestSampledLocked() {
	defer func() { m.sampledEvict++ }()
	var victim beaconKey
	victimN, victimTime := -1, time.Time{}
	found := false
	n := 0
	for k, st := range m.state {
		if n++; n > evictSample {
			break
		}
		s := len(st.times)
		t := st.times[s-1]
		if !found || s < victimN ||
			(s == victimN && t.Before(victimTime)) ||
			(s == victimN && t.Equal(victimTime) && lessKey(k, victim)) {
			victim, victimN, victimTime, found = k, s, t, true
		}
	}
	if found {
		m.dropStateLocked(victim)
	}
}

// dropStateLocked removes one key and keeps the per-host tally honest.
// Caller holds mu.
func (m *Manager) dropStateLocked(k beaconKey) {
	if _, ok := m.state[k]; !ok {
		return
	}
	delete(m.state, k)
	if m.perHost[k.host] <= 1 {
		delete(m.perHost, k.host)
	} else {
		m.perHost[k.host]--
	}
}

// observeAliasLocked records one IP->domain mapping under the alias
// cap: lazy sweep of expired entries first, oldest-seen eviction as
// the pressure fallback (same shape as the key table's reclaim).
// Caller holds mu.
func (m *Manager) observeAliasLocked(ip, domain string, now time.Time) {
	if len(m.alias) >= aliasMax {
		for a, ae := range m.alias {
			if now.Sub(ae.seen) >= aliasTTL {
				delete(m.alias, a)
			}
		}
	}
	if len(m.alias) >= aliasMax {
		oldestIP, oldestAt := "", now
		for a, ae := range m.alias {
			if ae.seen.Before(oldestAt) {
				oldestIP, oldestAt = a, ae.seen
			}
		}
		if oldestIP != "" {
			delete(m.alias, oldestIP)
		}
	}
	m.alias[ip] = aliasEntry{domain: domain, seen: now}
}

// maxQuotaHostEntries caps the refusal tally by host: honesty about
// WHICH host is being refused cannot itself become an unbounded map.
// Past the cap the total keeps counting every refusal; only the
// per-host attribution stops growing (threshold's convention).
// evictSample bounds the sampled eviction scan (agente 34 H1): a
// fixed slice of the key table is enough to find a near-weakest
// victim without paying O(MaxKeys) per event.
const evictSample = 64

const maxQuotaHostEntries = 64

// quotaRejectLocked counts one host-quota refusal (total + capped
// per-host tally). Caller holds mu.
func (m *Manager) quotaRejectLocked(host string) {
	m.quotaRejected++
	if _, ok := m.quotaHosts[host]; !ok && len(m.quotaHosts) >= maxQuotaHostEntries {
		return // tally full: the total still counts every refusal
	}
	m.quotaHosts[host]++
}

// QuotaHost is one host's row of the refusal tally (always served as
// a copy -- shared state leaves every read path as a copy).
type QuotaHost struct {
	Host     string
	Rejected uint64
}

// QuotaRejected returns how many NEW destination keys were refused
// because the HOST's own quota was full (v1.1 cuotas por equipo):
// the width of the noisy-host pressure on the shared table. Existing
// keys of the saturated host keep accumulating evidence and firing.
func (m *Manager) QuotaRejected() uint64 {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.quotaRejected
}

// QuotaHosts returns the capped per-host refusal tally as a copy:
// top-list merging is the API layer's job, so the manager serves the
// whole tally and stays out of presentation decisions.
func (m *Manager) QuotaHosts() map[string]uint64 {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make(map[string]uint64, len(m.quotaHosts))
	for h, n := range m.quotaHosts {
		out[h] = n
	}
	return out
}

// QuotaTopHosts returns the hosts with the most quota refusals, worst
// first, at most 8 rows, always a copy.
func (m *Manager) QuotaTopHosts() []QuotaHost {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]QuotaHost, 0, len(m.quotaHosts))
	for h, n := range m.quotaHosts {
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
// coefficient of variation over the ring. ok is false with fewer than
// two usable intervals (nothing meaningful to spread).
//
// Zero/negative intervals (duplicated or out-of-order timestamps —
// audit 5.3) are EXCLUDED from the computation instead of invalidating
// the whole ring: a single duplicated timestamp used to silence the
// evaluation of that key until the sample aged out of the window (up
// to 15 min of a blind spot). The beacon profile threshold still
// requires enough samples upstream, so excluding a degenerate interval
// only removes noise it would otherwise have amplified.
func regularity(times []time.Time) (mean time.Duration, cv float64, ok bool) {
	n := len(times)
	if n < 3 {
		return 0, 0, false
	}
	ds := make([]float64, 0, n-1)
	var total time.Duration
	for i := 1; i < n; i++ {
		d := times[i].Sub(times[i-1])
		if d <= 0 {
			continue // duplicated/reordered timestamp: skip, not fatal
		}
		ds = append(ds, d.Seconds())
		total += d
	}
	if len(ds) < 2 {
		return 0, 0, false
	}
	mean = total / time.Duration(len(ds))
	if mean <= 0 {
		return 0, 0, false
	}
	m := mean.Seconds()
	var sumSq float64
	for _, d := range ds {
		sumSq += (d - m) * (d - m)
	}
	sd := math.Sqrt(sumSq / float64(len(ds)-1))
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
func (m *Manager) fire(c *compiled, ev *model.Event, dest, aliasIP string, port, count int, mean time.Duration, cv float64, simulated bool) alert.Alert {
	aliasNote := ""
	if aliasIP != "" {
		aliasNote = fmt.Sprintf(" (alias %s)", aliasIP)
	}
	a := alert.Alert{
		Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
		RuleID:    c.p.ID,
		RuleName:  c.p.Name,
		Severity:  c.p.Severity,
		Host:      ev.Host,
		User:      ev.User,
		EventID:   ev.ID,
		EventType: ev.Type,
		Summary: fmt.Sprintf("beacon hacia %s:%d: %d conexiones cada ~%s (jitter %.2f) en la ventana %s%s",
			dest, port, count, mean.Round(10*time.Millisecond), cv, c.p.Window, aliasNote),
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
	if p.MinCount < 3 {
		// regularity() needs at least 3 samples (2 intervals) to compute
		// a coefficient of variation: min_count 2 would load armed and
		// never fire — the exact silent failure mode validation exists to
		// prevent.
		return nil, fmt.Errorf("min_count %d: un beacon necesita al menos 3 muestras para medir regularidad", p.MinCount)
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
	if len(p.ExcludeDomains) > maxExcludeDomains {
		return nil, fmt.Errorf("exclude_domains: %d dominios superan el maximo de %d", len(p.ExcludeDomains), maxExcludeDomains)
	}
	excluded := make([]string, 0, len(p.ExcludeDomains))
	for _, d := range p.ExcludeDomains {
		norm := strings.TrimSuffix(strings.TrimPrefix(strings.ToLower(strings.TrimSpace(d)), "*."), ".")
		if !validDomain(norm) {
			return nil, fmt.Errorf("exclude_domains: %q no es un dominio (ejemplo: whatsapp.com, que cubre tambien sus subdominios)", d)
		}
		excluded = append(excluded, norm)
	}
	excludedSuf := make([]string, 0, len(excluded))
	for _, norm := range excluded {
		excludedSuf = append(excludedSuf, "."+norm)
	}
	return &compiled{
		p:           *p,
		window:      window,
		minInterval: minInterval,
		cooldown:    cooldown,
		ports:       ports,
		excluded:    excluded,
		excludedSuf: excludedSuf,
	}, nil
}

// validDomain accepts a DNS name with at least two labels: letters,
// digits and hyphens, no empty label. A bare TLD ("com") would exclude
// half the internet and is refused.
func validDomain(d string) bool {
	if len(d) == 0 || len(d) > 253 || !strings.Contains(d, ".") {
		return false
	}
	for _, label := range strings.Split(d, ".") {
		if label == "" || len(label) > 63 {
			return false
		}
		for _, r := range label {
			if !(r == '-' || (r >= '0' && r <= '9') || (r >= 'a' && r <= 'z')) {
				return false
			}
		}
	}
	return true
}
