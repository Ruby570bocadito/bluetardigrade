package risk

import (
	"fmt"
	"testing"
	"time"
)

// Benchmarks for the accumulated O1 package: with the
// table at MaxHosts, every alert from a NEW host walks the whole map to
// pick the coldest eviction victim — O(N) per admission by design,
// accepted for phase 1. These benchmarks put the measurement behind
// that acceptance: if a future change revisits it (heap, sampled scan),
// this is the baseline it has to beat, and the warm path below is the
// contrast that shows what the scan costs.

// BenchmarkRiskObserveWarm is the control: alerts for an already
// tracked host never reach the eviction scan.
func BenchmarkRiskObserveWarm(b *testing.B) {
	t := New()
	base := time.Now()
	t.Observe("LAB-WKS-01", "high", base)
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		t.Observe("LAB-WKS-01", "high", base.Add(time.Duration(i)*time.Millisecond))
	}
}

// BenchmarkRiskObserveEvictionAtCap fills the table to MaxHosts and
// then feeds one alert per brand-new host: every admission pays the
// full cold-host scan. This is the documented O(N) cost per alert with
// the map full (4096 states).
func BenchmarkRiskObserveEvictionAtCap(b *testing.B) {
	t := New()
	base := time.Now()
	for i := 0; i < MaxHosts; i++ {
		t.Observe(fmt.Sprintf("fill-%05d", i), "high", base)
	}
	if got := t.Tracked(base); got != MaxHosts {
		b.Fatalf("table holds %d hosts, want %d", got, MaxHosts)
	}
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		// timestamps advance so the stream looks alive; decay over the
		// benchmark's wall time is negligible against the 30 min half-life
		t.Observe(fmt.Sprintf("flood-%d", i), "high", base.Add(time.Duration(i)*time.Millisecond))
	}
}
