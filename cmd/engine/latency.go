package main

import (
        "sort"
        "sync"
        "time"
)

// alertLatencyTracker observes the elapsed time between an event's
// sensor-side timestamp and the moment its alert was raised (SET-3:
// "ingesta a alerta" on the platform-status view). It keeps the last
// `capacity` observations in a fixed ring and answers p50/p95/max on
// demand: a bounded, allocation-light structure a flood of alerts
// cannot grow, and a snapshot that is a VALUE copy (the /api/stats
// handler never races Observe).
//
// The metric deliberately measures from the EVENT timestamp, not from
// the engine's receive time: it is the number a SOC feels (sensor
// clock skew aside, it includes transport, batching and detection).
// Deltas the sensor reports as future (a clock ahead of the engine)
// are skipped upstream — the tracker never fabricates zero.
type alertLatencyTracker struct {
        mu       sync.Mutex
        ring     []time.Duration
        head     int
        filled   int
        observed uint64
}

func newAlertLatencyTracker(capacity int) *alertLatencyTracker {
        if capacity < 16 {
                capacity = 16
        }
        return &alertLatencyTracker{ring: make([]time.Duration, capacity)}
}

// Observe records one latency observation.
func (t *alertLatencyTracker) Observe(d time.Duration) {
        if d < 0 {
                return
        }
        t.mu.Lock()
        defer t.mu.Unlock()
        t.ring[t.head] = d
        t.head = (t.head + 1) % len(t.ring)
        if t.filled < len(t.ring) {
                t.filled++
        }
        t.observed++
}

// snapshot returns the summary over the retained window. The
// percentiles are computed over at most the last `capacity`
// observations: on a steady alert stream the window is recent history,
// which is what an operator glances at. The four return values map
// one-to-one onto the api hub's alert_latency payload.
func (t *alertLatencyTracker) snapshot() (count uint64, p50, p95, max float64) {
        t.mu.Lock()
        defer t.mu.Unlock()
        count = t.observed
        if t.filled == 0 {
                return count, 0, 0, 0
        }
        sample := make([]float64, 0, t.filled)
        for i := 0; i < t.filled; i++ {
                sample = append(sample, t.ring[i].Seconds()*1000)
        }
        sort.Float64s(sample)
        p50 = sample[(len(sample)-1)/2]
        // nearest-rank p95: ceil(0.95*n), index = rank-1 (the previous
        // formula rounded down and returned max or max-1 for small samples)
        p95 = sample[(len(sample)*95+99)/100-1]
        max = sample[len(sample)-1]
        return count, p50, p95, max
}
