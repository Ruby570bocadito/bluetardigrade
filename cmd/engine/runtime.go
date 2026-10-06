package main

import (
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/store"
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
// rule/host pair. nil manager means the feature is off. ev is the
// triggering event when one exists (rule hits, intel, baseline
// novelty); nil for aggregated alerts (kill-chains, beaconing,
// volumetric), which a CONDITIONAL entry (§2.3 when) therefore never
// silences — the failure direction is an alert the operator still
// sees, never a lost signal.
func suppressed(m *suppress.Manager, ruleID, host string, ev *model.Event, now time.Time) bool {
	if m == nil {
		return false
	}
	ok, entry := m.SuppressedAt(ruleID, host, now)
	return ok && entry.MatchesEvent(ev)
}

var storeFails uint64

// storeConflicts throttles the id-conflict log line on the -api 0 path.
var storeConflicts uint64

// storeWriteErr logs store write failures with a throttle (first, then
// every 500th): a full disk must be visible without flooding the log
// or stopping detection.
func storeWriteErr(err error) {
	if errors.Is(err, store.ErrIDConflict) {
		// first copy kept on disk: a forged or colliding id is a
		// signal, not a lost write (counted by the store itself)
		if n := atomic.AddUint64(&storeConflicts, 1); n == 1 || n%500 == 0 {
			log.Printf("[ENGINE] event id conflict, stored evidence kept (%d total): %v", n, err)
		}
		return
	}
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

// reloadReporter keeps the hot-reload output meaningful: a set is
// announced when its size changes, a failure when its message first
// appears or changes (the previous set keeps serving), and a recovery
// once the file loads again.
type reloadReporter struct {
	name    string
	count   int
	lastErr string
	quiet   bool // interactive panel: no stdout lines
	out     io.Writer
}

func (r *reloadReporter) report(count int, err error) {
	w := r.out
	if w == nil {
		w = os.Stdout
	}
	if err != nil {
		if msg := err.Error(); msg != r.lastErr {
			r.lastErr = msg
			log.Printf("[ENGINE] %s reload FAILED, keeping previous set: %v", r.name, err)
		}
		return
	}
	recovered := r.lastErr != ""
	r.lastErr = ""
	if count == r.count && !recovered {
		return
	}
	r.count = count
	if !r.quiet {
		fmt.Fprintf(w, "[ENGINE] %s reloaded (%d active)\n", r.name, count)
	}
}
