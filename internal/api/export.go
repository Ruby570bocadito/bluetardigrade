// Alert and event export endpoints for the local API: bulk downloads
// of the in-memory rings as JSON Lines or CSV, ready for SIEM import,
// offline analysis or the forensic store. CSV cells are neutralized
// against spreadsheet formula injection, the same way serious SOC
// tooling does: attacker-controlled fields (command lines, summaries)
// never open with a character a spreadsheet would interpret.
package api

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/Ruby570bocadito/security-framework/internal/alert"
	"github.com/Ruby570bocadito/security-framework/internal/store"
	"github.com/Ruby570bocadito/security-framework/pkg/model"
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
			http.Error(w, "store query failed: "+err.Error(), http.StatusInternalServerError)
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
			if ts, err := time.Parse(time.RFC3339Nano, a.Timestamp); err == nil && f.matchAlert(a, ts) {
				selected = append(selected, a)
			}
		}
		h.mu.Unlock()
		if limit < len(selected) {
			selected = selected[len(selected)-limit:] // keep the most recent, oldest first
		}
		alerts = selected
	}

	stamp := time.Now().UTC().Format("20060102-150405")
	switch format {
	case "csv":
		w.Header().Set("Content-Type", "text/csv; charset=utf-8")
		w.Header().Set("Content-Disposition",
			fmt.Sprintf("attachment; filename=\"alerts-%s.csv\"", stamp))
		cw := csv.NewWriter(w)
		_ = cw.Write([]string{"timestamp", "severity", "rule_id", "rule_name",
			"event_type", "host", "user", "summary", "matched_on", "tags",
			"message", "notify"})
		for _, a := range alerts {
			_ = cw.Write([]string{
				a.Timestamp, a.Severity, a.RuleID, a.RuleName, a.EventType,
				csvSafe(a.Host), csvSafe(a.User), csvSafe(a.Summary),
				strings.Join(a.MatchedOn, " "), strings.Join(a.Tags, " "),
				csvSafe(a.Message), strconv.FormatBool(a.Notify),
			})
		}
		cw.Flush()
	default: // jsonl
		w.Header().Set("Content-Type", "application/x-ndjson")
		w.Header().Set("Content-Disposition",
			fmt.Sprintf("attachment; filename=\"alerts-%s.jsonl\"", stamp))
		for _, a := range alerts {
			if payload, err := json.Marshal(a); err == nil {
				fmt.Fprintf(w, "%s\n", payload)
			}
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
			http.Error(w, "store query failed: "+err.Error(), http.StatusInternalServerError)
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
			fmt.Sprintf("attachment; filename=events-%s.csv", stamp))
		cw := csv.NewWriter(w)
		_ = cw.Write([]string{"id", "timestamp", "type", "source", "host", "user",
			"process_name", "process_pid", "process_command_line",
			"file_path", "network_destination", "network_port", "registry_key"})
		for _, ev := range events {
			_ = cw.Write([]string{
				ev.ID,
				ev.Timestamp.Format(time.RFC3339Nano),
				ev.Type, ev.Source, csvSafe(ev.Host), csvSafe(ev.User),
				eventProcessName(ev),
				strconv.Itoa(eventPID(ev)),
				csvSafe(eventCommandLine(ev)),
				eventFilePath(ev),
				eventNetworkDestination(ev),
				eventNetworkPort(ev),
				eventRegistryKey(ev),
			})
		}
		cw.Flush()
	default: // jsonl
		w.Header().Set("Content-Type", "application/x-ndjson")
		w.Header().Set("Content-Disposition",
			fmt.Sprintf("attachment; filename=events-%s.jsonl", stamp))
		for _, ev := range events {
			if payload, err := json.Marshal(ev); err == nil {
				fmt.Fprintf(w, "%s\n", payload)
			}
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

// csvSafe neutralizes CSV formula injection: a cell starting with =, +,
// - or @ would be evaluated as a formula by spreadsheets. Prefixing a
// single quote keeps the content literal.
func csvSafe(s string) string {
	if s == "" {
		return s
	}
	switch s[0] {
	case '=', '+', '-', '@', '\t', '\r':
		return "'" + s
	default:
		return s
	}
}

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
