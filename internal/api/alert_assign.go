// Assignment write surface (TEAM-3 / M-1): POST /api/alerts/{id}/assign
// and POST /api/alerts/assign-batch put an alert in an operator's hands
// and take it out again, without triaging it — assignment is WHO owns
// the triage, status is WHERE the triage sits, and the lifecycle store
// keeps both concerns separate on purpose (see lifecycle.Entry).
//
// The surface follows the triage endpoint's guarantees line by line:
// registered unconditionally (assignment is human-paced and always
// available — arming it behind -api-write would strand the unassigned
// queue behind a flag the console cannot see), 8 KiB body cap, the
// write-origin guard (both routes are POST, so guardWriteOrigin already
// covers them), host-group scoping via X-SF-Scope (a scoped caller may
// only assign the alerts of its groups; anything else answers like an
// unknown id) and the same `alert_lifecycle` SSE topic the console
// already consumes, so «Mis alertas» and the queue update live with no
// new subscription.
//
// The batch route is deliberately NOT atomic: the console's selection
// bar mixes fresh and evicted ids, and one unknown id must not make the
// operator redo the whole selection. The response splits assigned and
// failed per id; the HTTP status stays 200 either way. Unlike the
// single route (permissive like triage: an unseen id records its
// assignment for when the alert shows up), EVERY batch id must name a
// real alert — a bulk write that "succeeds" on garbage ids would fill
// the store with phantom assignments the queue cannot show. The
// per-id failure is the console's signal that its selection went stale.

package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"

	"github.com/Ruby570bocadito/bluetardigrade/internal/alert"
	"github.com/Ruby570bocadito/bluetardigrade/internal/lifecycle"
)

// assignMaxBodyBytes caps every assignment request body, same limit and
// rationale as the triage endpoint (a handful of short fields, not a
// data channel). At ~19 bytes per id (16 hex + quotes + comma) the cap
// doubles as a soft batch ceiling of ~400 ids.
const assignMaxBodyBytes = 8192

// batchMaxIDs is the hard ceiling of the batch route, independent of
// the body cap: an explicit contract number beats one derived from
// byte arithmetic, and the 400 names it.
const batchMaxIDs = 500

// assignRequest is the body of both assignment routes (the batch adds
// ids). Assignee "" means unassign; by names who performed the action
// for the audit trail — both are client-controlled free text forwarded
// by the console proxy, kept single-line in the log like the triage's
// by.
type assignRequest struct {
	Assignee string   `json:"assignee"`
	By       string   `json:"by"`
	IDs      []string `json:"ids,omitempty"` // batch route only
}

// assignFailure is one id the batch could not assign, with the reason
// that id failed (validation, unknown, out of scope). Messages are the
// same strings the single route answers with.
type assignFailure struct {
	ID    string `json:"id"`
	Error string `json:"error"`
}

// assignBatchResponse reports the per-id outcome. HTTP 200 regardless
// of failures — the caller asked for N independent writes, not a
// transaction.
type assignBatchResponse struct {
	Assigned []string        `json:"assigned"`
	Failed   []assignFailure `json:"failed"`
}

// registerAssign wires the assignment routes. Same registration style
// as the triage route: unconditional, so the contract never depends on
// a deployment flag.
func (h *Hub) registerAssign(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/alerts/{id}/assign", h.handleAlertAssign)
	mux.HandleFunc("POST /api/alerts/assign-batch", h.handleAlertAssignBatch)
}

// parseAssignBody reads and validates the request body. The zero
// assignee is MEANINGFUL (unassign), so absence and emptiness are the
// same request by design — the console sends {"assignee":""} to clear,
// and a client that omits the field entirely gets the same, documented
// outcome instead of a surprising 400.
func (h *Hub) parseAssignBody(w http.ResponseWriter, r *http.Request, allowIDs bool) (assignRequest, bool) {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, assignMaxBodyBytes))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "unreadable or oversized request body (8 KiB limit)")
		return assignRequest{}, false
	}
	var req assignRequest
	if err := json.Unmarshal(body, &req); err != nil {
		writeErr(w, http.StatusBadRequest,
			`invalid JSON body: want {"assignee":"name" or "" to unassign,"by":"who","ids":["..."] (batch only)}`)
		return assignRequest{}, false
	}
	if !allowIDs && len(req.IDs) > 0 {
		writeErr(w, http.StatusBadRequest, "the ids field belongs to POST /api/alerts/assign-batch")
		return assignRequest{}, false
	}
	if len(req.Assignee) > lifecycle.MaxAssigneeLen {
		writeErr(w, http.StatusBadRequest,
			fmt.Sprintf("assignee longer than %d characters", lifecycle.MaxAssigneeLen))
		return assignRequest{}, false
	}
	if len(req.By) > lifecycle.MaxByLen {
		writeErr(w, http.StatusBadRequest,
			fmt.Sprintf("by longer than %d characters", lifecycle.MaxByLen))
		return assignRequest{}, false
	}
	return req, true
}

