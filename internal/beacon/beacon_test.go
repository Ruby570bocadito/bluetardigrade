package beacon

import (
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/alert"
	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
)

// writeProfiles materializes a beacons YAML file in a temp dir and
// returns its path.
func writeProfiles(t *testing.T, yaml string) string {
	t.Helper()
	dir := t.TempDir()
	p := filepath.Join(dir, "beacons.yaml")
	if err := os.WriteFile(p, []byte(yaml), 0o600); err != nil {
		t.Fatal(err)
	}
	return p
}

const strictProfile = `
- name: C2 beacon test
  id: bcn-test
  severity: high
  window: 5m
  min_count: 8
  max_jitter: 0.2
  min_interval: 500ms
  cooldown: 10m
`

// netEv builds a network.connect event for one destination.
func netEv(host, ip, domain string, port int) *model.Event {
	return &model.Event{
		ID:   fmt.Sprintf("ev-%s-%d", ip, port),
		Type: model.TypeNetworkConnect,
		Host: host,
		Network: &model.Network{
			Protocol:        "tcp",
			SourceIP:        "10.0.4.42",
			DestinationIP:   ip,
			DestinationPort: port,
			Domain:          domain,
		},
	}
}

// feedRegular delivers n connections to one destination, interval apart.
func feedRegular(m *Manager, n int, interval time.Duration, host, ip, domain string, port int, base time.Time) {
	for i := 0; i < n; i++ {
		m.Observe(netEv(host, ip, domain, port), base.Add(time.Duration(i)*interval))
	}
}

func TestDetectsRegularBeacon(t *testing.T) {
	m, err := LoadFile(writeProfiles(t, strictProfile), nil)
	if err != nil {
		t.Fatal(err)
	}
	base := time.Date(2026, 9, 30, 12, 0, 0, 0, time.UTC)
	var got []alert.Alert
	m.SetEmit(func(a alert.Alert) { got = append(got, a) })

	feedRegular(m, 12, time.Second, "LAB-WKS-01", "185.220.101.47", "", 443, base)

	if len(got) != 1 {
		t.Fatalf("emitted %d alerts, want exactly 1 (regular 1s cadence, min_count 8)", len(got))
	}
	a := got[0]
	if a.RuleID != "bcn-test" || a.Severity != "high" || a.Host != "LAB-WKS-01" {
		t.Errorf("alert identity = %s/%s/%s, want bcn-test/high/LAB-WKS-01", a.RuleID, a.Severity, a.Host)
	}
	if a.EventType != model.TypeNetworkConnect || a.EventID == "" {
		t.Errorf("event binding = type %q id %q, want network.connect with the trigger id", a.EventType, a.EventID)
	}
	if want := "beacon hacia 185.220.101.47:443"; !contains(a.Summary, want) {
		t.Errorf("summary %q does not name the destination %q", a.Summary, want)
	}
	if m.Fired() != 1 {
		t.Errorf("Fired() = %d, want 1", m.Fired())
	}
	if n := m.Tracked(base.Add(12 * time.Second)); n != 1 {
		t.Errorf("Tracked() = %d, want 1 (one live destination)", n)
	}
}

func contains(s, sub string) bool {
	return len(s) >= len(sub) && (s == sub || len(sub) == 0 || indexOf(s, sub) >= 0)
}

func indexOf(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}

func TestDoesNotFireBelowMinCount(t *testing.T) {
	m, err := LoadFile(writeProfiles(t, strictProfile), nil)
	if err != nil {
		t.Fatal(err)
	}
	base := time.Date(2026, 9, 30, 12, 0, 0, 0, time.UTC)
	fired := 0
	m.SetEmit(func(alert.Alert) { fired++ })

	feedRegular(m, 7, time.Second, "LAB-WKS-01", "185.220.101.47", "", 443, base)

	if fired != 0 {
		t.Fatalf("fired %d times with 7 connections (min_count 8): premature detection", fired)
	}
}

