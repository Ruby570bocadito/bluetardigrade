// REP-1 report surfaces: the catalog (GET /api/reports) and the
// per-kind data endpoint (GET /api/reports/{kind}). Read-only GETs
// like every telemetry route; they gather windowed records from the
// store (full retention) or the in-memory rings (recent slice, carried
// honestly in the report envelope) and delegate every number to the
// pure builders in internal/report. CSV responses reuse the export
// endpoints' spreadsheet formula escaping (report.SafeCell).

package api

import (
	"encoding/csv"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/alert"
	"github.com/Ruby570bocadito/bluetardigrade/internal/incident"
	"github.com/Ruby570bocadito/bluetardigrade/internal/report"
	"github.com/Ruby570bocadito/bluetardigrade/internal/store"
	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
)

// reportScanLimit is the per-request record cap: one windowed scan of
// up to 10k records aggregates in milliseconds and bounds a hostile
// request's cost; reports whose scan hits the cap say so (truncated).
const reportScanLimit = 10000

func (h *Hub) registerReports(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/reports", h.handleReportCatalog)
	mux.HandleFunc("GET /api/reports/{kind}", h.handleReport)
}

type reportCatalog struct {
	Reports []report.CatalogEntry `json:"reports"`
}

func (h *Hub) handleReportCatalog(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, reportCatalog{Reports: report.Catalog()})
}

// handleReport serves GET /api/reports/{kind}?window=&format=&id=.
// Unknown kinds answer 404 naming the valid ones; a bad window or
// format answers 400 with the accepted values; the incident kind
// requires ?id= and rejects a window (a case bundle is point in time).
func (h *Hub) handleReport(w http.ResponseWriter, r *http.Request) {
	kind := r.PathValue("kind")
	if kind != report.KindExecutive && kind != report.KindFleet &&
		kind != report.KindSoc && kind != report.KindIncident {
		http.Error(w, fmt.Sprintf("unknown report kind %q: use executive, incident, fleet or soc (see GET /api/reports)",
			kind), http.StatusNotFound)
		return
	}
	format := r.URL.Query().Get("format")
	switch format {
	case "", "json":
	case "csv":
	default:
		http.Error(w, "invalid format: use json or csv", http.StatusBadRequest)
		return
	}

	if kind == report.KindIncident {
		if win := r.URL.Query().Get("window"); win != "" {
			http.Error(w, "the incident report is a point-in-time bundle: window does not apply", http.StatusBadRequest)
			return
		}
		h.reportIncident(w, r, format)
		return
	}

	window, err := report.ParseWindow(kind, r.URL.Query().Get("window"))
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	generated := time.Now()
	switch kind {
	case report.KindExecutive:
		h.reportExecutive(w, window, generated, format)
	case report.KindFleet:
		h.reportFleet(w, window, generated, format)
	case report.KindSoc:
		h.reportSoc(w, window, generated, format)
	}
}

// windowedAlerts gathers the window's alerts with their triage overlay
// (the AlertInput the report builders consume). Store mode serves the
// full retention; ring mode serves the alert ring and reports the
// oldest record it still holds, so the consumer can see whether the
// window is actually covered. On a store failure the 500 is written
// and ok comes back false.
func (h *Hub) windowedAlerts(w http.ResponseWriter, window report.Window) (rows []report.AlertInput, truncated bool, oldest string, ok bool) {
	h.mu.Lock()
	st := h.store
	ring := h.alerts
	h.mu.Unlock()

	if st == nil {
		rows = make([]report.AlertInput, 0, len(ring))
		oldestAt := time.Time{}
		for i := range ring {
			a := ring[i]
			ts, parsed := alertTimestamp(a)
			if !parsed || ts.Before(window.From) || ts.After(window.Until) {
				continue
			}
			rows = append(rows, h.alertInput(a))
			if oldestAt.IsZero() || ts.Before(oldestAt) {
				oldestAt = ts
			}
		}
		if !oldestAt.IsZero() {
			oldest = oldestAt.UTC().Format(time.RFC3339Nano)
		}
		return rows, false, oldest, true
	}
	got, err := st.QueryAlerts(store.AlertQuery{
		Since: window.From, Until: window.Until, Limit: reportScanLimit,
	})
	if err != nil {
		h.storeQueryError(w, err)
		return nil, false, "", false
	}
	rows = make([]report.AlertInput, 0, len(got))
	for _, a := range got {
		rows = append(rows, h.alertInput(a))
	}
	return rows, len(got) >= reportScanLimit, "", true
}

