// Package redact holds the outbound-endpoint redaction helpers shared
// by every package that logs about an operator-configured remote
// endpoint: actions, notify, siem and webhook.
//
// The rule this package executes was declared in siem/redact.go while
// there were two copies of the pair (EndpointLabel + a *url.Error
// rewriter): the output packages stay decoupled from each other, and
// the moment a fourth copy appears the helpers are promoted to their
// own shared package instead of one output package importing another.
// The fourth copy appeared in internal/notify (defect #35, option b),
// so the promotion happened exactly as the
// rule ordered.
//
// Why the rule exists: the path, query and userinfo of an outbound
// URL can embed credentials. The hook IS the credential for
// Slack-style integrations (a secret path), a corporate proxy hides
// in user:pass@host, and collector paths carry ingest keys. The
// operator knows their own endpoints; the log shipper downstream does
// not need their details. *url.Error echoes the full request URL
// verbatim, so any routine transport failure would otherwise pin a
// live credential to stderr and every log shipper downstream.
package redact

import (
	"errors"
	"fmt"
	"net/url"
)

// EndpointLabel reduces an outbound endpoint URL to scheme://host for
// logs and banners. The path, query and userinfo of a collector URL
// can embed credentials (SIEM ingest keys, shared-secret paths,
// proxies in user:pass@host form); the operator knows their own
// endpoint, the log shipper downstream does not need its details.
// Unparseable input degrades to a placeholder instead of echoing the
// raw string.
func EndpointLabel(raw string) string {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return "<endpoint>"
	}
	return u.Scheme + "://" + u.Host
}

// URLErr strips the transport wrapper from HTTP errors so the request
// URL never reaches the log: *url.Error echoes the URL verbatim and
// an operator-configured URL can embed a credential in its path,
// query or userinfo. The underlying cause (deadline, refused, no such
// host) is kept — it names the failure without naming the endpoint —
// under the caller's label, because each package's log vocabulary is
// its own operator-facing contract ("receiver endpoint", "sink
// endpoint", "notification endpoint", "destino"). A non-url.Error
// passes through unchanged, exactly as every local copy did.
func URLErr(err error, label string) error {
	var ue *url.Error
	if errors.As(err, &ue) && ue.Err != nil {
		return fmt.Errorf("%s: %w", label, ue.Err)
	}
	return err
}
