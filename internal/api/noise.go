// Noise surface (PLAN-DETALLADO §2.4): GET /api/noise?window=24h
// answers the processes, DNS domains and rules that most events or
// alerts generate, fleet-wide or per host, so the operator knows what
// to tune (known-software, suppressions) instead of re-reading the
// same normal activity every week. JSON only: the console renders it
// and adds the tuning buttons; bulk export stays the /export family's
// job. Read-only, like the reports it complements.

package api

import (
	"net/http"
	"strings"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/report"
)

func (h *Hub) registerNoise(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/noise", h.handleNoise)
}

// handleNoise serves GET /api/noise?window=24h&host=&limit=10.
// Window defaults to 24h (the §2.4 preset) and accepts any duration
// between 15 minutes and 30 days; host narrows the aggregates to one
// machine; limit caps each top list (10 default, 50 max).
func (h *Hub) handleNoise(w http.ResponseWriter, r *http.Request) {
	window, err := report.ParseWindow(report.KindNoise, r.URL.Query().Get("window"))
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	host := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("host")))
	limit := limitFrom(r, report.NoiseTopDefault)
	if limit > report.NoiseTopMax {
		limit = report.NoiseTopMax
	}

	events, evTrunc, source, ok := h.windowedEvents(w, window, host)
	if !ok {
		return
	}
	// Alerts come from the same window (and host filter) as the events;
	// the rule aggregates read their triage overlay.
	alertRows, _, _, ok := h.windowedAlerts(w, window)
	if !ok {
		return
	}
	if host != "" {
		filtered := make([]report.AlertInput, 0, len(alertRows))
		for _, a := range alertRows {
			if strings.ToLower(a.Host) == host {
				filtered = append(filtered, a)
			}
		}
		alertRows = filtered
	}

	n := report.BuildNoise(report.NoiseInputs{
		Events:    events,
		Alerts:    alertRows,
		Host:      host,
		Limit:     limit,
		Source:    source,
		Truncated: evTrunc,
	}, window, time.Now())
	writeJSON(w, n)
}
