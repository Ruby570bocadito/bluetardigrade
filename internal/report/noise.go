package report

import (
	"sort"
	"strings"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
)

// Noise is the §2.4 report: the processes, DNS domains and rules that
// most events or alerts generate, so the operator knows what to tune
// (known-software, suppressions) instead of chasing the same normal
// activity every week. Fleet-wide by default; with a host filter it
// narrows to that machine. It never mutates anything: the console's
// "add to known software" / "create suppression" buttons stay console
// work (and the suppression write surface already exists).
//
// The FP percentage the TODO asks for rides on the triage decision
// field the lifecycle store does not have yet (a pending engine-side
// request): today the report
// ships the honest proxy — the share of each rule's alerts whose
// CURRENT status is closed/acknowledged — named exactly that
// (closed_pct, acknowledged_pct).
type Noise struct {
	Kind        string    `json:"kind"`         // "noise"
	GeneratedAt time.Time `json:"generated_at"` // UTC
	Window      Window    `json:"window"`
	Host        string    `json:"host"` // "" = whole fleet
	Source      string    `json:"source"`
	Scanned     Scanned   `json:"scanned"`

	Processes []ProcessNoise `json:"processes"` // top by boot count
	Domains   []DomainNoise  `json:"domains"`   // top by lookup count
	Rules     []RuleNoise    `json:"rules"`     // top by alert count
}

// Scanned is the honesty block: how many records fed the aggregates
// and whether the scan hit its cap before exhausting the window (a
// capped scan sees the NEWEST slice of the window, never a biased
// sample of it).
type Scanned struct {
	Events    int  `json:"events"`
	Alerts    int  `json:"alerts"`
	Truncated bool `json:"truncated"`
}

// ProcessNoise is one aggregated process boot signature. The key is
// the executable image (lowercased — Windows paths are case
// insensitive), the sample fields carry the context of the newest
// record so the operator can judge a suppression or a known-software
// entry without re-querying.
type ProcessNoise struct {
	Image         string `json:"image"`          // group key (lowercased)
	Count         int    `json:"count"`          // boots in the window
	DistinctHosts int    `json:"distinct_hosts"` // hosts that booted it
	FirstSeen     string `json:"first_seen"`     // RFC 3339, earliest boot of the window
	LastSeen      string `json:"last_seen"`      // RFC 3339, newest boot
	Parent        string `json:"parent,omitempty"`
	CommandLine   string `json:"command_line,omitempty"` // newest sample, truncated
	SHA256        string `json:"sha256,omitempty"`       // newest sample carrying one
}

// DomainNoise is one aggregated DNS name.
type DomainNoise struct {
	Domain        string `json:"domain"`
	Count         int    `json:"count"`
	DistinctHosts int    `json:"distinct_hosts"`
	FirstSeen     string `json:"first_seen"`
	LastSeen      string `json:"last_seen"`
}

// RuleNoise is one aggregated rule with its triage proxy percentages.
type RuleNoise struct {
	RuleID          string         `json:"rule_id"`
	RuleName        string         `json:"rule_name"`
	Count           int            `json:"count"`
	BySeverity      map[string]int `json:"by_severity,omitempty"`
	DistinctHosts   int            `json:"distinct_hosts"`
	AcknowledgedPct float64        `json:"acknowledged_pct"`
	ClosedPct       float64        `json:"closed_pct"`
}

const (
	// NoiseTopDefault/NoiseTopMax cap one aggregate's payload size: the
	// console renders a top list, not a census. The API clamps ?limit=
	// to these.
	NoiseTopDefault = 10
	NoiseTopMax     = 50
	// noiseSampleCommand caps the command-line sample length: context
	// for a human, not a copy of the evidence.
	noiseSampleCommand = 200
)

// NoiseInputs gathers the windowed records (already host-filtered by
// the API layer).
type NoiseInputs struct {
	Events    []*model.Event
	Alerts    []AlertInput
	Host      string
	Limit     int // per aggregate; clamped to NoiseTopMax
	Source    string
	Truncated bool
}

// procAgg is the working form of a process group: the wire fields plus
// the transient host set and newest-sample timestamps.
type procAgg struct {
	count   int
	hosts   map[string]bool
	first   time.Time
	last    time.Time
	parent  string
	command string
	sha256  string
}

type domAgg struct {
	count int
	hosts map[string]bool
	first time.Time
	last  time.Time
}

// ruleAgg is the working form of a rule group (host set held beside
// the wire fields, never on them).
type ruleAgg struct {
	wire  RuleNoise
	hosts map[string]bool
}

