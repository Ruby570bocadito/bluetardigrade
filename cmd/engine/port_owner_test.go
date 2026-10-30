package main

import (
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// When the ingest port is taken, only an engine that answers on the API
// earns the graceful "already running" exit; a program that never answers
// is foreign (exit 1); with the API off or on TLS the probe cannot decide.
func TestIngestPortOwner(t *testing.T) {
	prev := ownerProbeWindow
	ownerProbeWindow = 300 * time.Millisecond
	t.Cleanup(func() { ownerProbeWindow = prev })

	if got := ingestPortOwner(&options{apiAddr: "0"}); got != ownerUnknown {
		t.Fatalf("API off: owner %d, want unknown", got)
	}
	if got := ingestPortOwner(&options{apiAddr: "127.0.0.1:1", apiCert: "api.pem"}); got != ownerUnknown {
		t.Fatalf("API on TLS: owner %d, want unknown", got)
	}

	engine := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/health" {
			w.WriteHeader(http.StatusOK)
			return
		}
		http.NotFound(w, r)
	}))
	defer engine.Close()
	if got := ingestPortOwner(&options{apiAddr: strings.TrimPrefix(engine.URL, "http://")}); got != ownerEngine {
		t.Fatalf("healthy engine API: owner %d, want engine", got)
	}

	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	silent := l.Addr().String()
	l.Close() // nothing answers there any more
	if got := ingestPortOwner(&options{apiAddr: silent}); got != ownerForeign {
		t.Fatalf("no engine API: owner %d, want foreign", got)
	}
}
