// Package alert renders rule hits as console alerts with a structured
// JSON log line, deduplicating noisy matches within a TTL window.
package alert

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/Ruby570bocadito/bluetardigrade/internal/redact"
	"github.com/Ruby570bocadito/bluetardigrade/internal/rules"
	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
)

const (
	dedupTTL     = 60 * time.Second
	dedupSoftMax = 4096  // above this, purge expired keys opportunistically
	dedupHardMax = 65536 // hard cap: beyond this, alerts skip dedup
)

// ANSI colors (disabled automatically when stdout is not a terminal).
const (
	cReset = "\033[0m"
	cBold  = "\033[1m"
	cRed   = "\033[31m"
	cMag   = "\033[35m"
	cYel   = "\033[33m"
	cCyan  = "\033[36m"
	cGrey  = "\033[90m"
)

// Manager raises alerts for rule hits.
type Manager struct {
	mu      sync.Mutex
	seen    map[string]time.Time
	out     io.Writer
	colored bool
	onAlert func(Alert)                  // optional observer (local API, SIEM taps)
	prepare func(*Alert, []rules.Action) // optional rule-action executor
}

// Alert is the structured JSON payload emitted for downstream
// consumers (SIEM connectors, the web console, webhooks).
type Alert struct {
	// ID is the unique alert identifier, assigned by the engine at
	// raise/emit time. It is the lifecycle key: operators acknowledge
	// or close an alert by this id (POST /api/alerts/{id}/status), so
	// it must stay stable across every surface that repeats the alert
	// (JSON log line, webhook, SSE, API ring).
	ID        string            `json:"id"`
	Timestamp string            `json:"timestamp"`
	RuleID    string            `json:"rule_id"`
	RuleName  string            `json:"rule_name"`
	Severity  string            `json:"severity"`
	Host      string            `json:"host"`
	User      string            `json:"user,omitempty"`
	EventID   string            `json:"event_id"`
	EventType string            `json:"event_type"`
	Summary   string            `json:"summary"`
	Message   string            `json:"message,omitempty"` // rendered from the rule's alert action, if any
	Notify    bool              `json:"notify,omitempty"`  // rule asks for external notification
	MatchedOn []string          `json:"matched_on"`
	Tags      []string          `json:"tags,omitempty"`
	Actions   []string          `json:"actions,omitempty"`
	Enrich    map[string]string `json:"enrichment,omitempty"`
}

// New creates a Manager writing human alerts to out. onAlert, when
// non-nil, is invoked once per raised (non-deduplicated) alert.
func New(out io.Writer, onAlert func(Alert)) *Manager {
	return &Manager{
		seen:    map[string]time.Time{},
		out:     out,
		colored: isTerminal(),
		onAlert: onAlert,
	}
}

// NewID returns a fresh 16-hex-character alert identifier from the
// cryptographic random source (8 bytes = 64 bits: collision odds are
// negligible at alert volumes, and the short charset keeps the id
// comfortable in URLs, CSV columns and console chips).
func NewID() string {
	var b [8]byte
	if _, err := rand.Read(b[:]); err != nil {
		// crypto/rand failing means the system entropy source is broken:
		// fall back to a timestamp-derived id rather than emitting an
		// empty one (lifecycle lookups would silently collide).
		return fmt.Sprintf("%016x", time.Now().UnixNano())
	}
	return hex.EncodeToString(b[:])
}

// SetPreparer wires an executor for the actions declared by the rule
// that fired (message rendering, webhooks). It is invoked on every
// raised alert after the alert is built and before it is written, so
// the rendered message ships inside the JSON payload. Raise uses the
// firing rule's actions; Emit passes none (sequences declare no
// actions).
func (m *Manager) SetPreparer(prepare func(*Alert, []rules.Action)) {
	m.mu.Lock()
	m.prepare = prepare
	m.mu.Unlock()
}

// Raise processes one hit; duplicate hits for the same rule/host/event
// triple inside the TTL window are silently dropped.
func (m *Manager) Raise(ev *model.Event, hit rules.Hit) {
	key := fmt.Sprintf("%s|%s|%d", hit.Rule.ID, ev.Host, pidOf(ev))
	m.mu.Lock()
	if t, ok := m.seen[key]; ok && time.Since(t) < dedupTTL {
		m.mu.Unlock()
		return
	}
	// opportunistic cleanup
	if len(m.seen) > dedupSoftMax {
		for k, t := range m.seen {
			if time.Since(t) > dedupTTL {
				delete(m.seen, k)
			}
		}
	}
	// hard cap: a flood of unique keys (e.g. fake hosts injected by
	// an untrusted feed) must not grow the map without bound. Past
	// the cap, stop remembering new keys but keep raising alerts:
	// visibility wins over deduplication.
	if len(m.seen) < dedupHardMax {
		m.seen[key] = time.Now()
	}
	// capture prepare under mu: SetPreparer writes it under the same
	// lock, and reading it after Unlock is a data race on the field
	// even when the current wiring happens to call SetPreparer before
	// the ingest starts (races are about contracts, not luck).
	prepare := m.prepare
	m.mu.Unlock()

	a := buildAlert(ev, hit)
	if a.ID == "" {
		a.ID = NewID()
	}
	if prepare != nil {
		prepare(&a, hit.Rule.Actions)
	}
	m.writeConsole(a)
	m.writeJSON(a)
	if m.onAlert != nil {
		m.onAlert(a)
	}
}

