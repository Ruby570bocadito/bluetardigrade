package api

import "net/http"

// securityHeaders wraps every engine API response with the two headers
// that cost nothing and close real browser-side confusion:
//
//   - X-Content-Type-Options: nosniff. Telemetry strings (alert
//     summaries, process command lines, incident notes) are
//     attacker-influenced text echoed back by these routes; nosniff
//     stops a browser that ends up on the API directly from sniffing
//     any payload into an executable context, however it is served.
//   - Referrer-Policy: no-referrer. Operators paste API URLs (a
//     specific alert, an export); the policy keeps those paths out of
//     third-party referrer headers the same way the console and the
//     hub already declare it.
//
// Cache-Control is deliberately not forced here: the SSE stream and
// the export downloads set exactly what they need per route, and a
// global value would silently override those.
func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "no-referrer")
		next.ServeHTTP(w, r)
	})
}
