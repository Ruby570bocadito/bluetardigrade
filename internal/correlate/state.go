package correlate

import (
	"time"
)

// state is one in-flight (sequence, entity) chain.
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
	// hosts the chain touched (lowercase, bounded by maxMinHosts):
	// user-scoped chains complete only once they span MinHosts of them
	hosts map[string]string
	// simulated is set as soon as any contributing event carries the
	// simulation tag (detection validation, SIM-1): the completed
	// chain alert is tagged in turn, so a replay on a lab engine can
	// never be mistaken for real evidence.
	simulated bool
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

// stateKey identifies one in-flight chain. A struct, not the old
// "seqID|host" string concatenation: a feed-controlled host containing
// '|' could alias two (sequence, host) pairs onto the same entry and
// merge progress across sequences. Hosts are lowercased for the same
// reason suppress.Manager lowercases them — Windows reports hostnames
// in arbitrary case, and one machine must own one chain regardless of
// which case the sensor emitted today.
type stateKey struct {
	seqID string
	host  string // lowercased host, or "user:"+lowercased account for user scope
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
