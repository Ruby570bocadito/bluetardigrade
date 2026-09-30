// Package actions executes the actions declared by a rule when it
// fires. The YAML rule format carries an `actions` list; until now the
// engine parsed it but never ran it. This package closes that gap with
// two real, production-ready action types:
//
//   - alert: renders config.message as a human-readable template into
//     the alert payload (placeholders {host}, {user}, {rule},
//     {severity}, {event_type}, {summary}) and records the
//     config.notify flag so downstream consumers can filter on it.
//   - webhook: POSTs the full alert JSON to config.url, optionally
//     with a Bearer secret and a per-action timeout, through a bounded
//     in-flight queue so a slow receiver can never stall ingestion.
//
// Webhook delivery is asynchronous by design: rendering must happen
// before the alert is written (so the JSON log line carries the
// rendered message), but the HTTP round trip runs in the background
// with strict concurrency limits and failure logging. Unknown action
// types are logged once and ignored; they never break the pipeline.
//
// Trust model (SSRF review, agent-04 round 2026-09-30): action
// configuration — including config.url and config.secret — comes
// exclusively from YAML rule files on disk, loaded at startup and by
// the hot-reload ticker from the operator's rules directory. The HTTP
// API is read-only and cannot author rules or actions, and sensor
// traffic never reaches action configuration, so there is no
// untrusted-input path that can point a webhook at an internal
// service. A webhook URL targeting internal infrastructure is
// therefore an operator decision, not an injection vector; this is
// the expected behavior for a single-tenant, operator-configured
// deployment and is documented as a non-issue by design.
package actions

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/Ruby570bocadito/security-framework/internal/alert"
	"github.com/Ruby570bocadito/security-framework/internal/rules"
)

const (
	maxInFlight    = 8                // webhooks delivered concurrently
	defaultTimeout = 5 * time.Second  // per-webhook, overridable per action
	maxTimeout     = 30 * time.Second // hard ceiling
)

// Inputs are the values available to message templates.
type Inputs struct {
	Host      string
	User      string
	Rule      string
	Severity  string
	EventType string
	Summary   string
}

// Dispatcher executes rule actions for raised alerts. It is safe for
// concurrent use.
type Dispatcher struct {
	mu     sync.Mutex
	once   map[string]bool // "unsupported action type" warnings, once each
	client *http.Client
	sem    chan struct{}
	log    *log.Logger
}

// New creates a Dispatcher. logf receives delivery diagnostics; pass
// nil to discard them.
func New(logf *log.Logger) *Dispatcher {
	if logf == nil {
		logf = log.New(io.Discard, "", 0)
	}
	return &Dispatcher{
		once:   map[string]bool{},
		client: &http.Client{},
		sem:    make(chan struct{}, maxInFlight),
		log:    logf,
	}
}

// Prepare runs the synchronous part of a rule's actions on a freshly
// built alert: it renders alert messages and records the notify flag.
// It must be called before the alert is written anywhere, so the JSON
// payload and the console carry the rendered message. Webhook actions
// found in acts are dispatched asynchronously.
func (d *Dispatcher) Prepare(a *alert.Alert, acts []rules.Action) {
	if a == nil {
		return
	}
	in := Inputs{
		Host:      a.Host,
		User:      a.User,
		Rule:      a.RuleName,
		Severity:  a.Severity,
		EventType: a.EventType,
		Summary:   a.Summary,
	}
	for _, act := range acts {
		switch act.Type {
		case "alert":
			if msg := Render(act.Config["message"], in); msg != "" {
				a.Message = msg
			}
			if notify, err := strconv.ParseBool(strings.ToLower(strings.TrimSpace(act.Config["notify"]))); err == nil {
				a.Notify = notify
			}
		case "webhook":
			d.fire(a, act.Config)
		default:
			if act.Type != "" {
				d.warnUnsupported(act.Type)
			}
		}
	}
}

