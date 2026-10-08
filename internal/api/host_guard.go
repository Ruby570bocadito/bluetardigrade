package api

import (
	"net"
	"net/http"
	"strings"
)

// guardRebinding stops DNS rebinding against a loopback API that runs
// without a bearer token. A page on attacker.example can re-resolve its
// own name to 127.0.0.1 and then talk to the engine as a same-origin
// client: Origin and Host both say attacker.example, so guardWriteOrigin
// lets the write through and the browser lets the page read every
// response. The token is the real boundary (the browser never has it);
// without one, the Host header is the only thing a rebinding browser
// cannot forge, so a loopback listener only answers to loopback names
// and IP literals. Mirrors the console's host pinning (route.ts).
func (h *Hub) guardRebinding(next http.Handler) http.Handler {
	loopback := listenerIsLoopback(h.listener)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !loopback || h.tokenString() != "" || hostIsLocal(r.Host) {
			next.ServeHTTP(w, r)
			return
		}
		writeErr(w, http.StatusMisdirectedRequest,
			"the tokenless loopback API only answers to localhost or an IP address (DNS rebinding guard); set -api-token to reach it by name")
	})
}

func listenerIsLoopback(ln net.Listener) bool {
	if ln == nil {
		return false
	}
	tcp, ok := ln.Addr().(*net.TCPAddr)
	return ok && tcp.IP.IsLoopback()
}

// hostIsLocal reports whether a Host header names this machine without
// going through DNS: an IP literal or "localhost" (trailing dot and case
// normalized). A rebinding attack needs a DNS name it controls, so
// neither form can carry one.
func hostIsLocal(hostport string) bool {
	host := hostport
	if hp, _, err := net.SplitHostPort(hostport); err == nil {
		host = hp
	}
	host = strings.TrimSuffix(strings.Trim(host, "[]"), ".")
	if host == "" {
		return false
	}
	return strings.EqualFold(host, "localhost") || net.ParseIP(host) != nil
}
