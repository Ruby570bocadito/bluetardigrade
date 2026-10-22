// AD-7 domain sign-in API surface (M-2): POST /api/auth/domain. The
// CONSOLE (server side) is the caller: it forwards the credentials
// typed on its login page, gets the console role the user's AD groups
// grant and opens its own session as usual — local accounts keep
// working as the fallback and nothing changes for them. The engine
// never issues cookies or sessions of its own; this endpoint is the
// credential check plus the role resolution, nothing more.
//
// Contract (JSON, the same shape the console side consumes):
//   request  {"user": "ana@corp.example | CORP\\ana | ana", "password": "..."}
//   200 {"ok":true,"user":"ana","display_name":"Ana","role":"analyst","groups":["SOC-Analistas"],"domain":"CORP"}
//   400 {"ok":false,"reason":"formato"}   login name shape refused before any wire traffic
//   400 {"ok":false,"reason":"peticion"}  body not JSON / over the size cap
//   401 {"ok":false,"reason":"credenciales"}  bad password OR unknown user (never distinguished)
//   403 {"ok":false,"reason":"sin_rol"}   valid user, no mapped AD group
//   502 {"ok":false,"reason":"dominio"}   DC unreachable, TLS refused, search failed
//   429 plain JSON error when the address burns its failure budget
//
// The endpoint is registered unconditionally and answers 501 with an
// arming hint while the engine runs without -domain-auth, the same
// contract the /api/ad family follows. Passwords are read once into a
// caller-owned buffer, zeroed after the attempt and never logged;
// failures are throttled per remote address with a budget tighter
// than the bearer-auth one, because every failure here is a real
// credential guess against the domain.

package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/ad"
	"github.com/Ruby570bocadito/bluetardigrade/internal/secretfile"
)

const (
	// 401 brute-force throttle of the domain endpoint: TIGHTER than
	// the bearer budget (auth.go) because a failure here is a live
	// password guess the DC would otherwise see at line rate; the
	// address gets 429s for the rest of the window.
	domainFailBudget   = 15
	domainFailWindow   = time.Minute
	domainFailMaxAddrs = 4096
	// request body cap: a login form payload is a few hundred bytes.
	domainBodyCap = 8 << 10
	// field caps mirroring the login form's own maxlengths.
	domainMaxUser     = 256
	domainMaxPassword = 1024
	// audit cap of the account in the [AUTH] log lines (SEC-9)
	domainAuditAccountCap = 64
)

const domainAuthOff = "el inicio de sesión de dominio no está armado: arranca el motor con -domain-auth <config.yaml>"

// domainLogin is the seam the tests stub: production always calls
// ad.DomainLogin (the real LDAPS bind); there is no mock on the
// production path.
var domainLogin = ad.DomainLogin

// domainFailBox is the per-remote failure window of the domain
// endpoint; same mechanics as the bearer box in auth.go with its own
// tighter budget and its own map, so the two surfaces throttle
// independently.
type domainFailBox struct {
	windowStart time.Time
	failures    int
}

func (h *Hub) registerDomainAuth(mux *http.ServeMux) {
	const what = "Inicio de sesión de dominio"
	mux.HandleFunc("POST /api/auth/domain", unscopedOnly(what, h.handleDomainAuth))
}

// tooManyDomainFails records one failed domain sign-in from addr and
// reports whether the address exhausted its budget for the window.
func (h *Hub) tooManyDomainFails(addr string) bool {
	key := remoteIP(addr)
	now := time.Now()
	h.domainAuthMu.Lock()
	defer h.domainAuthMu.Unlock()
	if len(h.domainAuthFails) > 1024 { // opportunistic trim of stale boxes
		for k, box := range h.domainAuthFails {
			if now.Sub(box.windowStart) > domainFailWindow {
				delete(h.domainAuthFails, k)
			}
		}
	}
	if _, known := h.domainAuthFails[key]; !known && len(h.domainAuthFails) >= domainFailMaxAddrs {
		for k := range h.domainAuthFails {
			delete(h.domainAuthFails, k)
			break
		}
	}
	box := h.domainAuthFails[key]
	if box == nil || now.Sub(box.windowStart) > domainFailWindow {
		box = &domainFailBox{windowStart: now}
		h.domainAuthFails[key] = box
	}
	box.failures++
	return box.failures > domainFailBudget
}

// domainAuthConfig returns the armed config under the hub lock (nil =
// disarmed).
func (h *Hub) domainAuthConfig() *ad.DomainAuthConfig {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.domainAuth
}

