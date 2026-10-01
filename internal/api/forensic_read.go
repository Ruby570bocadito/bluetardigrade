package api

import (
	"errors"
	"log"
	"net/http"

	"github.com/Ruby570bocadito/bluetardigrade/internal/forensic"
)

// handleAlertForensics serves the frozen evidence bundle of one alert:
// the alert itself plus the host's event timeline that preceded it,
// written at detection time by the flight recorder. The bundle exists
// independently of the alert ring, of SQLite and of engine restarts
// (within retention), which is the whole point: an investigation must
// not depend on where the alert currently lives.
//
// Status map (each state is distinct on purpose, so the console can
// render an honest reason instead of a generic "error"):
//
//	200 — bundle found and valid
//	400 — malformed alert id (client error)
//	401 — bearer gate (when -api-token is set)
//	404 — well-formed id but no bundle for it
//	501 — capture disabled (-forensic=false)
//	500 — bundle exists but cannot be decoded (integrity failure)
func (h *Hub) handleAlertForensics(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !alertIDPattern.MatchString(id) {
		writeErr(w, http.StatusBadRequest,
			"malformed alert id: want 16 lowercase hex characters (the id field of the alert)")
		return
	}
	h.mu.Lock()
	f := h.forensic
	h.mu.Unlock()

	if f == nil {
		// distinct from "missing": the operator disabled the feature,
		// and the console should say exactly that.
		writeErr(w, http.StatusNotImplemented,
			"forensic capture is disabled on this engine (start without -forensic=false)")
		return
	}

	b, err := f.Load(id)
	if err != nil {
		switch {
		case errors.Is(err, forensic.ErrDisabled):
			writeErr(w, http.StatusNotImplemented,
				"forensic capture is disabled on this engine (no bundle directory configured)")
		case errors.Is(err, forensic.ErrNotFound):
			writeErr(w, http.StatusNotFound, forensic.ErrNotFound.Error())
		default:
			// decode/read failures name local paths in the wrapped
			// error: log the detail, answer a generic body (the same
			// disclosure rule as the lifecycle persist failure).
			log.Printf("[API] forensic bundle %s unreadable: %v", id, err)
			writeErr(w, http.StatusInternalServerError,
				"forensic bundle exists but could not be read (see engine log)")
		}
		return
	}
	writeJSON(w, b)
}
