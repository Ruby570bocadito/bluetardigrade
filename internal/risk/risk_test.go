package risk

import (
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/Ruby570bocadito/security-framework/internal/rules"
)

var base = time.Date(2026, 9, 30, 12, 0, 0, 0, time.UTC)

func TestWeightsAccumulatePerHost(t *testing.T) {
	tr := New()
	tr.Observe("PC-1", rules.SevCritical, base)
	tr.Observe("PC-1", rules.SevHigh, base)
	tr.Observe("PC-2", rules.SevLow, base)

	got := tr.Snapshot(base, 10)
	if len(got) != 2 {
		t.Fatalf("len = %d, want 2", len(got))
	}
	if got[0].Host != "PC-1" || got[0].Score != 15 {
		t.Errorf("top = %s/%v, want PC-1/15", got[0].Host, got[0].Score)
	}
	if got[1].Host != "PC-2" || got[1].Score != 1 {
		t.Errorf("second = %s/%v, want PC-2/1", got[1].Host, got[1].Score)
	}
	if got[0].Alerts != 2 {
		t.Errorf("alerts = %d, want 2", got[0].Alerts)
	}
	if got[0].LastSeen != base.UTC().Format(time.RFC3339Nano) {
		t.Errorf("last_seen = %q, want %q", got[0].LastSeen, base.UTC().Format(time.RFC3339Nano))
	}
}

func TestInfoSeverityAddsNoScore(t *testing.T) {
	tr := New()
	tr.Observe("PC-1", rules.SevInfo, base)
	// info contributes 0 points: score 0 is below epsilon, so the
	// prune removes the host and the KPI never calls it "hot". An
	// info-only alert is not risk, by definition of the scale.
	if got := tr.Snapshot(base, 10); len(got) != 0 {
		t.Fatalf("got %+v, want empty (info is not risk)", got)
	}
	if tr.Tracked(base) != 0 {
		t.Errorf("tracked = %d, want 0 (score 0 is below epsilon)", tr.Tracked(base))
	}
}

func TestUnknownSeverityGetsLowWeight(t *testing.T) {
	tr := New()
	tr.Observe("PC-1", "purgatory", base) // operator typo in rule YAML
	got := tr.Snapshot(base, 10)
	if len(got) != 1 || got[0].Score != 1 {
		t.Fatalf("got %+v, want score 1 (low weight)", got)
	}
}

func TestEmptyHostIgnored(t *testing.T) {
	tr := New()
	tr.Observe("", rules.SevCritical, base)
	if got := tr.Snapshot(base, 10); len(got) != 0 {
		t.Fatalf("got %+v, want empty", got)
	}
}

func TestHalfLifeDecay(t *testing.T) {
	tr := New()
	tr.Observe("PC-1", rules.SevCritical, base)

	// exactly one half-life later: 10 -> 5
	one := tr.Snapshot(base.Add(HalfLife), 10)
	if one[0].Score != 5 {
		t.Errorf("after one half-life score = %v, want 5", one[0].Score)
	}

	// two half-lives: 10 -> 2.5
	two := tr.Snapshot(base.Add(2*HalfLife), 10)
	if two[0].Score != 2.5 {
		t.Errorf("after two half-lives score = %v, want 2.5", two[0].Score)
	}
}

func TestDecayThenNewAlertResumesFromCurrentScore(t *testing.T) {
	tr := New()
	tr.Observe("PC-1", rules.SevCritical, base) // 10
	// one half-life later a new medium lands: 5 decayed + 2 = 7
	tr.Observe("PC-1", rules.SevMedium, base.Add(HalfLife))
	got := tr.Snapshot(base.Add(HalfLife), 10)
	if got[0].Score != 7 {
		t.Errorf("score = %v, want 7 (5 decayed + 2)", got[0].Score)
	}
	if got[0].Alerts != 2 {
		t.Errorf("alerts = %d, want 2", got[0].Alerts)
	}
}

func TestColdHostPruned(t *testing.T) {
	tr := New()
	tr.Observe("PC-1", rules.SevLow, base)
	// one low alert needs >6.6 half-lives to fall under epsilon;
	// 7 half-lives = 1/128 ≈ 0.0078 < 0.01
	later := base.Add(7 * HalfLife)
	if got := tr.Snapshot(later, 10); len(got) != 0 {
		t.Fatalf("got %+v, want empty (pruned)", got)
	}
	if tr.Tracked(later) != 0 {
		t.Errorf("tracked = %d, want 0", tr.Tracked(later))
	}
}

