// Package risk maintains a per-host risk score from recent alerts,
// with exponential time decay. It is package A1 of the owner's
// roadmap (section 7A of the original design directive): "acumular puntos por alertas recientes con decaimiento
// temporal, KPI 'hosts calientes' en /api/stats + consola".
//
// Design notes:
//
//   - Scoring is deliberately simple and legible: every alert adds a
//     fixed weight per severity (critical 10, high 5, medium 2, low 1,
//     info 0) and every point decays with a 30-minute half-life. The
//     score answers one question — "which hosts are making noise that
//     LOOKS dangerous right now?" — not "which hosts are compromised".
//     It is a triage-prioritization signal, not a verdict.
//   - Triage status is deliberately ignored: a closed alert does not
//     refund points and an acknowledged one keeps contributing. The
//     score models detection activity (what the engine saw); the
//     lifecycle models operator judgment (what the human decided).
//     Coupling them would let a misclicked "close" rewrite history.
//   - State is bounded (MaxHosts), the lesson the correlator cap
//     already taught: a hostile feed inventing unique hostnames must
//     not grow the map without limit. Cold hosts (score below
//     epsilon) are pruned lazily; past the hard cap, the coldest
//     hosts are evicted first, so a flood of one-alert fake hosts
//     cannot wash out a genuinely hot one — eviction only removes
//     the least-risky entries.
//   - Every method takes `now` as a parameter: the tracker has no
//     clock of its own, so tests are deterministic and the API layer
//     owns the time source.
//   - Scores are rounded to 2 decimals at snapshot time for stable
//     wire output (float64 decay math would otherwise emit values
//     like 4.999999999 in JSON and trip exact-match consumers).
package risk

import (
	"math"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/rules"
)

// HalfLife is the time over which a host's score halves without new
// alerts. 30 minutes keeps a bursty host visible through a working
// session while letting last night's noise be gone by the morning
// shift (12 half-lives ≈ 3 remaining points of 10 after 6 hours).
const HalfLife = 30 * time.Minute

// MaxHosts bounds the tracked-host map. Beyond it the coldest hosts
// are evicted (see package comment). 4096 hosts covers every lab and
// mid-size fleet this engine targets; a real deployment exceeding it
// has outgrown the single-engine architecture, not the cap.
const MaxHosts = 4096

// epsilon is the score floor below which a host is considered cold
// and pruned. A single low-severity alert (1 point) falls under it
// after about 6.6 half-lives (~3.3 hours).
const epsilon = 0.01

// severityWeights maps rule severities to score points. The values
// are the display heuristics of the console too: 10 points is one
// critical alert, and the top of the scale is a handful of criticals.
// Unknown severities (rules are operator-authored YAML) get the low
// weight instead of zero: an alert that fired is evidence, whatever
// its label says, but it can never outrank a known severity.
var severityWeights = map[string]float64{
	rules.SevCritical: 10,
	rules.SevHigh:     5,
	rules.SevMedium:   2,
	rules.SevLow:      1,
	rules.SevInfo:     0,
}

// HostRisk is one host's decayed score, as served by /api/stats
// (hot_hosts) and rendered by the console dashboard.
type HostRisk struct {
	Host     string  `json:"host"`
	Score    float64 `json:"score"`
	Alerts   int     `json:"alerts"`
	LastSeen string  `json:"last_seen"` // RFC 3339 UTC of the most recent alert
}

type hostState struct {
	score    float64   // points, decayed lazily (valid as of lastSeen)
	alerts   int       // alerts counted for this host since (re)tracking
	lastSeen time.Time // timestamp the score is valid at
}

// Tracker accumulates per-host risk. Safe for concurrent use; all
// time-dependent behavior is driven by the `now` arguments.
type Tracker struct {
	mu    sync.Mutex
	hosts map[string]*hostState
}

// New returns an empty tracker.
func New() *Tracker {
	return &Tracker{hosts: map[string]*hostState{}}
}

