// Alert assignment (TEAM-3): who owns an alert, independent of its
// triage status. Two endpoints, both backed by the lifecycle store —
// the same persistence as POST /api/alerts/{id}/status, so assignments
// survive ring eviction exactly like statuses do:
//
//	POST /api/alerts/{id}/assign   one alert (assign, reassign, unassign)
//	POST /api/alerts/assign        a batch from the console selection bar
//
// The assignee is the account name the console states in the body (the
// engine has no account registry; same trust model as the triage "by"
// field). Assignment never touches status, decision or note: a bulk
// assignment from the selection bar must not wipe a triage form another
// operator has half filled. Every mutation is logged one line per alert
// and broadcast as an `alert_lifecycle` SSE frame (the SAME topic the
// status endpoint uses, carrying the full entry), so live consoles
// update their overlay without a new subscription kind.

package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"

	"github.com/Ruby570bocadito/bluetardigrade/internal/lifecycle"
)

// MaxBulkAssign caps one batch: the selection bar selects visible rows,
// not the whole queue, and one request must never walk the lifecycle
// store for minutes. Past the cap the request answers 400 instead of
// silently truncating a half-applied batch.
const MaxBulkAssign = 200

// assignRequest is the body of both assign endpoints. An empty
// assignee unassigns; the fields are trimmed (a name of blanks is a
// bug, not an operator).
type assignRequest struct {
	Assignee string `json:"assignee"`
	By       string `json:"by"`
}

// assignBulkRequest is the body of POST /api/alerts/assign.
type assignBulkRequest struct {
	IDs      []string `json:"ids"`
	Assignee string   `json:"assignee"`
	By       string   `json:"by"`
}

// assignResult is the per-id outcome of a batch: ok carries the updated
// entry (the caller merges it straight into its overlay); a failure
// names the reason and never aborts the rest of the batch.
type assignResult struct {
	AlertID string          `json:"alert_id"`
	OK      bool            `json:"ok"`
	Entry   lifecycle.Entry `json:"entry,omitempty"`
	Error   string          `json:"error,omitempty"`
}

// assignBulkResponse is the wire form of a batch. HTTP status stays 200
// even with per-id failures: the request was well formed, the outcome
// is per id (mirrors how scoped callers see a mix of theirs and
// unknown ids).
type assignBulkResponse struct {
	Assigned int            `json:"assigned"`
	Failed   int            `json:"failed"`
	Results  []assignResult `json:"results"`
}

// assignError is the failure of ONE assignment, with the HTTP status
// the single-alert endpoint would answer.
type assignError struct {
	status int
	msg    string
}

// parseAssignRequest reads and validates the shared body of both
// endpoints. It writes the error response itself when the body is
// unusable, so the caller can simply bail out.
func parseAssignRequest(w http.ResponseWriter, r *http.Request, limit int64) (assignRequest, bool) {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, limit))
	if err != nil {
		writeErr(w, http.StatusBadRequest, fmt.Sprintf("unreadable or oversized request body (%d KiB limit)", limit/1024))
		return assignRequest{}, false
	}
	var req assignRequest
	if err := json.Unmarshal(body, &req); err != nil {
		writeErr(w, http.StatusBadRequest, `invalid JSON body: want {"assignee":"ana","by":"beto"} (empty assignee unassigns)`)
		return assignRequest{}, false
	}
	req.Assignee = strings.TrimSpace(req.Assignee)
	req.By = strings.TrimSpace(req.By)
	if len(req.Assignee) > lifecycle.MaxAssigneeLen {
		writeErr(w, http.StatusBadRequest, fmt.Sprintf("assignee longer than %d characters", lifecycle.MaxAssigneeLen))
		return assignRequest{}, false
	}
	if len(req.By) > lifecycle.MaxByLen {
		writeErr(w, http.StatusBadRequest, fmt.Sprintf("by longer than %d characters", lifecycle.MaxByLen))
		return assignRequest{}, false
	}
	return req, true
}

