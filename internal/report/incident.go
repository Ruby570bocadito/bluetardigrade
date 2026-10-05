package report

import (
	"strconv"
	"time"
)

// IncidentReport bundles one investigation case for REP-1: the
// incident record as the incidents store serves it, its timeline, and
// every alert it groups with the triage state as of generation time.
type IncidentReport struct {
	Kind        string          `json:"kind"`         // "incident"
	GeneratedAt time.Time       `json:"generated_at"` // UTC
	Incident    IncidentCase    `json:"incident"`     // the stored case, verbatim
	Alerts      []IncidentAlert `json:"alerts"`       // one row per grouped alert id
	Timeline    []IncidentEntry `json:"timeline"`     // the case timeline, verbatim
}

// IncidentCase mirrors incident.Incident on the wire. Declared here
// (instead of importing the type) so the report contract stays stable
// even if the incidents store grows fields — the API layer maps it.
type IncidentCase struct {
	ID        string   `json:"id"`
	Title     string   `json:"title"`
	Summary   string   `json:"summary,omitempty"`
	Severity  string   `json:"severity"`
	Status    string   `json:"status"`
	Owner     string   `json:"owner,omitempty"`
	Hosts     []string `json:"hosts"`
	CreatedAt string   `json:"created_at"`
	UpdatedAt string   `json:"updated_at"`
	ClosedAt  string   `json:"closed_at,omitempty"`
}

// IncidentEntry is one timeline line of the case.
type IncidentEntry struct {
	At   string `json:"at"`
	By   string `json:"by,omitempty"`
	Kind string `json:"kind"`
	Text string `json:"text"`
}

// IncidentAlert is one alert of the case with its triage overlay.
// Found false means the alert is no longer resolvable (ring eviction
// without a store, or retention pruning): the id stays listed — the
// case history never hides what it grouped — and the consumer renders
// it as unavailable instead of inventing content.
type IncidentAlert struct {
	AlertInput
	Found bool `json:"found"`
}

// IncidentInputs carries the case plus the alert rows the API layer
// resolved (in the order the case lists them).
type IncidentInputs struct {
	Case     IncidentCase
	Timeline []IncidentEntry
	Alerts   []IncidentAlert
}

// BuildIncident assembles the bundle. No filtering: an incident report
// is the case as it stands, and the window does not apply (the API
// rejects a window for this kind).
func BuildIncident(in IncidentInputs, generated time.Time) IncidentReport {
	alerts := in.Alerts
	if alerts == nil {
		alerts = []IncidentAlert{}
	}
	return IncidentReport{
		Kind:        KindIncident,
		GeneratedAt: generated.UTC(),
		Incident:    in.Case,
		Alerts:      alerts,
		Timeline:    in.Timeline,
	}
}

// CSV flattens the case: one row per grouped alert (the tabular slice
// a spreadsheet wants); the timeline and the prose stay in the JSON.
func (r IncidentReport) CSV() Tabular {
	rows := make([][]string, 0, len(r.Alerts))
	for _, a := range r.Alerts {
		rows = append(rows, []string{
			a.ID,
			a.Timestamp,
			a.Severity,
			a.Host,
			a.Status,
			strconv.FormatBool(a.Found),
			a.RuleID,
			a.Summary,
		})
	}
	return Tabular{
		Header: []string{"alert_id", "timestamp", "severity", "host", "status", "found", "rule_id", "summary"},
		Rows:   rows,
	}
}
