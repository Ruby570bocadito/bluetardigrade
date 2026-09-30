package webhook

import (
	"bytes"
	"context"
	"encoding/json"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Ruby570bocadito/security-framework/internal/alert"
	"github.com/Ruby570bocadito/security-framework/internal/rules"
	"github.com/Ruby570bocadito/security-framework/pkg/model"
)

func testAlert() alert.Alert {
	ev := &model.Event{ID: "ev-1", Type: model.TypeProcessCreate, Host: "LAB-WKS-01", User: "LAB\\alice"}
	hit := rules.Hit{Rule: &rules.Rule{ID: "5b7e1f38", Name: "Volcado de LSASS via comsvcs.dll", Severity: rules.SevCritical}}
	return alert.Alert{
		Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
		RuleID:    hit.Rule.ID,
		RuleName:  hit.Rule.Name,
		Severity:  hit.Rule.Severity,
		Host:      ev.Host,
		User:      ev.User,
		EventID:   ev.ID,
		EventType: ev.Type,
		Summary:   "rundll32.exe comsvcs.dll, MiniDump",
		MatchedOn: []string{"process.name"},
	}
}

// waitFor polls cond until it holds or the deadline passes, so tests
// never depend on exact scheduler timing.
func waitFor(t *testing.T, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("condition not met before deadline")
}

func TestDeliversAlertAsJSON(t *testing.T) {
	var mu sync.Mutex
	var got map[string]any
	var contentTypes atomic.Value
	seen := make(chan struct{}, 1)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("expected POST, got %s", r.Method)
		}
		contentTypes.Store(r.Header.Get("Content-Type"))
		var a map[string]any
		if err := json.NewDecoder(r.Body).Decode(&a); err != nil {
			t.Errorf("body is not JSON: %v", err)
		}
		mu.Lock()
		got = a
		mu.Unlock()
		w.WriteHeader(http.StatusNoContent)
		seen <- struct{}{}
	}))
	defer srv.Close()

	c := New(srv.URL)
	ctx, cancel := context.WithCancel(context.Background())
	go c.Run(ctx)
	c.Handle(testAlert())
	<-seen
	cancel()
	c.Wait()

	mu.Lock()
	defer mu.Unlock()
	if got["rule_id"] != "5b7e1f38" || got["host"] != "LAB-WKS-01" || got["severity"] != "critical" {
		t.Fatalf("alert payload mismatch: %+v", got)
	}
	sent, failed, dropped := c.Stats()
	if sent != 1 || failed != 0 || dropped != 0 {
		t.Fatalf("stats = sent=%d failed=%d dropped=%d, want 1/0/0", sent, failed, dropped)
	}
	if ct, _ := contentTypes.Load().(string); ct != "application/json" {
		t.Fatalf("content-type = %q, want application/json", ct)
	}
}

