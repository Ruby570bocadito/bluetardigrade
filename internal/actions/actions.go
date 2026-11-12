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
//     queue (most severe first) so a slow receiver can never stall
//     ingestion.
//
// Webhook delivery is asynchronous by design: rendering must happen
// before the alert is written (so the JSON log line carries the
// rendered message), but the HTTP round trip runs in the background
// with strict concurrency limits and failure logging. Unknown action
// types are logged once and ignored; they never break the pipeline.
//
// Trust model (SSRF review of the action surface): action
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
	"io"
	"log"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/alert"
	"github.com/Ruby570bocadito/bluetardigrade/internal/redact"
	"github.com/Ruby570bocadito/bluetardigrade/internal/rules"
)

const (
	maxInFlight    = 8                // webhooks delivered concurrently
	maxQueued      = 64               // deliveries waiting for a free slot
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
	log    *log.Logger

	// Delivery queue. With every slot busy a delivery waits here
	// instead of being dropped; when the queue is full too, the lowest
	// severity goes first, so a burst of low alerts against a slow
	// receiver cannot cost the critical one that follows it.
	qmu      sync.Mutex
	inFlight int
	queue    []delivery
	dropped  uint64
}

// delivery is one webhook POST waiting for, or holding, a slot.
type delivery struct {
	rawURL  string
	secret  string
	timeout time.Duration
	payload []byte
	name    string
	rank    int // severity rank, higher delivers first
}

// severityRank orders deliveries; an unknown severity ranks lowest.
func severityRank(sev string) int {
	switch sev {
	case rules.SevCritical:
		return 4
	case rules.SevHigh:
		return 3
	case rules.SevMedium:
		return 2
	case rules.SevLow:
		return 1
	}
	return 0
}

// Dropped reports how many webhook deliveries were discarded because
// the queue was full (since start).
func (d *Dispatcher) Dropped() uint64 {
	d.qmu.Lock()
	defer d.qmu.Unlock()
	return d.dropped
}

// enqueue hands a delivery to a free slot or parks it in the bounded
// queue. A full queue evicts its lowest-severity entry (the oldest of
// them) for a more severe newcomer; otherwise the newcomer is the one
// dropped.
func (d *Dispatcher) enqueue(j delivery) {
	d.qmu.Lock()
	if d.inFlight < maxInFlight {
		d.inFlight++
		d.qmu.Unlock()
		go d.run(j)
		return
	}
	lost := j
	if len(d.queue) < maxQueued {
		d.queue = append(d.queue, j)
		d.qmu.Unlock()
		return
	}
	low := 0
	for i, q := range d.queue {
		if q.rank < d.queue[low].rank {
			low = i
		}
	}
	if d.queue[low].rank < j.rank {
		lost = d.queue[low]
		d.queue = append(append(d.queue[:low:low], d.queue[low+1:]...), j)
	}
	d.dropped++
	n := d.dropped
	d.qmu.Unlock()
	d.log.Printf("webhook %s: cola llena (%d en vuelo, %d en espera), entrega descartada (%d en total)",
		lost.name, maxInFlight, maxQueued, n)
}

// run delivers j and then keeps draining the queue, most severe first
// (arrival order within one severity), until it is empty.
func (d *Dispatcher) run(j delivery) {
	for {
		d.deliver(j.rawURL, j.secret, j.timeout, j.payload, j.name)
		d.qmu.Lock()
		if len(d.queue) == 0 {
			d.inFlight--
			d.qmu.Unlock()
			return
		}
		best := 0
		for i, q := range d.queue {
			if q.rank > d.queue[best].rank {
				best = i
			}
		}
		j = d.queue[best]
		d.queue = append(d.queue[:best], d.queue[best+1:]...)
		d.qmu.Unlock()
	}
}

// New creates a Dispatcher. logf receives delivery diagnostics; pass
// nil to discard them.
func New(logf *log.Logger) *Dispatcher {
	if logf == nil {
		logf = log.New(io.Discard, "", 0)
	}
	return &Dispatcher{
		once: map[string]bool{},
		// No transparent redirects: a 3xx from the receiver would
		// re-POST the alert payload (command lines, users, hashes) to
		// whatever host the redirect names. Go already drops the
		// Authorization header cross-host, but the forensic body has no
		// such protection — hand the redirect back to the caller as a
		// response instead of following it.
		client: &http.Client{CheckRedirect: func(req *http.Request, via []*http.Request) error {
			return http.ErrUseLastResponse
		}},
		log: logf,
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
		// The raw URL itself is the credential (the hook IS the
		// credential): the invalid-input log carries the scheme://host
		// label only (#35 sub-item, same redaction rule as every
		// transport log in this package). Parse failures degrade to
		// the <endpoint> placeholder.
		d.log.Printf("webhook: url invalida (%s): accion ignorada", redact.EndpointLabel(rawURL))
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

	d.enqueue(delivery{rawURL: rawURL, secret: secret, timeout: timeout, payload: payload,
		name: name, rank: severityRank(a.Severity)})
}

// deliver performs one HTTP POST and logs any failure. Receiver errors
// must never surface to the detection pipeline: a dead webhook is an
// operational problem, not a detection failure.
func (d *Dispatcher) deliver(rawURL, secret string, timeout time.Duration, payload []byte, name string) {
	req, err := http.NewRequest(http.MethodPost, rawURL, bytes.NewReader(payload))
	if err != nil {
		// Redaction via internal/redact (since #35 promoted the helper;
		// #34 fixed this build branch the same day): a raw *url.Error
		// echoes the full URL verbatim and a rule-action URL can embed a
		// credential in its path or query.
		d.log.Printf("webhook %s: %v", name, redact.URLErr(err, "destino"))
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "bluetardigrade-engine")
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
		d.log.Printf("webhook %s: entrega fallida: %v", name, redact.URLErr(err, "destino"))
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

// redactedURLErr moved to internal/redact.URLErr (#35): the fourth
// copy of the helper (notify's) triggered the promotion its own rule
// declared. The "destino" label travels as the caller's argument, so
// the log output is byte-identical.
