// Package report aggregates the data the engine already serves into
// the REP-1 report catalog: executive summary, incident case bundle,
// fleet coverage and SOC activity, plus the noise report of
// PLAN-DETALLADO §2.4. Reports only read: they never change alert
// lifecycle, never touch a host and never execute anything. Every
// builder is a pure function over inputs the API layer gathers (alerts
// with their triage overlay, events, fleet snapshot, incidents), so the
// numbers are unit-testable without HTTP or a store, and the CSV views
// keep the same spreadsheet formula escaping as the export endpoints.
//
// Reports whose underlying data is not there yet (AD posture, logon
// audit, noise-suppression machinery) are deliberately absent: the
// catalog only lists what the engine can actually compute today.
package report

import (
	"fmt"
	"strings"
	"time"
	"unicode"
)

// Report kinds served by GET /api/reports/{kind}. The catalog endpoint
// lists the same values.
const (
	KindExecutive = "executive"
	KindIncident  = "incident"
	KindFleet     = "fleet"
	KindSoc       = "soc"
)

// KindNoise is served by GET /api/noise (its own endpoint per
// PLAN-DETALLADO §2.4, JSON only) and is NOT part of the reports
// catalog route, but it shares the envelope types below.
const KindNoise = "noise"

// Data sources reported by every builder: the SQLite store serves the
// full retention window; the in-memory rings only cover the most
// recent records, so ring-mode reports carry OldestRecord honestly.
const (
	SourceStore = "store"
	SourceRing  = "ring"
)

// Window bounds of a report. Preset echoes the requested value ("24h",
// "7d", "30d" or any Go duration); From/Until are the resolved UTC
// instants so a consumer can render the range without re-parsing.
type Window struct {
	Preset string    `json:"preset"`
	From   time.Time `json:"from"`
	Until  time.Time `json:"until"`
}

// Window bounds per report kind: the executive and SOC reports look at
// triage-paced data (1h floor is plenty), the noise report follows
// PLAN-DETALLADO §2.4 (default 24h) and never looks further back than
// the retention the engine documents (30 days).
var windowBounds = map[string]struct {
	def time.Duration
	min time.Duration
	max time.Duration
}{
	KindExecutive: {def: 168 * time.Hour, min: time.Hour, max: 30 * 24 * time.Hour},
	KindFleet:     {def: 168 * time.Hour, min: time.Hour, max: 30 * 24 * time.Hour},
	KindSoc:       {def: 168 * time.Hour, min: time.Hour, max: 30 * 24 * time.Hour},
	KindNoise:     {def: 24 * time.Hour, min: 15 * time.Minute, max: 30 * 24 * time.Hour},
}

// ParseWindow resolves the ?window= parameter for a report kind:
// presets are ordinary Go durations ("24h", "7d", "30d"), the kind's
// default applies when empty, and values outside the kind's bounds are
// an actionable error (the API answers 400) instead of a silently
// clamped range. Until is the generation instant itself — records
// written a millisecond before the request must not fall out of the
// window over a second-boundary truncation.
func ParseWindow(kind, s string) (Window, error) {
	b, ok := windowBounds[kind]
	if !ok {
		return Window{}, fmt.Errorf("unknown report kind %q", kind)
	}
	s = strings.TrimSpace(s)
	if s == "" {
		s = b.def.String()
	}
	d, err := time.ParseDuration(s)
	if err != nil || d <= 0 {
		return Window{}, fmt.Errorf("invalid window %q: use a positive duration (e.g. 24h, 7d, 30d)", s)
	}
	if d < b.min || d > b.max {
		return Window{}, fmt.Errorf("window %s out of range for %s: between %s and %s", s, kind, b.min, b.max)
	}
	until := time.Now().UTC()
	return Window{Preset: s, From: until.Add(-d), Until: until}, nil
}

// AlertInput is one alert flattened to what the builders need: the
// alert identity and classification plus the triage overlay resolved
// by the API layer (lifecycle entries), so a builder never reaches
// into mutable engine state.
type AlertInput struct {
	ID        string   `json:"id"`
	RuleID    string   `json:"rule_id"`
	RuleName  string   `json:"rule_name"`
	Severity  string   `json:"severity"`
	Host      string   `json:"host"`
	EventType string   `json:"event_type"`
	Timestamp string   `json:"timestamp"` // RFC 3339 (Nano), as the engine stores it
	Summary   string   `json:"summary,omitempty"`
	Tags      []string `json:"tags,omitempty"`
	Status    string   `json:"status"` // new | acknowledged | closed
	StatusAt  string   `json:"status_at,omitempty"`
	StatusBy  string   `json:"status_by,omitempty"`
}

