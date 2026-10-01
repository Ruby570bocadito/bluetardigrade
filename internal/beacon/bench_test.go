package beacon

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/alert"
)

// Benchmarks for the performance review the Director registered as the
// accumulated O1 package (acta 22h46 §1.4 + 04's O1 of 09h50): fire()
// used to hold m.mu across the emit callback, so every /api/stats read
// (Tracked/Fired) waited behind the whole alert pipeline (SQLite
// write-through, webhook enqueue, risk observe). Observe now emits
// AFTER mu is released. These benchmarks keep the numbers honest for
// future rounds: the sequential costs (Observe hot path, Observe with
// a firing pipeline) must not drift, and the contention benchmark
// (Tracked under a firing pipeline) is the one that measures the fix.

func writeProfilesB(b *testing.B, yaml string) string {
	b.Helper()
	dir := b.TempDir()
	p := filepath.Join(dir, "beacons.yaml")
	if err := os.WriteFile(p, []byte(yaml), 0o600); err != nil {
		b.Fatal(err)
	}
	return p
}

// firingProfile: one fast-beaconing destination. A 500 µs event
// cadence against a 2 ms cooldown re-fires almost continuously, so
// the emit callback sits on the hot path.
const firingProfile = `
- name: C2 beacon bench
  id: bcn-bench
  severity: high
  window: 20ms
  min_count: 4
  max_jitter: 1.0
  cooldown: 2ms
`

// silentProfile never fires: the 10s interval floor sits far above the
// 500 µs cadence, so the benchmark measures the pure observe path.
const silentProfile = `
- name: C2 beacon bench silent
  id: bcn-bench-silent
  severity: low
  window: 20ms
  min_count: 4
  max_jitter: 1.0
  min_interval: 10s
  cooldown: 2ms
`

// pipelineWork stands in for the real emit downstream (SQLite
// write-through + webhook enqueue + risk observe): a fixed slice of
// CPU work of the same order of magnitude. Deterministic, no sleeps.
func pipelineWork() {
	acc := 0
	for i := 0; i < 500000; i++ {
		acc += i % 7
	}
	if acc < 0 {
		panic("unreachable: keeps the loop from being optimized away")
	}
}

func benchObserve(b *testing.B, profile string, emit func(alert.Alert)) *Manager {
	b.Helper()
	m, err := LoadFile(writeProfilesB(b, profile), emit)
	if err != nil {
		b.Fatal(err)
	}
	return m
}

// BenchmarkBeaconObserveNoFire measures the hot path: one event against
// one profile with no detection. This is the per-event cost the engine
// loop pays for beaconing on every network.connect.
func BenchmarkBeaconObserveNoFire(b *testing.B) {
	m := benchObserve(b, silentProfile, nil)
	base := time.Now()
	ev := netEv("LAB-BENCH", "185.220.101.47", "", 443)
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		m.Observe(ev, base.Add(time.Duration(i)*500*time.Microsecond))
	}
}

// BenchmarkBeaconObserveFirePipeline measures the full sequential cost
// of an observe pass that fires, emitting into a pipeline-priced
// callback. The sequential total is invariant to the lock-scope fix
// (the work only moves out of the critical section) — the guard here
// is that the fix must not make it WORSE.
func BenchmarkBeaconObserveFirePipeline(b *testing.B) {
	m := benchObserve(b, firingProfile, func(alert.Alert) { pipelineWork() })
	base := time.Now()
	ev := netEv("LAB-BENCH", "185.220.101.47", "", 443)
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		m.Observe(ev, base.Add(time.Duration(i)*500*time.Microsecond))
	}
}

// BenchmarkBeaconTrackedUnderFirePipeline is the O1 metric: latency of
// the API stats path (Tracked, called on every /api/stats) while the
// detection pipeline is firing with a pipeline-priced emit. Before the
// lock-scope fix, Tracked waits behind decision+emit under m.mu; after
// it, only behind the decision section. This is the number that must
// drop.
func BenchmarkBeaconTrackedUnderFirePipeline(b *testing.B) {
	m := benchObserve(b, firingProfile, func(alert.Alert) { pipelineWork() })
	base := time.Now()
	ev := netEv("LAB-BENCH", "185.220.101.47", "", 443)
	// deterministic warmup: the key must already be firing before the
	// measurement window (the first b.N probes are calibration runs and
	// may execute the loop body only once)
	for i := 0; i < 12; i++ {
		m.Observe(ev, base.Add(time.Duration(i)*500*time.Microsecond))
	}
	if m.Fired() == 0 {
		b.Fatal("profile does not fire on the bench cadence")
	}
	stop := make(chan struct{})
	done := make(chan struct{})
	go func() {
		defer close(done)
		for i := 12; ; i++ {
			select {
			case <-stop:
				return
			default:
			}
			m.Observe(ev, base.Add(time.Duration(i)*500*time.Microsecond))
		}
	}()
	time.Sleep(2 * time.Millisecond) // let the pipeline goroutine spin up
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		m.Tracked(time.Now())
	}
	b.StopTimer()
	close(stop)
	<-done
}

// fullTableProfile keeps every key in-window for the whole run (10s
// window, one event per key): reclaim always walks BOTH passes (stale
// pass finds nothing, weakest scan over the full table).
const fullTableProfile = `
- name: C2 beacon bench full table
  id: bcn-bench-full
  severity: low
  window: 10s
  min_count: 4
  max_jitter: 1.0
  cooldown: 2ms
`

// BenchmarkBeaconObserveManyKeysFullTable exercises the eviction path:
// one fresh destination per event past the MaxKeys cap makes every
// admission reclaim a slot (stale pass + weakest scan over the whole
// table). Pairs with 04's O1 measurement discipline for risk.
func BenchmarkBeaconObserveManyKeysFullTable(b *testing.B) {
	m := benchObserve(b, fullTableProfile, nil)
	base := time.Now()
	// fill the table with live keys (one event each, all in-window)
	for i := 0; i < MaxKeys; i++ {
		m.Observe(netEv("LAB-BENCH", fmt.Sprintf("10.9.%d.%d", i/254, i%254), "", 443),
			base.Add(time.Duration(i)*time.Microsecond))
	}
	if got := m.Tracked(base.Add(MaxKeys * time.Microsecond)); got != MaxKeys {
		b.Fatalf("table holds %d keys, want %d", got, MaxKeys)
	}
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		// fresh key each time: admission always goes through reclaim
		m.Observe(netEv("LAB-BENCH", fmt.Sprintf("10.10.%d.%d", (i/254)%254, i%254), "", 443),
			base.Add(time.Duration(MaxKeys+i)*time.Microsecond))
	}
}