func TestDoesNotFireWithHighJitter(t *testing.T) {
	m, err := LoadFile(writeProfiles(t, strictProfile), nil)
	if err != nil {
		t.Fatal(err)
	}
	base := time.Date(2026, 9, 30, 12, 0, 0, 0, time.UTC)
	fired := 0
	m.SetEmit(func(alert.Alert) { fired++ })

	// Human-ish browsing: wildly varying gaps, same destination.
	gaps := []time.Duration{200 * time.Millisecond, 3 * time.Second, 700 * time.Millisecond,
		5 * time.Second, 150 * time.Millisecond, 2 * time.Second, 4 * time.Second,
		600 * time.Millisecond, 3 * time.Second, 900 * time.Millisecond, 2 * time.Second}
	at := base
	for i := 0; i < 24; i++ {
		m.Observe(netEv("LAB-WKS-01", "142.250.200.36", "", 443), at)
		at = at.Add(gaps[i%len(gaps)])
	}
	if fired != 0 {
		t.Fatalf("fired %d times on high-jitter traffic (CV far over 0.2)", fired)
	}
}

func TestMinIntervalGuardsFastRegularTraffic(t *testing.T) {
	base := time.Date(2026, 9, 30, 12, 0, 0, 0, time.UTC)

	// Same perfectly regular 100ms cadence: with min_interval it must
	// stay silent, without it the detector fires.
	withFloor, err := LoadFile(writeProfiles(t, `
- name: floored
  id: bcn-floor
  severity: medium
  window: 1m
  min_count: 8
  max_jitter: 0.2
  min_interval: 1s
`), nil)
	if err != nil {
		t.Fatal(err)
	}
	fired := 0
	withFloor.SetEmit(func(alert.Alert) { fired++ })
	feedRegular(withFloor, 20, 100*time.Millisecond, "LAB-WKS-01", "1.2.3.4", "", 8080, base)
	if fired != 0 {
		t.Fatalf("fired %d times on 100ms cadence with min_interval 1s: the floor knob is broken", fired)
	}

	noFloor, err := LoadFile(writeProfiles(t, `
- name: unfloored
  id: bcn-nofloor
  severity: medium
  window: 1m
  min_count: 8
  max_jitter: 0.2
`), nil)
	if err != nil {
		t.Fatal(err)
	}
	fired2 := 0
	noFloor.SetEmit(func(alert.Alert) { fired2++ })
	feedRegular(noFloor, 12, 100*time.Millisecond, "LAB-WKS-01", "1.2.3.4", "", 8080, base)
	if fired2 != 1 {
		t.Fatalf("fired %d times on regular 100ms cadence without floor, want 1 (documented tradeoff)", fired2)
	}
}

func TestCooldownBlocksRefire(t *testing.T) {
	m, err := LoadFile(writeProfiles(t, strictProfile), nil)
	if err != nil {
		t.Fatal(err)
	}
	base := time.Date(2026, 9, 30, 12, 0, 0, 0, time.UTC)
	fired := 0
	m.SetEmit(func(alert.Alert) { fired++ })

	// 9 minutes of one-beacon-per-second traffic: the first 8
	// connections fire; everything after stays inside the 10m cooldown
	// (9 minutes of continuous firing is ONE alert — that is the point
	// of the cooldown).
	feedRegular(m, 9*60, time.Second, "LAB-WKS-01", "185.220.101.47", "", 443, base)
	if fired != 1 {
		t.Fatalf("fired %d times across 9m of continuous beaconing with cooldown 10m, want 1", fired)
	}

	// Past the cooldown the key re-arms and fires again (the ring is
	// pruned to the new window; 8 fresh connections re-arm it).
	feedRegular(m, 12, time.Second, "LAB-WKS-01", "185.220.101.47", "", 443, base.Add(21*time.Minute))
	if fired != 2 {
		t.Fatalf("fired %d times after the cooldown expired, want 2", fired)
	}
}

