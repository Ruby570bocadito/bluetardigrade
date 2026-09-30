// Package siem pushes engine alerts to external SIEM platforms:
// Elasticsearch (bulk indexing) and Splunk (HTTP Event Collector).
// Both sinks share the delivery discipline of the generic webhook
// connector — asynchronous, bounded and never blocking the detection
// loop: alerts land on a fixed-size queue, a single worker delivers
// them with short retries, and every sent, failed and dropped frame
// is counted so operators can size the pipeline from /api/stats.
//
// Delivery semantics are at-least-once and documented per protocol:
//
//   - Elasticsearch: each alert is bulk-indexed with a deterministic
//     document id (the alert ID), so a retry after an ambiguous
//     transport failure overwrites the same document instead of
//     duplicating it.
//   - Splunk HEC: each alert is one event POST; a retry after an
//     ambiguous failure may duplicate the event (HEC has no
//     client-supplied event key). Downstream dedup should key on the
//     alert id carried inside every event.
//
// Credentials never live in code or config files: both sinks take
// their secret through the engine flags (which the operator can leave
// empty) with the standard environment fallback, mirroring the ingest
// and webhook token resolution order.
package siem

import (
	"context"
	"sync"
	"sync/atomic"
	"time"

	"github.com/Ruby570bocadito/security-framework/internal/alert"
)

const (
	// Queue depth: enough to absorb a burst of detections against a
	// briefly unreachable receiver without starving the engine.
	queueSize = 512
	// Delivery budget per request: first attempt plus two retries.
	maxAttempts = 3
	// User-Agent identifying the producer, useful on the receiver side.
	userAgent = "security-framework-siem/0.1"
	// Grace period for the best-effort drain after cancellation.
	drainBudget = 2 * time.Second
)

// counters is the shared lifetime stats triple every sink reports
// through Stats and the engine wires into /api/stats and /metrics.
type counters struct {
	sent    atomic.Uint64 // alerts accepted by the receiver
	failed  atomic.Uint64 // alerts exhausted retries or rejected permanently
	dropped atomic.Uint64 // alerts discarded because the queue was full
}

func (c *counters) stats() (sent, failed, dropped uint64) {
	return c.sent.Load(), c.failed.Load(), c.dropped.Load()
}

// spool is the bounded alert queue shared by both sinks. Handle never
// blocks: a detection pipeline must never stall because a downstream
// receiver is slow — a full queue counts as dropped, exactly like the
// webhook connector.
type spool struct {
	queue chan alert.Alert
	counters
	worker sync.WaitGroup
}

func newSpool(queue int) spool {
	return spool{queue: make(chan alert.Alert, queue)}
}

// handle enqueues one alert without blocking.
func (s *spool) handle(a alert.Alert) {
	select {
	case s.queue <- a:
	default:
		s.dropped.Add(1)
	}
}

// drain empties the queue after cancellation with a single best-effort
// attempt per frame, under a global deadline so shutdown stays bounded;
// anything still queued once the deadline passes is counted as dropped.
// deliver receives each frame in arrival order.
func (s *spool) drain(deliver func(alert.Alert)) {
	deadline := time.Now().Add(drainBudget)
	for {
		select {
		case a := <-s.queue:
			deliver(a)
			if time.Now().After(deadline) {
				s.dropRemaining()
				return
			}
		default:
			return
		}
	}
}

func (s *spool) dropRemaining() {
	for {
		select {
		case <-s.queue:
			s.dropped.Add(1)
		default:
			return
		}
	}
}

// sinkStats reports the lifetime counters of one sink. It is the shape
// the engine API already consumes for the webhook (sent/failed/dropped),
// so /api/stats and /metrics can pin parity the same way.
type sinkStats interface {
	Stats() (sent, failed, dropped uint64)
}

// retryAfter returns how long the caller should wait before the next
// attempt, using the same linear backoff as the webhook connector.
func retryAfter(base time.Duration, attempt int) time.Duration {
	return base * time.Duration(attempt)
}

// waitFor sleeps for d unless ctx is cancelled first; it reports
// whether the sleep completed.
func waitFor(ctx context.Context, d time.Duration) bool {
	select {
	case <-ctx.Done():
		return false
	case <-time.After(d):
		return true
	}
}
