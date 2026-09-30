package redact

import (
	"errors"
	"fmt"
	"net/url"
	"testing"
)

// TestEndpointLabelRedacts moved from internal/siem with the helper
// (#35): the table pins the degrade-to-placeholder behavior for
// unparseable input — the raw string never survives a failure.
func TestEndpointLabelRedacts(t *testing.T) {
	cases := []struct {
		name, raw, want string
	}{
		{"userinfo+query+path", "https://svc:hunter2@collector.example.com:8088/services/collector/event?x=1", "https://collector.example.com:8088"},
		{"plain host", "http://elastic.local:9200/_bulk", "http://elastic.local:9200"},
		{"no host", "not a url", "<endpoint>"},
	}
	for _, tc := range cases {
		if got := EndpointLabel(tc.raw); got != tc.want {
			t.Errorf("%s: EndpointLabel(%q) = %q, want %q", tc.name, tc.raw, got, tc.want)
		}
	}
}

// TestURLErrStripsTransportWrapper pins the four-call-site contract:
// a *url.Error is rewritten to "<label>: <cause>" — the cause names
// the failure, the URL never travels — and every other error passes
// through unchanged, exactly as the four local copies did. The label
// is a parameter because each package's log vocabulary is its own
// operator-facing contract; byte-identical log output is the point.
func TestURLErrStripsTransportWrapper(t *testing.T) {
	cause := errors.New("connection refused")
	wrapped := &url.Error{Op: "Post", URL: "https://svc:hunter2@hooks.example.com/x?token=SECRET", Err: cause}

	got := URLErr(wrapped, "receiver endpoint")
	want := "receiver endpoint: connection refused"
	if got.Error() != want {
		t.Errorf("URLErr(url.Error) = %q, want %q", got.Error(), want)
	}
	if !errors.Is(got, cause) {
		t.Error("the cause must stay unwrappable (errors.Is) for callers that classify")
	}

	// every non-url.Error passes through unchanged — no double
	// wrapping, no label invented for errors that carry no URL
	plain := fmt.Errorf("encoding failed")
	if URLErr(plain, "sink endpoint") != plain {
		t.Error("non-url.Error must pass through unchanged")
	}

	// the nil-inner-Err guard the four copies all carried: a url.Error
	// without a cause degrades to passthrough, not to "label: <nil>"
	empty := &url.Error{Op: "Post", URL: "https://hooks.example.com/x", Err: nil}
	if URLErr(empty, "notification endpoint") != error(empty) {
		t.Error("url.Error with nil cause must pass through unchanged")
	}
}
