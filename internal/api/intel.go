package api

// GET /api/intel: the offline threat-intelligence lists the engine
// matches events against (internal/intel) and the state of the per-host
// baseline of processes (internal/baseline). Read-only: lists are files
// the operator places in the intel directory; the engine downloads
// nothing.

import (
	"net/http"
	"strings"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/baseline"
	"github.com/Ruby570bocadito/bluetardigrade/internal/intel"
)

// SetIntel points the hub at the engine's threat-intel matcher.
func (h *Hub) SetIntel(m *intel.Matcher) {
	h.mu.Lock()
	h.intel = m
	h.mu.Unlock()
}

// SetBaseline points the hub at the engine's per-host baseline.
func (h *Hub) SetBaseline(b *baseline.Tracker) {
	h.mu.Lock()
	h.baseline = b
	h.mu.Unlock()
}

type baselinePayload struct {
	Enabled  bool `json:"enabled"`
	LearnS   int  `json:"learn_s"`
	Hosts    int  `json:"hosts"`
	Learning int  `json:"learning"`
}

type intelPayload struct {
	// Enabled is false when the engine runs without an intel directory.
	Enabled  bool            `json:"enabled"`
	Dir      string          `json:"dir"`
	Total    int             `json:"total"`
	Lists    []intel.List    `json:"lists"`
	Baseline baselinePayload `json:"baseline"`
}

func (h *Hub) handleIntel(w http.ResponseWriter, _ *http.Request) {
	h.mu.Lock()
	m, b := h.intel, h.baseline
	h.mu.Unlock()
	out := intelPayload{Lists: []intel.List{}}
	if m != nil {
		out.Enabled = true
		out.Dir = m.Dir()
		out.Total = m.Total()
		out.Lists = m.Lists()
	}
	if b != nil {
		out.Baseline.LearnS = int(b.Learning() / time.Second)
		out.Baseline.Enabled = out.Baseline.LearnS > 0
		out.Baseline.Hosts, out.Baseline.Learning = b.Stats(time.Now())
	}
	writeJSON(w, out)
}

// GET /api/baseline?host=NAME: what the per-host process baseline knows
// about one machine (learning window and the process names it treats
// as normal), for the host page of the console.

type baselineHostPayload struct {
	Enabled       bool       `json:"enabled"`
	LearnS        int        `json:"learn_s"`
	Host          string     `json:"host"`
	Known         bool       `json:"known"`
	FirstSeen     *time.Time `json:"first_seen,omitempty"`
	Learning      bool       `json:"learning"`
	LearningUntil *time.Time `json:"learning_until,omitempty"`
	Processes     []string   `json:"processes"`
	Full          bool       `json:"full"`
}

func (h *Hub) handleBaselineHost(w http.ResponseWriter, r *http.Request) {
	host := strings.TrimSpace(r.URL.Query().Get("host"))
	if host == "" || len(host) > 255 {
		writeErr(w, http.StatusBadRequest, "host query parameter required (at most 255 bytes)")
		return
	}
	h.mu.Lock()
	b := h.baseline
	h.mu.Unlock()
	out := baselineHostPayload{Host: strings.ToLower(host), Processes: []string{}}
	if b != nil {
		out.LearnS = int(b.Learning() / time.Second)
		out.Enabled = out.LearnS > 0
		now := time.Now()
		if v, ok := b.Host(host, now); ok {
			out.Known = true
			first := v.FirstSeen.UTC()
			out.FirstSeen = &first
			out.Learning = v.Learning
			if !v.LearnedAt.IsZero() {
				until := v.LearnedAt.UTC()
				out.LearningUntil = &until
			}
			if v.Processes != nil {
				out.Processes = v.Processes
			}
			out.Full = v.Full
		}
	}
	writeJSON(w, out)
}
