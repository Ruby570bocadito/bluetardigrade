package report

import (
	"sort"
	"strconv"
	"time"
)

// Executive is the REP-1 executive summary: one page of what the SOC
// would say in a weekly review, computed from the window's alerts (and
// their triage overlay), the incident store and the fleet snapshot.
type Executive struct {
	Kind         string    `json:"kind"`          // "executive"
	GeneratedAt  time.Time `json:"generated_at"`  // UTC
	Window       Window    `json:"window"`        // requested range
	Source       string    `json:"source"`        // store | ring
	Truncated    bool      `json:"truncated"`     // alert scan hit its cap (store mode)
	OldestRecord string    `json:"oldest_record"` // RFC 3339; empty in store mode — ring coverage honesty

	AlertsTotal   int            `json:"alerts_total"`
	BySeverity    map[string]int `json:"by_severity"`    // info..critical, only non-zero keys
	ByStatus      map[string]int `json:"by_status"`      // new | acknowledged | closed
	ByTactic      map[string]int `json:"by_tactic"`      // ATT&CK tactic label, only non-zero keys
	HostsAffected int            `json:"hosts_affected"` // distinct hosts that raised an alert
	TopRules      []RuleCount    `json:"top_rules"`      // 5 most frequent rules of the window
	Incidents     IncidentTotals `json:"incidents"`      // opened/closed in window and open now
	Fleet         FleetTotals    `json:"fleet"`          // snapshot at generation time
}

// RuleCount is one row of TopRules.
type RuleCount struct {
	RuleID   string `json:"rule_id"`
	RuleName string `json:"rule_name"`
	Count    int    `json:"count"`
}

// IncidentTotals counts incident-store activity. Opened/closed look at
// the window (CreatedAt/ClosedAt); Open is the live count right now.
type IncidentTotals struct {
	OpenedInWindow int  `json:"opened_in_window"`
	ClosedInWindow int  `json:"closed_in_window"`
	Open           int  `json:"open"`
	Persistent     bool `json:"persistent"`
}

// FleetTotals is the fleet snapshot the report was generated with.
// Enabled false means the engine runs without a fleet tracker: the
// consumer must not render coverage numbers from zeros.
type FleetTotals struct {
	Enabled bool `json:"enabled"`
	Total   int  `json:"total"`
	Online  int  `json:"online"`
	Silent  int  `json:"silent"`
	Idle    int  `json:"idle"`
}

// ExecutiveInputs carries everything BuildExecutive reads. Alerts must
// already be windowed and carry their triage overlay; incidents is the
// full incident list (the store caps it at 2000, cheap to scan).
type ExecutiveInputs struct {
	Alerts          []AlertInput
	Truncated       bool
	OldestRecord    string
	Source          string
	Incidents       []IncidentTimes
	IncidentOpen    int
	IncidentPersist bool
	FleetEnabled    bool
	FleetHosts      []FleetHostInput
}

// IncidentTimes is the slice of an incident the executive summary
// needs; the API layer maps it from incident.Incident.
type IncidentTimes struct {
	CreatedAt string `json:"created_at"`
	ClosedAt  string `json:"closed_at,omitempty"`
}

