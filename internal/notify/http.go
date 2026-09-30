package notify

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"

	"github.com/Ruby570bocadito/security-framework/internal/redact"
)

// deliveryError carries the retry classification of one failed
// delivery attempt alongside the error itself, so channels can answer
// Retryable() without keeping per-attempt state.
type deliveryError struct {
	err       error
	retryable bool
}

func (e *deliveryError) Error() string { return e.err.Error() }
func (e *deliveryError) Unwrap() error { return e.err }

// isRetryable reports whether a delivery error could plausibly
// succeed on a later attempt. Errors that are not deliveryError
// (encoding failures, programming mistakes) are never retried.
func isRetryable(err error) bool {
	var de *deliveryError
	return errors.As(err, &de) && de.retryable
}

// postJSON performs one HTTP delivery attempt with the same
// classification contract as internal/webhook: 2xx succeeds, 429 and
// 5xx are retryable (the receiver is asking us to come back), other
// 4xx answers are permanent (retrying a misconfigured endpoint only
// delays the queue) and transport errors are retryable because the
// receiver may recover.
func postJSON(ctx context.Context, hc *http.Client, url string, payload []byte) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		// A URL the client cannot build will not heal. The parse error
		// echoes the raw URL (which may embed the credential), so it is
		// redacted with the same rule as transport errors. The helper
		// lives in internal/redact since #35 promoted it there (this
		// package's copy was the fourth that triggered the rule).
		return &deliveryError{err: redact.URLErr(err, "notification endpoint"), retryable: false}
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "security-framework-notify/0.1")

	resp, err := hc.Do(req)
	if err != nil {
		return &deliveryError{err: redact.URLErr(err, "notification endpoint"), retryable: true} // transport error: the receiver may recover
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, resp.Body) // drain so the connection is reusable
	switch {
	case resp.StatusCode >= 200 && resp.StatusCode < 300:
		return nil
	case resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode >= 500:
		return &deliveryError{err: fmt.Errorf("receiver answered %d", resp.StatusCode), retryable: true}
	default:
		return &deliveryError{err: fmt.Errorf("receiver answered %d", resp.StatusCode), retryable: false}
	}
}