// Time parses the alert timestamp; ok is false for records whose
// timestamp cannot prove window membership (same standard as the
// export endpoints: with a bound set, an unreadable timestamp stays
// excluded rather than silently counted).
func (a AlertInput) Time() (time.Time, bool) {
	t, err := time.Parse(time.RFC3339Nano, a.Timestamp)
	if err != nil {
		return time.Time{}, false
	}
	return t, true
}

// tacticOf derives the ATT&CK tactic label from rule tags the same way
// the console payload does ("attack.credential-access" ->
// "Credential Access"). First tactic tag wins, matching the alert view.
func tacticOf(tags []string) string {
	for _, t := range tags {
		if !strings.HasPrefix(t, "attack.") || strings.HasPrefix(t, "attack.t") {
			continue
		}
		parts := strings.Split(strings.TrimPrefix(t, "attack."), "-")
		for i, p := range parts {
			if p == "" {
				continue
			}
			r := []rune(p)
			r[0] = unicode.ToUpper(r[0])
			parts[i] = string(r)
		}
		return strings.Join(parts, " ")
	}
	return ""
}

// Tabular is the CSV slice of a report: the same data the JSON view
// carries, flattened into one deterministic table.
type Tabular struct {
	Header []string
	Rows   [][]string
}

// SafeCell prefixes textual formula/control characters with an
// apostrophe, including full-width variants and prefixes after leading
// whitespace — the exact contract of the export endpoints' csvSafe, so
// every CSV this engine serves escapes the same way.
func SafeCell(s string) string {
	for _, ch := range s {
		switch ch {
		case '=', '+', '-', '@', '＝', '＋', '－', '＠', '\t', '\r', '\n':
			return "'" + s
		}
		if !unicode.IsSpace(ch) {
			break
		}
	}
	return s
}

// CatalogEntry describes one report kind for GET /api/reports: enough
// for a console to render the picker without hard-coding kinds.
type CatalogEntry struct {
	Kind        string            `json:"kind"`
	Title       string            `json:"title"`
	Description string            `json:"description"`
	Params      map[string]string `json:"params"` // accepted query parameters and their meaning
	Formats     []string          `json:"formats"`
}

// Catalog returns the report kinds the engine can compute today, in a
// stable order. Kinds that need data the engine does not have yet (AD
// posture, logon audit) are deliberately absent — REP-1 grows the
// catalog as the engine grows.
func Catalog() []CatalogEntry {
	return []CatalogEntry{
		{
			Kind:        KindExecutive,
			Title:       "Executive summary",
			Description: "Alert volume and severity, triage status, ATT&CK tactics, affected hosts, top rules and incident counts over the window, with the fleet snapshot at generation time.",
			Params:      params("7d"),
			Formats:     []string{"json", "csv"},
		},
		{
			Kind:        KindIncident,
			Title:       "Incident report",
			Description: "One investigation case: the incident record with its timeline and every alert it groups, each with its current triage status.",
			Params:      map[string]string{"id": "incident id (16 hex, required)", "format": "json | csv (default json)"},
			Formats:     []string{"json", "csv"},
		},
		{
			Kind:        KindFleet,
			Title:       "Fleet coverage",
			Description: "Per-host inventory from the machine tracker: status, first/last seen, lifetime events, events inside the window and the last sensor health report; hosts without signal in the window are counted.",
			Params:      params("7d"),
			Formats:     []string{"json", "csv"},
		},
		{
			Kind:        KindSoc,
			Title:       "SOC activity",
			Description: "Triage throughput over the window: alerts created per UTC day, mean time to acknowledge and close, per-operator actions and the current open backlog.",
			Params:      params("7d"),
			Formats:     []string{"json", "csv"},
		},
	}
}

func params(windowDefault string) map[string]string {
	return map[string]string{
		"window": "24h | 7d | 30d (default " + windowDefault + ")",
		"format": "json | csv (default json)",
	}
}