// BuildExecutive aggregates the window's alerts and the live stores
// into the summary. Alerts are re-checked against the window (a
// builder must not silently trust its caller with membership), so an
// unreadable or out-of-window timestamp stays out of every count.
// Severity and tactic keys only appear when non-zero so the console
// never renders empty wedges; ordering (top rules, CSV rows) is
// deterministic.
func BuildExecutive(in ExecutiveInputs, w Window, generated time.Time) Executive {
	e := Executive{
		Kind:         KindExecutive,
		GeneratedAt:  generated.UTC(),
		Window:       w,
		Source:       in.Source,
		Truncated:    in.Truncated,
		OldestRecord: in.OldestRecord,
		BySeverity:   map[string]int{},
		ByStatus:     map[string]int{},
		ByTactic:     map[string]int{},
	}
	hosts := map[string]bool{}
	rules := map[string]*RuleCount{}
	for _, a := range in.Alerts {
		ts, ok := a.Time()
		if !ok || ts.Before(w.From) || ts.After(w.Until) {
			continue
		}
		e.AlertsTotal++
		if a.Severity != "" {
			e.BySeverity[a.Severity]++
		}
		e.ByStatus[a.Status]++
		if t := tacticOf(a.Tags); t != "" {
			e.ByTactic[t]++
		}
		if a.Host != "" {
			hosts[a.Host] = true
		}
		if a.RuleID != "" {
			rc, ok := rules[a.RuleID]
			if !ok {
				rc = &RuleCount{RuleID: a.RuleID, RuleName: a.RuleName}
				rules[a.RuleID] = rc
			}
			rc.Count++
		}
	}
	e.HostsAffected = len(hosts)
	e.TopRules = topRules(rules, 5)

	until, from := w.Until, w.From
	for _, inc := range in.Incidents {
		if t, err := time.Parse(time.RFC3339Nano, inc.CreatedAt); err == nil && !t.Before(from) && t.Before(until) {
			e.Incidents.OpenedInWindow++
		}
		if inc.ClosedAt != "" {
			if t, err := time.Parse(time.RFC3339Nano, inc.ClosedAt); err == nil && !t.Before(from) && t.Before(until) {
				e.Incidents.ClosedInWindow++
			}
		}
	}
	e.Incidents.Open = in.IncidentOpen
	e.Incidents.Persistent = in.IncidentPersist

	e.Fleet.Enabled = in.FleetEnabled
	e.Fleet.Total = len(in.FleetHosts)
	for _, h := range in.FleetHosts {
		switch h.Status {
		case "online":
			e.Fleet.Online++
		case "silent":
			e.Fleet.Silent++
		default:
			e.Fleet.Idle++
		}
	}
	return e
}

// topRules returns the n most frequent rules, count desc then id asc.
func topRules(rules map[string]*RuleCount, n int) []RuleCount {
	out := make([]RuleCount, 0, len(rules))
	for _, rc := range rules {
		out = append(out, *rc)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Count != out[j].Count {
			return out[i].Count > out[j].Count
		}
		return out[i].RuleID < out[j].RuleID
	})
	if len(out) > n {
		out = out[:n]
	}
	return out
}

// CSV flattens the summary: one metric per row, the shape a
// spreadsheet pastes without preprocessing. Deterministic order.
func (e Executive) CSV() Tabular {
	rows := [][]string{
		{"alerts_total", strconv.Itoa(e.AlertsTotal)},
		{"hosts_affected", strconv.Itoa(e.HostsAffected)},
	}
	severities := []string{"info", "low", "medium", "high", "critical"}
	for _, sev := range severities {
		if n := e.BySeverity[sev]; n > 0 {
			rows = append(rows, []string{"alerts_severity_" + sev, strconv.Itoa(n)})
		}
	}
	for _, st := range []string{"new", "acknowledged", "closed"} {
		if n := e.ByStatus[st]; n > 0 {
			rows = append(rows, []string{"alerts_status_" + st, strconv.Itoa(n)})
		}
	}
	tactics := make([]string, 0, len(e.ByTactic))
	for t := range e.ByTactic {
		tactics = append(tactics, t)
	}
	sort.Strings(tactics)
	for _, t := range tactics {
		rows = append(rows, []string{"alerts_tactic_" + t, strconv.Itoa(e.ByTactic[t])})
	}
	for i, rc := range e.TopRules {
		rows = append(rows,
			[]string{"top_rule_" + strconv.Itoa(i+1) + "_id", rc.RuleID},
			[]string{"top_rule_" + strconv.Itoa(i+1) + "_name", rc.RuleName},
			[]string{"top_rule_" + strconv.Itoa(i+1) + "_count", strconv.Itoa(rc.Count)},
		)
	}
	rows = append(rows,
		[]string{"incidents_opened_in_window", strconv.Itoa(e.Incidents.OpenedInWindow)},
		[]string{"incidents_closed_in_window", strconv.Itoa(e.Incidents.ClosedInWindow)},
		[]string{"incidents_open", strconv.Itoa(e.Incidents.Open)},
		[]string{"fleet_enabled", strconv.FormatBool(e.Fleet.Enabled)},
		[]string{"fleet_total", strconv.Itoa(e.Fleet.Total)},
		[]string{"fleet_online", strconv.Itoa(e.Fleet.Online)},
		[]string{"fleet_silent", strconv.Itoa(e.Fleet.Silent)},
		[]string{"fleet_idle", strconv.Itoa(e.Fleet.Idle)},
		[]string{"window_preset", e.Window.Preset},
		[]string{"source", e.Source},
	)
	return Tabular{Header: []string{"metric", "value"}, Rows: rows}
}
