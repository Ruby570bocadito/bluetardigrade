package main

import (
	"testing"
	"time"
)

// The p95 is the nearest-rank percentile: with 20 samples of 1..20 ms it
// is the 19th, not the maximum the old rounded-down index returned.
func TestAlertLatencyP95IsNearestRank(t *testing.T) {
	tr := newAlertLatencyTracker(64)
	for i := 1; i <= 20; i++ {
		tr.Observe(time.Duration(i) * time.Millisecond)
	}
	ms := func(n int) float64 { return (time.Duration(n) * time.Millisecond).Seconds() * 1000 }
	count, p50, p95, max := tr.snapshot()
	if count != 20 || p50 != ms(10) || p95 != ms(19) || max != ms(20) {
		t.Fatalf("snapshot = count %d, p50 %v, p95 %v, max %v; want 20, 10, 19, 20 ms", count, p50, p95, max)
	}
	// a single sample is every percentile at once
	one := newAlertLatencyTracker(16)
	one.Observe(7 * time.Millisecond)
	if _, p50, p95, max := one.snapshot(); p50 != ms(7) || p95 != ms(7) || max != ms(7) {
		t.Fatalf("one sample: p50 %v, p95 %v, max %v; want 7 ms each", p50, p95, max)
	}
}
