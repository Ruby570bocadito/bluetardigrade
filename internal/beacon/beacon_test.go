package beacon

import (
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/Ruby570bocadito/security-framework/internal/alert"
	"github.com/Ruby570bocadito/security-framework/pkg/model"
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
