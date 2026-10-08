// Splunk sink: alerts are POSTed one per request to the HTTP Event
// Collector (HEC) — the token-authenticated ingestion endpoint every
// Splunk deployment ships for machine data. The alert travels as the
// event body with the alert fields also exposed as indexed fields
// (rule_id, severity, host, user), so Splunk admins can search and
// alert on them without parsing the event payload.
//
// Success requires BOTH an HTTP 2xx and a zero "code" in the JSON
// answer: HEC reports per-event format errors (code 10, 5, 4...) as
// 200 responses. Only transport errors, 429 and 5xx are retried; a
// 200-with-error-code is a permanent rejection (retrying a rejected
// event only delays the queue).

package siem

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	neturl "net/url"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/alert"
	"github.com/Ruby570bocadito/bluetardigrade/internal/redact"
)

const (
	// Hard timeout for each individual event POST.
	splunkPostTimeout = 3 * time.Second
	// Wire constants of the HEC event contract.
	splunkSourcetype = "sf:alert"
	splunkSource     = "security-framework"
	// HEC endpoint path appended to the collector base URL.
	splunkEventPath = "/services/collector/event"
)

// Splunk delivers alerts to a Splunk HTTP Event Collector.
type Splunk struct {
	spool
	url         string // collector base URL, e.g. https://splunk.example:8088
	token       string
	hc          *http.Client
	backoff     time.Duration
	nowFallback func() time.Time
}

// NewSplunk creates a sink for the HEC collector at url (base URL;
// the event endpoint path is appended by the sink). The returned
// error carries the scheme contract (see requireHTTPScheme).
func NewSplunk(url string) (*Splunk, error) {
	return newSplunk(url, queueSize)
}

func newSplunk(url string, queue int) (*Splunk, error) {
	if err := requireHTTPScheme("splunk hec", url); err != nil {
		return nil, err
	}
	// Sin redirects transparentes (sesión 100agentes-2, agente 5): un
	// 302 hacia http:// reenviaba el NDJSON con evidencia en claro.
	// Aviso honesto cuando el sink lleva token por http en claro.
	if u, perr := neturl.Parse(url); perr == nil && u.Scheme == "http" {
		log.Printf("[SIEM][WARN] splunk hec por http sin cifrar: el token HEC viaja en claro; usa https o loopback")
	}
	return &Splunk{
		spool: newSpool(queue),
		url:   trimTrailingSlash(url),
		hc: &http.Client{
			Timeout: splunkPostTimeout,
			CheckRedirect: func(*http.Request, []*http.Request) error {
				return http.ErrUseLastResponse
			},
		},
		backoff:     400 * time.Millisecond,
		nowFallback: time.Now,
	}, nil
}

// SetToken configures the HEC ingestion token ("Authorization: Splunk
// <token>"). Call before Run. An empty token disables the header (only
// plausible against a deliberately open lab collector).
func (s *Splunk) SetToken(token string) { s.token = token }

// TokenConfigured reports whether deliveries carry the HEC token.
func (s *Splunk) TokenConfigured() bool { return s.token != "" }

// Stats returns the lifetime counters: events accepted, events that
// exhausted retries or were rejected, and events dropped for a full
// queue.
func (s *Splunk) Stats() (sent, failed, dropped uint64) { return s.stats() }

// Handle enqueues one alert without blocking (see spool.handle).
func (s *Splunk) Handle(a alert.Alert) { s.handle(a) }

// Run delivers queued alerts until ctx is cancelled, then drains the
// pending queue best-effort (single attempt per alert) so a graceful
// shutdown loses as little as possible.
func (s *Splunk) Run(ctx context.Context) {
	s.worker.Add(1)
	defer s.worker.Done()
	s.run(ctx)
}

// Start lanza Run en goroutine con el WaitGroup YA registrado (sesión
// 100agentes-2, agentes 13+14) — ver webhook.Client.Start.
func (s *Splunk) Start(ctx context.Context) {
	s.worker.Add(1)
	go func() {
		defer s.worker.Done()
		s.run(ctx)
	}()
}

func (s *Splunk) run(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			s.drain(func(a alert.Alert) { s.deliver(ctx, a) })
			return
		case a := <-s.queue:
			s.deliver(ctx, a)
		}
	}
}

// Wait blocks until the worker goroutine (started by Run) has finished.
func (s *Splunk) Wait() { s.worker.Wait() }

