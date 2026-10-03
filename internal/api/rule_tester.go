// Rule tester: POST /api/rules/test evaluates one event against the
// loaded rule set and reports which rules match, without ingesting it.
// Nothing is stored, alerted, correlated or forwarded; it is a dry run
// for writing and tuning detections. It is a POST only because the
// event travels in the body, so it sits behind the same bearer and
// same-origin write guards as every other POST.

package api

import (
	"encoding/json"
	"io"
	"net/http"
	"sort"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
)

// ruleTestMaxBodyBytes caps the tested event: room for a long command
// line and a few attributes, not a data channel.
const ruleTestMaxBodyBytes = 32 << 10

type ruleTestRequest struct {
	Event model.Event `json:"event"`
}

type ruleTestMatch struct {
	ID        string   `json:"id"`
	Name      string   `json:"name"`
	Severity  string   `json:"severity"`
	Mitre     string   `json:"mitre"`
	Tactic    string   `json:"tactic"`
	Tags      []string `json:"tags"`
	MatchedOn []string `json:"matched_on"`
}

type ruleTestResult struct {
	EventType string          `json:"event_type"`
	Evaluated int             `json:"evaluated"`
	Matches   []ruleTestMatch `json:"matches"`
}

func (h *Hub) handleRuleTest(w http.ResponseWriter, r *http.Request) {
	h.mu.Lock()
	re := h.rules
	h.mu.Unlock()
	if re == nil {
		writeErr(w, http.StatusServiceUnavailable, "no rule set loaded")
		return
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, ruleTestMaxBodyBytes))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "unreadable or oversized request body (32 KiB limit)")
		return
	}
	var req ruleTestRequest
	if err := json.Unmarshal(body, &req); err != nil {
		writeErr(w, http.StatusBadRequest, `invalid JSON body: want {"event": {"type": "process.create", ...}}`)
		return
	}
	ev := req.Event
	if ev.Type == "" {
		writeErr(w, http.StatusBadRequest, "event.type is required (e.g. process.create)")
		return
	}
	if ev.Timestamp.IsZero() {
		ev.Timestamp = time.Now().UTC()
	}
	if ev.ID == "" {
		ev.ID = "rule-test"
	}
	out := ruleTestResult{EventType: ev.Type, Matches: []ruleTestMatch{}}
	for _, rule := range re.Snapshot() {
		if rule.EventType == ev.Type && rule.IsEnabled() {
			out.Evaluated++
		}
	}
	for _, hit := range re.Evaluate(&ev) {
		mitre, tactic := mitreAndTactic(hit.Rule.Tags)
		out.Matches = append(out.Matches, ruleTestMatch{
			ID: hit.Rule.ID, Name: hit.Rule.Name, Severity: hit.Rule.Severity,
			Mitre: mitre, Tactic: tactic, Tags: hit.Rule.Tags, MatchedOn: hit.MatchedOn,
		})
	}
	sort.Slice(out.Matches, func(i, j int) bool { return out.Matches[i].Name < out.Matches[j].Name })
	writeJSON(w, out)
}
