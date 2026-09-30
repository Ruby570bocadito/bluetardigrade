package notify

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/Ruby570bocadito/security-framework/internal/alert"
)

// httpTimeoutClient wraps *http.Client so the HTTP channels share one
// construction point, one timeout policy and one retryable() contract.
type httpTimeoutClient struct {
	hc *http.Client
}

func newTimeoutClient(timeout time.Duration) *httpTimeoutClient {
	return &httpTimeoutClient{hc: &http.Client{Timeout: timeout}}
}

func (c *httpTimeoutClient) post(ctx context.Context, url string, payload []byte) error {
	return postJSON(ctx, c.hc, url, payload)
}

// Slack delivers alerts to a Slack incoming webhook: one JSON body
// {"text": ...} per alert, posted to an operator-provided hook URL.
// The hook URL itself is the credential (it embeds a secret path);
// there is no separate Authorization header, exactly like every
// normal Slack integration.
type Slack struct {
	name string
	url  string
	hc   *httpTimeoutClient
}

// NewSlack builds a Slack channel for an incoming webhook URL. The
// name is the operator label used in stats, metrics and logs.
func NewSlack(name, url string) *Slack {
	return &Slack{name: name, url: url, hc: newTimeoutClient(httpTimeout)}
}

func (s *Slack) Name() string { return s.name }

// Deliver posts the alert as a single Slack text block. The payload
// carries only the rendered human line — the structured JSON already
// reaches SIEM consumers through the engine webhook, and keeping chat
// messages small keeps them readable in a busy channel.
func (s *Slack) Deliver(ctx context.Context, a alert.Alert) error {
	payload, err := json.Marshal(struct {
		Text string `json:"text"`
	}{Text: truncate(renderText(a), maxChatRunes)})
	if err != nil {
		return err
	}
	return s.hc.post(ctx, s.url, payload)
}

// Retryable delegates to the shared HTTP classification.
func (s *Slack) Retryable(err error) bool { return isRetryable(err) }

// Telegram delivers alerts through a Telegram bot (sendMessage). The
// bot token goes in the URL path per the Bot API contract; api_url is
// overridable so tests and self-hosted Bot API servers can point the
// channel somewhere else without touching the token.
type Telegram struct {
	name   string
	token  string
	chatID string
	apiURL string // default https://api.telegram.org, no trailing slash
	hc     *httpTimeoutClient
}

// NewTelegram builds a Telegram channel. apiURL may be empty for the
// official Bot API endpoint.
func NewTelegram(name, token, chatID, apiURL string) *Telegram {
	if apiURL == "" {
		apiURL = "https://api.telegram.org"
	}
	return &Telegram{name: name, token: token, chatID: chatID, apiURL: apiURL, hc: newTimeoutClient(httpTimeout)}
}

func (t *Telegram) Name() string { return t.name }

// Deliver posts one sendMessage request. disable_web_page_preview
// keeps alert links from turning into noisy preview cards.
func (t *Telegram) Deliver(ctx context.Context, a alert.Alert) error {
	payload, err := json.Marshal(struct {
		ChatID                string `json:"chat_id"`
		Text                  string `json:"text"`
		DisableWebPagePreview bool   `json:"disable_web_page_preview"`
	}{
		ChatID:                t.chatID,
		Text:                  truncate(renderText(a), maxChatRunes),
		DisableWebPagePreview: true,
	})
	if err != nil {
		return err
	}
	url := t.apiURL + "/bot" + t.token + "/sendMessage"
	return t.hc.post(ctx, url, payload)
}

// Retryable delegates to the shared HTTP classification.
func (t *Telegram) Retryable(err error) bool { return isRetryable(err) }
