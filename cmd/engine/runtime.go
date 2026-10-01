package main

import (
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/suppress"
	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
)

// isLoopback reports whether the address binds a loopback interface
// only (the same rule the startup warnings and the -api-write refusal
// apply).
func isLoopback(addr string) bool {
	return strings.HasPrefix(addr, "127.0.0.1:") || strings.HasPrefix(addr, "[::1]:")
}

// suppressed reports whether the allowlist currently silences this
// rule/host pair. nil manager means the feature is off.
func suppressed(m *suppress.Manager, ruleID, host string, now time.Time) bool {
	if m == nil {
		return false
	}
	ok, _ := m.SuppressedAt(ruleID, host, now)
	return ok
}

var storeFails uint64

// storeWriteErr logs store write failures with a throttle (first, then
// every 500th): a full disk must be visible without flooding the log
// or stopping detection.
func storeWriteErr(err error) {
	n := atomic.AddUint64(&storeFails, 1)
	if n == 1 || n%500 == 0 {
		log.Printf("[ENGINE] store write FAILED (%d total): %v", n, err)
	}
}

func dirExists(p string) bool {
	st, err := os.Stat(p)
	return err == nil && st.IsDir()
}

// resolveDataDir picks the directory holding rules or sequences: the
// flag path when it exists, otherwise <exe dir>/../<name> (so the
// installed sf-engine.exe needs no wrapper), otherwise the flag path
// unchanged so LoadDir reports the error against the original path.
// Both consumers must reload from THIS resolved path (the hot-reload
// ticker does) or the reload silently fails every cycle.
func resolveDataDir(flagPath, name string) string {
	if dirExists(flagPath) {
		return flagPath
	}
	if exe, err := os.Executable(); err == nil {
		alt := filepath.Join(filepath.Dir(exe), "..", name)
		if dirExists(alt) {
			return alt
		}
	}
	return flagPath
}

// resolveDataFile is resolveDataDir for a single file: the flag path
// when it exists, otherwise <exe dir>/../<name> (the installed layout),
// otherwise the flag path unchanged so LoadFile reports its error
// against the original path. Missing files are NOT an error for the
// allowlist (feature off) but malformed ones are.
func resolveDataFile(flagPath, name string) string {
	if fileExists(flagPath) {
		return flagPath
	}
	if exe, err := os.Executable(); err == nil {
		alt := filepath.Join(filepath.Dir(exe), "..", name)
		if fileExists(alt) {
			return alt
		}
	}
	return flagPath
}

func fileExists(p string) bool {
	st, err := os.Stat(p)
	return err == nil && !st.IsDir()
}

// listening reports whether something accepts TCP connections on addr
// right now (":7777" dials localhost, same rule as net.Listen).
func listening(addr string) bool {
	c, err := net.DialTimeout("tcp", addr, 500*time.Millisecond)
	if err != nil {
		return false
	}
	c.Close()
	return true
}

// apiHealthy does a one-shot GET /api/health with a short timeout, to
// confirm that whatever occupies the ingest port is really this engine.
func apiHealthy(addr string) bool {
	host := addr
	if strings.HasPrefix(host, ":") {
		host = "127.0.0.1" + host
	}
	cl := &http.Client{Timeout: 700 * time.Millisecond}
	resp, err := cl.Get("http://" + host + "/api/health")
	if err != nil {
		return false
	}
	resp.Body.Close()
	return resp.StatusCode == http.StatusOK
}

func describe(ev *model.Event) string {
	switch {
	case ev.Process != nil:
		return ev.Process.Name
	case ev.File != nil:
		return ev.File.Path
	case ev.Network != nil:
		return fmt.Sprintf("%s:%d", ev.Network.DestinationIP, ev.Network.DestinationPort)
	default:
		return "-"
	}
}

func pidOf(ev *model.Event) int {
	if ev.Process != nil {
		return ev.Process.PID
	}
	return 0
}
