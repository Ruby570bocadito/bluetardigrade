package siem

import (
	"errors"
	"fmt"
	"log"
	"net/url"
)

// EndpointLabel reduces an outbound endpoint URL to scheme://host for
// logs and the startup banner. The path, query and userinfo of a sink URL can embed
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
func EndpointLabel(raw string) string {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return "<endpoint>"
	}
	return u.Scheme + "://" + u.Host
}

// requireHTTPScheme fails loud at construction when a sink URL does
// not carry an http/https scheme. The http.Client would reject
// anything else per delivery — late, with retry noise, and with the
// sink silently delivering nothing: the "the check that does not
// fail, lies" failure mode in slow motion. A miswritten flag must
// stop the engine at startup with an actionable message, the same
// FATAL contract malformed beacons/thresholds already follow.
// http stays allowed: self-hosted/LAN clusters are legitimate and the
// cleartext trade-off is documented in the README.
func requireHTTPScheme(sink, raw string) {
	u, err := url.Parse(raw)
	if err != nil {
		log.Fatalf("[SIEM] %s: URL no parseable (%s)", sink, EndpointLabel(raw))
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		log.Fatalf("[SIEM] %s: esquema %q invalido, solo http/https (%s)", sink, u.Scheme, EndpointLabel(raw))
	}
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