// SetDomainAuth arms POST /api/auth/domain with the loaded
// -domain-auth configuration. Nil disarms (tests).
func (h *Hub) SetDomainAuth(cfg *ad.DomainAuthConfig) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.domainAuth = cfg
}

// domainLoginRequest is the JSON body of POST /api/auth/domain.
type domainLoginRequest struct {
	User     string `json:"user"`
	Password string `json:"password"`
}

// domainLoginResponse is the JSON verdict. OK=true carries the
// identity; OK=false carries one of the reasons of the contract.
type domainLoginResponse struct {
	OK          bool     `json:"ok"`
	Reason      string   `json:"reason,omitempty"`
	User        string   `json:"user,omitempty"`
	DisplayName string   `json:"display_name,omitempty"`
	Role        string   `json:"role,omitempty"`
	Groups      []string `json:"groups,omitempty"`
	Domain      string   `json:"domain,omitempty"`
}

func (h *Hub) handleDomainAuth(w http.ResponseWriter, r *http.Request) {
	cfg := h.domainAuthConfig()
	if cfg == nil {
		writeErr(w, http.StatusNotImplemented, domainAuthOff)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, domainBodyCap)
	var req domainLoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.domainVerdict(w, http.StatusBadRequest, domainLoginResponse{OK: false, Reason: "peticion"})
		return
	}
	if len(req.User) > domainMaxUser || len(req.Password) > domainMaxPassword {
		h.domainVerdict(w, http.StatusBadRequest, domainLoginResponse{OK: false, Reason: "formato"})
		return
	}

	// The buffer is ours: zeroed on every path out of the handler.
	password := []byte(req.Password)
	defer secretfile.Zero(password)

	identity, err := domainLogin(r.Context(), cfg, req.User, password)
	if err != nil {
		switch {
		case errors.Is(err, ad.ErrLoginBadUserFormat):
			h.domainVerdict(w, http.StatusBadRequest, domainLoginResponse{OK: false, Reason: "formato"})
		case errors.Is(err, ad.ErrLoginCredentials):
			// One response for bad password and unknown user; the
			// throttle counts it, the log line does not say which.
			if h.tooManyDomainFails(r.RemoteAddr) {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusTooManyRequests)
				fmt.Fprintln(w, `{"ok":false,"reason":"bloqueado"}`)
				return
			}
			// The audit line keeps the ACCOUNT the attempt was
			// addressed to (SEC-9): capped, control-escaped, without
			// the domain half of a UPN — the raw input never reaches
			// the log verbatim.
			log.Printf("[AUTH] dominio: credenciales rechazadas usuario=%s desde=%s", auditSafe(ad.LoginAccount(req.User), domainAuditAccountCap), r.RemoteAddr)
			h.domainVerdict(w, http.StatusUnauthorized, domainLoginResponse{OK: false, Reason: "credenciales"})
		case errors.Is(err, ad.ErrLoginNoRole):
			log.Printf("[AUTH] dominio: usuario sin rol de consola usuario=%s desde=%s", auditSafe(ad.LoginAccount(req.User), domainAuditAccountCap), r.RemoteAddr)
			h.domainVerdict(w, http.StatusForbidden, domainLoginResponse{OK: false, Reason: "sin_rol"})
		case errors.Is(err, ad.ErrLoginDomainDown):
			log.Printf("[AUTH] dominio: controlador no disponible desde=%s", r.RemoteAddr)
			h.domainVerdict(w, http.StatusBadGateway, domainLoginResponse{OK: false, Reason: "dominio"})
		default:
			log.Printf("[AUTH] dominio: error interno desde=%s", r.RemoteAddr)
			h.domainVerdict(w, http.StatusInternalServerError, domainLoginResponse{OK: false, Reason: "interno"})
		}
		return
	}
	log.Printf("[AUTH] dominio: sesión verificada usuario=%s rol=%s desde=%s", auditSafe(identity.User, domainAuditAccountCap), identity.Role, r.RemoteAddr)
	h.domainVerdict(w, http.StatusOK, domainLoginResponse{
		OK:          true,
		User:        identity.User,
		DisplayName: identity.DisplayName,
		Role:        identity.Role,
		Groups:      identity.Groups,
		Domain:      identity.Domain,
	})
}

// domainVerdict writes the JSON verdict with no-store semantics: a
// login response never lands in a shared cache.
func (h *Hub) domainVerdict(w http.ResponseWriter, code int, body domainLoginResponse) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(body)
}
