package notify

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/alert"
)

// stubChannel records deliveries and can be told to fail.
type stubChannel struct {
	name    string
	mu      sync.Mutex
	got     []alert.Alert
	fail    error // when non-nil, Deliver returns it
	calls   int
	blockGC chan struct{} // when non-nil, Deliver waits on it after recording
}

func (s *stubChannel) Name() string { return s.name }

func (s *stubChannel) Deliver(_ context.Context, a alert.Alert) error {
	s.mu.Lock()
	s.calls++
	s.got = append(s.got, a)
	gc := s.blockGC
	s.mu.Unlock()
	if gc != nil {
		<-gc
	}
	if s.fail != nil {
		return s.fail
	}
	return nil
}

func (s *stubChannel) Retryable(err error) bool { return isRetryable(err) }

func (s *stubChannel) count() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.calls
}

func TestServiceFansOutToEveryChannel(t *testing.T) {
	a := sampleAlert()
	c1 := &stubChannel{name: "a"}
	c2 := &stubChannel{name: "b"}
	s := New(c1, c2)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	s.Run(ctx)

	s.Handle(a)
	waitFor(t, func() bool { return c1.count() == 1 && c2.count() == 1 })

	cancel()
	s.Wait()
	stats := s.Stats()
	if stats[0].Sent != 1 || stats[1].Sent != 1 {
		t.Fatalf("stats = %+v", stats)
	}
}

func TestServiceSeverityFloorFiltersAndCounts(t *testing.T) {
	crit := &stubChannel{name: "crit"}
	s := New(crit)
	s.workers[0].minSev = rankCritical
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	s.Run(ctx)

	low := sampleAlert()
	low.Severity = "low"
	s.Handle(low)
	s.Handle(sampleAlert()) // critical passes

	waitFor(t, func() bool { return crit.count() == 1 })
	cancel()
	s.Wait()

	if crit.got[0].Severity != "critical" {
		t.Fatalf("filtered channel received %q", crit.got[0].Severity)
	}
	stats := s.Stats()
	if stats[0].Filtered != 1 || stats[0].Sent != 1 {
		t.Fatalf("stats = %+v (want filtered=1, sent=1)", stats[0])
	}
}

func TestServiceUnknownSeverityIsFilteredByAnyFloor(t *testing.T) {
	c := &stubChannel{name: "x"}
	s := New(c)
	s.workers[0].minSev = rankInfo // even the lowest floor rejects unknown
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	s.Run(ctx)

	weird := sampleAlert()
	weird.Severity = "banana"
	s.Handle(weird)
	waitFor(t, func() bool { return s.Stats()[0].Filtered == 1 })
	cancel()
	s.Wait()
	if c.count() != 0 {
		t.Fatalf("unknown severity delivered: %d calls", c.count())
	}
}

func TestServiceDropsWhenQueueFullAndKeepsOtherChannels(t *testing.T) {
	slow := &stubChannel{name: "slow", blockGC: make(chan struct{})}
	fast := &stubChannel{name: "fast"}
	s := New(slow, fast)
	// Shrink the slow channel's queue to force drops deterministically.
	s.workers[0].queue = make(chan alert.Alert, 1)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	s.Run(ctx)

	// Park the slow worker inside Deliver so the queue state is stable:
	// alert 1 is being delivered (blocked), the queue then holds exactly
	// one more frame and every following Handle is a deterministic drop.
	s.Handle(sampleAlert())
	waitFor(t, func() bool { return slow.count() == 1 })
	for i := 0; i < 10; i++ {
		s.Handle(sampleAlert())
	}
	stats := s.Stats()
	var slowStats, fastStats ChannelStats
	for _, cs := range stats {
		switch cs.Name {
		case "slow":
			slowStats = cs
		case "fast":
			fastStats = cs
		}
	}
	if slowStats.Dropped != 9 || slowStats.Sent != 0 {
		t.Fatalf("slow channel: dropped %d sent %d, want 9/0 while parked: %+v", slowStats.Dropped, slowStats.Sent, slowStats)
	}
	if fastStats.Dropped != 0 {
		t.Fatalf("fast channel must never drop while its queue holds: %+v", fastStats)
	}
	close(slow.blockGC)
	waitFor(t, func() bool { return fast.count() == 11 })
	cancel()
	s.Wait()
}

func TestServiceRetriesRetryableAndCountsPermanent(t *testing.T) {
	perm := &stubChannel{name: "perm", fail: &deliveryError{err: errors.New("nope"), retryable: false}}
	trans := &stubChannel{name: "trans", fail: &deliveryError{err: errors.New("flaky"), retryable: true}}
	s := New(perm, trans)
	s.backoff = time.Millisecond // keep the test fast
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	s.Run(ctx)

	s.Handle(sampleAlert())
	waitFor(t, func() bool { return perm.count() == 1 && trans.count() == 3 })

	cancel()
	s.Wait()
	stats := s.Stats()
	if stats[0].Failed != 1 {
		t.Fatalf("permanent failure counted %d times, want 1: %+v", stats[0].Failed, stats[0])
	}
	if stats[1].Failed != 1 {
		t.Fatalf("retryable failure must fail once after exhausting attempts: %+v", stats[1])
	}
}

func TestServiceConcurrentHandleNeverBlocks(t *testing.T) {
	c := &stubChannel{name: "c"}
	s := New(c)
	// Unbuffered queue with no worker running: every Handle must take
	// the non-blocking drop path (a buffered slot would park one alert
	// inside the queue, outside every counter).
	s.workers[0].queue = make(chan alert.Alert)
	s.workers[0].minSev = rankAny

	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 50; j++ {
				s.Handle(sampleAlert())
			}
		}()
	}
	wg.Wait()
	total := s.Stats()[0]
	if total.Dropped != 400 {
		t.Fatalf("dropped = %d, want 400 with a parked unbuffered queue: %+v", total.Dropped, total)
	}
}

func TestServiceSummaryNamesChannelsWithoutSecrets(t *testing.T) {
	tg := NewTelegram("tg-lab", "123:SECRET", "-1", "")
	s := New(NewSlack("slack-lab", "https://hooks.slack.com/services/X"), tg)
	got := fmt.Sprint(s.Summary())
	if !strings.Contains(got, "slack-lab (custom)") || !strings.Contains(got, "tg-lab (custom)") {
		t.Fatalf("summary wrong: %s", got)
	}
	if strings.Contains(got, "SECRET") {
		t.Fatal("summary leaked a secret")
	}
}

func waitFor(t *testing.T, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("condition not reached within 2s")
}
