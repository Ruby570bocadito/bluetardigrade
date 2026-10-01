// Package notify pushes engine alerts to external chat and mail
// channels: Slack incoming webhooks, Telegram bots and SMTP email.
// Package C2 of the roadmap — "external notifications" — built on the
// same delivery discipline as internal/webhook: asynchronous, bounded,
// never blocking detection.
//
// One worker goroutine per configured channel owns a fixed-size queue.
// Handle fans a raised alert out to every channel without blocking;
// when a channel's queue is full the frame is counted as dropped for
// that channel and the pipeline keeps moving. A slow or dead chat
// integration is an operational problem, never a detection failure.
//
// Bounds (all load- or admission-enforced, same input standard as the
// other config surfaces):
//
//	MaxChannels 8     config bloat and resource bound
//	queueSize 256     per-channel burst absorption
//	maxAttempts 3     first try plus two retries (HTTP channels)
//	backoff 400ms     linear growth per attempt, same as the webhook
//	httpTimeout 5s    per-request hard timeout (Slack, Telegram)
//	smtpTimeout 15s   per-message hard timeout including TLS + AUTH
//	maxFileBytes 4MiB notify config file, same as every YAML input
//
// Per-channel observability: sent, failed, dropped and filtered
// counters are exposed through Stats and wired into /api/stats and
// /metrics by the engine (sf_notify_* families, labeled by channel).
// "filtered" counts alerts skipped by the channel's optional
// min_severity floor — a deliberate silence the operator configured,
// reported as data rather than hidden.
package notify

import (
	"context"
	"log"
	"sync"
	"sync/atomic"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/alert"
)

const (
	queueSize   = 256
	maxAttempts = 3
	backoff     = 400 * time.Millisecond
	httpTimeout = 5 * time.Second
	smtpTimeout = 15 * time.Second
)

// Channel is one delivery target. Deliver must be safe for the single
// worker goroutine that owns it; retryable reports whether a failed
// delivery could plausibly succeed on a later attempt (transport
// errors and remote backpressure yes, definitive rejections no).
type Channel interface {
	Name() string
	Deliver(ctx context.Context, a alert.Alert) error
	Retryable(err error) bool
}

// ChannelStats is the per-channel delivery snapshot served on
// /api/stats and mirrored into the sf_notify_* metric families.
type ChannelStats struct {
	Name     string `json:"name"`
	Type     string `json:"type"`
	Sent     uint64 `json:"sent"`
	Failed   uint64 `json:"failed"`
	Dropped  uint64 `json:"dropped"`
	Filtered uint64 `json:"filtered"`
}

// worker couples a channel with its queue, counters and severity
// floor. Everything a channel needs to be observed and bounded lives
// here, so channels themselves stay pure transport code.
type worker struct {
	ch      Channel
	typ     string
	minSev  int // severity rank floor; rankAny means no filtering
	queue   chan alert.Alert
	running sync.WaitGroup

	sent     atomic.Uint64
	failed   atomic.Uint64
	dropped  atomic.Uint64
	filtered atomic.Uint64
}

// Service fans alerts out to the configured channels. Create with
// Load (from a YAML config) or New (programmatic, tests); feed with
// Handle; run the workers with Run.
type Service struct {
	workers []*worker
	backoff time.Duration // overridable in tests
}

// New builds a Service delivering to the given channels without a
// severity floor. Used by tests and programmatic setups; file-based
// configurations go through Load.
func New(channels ...Channel) *Service {
	s := &Service{backoff: backoff}
	for _, ch := range channels {
		s.workers = append(s.workers, &worker{
			ch:     ch,
			typ:    "custom",
			minSev: rankAny,
			queue:  make(chan alert.Alert, queueSize),
		})
	}
	return s
}

