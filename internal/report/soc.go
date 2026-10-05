package report

import (
	"sort"
	"strconv"
	"time"
)

// SocActivity is the REP-1 triage-throughput report: how much the
// engine raised, how fast operators picked it up and closed it, and
// who acted. It reads the lifecycle overlay, whose store keeps the
// LATEST entry per alert (a single Set replaces the previous one), so
// the means and the operator counts describe the latest action of each
// alert, not a full audit history — the report says what the store
// knows, nothing more. Without triage activity the report is zeros.
type SocActivity struct {
	Kind        string    `json:"kind"`         // "soc"
	GeneratedAt time.Time `json:"generated_at"` // UTC
	Window      Window    `json:"window"`
	Source      string    `json:"source"`
	Truncated   bool      `json:"truncated"`
	Created     int       `json:"created"` // alerts raised inside the window

	// Backlog is the CURRENT triage state of the alerts the window
	// created (new plus acknowledged are still open work).
	Backlog SocBacklog `json:"backlog"`

	// Mean handling time over the window's alerts whose LATEST status
	// is acknowledged/closed, in seconds from the alert timestamp to
	// the status timestamp; 0 means no alert reached that state.
	MeanTimeToAckSeconds   float64 `json:"mean_time_to_ack_seconds"`
	MeanTimeToCloseSeconds float64 `json:"mean_time_to_close_seconds"`

	Days       []SocDay       `json:"days"`        // one row per UTC day that had activity
	ByOperator map[string]int `json:"by_operator"` // status_by -> latest triage actions inside the window
}

// SocBacklog mirrors the current status counts of the window's alerts.
type SocBacklog struct {
	New          int `json:"new"`
	Acknowledged int `json:"acknowledged"`
	Closed       int `json:"closed"`
}

// SocDay is one UTC day bucket. Acknowledged/Closed count the triage
// actions that HAPPENED that day (the entry timestamp), regardless of
// when the alert was raised — what a daily review reads.
type SocDay struct {
	Day          string `json:"day"` // 2026-10-04
	Created      int    `json:"created"`
	Acknowledged int    `json:"acknowledged"`
	Closed       int    `json:"closed"`
}

// LifecycleEvent is one triage action the API layer forwards from the
// lifecycle store (List): the latest entry of each alerted id.
type LifecycleEvent struct {
	AlertID string
	Status  string // new | acknowledged | closed (new = reopened)
	At      string // RFC 3339
	By      string
}

// SocInputs gathers the windowed alerts plus the lifecycle actions.
type SocInputs struct {
	Alerts    []AlertInput
	Lifecycle []LifecycleEvent
	Source    string
	Truncated bool
}

// BuildSocActivity buckets creation by UTC day and handling times from
// the alert timestamp to the status timestamp. A skewed clock must not
// poison the means: a negative elapsed time counts as zero.
func BuildSocActivity(in SocInputs, w Window, generated time.Time) SocActivity {
	out := SocActivity{
		Kind:        KindSoc,
		GeneratedAt: generated.UTC(),
		Window:      w,
		Source:      in.Source,
		Truncated:   in.Truncated,
		ByOperator:  map[string]int{},
	}
	var ackTotal, closeTotal, ackCount, closeCount float64

	// Triage actions inside the window drive the day buckets and the
	// operator tally; reopens (status "new") are not work done.
	for _, ev := range in.Lifecycle {
		at, err := time.Parse(time.RFC3339Nano, ev.At)
		if err != nil || at.Before(w.From) || at.After(w.Until) {
			continue
		}
		switch ev.Status {
		case "acknowledged":
			out.day(at).Acknowledged++
		case "closed":
			out.day(at).Closed++
		default:
			continue
		}
		if ev.By != "" {
			out.ByOperator[ev.By]++
		}
	}

	for _, a := range in.Alerts {
		ts, ok := a.Time()
		if !ok || ts.Before(w.From) || ts.After(w.Until) {
			continue
		}
		out.Created++
		out.day(ts).Created++
		switch a.Status {
		case "acknowledged":
			out.Backlog.Acknowledged++
		case "closed":
			out.Backlog.Closed++
		default:
			out.Backlog.New++
		}
		if a.StatusAt == "" {
			continue
		}
		st, err := time.Parse(time.RFC3339Nano, a.StatusAt)
		if err != nil {
			continue
		}
		secs := st.Sub(ts).Seconds()
		if secs < 0 {
			secs = 0
		}
		switch a.Status {
		case "acknowledged":
			ackTotal += secs
			ackCount++
		case "closed":
			closeTotal += secs
			closeCount++
		}
	}
	if ackCount > 0 {
		out.MeanTimeToAckSeconds = ackTotal / ackCount
	}
	if closeCount > 0 {
		out.MeanTimeToCloseSeconds = closeTotal / closeCount
	}
	sort.Slice(out.Days, func(i, j int) bool { return out.Days[i].Day < out.Days[j].Day })
	return out
}

func (s *SocActivity) day(ts time.Time) *SocDay {
	d := ts.UTC().Format("2006-01-02")
	for i := range s.Days {
		if s.Days[i].Day == d {
			return &s.Days[i]
		}
	}
	s.Days = append(s.Days, SocDay{Day: d})
	return &s.Days[len(s.Days)-1]
}

// CSV flattens the activity: one row per UTC day.
func (s SocActivity) CSV() Tabular {
	rows := make([][]string, 0, len(s.Days))
	for _, d := range s.Days {
		rows = append(rows, []string{
			d.Day,
			strconv.Itoa(d.Created),
			strconv.Itoa(d.Acknowledged),
			strconv.Itoa(d.Closed),
		})
	}
	return Tabular{Header: []string{"day", "created", "acknowledged", "closed"}, Rows: rows}
}
