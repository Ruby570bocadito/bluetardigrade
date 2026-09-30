package siem

import (
	"context"
	"encoding/json"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Ruby570bocadito/security-framework/internal/alert"
)

// sampleAlert is the canonical fixture: a fixed ID and timestamp so
// tests can assert exact wire bytes (index date, HEC epoch, doc id).
func sampleAlert() alert.Alert {
	return alert.Alert{
		ID:        "0a1b2c3d4e5f6071",
		Timestamp: "2026-09-30T22:15:09Z",
		RuleID:    "r-lsass",
		RuleName:  "LSASS handle dump",
		Severity:  "critical",
		Host:      "LAB-WKS-01",
		User:      "CORP\\alice",
		EventID:   "ev-42",
		EventType: "process.create",
		Summary:   "rare module loaded into lsass",
		MatchedOn: []string{"process.name"},
	}
}

// bulkAnswer builds a syntactically valid _bulk response body with n
// items answering status.
func bulkAnswer(statuses ...int) string {
	var b strings.Builder
	b.WriteString(`{"took":1,"errors":`)
	anyErr := false
	for _, s := range statuses {
		if s < 200 || s > 299 {
			anyErr = true
		}
	}
	b.WriteString(map[bool]string{true: "true", false: "false"}[anyErr])
	b.WriteString(`,"items":[`)
	for i, s := range statuses {
		if i > 0 {
			b.WriteByte(',')
		}
		b.WriteString(`{"index":{"_index":"idx","status":`)
		b.WriteString(itoa(s))
		if s >= 400 {
			b.WriteString(`,"error":{"type":"illegal_argument_exception","reason":"rejected by fixture"}`)
		}
		b.WriteString(`}}`)
	}
	b.WriteString(`]}`)
	return b.String()
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var d []byte
	for n > 0 {
		d = append([]byte{byte('0' + n%10)}, d...)
		n /= 10
	}
	if neg {
		return "-" + string(d)
	}
	return string(d)
}

// capture is a thread-safe request recorder for test servers.
type capture struct {
	mu       sync.Mutex
	bodies   []string
	headers  []http.Header
	paths    []string
	response func() (int, string)
}

func (c *capture) record(r *http.Request, body string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.bodies = append(c.bodies, body)
	c.headers = append(c.headers, r.Header.Clone())
	c.paths = append(c.paths, r.URL.Path)
}

func (c *capture) count() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return len(c.bodies)
}

func (c *capture) last() (body string, header http.Header, path string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.bodies[len(c.bodies)-1], c.headers[len(c.headers)-1], c.paths[len(c.paths)-1]
}

// handler wires a capture into an httptest server with scripted replies.
func (c *capture) handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		buf := make([]byte, r.ContentLength)
		_, _ = r.Body.Read(buf)
		c.record(r, string(buf))
		code, body := c.response()
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(code)
		_, _ = w.Write([]byte(body))
	})
}

func newServer(t *testing.T, c *capture) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(c.handler())
	t.Cleanup(srv.Close)
	return srv
}

func waitForCounter(t *testing.T, want uint64, read func() uint64) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if read() == want {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("counter never reached %d (currently %d)", want, read())
}

// ------------------------------------------------------------- Elastic

