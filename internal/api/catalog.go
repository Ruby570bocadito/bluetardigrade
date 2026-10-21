package api

import (
	"net/http"
	"sort"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/suppress"
)

type conditionPayload struct {
	Field    string `json:"field"`
	Operator string `json:"operator"`
	Value    any    `json:"value"`
}

type rulePayload struct {
	ID          string             `json:"id"`
	Name        string             `json:"name"`
	Description string             `json:"description"`
	Severity    string             `json:"severity"`
	EventType   string             `json:"event_type"`
	Mitre       string             `json:"mitre"`
	Tactic      string             `json:"tactic"`
	Tags        []string           `json:"tags"`
	Conditions  []conditionPayload `json:"conditions"`
}

func (h *Hub) handleRules(w http.ResponseWriter, _ *http.Request) {
	h.mu.Lock()
	re := h.rules
	h.mu.Unlock()
	out := []rulePayload{}
	if re != nil {
		for _, r := range re.Snapshot() {
			mitre, tactic := mitreAndTactic(r.Tags)
			conds := make([]conditionPayload, 0, len(r.Conditions))
			for _, c := range r.Conditions {
				conds = append(conds, conditionPayload{Field: c.Field, Operator: c.Operator, Value: c.Value})
			}
			out = append(out, rulePayload{
				ID: r.ID, Name: r.Name, Description: r.Description,
				Severity: r.Severity, EventType: r.EventType,
				Mitre: mitre, Tactic: tactic, Tags: r.Tags, Conditions: conds,
			})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	writeJSON(w, out)
}

// handleSuppressions lists the operator allowlist as it stands right
// now (expired entries excluded). Read-only: entries are edited in the
// suppressions.yaml file and hot-reloaded by the engine.
func (h *Hub) handleSuppressions(w http.ResponseWriter, r *http.Request) {
	h.mu.Lock()
	sup := h.suppress
	h.mu.Unlock()
	if sup == nil {
		writeJSON(w, suppressPayload{Entries: []suppress.Entry{}})
		return
	}
	writeJSON(w, scopedSuppressions(scopeFrom(r), sup, time.Now()))
}

type suppressPayload struct {
	Active  int              `json:"active"`
	Entries []suppress.Entry `json:"entries"`
}

type sequencePayload struct {
	ID            string   `json:"id"`
	Name          string   `json:"name"`
	Description   string   `json:"description"`
	Severity      string   `json:"severity"`
	WindowSeconds int      `json:"window_seconds"`
	Tags          []string `json:"tags"`
	Steps         []string `json:"steps"`
	// StepRules lists the rules that advance each step (alternatives).
	StepRules [][]string `json:"step_rules"`
	// Scope is "host" or "user" (one account followed across hosts);
	// MinHosts is how many distinct hosts the chain must span.
	Scope    string `json:"scope"`
	MinHosts int    `json:"min_hosts"`
}

// handleSequences lists the kill-chain sequences as loaded right now
// (hot-reload aware, sorted by id). Read-only: sequences are edited in
// the sequences/ YAML files the engine hot-reloads every 15 s. A nil
// manager (no sequences/ directory) yields an empty list so consumers
// see "correlator off" instead of a 404.
func (h *Hub) handleSequences(w http.ResponseWriter, _ *http.Request) {
	h.mu.Lock()
	m := h.sequences
	h.mu.Unlock()
	out := []sequencePayload{}
	if m != nil {
		for _, s := range m.Snapshot() {
			out = append(out, sequencePayload{
				ID: s.ID, Name: s.Name, Description: s.Description,
				Severity: s.Severity, WindowSeconds: s.WindowSeconds,
				Tags: s.Tags, Steps: s.Steps,
				StepRules: s.StepRules, Scope: s.Scope, MinHosts: s.MinHosts,
			})
		}
	}
	writeJSON(w, out)
}
