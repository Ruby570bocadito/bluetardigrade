// Alert and event export endpoints for the local API: bulk downloads
// of the in-memory rings as JSON Lines or CSV, ready for SIEM import,
// offline analysis or the forensic store. CSV text fields escape common
// spreadsheet formula prefixes. JSONL preserves exact evidence; CSV
// presentation escaping is not a universal spreadsheet security guarantee.

package api

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"github.com/Ruby570bocadito/bluetardigrade/internal/report"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/alert"
	"github.com/Ruby570bocadito/bluetardigrade/internal/store"
	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
)

// handleAlertsExport serves GET /api/alerts/export?format=jsonl|csv
// (ndjson is accepted as an alias of jsonl). limit caps how many of
// the most recent alerts are exported; the chronological oldest-first
// order is preserved so append-only sinks can import the feed directly.
// With the SQLite store attached the export reads the FULL history
// (subject to the operator's retention) instead of the alert ring.
func (h *Hub) handleAlertsExport(w http.ResponseWriter, r *http.Request) {
	format := exportFormat(w, r)
	if format == "" {
		return
	}
	limit := limitFrom(r, maxAlerts)
	f, ok := parseRecordFilter(w, r)
	if !ok {
		return // 400 already written
	}
	h.mu.Lock()
	st := h.store
	h.mu.Unlock()
	var alerts []alert.Alert
	if st != nil {
		got, err := st.QueryAlerts(store.AlertQuery{
			Host: f.host, Severities: f.sevs, RuleID: f.ruleID, Q: f.q,
			Since: f.since, Until: f.until, Limit: limit,
		})
		if err != nil {
			h.storeQueryError(w, err)
			return
		}
		// the store returns newest first; exports stay oldest
		// first (append-only sinks import in order)
		for i, j := 0, len(got)-1; i < j; i, j = i+1, j-1 {
			got[i], got[j] = got[j], got[i]
		}
		alerts = got
	} else {
		h.mu.Lock()
		selected := make([]alert.Alert, 0, len(h.alerts))
		for _, a := range h.alerts {
			// alertTime keeps the export honest in both directions:
			// no time bounds → nothing is hidden over a parse
			// failure; a bound set → an unreadable timestamp cannot
			// cross the wire claiming membership it cannot prove.
			if ts, ok := f.alertTime(a); ok && f.matchAlert(a, ts) {
				selected = append(selected, a)
			}
		}
		h.mu.Unlock()
		if limit < len(selected) {
			selected = selected[len(selected)-limit:] // keep the most recent, oldest first
		}
		alerts = selected
	}
	// lifecycle overlay resolved outside the data lock (withLifecycle
	// only touches the triage store): the export must show the status
	// as it stands right now, same as GET /api/alerts — store mode or
	// ring mode, the triage state travels with the alert either way.
	views := make([]alertView, 0, len(alerts))
	for _, a := range alerts {
		views = append(views, h.withLifecycle(a))
	}

	stamp := time.Now().UTC().Format("20060102-150405")
	switch format {
	case "csv":
		w.Header().Set("Content-Type", "text/csv; charset=utf-8")
		w.Header().Set("Content-Disposition",
			fmt.Sprintf("attachment; filename=\"alerts-%s.csv\"", stamp))
		cw := csv.NewWriter(w)
		// decision is APPENDED at the end (not slotted next to status):
		// positional consumers keep their columns; the JSONL export
		// carries the same field as a plain JSON key.
		_ = cw.Write([]string{"id", "status", "timestamp", "severity", "rule_id", "rule_name",
			"event_type", "host", "user", "summary", "matched_on", "tags",
			"message", "notify", "status_note", "status_by", "decision"})
		for _, v := range views {
			_ = cw.Write([]string{
				csvSafe(v.ID), csvSafe(v.Status), csvSafe(v.Timestamp), csvSafe(v.Severity),
				csvSafe(v.RuleID), csvSafe(v.RuleName), csvSafe(v.EventType),
				csvSafe(v.Host), csvSafe(v.User), csvSafe(v.Summary),
				csvSafe(strings.Join(v.MatchedOn, " ")), csvSafe(strings.Join(v.Tags, " ")),
				csvSafe(v.Message), strconv.FormatBool(v.Notify),
				csvSafe(v.StatusNote), csvSafe(v.StatusBy), csvSafe(v.Decision),
			})
		}
		cw.Flush()
		// surface a write error instead of answering 200 with a
		// silently truncated CSV (audit 5.16): the header has already
		// gone out, so a 500 is not possible — the error lands in the
		// engine log, which is where an operator debugs a short file.
		if err := cw.Error(); err != nil {
			log.Printf("[API] alerts CSV export write failed: %v", err)
		}
	default: // jsonl
		w.Header().Set("Content-Type", "application/x-ndjson")
		w.Header().Set("Content-Disposition",
			fmt.Sprintf("attachment; filename=\"alerts-%s.jsonl\"", stamp))
		for _, v := range views {
			payload, err := json.Marshal(v)
			if err != nil {
				// Paridad con la rama CSV (sesión 100agentes-2, agente
				// 15): un marshal que falla en silencio producía un
				// 200 con el export truncado sin rastro en el log.
				log.Printf("[API] alerts JSONL export marshal failed: %v", err)
				continue
			}
			fmt.Fprintf(w, "%s\n", payload)
		}
	}
}

