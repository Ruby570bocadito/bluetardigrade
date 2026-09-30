package siem

import (
	"bytes"
	"context"
	"log"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Ruby570bocadito/security-framework/internal/alert"
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

func TestEndpointLabelRedacts(t *testing.T) {
	cases := []struct {
		name, raw, want string
	}{
		{"userinfo+query+path", "https://svc:hunter2@collector.example.com:8088/services/collector/event?x=1", "https://collector.example.com:8088"},
		{"plain host", "http://elastic.local:9200/_bulk", "http://elastic.local:9200"},
		{"no host", "not a url", "<endpoint>"},
	}
	for _, tc := range cases {
		if got := endpointLabel(tc.raw); got != tc.want {
			t.Errorf("%s: endpointLabel(%q) = %q, want %q", tc.name, tc.raw, got, tc.want)
		}
	}
}

func TestSplunkFailureLogRedactsCredentialURL(t *testing.T) {
	read := captureLog(t)

	// closed port: transport error on every attempt, retryable, the
	// budget exhausts and the failure line lands with the URL in it
	// (pre-fix) or the endpoint label (post-fix).
	s := NewSplunk("http://SFUSER:SUPERSECRETKEY@127.0.0.1:1/services/collector/event")
	s.backoff = time.Millisecond
	s.deliver(context.Background(), sampleAlert())

	out := read()
	if strings.Contains(out, "SUPERSECRETKEY") || strings.Contains(out, "SFUSER") {
		t.Fatalf("failure log leaks the credential-bearing URL: %q", out)
	}
	if !strings.Contains(out, "http://127.0.0.1:1") {
		t.Fatalf("failure log lost the endpoint label: %q", out)
	}
	if !strings.Contains(out, "connection refused") {
		t.Fatalf("failure log lost the underlying cause: %q", out)
	}
	if _, f, _ := s.Stats(); f != 1 {
		t.Fatalf("failed = %d, want 1 (delivery exhausted)", f)
	}
}

func TestElasticFailureLogRedactsCredentialURL(t *testing.T) {
	read := captureLog(t)

	e := NewElastic("http://SFUSER:SUPERSECRETKEY@127.0.0.1:1/_bulk", "sf-alerts")
	e.backoff = time.Millisecond
	e.deliverBatch(context.Background(), []alert.Alert{sampleAlert()})

	out := read()
	if strings.Contains(out, "SUPERSECRETKEY") || strings.Contains(out, "SFUSER") {
		t.Fatalf("failure log leaks the credential-bearing URL: %q", out)
	}
	if !strings.Contains(out, "http://127.0.0.1:1") {
		t.Fatalf("failure log lost the endpoint label: %q", out)
	}
	if !strings.Contains(out, "connection refused") {
		t.Fatalf("failure log lost the underlying cause: %q", out)
	}
	if _, f, _ := e.Stats(); f != 1 {
		t.Fatalf("failed = %d, want 1 (batch exhausted)", f)
	}
}