// Observe records one alert for host at time now. Empty hosts are
// ignored: an alert without a host has nothing to attach risk to,
// and a shared "(unknown)" bucket would let unhosted alerts add up
// into a phantom hotspot.
//
// Host casing is normalized here (audit 5.3): threshold, correlate and
// beacon all compare hosts case-insensitively, so WKS-01 and wks-01
// must not split into two risk scores (the hot_hosts KPI counts real
// machines, not sensor spelling variants). The stored key is the
// normalized form, which is also what Snapshot reports.
func (t *Tracker) Observe(host, severity string, now time.Time) {
	if host == "" {
		return
	}
	host = strings.ToLower(host)
	w, known := severityWeights[severity]
	if !known {
		w = severityWeights[rules.SevLow]
	}

	t.mu.Lock()
	defer t.mu.Unlock()

	st, ok := t.hosts[host]
	if ok {
		st.score = decay(st, now) + w
		st.alerts++
		st.lastSeen = now
	} else {
		// Hard cap: before admitting a NEW host, make room by evicting
		// the coldest existing one (never the newcomer — an incoming
		// alert is by definition the freshest signal). This is what
		// stops a hostile telemetry feed with invented hostnames from
		// growing the map without bound.
		if len(t.hosts) >= MaxHosts {
			t.evictColdestLocked(now)
		}
		t.hosts[host] = &hostState{score: w, alerts: 1, lastSeen: now}
	}
}

// Snapshot returns up to topN hosts sorted by score (descending, ties
// broken by hostname for deterministic output), pruning cold hosts
// first. The returned slice is a copy: callers cannot mutate the
// tracker's state through it.
func (t *Tracker) Snapshot(now time.Time, topN int) []HostRisk {
	t.mu.Lock()
	defer t.mu.Unlock()

	t.pruneLocked(now)
	out := make([]HostRisk, 0, len(t.hosts))
	for host, st := range t.hosts {
		out = append(out, HostRisk{
			Host:     host,
			Score:    round2(decay(st, now)),
			Alerts:   st.alerts,
			LastSeen: st.lastSeen.UTC().Format(time.RFC3339Nano),
		})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Score != out[j].Score {
			return out[i].Score > out[j].Score
		}
		return out[i].Host < out[j].Host
	})
	if topN >= 0 && len(out) > topN {
		out = out[:topN]
	}
	return out
}

// Tracked returns how many hosts currently carry a non-cold score.
// Like Snapshot it prunes first, so the number only counts hosts the
// decay has not washed out yet.
func (t *Tracker) Tracked(now time.Time) int {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.pruneLocked(now)
	return len(t.hosts)
}

// evictColdestLocked drops the host with the lowest decayed score
// (ties: the lexicographically smaller hostname goes first, so the
// choice is stable). Caller holds t.mu and the map is non-empty.
func (t *Tracker) evictColdestLocked(now time.Time) {
	coldest := ""
	coldestScore := math.Inf(1)
	for host, st := range t.hosts {
		s := decay(st, now)
		if s < coldestScore || (s == coldestScore && host < coldest) {
			coldest, coldestScore = host, s
		}
	}
	if coldest != "" {
		delete(t.hosts, coldest)
	}
}

// pruneLocked deletes hosts whose decayed score fell below epsilon.
// Caller holds t.mu.
func (t *Tracker) pruneLocked(now time.Time) {
	for host, st := range t.hosts {
		if decay(st, now) < epsilon {
			delete(t.hosts, host)
		}
	}
}

// decay returns the state's score decayed to now. Callers hold t.mu.
func decay(st *hostState, now time.Time) float64 {
	elapsed := now.Sub(st.lastSeen)
	if elapsed <= 0 {
		return st.score
	}
	halflives := elapsed.Hours() / HalfLife.Hours()
	return st.score * math.Pow(0.5, halflives)
}

func round2(v float64) float64 {
	return math.Round(v*100) / 100
}