// windowedEvents gathers the window's events for aggregation (fleet
// coverage counts, noise). Same store/ring duality and the same 500
// path as the alerts.
func (h *Hub) windowedEvents(w http.ResponseWriter, window report.Window, host string) (events []*model.Event, truncated bool, source string, ok bool) {
	h.mu.Lock()
	st := h.store
	ring := h.events
	h.mu.Unlock()
	host = strings.ToLower(strings.TrimSpace(host))

	if st == nil {
		out := make([]*model.Event, 0, len(ring))
		for _, ev := range ring {
			if ev.Timestamp.Before(window.From) || ev.Timestamp.After(window.Until) {
				continue
			}
			if host != "" && strings.ToLower(ev.Host) != host {
				continue
			}
			out = append(out, ev)
		}
		return out, false, report.SourceRing, true
	}
	got, err := st.QueryEvents(store.EventQuery{
		Since: window.From, Until: window.Until, Limit: reportScanLimit,
	})
	if err != nil {
		h.storeQueryError(w, err)
		return nil, false, "", false
	}
	// The truncated flag belongs to the SCAN, not to the filtered
	// set: narrowing by host first would report truncated=false when
	// the host's records simply fell beyond the cap — a report that
	// silently undercounts while claiming the whole window.
	truncated = len(got) >= reportScanLimit
	if host != "" {
		filtered := make([]*model.Event, 0, len(got))
		for _, ev := range got {
			if strings.ToLower(ev.Host) == host {
				filtered = append(filtered, ev)
			}
		}
		got = filtered
	}
	return got, truncated, report.SourceStore, true
}

// alertInput flattens one alert plus its lifecycle overlay.
func (h *Hub) alertInput(a alert.Alert) report.AlertInput {
	v := h.withLifecycle(a)
	return report.AlertInput{
		ID:        a.ID,
		RuleID:    a.RuleID,
		RuleName:  a.RuleName,
		Severity:  strings.ToLower(a.Severity),
		Host:      a.Host,
		EventType: a.EventType,
		Timestamp: a.Timestamp,
		Summary:   a.Summary,
		Tags:      a.Tags,
		Status:    v.Status,
		Decision:  v.Decision,
		StatusAt:  v.StatusAt,
		StatusBy:  v.StatusBy,
	}
}

// reportExecutive builds the executive summary. Incidents and the
// fleet snapshot are read outside the data lock: both stores take
// their own locking.
func (h *Hub) reportExecutive(w http.ResponseWriter, window report.Window, generated time.Time, format string) {
	rows, truncated, oldest, ok := h.windowedAlerts(w, window)
	if !ok {
		return
	}
	incStore := h.incidentStore()
	incidents := incStore.List()
	open, _ := incStore.Counts()
	enabled, fleetHosts := h.fleetSnapshot()
	e := report.BuildExecutive(report.ExecutiveInputs{
		Alerts:          rows,
		Truncated:       truncated,
		OldestRecord:    oldest,
		Source:          h.dataSource(),
		Incidents:       mapIncidentTimes(incidents),
		IncidentOpen:    open,
		IncidentPersist: incStore.Persistent(),
		FleetEnabled:    enabled,
		FleetHosts:      fleetHosts,
	}, window, generated)
	writeReport(w, format, e.Kind, e, e.CSV())
}

// reportFleet builds the coverage report: tracker snapshot plus the
// windowed per-host event counts from one scan.
func (h *Hub) reportFleet(w http.ResponseWriter, window report.Window, generated time.Time, format string) {
	events, truncated, source, ok := h.windowedEvents(w, window, "")
	if !ok {
		return
	}
	counts := map[string]int{}
	for _, ev := range events {
		counts[ev.Host]++
	}
	enabled, hosts := h.fleetSnapshot()
	f := report.BuildFleetCoverage(report.FleetInputs{
		Enabled:        enabled,
		Hosts:          hosts,
		EventsInWindow: counts,
		Source:         source,
		Truncated:      truncated,
	}, window, generated)
	writeReport(w, format, f.Kind, f, f.CSV())
}

// reportSoc builds the triage-throughput report from the windowed
// alerts and the lifecycle entries (the store's latest action per
// alert; the builder documents that bound).
func (h *Hub) reportSoc(w http.ResponseWriter, window report.Window, generated time.Time, format string) {
	rows, truncated, _, ok := h.windowedAlerts(w, window)
	if !ok {
		return
	}
	entries := h.lifecycle.List()
	lc := make([]report.LifecycleEvent, 0, len(entries))
	for _, e := range entries {
		lc = append(lc, report.LifecycleEvent{AlertID: e.AlertID, Status: string(e.Status), At: e.At, By: e.By})
	}
	s := report.BuildSocActivity(report.SocInputs{
		Alerts: rows, Lifecycle: lc,
		Source: h.dataSource(), Truncated: truncated,
	}, window, generated)
	writeReport(w, format, s.Kind, s, s.CSV())
}

