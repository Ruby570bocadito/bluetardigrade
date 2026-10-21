package api

import (
	"net/http"

	"github.com/Ruby570bocadito/bluetardigrade/internal/alert"
	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
)

func (h *Hub) handleEvents(w http.ResponseWriter, r *http.Request) {
	limit := limitFrom(r, 200)
	f, ok := parseRecordFilter(w, r)
	if !ok {
		return // 400 already written
	}
	h.mu.Lock()
	st := h.store
	// Snapshot the ring under the same lock RecordEvent appends and
	// trims with: reading the slice header unlocked races the
	// append/trim (torn header -> out-of-range or garbage reads).
	// Elements are immutable once inserted, so the header snapshot
	// is sufficient (export.go already used this same pattern).
	ring := h.events
	h.mu.Unlock()
	if st != nil {
		// store attached: serve the FULL history (retention
		// applies), same filters, newest first
		q, err := h.eventQuery(r.Context(), f, limit)
		if err != nil {
			h.storeQueryError(w, err)
			return
		}
		out, err := st.QueryEvents(q)
		if err != nil {
			h.storeQueryError(w, err)
			return
		}
		if out == nil {
			out = []*model.Event{}
		}
		writeJSON(w, out)
		return
	}
	out := make([]*model.Event, 0, limit)
	for i := len(ring) - 1; i >= 0 && len(out) < limit; i-- {
		if f.matchEvent(ring[i]) {
			out = append(out, ring[i])
		}
	}
	writeJSON(w, out)
}

// alertView is the wire form of an alert with the lifecycle overlay
// applied. Embedding flattens the JSON, so the shape is the Alert
// payload plus the optional status fields — downstream consumers keep
// parsing the same fields they already know.
type alertView struct {
	alert.Alert
	Status     string `json:"status,omitempty"`      // new (implicit), acknowledged, closed
	Decision   string `json:"decision,omitempty"`    // operator verdict: false_positive, authorized_activity, confirmed_incident
	StatusNote string `json:"status_note,omitempty"` // operator free-text triage note
	StatusBy   string `json:"status_by,omitempty"`   // who set it (unauthenticated free text)
	StatusAt   string `json:"status_at,omitempty"`   // RFC 3339 when the status was set
	// Assignment (TEAM-3): who owns the alert, independent of the
	// status. AssignedBy is the account that performed the assignment
	// (free text, same trust model as StatusBy); an absent assignee
	// means the alert sits in the unassigned queue.
	Assignee   string `json:"assignee,omitempty"`
	AssignedBy string `json:"assigned_by,omitempty"`
	AssignedAt string `json:"assigned_at,omitempty"`
}

// withLifecycle merges the store's entry (when any) into an alert.
// The decision shares the entry's at/by with the status: one record
// is one operator action, so there is no separate decision timestamp.
func (h *Hub) withLifecycle(a alert.Alert) alertView {
	v := alertView{Alert: a}
	v.Status = "new" // explicit default: readers never special-case missing fields
	if e, ok := h.lifecycle.Get(a.ID); ok {
		v.Status = string(e.Status)
		v.Decision = string(e.Decision)
		v.StatusNote = e.Note
		v.StatusBy = e.By
		v.StatusAt = e.At
		v.Assignee = e.Assignee
		v.AssignedBy = e.AssignedBy
		v.AssignedAt = e.AssignedAt
	}
	return v
}

func (h *Hub) handleAlerts(w http.ResponseWriter, r *http.Request) {
	limit := limitFrom(r, 100)
	f, ok := parseRecordFilter(w, r)
	if !ok {
		return // 400 already written
	}
	h.mu.Lock()
	st := h.store
	// Snapshot under the lock: same ring-race argument as
	// handleEvents (RecordAlert appends+trims under h.mu; elements
	// are immutable value copies once inserted).
	ring := h.alerts
	h.mu.Unlock()
	if st != nil {
		q, err := h.alertQuery(r.Context(), f, limit)
		if err != nil {
			h.storeQueryError(w, err)
			return
		}
		out, err := st.QueryAlerts(q)
		if err != nil {
			h.storeQueryError(w, err)
			return
		}
		if out == nil {
			out = []alert.Alert{}
		}
		// store mode serves the same lifecycle overlay as ring mode:
		// triage state must not depend on which backend answered
		views := make([]alertView, 0, len(out))
		for _, a := range out {
			views = append(views, h.withLifecycle(a))
		}
		// Assignment filter (TEAM-3): the assignment lives in the
		// lifecycle overlay, not in the store columns, so it runs on the
		// overlaid page. Page-level by design: for a COMPLETE queue (the
		// whole history, cursor included) the console uses
		// /api/alerts/search, which scans for the assignment instead.
		if f.assignee != "" {
			filtered := views[:0]
			for _, v := range views {
				if assigneeFilterMatches(v, f.assignee) {
					filtered = append(filtered, v)
				}
			}
			views = filtered
		}
		writeJSON(w, views)
		return
	}
	out := make([]alertView, 0, limit)
	for i := len(ring) - 1; i >= 0 && len(out) < limit; i-- {
		a := ring[i]
		// alertTime decides whether the record can be evaluated against
		// the requested time bounds (see its doc): the parse is only a
		// prerequisite when the query actually filters by time.
		if ts, ok := f.alertTime(a); ok && f.matchAlert(a, ts) {
			v := h.withLifecycle(a)
			// The ring is scanned whole, so the assignment filter is
			// exact here: a mine or unassigned-queue view never hides a
			// matching alert behind the limit.
			if assigneeFilterMatches(v, f.assignee) {
				out = append(out, v)
			}
		}
	}
	writeJSON(w, out)
}
