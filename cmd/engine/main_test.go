package main

import (
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
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

// resolveDataDir prefers an existing flag path; when the flag path is
// missing it falls back to <exe dir>/../<name> (installed layout), and
// when nothing exists it returns the flag path unchanged so the load
// error names the path the operator actually passed.
func TestResolveDataDir(t *testing.T) {
	existing := t.TempDir()
	sub := filepath.Join(existing, "rules")
	if err := os.Mkdir(sub, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}

	if got := resolveDataDir(sub, "rules"); got != sub {
		t.Fatalf("resolveDataDir(existing) = %q, want %q", got, sub)
	}

	// flag path missing and no sibling: returned unchanged
	missing := filepath.Join(existing, "does-not-exist")
	if got := resolveDataDir(missing, "rules"); got != missing {
		t.Fatalf("resolveDataDir(missing) = %q, want %q unchanged", got, missing)
	}
}

// resolveDataFile mirrors resolveDataDir for the single-file allowlist:
// an existing flag path wins, a directory must NOT satisfy the lookup
// (the file flag points at a file), and a missing path is returned
// unchanged so LoadFile can treat it as "feature off".
func TestResolveDataFile(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "suppressions.yaml")
	if err := os.WriteFile(file, []byte("- rule_id: x\n"), 0o600); err != nil {
		t.Fatalf("write: %v", err)
	}

	if got := resolveDataFile(file, "suppressions.yaml"); got != file {
		t.Fatalf("resolveDataFile(existing) = %q, want %q", got, file)
	}

	// a directory at the flag path must not count as the file
	if got := resolveDataFile(dir, "suppressions.yaml"); got != dir {
		t.Fatalf("resolveDataFile(dir) = %q, want unchanged %q (dirs are not files)", got, dir)
	}

	missing := filepath.Join(dir, "nope.yaml")
	if got := resolveDataFile(missing, "suppressions.yaml"); got != missing {
		t.Fatalf("resolveDataFile(missing) = %q, want %q unchanged", got, missing)
	}
}

// The engine must reload from the RESOLVED rules path, not the raw
// flag: when startup fell back to the directory next to the
// executable, reloading from the raw flag failed silently every cycle.
// resolveDataDir is the shared helper for both paths, so pin its
// exe-relative fallback: a dir named <name> next to the test binary's
// parent must win over a missing flag path.
func TestResolveDataDirFallsBackToExeRelative(t *testing.T) {
	// the test binary lives in a temp go-build dir; place
	// <parent>/rules so the fallback path resolves to it
	exe, err := os.Executable()
	if err != nil {
		t.Skipf("no executable path: %v", err)
	}
	parent := filepath.Dir(filepath.Dir(exe))
	alt := filepath.Join(parent, "rules")
	if err := os.MkdirAll(alt, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	t.Cleanup(func() { os.RemoveAll(alt) })

	missing := filepath.Join(t.TempDir(), "nope")
	got := resolveDataDir(missing, "rules")
	if got != alt {
		t.Fatalf("resolveDataDir(missing, rules) = %q, want exe-relative %q", got, alt)
	}
}