func TestPortFilter(t *testing.T) {
	m, err := LoadFile(writeProfiles(t, `
- name: web only
  id: bcn-web
  severity: high
  window: 5m
  min_count: 6
  max_jitter: 0.2
  ports: [443, 8443]
`), nil)
	if err != nil {
		t.Fatal(err)
	}
	base := time.Date(2026, 9, 30, 12, 0, 0, 0, time.UTC)
	fired := 0
	m.SetEmit(func(alert.Alert) { fired++ })

	feedRegular(m, 12, time.Second, "LAB-WKS-01", "185.220.101.47", "", 22, base)
	if fired != 0 {
		t.Fatalf("fired %d times on a port outside the allowlist", fired)
	}
	feedRegular(m, 8, time.Second, "LAB-WKS-01", "185.220.101.47", "", 8443, base)
	if fired != 1 {
		t.Fatalf("fired %d times on allowlisted port 8443, want 1", fired)
	}
}

func TestHostCaseFoldsAndDomainIPAreDistinctKeys(t *testing.T) {
	m, err := LoadFile(writeProfiles(t, strictProfile), nil)
	if err != nil {
		t.Fatal(err)
	}
	base := time.Date(2026, 9, 30, 12, 0, 0, 0, time.UTC)

	// One destination reached from a host whose case flips between
	// events (Windows reports arbitrary case): ONE key, evidence
	// accumulates in one ring.
	for i := 0; i < 10; i++ {
		host := "LAB-WKS-01"
		if i%2 == 0 {
			host = "lab-wks-01"
		}
		m.Observe(netEv(host, "185.220.101.47", "", 443), base.Add(time.Duration(i)*time.Second))
	}
	if n := m.Tracked(base.Add(11 * time.Second)); n != 1 {
		t.Fatalf("Tracked() = %d, want 1 (host case folds into one key)", n)
	}
	if m.Fired() != 1 {
		t.Fatalf("Fired() = %d, want 1 (case-flipped evidence accumulated)", m.Fired())
	}

	// Domain and IP are DISTINCT keys by design: the detector sees the
	// destination as the sensor reports it, and folding them would
	// require DNS resolution the engine does not have. Each form
	// accumulates its own evidence.
	m2, err := LoadFile(writeProfiles(t, strictProfile), nil)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 6; i++ {
		m2.Observe(netEv("LAB-WKS-01", "185.220.101.47", "evil.example.net", 443), base.Add(time.Duration(i)*time.Second))
		m2.Observe(netEv("LAB-WKS-01", "185.220.101.47", "", 443), base.Add(time.Duration(i)*time.Second))
	}
	if n := m2.Tracked(base.Add(7 * time.Second)); n != 2 {
		t.Fatalf("Tracked() = %d, want 2 (domain-keyed and IP-keyed rings are separate)", n)
	}
	if m2.Fired() != 0 {
		t.Fatalf("Fired() = %d, want 0 (split evidence: neither ring reached min_count)", m2.Fired())
	}
}

func TestBoundsFloodEvictionKeepsHotKey(t *testing.T) {
	m, err := LoadFile(writeProfiles(t, strictProfile), nil)
	if err != nil {
		t.Fatal(err)
	}
	base := time.Date(2026, 9, 30, 12, 0, 0, 0, time.UTC)
	fired := 0
	m.SetEmit(func(alert.Alert) { fired++ })

	// A hostile flood of unique destinations fills the whole map first
	// (one connection each, timestamped before the beacon starts — the
	// global feed stays non-decreasing, the engine's contract).
	at := base
	for i := 0; i < MaxKeys+64; i++ {
		m.Observe(netEv(fmt.Sprintf("fake-%04x", i%256), fmt.Sprintf("10.9.%d.%d", i/256%256, i%256), "", 1024+i%60000), at)
		at = at.Add(time.Millisecond)
	}
	if len(m.state) > MaxKeys {
		t.Fatalf("state map grew to %d keys, cap is %d", len(m.state), MaxKeys)
	}

	// NOW a genuinely beaconing key starts. Its admissions evict
	// one-sample flood entries (weakest-evidence eviction), never the
	// other way round, and the 8th regular connection fires.
	floodEnd := at
	feedRegular(m, 8, time.Second, "LAB-WKS-01", "185.220.101.47", "", 443, floodEnd)
	if fired != 1 {
		t.Fatalf("hot key did not fire after the flood (fired=%d): eviction washed out building evidence", fired)
	}
}

