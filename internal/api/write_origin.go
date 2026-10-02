package api

import (
	"net/http"
	"net/url"
	"strings"
)

// guardWriteOrigin protects native API writes as well as the console proxy.
// Originless API clients remain compatible; a browser must neither declare a
// foreign origin nor a cross-site request, even when it has a bearer token.
func guardWriteOrigin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet, http.MethodHead, http.MethodOptions:
			next.ServeHTTP(w, r)
			return
		}
		if strings.EqualFold(strings.TrimSpace(r.Header.Get("Sec-Fetch-Site")), "cross-site") {
			writeErr(w, http.StatusForbidden, "cross-site API writes are forbidden")
			return
		}
		origins := r.Header.Values("Origin")
		if len(origins) == 0 {
			next.ServeHTTP(w, r)
			return
		}
		if len(origins) != 1 || !sameWriteOrigin(origins[0], r) {
			writeErr(w, http.StatusForbidden, "API writes require the same browser origin")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func sameWriteOrigin(raw string, r *http.Request) bool {
	origin, err := url.Parse(raw)
	if err != nil || origin.Hostname() == "" || origin.User != nil || origin.Opaque != "" ||
		(origin.Scheme != "http" && origin.Scheme != "https") || origin.Path != "" ||
		origin.RawQuery != "" || origin.ForceQuery || origin.Fragment != "" || origin.RawFragment != "" || strings.Contains(raw, "#") {
		return false
	}
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	// Host and TLS describe the listener that received the request. Untrusted
	// Forwarded/X-Forwarded-* headers cannot redefine the allowed origin.
	target, err := url.Parse(scheme + "://" + r.Host)
	if err != nil || target.Hostname() == "" || target.User != nil || target.Path != "" || target.RawQuery != "" || target.Fragment != "" {
		return false
	}
	return origin.Scheme == scheme && strings.EqualFold(origin.Hostname(), target.Hostname()) && originPort(origin) == originPort(target)
}

func originPort(u *url.URL) string {
	if port := u.Port(); port != "" {
		return port
	}
	if u.Scheme == "https" {
		return "443"
	}
	return "80"
}
