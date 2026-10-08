package api

import (
        "log"
        "net/http"
        "time"
)

// recoverPanic is the outermost middleware: a panic in ANY handler
// previously truncated the client's connection with no status line
// and left nothing in the engine log (audit 5.5 #3). The engine is a
// security product — a 500 with a JSON body and a stack trace in the
// log is the difference between "a handler crashed and was noticed"
// and "the console went blank and nobody knows why". The panic is NOT
// re-raised: net/http already isolates panics per connection (it does
// not take the process down); re-raising would only undo the JSON
// response this middleware writes.
func recoverPanic(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
                defer func() {
                        if rec := recover(); rec != nil {
                                log.Printf("[API] PANIC recovered: %s %s from %s: %v",
                                        r.Method, r.URL.Path, r.RemoteAddr, rec)
                                // headers may already be written (the panic can land
                                // mid-response); WriteHeader on a flushed response just
                                // logs a superfluous-warning internally — harmless.
                                w.Header().Set("Content-Type", "application/json")
                                w.WriteHeader(http.StatusInternalServerError)
                                _, _ = w.Write([]byte(`{"error":"internal error: the handler crashed; the engine log has the details"}`))
                        }
                }()
                next.ServeHTTP(w, r)
        })
}

// requestDeadlines closes the slow-body hole (audit 5.5 #1): the
// server deliberately has no global ReadTimeout because the SSE
// stream is a long-lived response, so a POST whose body never arrives
// used to hold its connection and goroutine FOREVER. Every non-stream
// route now gets a bounded read deadline — the request line and
// headers were already bounded by ReadHeaderTimeout; this bounds the
// BODY read too (an ack-timeout shaped deadline, same spirit as the
// ingest's). /api/stream is exempt: it never reads a body after the
// headers, and its lifetime is governed by the client going away.
const handlerReadTimeout = 30 * time.Second

func requestDeadlines(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
                if r.URL.Path != "/api/stream" {
                        // ResponseController reaches the server's connection state
                        // through the middleware chain (net/http >= 1.20 unwraps
                        // wrappers); if the writer does not support it (a test
                        // double) the deadline is skipped silently.
                        rc := http.NewResponseController(w)
                        if err := rc.SetReadDeadline(time.Now().Add(handlerReadTimeout)); err != nil {
                                // no-op for ResponseWriter implementations without the hook
                                _ = err
                        }
                }
                next.ServeHTTP(w, r)
        })
}

// noStore marks an operator-write handler's response as uncacheable at
// every hop (audit 5.5): a proxy that caches the 200 of a triage or
// suppression write could re-serve it later and the console would show
// state the engine never recorded. Wired only on the write routes —
// reads keep their deliberate per-route caching.
func (h *Hub) noStore(next http.HandlerFunc) http.HandlerFunc {
        return func(w http.ResponseWriter, r *http.Request) {
                w.Header().Set("Cache-Control", "no-store")
                next(w, r)
        }
}