// scopedAlertForAssign resolves one alert for a scoped (or unrestricted)
// caller without writing anything: it returns the alert (when found),
// whether the caller may act on it, and a server-side lookup failure.
// Unrestricted callers never depended on finding the alert (same
// standard as the triage endpoint): an unknown id still records its
// assignment, and it surfaces if the alert shows up later.
func (h *Hub) scopedAlertForAssign(r *http.Request, id string) (target alert.Alert, allowed bool, lookupErr error) {
	sc := scopeFrom(r)
	if sc == nil {
		// unrestricted callers never depended on finding the alert: the
		// lookup only feeds the SSE frame's host scoping
		tgt, _, err := h.alertByID(r.Context(), id)
		if err != nil {
			log.Printf("[API] alert %s: lookup for the stream failed: %v", id, err)
		}
		return tgt, true, nil
	}
	target, found, err := h.alertByID(r.Context(), id)
	if err != nil {
		return alert.Alert{}, false, err
	}
	if !found || !sc.allows(target.Host) {
		return alert.Alert{}, false, nil
	}
	return target, true, nil
}

// applyAssign runs one assignment through the store and broadcasts it.
// Error classification is structural (sentinel + errors.Is), never
// message matching: persistence failures are the server's fault (500
// with a GENERIC body — the wrapped error names local paths that must
// not reach the wire), validation failures are the client's (400 with
// the actionable message).
func (h *Hub) applyAssign(w http.ResponseWriter, r *http.Request, id string, req assignRequest) {
	e, err := h.lifecycle.Assign(id, req.Assignee, req.By)
	if err != nil {
		if errors.Is(err, lifecycle.ErrPersistFailed) {
			log.Printf("[API] alert lifecycle persist FAILED for %s: %v", id, err)
			writeErr(w, http.StatusInternalServerError, "assignment recorded in memory but persistence failed (see engine log)")
			return
		}
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.Assignee == "" {
		log.Printf("[API] alert %s unassigned (by=%s)", id, oneLine(req.By))
	} else {
		log.Printf("[API] alert %s assigned to %s (by=%s)", id, oneLine(req.Assignee), oneLine(req.By))
	}
	target, found, lookupErr := h.scopedAlertForAssign(r, id)
	if lookupErr != nil {
		// the assignment is already recorded; only the frame's host
		// scoping is degraded — log it, broadcast unscoped and answer
		log.Printf("[API] alert %s: lookup for the stream failed: %v", id, lookupErr)
		h.broadcast("alert_lifecycle", e)
		writeJSON(w, e)
		return
	}
	if found {
		h.broadcast("alert_lifecycle", e, target.Host)
	} else {
		h.broadcast("alert_lifecycle", e)
	}
	writeJSON(w, e)
}

// handleAlertAssign assigns, reassigns (assigning over) or unassigns
// ONE alert. The alert does not need to be in the 256-entry ring and
// its status is untouched: assigning is not triaging (a closed alert
// can be handed back for review).
func (h *Hub) handleAlertAssign(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !alertIDPattern.MatchString(id) {
		writeErr(w, http.StatusBadRequest,
			fmt.Sprintf("malformed alert id %q: want 16 lowercase hex characters (the id field of the alert)", id))
		return
	}
	req, ok := h.parseAssignBody(w, r, false)
	if !ok {
		return // 400 already written
	}
	// scope check BEFORE any write: a scoped caller must not leave a
	// trace on alerts outside its groups (same order as triage)
	if sc := scopeFrom(r); sc != nil {
		_, allowed, lookupErr := h.scopedAlertForAssign(r, id)
		if lookupErr != nil {
			h.storeQueryError(w, lookupErr)
			return
		}
		if !allowed {
			writeErr(w, http.StatusNotFound, "unknown alert id")
			return
		}
	}
	h.applyAssign(w, r, id, req)
}

// handleAlertAssignBatch assigns (or unassigns with assignee "") a LIST
// of alerts in one request — the console's selection bar. Per-id
// outcome, 200 always: one unknown or out-of-scope id never voids the
// rest. Every id must resolve to a real alert (ring or store) whatever
// the caller's scope — see the file comment for why the batch is
// stricter than the single route. Scoped callers additionally cannot
// touch alerts outside their groups; those ids come back as failed
// with "unknown alert id" (a scoped caller cannot distinguish them
// from ids that truly do not exist — same answer the single route
// gives).
func (h *Hub) handleAlertAssignBatch(w http.ResponseWriter, r *http.Request) {
	req, ok := h.parseAssignBody(w, r, true)
	if !ok {
		return // 400 already written
	}
	if len(req.IDs) == 0 {
		writeErr(w, http.StatusBadRequest,
			`empty ids: want {"ids":["hex16",...],"assignee":"name" or "" to unassign,"by":"who"}`)
		return
	}
	if len(req.IDs) > batchMaxIDs {
		writeErr(w, http.StatusBadRequest,
			fmt.Sprintf("too many ids: %d (batch limit is %d)", len(req.IDs), batchMaxIDs))
		return
	}
	out := assignBatchResponse{Assigned: []string{}, Failed: []assignFailure{}}
	for _, id := range req.IDs {
		if !alertIDPattern.MatchString(id) {
			out.Failed = append(out.Failed, assignFailure{ID: id,
				Error: "malformed alert id: want 16 lowercase hex characters"})
			continue
		}
		// existence first, for EVERY caller: no phantom assignments in bulk
		target, found, lookupErr := h.alertByID(r.Context(), id)
		if lookupErr != nil {
			log.Printf("[API] alert %s: lookup for the batch failed: %v", id, lookupErr)
			out.Failed = append(out.Failed, assignFailure{ID: id, Error: "lookup failed"})
			continue
		}
		if !found {
			out.Failed = append(out.Failed, assignFailure{ID: id, Error: "unknown alert id"})
			continue
		}
		if sc := scopeFrom(r); sc != nil && !sc.allows(target.Host) {
			out.Failed = append(out.Failed, assignFailure{ID: id, Error: "unknown alert id"})
			continue
		}
		e, err := h.lifecycle.Assign(id, req.Assignee, req.By)
		if err != nil {
			if errors.Is(err, lifecycle.ErrPersistFailed) {
				// every remaining id will hit the same disk: stop the
				// batch here, the response shows exactly how far it got
				log.Printf("[API] alert lifecycle persist FAILED for %s: %v", id, err)
				out.Failed = append(out.Failed, assignFailure{ID: id,
					Error: "assignment recorded in memory but persistence failed (see engine log)"})
				for _, rest := range req.IDs[len(out.Assigned)+len(out.Failed):] {
					out.Failed = append(out.Failed, assignFailure{ID: rest, Error: "not attempted (persistence failing)"})
				}
				break
			}
			out.Failed = append(out.Failed, assignFailure{ID: id, Error: err.Error()})
			continue
		}
		out.Assigned = append(out.Assigned, id)
		h.broadcast("alert_lifecycle", e, target.Host)
	}
	if req.Assignee == "" {
		log.Printf("[API] assign-batch: %d unassigned, %d failed (by=%s)",
			len(out.Assigned), len(out.Failed), oneLine(req.By))
	} else {
		log.Printf("[API] assign-batch: %d assigned to %s, %d failed (by=%s)",
			len(out.Assigned), oneLine(req.Assignee), len(out.Failed), oneLine(req.By))
	}
	writeJSON(w, out)
}

// assignFilter is the parsed form of the assignment query filters of
// GET /api/alerts: assignee=<name> («Mis alertas» when the console
// passes the account) and unassigned=true (the unassigned queue).
type assignFilter struct {
	assignee   string
	unassigned bool
}

// parseAssignFilter reads the two lifecycle-level filters. Strict on
// values, like every query filter of this API: an unknown unassigned
// value is a 400, never a silent "false". assignee + unassigned at
// once is contradictory (a named owner AND no owner): loud 400 instead
// of an empty page the caller would read as "nothing to do".
func parseAssignFilter(r *http.Request) (assignFilter, error) {
	q := r.URL.Query()
	af := assignFilter{assignee: q.Get("assignee")}
	switch v := q.Get("unassigned"); v {
	case "":
		af.unassigned = false
	case "true", "1":
		af.unassigned = true
	default:
		return af, fmt.Errorf("invalid unassigned value %q: valid values are true or 1", v)
	}
	if af.assignee != "" && af.unassigned {
		return af, errors.New("contradictory filters: assignee and unassigned=true cannot combine (drop one)")
	}
	return af, nil
}

// match reports whether an overlaid alert satisfies the filter. The
// assignee compares case-insensitively, like host names everywhere else
// in this API (hosts and account names come from the same Windows
// world where the case is not significant).
func (af assignFilter) match(v alertView) bool {
	if af.assignee != "" && !strings.EqualFold(v.Assignee, af.assignee) {
		return false
	}
	if af.unassigned && v.Assignee != "" {
		return false
	}
	return true
}