func TestElasticBulkExactBytes(t *testing.T) {
	c := &capture{response: func() (int, string) { return http.StatusOK, bulkAnswer(201) }}
	srv := newServer(t, c)

	e := NewElastic(srv.URL, "sf-alerts")
	e.SetAPIKey("c2Yta2V5")
	e.backoff = time.Millisecond
	go e.Run(context.Background())

	e.Handle(sampleAlert())
	waitForCounter(t, 1, func() uint64 { s, _, _ := e.Stats(); return s })

	body, header, path := c.last()
	if path != "/_bulk" {
		t.Fatalf("POST path = %q, want /_bulk", path)
	}
	if ct := header.Get("Content-Type"); ct != "application/x-ndjson" {
		t.Fatalf("Content-Type = %q, want application/x-ndjson", ct)
	}
	if auth := header.Get("Authorization"); auth != "ApiKey c2Yta2V5" {
		t.Fatalf("Authorization = %q, want ApiKey credential", auth)
	}

	lines := strings.Split(strings.TrimSuffix(body, "\n"), "\n")
	if len(lines) != 2 {
		t.Fatalf("bulk body has %d lines, want meta+doc", len(lines))
	}
	var meta struct {
		Index struct {
			Index string `json:"_index"`
			ID    string `json:"_id"`
		} `json:"index"`
	}
	if err := json.Unmarshal([]byte(lines[0]), &meta); err != nil {
		t.Fatalf("meta line unparsable: %v", err)
	}
	if meta.Index.ID != "0a1b2c3d4e5f6071" {
		t.Fatalf("doc _id = %q, want the alert ID (idempotent retries)", meta.Index.ID)
	}
	if want := "sf-alerts-2026.09.30"; meta.Index.Index != want {
		t.Fatalf("doc _index = %q, want %q (daily index from the alert timestamp)", meta.Index.Index, want)
	}
	var doc alert.Alert
	if err := json.Unmarshal([]byte(lines[1]), &doc); err != nil {
		t.Fatalf("doc line unparsable: %v", err)
	}
	if doc.ID != "0a1b2c3d4e5f6071" || doc.Host != "LAB-WKS-01" {
		t.Fatalf("doc line = %+v, want the alert payload", doc)
	}
}

func TestElasticNoAuthHeaderWithoutKey(t *testing.T) {
	c := &capture{response: func() (int, string) { return http.StatusOK, bulkAnswer(201) }}
	srv := newServer(t, c)

	e := NewElastic(srv.URL, "")
	e.backoff = time.Millisecond
	go e.Run(context.Background())

	e.Handle(sampleAlert())
	waitForCounter(t, 1, func() uint64 { s, _, _ := e.Stats(); return s })

	_, header, _ := c.last()
	if auth := header.Get("Authorization"); auth != "" {
		t.Fatalf("Authorization = %q, want no header when no API key is set", auth)
	}
}

