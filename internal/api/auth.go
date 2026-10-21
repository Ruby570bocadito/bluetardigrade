package api

import (
	"crypto/subtle"
	"fmt"
	"log"
	"net"
	"net/http"
	"strings"
	"time"
)

const (
	// 401 brute-force throttle: failures are counted per remote
	// address in a fixed window; past the budget the address gets
	// 429s for the rest of the window instead of more comparisons.
	authFailBudget = 30
	authFailWindow = time.Minute
	// authFailMaxAddrs hard-caps the throttle map: the stale-entry
	// trim only frees addresses whose window ended, so a client
	// rotating source addresses (an IPv6 /64 is plenty) could grow it
	// without bound inside one window.
	authFailMaxAddrs = 4096
)

// authFailBox counts unauthorized attempts from one remote address
// inside a rolling window. The map that holds the boxes is guarded by
// authMu; past authFailBudget failures in a window the address is
// answered with 429 for the remainder of the window, so a brute-force
// attempt cannot run comparisons (and fill the log) at line rate.
type authFailBox struct {
	windowStart time.Time
	failures    int
}

// tooManyAuthFails records a 401 from addr and reports whether the
// address has exhausted its budget for the current window. The map
// grows one entry per offending address: it is trimmed opportunisti-
// cally on each window rollover, and an address that stops failing
// costs nothing after its window expires.
func (h *Hub) tooManyAuthFails(addr string) bool {
	key := remoteIP(addr)
	now := time.Now()
	h.authMu.Lock()
	defer h.authMu.Unlock()
	if len(h.authFails) > 1024 { // opportunistic trim of stale boxes
		for k, box := range h.authFails {
			if now.Sub(box.windowStart) > authFailWindow {
				delete(h.authFails, k)
			}
		}
	}
	if _, known := h.authFails[key]; !known && len(h.authFails) >= authFailMaxAddrs {
		// still full of live boxes: forget an arbitrary one (map order
		// is randomized) — the memory bound wins over perfect
		// attribution against an attacker who owns thousands of IPs
		for k := range h.authFails {
			delete(h.authFails, k)
			break
		}
	}
	box := h.authFails[key]
	if box == nil || now.Sub(box.windowStart) > authFailWindow {
		box = &authFailBox{windowStart: now}
		h.authFails[key] = box
	}
	box.failures++
	return box.failures > authFailBudget
}

// remoteIP strips the port from a RemoteAddr ("host:port" for TCP).
func remoteIP(addr string) string {
	if host, _, err := net.SplitHostPort(addr); err == nil {
		return host
	}
	return addr
}

// auth wraps the mux with the bearer check. The comparison is
// constant-time and runs on every request (no early exits on the
// header shape), mirroring the ingest token handling. The scheme is
// matched case-insensitively (RFC 7235) and rejections carry a
// WWW-Authenticate challenge plus an actionable error body, so an
// operator hitting the 401 knows exactly which knob to set. Addresses
// that burn the failure budget get a 429 for the rest of the window:
// the constant-time compare removes timing as an oracle, this removes
// volume as one.
func (h *Hub) auth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if h.token == "" || r.URL.Path == "/api/health" {
			next.ServeHTTP(w, r)
			return
		}
		got := r.Header.Get("Authorization")
		const prefix = "Bearer "
		ok := len(got) > len(prefix) && strings.EqualFold(got[:len(prefix)], prefix) &&
			subtle.ConstantTimeCompare([]byte(got[len(prefix):]), []byte(h.token)) == 1
		if !ok {
			if h.tooManyAuthFails(r.RemoteAddr) {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusTooManyRequests)
				fmt.Fprintln(w, `{"error":"too many unauthorized requests from this address; retry after the window"}`)
				return
			}
			w.Header().Set("WWW-Authenticate", `Bearer realm="bluetardigrade api"`)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnauthorized)
			fmt.Fprintln(w, `{"error":"unauthorized: send 'Authorization: Bearer <token>' (configure it with -api-token/SF_API_TOKEN)"}`)
			log.Printf("[API] 401 unauthorized: %s %s from %s", r.Method, r.URL.Path, r.RemoteAddr)
			return
		}
		next.ServeHTTP(w, r)
	})
}