// Render substitutes {host}, {user}, {rule}, {severity},
// {event_type} and {summary} in a rule message template. A missing
// user renders as "desconocido"; unknown placeholders are left
// untouched so literal text is never silently eaten.
func Render(tmpl string, in Inputs) string {
	if tmpl == "" {
		return ""
	}
	return placeholderRe.ReplaceAllStringFunc(tmpl, func(m string) string {
		switch m {
		case "{host}":
			return in.Host
		case "{user}":
			if in.User == "" {
				return "desconocido"
			}
			return in.User
		case "{rule}":
			return in.Rule
		case "{severity}":
			return in.Severity
		case "{event_type}":
			return in.EventType
		case "{summary}":
			return in.Summary
		default:
			return m
		}
	})
}

var placeholderRe = regexp.MustCompile(`\{(host|user|rule|severity|event_type|summary)\}`)

// fire dispatches one webhook delivery in the background. The payload
// is the alert's own JSON, already carrying the rendered message.
func (d *Dispatcher) fire(a *alert.Alert, cfg map[string]string) {
	rawURL := strings.TrimSpace(cfg["url"])
	u, err := url.Parse(rawURL)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		d.log.Printf("webhook: url invalida %q: accion ignorada", rawURL)
		return
	}
	timeout := defaultTimeout
	if cfg["timeout"] != "" {
		t, err := time.ParseDuration(cfg["timeout"])
		switch {
		case err != nil:
			d.log.Printf("webhook: timeout invalido %q, usando %s", cfg["timeout"], defaultTimeout)
		case t > maxTimeout:
			timeout = maxTimeout
		case t > 0:
			timeout = t
		}
	}
	payload, err := json.Marshal(a)
	if err != nil {
		d.log.Printf("webhook: serializando alerta: %v", err)
		return
	}
	secret := cfg["secret"]
	name := u.Host

	select {
	case d.sem <- struct{}{}:
	default:
		d.log.Printf("webhook %s: cola llena (%d en vuelo), entrega descartada", name, maxInFlight)
		return
	}
	go func() {
		defer func() { <-d.sem }()
		d.deliver(rawURL, secret, timeout, payload, name)
	}()
}

// deliver performs one HTTP POST and logs any failure. Receiver errors
// must never surface to the detection pipeline: a dead webhook is an
// operational problem, not a detection failure.
func (d *Dispatcher) deliver(rawURL, secret string, timeout time.Duration, payload []byte, name string) {
	req, err := http.NewRequest(http.MethodPost, rawURL, bytes.NewReader(payload))
	if err != nil {
		d.log.Printf("webhook %s: %v", name, err)
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "security-framework-engine")
	if secret != "" {
		req.Header.Set("Authorization", "Bearer "+secret)
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	resp, err := d.client.Do(req.WithContext(ctx))
	if err != nil {
		// Redact the transport wrapper: *url.Error echoes the full
		// request URL, and a rule-action URL can embed a credential in
		// its path or query. Only the cause reaches the log.
		d.log.Printf("webhook %s: entrega fallida: %v", name, redactedURLErr(err))
		return
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, resp.Body) // drain so the connection is reusable
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		d.log.Printf("webhook %s: respuesta no esperada %d", name, resp.StatusCode)
		return
	}
	d.log.Printf("webhook %s: alerta entregada (%d)", name, resp.StatusCode)
}

func (d *Dispatcher) warnUnsupported(actionType string) {
	d.mu.Lock()
	defer d.mu.Unlock()
	key := "type:" + actionType
	if !d.once[key] {
		d.once[key] = true
		d.log.Printf("accion de tipo %q no soportada por el motor: ignorada", actionType)
	}
}

// redactedURLErr strips the transport wrapper from HTTP errors so the
// request URL never reaches the log: *url.Error echoes the URL
// verbatim and a rule-action URL can embed a credential in its path
// or query. The underlying cause (deadline, refused, no such host)
// is kept — it names the failure without naming the endpoint.
func redactedURLErr(err error) error {
	var ue *url.Error
	if errors.As(err, &ue) && ue.Err != nil {
		return fmt.Errorf("destino: %w", ue.Err)
	}
	return err
}
