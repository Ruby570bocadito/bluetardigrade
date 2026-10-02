package siem

import (
	"bytes"
	"context"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/alert"
)

// Regression for the defect-#30 class inside the SIEM sinks: a
// transport failure logged the sink URL raw plus the untouched
// *url.Error, and url.Error prints the full request URL — userinfo
// included (http://proxy-user:secret@host). An operator who routes a
// sink through a credential-bearing proxy URL would leak that
// credential into engine logs on the first network hiccup.

type syncLogBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (b *syncLogBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.Write(p)
}

func (b *syncLogBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}

func captureLog(t *testing.T) func() string {
	t.Helper()
	var buf syncLogBuffer
	old := log.Writer()
	log.SetOutput(&buf)
	t.Cleanup(func() { log.SetOutput(old) })
	return func() string { return buf.String() }
}

// TestEndpointLabelRedacts moved to internal/redact with the helper
// itself (#35): the table pins the shared contract where the code
// lives now.

// Regression for cross-review finding F2 (#32 adenda): a non-429 4xx
// from the cluster is a permanent rejection ("4xx failed-for-good",
// the declared contract, same behavior as the Splunk sink), not a
// retry candidate. Pre-fix this test saw 3 POSTs and a 3-attempt
// budget burned on a bad API key; post-fix exactly 1 POST and the
// batch counted as failed in one pass.
func TestElastic4xxIsPermanent(t *testing.T) {
	var posts int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&posts, 1)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error":{"root_cause":[{"type":"security_exception"}]},"status":401}`))
	}))
	t.Cleanup(srv.Close)

	e, _ := NewElastic(srv.URL, "sf-alerts")
	e.backoff = time.Millisecond
	e.deliverBatch(context.Background(), []alert.Alert{sampleAlert(), sampleAlert()})

	if got := atomic.LoadInt32(&posts); got != 1 {
		t.Fatalf("bulk POSTs = %d, want 1 (4xx is permanent, no retries)", got)
	}
	sent, failed, dropped := e.Stats()
	if sent != 0 || failed != 2 || dropped != 0 {
		t.Fatalf("stats = sent %d failed %d dropped %d, want 0/2/0 (batch rejected in one pass)", sent, failed, dropped)
	}
}

func TestSplunkFailureLogRedactsCredentialURL(t *testing.T) {
	read := captureLog(t)

	// closed port: transport error on every attempt, retryable, the
	// budget exhausts and the failure line lands with the URL in it
	// (pre-fix) or the endpoint label (post-fix).
	s, _ := NewSplunk("http://SFUSER:SUPERSECRETKEY@127.0.0.1:1/services/collector/event")
	s.backoff = time.Millisecond
	s.deliver(context.Background(), sampleAlert())

	out := read()
	if strings.Contains(out, "SUPERSECRETKEY") || strings.Contains(out, "SFUSER") {
		t.Fatalf("failure log leaks the credential-bearing URL: %q", out)
	}
	if !strings.Contains(out, "http://127.0.0.1:1") {
		t.Fatalf("failure log lost the endpoint label: %q", out)
	}
	if !strings.Contains(out, "dial tcp 127.0.0.1:1") {
		t.Fatalf("failure log lost the underlying cause: %q", out)
	}
	if _, f, _ := s.Stats(); f != 1 {
		t.Fatalf("failed = %d, want 1 (delivery exhausted)", f)
	}
}

func TestElasticFailureLogRedactsCredentialURL(t *testing.T) {
	read := captureLog(t)

	e, _ := NewElastic("http://SFUSER:SUPERSECRETKEY@127.0.0.1:1/_bulk", "sf-alerts")
	e.backoff = time.Millisecond
	e.deliverBatch(context.Background(), []alert.Alert{sampleAlert()})

	out := read()
	if strings.Contains(out, "SUPERSECRETKEY") || strings.Contains(out, "SFUSER") {
		t.Fatalf("failure log leaks the credential-bearing URL: %q", out)
	}
	if !strings.Contains(out, "http://127.0.0.1:1") {
		t.Fatalf("failure log lost the endpoint label: %q", out)
	}
	if !strings.Contains(out, "dial tcp 127.0.0.1:1") {
		t.Fatalf("failure log lost the underlying cause: %q", out)
	}
	if _, f, _ := e.Stats(); f != 1 {
		t.Fatalf("failed = %d, want 1 (batch exhausted)", f)
	}
}
