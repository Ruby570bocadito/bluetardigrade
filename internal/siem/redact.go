package siem

import (
	"log"
	"net/url"

	"github.com/Ruby570bocadito/security-framework/internal/redact"
)

// The outbound-endpoint redaction helpers (EndpointLabel, the
// *url.Error rewriter) used to live here; #35 promoted them to
// internal/redact when the fourth copy appeared — exactly what this
// file's own rule declared. requireHTTPScheme stays: it is the
// sink-specific FATAL contract, not a redaction helper.

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
		log.Fatalf("[SIEM] %s: URL no parseable (%s)", sink, redact.EndpointLabel(raw))
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		log.Fatalf("[SIEM] %s: esquema %q invalido, solo http/https (%s)", sink, u.Scheme, redact.EndpointLabel(raw))
	}
}