// reportIncident bundles one case: the record, its timeline and the
// triage overlay of every alert it groups. Alert ids the engine can
// no longer resolve (ring eviction, retention) stay listed with
// found:false — the case history never hides what it grouped.
func (h *Hub) reportIncident(w http.ResponseWriter, r *http.Request, format string) {
	id := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("id")))
	if !incident.ValidID(id) {
		http.Error(w, "missing or malformed id: an incident id is 16 hex characters", http.StatusBadRequest)
		return
	}
	incStore := h.incidentStore()
	inc, err := incStore.Get(id)
	if err != nil {
		if err == incident.ErrNotFound {
			http.Error(w, "no such incident: "+id, http.StatusNotFound)
			return
		}
		http.Error(w, "incident lookup failed (see engine log)", http.StatusInternalServerError)
		return
	}

	// Index the resolvable alerts once: the ring always, the store's
	// full history when attached (one scan instead of one query per id).
	byID := map[string]alert.Alert{}
	h.mu.Lock()
	for _, a := range h.alerts {
		byID[a.ID] = a
	}
	h.mu.Unlock()
	if st := h.storeOrNil(); st != nil {
		got, err := st.QueryAlerts(store.AlertQuery{Limit: reportScanLimit})
		if err != nil {
			h.storeQueryError(w, err)
			return
		}
		for _, a := range got {
			byID[a.ID] = a
		}
	}

	rows := make([]report.IncidentAlert, 0, len(inc.AlertIDs))
	for _, aid := range inc.AlertIDs {
		if a, found := byID[aid]; found {
			rows = append(rows, report.IncidentAlert{AlertInput: h.alertInput(a), Found: true})
			continue
		}
		missing := report.AlertInput{ID: aid, Status: "new"}
		if e, ok := h.lifecycle.Get(aid); ok {
			missing.Status = string(e.Status)
			missing.StatusAt = e.At
			missing.StatusBy = e.By
		}
		rows = append(rows, report.IncidentAlert{AlertInput: missing, Found: false})
	}
	timeline := make([]report.IncidentEntry, 0, len(inc.Timeline))
	for _, e := range inc.Timeline {
		timeline = append(timeline, report.IncidentEntry{At: e.At, By: e.By, Kind: e.Kind, Text: e.Text})
	}
	rep := report.BuildIncident(report.IncidentInputs{
		Case: report.IncidentCase{
			ID:        inc.ID,
			Title:     inc.Title,
			Summary:   inc.Summary,
			Severity:  inc.Severity,
			Status:    string(inc.Status),
			Owner:     inc.Owner,
			Hosts:     inc.Hosts,
			CreatedAt: inc.CreatedAt,
			UpdatedAt: inc.UpdatedAt,
			ClosedAt:  inc.ClosedAt,
		},
		Timeline: timeline,
		Alerts:   rows,
	}, time.Now())
	writeReport(w, format, rep.Kind, rep, rep.CSV())
}

// ------------------------------------------------------------- shared

// dataSource is the record-source label of the alert-backed reports
// (executive, soc): store when attached, ring otherwise.
func (h *Hub) dataSource() string {
	if h.storeOrNil() != nil {
		return report.SourceStore
	}
	return report.SourceRing
}

// alertTimestamp parses an alert's RFC 3339 stamp; ok false marks an
// unreadable timestamp (with a window set, such a record cannot prove
// membership and stays excluded — the export endpoints' standard).
func alertTimestamp(a alert.Alert) (time.Time, bool) {
	t, err := time.Parse(time.RFC3339Nano, a.Timestamp)
	if err != nil {
		return time.Time{}, false
	}
	return t, true
}

// fleetSnapshot copies the tracker view the reports run on.
func (h *Hub) fleetSnapshot() (bool, []report.FleetHostInput) {
	h.mu.Lock()
	t := h.fleet
	h.mu.Unlock()
	if t == nil {
		return false, nil
	}
	snap := t.Snapshot(time.Now())
	out := make([]report.FleetHostInput, 0, len(snap))
	for _, host := range snap {
		version := ""
		if host.Sensor != nil {
			version = host.Sensor.Version
		}
		out = append(out, report.FleetHostInput{
			Host:          host.Host,
			Status:        host.Status,
			FirstSeen:     host.FirstSeen,
			LastSeen:      host.LastSeen,
			LastEventType: host.LastEventType,
			Events:        host.Events,
			SensorVersion: version,
			Identity:      host.Identity,
		})
	}
	return true, out
}

func (h *Hub) storeOrNil() *store.Store {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.store
}

func mapIncidentTimes(incidents []incident.Incident) []report.IncidentTimes {
	out := make([]report.IncidentTimes, 0, len(incidents))
	for _, inc := range incidents {
		out = append(out, report.IncidentTimes{CreatedAt: inc.CreatedAt, ClosedAt: inc.ClosedAt})
	}
	return out
}

// writeReport answers JSON (default) or CSV. The CSV filename carries
// the kind and a UTC stamp, same convention as the export endpoints.
func writeReport(w http.ResponseWriter, format, kind string, data any, table report.Tabular) {
	if format != "csv" {
		writeJSON(w, data)
		return
	}
	stamp := time.Now().UTC().Format("20060102-150405")
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition",
		fmt.Sprintf("attachment; filename=%s-%s.csv", kind, stamp))
	cw := csv.NewWriter(w)
	_ = cw.Write(escapedRow(table.Header))
	for _, row := range table.Rows {
		_ = cw.Write(escapedRow(row))
	}
	cw.Flush()
}

// escapedRow applies the spreadsheet formula escaping cell by cell.
func escapedRow(row []string) []string {
	out := make([]string, len(row))
	for i, cell := range row {
		out[i] = report.SafeCell(cell)
	}
	return out
}
