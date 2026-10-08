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
//
// File layout, one responsibility per file (POL-1, behavior-preserving
// split of the former single correlate.go): sequence.go holds the YAML
// model, its load-time hardening caps and the compiler; state.go holds
// the in-flight (sequence, entity) state and its reclamation; observe.go
// holds the per-rule-hit hot path and alert building; inspect.go holds
// the read-only views the API serves. This file keeps the Manager
// itself and its lifecycle.
package correlate

import (
        "sync"
        "time"

        "github.com/Ruby570bocadito/bluetardigrade/internal/alert"
)

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
        // read the shared state pointer and the emit callback UNDER m.mu
        // (audit 5.3): both are replaced/read by Observe and the reload
        // ticker; wiring made the race latent, not absent. The shared
        // map itself stays shared by design (in-flight progress), the
        // load below only touches fresh.profs.
        m.mu.Lock()
        sharedState, emit := m.state, m.emit
        m.mu.Unlock()
        fresh := &Manager{state: sharedState, emit: emit}
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

// SetEmit wires (or rewires) the completion callback, so main can
// validate the sequences directory before the alert manager exists.
func (m *Manager) SetEmit(emit func(alert.Alert)) {
        m.mu.Lock()
        defer m.mu.Unlock()
        m.emit = emit
}
