package correlate

import (
	"sort"
	"time"
)

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
	Steps         []string // step labels in declared order ("a | b" for alternatives; order is display-only)
	StepRules     [][]string
	Scope         string
	MinHosts      int
}

// Snapshot returns the currently loaded sequences, sorted by ID,
// hot-reload aware. The copies are shallow but detached from the
// manager state: callers may hold them past a Reload safely.
func (m *Manager) Snapshot() []SequenceInfo {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]SequenceInfo, 0, len(m.seqs))
	for _, c := range m.seqs {
		steps := make([]string, 0, len(c.steps))
		stepRules := make([][]string, 0, len(c.steps))
		for _, names := range c.steps {
			steps = append(steps, stepLabel(names))
			stepRules = append(stepRules, append([]string(nil), names...))
		}
		out = append(out, SequenceInfo{
			ID:            c.seq.ID,
			Name:          c.seq.Name,
			Description:   c.seq.Description,
			Severity:      c.seq.Severity,
			WindowSeconds: int(c.window / time.Second),
			Tags:          append([]string(nil), c.seq.Tags...),
			Steps:         steps,
			StepRules:     stepRules,
			Scope:         c.scope,
			MinHosts:      c.minHosts,
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
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
		for _, names := range c.steps {
			for _, name := range names {
				if known[name] || seen[name] {
					continue
				}
				seen[name] = true
				missing = append(missing, name)
			}
		}
	}
	sort.Strings(missing)
	return missing
}