// Handle enqueues one alert on every channel that passes its severity
// floor, without ever blocking. A full queue drops the frame for that
// channel only: one slow integration cannot starve the others, and
// none of them can stall the detection loop.
func (s *Service) Handle(a alert.Alert) {
	for _, w := range s.workers {
		if w.minSev > rankAny && severityRank(a.Severity) < w.minSev {
			w.filtered.Add(1)
			continue
		}
		select {
		case w.queue <- a:
		default:
			w.dropped.Add(1)
		}
	}
}

// Run starts one worker goroutine per channel and delivers queued
// alerts until ctx is cancelled, then drains every queue best-effort
// (single attempt per frame) under a bounded deadline so graceful
// shutdown loses as little as possible.
func (s *Service) Run(ctx context.Context) {
	for _, w := range s.workers {
		w.running.Add(1)
		go w.loop(ctx, s.backoff)
	}
}

// Wait blocks until every worker goroutine has finished.
func (s *Service) Wait() {
	for _, w := range s.workers {
		w.running.Wait()
	}
}

// Stats returns one snapshot per channel, sorted by name so both the
// JSON body and the Prometheus exposition are deterministic.
func (s *Service) Stats() []ChannelStats {
	out := make([]ChannelStats, 0, len(s.workers))
	for _, w := range s.workers {
		out = append(out, ChannelStats{
			Name:     w.ch.Name(),
			Type:     w.typ,
			Sent:     w.sent.Load(),
			Failed:   w.failed.Load(),
			Dropped:  w.dropped.Load(),
			Filtered: w.filtered.Load(),
		})
	}
	for i := 1; i < len(out); i++ {
		for j := i; j > 0 && out[j].Name < out[j-1].Name; j-- {
			out[j], out[j-1] = out[j-1], out[j]
		}
	}
	return out
}

// Summary names the configured channels for the engine's startup log
// line, in load order. Secrets never appear: names are operator or
// type labels only.
func (s *Service) Summary() []string {
	out := make([]string, 0, len(s.workers))
	for _, w := range s.workers {
		out = append(out, w.ch.Name()+" ("+w.typ+")")
	}
	return out
}

func (w *worker) loop(ctx context.Context, backoff time.Duration) {
	defer w.running.Done()
	for {
		select {
		case <-ctx.Done():
			w.drain()
			return
		case a := <-w.queue:
			w.deliver(ctx, a, backoff)
		}
	}
}

// deliver sends one alert with up to maxAttempts tries. Retries apply
// only to errors the channel classifies as retryable; a definitive
// rejection (bad URL, refused mailbox, 4xx) fails immediately because
// retrying it would only delay the rest of the queue.
func (w *worker) deliver(ctx context.Context, a alert.Alert, backoff time.Duration) {
	var lastErr error
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		err := w.ch.Deliver(ctx, a)
		if err == nil {
			w.sent.Add(1)
			return
		}
		lastErr = err
		if !w.ch.Retryable(err) || attempt == maxAttempts {
			break
		}
		select {
		case <-ctx.Done():
			w.failed.Add(1)
			return
		case <-time.After(backoff * time.Duration(attempt)):
		}
	}
	w.failed.Add(1)
	log.Printf("[NOTIFY %s] delivery failed: %v", w.ch.Name(), lastErr)
}

// drain empties the queue after cancellation with one attempt per
// frame under a global 2s deadline; anything left over is counted as
// dropped. Same shutdown contract as internal/webhook.
func (w *worker) drain() {
	deadline := time.Now().Add(2 * time.Second)
	for {
		select {
		case a := <-w.queue:
			if err := w.ch.Deliver(context.Background(), a); err != nil {
				w.failed.Add(1)
			} else {
				w.sent.Add(1)
			}
			if time.Now().After(deadline) {
				w.dropRemaining()
				return
			}
		default:
			return
		}
	}
}

func (w *worker) dropRemaining() {
	for {
		select {
		case <-w.queue:
			w.dropped.Add(1)
		default:
			return
		}
	}
}
