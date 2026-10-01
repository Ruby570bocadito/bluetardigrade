package notify

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"net"
	"net/smtp"
	"strings"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/alert"
)

// Email delivers alerts as SMTP mail. Transport policy (fail loud,
// never silently downgrade):
//
//   - starttls defaults to TRUE. If the server does not advertise
//     STARTTLS the delivery fails permanently instead of falling back
//     to cleartext — alert content is security telemetry and must not
//     ride an unencrypted hop the operator did not ask for.
//   - AUTH PLAIN is only attempted over TLS or loopback (the same
//     rule net/smtp enforces itself); without TLS, credentials would
//     cross the wire in base64, which is not encoding, it is exposure.
//
// Retry classification: transport-level failures (dial, deadline, io)
// are retryable because a relay may recover; SMTP protocol responses
// (auth rejected, mailbox refused, syntax errors) are permanent
// because retrying the same envelope cannot change the answer.
type Email struct {
	name     string
	server   string // host:port
	host     string // bare host, for EHLO/STARTTLS/auth realm
	from     string
	to       []string
	username string
	password string
	starttls bool
	hello    string // optional EHLO domain
	timeout  time.Duration
	tlsCfg   *tls.Config // test seam; nil builds the standard config
}

// NewEmail builds an email channel. starttls is the resolved policy
// (the config loader defaults it to true); username/password may be
// empty for relays that do not require auth.
func NewEmail(name, server, from string, to []string, username, password string, starttls bool, hello string) *Email {
	host, _, _ := net.SplitHostPort(server)
	return &Email{
		name:     name,
		server:   server,
		host:     host,
		from:     from,
		to:       to,
		username: username,
		password: password,
		starttls: starttls,
		hello:    hello,
		timeout:  smtpTimeout,
	}
}

// Name implements the Channel interface: stable channel identifier.
func (e *Email) Name() string { return e.name }

// Deliver sends one message. The body carries the shared human line
// plus the full structured alert, so the mailbox doubles as a
// forensic record exactly like the webhook's JSON consumers.
func (e *Email) Deliver(ctx context.Context, a alert.Alert) error {
	body, err := json.Marshal(a)
	if err != nil {
		return &deliveryError{err: err, retryable: false}
	}
	msg := e.buildMessage(a, body)

	var d net.Dialer
	conn, err := d.DialContext(ctx, "tcp", e.server)
	if err != nil {
		return &deliveryError{err: err, retryable: true}
	}
	if dl, ok := ctx.Deadline(); ok {
		_ = conn.SetDeadline(dl)
	} else {
		_ = conn.SetDeadline(time.Now().Add(e.timeout))
	}

	c, err := smtp.NewClient(conn, e.host)
	if err != nil {
		conn.Close()
		return &deliveryError{err: err, retryable: true}
	}
	defer c.Close()

	// EHLO always: the extension map Extension() reads is only
	// populated by the hello handshake, so skipping it would make the
	// STARTTLS check below fail even against a compliant server.
	helloDomain := e.hello
	if helloDomain == "" {
		helloDomain = "localhost"
	}
	if err := c.Hello(helloDomain); err != nil {
		return &deliveryError{err: fmt.Errorf("EHLO: %w", err), retryable: false}
	}

	if e.starttls {
		if ok, _ := c.Extension("STARTTLS"); !ok {
			return &deliveryError{err: fmt.Errorf("server %s does not offer STARTTLS; refusing to send alert content in cleartext (set starttls: false only for loopback relays)", e.host), retryable: false}
		}
		tlsCfg := e.tlsCfg
		if tlsCfg == nil {
			tlsCfg = &tls.Config{ServerName: e.host}
		}
		if err := c.StartTLS(tlsCfg); err != nil {
			return &deliveryError{err: fmt.Errorf("STARTTLS: %w", err), retryable: true}
		}
	}

	if e.username != "" {
		auth := smtp.PlainAuth("", e.username, e.password, e.host)
		if err := c.Auth(auth); err != nil {
			return &deliveryError{err: fmt.Errorf("auth: %w", err), retryable: false}
		}
	}

	if err := c.Mail(e.from); err != nil {
		return &deliveryError{err: fmt.Errorf("MAIL FROM: %w", err), retryable: false}
	}
	for _, rcpt := range e.to {
		if err := c.Rcpt(rcpt); err != nil {
			return &deliveryError{err: fmt.Errorf("RCPT TO %s: %w", rcpt, err), retryable: false}
		}
	}
	w, err := c.Data()
	if err != nil {
		return &deliveryError{err: fmt.Errorf("DATA: %w", err), retryable: false}
	}
	if _, err := w.Write(msg); err != nil {
		w.Close()
		return &deliveryError{err: fmt.Errorf("writing message: %w", err), retryable: true}
	}
	if err := w.Close(); err != nil {
		return &deliveryError{err: fmt.Errorf("closing message: %w", err), retryable: false}
	}
	return c.Quit()
}

// Retryable delegates to the delivery classification.
func (e *Email) Retryable(err error) bool { return isRetryable(err) }

// buildMessage renders the RFC 5322 message. Header safety: subject
// and envelope values are collapsed to one line (rule names, hosts
// and summaries are operator- or event-controlled text and must never
// be able to smuggle a second header into the message).
func (e *Email) buildMessage(a alert.Alert, payload []byte) []byte {
	var b strings.Builder
	fmt.Fprintf(&b, "From: %s\r\n", e.from)
	fmt.Fprintf(&b, "To: %s\r\n", strings.Join(e.to, ", "))
	fmt.Fprintf(&b, "Subject: %s\r\n", mailSubject(a))
	fmt.Fprintf(&b, "Date: %s\r\n", time.Now().UTC().Format(time.RFC1123Z))
	if a.ID != "" {
		fmt.Fprintf(&b, "Message-ID: <%s@security-framework>\r\n", oneLine(a.ID))
	}
	b.WriteString("MIME-Version: 1.0\r\n")
	b.WriteString("Content-Type: text/plain; charset=utf-8\r\n")
	b.WriteString("Content-Transfer-Encoding: 8bit\r\n")
	b.WriteString("\r\n")
	b.WriteString(renderMailBody(a))
	b.WriteString("\r\n")
	return []byte(b.String())
}
