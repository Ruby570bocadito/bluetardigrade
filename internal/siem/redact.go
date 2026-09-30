package siem

import (
	"errors"
	"fmt"
	"net/url"
)

// endpointLabel reduces an outbound endpoint URL to scheme://host for
// logs. The path, query and userinfo of a sink URL can embed
// credentials (a corporate proxy in user:pass@host form, signed query
// strings, token-bearing collector paths); the operator knows their
// own endpoint, the log shipper downstream does not need its details.
// Unparseable input degrades to a placeholder instead of echoing the
// raw string.
//
// Local copy by the same rationale that kept a local redactedURLErr in
// internal/actions: the output packages (webhook, notify, siem) stay
// decoupled from each other. If a fourth copy ever appears, promote
// the helper to its own shared package instead of importing one output
// package from another.
func endpointLabel(raw string) string {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return "<endpoint>"
	}
	return u.Scheme + "://" + u.Host
}

// redactedErr strips the transport wrapper from HTTP errors so the
// request URL (which may embed the credential) never reaches the log;
// only the underlying cause is kept (deadline, connection refused,
// TLS handshake failure).
func redactedErr(err error) error {
	var ue *url.Error
	if errors.As(err, &ue) && ue.Err != nil {
		return fmt.Errorf("sink endpoint: %w", ue.Err)
	}
	return err
}
