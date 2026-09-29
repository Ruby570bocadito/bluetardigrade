package webhook

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
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
