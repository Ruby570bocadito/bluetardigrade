// Enrollment surface (-enroll, internal/enroll): the console's
// "Añadir equipos" wizard creates tokens here and administrators approve,
// reject or revoke enrolled hosts.
//
//	GET  /api/enroll                              state: tokens (never their secrets) and hosts
//	POST /api/enroll/tokens                       create a token; the secret is returned once
//	POST /api/enroll/tokens/{id}/revoke           stop a token from enrolling more hosts
//	POST /api/enroll/hosts/{name}/{action}        approve | reject | revoke a host
//
// The writes hand out or withdraw the right to feed the engine, so they
// need an API token even on loopback (403 otherwise): the bearer is the
// only credential a request carries. Every write is logged with the
// "by" the console attributes (the account name when accounts are on).

package api

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/enroll"
)

// enrollMaxBodyBytes caps enrollment request bodies (a few short fields).
const enrollMaxBodyBytes = 4096

// SetEnrollment exposes the enrollment registry (nil = enrollment off).
func (h *Hub) SetEnrollment(r *enroll.Registry) {
	h.mu.Lock()
	h.enroll = r
	h.mu.Unlock()
}

func (h *Hub) registerEnroll(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/enroll", h.handleEnrollState)
	mux.HandleFunc("POST /api/enroll/tokens", h.handleEnrollTokenCreate)
	mux.HandleFunc("POST /api/enroll/tokens/{id}/revoke", h.handleEnrollTokenRevoke)
	mux.HandleFunc("POST /api/enroll/hosts/{name}/{action}", h.handleEnrollHostDecide)
}

func (h *Hub) enrollment() *enroll.Registry {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.enroll
}

// enrollState is the body of GET /api/enroll.
type enrollState struct {
	Enabled bool           `json:"enabled"`
	Hint    string         `json:"hint,omitempty"`
	Pending int            `json:"pending"`
	Active  int            `json:"active"`
	Usable  int            `json:"usable_tokens"`
	Writes  bool           `json:"writes"`
	Tokens  []enroll.Token `json:"tokens"`
	Hosts   []enroll.Host  `json:"hosts"`
}

func (h *Hub) handleEnrollState(w http.ResponseWriter, r *http.Request) {
	reg := h.enrollment()
	if reg == nil {
		writeJSON(w, enrollState{
			Hint:   "El alta de equipos está apagada: arranca el motor con -enroll <fichero> (por ejemplo data/enrollment.json).",
			Tokens: []enroll.Token{},
			Hosts:  []enroll.Host{},
		})
		return
	}
	pending, active, usable := reg.Counts()
	writeJSON(w, enrollState{
		Enabled: true,
		Pending: pending,
		Active:  active,
		Usable:  usable,
		Writes:  h.token != "",
		Tokens:  reg.Tokens(),
		Hosts:   reg.Hosts(),
	})
}

// enrollWriteTarget resolves the registry for a write, or answers why
// there is none.
func (h *Hub) enrollWriteTarget(w http.ResponseWriter) (*enroll.Registry, bool) {
	reg := h.enrollment()
	if reg == nil {
		writeEnrollError(w, http.StatusNotFound, "enrollment is off: start the engine with -enroll <file>")
		return nil, false
	}
	if h.token == "" {
		writeEnrollError(w, http.StatusForbidden, "enrollment writes need an API token: start the engine with -api-token or SF_API_TOKEN")
		return nil, false
	}
	return reg, true
}

type enrollTokenRequest struct {
	Label       string `json:"label"`
	MaxUses     int    `json:"max_uses"`
	TTLHours    int    `json:"ttl_hours"`
	AutoApprove string `json:"auto_approve"`
	By          string `json:"by"`
}

type enrollTokenCreated struct {
	Token  enroll.Token `json:"token"`
	Secret string       `json:"secret"`
}

func (h *Hub) handleEnrollTokenCreate(w http.ResponseWriter, r *http.Request) {
	reg, ok := h.enrollWriteTarget(w)
	if !ok {
		return
	}
	var in enrollTokenRequest
	if !decodeEnrollBody(w, r, &in) {
		return
	}
	secret, tok, err := reg.CreateToken(enroll.TokenRequest{
		Label:       in.Label,
		MaxUses:     in.MaxUses,
		TTL:         time.Duration(in.TTLHours) * time.Hour,
		AutoApprove: in.AutoApprove,
		By:          in.By,
	})
	if err != nil {
		writeEnrollRegistryError(w, err)
		return
	}
	log.Printf("[API] WRITE enroll token %s created (label=%s uses=%d expires=%s auto_approve=%s) by=%s",
		tok.ID, oneLine(tok.Label), tok.MaxUses, tok.ExpiresAt.Format(time.RFC3339), oneLine(tok.AutoApprove), byOrAPI(in.By))
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(enrollTokenCreated{Token: tok, Secret: secret})
}

type enrollByRequest struct {
	By string `json:"by"`
}

func (h *Hub) handleEnrollTokenRevoke(w http.ResponseWriter, r *http.Request) {
	reg, ok := h.enrollWriteTarget(w)
	if !ok {
		return
	}
	var in enrollByRequest
	if !decodeEnrollBody(w, r, &in) {
		return
	}
	tok, err := reg.RevokeToken(r.PathValue("id"), in.By)
	if err != nil {
		writeEnrollRegistryError(w, err)
		return
	}
	log.Printf("[API] WRITE enroll token %s revoked by=%s", tok.ID, byOrAPI(in.By))
	writeJSON(w, tok)
}

func (h *Hub) handleEnrollHostDecide(w http.ResponseWriter, r *http.Request) {
	reg, ok := h.enrollWriteTarget(w)
	if !ok {
		return
	}
	var in enrollByRequest
	if !decodeEnrollBody(w, r, &in) {
		return
	}
	action := enroll.Action(r.PathValue("action"))
	host, err := reg.Decide(r.PathValue("name"), action, in.By)
	if err != nil {
		writeEnrollRegistryError(w, err)
		return
	}
	log.Printf("[API] WRITE enroll host %s (%s) %s -> %s by=%s", host.Name, host.Host, action, host.State, byOrAPI(in.By))
	writeJSON(w, host)
}

// decodeEnrollBody reads a small JSON body; an empty body is an empty
// request (the decisions carry nothing but the optional "by").
func decodeEnrollBody(w http.ResponseWriter, r *http.Request, v any) bool {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, enrollMaxBodyBytes))
	if err != nil {
		writeEnrollError(w, http.StatusRequestEntityTooLarge, "request body too large")
		return false
	}
	if len(body) == 0 {
		return true
	}
	dec := json.NewDecoder(bytes.NewReader(body))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		writeEnrollError(w, http.StatusBadRequest, "invalid JSON body: "+err.Error())
		return false
	}
	return true
}

func writeEnrollRegistryError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, enroll.ErrNotFound):
		writeEnrollError(w, http.StatusNotFound, err.Error())
	case errors.Is(err, enroll.ErrConflict):
		writeEnrollError(w, http.StatusConflict, err.Error())
	case errors.Is(err, enroll.ErrInvalid):
		writeEnrollError(w, http.StatusBadRequest, err.Error())
	case errors.Is(err, enroll.ErrFull):
		writeEnrollError(w, http.StatusConflict, err.Error())
	default:
		log.Printf("[API] WRITE enroll FAILED: %v", err)
		writeEnrollError(w, http.StatusInternalServerError, "enrollment state not writable (see engine log)")
	}
}

func writeEnrollError(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

func byOrAPI(by string) string {
	if by == "" {
		return "api"
	}
	return oneLine(by)
}