func TestSnapshotSortedAndTruncatedToTopN(t *testing.T) {
	tr := New()
	tr.Observe("host-b", rules.SevHigh, base)     // 5
	tr.Observe("host-a", rules.SevCritical, base) // 10
	tr.Observe("host-c", rules.SevMedium, base)   // 2
	tr.Observe("host-d", rules.SevMedium, base)   // 2 (tie with host-c)

	got := tr.Snapshot(base, 3)
	if len(got) != 3 {
		t.Fatalf("len = %d, want 3", len(got))
	}
	wantOrder := []string{"host-a", "host-b", "host-c"}
	for i, w := range wantOrder {
		if got[i].Host != w {
			t.Errorf("position %d = %s, want %s", i, got[i].Host, w)
		}
	}
}

func TestTopNZeroAndNegative(t *testing.T) {
	tr := New()
	tr.Observe("PC-1", rules.SevHigh, base)
	// topN 0 = nothing (explicit "give me zero"), negative = unlimited
	if got := tr.Snapshot(base, 0); len(got) != 0 {
		t.Errorf("topN=0 gave %d hosts, want 0", len(got))
	}
	if got := tr.Snapshot(base, -1); len(got) != 1 {
		t.Errorf("topN=-1 gave %d hosts, want 1 (unlimited)", len(got))
	}
}

func TestSnapshotReturnsACopy(t *testing.T) {
	tr := New()
	tr.Observe("PC-1", rules.SevHigh, base)
	got := tr.Snapshot(base, 10)
	got[0].Score = 999
	again := tr.Snapshot(base, 10)
	if again[0].Score != 5 {
		t.Errorf("caller mutation leaked: score = %v, want 5", again[0].Score)
	}
}

func TestCapEvictsColdestNotHottest(t *testing.T) {
	tr := New()
	// fill the map to the cap with low-severity hosts...
	for i := 0; i < MaxHosts; i++ {
		tr.Observe(hostName(i), rules.SevLow, base)
	}
	// ...and one critical that lands later
	tr.Observe("golden-host", rules.SevCritical, base.Add(time.Minute))

	if got := len(tr.hosts); got != MaxHosts {
		t.Fatalf("map size = %d, want capped at %d", got, MaxHosts)
	}
	if _, ok := tr.hosts["golden-host"]; !ok {
		t.Fatalf("golden-host evicted: the freshest, hottest host must survive")
	}
	// the survivor set is the critical host plus the 4095 hottest lows
	if _, ok := tr.hosts[hostName(0)]; ok {
		t.Errorf("hostName(0) survived: eviction must remove the coldest, not the first")
	}
}

func TestCapEvictionDeterministicOnTies(t *testing.T) {
	tr := New()
	// every host identical: eviction must be deterministic (smallest
	// hostname goes) so two engines seeing the same feed agree
	tr.Observe("host-b", rules.SevLow, base)
	tr.Observe("host-a", rules.SevLow, base)
	tr.hosts["host-c"] = &hostState{score: 1, alerts: 1, lastSeen: base} // map size 3
	tr.evictColdestLocked(base)
	if _, ok := tr.hosts["host-a"]; ok {
		t.Errorf("host-a survived a tie; the lexicographically smallest must be the one removed")
	}
	if _, ok := tr.hosts["host-b"]; !ok {
		t.Errorf("host-b must survive (only one eviction per call)")
	}
}

func TestNoPanicOnEvictEmpty(t *testing.T) {
	tr := New()
	tr.evictColdestLocked(base) // must be a no-op, not a panic
}

func TestConcurrentObserveAndSnapshot(t *testing.T) {
	tr := New()
	var wg sync.WaitGroup
	for w := 0; w < 8; w++ {
		wg.Add(1)
		go func(w int) {
			defer wg.Done()
			for i := 0; i < 500; i++ {
				tr.Observe(hostName((w*500+i)%50), rules.SevMedium, base.Add(time.Duration(i)*time.Second))
				_ = tr.Snapshot(base.Add(time.Duration(i)*time.Second), 5)
				_ = tr.Tracked(base)
			}
		}(w)
	}
	wg.Wait()
	if got := tr.Tracked(base.Add(time.Hour)); got > 50 {
		t.Errorf("tracked = %d, want <= 50", got)
	}
}

func hostName(i int) string {
	return "host-" + strconv.Itoa(i)
}

func TestRound2(t *testing.T) {
	cases := []struct {
		in, want float64
	}{
		{5, 5},
		{4.999999999, 5},
		{2.5, 2.5},
		{0.005, 0.01},
		{0.004999, 0},
	}
	for _, c := range cases {
		if got := round2(c.in); got != c.want {
			t.Errorf("round2(%v) = %v, want %v", c.in, got, c.want)
		}
	}
}