func TestRetriesUntilReceiverRecovers(t *testing.T) {
	var attempts atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if attempts.Add(1) < 3 {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	c := New(srv.URL)
	c.backoff = time.Millisecond
	ctx, cancel := context.WithCancel(context.Background())
	go c.Run(ctx)
	c.Handle(testAlert())
	waitFor(t, func() bool { s, _, _ := c.Stats(); return s == 1 })
	cancel()
	c.Wait()

	if n := attempts.Load(); n != 3 {
		t.Fatalf("attempts = %d, want 3 (two 5xx retries then success)", n)
	}
	sent, failed, _ := c.Stats()
	if sent != 1 || failed != 0 {
		t.Fatalf("stats = sent=%d failed=%d, want 1/0", sent, failed)
	}
}

func TestFailsAfterMaxAttemptsOnPersistentError(t *testing.T) {
	var attempts atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		attempts.Add(1)
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer srv.Close()

	c := New(srv.URL)
	c.backoff = time.Millisecond
	ctx, cancel := context.WithCancel(context.Background())
	go c.Run(ctx)
	c.Handle(testAlert())
	waitFor(t, func() bool { _, f, _ := c.Stats(); return f == 1 })
	cancel()
	c.Wait()

	if n := attempts.Load(); n != maxAttempts {
		t.Fatalf("attempts = %d, want %d", n, maxAttempts)
	}
	sent, failed, _ := c.Stats()
	if sent != 0 || failed != 1 {
		t.Fatalf("stats = sent=%d failed=%d, want 0/1", sent, failed)
	}
}

func TestClientErrorIsNotRetried(t *testing.T) {
	var attempts atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		attempts.Add(1)
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer srv.Close()

	c := New(srv.URL)
	c.backoff = time.Millisecond
	ctx, cancel := context.WithCancel(context.Background())
	go c.Run(ctx)
	c.Handle(testAlert())
	waitFor(t, func() bool { _, f, _ := c.Stats(); return f == 1 })
	cancel()
	c.Wait()

	if n := attempts.Load(); n != 1 {
		t.Fatalf("attempts = %d, want 1 (4xx is permanent)", n)
	}
}

func TestDropsWhenQueueIsFull(t *testing.T) {
	c := newClient("http://127.0.0.1:1", 1) // unreachable receiver, no worker running
	for i := 0; i < 4; i++ {
		c.Handle(testAlert())
	}
	_, _, dropped := c.Stats()
	if dropped != 3 {
		t.Fatalf("dropped = %d, want 3 (1 queued + 3 over the limit)", dropped)
	}
}

func TestDrainCountsAbandonedAlertsAsDropped(t *testing.T) {
	c := newClient("http://127.0.0.1:1", 8) // unreachable receiver
	ctx, cancel := context.WithCancel(context.Background())
	go c.Run(ctx)
	for i := 0; i < 5; i++ {
		c.Handle(testAlert())
	}
	// give the worker a moment to pick one item, then cancel: the rest
	// must be drained (failed, single attempt) and never lost silently
	// without a counter
	time.Sleep(20 * time.Millisecond)
	cancel()
	c.Wait()

	sent, failed, dropped := c.Stats()
	if sent != 0 {
		t.Fatalf("sent = %d, want 0", sent)
	}
	if failed+dropped != 5 {
		t.Fatalf("failed+dropped = %d+%d, want 5 in total", failed, dropped)
	}
}

// Outbound auth: with a token configured, every delivery carries
// "Authorization: Bearer <token>" so the receiver can verify the
// caller — including on retries after a 5xx.
func TestSendsBearerTokenWhenConfigured(t *testing.T) {
	var auth atomic.Value
	var attempts atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		auth.Store(r.Header.Get("Authorization"))
		if attempts.Add(1) < 2 {
			w.WriteHeader(http.StatusInternalServerError) // force one retry
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer srv.Close()

	c := New(srv.URL)
	c.SetToken("s3cret-outbound")
	if !c.TokenConfigured() {
		t.Fatal("TokenConfigured() = false after SetToken")
	}
	c.backoff = time.Millisecond
	ctx, cancel := context.WithCancel(context.Background())
	go c.Run(ctx)
	c.Handle(testAlert())
	waitFor(t, func() bool { s, _, _ := c.Stats(); return s == 1 })
	cancel()
	c.Wait()

	if got, _ := auth.Load().(string); got != "Bearer s3cret-outbound" {
		t.Fatalf("Authorization = %q, want %q", got, "Bearer s3cret-outbound")
	}
	if n := attempts.Load(); n != 2 {
		t.Fatalf("attempts = %d, want 2 (one 5xx retry then success)", n)
	}
}

// No token configured: no Authorization header at all, so loopback or
// trust-the-network deployments keep their previous wire format.
func TestOmitsAuthHeaderWithoutToken(t *testing.T) {
	var auth atomic.Value
	seen := make(chan struct{}, 1)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		auth.Store(r.Header.Get("Authorization"))
		w.WriteHeader(http.StatusNoContent)
		seen <- struct{}{}
	}))
	defer srv.Close()

	c := New(srv.URL)
	if c.TokenConfigured() {
		t.Fatal("TokenConfigured() = true without SetToken")
	}
	ctx, cancel := context.WithCancel(context.Background())
	go c.Run(ctx)
	c.Handle(testAlert())
	<-seen
	cancel()
	c.Wait()

	if got, _ := auth.Load().(string); got != "" {
		t.Fatalf("Authorization = %q, want empty", got)
	}
}

// Regression (04-B): the failure log used to print the raw endpoint
// URL AND the raw transport error — and *url.Error echoes the full
// request URL ("Post \"...?token=SECRET\": ..."). A collector URL
// embedding a credential (SIEM ingest key, shared-secret path) used
// to land verbatim in the engine log on every final delivery failure.
func TestWebhookLogRedactsCredentialURL(t *testing.T) {
	var logBuf syncBuffer
	old := log.Writer()
	log.SetOutput(&logBuf)
	defer log.SetOutput(old)

	// closed port: transport error, retryable, exhausts the budget
	c := New("http://127.0.0.1:1/ingest?key=SUPERSECRETKEY")
	c.backoff = time.Millisecond
	ctx, cancel := context.WithCancel(context.Background())
	go c.Run(ctx)
	c.Handle(testAlert())
	waitFor(t, func() bool { _, f, _ := c.Stats(); return f == 1 })
	cancel()
	c.Wait()

	out := logBuf.String()
	if strings.Contains(out, "SUPERSECRETKEY") {
		t.Fatalf("failure log leaks the credential-bearing URL: %q", out)
	}
	if !strings.Contains(out, "http://127.0.0.1:1") {
		t.Fatalf("failure log lost the endpoint label: %q", out)
	}
	if !strings.Contains(out, "connection refused") {
		t.Fatalf("failure log lost the underlying cause: %q", out)
	}
}

// Regression (04-A): the final failure log used to hardcode the full
// retry budget ("failed after 3 attempts") even when the delivery
// stopped after ONE post — a permanent 4xx is never retried, and the
// operator debugging the receiver must read the real attempt count.
func TestWebhookFailureLogStatesRealAttemptCount(t *testing.T) {
	var logBuf syncBuffer
	old := log.Writer()
	log.SetOutput(&logBuf)
	defer log.SetOutput(old)

	var hits atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		http.Error(w, "gone", http.StatusNotFound) // permanent 4xx: no retry
	}))
	defer srv.Close()

	c := New(srv.URL)
	ctx, cancel := context.WithCancel(context.Background())
	go c.Run(ctx)
	c.Handle(testAlert())
	waitFor(t, func() bool { _, f, _ := c.Stats(); return f == 1 })
	cancel()
	c.Wait()

	if n := hits.Load(); n != 1 {
		t.Fatalf("posts = %d, want 1 (4xx is permanent)", n)
	}
	if !strings.Contains(logBuf.String(), "failed after 1 attempt(s)") {
		t.Fatalf("failure log must state the real attempt count, got: %q", logBuf.String())
	}
}

type syncBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (b *syncBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.Write(p)
}

func (b *syncBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}