// assignOne performs the assignment of ONE alert for the request's
// scope, mirroring handleAlertStatus: the lifecycle store is keyed by
// id, so the alert does NOT need to be in the ring or the store unless
// the caller is scoped (a scoped caller may only assign the alerts of
// its groups, and any other id answers like one that does not exist).
// Broadcast and audit log happen here, once per alert, whatever the
// endpoint that reached for it.
func (h *Hub) assignOne(r *http.Request, id, assignee, by string) (lifecycle.Entry, *assignError) {
	sc := scopeFrom(r)
	target, found, err := h.alertByID(r.Context(), id)
	if err != nil {
		if sc != nil {
			return lifecycle.Entry{}, &assignError{http.StatusInternalServerError, "alert lookup failed (see engine log)"}
		}
		// unrestricted assignment never depended on finding the alert
		log.Printf("[API] alert %s: lookup for the stream failed: %v", id, err)
	}
	if sc != nil && (!found || !sc.allows(target.Host)) {
		return lifecycle.Entry{}, &assignError{http.StatusNotFound, "unknown alert id"}
	}
	e, err := h.lifecycle.Assign(id, assignee, by)
	if err != nil {
		// Same classification contract as the status endpoint: the
		// sentinel means "recorded in memory, not persisted" (500,
		// generic body); everything else is a rejected request (400).
		if errors.Is(err, lifecycle.ErrPersistFailed) {
			log.Printf("[API] alert assignment persist FAILED for %s: %v", id, err)
			return lifecycle.Entry{}, &assignError{http.StatusInternalServerError, "assignment recorded in memory but persistence failed (see engine log)"}
		}
		return lifecycle.Entry{}, &assignError{http.StatusBadRequest, err.Error()}
	}
	if assignee == "" {
		log.Printf("[API] alert %s unassigned (by=%s)", id, oneLine(by))
	} else {
		log.Printf("[API] alert %s assigned to %s (by=%s)", id, oneLine(assignee), oneLine(by))
	}
	if found {
		h.broadcast("alert_lifecycle", e, target.Host)
	} else {
		h.broadcast("alert_lifecycle", e)
	}
	return e, nil
}

// handleAlertAssign serves POST /api/alerts/{id}/assign: assign,
// reassign or unassign ONE alert. The response is the full updated
// lifecycle entry, the same shape the status endpoint returns.
func (h *Hub) handleAlertAssign(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !alertIDPattern.MatchString(id) {
		writeErr(w, http.StatusBadRequest,
			fmt.Sprintf("malformed alert id %q: want 16 lowercase hex characters (the id field of the alert)", id))
		return
	}
	req, ok := parseAssignRequest(w, r, 8192)
	if !ok {
		return // 400 already written
	}
	e, fail := h.assignOne(r, id, req.Assignee, req.By)
	if fail != nil {
		writeErr(w, fail.status, fail.msg)
		return
	}
	writeJSON(w, e)
}

// handleAlertAssignBulk serves POST /api/alerts/assign: the batch form
// the console selection bar uses. Ids are deduplicated in order (the
// same alert twice in one request is one write, not two); each id
// reports its own outcome, and one bad id never blocks the rest.
func (h *Hub) handleAlertAssignBulk(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 65536))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "unreadable or oversized request body (64 KiB limit)")
		return
	}
	var req assignBulkRequest
	if err := json.Unmarshal(body, &req); err != nil {
		writeErr(w, http.StatusBadRequest, `invalid JSON body: want {"ids":["..."],"assignee":"ana","by":"beto"} (empty assignee unassigns the batch)`)
		return
	}
	req.Assignee = strings.TrimSpace(req.Assignee)
	req.By = strings.TrimSpace(req.By)
	if len(req.Assignee) > lifecycle.MaxAssigneeLen {
		writeErr(w, http.StatusBadRequest, fmt.Sprintf("assignee longer than %d characters", lifecycle.MaxAssigneeLen))
		return
	}
	if len(req.By) > lifecycle.MaxByLen {
		writeErr(w, http.StatusBadRequest, fmt.Sprintf("by longer than %d characters", lifecycle.MaxByLen))
		return
	}
	if len(req.IDs) == 0 {
		writeErr(w, http.StatusBadRequest, "ids must list at least one alert id")
		return
	}
	if len(req.IDs) > MaxBulkAssign {
		writeErr(w, http.StatusBadRequest, fmt.Sprintf("too many ids: %d (the limit is %d per request)", len(req.IDs), MaxBulkAssign))
		return
	}
	res := assignBulkResponse{Results: []assignResult{}}
	seen := map[string]bool{}
	for _, id := range req.IDs {
		if seen[id] {
			continue // first occurrence wins; duplicates never double-write
		}
		seen[id] = true
		if !alertIDPattern.MatchString(id) {
			res.Failed++
			res.Results = append(res.Results, assignResult{
				AlertID: id, OK: false,
				Error: fmt.Sprintf("malformed alert id %q: want 16 lowercase hex characters", id),
			})
			continue
		}
		e, fail := h.assignOne(r, id, req.Assignee, req.By)
		if fail != nil {
			res.Failed++
			res.Results = append(res.Results, assignResult{AlertID: id, OK: false, Error: fail.msg})
			continue
		}
		res.Assigned++
		res.Results = append(res.Results, assignResult{AlertID: id, OK: true, Entry: e})
	}
	writeJSON(w, res)
}
