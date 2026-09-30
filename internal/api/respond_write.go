// Active response HTTP surface (C3, roadmap): POST /api/respond/kill.
// The route is registered unconditionally in the mux but answers a
// real 404 — byte-identical to any unknown path — unless the engine
// armed it at startup, so a disarmed engine leaks no surface shape
// (the design §2.1 contract: no "403 of an endpoint that exists";
// probing can tell an armed engine from a disarmed one only by
// actually being authorized to kill something). Arming (run.go)
// requires ALL of: -allow-kill (or SF_ALLOW_KILL=1), a hub bearer
// token (mandatory even on loopback — kill is stricter than the
// suppression writes it replicates, dictamen 04-B), and an audit file
// that opened; the permission layers themselves live in
// internal/respond and every denial is audited there.
package api

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"

	"github.com/Ruby570bocadito/security-framework/internal/respond"
)

// respondMaxBodyBytes caps the request body, same limit and rationale
// as the suppression writes: a kill request is a handful of short
// fields, not a data channel.
const respondMaxBodyBytes = 8192

// EnableRespondKill arms POST /api/respond/kill with the manager the
// engine built at startup (operators allowlist, protected names,
// audit writer). Call before Run. Passing nil disarms.
func (h *Hub) EnableRespondKill(m *respond.Manager) {
	h.mu.Lock()
	h.respond = m
	h.mu.Unlock()
}

// respondKillRequest mirrors the wire contract (docs/api/openapi.yaml,
// RespondKillRequest): the JSON tags are the API.
type respondKillRequest struct {
	Host           string `json:"host"`
	PID            int    `json:"pid"`
	ProcessName    string `json:"process_name"`
	RuleID         string `json:"rule_id"`
	AlertID        string `json:"alert_id"`
	Operator       string `json:"operator"`
	Reason         string `json:"reason"`
	IdempotencyKey string `json:"idempotency_key"`
}

// handleRespondKill validates the body structurally (400 family) and
// hands the attempt to the manager, whose denial codes map 1:1 to
// HTTP statuses (403/409/429). Structural rejections are NOT audited:
// they are not attempts, they are noise — the audit trail starts at
// the first well-formed attempt, exactly like the suppression write
// surface logs only validated requests.
func (h *Hub) handleRespondKill(w http.ResponseWriter, r *http.Request) {
	h.mu.Lock()
	m := h.respond
	h.mu.Unlock()
	if m == nil {
		http.NotFound(w, r) // real 404: the surface was never armed
		return
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, respondMaxBodyBytes))
	if err != nil {
		http.Error(w, "unreadable or oversized request body (8 KiB limit)", http.StatusBadRequest)
		return
	}
	var in respondKillRequest
	if err := json.Unmarshal(body, &in); err != nil {
		http.Error(w, fmt.Sprintf("invalid JSON body: %v", err), http.StatusBadRequest)
		return
	}
	req := respond.Request{
		Host:           in.Host,
		PID:            in.PID,
		ProcessName:    in.ProcessName,
		RuleID:         in.RuleID,
		AlertID:        in.AlertID,
		Operator:       in.Operator,
		Reason:         in.Reason,
		IdempotencyKey: in.IdempotencyKey,
		Source:         r.RemoteAddr,
	}
	if err := req.Validate(); err != nil {
		http.Error(w, fmt.Sprintf("invalid request: %v", err), http.StatusBadRequest)
		return
	}

	res := m.Kill(req)
	if res.Executed {
		log.Printf("[API] respond kill executed action=%s pid=%d operator=%s mechanism=%s from=%s",
			oneLine(res.ActionID), req.PID, oneLine(req.Operator), res.Mechanism, oneLine(req.Source))
		writeJSON(w, map[string]string{
			"action_id": res.ActionID,
			"status":    "executed",
			"signal":    respond.Signal,
			"mechanism": res.Mechanism,
		})
		return
	}
	log.Printf("[API] respond kill DENIED action=%s code=%s pid=%d operator=%s from=%s",
		oneLine(res.ActionID), res.Code, req.PID, oneLine(req.Operator), oneLine(req.Source))
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(res.HTTPStatus)
	_ = json.NewEncoder(w).Encode(map[string]string{
		"error":     res.Code,
		"action_id": res.ActionID,
	})
}
