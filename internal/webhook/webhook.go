// Package webhook pushes engine alerts to an external HTTP endpoint:
// a SIEM, a SOAR playbook, a chat-ops relay or any JSON-over-HTTP
// collector. Delivery is asynchronous and bounded: Raise never blocks
// on a slow receiver — alerts land on a fixed-size queue and a single
// worker POSTs them with short retries, counting every sent, failed
// and dropped frame so operators can size the pipeline from /api/stats.
//
// Optional outbound auth: when a token is configured (SetToken), every
// POST carries "Authorization: Bearer <token>" so a receiver can
// verify the caller — and so alerts cannot be injected into a shared
// collector by anyone who learns the endpoint URL.
package webhook

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	neturl "net/url"
	"sync"
	"sync/atomic"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/redact"

	"github.com/Ruby570bocadito/bluetardigrade/internal/alert"
)

const (
	// Queue depth: enough to absorb a burst of detections against a
	// briefly unreachable receiver without starving the engine.
	queueSize = 512
	// Delivery budget per alert: first attempt plus two retries.
	maxAttempts = 3
	// Hard timeout for each individual POST.
	postTimeout = 3 * time.Second
	// User-Agent identifying the producer, useful on the receiver side.
	userAgent = "bluetardigrade-webhook/0.1"
)

// Client queues alerts and delivers them to one HTTP endpoint.
type Client struct {
	url    string
	token  string // empty = no Authorization header
	hc     *http.Client
	queue  chan alert.Alert
	worker sync.WaitGroup

	// retry/backoff knobs (overridable in tests)
	backoff time.Duration

	sent    atomic.Uint64
	failed  atomic.Uint64
	dropped atomic.Uint64
}

// New creates a client for url with the default queue depth. The URL
// must be http(s): a typo like "file://" or a missing scheme would
// surface only as cryptic delivery failures (sesión 100agentes-2,
// agente 5 — parity with siem.requireHTTPScheme).
func New(url string) *Client {
	u, err := neturl.Parse(url)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") {
		log.Printf("[WEBHOOK] url %s no es http(s): las entregas fallaran hasta corregirlo", redact.EndpointLabel(url))
	}
	return newClient(url, queueSize)
}

func newClient(url string, queue int) *Client {
	return &Client{
		url: url,
		// No transparent redirects (sesión 100agentes-2, agente 5,
		// P2): Go followed up to 10 redirects and RE-POSTed the full
		// alert JSON (command lines, users, hashes) to whatever host
		// the receiver's 3xx named — including silent https→http
		// downgrades. internal/actions fixed the same hole in its
		// own client; this one was the last copy without it.
		hc: &http.Client{
			Timeout: postTimeout,
			CheckRedirect: func(*http.Request, []*http.Request) error {
				return http.ErrUseLastResponse
			},
		},
		queue:   make(chan alert.Alert, queue),
		backoff: 400 * time.Millisecond,
	}
}

// SetToken configures the Bearer token sent on every delivery. Call
// before Run. An empty token disables the Authorization header (the
// receiver is then expected to trust the network path, e.g. loopback).
func (c *Client) SetToken(token string) { c.token = token }

// TokenConfigured reports whether deliveries carry a Bearer token.
func (c *Client) TokenConfigured() bool { return c.token != "" }

// Handle enqueues one alert without blocking. When the queue is full
// the alert is counted as dropped: a detection pipeline must never
// stall because a downstream receiver is slow.
func (c *Client) Handle(a alert.Alert) {
	select {
	case c.queue <- a:
	default:
		c.dropped.Add(1)
	}
}

// Run delivers queued alerts until ctx is cancelled, then drains the
// pending queue best-effort (single attempt per alert) so a graceful
// shutdown loses as little as possible.
func (c *Client) Run(ctx context.Context) {
	c.worker.Add(1)
	defer c.worker.Done()
	for {
		select {
		case <-ctx.Done():
			c.drain()
			return
		case a := <-c.queue:
			c.deliver(ctx, a)
		}
	}
}

// Start launches Run in its own goroutine AFTER registering it with the
// WaitGroup (sesión 100agentes-2, agentes 13+14): with Add(1) inside
// the goroutine, a shutdown racing the scheduler made Wait() return
// immediately and the drain never ran. notify.go already used this
// pattern; the three HTTP sinks now share it.
func (c *Client) Start(ctx context.Context) {
	c.worker.Add(1)
	go func() {
		defer c.worker.Done()
		c.run(ctx)
	}()
}

func (c *Client) run(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			c.drain()
			return
		case a := <-c.queue:
			c.deliver(ctx, a)
		}
	}
}

