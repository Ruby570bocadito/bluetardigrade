package report

import (
	"sort"
	"strconv"
	"time"
)

// FleetCoverage is the REP-1 coverage report: per-host inventory from
// the machine tracker with the events each host produced inside the
// window. Hosts without signal in the window are the actionable slice
// (a sensor down, a machine off, a machine silently removed).
type FleetCoverage struct {
	Kind        string       `json:"kind"`         // "fleet"
	GeneratedAt time.Time    `json:"generated_at"` // UTC
	Window      Window       `json:"window"`
	Source      string       `json:"source"`    // where the per-window event counts came from
	Truncated   bool         `json:"truncated"` // event scan hit its cap
	Enabled     bool         `json:"enabled"`   // false: engine runs without a fleet tracker
	Summary     FleetSummary `json:"summary"`
	Hosts       []FleetHost  `json:"hosts"`
}

// FleetSummary is the aggregate line of the coverage report.
type FleetSummary struct {
	Total            int `json:"total"`
	Online           int `json:"online"`
	Silent           int `json:"silent"`
	Idle             int `json:"idle"`
	NoSignalInWindow int `json:"no_signal_in_window"`
}

// FleetHost is one inventory row. Identity is the enrollment identity
// stamped on the host's events ("" when the host predates enrollment
// or the engine runs without the registry).
type FleetHost struct {
	Host           string    `json:"host"`
	Status         string    `json:"status"` // online | silent | idle
	FirstSeen      time.Time `json:"first_seen"`
	LastSeen       time.Time `json:"last_seen"`
	LastEventType  string    `json:"last_event_type,omitempty"`
	Events         uint64    `json:"events"`
	EventsInWindow int       `json:"events_in_window"`
	SensorVersion  string    `json:"sensor_version,omitempty"`
	Identity       string    `json:"identity,omitempty"`
}

// FleetHostInput is what the API layer maps from fleet.Host.
type FleetHostInput struct {
	Host          string
	Status        string
	FirstSeen     time.Time
	LastSeen      time.Time
	LastEventType string
	Events        uint64
	SensorVersion string
	Identity      string
}

// FleetInputs gathers the snapshot plus the windowed per-host event
// counts (one scan in the API layer, host -> count).
type FleetInputs struct {
	Enabled        bool
	Hosts          []FleetHostInput
	EventsInWindow map[string]int
	Source         string
	Truncated      bool
}

// BuildFleetCoverage merges the tracker snapshot with the windowed
// event counts. Hosts are ordered host-name asc (deterministic for
// CSV and diffs); a host with no events in the window still appears
// with events_in_window 0 — the absence IS the finding.
func BuildFleetCoverage(in FleetInputs, w Window, generated time.Time) FleetCoverage {
	out := FleetCoverage{
		Kind:        KindFleet,
		GeneratedAt: generated.UTC(),
		Window:      w,
		Source:      in.Source,
		Truncated:   in.Truncated,
		Enabled:     in.Enabled,
		Hosts:       []FleetHost{},
	}
	for _, h := range in.Hosts {
		row := FleetHost{
			Host:           h.Host,
			Status:         h.Status,
			FirstSeen:      h.FirstSeen.UTC(),
			LastSeen:       h.LastSeen.UTC(),
			LastEventType:  h.LastEventType,
			Events:         h.Events,
			EventsInWindow: in.EventsInWindow[h.Host],
			SensorVersion:  h.SensorVersion,
			Identity:       h.Identity,
		}
		out.Hosts = append(out.Hosts, row)
		switch h.Status {
		case "online":
			out.Summary.Online++
		case "silent":
			out.Summary.Silent++
		default:
			out.Summary.Idle++
		}
		if row.EventsInWindow == 0 {
			out.Summary.NoSignalInWindow++
		}
	}
	out.Summary.Total = len(out.Hosts)
	sortHosts(out.Hosts)
	return out
}

func sortHosts(hosts []FleetHost) {
	sort.Slice(hosts, func(i, j int) bool { return hosts[i].Host < hosts[j].Host })
}

// CSV flattens the coverage: one row per host, name asc.
func (f FleetCoverage) CSV() Tabular {
	rows := make([][]string, 0, len(f.Hosts))
	for _, h := range f.Hosts {
		rows = append(rows, []string{
			h.Host,
			h.Status,
			h.FirstSeen.Format(time.RFC3339),
			h.LastSeen.Format(time.RFC3339),
			h.LastEventType,
			strconv.FormatUint(h.Events, 10),
			strconv.Itoa(h.EventsInWindow),
			h.SensorVersion,
			h.Identity,
		})
	}
	return Tabular{
		Header: []string{"host", "status", "first_seen", "last_seen", "last_event_type",
			"events", "events_in_window", "sensor_version", "identity"},
		Rows: rows,
	}
}
