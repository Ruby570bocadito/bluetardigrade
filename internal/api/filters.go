// Shared query filters for the telemetry endpoints (lists and exports):
// /api/events, /api/alerts and both /export variants accept the same
// parameters so an analyst narrows a dataset identically whether they
// are browsing it or handing it to a SIEM. Invalid values answer 400
// with an actionable message instead of silently returning everything.

package api

import (
	"net/http"
	"strings"
	"time"

	"github.com/Ruby570bocadito/security-framework/internal/alert"
	"github.com/Ruby570bocadito/security-framework/internal/rules"
	"github.com/Ruby570bocadito/security-framework/pkg/model"
)

// recordFilter is the parsed form of the filter query parameters.
type recordFilter struct {
	host   string   // exact, case-insensitive
	sevs   []string // alert only: accepted severities (empty = any)
	ruleID string   // alert only: exact rule id
	evType string   // event only: exact event type
	since  time.Time
	until  time.Time
	q      string // free-text substring, case-insensitive
}

// parseRecordFilter reads and validates the filter parameters, writing
// a 400 and returning false on an invalid value.
func parseRecordFilter(w http.ResponseWriter, r *http.Request) (*recordFilter, bool) {
	q := r.URL.Query()
	f := &recordFilter{
		host:   strings.ToLower(strings.TrimSpace(q.Get("host"))),
		ruleID: strings.TrimSpace(q.Get("rule_id")),
		evType: strings.TrimSpace(q.Get("type")),
		// The store joins its search column with \x1f so a needle
		// can never match across two field boundaries; the same
		// rune arriving URL-encoded in the query (%1F) would
		// forge exactly that crossing, and the ring (per-field
		// matching) and the store would drift apart on the same
		// question. Strip it at this chokepoint both backends
		// share; the store's likeNeedle strips it again for
		// legacy rows and direct callers.
		q: strings.ToLower(strings.ReplaceAll(q.Get("q"), "\x1f", "")),
	}
	for _, s := range splitCSV(q.Get("severity")) {
		switch s {
		case rules.SevInfo, rules.SevLow, rules.SevMedium, rules.SevHigh, rules.SevCritical:
			f.sevs = append(f.sevs, s)
		default:
			http.Error(w, "invalid severity "+s+": use info, low, medium, high or critical (comma separated)", http.StatusBadRequest)
			return nil, false
		}
	}
	var err error
	if f.since, err = parseTimeParam(q.Get("since")); err != nil {
		http.Error(w, "invalid since: "+err.Error(), http.StatusBadRequest)
		return nil, false
	}
	if f.until, err = parseTimeParam(q.Get("until")); err != nil {
		http.Error(w, "invalid until: "+err.Error(), http.StatusBadRequest)
		return nil, false
	}
	if !f.since.IsZero() && !f.until.IsZero() && f.until.Before(f.since) {
		http.Error(w, "invalid range: until is before since", http.StatusBadRequest)
		return nil, false
	}
	return f, true
}

// splitCSV splits a comma separated parameter, trimming and dropping
// empty items, preserving the caller's intent of "no filter" for "".
func splitCSV(s string) []string {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	out := []string{}
	for _, p := range strings.Split(s, ",") {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

// parseTimeParam accepts RFC 3339 timestamps ("2026-09-30T12:00:00Z")
// or relative durations understood as "now minus d" ("90m", "2h", "24h"),
// which is what an analyst types when trimming a noisy window. Empty
// returns the zero time (no bound).
func parseTimeParam(s string) (time.Time, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return time.Time{}, nil
	}
	if t, err := time.Parse(time.RFC3339, s); err == nil {
		return t, nil
	}
	if d, err := time.ParseDuration(s); err == nil && d > 0 {
		return time.Now().Add(-d), nil
	}
	return time.Time{}, errBadTime(s)
}

type badTimeError string

func (e badTimeError) Error() string {
	return string(e) + " is not an RFC 3339 timestamp nor a positive duration (e.g. 2026-09-30T12:00:00Z or 90m)"
}

func errBadTime(s string) error { return badTimeError(s) }

// inWindow reports whether ts passes the since/until bounds.
func (f *recordFilter) inWindow(ts time.Time) bool {
	if !f.since.IsZero() && ts.Before(f.since) {
		return false
	}
	if !f.until.IsZero() && ts.After(f.until) {
		return false
	}
	return true
}

// matchAlert applies every set filter to an alert.
func (f *recordFilter) matchAlert(a alert.Alert, ts time.Time) bool {
	if f.host != "" && strings.ToLower(a.Host) != f.host {
		return false
	}
	if len(f.sevs) > 0 && !containsFold(f.sevs, a.Severity) {
		return false
	}
	if f.ruleID != "" && a.RuleID != f.ruleID {
		return false
	}
	if !f.inWindow(ts) {
		return false
	}
	if f.q != "" && !alertHaystack(a, f.q) {
		return false
	}
	return true
}

// matchEvent applies every set filter to an event.
func (f *recordFilter) matchEvent(ev *model.Event) bool {
	if f.host != "" && strings.ToLower(ev.Host) != f.host {
		return false
	}
	if f.evType != "" && ev.Type != f.evType {
		return false
	}
	if !f.inWindow(ev.Timestamp) {
		return false
	}
	if f.q != "" && !eventHaystack(ev, f.q) {
		return false
	}
	return true
}

func containsFold(list []string, s string) bool {
	for _, x := range list {
		if strings.EqualFold(x, s) {
			return true
		}
	}
	return false
}

// alertHaystack is the free-text surface of an alert: identifiers,
// context and the rendered message, all lowercase-contains.
func alertHaystack(a alert.Alert, needle string) bool {
	parts := []string{
		a.RuleID, a.RuleName, a.Host, a.User, a.Summary, a.Message,
		a.EventType, a.Severity,
		strings.Join(a.Tags, " "), strings.Join(a.MatchedOn, " "),
	}
	return containsFoldAll(parts, needle)
}

// eventHaystack is the free-text surface of an event.
func eventHaystack(ev *model.Event, needle string) bool {
	parts := []string{ev.ID, ev.Type, ev.Source, ev.Host, ev.User}
	if ev.Process != nil {
		parts = append(parts, ev.Process.Name, ev.Process.CommandLine)
	}
	if ev.File != nil {
		parts = append(parts, ev.File.Path)
	}
	if ev.Network != nil {
		parts = append(parts, ev.Network.DestinationIP, ev.Network.Domain)
	}
	if ev.Registry != nil {
		parts = append(parts, ev.Registry.Key, ev.Registry.ValueName)
	}
	if ev.Target != nil {
		parts = append(parts, ev.Target.Name)
	}
	return containsFoldAll(parts, needle)
}

func containsFoldAll(parts []string, needle string) bool {
	for _, p := range parts {
		if p != "" && strings.Contains(strings.ToLower(p), needle) {
			return true
		}
	}
	return false
}