// BuildNoise aggregates. Process boots group by image path
// (process.create with a Process; the name is the fallback key when a
// sensor cannot provide an image), DNS lookups group by the queried
// name (Network with protocol "dns" — the wire value the sensor
// sends, compared case-insensitively), rules group by rule id from
// the alerts. Samples describe the NEWEST record of each group; ties
// keep the first seen while scanning, so the result never depends on
// the input order.
func BuildNoise(in NoiseInputs, w Window, generated time.Time) Noise {
	n := Noise{
		Kind:        KindNoise,
		GeneratedAt: generated.UTC(),
		Window:      w,
		Host:        in.Host,
		Source:      in.Source,
		Scanned:     Scanned{Events: len(in.Events), Alerts: len(in.Alerts), Truncated: in.Truncated},
	}
	limit := in.Limit
	if limit <= 0 {
		limit = NoiseTopDefault
	}
	if limit > NoiseTopMax {
		limit = NoiseTopMax
	}

	procs := map[string]*procAgg{}
	doms := map[string]*domAgg{}

	for _, ev := range in.Events {
		if ev.Timestamp.Before(w.From) || ev.Timestamp.After(w.Until) {
			continue
		}
		switch {
		case ev.Type == model.TypeProcessCreate && ev.Process != nil:
			key := strings.ToLower(ev.Process.Image)
			if key == "" {
				key = strings.ToLower(ev.Process.Name)
			}
			if key == "" {
				continue
			}
			a := procs[key]
			if a == nil {
				a = &procAgg{hosts: map[string]bool{}}
				procs[key] = a
			}
			a.count++
			if ev.Host != "" {
				a.hosts[ev.Host] = true
			}
			if a.first.IsZero() || ev.Timestamp.Before(a.first) {
				a.first = ev.Timestamp
			}
			// The newest record of the group donates its sample fields.
			if ev.Timestamp.After(a.last) || a.last.IsZero() {
				a.last = ev.Timestamp
				a.parent = parentName(ev)
				a.command = truncate(ev.Process.CommandLine, noiseSampleCommand)
				a.sha256 = ev.Process.Hashes["sha256"]
			}
		case ev.Network != nil &&
			strings.EqualFold(ev.Network.Protocol, "dns") &&
			ev.Network.Domain != "":
			key := strings.ToLower(ev.Network.Domain)
			a := doms[key]
			if a == nil {
				a = &domAgg{hosts: map[string]bool{}}
				doms[key] = a
			}
			a.count++
			if ev.Host != "" {
				a.hosts[ev.Host] = true
			}
			if a.first.IsZero() || ev.Timestamp.Before(a.first) {
				a.first = ev.Timestamp
			}
			if ev.Timestamp.After(a.last) {
				a.last = ev.Timestamp
			}
		}
	}

	rules := map[string]*ruleAgg{}
	for _, a := range in.Alerts {
		if a.RuleID == "" {
			continue
		}
		ts, ok := a.Time()
		if !ok || ts.Before(w.From) || ts.After(w.Until) {
			continue
		}
		r := rules[a.RuleID]
		if r == nil {
			r = &ruleAgg{hosts: map[string]bool{}, wire: RuleNoise{
				RuleID:     a.RuleID,
				RuleName:   a.RuleName,
				BySeverity: map[string]int{},
			}}
			rules[a.RuleID] = r
		}
		r.wire.Count++
		if a.Severity != "" {
			r.wire.BySeverity[a.Severity]++
		}
		if a.Host != "" {
			r.hosts[a.Host] = true
		}
		switch a.Status {
		case "acknowledged":
			r.wire.AcknowledgedPct++
		case "closed":
			r.wire.ClosedPct++
		}
	}

	n.Processes = make([]ProcessNoise, 0, len(procs))
	for key, a := range procs {
		n.Processes = append(n.Processes, ProcessNoise{
			Image:         key,
			Count:         a.count,
			DistinctHosts: len(a.hosts),
			FirstSeen:     a.first.UTC().Format(time.RFC3339Nano),
			LastSeen:      a.last.UTC().Format(time.RFC3339Nano),
			Parent:        a.parent,
			CommandLine:   a.command,
			SHA256:        a.sha256,
		})
	}
	n.Domains = make([]DomainNoise, 0, len(doms))
	for domain, a := range doms {
		n.Domains = append(n.Domains, DomainNoise{
			Domain:        domain,
			Count:         a.count,
			DistinctHosts: len(a.hosts),
			FirstSeen:     a.first.UTC().Format(time.RFC3339Nano),
			LastSeen:      a.last.UTC().Format(time.RFC3339Nano),
		})
	}
	n.Rules = make([]RuleNoise, 0, len(rules))
	for _, r := range rules {
		if r.wire.Count > 0 {
			r.wire.AcknowledgedPct = round1(r.wire.AcknowledgedPct * 100 / float64(r.wire.Count))
			r.wire.ClosedPct = round1(r.wire.ClosedPct * 100 / float64(r.wire.Count))
		}
		r.wire.DistinctHosts = len(r.hosts)
		n.Rules = append(n.Rules, r.wire)
	}

	sortTop(n.Processes, func(i, j int) bool {
		if n.Processes[i].Count != n.Processes[j].Count {
			return n.Processes[i].Count > n.Processes[j].Count
		}
		return n.Processes[i].Image < n.Processes[j].Image
	})
	sortTop(n.Domains, func(i, j int) bool {
		if n.Domains[i].Count != n.Domains[j].Count {
			return n.Domains[i].Count > n.Domains[j].Count
		}
		return n.Domains[i].Domain < n.Domains[j].Domain
	})
	sortTop(n.Rules, func(i, j int) bool {
		if n.Rules[i].Count != n.Rules[j].Count {
			return n.Rules[i].Count > n.Rules[j].Count
		}
		return n.Rules[i].RuleID < n.Rules[j].RuleID
	})
	n.Processes = topOf(n.Processes, limit)
	n.Domains = topOf(n.Domains, limit)
	n.Rules = topOf(n.Rules, limit)
	return n
}

// parentName returns the parent process name of a process.create
// event: the engine's enricher resolves it from its PID table into
// Enrichment (parent_name, parent_image); an unknown parent has no
// name to show and the sample simply omits it.
func parentName(ev *model.Event) string {
	if n := ev.Enrichment["parent_name"]; n != "" {
		return n
	}
	return ev.Enrichment["parent_image"]
}

func truncate(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max] + "..."
}

func round1(f float64) float64 { return float64(int(f*10+0.5)) / 10 }

// sortTop slice-sorts with the given less function (stable so equal
// keys keep map-independent determinism).
func sortTop[T any](s []T, less func(i, j int) bool) {
	sort.SliceStable(s, less)
}

// topOf caps a slice to the top n.
func topOf[T any](s []T, n int) []T {
	if len(s) > n {
		return s[:n]
	}
	return s
}
