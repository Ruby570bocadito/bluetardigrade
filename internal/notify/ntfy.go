package notify

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/Ruby570bocadito/bluetardigrade/internal/alert"
	"github.com/Ruby570bocadito/bluetardigrade/internal/redact"
	"github.com/Ruby570bocadito/bluetardigrade/internal/rules"
)

// Ntfy delivers alerts as push notifications through an ntfy server
// (https://ntfy.sh, or one the organisation hosts itself): the phone
// app subscribed to the topic rings with the alert, its severity as
// the notification priority and, when the console address is
// configured, a tap that opens the alert. The message is published as
// JSON to the server root (ntfy's JSON publishing), so titles and
// bodies travel as UTF-8 without header encoding tricks.
type Ntfy struct {
	name       string
	server     string // base URL, no trailing slash
	topic      string
	token      string // optional access token (Authorization: Bearer)
	consoleURL string
	hc         *http.Client
}

// NewNtfy builds an ntfy channel. token may be empty for open topics.
func NewNtfy(name, server, topic, token string) *Ntfy {
	return &Ntfy{name: name, server: strings.TrimRight(server, "/"), topic: topic, token: token, hc: newTimeoutClient(httpTimeout).hc}
}

// Name implements the Channel interface: stable channel identifier.
func (n *Ntfy) Name() string { return n.name }

func (n *Ntfy) setConsoleURL(u string) { n.consoleURL = u }

// ntfyPriority maps the alert severity onto ntfy's 1..5 scale: a
// critical alert rings through do-not-disturb profiles that honour
// "urgent", an informational one arrives silently.
func ntfyPriority(sev string) int {
	switch sev {
	case rules.SevCritical:
		return 5
	case rules.SevHigh:
		return 4
	case rules.SevMedium:
		return 3
	case rules.SevLow:
		return 2
	default:
		return 1
	}
}

func ntfyTags(sev string) []string {
	switch sev {
	case rules.SevCritical:
		return []string{"rotating_light"}
	case rules.SevHigh:
		return []string{"warning"}
	default:
		return []string{"shield"}
	}
}

// Deliver publishes one message.
func (n *Ntfy) Deliver(ctx context.Context, a alert.Alert) error {
	msg := struct {
		Topic    string   `json:"topic"`
		Title    string   `json:"title"`
		Message  string   `json:"message"`
		Priority int      `json:"priority"`
		Tags     []string `json:"tags"`
		Click    string   `json:"click,omitempty"`
	}{
		Topic:    n.topic,
		Title:    truncate(oneLine(fmt.Sprintf("[%s] %s @ %s", strings.ToUpper(a.Severity), a.RuleName, a.Host)), maxSubjectRunes),
		Message:  truncate(renderText(a), maxChatRunes),
		Priority: ntfyPriority(a.Severity),
		Tags:     ntfyTags(a.Severity),
		Click:    alertLink(n.consoleURL, a),
	}
	payload, err := json.Marshal(msg)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, n.server, bytes.NewReader(payload))
	if err != nil {
		return &deliveryError{err: redact.URLErr(err, "ntfy server"), retryable: false}
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "bluetardigrade-notify/0.1")
	if n.token != "" {
		req.Header.Set("Authorization", "Bearer "+n.token)
	}
	resp, err := n.hc.Do(req)
	if err != nil {
		return &deliveryError{err: redact.URLErr(err, "ntfy server"), retryable: true}
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, resp.Body)
	return classifyStatus(resp.StatusCode)
}

// Retryable delegates to the shared HTTP classification.
func (n *Ntfy) Retryable(err error) bool { return isRetryable(err) }
