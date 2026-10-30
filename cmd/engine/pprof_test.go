package main

import (
	"os"
	"path/filepath"
	"runtime/debug"
	"testing"
)

// gzip magic: every file pprof writes is a gzip stream of the proto.
func assertGzipFile(t *testing.T, path string) {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("profile %s not written: %v", path, err)
	}
	if len(raw) < 2 || raw[0] != 0x1f || raw[1] != 0x8b {
		t.Fatalf("profile %s exists but is not a gzip stream (% x...)", path, raw[:min(2, len(raw))])
	}
}

// A run with -pprof-dir produces the three profile files, each a
// non-empty gzip stream, and stopping twice is the caller's business
// (runEngine defers it once) - the stop path itself is idempotent
// enough for the heap/goroutine files to be rewritten, which the
// second stop here also exercises.
func TestStartProfilingWritesProfiles(t *testing.T) {
	dir := t.TempDir()
	// No GC while the test runs: the os.File finalizer must not close a
	// leaked CPU handle behind stop's back and hide the leak checked below.
	defer debug.SetGCPercent(debug.SetGCPercent(-1))
	stop, err := startProfiling(dir)
	if err != nil {
		t.Fatalf("startProfiling: %v", err)
	}
	// a little CPU work so the profile has samples to record
	sum := 0
	for i := 0; i < 2_000_000; i++ {
		sum += i % 7
	}
	_ = sum
	stop()
	stop() // second call must not panic or corrupt anything
	for _, name := range []string{"cpu.pb.gz", "heap.pb.gz", "goroutine.pb.gz"} {
		assertGzipFile(t, filepath.Join(dir, name))
	}
	// stop closes the CPU profile: Windows cannot remove an open file,
	// and the TempDir cleanup failed whenever the GC had not finalized
	// the leaked handle yet.
	if err := os.Remove(filepath.Join(dir, "cpu.pb.gz")); err != nil {
		t.Fatalf("cpu profile still open after stop: %v", err)
	}
}

// Without the flag everything stays off: no error, and the returned
// stop func is a safe no-op (no filesystem side effects to observe by
// construction - the empty dir short-circuits before any path is
// touched).
func TestStartProfilingEmptyDirIsNoop(t *testing.T) {
	stop, err := startProfiling("")
	if err != nil {
		t.Fatalf("startProfiling(\"\"): %v", err)
	}
	stop() // must not panic
}

// An explicitly requested profile session that cannot start fails
// loudly (a silent no-profiled bench run would fake the numbers), but
// the failure names the flag so the operator knows what to fix.
func TestStartProfilingUnwritableDirFailsLoudly(t *testing.T) {
	base := filepath.Join(t.TempDir(), "blocker")
	if err := os.WriteFile(base, []byte("a file, not a directory"), 0o600); err != nil {
		t.Fatal(err)
	}
	_, err := startProfiling(filepath.Join(base, "profiles"))
	if err == nil {
		t.Fatal("expected an error when the profile directory cannot be created")
	}
}
