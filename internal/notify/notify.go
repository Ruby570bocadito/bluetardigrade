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

	// drainDefault is the whole shutdown budget per worker: every
	// queued frame gets one best-effort attempt inside it, and the
	// budget is ENFORCED per attempt (the delivery context expires
	// with the remaining time), not just checked between frames.
	drainDefault = 2 * time.Second
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

	// drainBudget bounds the post-cancel drain of each worker. The
	// zero value means drainDefault; tests shrink it to keep the
	// deadline behavior fast and deterministic.
	drainBudget time.Duration

	// consoleURL is the configured console address (no trailing
	// slash), "" without one.
	consoleURL string
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
	budget := s.drainBudget
	if budget <= 0 {
		budget = drainDefault
	}
	for _, w := range s.workers {
		w.running.Add(1)
		go w.loop(ctx, s.backoff, budget)
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

func (w *worker) loop(ctx context.Context, backoff, drainBudget time.Duration) {
	defer w.running.Done()
	for {
		// Shutdown check BEFORE the select: once the context is
		// cancelled, every queued frame must get drain()'s
		// best-effort attempt (Background context, bounded), never
		// deliver() with a context that is already dead. Go's
		// select picks uniformly between ready cases, so without
		// this check a cancel landing on a busy queue sent half of
		// it into instant doomed attempts (counted failed) instead
		// of the drain the package contract promises. Same
		// shutdown contract as internal/webhook.
		if ctx.Err() != nil {
			w.drain(drainBudget)
			return
		}
		select {
		case <-ctx.Done():
			w.drain(drainBudget)
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
	// The cancel can land between the loop's check and this pop
	// (select arbitration): a frame consumed that way was never
	// really attempted, so it counts as dropped (shutdown owns it)
	// instead of failed — failed means the receiver said no, dropped
	// means we never tried. The drain that follows gives the rest of
	// the queue its single best-effort attempt.
	if ctx.Err() != nil {
		w.dropped.Add(1)
		return
	}
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
// frame inside the budget; anything left over is counted as dropped.
// Same shutdown contract as internal/webhook.
//
// The budget is enforced PER ATTEMPT, not just checked between frames:
// each delivery runs under a context that expires with the time the
// drain has left, so one slow frame cannot stretch the engine shutdown
// far past the promised bound (the email channel applies ctx.Deadline
// to its socket and fails fast; a channel that ignores the context —
// the webhook post — still caps itself with its own client timeout).
// With the previous between-frames check the first frame ran without
// any ceiling, and a wedged SMTP server turned the 2s drain into a
// ~17s shutdown (2s budget + one full 15s smtpTimeout).
func (w *worker) drain(budget time.Duration) {
	deadline := time.Now().Add(budget)
	for {
		select {
		case a := <-w.queue:
			remaining := time.Until(deadline)
			if remaining <= 0 {
				// Budget spent: this frame was popped but never
				// attempted (failed means the receiver said no,
				// dropped means we never tried), and neither was
				// anything still queued.
				w.dropped.Add(1)
				w.dropRemaining()
				return
			}
			ctx, cancel := context.WithTimeout(context.Background(), remaining)
			err := w.ch.Deliver(ctx, a)
			cancel()
			if err != nil {
				w.failed.Add(1)
			} else {
				w.sent.Add(1)
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

// TestResult is the outcome of one channel's test message.
type TestResult struct {
	Name  string `json:"name"`
	Type  string `json:"type"`
	OK    bool   `json:"ok"`
	Error string `json:"error,omitempty"`
}

// testTimeout bounds the whole "Enviar prueba" round: the slowest
// channel (SMTP with TLS and AUTH) fits, a wedged one answers as failed.
const testTimeout = 20 * time.Second

// TestAlert is the message the test sends: plainly a test, no alert id
// (so no console link pointing at nothing), severity info.
func TestAlert(now time.Time) alert.Alert {
	return alert.Alert{
		Timestamp: now.UTC().Format(time.RFC3339),
		RuleID:    "notify-test",
		RuleName:  "Prueba de notificación",
		Severity:  "info",
		Host:      "bluetardigrade",
		Summary:   "Mensaje de prueba enviado desde la consola (Ajustes -> Avisos externos). No es una alerta.",
	}
}

// Test sends the test message to every channel (name "") or to the one
// named, synchronously and in parallel, bypassing the queues, the
// severity floor and the counters: a test is a question to the
// receiver, not a delivery. The errors are the channels' own, which
// redact endpoints and credentials. An unknown name returns nothing.
func (s *Service) Test(ctx context.Context, name string) []TestResult {
	ctx, cancel := context.WithTimeout(ctx, testTimeout)
	defer cancel()
	msg := TestAlert(time.Now())
	var picked []*worker
	for _, w := range s.workers {
		if name == "" || w.ch.Name() == name {
			picked = append(picked, w)
		}
	}
	out := make([]TestResult, len(picked))
	var wg sync.WaitGroup
	for i, w := range picked {
		wg.Add(1)
		go func(i int, w *worker) {
			defer wg.Done()
			r := TestResult{Name: w.ch.Name(), Type: w.typ, OK: true}
			if err := w.ch.Deliver(ctx, msg); err != nil {
				r.OK, r.Error = false, err.Error()
			}
			out[i] = r
		}(i, w)
	}
	wg.Wait()
	return out
}

// Live is the engine's handle on the notification channels: it owns
// the running Service and swaps it for a new one when the settings
// change (Ajustes -> Avisos externos), without restarting the engine.
// The outgoing Service stops taking alerts at once and drains what it
// had queued under its usual shutdown budget, in the background.
type Live struct {
	parent context.Context

	mu      sync.RWMutex
	svc     *Service
	cancel  context.CancelFunc
	retired sync.WaitGroup
}

// NewLive starts svc under parent; parent's cancellation is the
// engine shutdown for every Service this Live ever runs.
func NewLive(parent context.Context, svc *Service) *Live {
	l := &Live{parent: parent}
	l.start(svc)
	return l
}

func (l *Live) start(svc *Service) {
	ctx, cancel := context.WithCancel(l.parent)
	svc.Run(ctx)
	l.svc, l.cancel = svc, cancel
}

// Swap replaces the running Service.
func (l *Live) Swap(svc *Service) {
	l.mu.Lock()
	old, oldCancel := l.svc, l.cancel
	l.start(svc)
	l.mu.Unlock()
	oldCancel()
	l.retired.Add(1)
	go func() {
		defer l.retired.Done()
		old.Wait()
	}()
}

func (l *Live) current() *Service {
	l.mu.RLock()
	defer l.mu.RUnlock()
	return l.svc
}

// Handle hands the alert to the running Service.
func (l *Live) Handle(a alert.Alert) { l.current().Handle(a) }

// Stats is the running Service's per-channel snapshot.
func (l *Live) Stats() []ChannelStats { return l.current().Stats() }

// Summary names the running channels.
func (l *Live) Summary() []string { return l.current().Summary() }

// Test runs Service.Test on the running channels.
func (l *Live) Test(ctx context.Context, name string) []TestResult {
	return l.current().Test(ctx, name)
}

// Wait blocks until the running Service and every retired one have
// drained (call after cancelling the parent context).
func (l *Live) Wait() {
	l.current().Wait()
	l.retired.Wait()
}