func TestElasticPartialItemFailure(t *testing.T) {
	// One alert accepted (201), one rejected (400): the accepted one
	// counts as sent, the rejected one as failed, and NOTHING is
	// retried — the cluster already answered for both.
	c := &capture{response: func() (int, string) { return http.StatusOK, bulkAnswer(201, 400) }}
	srv := newServer(t, c)

	e := NewElastic(srv.URL, "sf-alerts")
	e.backoff = time.Millisecond
	e.maxBatch = 2
	go e.Run(context.Background())

	e.Handle(sampleAlert())
	second := sampleAlert()
	second.ID = "1111111111111112"
	e.Handle(second)

	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		s, f, _ := e.Stats()
		if s == 1 && f == 1 {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	s, f, _ := e.Stats()
	if s != 1 || f != 1 {
		t.Fatalf("Stats = sent %d failed %d, want 1/1 (item-level, not batch-level)", s, f)
	}
	if n := c.count(); n != 1 {
		t.Fatalf("bulk POSTs = %d, want exactly 1 (a 400 item is permanent, never retried)", n)
	}
}

func TestElasticRetryOn429ThenSuccess(t *testing.T) {
	// attempts is incremented INSIDE the scripted answer (record runs
	// before response, so c.count() would already include the request
	// being answered — an off-by-one the first run caught).
	var attempts atomic.Int64
	c := &capture{}
	c.mu.Lock()
	c.response = func() (int, string) {
		if attempts.Add(1) == 1 {
			return http.StatusTooManyRequests, `{}`
		}
		return http.StatusOK, bulkAnswer(201)
	}
	c.mu.Unlock()
	srv := newServer(t, c)

	e := NewElastic(srv.URL, "sf-alerts")
	e.backoff = time.Millisecond
	go e.Run(context.Background())

	e.Handle(sampleAlert())
	waitForCounter(t, 1, func() uint64 { s, _, _ := e.Stats(); return s })
	if n := attempts.Load(); n != 2 {
		t.Fatalf("bulk POSTs = %d, want 2 (429 then success)", n)
	}
	if _, f, _ := e.Stats(); f != 0 {
		t.Fatalf("failed = %d, want 0", f)
	}
}

func TestElasticBatchCap(t *testing.T) {
	c := &capture{response: func() (int, string) { return http.StatusOK, bulkAnswer(201, 201, 201, 201) }}
	srv := newServer(t, c)

	e := NewElastic(srv.URL, "sf-alerts")
	e.backoff = time.Millisecond
	e.maxBatch = 4
	go e.Run(context.Background())

	for i := 0; i < 4; i++ {
		a := sampleAlert()
		a.ID = itoa(100 + i)
		e.Handle(a)
	}
	waitForCounter(t, 4, func() uint64 { s, _, _ := e.Stats(); return s })

	body, _, _ := c.last()
	lines := strings.Count(strings.TrimSuffix(body, "\n"), "\n") + 1
	if lines != 8 {
		t.Fatalf("bulk body has %d lines, want 8 (4 meta + 4 docs in ONE request)", lines)
	}
	if n := c.count(); n != 1 {
		t.Fatalf("bulk POSTs = %d, want 1 batched request", n)
	}
}

func TestElasticQueueFullDrops(t *testing.T) {
	e := NewElastic("http://127.0.0.1:1", "sf-alerts")
	e.queue = make(chan alert.Alert, 1) // direct override: tiny spool
	for i := 0; i < 3; i++ {
		e.Handle(sampleAlert())
	}
	_, _, d := e.Stats()
	if d != 2 {
		t.Fatalf("dropped = %d, want 2 (queue of 1, no worker running)", d)
	}
}

func TestElasticDrainSingleAttempt(t *testing.T) {
	// The drain contract, exercised deterministically: a preloaded
	// queue (no worker running) drained directly delivers one
	// best-effort attempt per frame — the same path Run takes after
	// ctx cancellation.
	c := &capture{response: func() (int, string) { return http.StatusOK, bulkAnswer(201) }}
	srv := newServer(t, c)

	e := NewElastic(srv.URL, "sf-alerts")
	e.Handle(sampleAlert())
	e.Handle(sampleAlert())
	e.drain(func(a alert.Alert) { e.deliverBatch(context.Background(), []alert.Alert{a}) })

	sent, f, d := e.Stats()
	if sent != 2 || f != 0 || d != 0 {
		t.Fatalf("after drain: sent %d failed %d dropped %d, want 2/0/0", sent, f, d)
	}
}

// -------------------------------------------------------------- Splunk

func TestSplunkExactBody(t *testing.T) {
	c := &capture{response: func() (int, string) { return http.StatusOK, `{"text":"Success","code":0}` }}
	srv := newServer(t, c)

	s := NewSplunk(srv.URL)
	s.SetToken("hec-token-1")
	s.backoff = time.Millisecond
	go s.Run(context.Background())

	s.Handle(sampleAlert())
	waitForCounter(t, 1, func() uint64 { s, _, _ := s.Stats(); return s })

	body, header, path := c.last()
	if path != "/services/collector/event" {
		t.Fatalf("POST path = %q, want the HEC event endpoint", path)
	}
	if auth := header.Get("Authorization"); auth != "Splunk hec-token-1" {
		t.Fatalf("Authorization = %q, want the HEC token scheme", auth)
	}

	var ev struct {
		Time       float64        `json:"time"`
		Event      alert.Alert    `json:"event"`
		Source     string         `json:"source"`
		SourceType string         `json:"sourcetype"`
		Host       string         `json:"host"`
		Fields     map[string]any `json:"fields"`
	}
	if err := json.Unmarshal([]byte(body), &ev); err != nil {
		t.Fatalf("HEC body unparsable: %v (%s)", err, body)
	}
	ts, _ := time.Parse(time.RFC3339Nano, "2026-09-30T22:15:09Z")
	wantTime := math.Round(float64(ts.UnixMilli())) / 1000
	if math.Abs(ev.Time-wantTime) > 0.001 {
		t.Fatalf("time = %v, want %v (epoch seconds from the alert timestamp)", ev.Time, wantTime)
	}
	if ev.Event.ID != "0a1b2c3d4e5f6071" || ev.Event.RuleID != "r-lsass" {
		t.Fatalf("event = %+v, want the full alert payload", ev.Event)
	}
	if ev.SourceType != "sf:alert" || ev.Source != "security-framework" || ev.Host != "LAB-WKS-01" {
		t.Fatalf("sourcetype/source/host = %q/%q/%q, want the HEC contract", ev.SourceType, ev.Source, ev.Host)
	}
	if ev.Fields["rule_id"] != "r-lsass" || ev.Fields["severity"] != "critical" || ev.Fields["host"] != "LAB-WKS-01" || ev.Fields["user"] != "CORP\\alice" {
		t.Fatalf("indexed fields = %v, want rule_id/severity/host/user", ev.Fields)
	}
}

func TestSplunkCodeNonZeroIsPermanent(t *testing.T) {
	// HEC answers HTTP 200 with a non-zero code for rejected events
	// (bad index, wrong token state...): permanent, never retried.
	c := &capture{response: func() (int, string) { return http.StatusOK, `{"text":"Incorrect index","code":4}` }}
	srv := newServer(t, c)

	s := NewSplunk(srv.URL)
	s.SetToken("hec-token-1")
	s.backoff = time.Millisecond
	go s.Run(context.Background())

	s.Handle(sampleAlert())
	waitForCounter(t, 1, func() uint64 { _, f, _ := s.Stats(); return f })
	if n := c.count(); n != 1 {
		t.Fatalf("POSTs = %d, want 1 (a rejected event is never retried)", n)
	}
}

func TestSplunkRetryOn500ThenSuccess(t *testing.T) {
	var attempts atomic.Int64
	c := &capture{}
	c.mu.Lock()
	c.response = func() (int, string) {
		if attempts.Add(1) == 1 {
			return http.StatusInternalServerError, `{"text":"Internal server error","code":5}`
		}
		return http.StatusOK, `{"text":"Success","code":0}`
	}
	c.mu.Unlock()
	srv := newServer(t, c)

	s := NewSplunk(srv.URL)
	s.SetToken("hec-token-1")
	s.backoff = time.Millisecond
	go s.Run(context.Background())

	s.Handle(sampleAlert())
	waitForCounter(t, 1, func() uint64 { s, _, _ := s.Stats(); return s })
	if n := attempts.Load(); n != 2 {
		t.Fatalf("POSTs = %d, want 2 (500 then success)", n)
	}
}

func TestSplunkNoTokenNoHeader(t *testing.T) {
	c := &capture{response: func() (int, string) { return http.StatusOK, `{"text":"Success","code":0}` }}
	srv := newServer(t, c)

	s := NewSplunk(srv.URL)
	s.backoff = time.Millisecond
	go s.Run(context.Background())

	s.Handle(sampleAlert())
	waitForCounter(t, 1, func() uint64 { s, _, _ := s.Stats(); return s })

	_, header, _ := c.last()
	if auth := header.Get("Authorization"); auth != "" {
		t.Fatalf("Authorization = %q, want no header when no token is set", auth)
	}
}

func TestSplunkQueueFullDrops(t *testing.T) {
	s := NewSplunk("http://127.0.0.1:1")
	s.queue = make(chan alert.Alert, 1)
	for i := 0; i < 3; i++ {
		s.Handle(sampleAlert())
	}
	_, _, d := s.Stats()
	if d != 2 {
		t.Fatalf("dropped = %d, want 2 (queue of 1, no worker running)", d)
	}
}

func TestSplunkDrainSingleAttempt(t *testing.T) {
	c := &capture{response: func() (int, string) { return http.StatusOK, `{"text":"Success","code":0}` }}
	srv := newServer(t, c)

	s := NewSplunk(srv.URL)
	s.Handle(sampleAlert())
	s.Handle(sampleAlert())
	s.drain(func(a alert.Alert) { s.deliver(context.Background(), a) })

	sent, f, d := s.Stats()
	if sent != 2 || f != 0 || d != 0 {
		t.Fatalf("after drain: sent %d failed %d dropped %d, want 2/0/0", sent, f, d)
	}
}