// handleEventsExport serves GET /api/events/export?format=jsonl|csv.
// With the SQLite store attached the export reads the FULL history
// (subject to the operator's retention) instead of the event ring.
func (h *Hub) handleEventsExport(w http.ResponseWriter, r *http.Request) {
	format := exportFormat(w, r)
	if format == "" {
		return
	}
	limit := limitFrom(r, maxEvents)
	f, ok := parseRecordFilter(w, r)
	if !ok {
		return // 400 already written
	}
	h.mu.Lock()
	st := h.store
	h.mu.Unlock()
	var events []*model.Event
	if st != nil {
		got, err := st.QueryEvents(store.EventQuery{
			Host: f.host, Type: f.evType, Q: f.q,
			Since: f.since, Until: f.until, Limit: limit,
		})
		if err != nil {
			h.storeQueryError(w, err)
			return
		}
		for i, j := 0, len(got)-1; i < j; i, j = i+1, j-1 {
			got[i], got[j] = got[j], got[i] // chronological oldest first
		}
		events = got
	} else {
		h.mu.Lock()
		events = make([]*model.Event, 0, len(h.events))
		for _, ev := range h.events {
			if f.matchEvent(ev) {
				events = append(events, ev)
			}
		}
		h.mu.Unlock()
		if limit < len(events) {
			events = events[len(events)-limit:] // keep the most recent, oldest first
		}
	}

	stamp := time.Now().UTC().Format("20060102-150405")
	switch format {
	case "csv":
		w.Header().Set("Content-Type", "text/csv; charset=utf-8")
		w.Header().Set("Content-Disposition",
			fmt.Sprintf("attachment; filename=\"events-%s.csv\"", stamp))
		cw := csv.NewWriter(w)
		_ = cw.Write([]string{"id", "timestamp", "type", "source", "host", "user",
			"process_name", "process_pid", "process_command_line",
			"file_path", "network_destination", "network_port", "registry_key"})
		for _, ev := range events {
			_ = cw.Write([]string{
				csvSafe(ev.ID),
				csvSafe(ev.Timestamp.Format(time.RFC3339Nano)),
				csvSafe(ev.Type), csvSafe(ev.Source), csvSafe(ev.Host), csvSafe(ev.User),
				csvSafe(eventProcessName(ev)),
				strconv.Itoa(eventPID(ev)),
				csvSafe(eventCommandLine(ev)),
				csvSafe(eventFilePath(ev)),
				csvSafe(eventNetworkDestination(ev)),
				eventNetworkPort(ev),
				csvSafe(eventRegistryKey(ev)),
			})
		}
		cw.Flush()
		if err := cw.Error(); err != nil {
			log.Printf("[API] events CSV export write failed: %v", err)
		}
	default: // jsonl
		w.Header().Set("Content-Type", "application/x-ndjson")
		w.Header().Set("Content-Disposition",
			fmt.Sprintf("attachment; filename=\"events-%s.jsonl\"", stamp))
		for _, ev := range events {
			payload, err := json.Marshal(ev)
			if err != nil {
				log.Printf("[API] events JSONL export marshal failed: %v", err)
				continue
			}
			fmt.Fprintf(w, "%s\n", payload)
		}
	}
}

// exportFormat validates the ?format= query (default jsonl; ndjson is
// an alias) and, on an unsupported value, answers 400 and returns "".
func exportFormat(w http.ResponseWriter, r *http.Request) string {
	switch r.URL.Query().Get("format") {
	case "", "jsonl", "ndjson":
		return "jsonl"
	case "csv":
		return "csv"
	default:
		http.Error(w, "unsupported format: use jsonl, ndjson or csv", http.StatusBadRequest)
		return ""
	}
}

// csvSafe prefixes textual formula/control characters with an apostrophe,
// including full-width variants and prefixes after leading whitespace.
// The original string stays intact; exact-data imports should use JSONL.
// csvSafe delegates to report.SafeCell (sesión 100agentes-2, agente
// 27): cuerpos byte a byte identicos — el contrato se mantiene en UN
// lugar (cuarta-copia rule del repo).
func csvSafe(s string) string { return report.SafeCell(s) }

func eventProcessName(ev *model.Event) string {
	if ev.Process != nil {
		return ev.Process.Name
	}
	return ""
}

func eventPID(ev *model.Event) int {
	if ev.Process != nil {
		return ev.Process.PID
	}
	return 0
}

func eventCommandLine(ev *model.Event) string {
	if ev.Process != nil {
		return ev.Process.CommandLine
	}
	return ""
}

func eventFilePath(ev *model.Event) string {
	if ev.File != nil {
		return ev.File.Path
	}
	return ""
}

func eventNetworkDestination(ev *model.Event) string {
	if ev.Network != nil {
		return ev.Network.DestinationIP
	}
	return ""
}

func eventNetworkPort(ev *model.Event) string {
	if ev.Network != nil && ev.Network.DestinationPort != 0 {
		return strconv.Itoa(ev.Network.DestinationPort)
	}
	return ""
}

func eventRegistryKey(ev *model.Event) string {
	if ev.Registry != nil {
		return ev.Registry.Key
	}
	return ""
}
