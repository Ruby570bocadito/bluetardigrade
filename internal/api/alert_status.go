package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"regexp"

	"github.com/Ruby570bocadito/bluetardigrade/internal/lifecycle"
)

// alertIDPattern is the shape alert.NewID generates (16 lowercase hex
// characters). Validating the path parameter keeps arbitrary strings
// out of the store keys and the log lines.
var alertIDPattern = regexp.MustCompile(`^[0-9a-f]{16}$`)

// statusRequest is the POST /api/alerts/{id}/status body. Decision
// is optional ("" = no verdict); see lifecycle.Decision for the
// vocabulary. The body is the FULL triage record: omitting decision
// (or note, or by) clears it — the same replace semantics the store
// applies.
type statusRequest struct {
	Status   string `json:"status"`
	Decision string `json:"decision"`
	Note     string `json:"note"`
	By       string `json:"by"`
}

// handleAlertStatus records the operator triage decision for one
// alert. The lifecycle store is the source of truth for STATUS: the
// target alert does NOT need to be in the 256-entry ring (an alert
// evicted from the ring can legitimately be closed). Success
// broadcasts an `alert_lifecycle` SSE frame so live consumers update
// without polling.
func (h *Hub) handleAlertStatus(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !alertIDPattern.MatchString(id) {
		writeErr(w, http.StatusBadRequest,
			fmt.Sprintf("malformed alert id %q: want 16 lowercase hex characters (the id field of the alert)", id))
		return
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 8192))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "unreadable or oversized request body (8 KiB limit)")
		return
	}
	var req statusRequest
	if err := json.Unmarshal(body, &req); err != nil {
		writeErr(w, http.StatusBadRequest,
			`invalid JSON body: want {"status":"acknowledged|closed|new","decision":"false_positive|authorized_activity|confirmed_incident","note":"...","by":"..."}`)
		return
	}
	st := lifecycle.Status(req.Status)
	if !lifecycle.Valid(st) {
		writeErr(w, http.StatusBadRequest,
			fmt.Sprintf("invalid status %q: valid values are new, acknowledged, closed", req.Status))
		return
	}
	decision := lifecycle.Decision(req.Decision)
	if !lifecycle.DecisionValid(decision) {
		writeErr(w, http.StatusBadRequest,
			fmt.Sprintf("invalid decision %q: valid values are false_positive, authorized_activity, confirmed_incident (omit the field for no verdict)", req.Decision))
		return
	}
	// the alert's machine tags the SSE frame (scope.go), and a scoped
	// caller may only triage the alerts of its groups: any other id
	// answers like one that does not exist
	sc := scopeFrom(r)
	target, found, err := h.alertByID(r.Context(), id)
	if err != nil {
		if sc != nil {
			h.storeQueryError(w, err)
			return
		}
		// unrestricted triage never depended on finding the alert
		log.Printf("[API] alert %s: lookup for the stream failed: %v", id, err)
	}
	if sc != nil && (!found || !sc.allows(target.Host)) {
		writeErr(w, http.StatusNotFound, "unknown alert id")
		return
	}
	e, err := h.lifecycle.Set(id, st, decision, req.Note, req.By)
	if err != nil {
		// Persistence failures are the server's fault: 500 with a
		// GENERIC body — the wrapped error names local paths that must
		// not reach the wire (details go to the engine log). Validation
		// failures are the client's: 400 with the actionable message.
		// Classification is structural (sentinel + errors.Is), never
		// message matching: error wording must not decide status codes.
		if errors.Is(err, lifecycle.ErrPersistFailed) {
			log.Printf("[API] alert lifecycle persist FAILED for %s: %v", id, err)
			writeErr(w, http.StatusInternalServerError, "status recorded in memory but persistence failed (see engine log)")
			return
		}
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	// by is client-controlled free text: keep it single-line so the
	// audit log cannot be forged with embedded newlines. The decision
	// (when present) names the verdict in the same audit line — the
	// «falso positivo» of the triage flow must be attributable the
	// same way a status change is.
	if e.Decision != "" {
		log.Printf("[API] alert %s -> %s decision=%s (by=%s)", id, e.Status, e.Decision, oneLine(e.By))
	} else {
		log.Printf("[API] alert %s -> %s (by=%s)", id, e.Status, oneLine(e.By))
	}
	if found {
		h.broadcast("alert_lifecycle", e, target.Host)
	} else {
		h.broadcast("alert_lifecycle", e)
	}
	writeJSON(w, e)
}
