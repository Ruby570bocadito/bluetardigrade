package siem

import (
	"fmt"
	"net/url"

	"github.com/Ruby570bocadito/bluetardigrade/internal/redact"
)

// The outbound-endpoint redaction helpers (EndpointLabel, the
// *url.Error rewriter) used to live here; #35 promoted them to
// internal/redact when the fourth copy appeared — exactly what this
// file's own rule declared. requireHTTPScheme stays: it is the
// sink-specific FATAL contract, not a redaction helper.

// requireHTTPScheme reports a construction-time error when a sink URL
// does not carry an http/https scheme. The http.Client would reject
// anything else per delivery — late, with retry noise, and with the
// sink silently delivering nothing: the "the check that does not
// fail, lies" failure mode in slow motion. A miswritten flag must
// stop the engine at startup with an actionable message, the same
// FATAL contract malformed beacons/thresholds already follow — but
// the DECISION to exit belongs to the host binary (cmd/engine), not
// to this library: a log.Fatalf here would skip every deferred close
// (store, audit) in the process. http stays allowed: self-hosted/LAN
// clusters are legitimate and the cleartext trade-off is documented
// in the README.
func requireHTTPScheme(sink, raw string) error {
	u, err := url.Parse(raw)
	if err != nil {
		return fmt.Errorf("[SIEM] %s: URL no parseable (%s)", sink, redact.EndpointLabel(raw))
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return fmt.Errorf("[SIEM] %s: esquema %q invalido, solo http/https (%s)", sink, u.Scheme, redact.EndpointLabel(raw))
	}
	return nil
}