// deliver POSTs one event with up to maxAttempts tries. Retries apply
// to transport errors, 429 and 5xx; other HTTP answers are permanent:
// retrying a misconfigured or rejected event only delays the queue.
func (s *Splunk) deliver(ctx context.Context, a alert.Alert) {
	payload, err := s.eventBody(a)
	if err != nil {
		s.failed.Add(1)
		return
	}
	var lastErr error
	// attempts counts what ACTUALLY ran: a permanent 4xx (or a build
	// failure) stops after one post, and a log claiming the full retry
	// budget is a lie an operator debugging the collector pays for
	// (same honest-wording contract the webhook connector documents).
	attempts := 0
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		attempts = attempt
		retryable, perr := s.post(payload)
		if perr == nil {
			s.sent.Add(1)
			return
		}
		lastErr = perr
		if !retryable || attempt == maxAttempts {
			break
		}
		if !waitFor(ctx, retryAfter(s.backoff, attempt)) {
			s.failed.Add(1)
			return
		}
	}
	s.failed.Add(1)
	log.Printf("[SPLUNK] delivery to %s failed after %d attempt(s): %v", redact.EndpointLabel(s.url), attempts, redact.URLErr(lastErr, "sink endpoint"))
}

// hecEvent is the wire shape of one HEC event. The alert travels as
// the "event" object (the full payload the console and webhook see)
// while the HEC-level fields (time, host, source, sourcetype, fields)
// let Splunk index and route the event natively.
type hecEvent struct {
	Time       float64         `json:"time"`
	Event      json.RawMessage `json:"event"`
	Source     string          `json:"source"`
	SourceType string          `json:"sourcetype"`
	Host       string          `json:"host,omitempty"`
	Fields     map[string]any  `json:"fields,omitempty"`
}

// eventBody renders one HEC event. "time" is epoch seconds with
// millisecond precision, taken from the alert timestamp; an
// unparsable timestamp falls back to now (the event must not be lost
// over metadata), mirroring the indexer date fallback.
func (s *Splunk) eventBody(a alert.Alert) ([]byte, error) {
	when := s.nowFallback()
	if t, perr := time.Parse(time.RFC3339Nano, a.Timestamp); perr == nil {
		when = t
	}
	doc, err := json.Marshal(a)
	if err != nil {
		return nil, fmt.Errorf("encoding alert: %w", err)
	}
	fields := map[string]any{
		"rule_id":  a.RuleID,
		"severity": a.Severity,
		"host":     a.Host,
	}
	if a.User != "" {
		fields["user"] = a.User
	}
	body, err := json.Marshal(hecEvent{
		Time:       math.Round(float64(when.UnixMilli())) / 1000,
		Event:      doc,
		Source:     splunkSource,
		SourceType: splunkSourcetype,
		Host:       a.Host,
		Fields:     fields,
	})
	if err != nil {
		return nil, fmt.Errorf("encoding HEC event: %w", err)
	}
	return body, nil
}

// post performs one attempt. retryable reports whether a retry could
// plausibly succeed (network/5xx/429 vs. definitive 4xx or a 200 with
// a non-zero HEC code).
func (s *Splunk) post(payload []byte) (retryable bool, err error) {
	req, err := http.NewRequest(http.MethodPost, s.url+splunkEventPath, bytes.NewReader(payload))
	if err != nil {
		return false, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", userAgent)
	if s.token != "" {
		req.Header.Set("Authorization", "Splunk "+s.token)
	}

	resp, err := s.hc.Do(req)
	if err != nil {
		return true, err // transport error: the collector may recover
	}
	defer resp.Body.Close()
	switch {
	case resp.StatusCode == http.StatusTooManyRequests, resp.StatusCode >= 500:
		return true, fmt.Errorf("collector answered %d", resp.StatusCode)
	case resp.StatusCode >= 200 && resp.StatusCode < 300:
		return false, s.parseHECResponse(resp)
	default:
		return false, fmt.Errorf("collector answered %d", resp.StatusCode)
	}
}

// hecResponse models the HEC acknowledgement body: {"text": "...",
// "code": 0} on success, a non-zero code on rejection (HTTP still 200).
type hecResponse struct {
	Text string `json:"text"`
	Code int    `json:"code"`
}

func (s *Splunk) parseHECResponse(resp *http.Response) error {
	var parsed hecResponse
	if derr := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&parsed); derr != nil {
		return fmt.Errorf("unreadable HEC answer: %w", derr)
	}
	if parsed.Code != 0 {
		return fmt.Errorf("HEC rejected the event: code %d (%s)", parsed.Code, parsed.Text)
	}
	return nil
}