// Wait blocks until the worker goroutine (started by Run) has finished.
func (c *Client) Wait() { c.worker.Wait() }

// Stats returns the lifetime counters: delivered, failed after retries
// and dropped for a full queue.
func (c *Client) Stats() (sent, failed, dropped uint64) {
	return c.sent.Load(), c.failed.Load(), c.dropped.Load()
}

// deliver POSTs one alert with up to maxAttempts tries. Retries apply
// to transport errors, 429 and 5xx; other 4xx answers are permanent:
// retrying a misconfigured endpoint only delays the queue.
func (c *Client) deliver(ctx context.Context, a alert.Alert) {
	payload, err := json.Marshal(a)
	if err != nil {
		c.failed.Add(1)
		return
	}
	var lastErr error
	// attempts counts what ACTUALLY ran: a permanent 4xx (or a build
	// failure) stops after one post, and a log claiming the full retry
	// budget is a lie an operator debugging the receiver pays for.
	attempts := 0
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		attempts = attempt
		retryable, perr := c.post(payload)
		if perr == nil {
			c.sent.Add(1)
			return
		}
		lastErr = perr
		if !retryable || attempt == maxAttempts {
			break
		}
		select {
		case <-ctx.Done():
			c.failed.Add(1)
			// Shutdown during the retry backoff: the counter moved, so
			// the log trail must say why — same trail as the terminal
			// failure log below, with honest wording.
			log.Printf("[WEBHOOK] delivery to %s cancelled by shutdown after %d attempt(s): %v", redact.EndpointLabel(c.url), attempts, redact.URLErr(lastErr, "receiver endpoint"))
			return
		case <-time.After(c.backoff * time.Duration(attempt)):
		}
	}
	c.failed.Add(1)
	// redaction helpers live in internal/redact since #35 promoted
	// them there (fourth-copy rule); the log line is byte-identical
	// to the days of the local copies.
	log.Printf("[WEBHOOK] delivery to %s failed after %d attempt(s): %v", redact.EndpointLabel(c.url), attempts, redact.URLErr(lastErr, "receiver endpoint"))
}

// post performs one attempt. retryable reports whether a retry could
// plausibly succeed (network/5xx/429 vs. definitive 4xx).
func (c *Client) post(payload []byte) (retryable bool, err error) {
	req, err := http.NewRequest(http.MethodPost, c.url, bytes.NewReader(payload))
	if err != nil {
		return false, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", userAgent)
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
		// Message signature (sesión 100agentes-2, agente 4, P2):
		// a static Bearer cannot prove payload integrity or
		// freshness — a SOAR triggering active response from these
		// alerts deserves a verifiable chain. The receiver recomputes
		// HMAC-SHA256(token, "<ts>.<body>") and compares with
		// constant time; the timestamp bounds replay.
		ts := time.Now().Unix()
		mac := hmac.New(sha256.New, []byte(c.token))
		fmt.Fprintf(mac, "%d.", ts)
		mac.Write(payload)
		req.Header.Set("X-SF-Timestamp", fmt.Sprint(ts))
		req.Header.Set("X-SF-Signature", "sha256="+hex.EncodeToString(mac.Sum(nil)))
	}

	resp, err := c.hc.Do(req)
	if err != nil {
		return true, err // transport error: the receiver may recover
	}
	defer resp.Body.Close()
	switch {
	case resp.StatusCode >= 200 && resp.StatusCode < 300:
		return false, nil
	case resp.StatusCode == http.StatusTooManyRequests:
		return true, errStatus(resp.StatusCode)
	case resp.StatusCode >= 500:
		return true, errStatus(resp.StatusCode)
	default:
		return false, errStatus(resp.StatusCode)
	}
}

func errStatus(code int) error { return fmt.Errorf("receiver answered %d", code) }

// drain empties the queue after cancellation with a single attempt per
// alert, under a global deadline so shutdown stays bounded; anything
// still queued once the deadline passes is counted as dropped.
func (c *Client) drain() {
	deadline := time.Now().Add(2 * time.Second)
	for {
		select {
		case a := <-c.queue:
			payload, err := json.Marshal(a)
			if err != nil {
				c.failed.Add(1)
				continue
			}
			if _, perr := c.post(payload); perr != nil {
				c.failed.Add(1)
			} else {
				c.sent.Add(1)
			}
			if time.Now().After(deadline) {
				c.dropRemaining()
				return
			}
		default:
			return
		}
	}
}

func (c *Client) dropRemaining() {
	for {
		select {
		case <-c.queue:
			c.dropped.Add(1)
		default:
			return
		}
	}
}
