package notify

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
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

// shutdownProbe makes the shutdown contract observable: a delivery
// "attempt" with an already-cancelled context is a doomed one (the
// transport fails immediately), so the drain's Background attempt is
// the only honest try a queued frame can get at shutdown.
type shutdownProbe struct {
	name        string
	mu          sync.Mutex
	attempts    int
	deadCtxSeen int
}

func (p *shutdownProbe) Name() string { return p.name }

func (p *shutdownProbe) Deliver(ctx context.Context, a alert.Alert) error {
	p.mu.Lock()
	p.attempts++
	if ctx.Err() != nil {
		p.deadCtxSeen++
	}
	p.mu.Unlock()
	return nil
}

func (p *shutdownProbe) Retryable(err error) bool { return isRetryable(err) }

// A cancel landing on a busy queue must end in the documented drain:
// every queued frame gets exactly one best-effort attempt under a live
// (Background) context, and none is wasted on a doomed attempt with the
// cancelled one. Before the loop checked the context BEFORE the select,
// Go's select arbitration sent about half of a queued backlog into
// instant failed attempts at shutdown instead of the drain.
func TestServiceShutdownDrainsQueueBestEffort(t *testing.T) {
	probe := &shutdownProbe{name: "probe"}
	s := New(probe)
	for i := 0; i < queueSize; i++ { // fill the queue completely
		s.Handle(sampleAlert())
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel() // shutdown BEFORE the worker ever runs: worst case for the old race
	s.Run(ctx)
	s.Wait()

	if probe.deadCtxSeen != 0 {
		t.Fatalf("%d delivery attempt(s) ran with an already-cancelled context; the drain must attempt frames with a live one", probe.deadCtxSeen)
	}
	if got := probe.attempts; got != queueSize {
		t.Fatalf("drain attempted %d of %d queued frames", got, queueSize)
	}
	stats := s.Stats()[0]
	if stats.Sent != queueSize || stats.Failed != 0 || stats.Dropped != 0 {
		t.Fatalf("stats = %+v, want sent=%d failed=0 dropped=0", stats, queueSize)
	}
}

// cancelledAfterFirstCheck looks alive to the loop's check before the
// select and cancelled from then on, while Done never fires: the select
// can only pop a queued frame, which is what Go's select arbitration
// does when a real cancel lands in the middle of the pop.
type cancelledAfterFirstCheck struct {
	context.Context
	checks atomic.Int32
}

func (c *cancelledAfterFirstCheck) Done() <-chan struct{} { return nil }

func (c *cancelledAfterFirstCheck) Err() error {
	if c.checks.Add(1) == 1 {
		return nil
	}
	return context.Canceled
}

// A frame popped in the same instant the cancel lands was queued before
// the shutdown, so it gets the drain's best-effort attempt like the
// frames behind it. Regression for the intermittent loss behind
// TestLiveSwapsWithoutLosingTheQueue (45 failures in 500 runs on
// Windows): deliver counted that frame as dropped without trying it.
func TestServiceShutdownDrainsTheFramePoppedAtTheCancel(t *testing.T) {
	probe := &shutdownProbe{name: "probe"}
	s := New(probe)
	s.Handle(sampleAlert())
	s.Handle(sampleAlert())
	s.Run(&cancelledAfterFirstCheck{Context: context.Background()})
	s.Wait()

	if probe.attempts != 2 || probe.deadCtxSeen != 0 {
		t.Fatalf("attempts = %d (%d with a dead context), want both frames tried with a live one", probe.attempts, probe.deadCtxSeen)
	}
	if stats := s.Stats()[0]; stats.Sent != 2 || stats.Failed != 0 || stats.Dropped != 0 {
		t.Fatalf("stats = %+v, want sent=2 failed=0 dropped=0", stats)
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

// budgetProbe simulates a channel whose transport honors a context
// deadline the way the email channel does (ctx.Deadline becomes the
// socket deadline): with one, the attempt fails fast when the budget
// expires; without one, it blocks for its full internal timeout — the
// old drain handed out context.Background(), so its between-frames
// budget check could not stop the first frame from hanging.
type budgetProbe struct {
	name     string
	internal time.Duration // the channel's own (long) timeout without a ctx deadline
}

func (p *budgetProbe) Name() string             { return p.name }
func (p *budgetProbe) Retryable(err error) bool { return false }

func (p *budgetProbe) Deliver(ctx context.Context, _ alert.Alert) error {
	if _, ok := ctx.Deadline(); ok {
		<-ctx.Done() // the budget expires: the socket deadline fires
		return ctx.Err()
	}
	time.Sleep(p.internal)
	return nil
}

// TestServiceShutdownDrainBudgetIsEnforcedPerFrame pins the shutdown
// latency contract: the drain budget bounds EACH delivery attempt, not
// just the gaps between them. Regression for the soft deadline, where
// the first queued frame ran without any ceiling and one wedged SMTP
// server stretched the engine shutdown to ~17s (2s budget + one full
// 15s smtpTimeout).
func TestServiceShutdownDrainBudgetIsEnforcedPerFrame(t *testing.T) {
	p := &budgetProbe{name: "slow-smtp", internal: 10 * time.Second}
	s := New(p)
	s.drainBudget = 300 * time.Millisecond
	for i := 0; i < 5; i++ {
		s.Handle(sampleAlert())
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel() // shutdown before the worker runs: the queue drains
	start := time.Now()
	s.Run(ctx)
	s.Wait()
	elapsed := time.Since(start)

	stats := s.Stats()[0]
	// Old behavior: the first frame ran without a deadline, slept the
	// full 10s and counted sent; the drain took ~10s. New behavior: the
	// first attempt expires with the budget (failed), the rest are
	// dropped without attempt, and shutdown stays near the budget.
	if elapsed > 5*time.Second {
		t.Fatalf("drain took %v; the per-frame budget must bound shutdown latency", elapsed)
	}
	if stats.Sent != 0 || stats.Failed != 1 || stats.Dropped != 4 {
		t.Fatalf("stats = %+v, want sent=0 failed=1 dropped=4 (first frame attempted and expired, rest never tried)", stats)
	}
}
