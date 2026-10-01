// Active response read surface (C3 console visibility, 02-B):
// GET /api/respond/state (armed flags + live counters + audit file
// health) and GET /api/respond/audit (the most recent attempts from
// the JSONL, newest first). Both follow the same contract as
// POST /api/respond/kill: registered unconditionally, a real 404 while
// the engine is unarmed — a probe must not distinguish "disarmed" from
// "does not exist", so a disarmed engine leaks no surface shape here
// either. The bearer middleware (api.go) covers both routes like every
// other /api read: the audit names operators and client addresses, so
// it never travels without the engine's credential.

package api

import (
	"net/http"

	"github.com/Ruby570bocadito/bluetardigrade/internal/respond"
)

const (
	respondAuditDefaultLimit = 100
	respondAuditMaxLimit     = 500
)

// SetRespondPaths records the active-response file paths the engine
// armed at startup (run.go resolves them) so the read surface reports
// the real flags state instead of guessing. Call after
// EnableRespondKill; harmless when the surface is disarmed (the routes
// keep answering the real 404).
func (h *Hub) SetRespondPaths(operators, protected, audit string) {
	h.mu.Lock()
	h.respondOpsPath, h.respondProtPath, h.respondAuditPath = operators, protected, audit
	h.mu.Unlock()
}

// respondStatePayload is the GET /api/respond/state wire contract
// (docs/api/openapi.yaml, RespondState). Armed is always true in a
// 200: a disarmed engine answers the real 404 above. The paths are the
// startup flags (operators/protected optional), the counts are LIVE
// (the 15 s hot-reload changes them under a running engine) and the
// audit size travels with its ceiling so the console can show how
// close the proof surface is to the rotation wall.
type respondStatePayload struct {
	Armed          bool   `json:"armed"`
	Signal         string `json:"signal"`
	OperatorsCount int    `json:"operators_count"`
	ProtectedCount int    `json:"protected_count"`
	OperatorsPath  string `json:"operators_path,omitempty"`
	ProtectedPath  string `json:"protected_path,omitempty"`
	AuditPath      string `json:"audit_path"`
	AuditSize      int64  `json:"audit_size"`
	AuditCeiling   int64  `json:"audit_ceiling"`
}

func (h *Hub) handleRespondState(w http.ResponseWriter, r *http.Request) {
	h.mu.Lock()
	m := h.respond
	ops, prot, auditPath := h.respondOpsPath, h.respondProtPath, h.respondAuditPath
	h.mu.Unlock()
	if m == nil {
		http.NotFound(w, r)
		return
	}
	writeJSON(w, respondStatePayload{
		Armed:          true,
		Signal:         respond.Signal,
		OperatorsCount: m.OperatorsCount(),
		ProtectedCount: m.ProtectedCount(),
		OperatorsPath:  ops,
		ProtectedPath:  prot,
		AuditPath:      auditPath,
		AuditSize:      m.AuditSize(),
		AuditCeiling:   respond.MaxAuditBytes,
	})
}

// respondAuditPayload is the GET /api/respond/audit wire contract: the
// most recent attempts (newest first, the Record schema of the JSONL
// verbatim) plus the honest bookkeeping of the scan — lines that are
// not records yet (torn tail, malformed) and whether older records
// exist beyond the scan window.
type respondAuditPayload struct {
	Records   []respond.Record `json:"records"`
	Skipped   int              `json:"skipped"`
	Truncated bool             `json:"truncated"`
}

func (h *Hub) handleRespondAudit(w http.ResponseWriter, r *http.Request) {
	h.mu.Lock()
	m := h.respond
	auditPath := h.respondAuditPath
	h.mu.Unlock()
	if m == nil {
		http.NotFound(w, r)
		return
	}
	limit := limitFrom(r, respondAuditDefaultLimit)
	if limit > respondAuditMaxLimit {
		limit = respondAuditMaxLimit
	}
	if auditPath == "" {
		// armed implies an opened audit file, so this is defensive
		// honesty, not a reachable state: never answer invented data
		// over a wiring gap
		http.Error(w, "respond audit path unknown", http.StatusInternalServerError)
		return
	}
	records, skipped, truncated, err := respond.ReadAuditTail(auditPath, limit)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, respondAuditPayload{Records: records, Skipped: skipped, Truncated: truncated})
}
