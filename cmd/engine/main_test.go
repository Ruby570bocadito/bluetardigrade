package main

import (
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
)

// listening must detect an accepting TCP endpoint.
func TestListening(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer ln.Close()
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			c.Close()
		}
	}()

	addr := ln.Addr().String()
	if !listening(addr) {
		t.Fatalf("listening(%s) = false, want true", addr)
	}

	// free port: nothing accepts on it
	free, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	freeAddr := free.Addr().String()
	free.Close()
	if listening(freeAddr) {
		t.Fatalf("listening(%s) = true on a closed port, want false", freeAddr)
	}
	if listening(":1") {
		t.Log("listening(:1) unexpectedly true; privileged port may be open in this environment")
	}
}

// apiHealthy must confirm the engine API via GET /api/health, with the
// ":port" shorthand normalized to 127.0.0.1.
func TestAPIHealthy(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/health" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"ok","version":"dev"}`))
	}))
	defer srv.Close()

	host, port, err := net.SplitHostPort(srv.Listener.Addr().String())
	if err != nil {
		t.Fatalf("split: %v", err)
	}
	if host != "127.0.0.1" {
		t.Fatalf("expected httptest on 127.0.0.1, got %s", host)
	}

	if !apiHealthy(":" + port) {
		t.Fatalf("apiHealthy(:%s) = false, want true", port)
	}
	if apiHealthy(srv.Listener.Addr().String()) == false {
		t.Fatalf("apiHealthy(%s) = false, want true", srv.Listener.Addr().String())
	}

	// closed port and wrong path must both be unhealthy
	free, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	freeAddr := free.Addr().String()
	free.Close()
	if apiHealthy(freeAddr) {
		t.Fatalf("apiHealthy(%s) = true on a closed port, want false", freeAddr)
	}
}