func TestReloadPrunesDeadProfilesKeepsLive(t *testing.T) {
	path := writeProfiles(t, `
- name: p1
  id: bcn-p1
  severity: low
  window: 5m
  min_count: 3
  max_jitter: 0.5
- name: p2
  id: bcn-p2
  severity: low
  window: 5m
  min_count: 3
  max_jitter: 0.5
`)
	m, err := LoadFile(path, nil)
	if err != nil {
		t.Fatal(err)
	}
	base := time.Date(2026, 9, 30, 12, 0, 0, 0, time.UTC)
	feedRegular(m, 4, time.Second, "LAB-WKS-01", "1.1.1.1", "", 443, base)
	if got := len(m.state); got != 2 {
		t.Fatalf("state keys = %d, want 2 (one per profile)", got)
	}

	// bcn-p1 disappears from the config: its state must go, bcn-p2's stays.
	if err := os.WriteFile(path, []byte(`
- name: p2
  id: bcn-p2
  severity: low
  window: 5m
  min_count: 3
  max_jitter: 0.5
`), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := m.Reload(path); err != nil {
		t.Fatal(err)
	}
	if got := len(m.state); got != 1 {
		t.Fatalf("state keys after reload = %d, want 1 (dead profile pruned)", got)
	}
	if m.Count() != 1 {
		t.Fatalf("Count() after reload = %d, want 1", m.Count())
	}
}

func TestReloadKeepsStateForSurvivingProfiles(t *testing.T) {
	path := writeProfiles(t, strictProfile)
	m, err := LoadFile(path, nil)
	if err != nil {
		t.Fatal(err)
	}
	base := time.Date(2026, 9, 30, 12, 0, 0, 0, time.UTC)
	feedRegular(m, 7, time.Second, "LAB-WKS-01", "185.220.101.47", "", 443, base)

	// Same profile id, renamed display name: the ring must survive so
	// the 8th connection still fires after the reload.
	if err := os.WriteFile(path, []byte(`
- name: C2 beacon renamed
  id: bcn-test
  severity: high
  window: 5m
  min_count: 8
  max_jitter: 0.2
  min_interval: 500ms
  cooldown: 10m
`), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := m.Reload(path); err != nil {
		t.Fatal(err)
	}
	fired := 0
	m.SetEmit(func(alert.Alert) { fired++ })
	// the 8th connection continues the exact 1s cadence (base+7s):
	// any gap would legitimately break the CV gate
	m.Observe(netEv("LAB-WKS-01", "185.220.101.47", "", 443), base.Add(7*time.Second))
	if fired != 1 {
		t.Fatalf("fired=%d after reload with surviving profile: state was reset", fired)
	}
}

func TestMalformedProfilesAreLoadErrors(t *testing.T) {
	cases := map[string]string{
		"bad severity": `
- name: x
  id: i
  severity: apocalyptic
  window: 5m
  min_count: 8
  max_jitter: 0.2
`,
		"min_count below 2": `
- name: x
  id: i
  severity: low
  window: 5m
  min_count: 1
  max_jitter: 0.2
`,
		"min_count over the ring": fmt.Sprintf(`
- name: x
  id: i
  severity: low
  window: 5m
  min_count: %d
  max_jitter: 0.2
`, RingCap+1),
		"max_jitter zero": `
- name: x
  id: i
  severity: low
  window: 5m
  min_count: 8
  max_jitter: 0
`,
		"max_jitter over 1": `
- name: x
  id: i
  severity: low
  window: 5m
  min_count: 8
  max_jitter: 1.5
`,
		"bad window": `
- name: x
  id: i
  severity: low
  window: five minutes
  min_count: 8
  max_jitter: 0.2
`,
		"port out of range": `
- name: x
  id: i
  severity: low
  window: 5m
  min_count: 8
  max_jitter: 0.2
  ports: [70000]
`,
		"duplicate id": `
- name: a
  id: same
  severity: low
  window: 5m
  min_count: 8
  max_jitter: 0.2
- name: b
  id: same
  severity: low
  window: 5m
  min_count: 8
  max_jitter: 0.2
`,
		"missing name": `
- id: i
  severity: low
  window: 5m
  min_count: 8
  max_jitter: 0.2
`,
		"missing id": `
- name: x
  severity: low
  window: 5m
  min_count: 8
  max_jitter: 0.2
`,
		"bad cooldown": `
- name: x
  id: i
  severity: low
  window: 5m
  min_count: 8
  max_jitter: 0.2
  cooldown: -3s
`,
	}
	for label, yaml := range cases {
		if _, err := LoadFile(writeProfiles(t, yaml), nil); err == nil {
			t.Errorf("%s: LoadFile succeeded, want a loud config error", label)
		}
	}
}

func TestFileOverCapRejected(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "beacons.yaml")
	big := make([]byte, maxFileBytes+1)
	if err := os.WriteFile(p, big, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadFile(p, nil); err == nil {
		t.Fatal("LoadFile accepted an oversized file")
	}
}

func TestNonNetworkEventsIgnored(t *testing.T) {
	m, err := LoadFile(writeProfiles(t, strictProfile), nil)
	if err != nil {
		t.Fatal(err)
	}
	base := time.Date(2026, 9, 30, 12, 0, 0, 0, time.UTC)
	m.Observe(nil, base)
	m.Observe(&model.Event{ID: "e1", Type: model.TypeProcessCreate}, base)
	m.Observe(&model.Event{ID: "e2", Type: model.TypeNetworkConnect}, base) // nil Network
	if len(m.state) != 0 {
		t.Fatalf("state grew on non-network input: %d keys", len(m.state))
	}
}

func TestTrackedCountsOnlyInWindowEvidence(t *testing.T) {
	m, err := LoadFile(writeProfiles(t, strictProfile), nil)
	if err != nil {
		t.Fatal(err)
	}
	base := time.Date(2026, 9, 30, 12, 0, 0, 0, time.UTC)
	feedRegular(m, 10, time.Second, "LAB-WKS-01", "185.220.101.47", "", 443, base)
	if n := m.Tracked(base.Add(2 * time.Minute)); n != 1 {
		t.Fatalf("Tracked in-window = %d, want 1", n)
	}
	if n := m.Tracked(base.Add(10 * time.Minute)); n != 0 {
		t.Fatalf("Tracked after the window = %d, want 0 (stale evidence is not live signal)", n)
	}
}

func TestConcurrentObserveAndReads(t *testing.T) {
	m, err := LoadFile(writeProfiles(t, strictProfile), nil)
	if err != nil {
		t.Fatal(err)
	}
	base := time.Date(2026, 9, 30, 12, 0, 0, 0, time.UTC)
	done := make(chan struct{})
	var wg sync.WaitGroup
	for w := 0; w < 4; w++ {
		wg.Add(1)
		go func(w int) {
			defer wg.Done()
			for i := 0; i < 200; i++ {
				m.Observe(netEv("LAB-WKS-01", fmt.Sprintf("10.0.%d.%d", w, i), "", 443), base.Add(time.Duration(i)*time.Second))
			}
		}(w)
	}
	go func() {
		for i := 0; i < 400; i++ {
			m.Tracked(base.Add(time.Duration(i) * time.Second))
			m.Fired()
			m.Count()
		}
		close(done)
	}()
	wg.Wait()
	<-done
}

// ---- event-time semantics (review 2026-10-02) ---------------------------

func netEvAt(ts time.Time) *model.Event {
	ev := netEv("LAB-WKS-01", "185.220.101.47", "", 443)
	ev.Timestamp = ts
	return ev
}

// An offline import replays a regular beacon in a burst: every event
// reaches the engine at the same wall instant. Arrival times would see
// zero intervals; event times see the real 30 s cadence.
func TestImportedBeaconJudgedOnEventTime(t *testing.T) {
	m, err := LoadFile(writeProfiles(t, strictProfile), nil)
	if err != nil {
		t.Fatal(err)
	}
	var got int
	m.SetEmit(func(alert.Alert) { got++ })
	happened := time.Date(2026, 9, 1, 3, 0, 0, 0, time.UTC)
	wall := time.Date(2026, 10, 2, 12, 0, 0, 0, time.UTC)
	for i := 0; i < 9; i++ {
		m.Observe(netEvAt(happened.Add(time.Duration(i)*30*time.Second)), wall)
	}
	if got != 1 {
		t.Fatalf("imported 30s beacon fired %d alerts, want 1", got)
	}
}

// A live sensor batching its events (arrival jitter) still shows the
// beacon's real regularity.
func TestArrivalJitterDoesNotHideBeacon(t *testing.T) {
	m, _ := LoadFile(writeProfiles(t, strictProfile), nil)
	var got int
	m.SetEmit(func(alert.Alert) { got++ })
	base := time.Date(2026, 10, 2, 12, 0, 0, 0, time.UTC)
	for i := 0; i < 9; i++ {
		happened := base.Add(time.Duration(i) * 20 * time.Second)
		// delivered in batches every 60 s
		arrival := base.Add(time.Duration(i/3+1) * time.Minute)
		m.Observe(netEvAt(happened), arrival)
	}
	if got != 1 {
		t.Fatalf("batched 20s beacon fired %d alerts, want 1", got)
	}
}

// Late events are placed in order; a far older one restarts the ring
// instead of being silently pruned forever.
func TestLateAndDiscontinuousSamples(t *testing.T) {
	m, _ := LoadFile(writeProfiles(t, strictProfile), nil)
	var got int
	m.SetEmit(func(alert.Alert) { got++ })
	base := time.Date(2026, 10, 2, 12, 0, 0, 0, time.UTC)
	order := []int{0, 2, 1, 3, 5, 4, 6, 8, 7} // pairwise swapped arrivals
	for _, i := range order {
		m.Observe(netEvAt(base.Add(time.Duration(i)*10*time.Second)), base.Add(2*time.Minute))
	}
	if got != 1 {
		t.Fatalf("reordered regular samples fired %d alerts, want 1", got)
	}
	// clock stepped back an hour: the ring restarts at the new time
	m.mu.Lock()
	var st *keyState
	for _, s := range m.state {
		st = s
	}
	m.mu.Unlock()
	m.Observe(netEvAt(base.Add(-time.Hour)), base.Add(3*time.Minute))
	m.mu.Lock()
	n, first := len(st.times), st.times[0]
	m.mu.Unlock()
	if n != 1 || !first.Equal(base.Add(-time.Hour)) {
		t.Fatalf("discontinuity did not restart the ring: %d samples, first %v", n, first)
	}
}

// A timestamp far in the future is clamped to the engine clock.
func TestFutureTimestampClamped(t *testing.T) {
	wall := time.Date(2026, 10, 2, 12, 0, 0, 0, time.UTC)
	ev := netEvAt(wall.Add(24 * time.Hour))
	if got := ev.DetectionTime(wall); !got.Equal(wall) {
		t.Fatalf("future timestamp used as is: %v", got)
	}
	ev.Timestamp = wall.Add(-time.Hour)
	if got := ev.DetectionTime(wall); !got.Equal(wall.Add(-time.Hour)) {
		t.Fatalf("past timestamp not used: %v", got)
	}
}

// Found on a real desktop: browsers and telemetry re-resolve names every
// ~64 s and a router answers DNS on a link-local address; neither is C2.
func TestDNSQueriesAndLocalPlumbingNeverBeacon(t *testing.T) {
	m, err := LoadFile(writeProfiles(t, strictProfile), nil)
	if err != nil {
		t.Fatal(err)
	}
	base := time.Date(2026, 10, 4, 19, 40, 0, 0, time.UTC)
	var got []alert.Alert
	m.SetEmit(func(a alert.Alert) { got = append(got, a) })
	for i := 0; i < 20; i++ {
		at := base.Add(time.Duration(i) * time.Second)
		dns := netEv("PC", "", "www.google.com", 0)
		dns.Network.Protocol = "dns"
		m.Observe(dns, at)
		m.Observe(netEv("PC", "fe80::ceba:bdff:fe7e:7ee8", "", 53), at)
		m.Observe(netEv("PC", "127.0.0.1", "", 8080), at)
		m.Observe(netEv("PC", "ff02::fb", "", 5353), at)
	}
	if len(got) != 0 {
		t.Fatalf("DNS lookups and local addresses fired: %+v", got)
	}
	// the same cadence to a routable address still fires
	feedRegular(m, 12, time.Second, "PC", "203.0.113.50", "", 443, base.Add(time.Hour))
	if len(got) != 1 {
		t.Fatalf("a real beacon must still fire, got %d", len(got))
	}
}

func TestResolverTrafficOfTheDNSClientNeverBeacons(t *testing.T) {
	m, err := LoadFile(writeProfiles(t, strictProfile), nil)
	if err != nil {
		t.Fatal(err)
	}
	base := time.Date(2026, 10, 5, 12, 0, 0, 0, time.UTC)
	var got []alert.Alert
	m.SetEmit(func(a alert.Alert) { got = append(got, a) })
	// seen on a real host: svchost.exe (DNS Client) to the Wi-Fi's DNS
	// server over TCP every ~64 s
	for i := 0; i < 12; i++ {
		ev := netEv("PC", "10.135.6.93", "", 53)
		ev.Process = &model.Process{Name: "svchost.exe"}
		m.Observe(ev, base.Add(time.Duration(i)*time.Second))
	}
	if len(got) != 0 {
		t.Fatalf("the DNS Client's resolver traffic fired: %+v", got)
	}
	// any other process talking to port 53 on a cadence is still judged
	for i := 0; i < 12; i++ {
		ev := netEv("PC", "203.0.113.53", "", 53)
		ev.Process = &model.Process{Name: "updater.exe"}
		m.Observe(ev, base.Add(time.Hour+time.Duration(i)*time.Second))
	}
	if len(got) != 1 {
		t.Fatalf("a process beaconing to port 53 must still fire, got %d", len(got))
	}
}

func TestExcludedDomainsAndTheirSubdomains(t *testing.T) {
	m, err := LoadFile(writeProfiles(t, strictProfile+"  exclude_domains: [whatsapp.com, '*.Example.NET.']\n"), nil)
	if err != nil {
		t.Fatal(err)
	}
	base := time.Date(2026, 10, 5, 12, 0, 0, 0, time.UTC)
	var got []alert.Alert
	m.SetEmit(func(a alert.Alert) { got = append(got, a) })
	feedRegular(m, 12, time.Second, "PC", "157.240.0.53", "web.whatsapp.com", 5222, base)
	feedRegular(m, 12, time.Second, "PC", "157.240.0.54", "whatsapp.com", 443, base)
	feedRegular(m, 12, time.Second, "PC", "198.51.100.7", "cdn.example.net", 443, base)
	if len(got) != 0 {
		t.Fatalf("excluded services fired: %+v", got)
	}
	// a look-alike that only ends with the same letters is not excluded
	feedRegular(m, 12, time.Second, "PC", "203.0.113.9", "evilwhatsapp.com", 443, base.Add(time.Hour))
	// and the same IP without a domain is judged as usual
	feedRegular(m, 12, time.Second, "PC", "157.240.0.55", "", 443, base.Add(2*time.Hour))
	if len(got) != 2 {
		t.Fatalf("look-alike and IP-only destinations must fire, got %d", len(got))
	}
}

func TestExcludeDomainsValidation(t *testing.T) {
	for _, bad := range []string{"com", "", "what sapp.com", "a..b", "*"} {
		y := strictProfile + "  exclude_domains: ['" + bad + "']\n"
		if _, err := LoadFile(writeProfiles(t, y), nil); err == nil {
			t.Errorf("exclude_domains %q was accepted", bad)
		}
	}
}

// The profiles shipped with the engine must load: a malformed file is
// fatal at startup.
func TestShippedProfilesLoad(t *testing.T) {
	m, err := LoadFile(filepath.Join("..", "..", "beacons.yaml"), nil)
	if err != nil {
		t.Fatalf("beacons.yaml: %v", err)
	}
	if m.Count() == 0 {
		t.Fatal("beacons.yaml loaded no profile")
	}
}

func TestHostQuotaKeepsTheOthersTableSafe(t *testing.T) {
	// v1.1 cuotas por equipo: un equipo que escanea destinos unicos
	// llena SU cuota (25% de la tabla) y ahi se queda: techo de
	// admision (sin expulsion), contador honesto, y los demas equipos
	// admiten con normalidad.
	m, err := LoadFile(writeProfiles(t, strictProfile), nil)
	if err != nil {
		t.Fatal(err)
	}
	base := time.Date(2026, 9, 30, 12, 0, 0, 0, time.UTC)
	at := base
	for i := 0; i < MaxKeysPerHost; i++ {
		m.Observe(netEv("NOISY", fmt.Sprintf("10.9.%d.%d", i/256%256, i%256), "", 1024+i), at)
		at = at.Add(time.Millisecond)
	}
	if n := len(m.state); n != MaxKeysPerHost {
		t.Fatalf("state = %d, want %d", n, MaxKeysPerHost)
	}
	// el host saturado no admite destinos nuevos
	m.Observe(netEv("NOISY", "10.9.250.1", "", 40000), at)
	if n := len(m.state); n != MaxKeysPerHost {
		t.Fatalf("la cuota admitio o expulso: state=%d", n)
	}
	if got := m.QuotaRejected(); got != 1 {
		t.Fatalf("QuotaRejected=%d, want 1", got)
	}
	// otro host sigue admitiendo su evidencia
	m.Observe(netEv("VICTIM", "185.220.101.47", "", 443), at)
	if n := len(m.state); n != MaxKeysPerHost+1 {
		t.Fatalf("la victima no admite: state=%d", n)
	}
	top := m.QuotaTopHosts()
	if len(top) != 1 || top[0].Host != "noisy" || top[0].Rejected != 1 {
		t.Fatalf("QuotaTopHosts=%+v", top)
	}
}

func TestHostQuotaFreesWhenKeysGoStale(t *testing.T) {
	// la cuota por host se auto-repara: al rechazar, la evidencia
	// muerta (2x ventana sin senal) se reclama antes de negar la
	// admision, sin esperar a que el cap global se llene.
	m, err := LoadFile(writeProfiles(t, strictProfile), nil)
	if err != nil {
		t.Fatal(err)
	}
	base := time.Date(2026, 9, 30, 12, 0, 0, 0, time.UTC)
	at := base
	for i := 0; i < MaxKeysPerHost; i++ {
		m.Observe(netEv("NOISY", fmt.Sprintf("10.9.%d.%d", i/256%256, i%256), "", 1024+i), at)
		at = at.Add(time.Millisecond)
	}
	// 11 minutos despues todo es stale (2x ventana de 5m); una
	// admision nueva del mismo host reclama la evidencia muerta y entra
	later := base.Add(11 * time.Minute)
	m.Observe(netEv("NOISY", "10.9.250.2", "", 40001), later)
	if n := len(m.state); n != 1 {
		t.Fatalf("la cuota no libero la evidencia stale: state=%d, want 1", n)
	}
	if got := m.QuotaRejected(); got != 0 {
		t.Fatalf("QuotaRejected=%d, want 0 (hubo sitio tras la reclamacion)", got)
	}
}
