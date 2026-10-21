package main

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"runtime/pprof"
)

// -pprof-dir turns on whole-run profiling of the engine's hot path
// (ingest parse -> rules -> alert -> broadcast): a CPU profile that
// spans the run, plus heap and goroutine snapshots taken on the way
// out, after the queue drained. It is an opt-in instrumentation flag
// (the nightly bench passes it; POL-3): an engine started without it
// behaves exactly as before, and a start failure of an explicitly
// requested profile session is fatal rather than silently unprofiled.

// startProfiling prepares the profile directory and starts the CPU
// profile. The returned stop func writes the heap and goroutine
// snapshots and must be called exactly once (runEngine defers it);
// with an empty dir it is a no-op.
func startProfiling(dir string) (stop func(), err error) {
	if dir == "" {
		return func() {}, nil
	}
	// 0700: profiles carry stack traces of the whole process, which is
	// more internal detail than the rest of the data directory exposes.
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, fmt.Errorf("-pprof-dir %s: %w", dir, err)
	}
	cpu, err := os.Create(filepath.Join(dir, "cpu.pb.gz"))
	if err != nil {
		return nil, fmt.Errorf("-pprof-dir %s: %w", dir, err)
	}
	if err := pprof.StartCPUProfile(cpu); err != nil {
		cpu.Close()
		return nil, fmt.Errorf("-pprof-dir %s: %w", dir, err)
	}
	return func() {
		pprof.StopCPUProfile()
		writeSnapshot(dir, "heap.pb.gz", func(f *os.File) error { return pprof.WriteHeapProfile(f) })
		writeSnapshot(dir, "goroutine.pb.gz", func(f *os.File) error {
			return pprof.Lookup("goroutine").WriteTo(f, 0)
		})
	}, nil
}

// writeSnapshot records one shutdown snapshot; a write failure is a
// warning, never a reason to break the shutdown the run already
// earned (the CPU profile is intact either way).
func writeSnapshot(dir, name string, write func(f *os.File) error) {
	f, err := os.Create(filepath.Join(dir, name))
	if err != nil {
		log.Printf("[ENGINE] %s profile in %s: %v", name, dir, err)
		return
	}
	defer f.Close()
	if err := write(f); err != nil {
		log.Printf("[ENGINE] %s profile in %s: %v", name, dir, err)
	}
}