// Emit publishes an already-built alert (e.g. one produced by the
// sequence correlator) through the same console/JSON/observer
// pipeline as Raise, without deduplication: completions are
// inherently rate-limited by their own re-arm semantics.
func (m *Manager) Emit(a Alert) {
	if a.ID == "" {
		a.ID = NewID()
	}
	m.mu.Lock()
	prepare := m.prepare
	m.mu.Unlock()
	if prepare != nil {
		prepare(&a, nil)
	}
	m.writeConsole(a)
	m.writeJSON(a)
	if m.onAlert != nil {
		m.onAlert(a)
	}
}

func buildAlert(ev *model.Event, hit rules.Hit) Alert {
	actions := make([]string, 0, len(hit.Rule.Actions))
	for _, ac := range hit.Rule.Actions {
		actions = append(actions, ac.Type)
	}
	return Alert{
		Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
		RuleID:    hit.Rule.ID,
		RuleName:  hit.Rule.Name,
		Severity:  hit.Rule.Severity,
		Host:      ev.Host,
		User:      ev.User,
		EventID:   ev.ID,
		EventType: ev.Type,
		Summary:   summarize(ev),
		MatchedOn: hit.MatchedOn,
		Tags:      hit.Rule.Tags,
		Actions:   actions,
		Enrich:    ev.Enrichment,
	}
}

func (m *Manager) writeConsole(a Alert) {
	// Only the display copy is sanitized; writeJSON and every observer
	// retain the original forensic evidence.
	a.Severity = redact.TerminalText(a.Severity)
	a.RuleID = redact.TerminalText(a.RuleID)
	a.Summary = redact.TerminalText(a.Summary)
	a.Host = redact.TerminalText(a.Host)
	color, colorName := severityColor(a.Severity)
	b := &strings.Builder{}
	if m.colored {
		fmt.Fprintf(b, "%s[ALERT]%s %s%-8s%s %s %s %s\n",
			colorName, cReset, color, strings.ToUpper(a.Severity), cReset,
			cGrey+a.RuleID+cReset, a.Summary, cGrey+"host="+a.Host+cReset)
	} else {
		fmt.Fprintf(b, "[ALERT] %-8s %s %s host=%s\n",
			strings.ToUpper(a.Severity), a.RuleID, a.Summary, a.Host)
	}
	fmt.Fprint(m.out, b.String())
}

func (m *Manager) writeJSON(a Alert) {
	payload, err := json.Marshal(a)
	if err != nil {
		return
	}
	fmt.Fprintf(m.out, "%s\n", payload)
}

func summarize(ev *model.Event) string {
	if ev.Process != nil {
		s := ev.Process.Name
		if ev.Process.CommandLine != "" {
			if utf8.RuneCountInString(ev.Process.CommandLine) > 80 {
				s += " " + truncateRunes(ev.Process.CommandLine, 80) + "..."
			} else {
				s += " " + ev.Process.CommandLine
			}
		}
		return s
	}
	if ev.File != nil {
		return ev.File.Path
	}
	if ev.Network != nil {
		return fmt.Sprintf("%s -> %s:%d", ev.Network.Protocol,
			ev.Network.DestinationIP, ev.Network.DestinationPort)
	}
	return ev.Type
}

func pidOf(ev *model.Event) int {
	if ev.Process != nil {
		return ev.Process.PID
	}
	return 0
}

// truncateRunes cuts s to at most max runes without splitting a
// multi-byte UTF-8 sequence: byte slicing would corrupt command lines
// containing accented or non-Latin characters.
func truncateRunes(s string, max int) string {
	r := []rune(s)
	if len(r) <= max {
		return s
	}
	return string(r[:max])
}

func severityColor(sev string) (string, string) {
	switch sev {
	case rules.SevCritical:
		return cMag, cBold + cMag
	case rules.SevHigh:
		return cRed, cBold + cRed
	case rules.SevMedium:
		return cYel, cYel
	case rules.SevLow:
		return cCyan, cCyan
	default:
		return cGrey, cGrey
	}
}

func isTerminal() bool {
	if os.Getenv("NO_COLOR") != "" {
		return false
	}
	fi, err := os.Stdout.Stat()
	if err != nil {
		return false
	}
	return fi.Mode()&os.ModeCharDevice != 0
}
