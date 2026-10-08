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
	"strconv"
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
	dedupHardMax = 65536 // hard cap: beyond this, alerts skip dedup
)

// SimulationTag marks synthetic, inert detection-validation telemetry
// (the scenario library, SIM-1). Every alert derived from an event
// carrying this tag — a rule hit, a kill-chain completion, a beacon,
// a threshold, an intel match or a baseline novelty — is tagged in
// turn, so a validation replay can never be mistaken for real
// evidence on any surface that shows alerts (console, API, webhook).
const SimulationTag = "simulation"

// EventIsSimulated reports whether the event carries SimulationTag.
func EventIsSimulated(ev *model.Event) bool {
	if ev == nil {
		return false
	}
	for _, t := range ev.Tags {
		if t == SimulationTag {
			return true
		}
	}
	return false
}

// MarkSimulated appends SimulationTag to the alert unless it is
// already there. The incoming slice is never grown in place: rule and
// sequence Tags are shared, loaded-once slices owned by the catalog,
// so appending to them could corrupt every later alert built from the
// same rule.
func MarkSimulated(a *Alert) {
	for _, t := range a.Tags {
		if t == SimulationTag {
			return
		}
	}
	tags := make([]string, 0, len(a.Tags)+1)
	tags = append(tags, a.Tags...)
	a.Tags = append(tags, SimulationTag)
}

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
	mu   sync.Mutex
	seen map[string]time.Time
	// order holds the keys of seen in insertion order. Every key gets
	// the same TTL, so insertion order IS expiry order: Raise pops the
	// expired prefix in amortized O(1) instead of scanning the whole
	// map under the lock (the old opportunistic sweep cost ~2 ms per
	// alert with 60k live keys and stalled the single detection loop).
	order   []dedupEntry
	head    int // first live index of order
	out     io.Writer
	colored bool
	onAlert func(Alert)                  // optional observer (local API, SIEM taps)
	prepare func(*Alert, []rules.Action) // optional rule-action executor
	latFn   func(time.Duration)          // optional ingest→alert latency observer (SET-3)
}

// dedupEntry is one remembered key and the instant it was stored.
type dedupEntry struct {
	key string
	at  time.Time
}

// Alert is the structured JSON payload emitted for downstream
// consumers (SIEM connectors, the web console, webhooks).
type Alert struct {
	// ID is the unique alert identifier, assigned by the engine at
	// raise/emit time. It is the lifecycle key: operators acknowledge
	// or close an alert by this id (POST /api/alerts/{id}/status), so
	// it must stay stable across every surface that repeats the alert
	// (JSON log line, webhook, SSE, API ring).
	ID         string            `json:"id"`
	Timestamp  string            `json:"timestamp"`
	RuleID     string            `json:"rule_id"`
	RuleName   string            `json:"rule_name"`
	Severity   string            `json:"severity"`
	Host       string            `json:"host"`
	User       string            `json:"user,omitempty"`
	EventID    string            `json:"event_id"`
	EventType  string            `json:"event_type"`
	Source     string            `json:"source,omitempty"`
	Attributes map[string]string `json:"attributes,omitempty"`
	Network    *model.Network    `json:"network,omitempty"`
	Summary    string            `json:"summary"`
	Message    string            `json:"message,omitempty"` // rendered from the rule's alert action, if any
	Notify     bool              `json:"notify,omitempty"`  // rule asks for external notification
	MatchedOn  []string          `json:"matched_on"`
	Tags       []string          `json:"tags,omitempty"`
	Actions    []string          `json:"actions,omitempty"`
	Enrich     map[string]string `json:"enrichment,omitempty"`
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

// SetLatencyObserver wires the ingest→alert latency observer (SET-3):
// called once per RAISED alert (deduplicated hits observe nothing)
// with the delta between the event's sensor-side timestamp and the
// raise. Nil (the default) keeps Raise allocation-free.
func (m *Manager) SetLatencyObserver(fn func(time.Duration)) {
	m.mu.Lock()
	m.latFn = fn
	m.mu.Unlock()
}

// expireLocked forgets every key whose TTL has elapsed. The queue is
// ordered by insertion time, so the loop stops at the first live
// entry: the cost is proportional to the keys that actually expired,
// never to the size of the map. Caller holds mu.
func (m *Manager) expireLocked(now time.Time) {
	for m.head < len(m.order) {
		e := m.order[m.head]
		if now.Sub(e.at) < dedupTTL {
			break
		}
		delete(m.seen, e.key)
		m.order[m.head] = dedupEntry{} // release the key string
		m.head++
	}
	// compact once the dead prefix dominates, so the backing array
	// does not keep growing under a steady stream of unique keys
	if m.head > 1024 && m.head*2 > len(m.order) {
		n := copy(m.order, m.order[m.head:])
		clear(m.order[n:])
		m.order = m.order[:n]
		m.head = 0
	}
}

// Raise processes one hit; duplicate hits for the same rule/host/event
// triple inside the TTL window are silently dropped.
func (m *Manager) Raise(ev *model.Event, hit rules.Hit) {
	// Concatenación directa (sesión 100agentes-2, agente 24): Sprintf
	// por hit antes del lock era parseo de formato + interface boxing
	// en el camino caliente de cada alerta.
	key := hit.Rule.ID + "|" + ev.Host + "|" + strconv.Itoa(pidOf(ev))
	// Imported observations have no reliable process identity. Preserve
	// distinct mail, IDS and query records while deduplicating exact replays.
	if ev.Attributes["observer_host"] != "" {
		key = hit.Rule.ID + "|" + ev.Host + "|" + ev.Source + "|" + ev.ID
	} else if pidOf(ev) == 0 {
		// No process identity either: dedup by the event itself so
		// distinct occurrences (N run keys, N destinations) each raise
		// while an exact replay of the same event stays silenced.
		key = fmt.Sprintf("%s|%s|%s|%s", hit.Rule.ID, ev.Host, ev.Type, ev.ID)
	}
	m.mu.Lock()
	// read the clock under mu: concurrent Raise calls then append to
	// order in non-decreasing time, which expireLocked relies on
	now := time.Now()
	m.expireLocked(now)
	if _, ok := m.seen[key]; ok {
		// expireLocked ran first: every key still present is live
		m.mu.Unlock()
		return
	}
	// hard cap: a flood of unique keys (e.g. fake hosts injected by
	// an untrusted feed) must not grow the map without bound. Past
	// the cap, stop remembering new keys but keep raising alerts:
	// visibility wins over deduplication.
	if len(m.seen) < dedupHardMax {
		m.seen[key] = now
		m.order = append(m.order, dedupEntry{key: key, at: now})
	}
	// capture prepare under mu: SetPreparer writes it under the same
	// lock, and reading it after Unlock is a data race on the field
	// even when the current wiring happens to call SetPreparer before
	// the ingest starts (races are about contracts, not luck).
	prepare := m.prepare
	latFn := m.latFn
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
	// Ingest→alert latency (SET-3): the elapsed time between the
	// event's own sensor-side timestamp and the raise. Negative deltas
	// (a clock far ahead on the sensor) are skipped, never clamped:
	// clamping would fabricate zero-latency alerts and flatter the
	// metric. Deduplicated hits raise nothing and observe nothing.
	if latFn != nil && !ev.Timestamp.IsZero() {
		if d := time.Since(ev.Timestamp); d >= 0 {
			latFn(d)
		}
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
	a := Alert{
		Timestamp:  time.Now().UTC().Format(time.RFC3339Nano),
		RuleID:     hit.Rule.ID,
		RuleName:   hit.Rule.Name,
		Severity:   hit.Rule.Severity,
		Host:       ev.Host,
		User:       ev.User,
		EventID:    ev.ID,
		EventType:  ev.Type,
		Source:     ev.Source,
		Attributes: ev.Attributes,
		Network:    ev.Network,
		Summary:    summarize(ev),
		MatchedOn:  hit.MatchedOn,
		Tags:       hit.Rule.Tags,
		Actions:    actions,
		Enrich:     ev.Enrichment,
	}
	if EventIsSimulated(ev) {
		MarkSimulated(&a)
	}
	return a
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
	var observation string
	switch ev.Type {
	case model.TypeNetworkAlert:
		observation = fmt.Sprintf("IDS %s (prioridad=%s, firma=%s, veredicto=%s)", ev.Attributes["ids_signature"], ev.Attributes["ids_priority"], ev.Attributes["ids_action"], ev.Attributes["ids_verdict"])
	case model.TypeHostQuery:
		observation = fmt.Sprintf("osquery %s: %s", ev.Attributes["query_name"], ev.Attributes["query_action"])
	case model.TypeHoneypotConnect, model.TypeHoneypotLogin, model.TypeHoneypotCommand:
		observation = fmt.Sprintf("Cowrie %s %s", ev.Attributes["honeypot_event"], ev.Attributes["honeypot_input"])
	case model.TypeNetworkFirewall:
		observation = "Firewall: " + ev.Attributes["firewall_action"] + " " + ev.Attributes["firewall_direction"]
		if ev.Network != nil {
			observation += fmt.Sprintf(" %s -> %s:%d", ev.Network.SourceIP, ev.Network.DestinationIP, ev.Network.DestinationPort)
		}
	case model.TypeEmailMessage:
		observation = fmt.Sprintf("Correo: %s (de %s)", ev.Attributes["mail_subject"], ev.Attributes["mail_from"])
	}
	if observation != "" {
		return truncateRunes(observation, 240)
	}
	if ev.Process != nil {
		s := ev.Process.Name
		if ev.Process.CommandLine != "" {
			if utf8.RuneCountInString(ev.Process.CommandLine) > 80 {
				s += " " + truncateRunes(ev.Process.CommandLine, 80) + "..."
			} else {
				s += " " + ev.Process.CommandLine
			}
		}
		// Truncate like every other branch (sesión 100agentes-2,
		// agentes 9+24, P2): Process.Name is attacker-controlled
		// and traveled VERBATIM as Alert.Summary into the ring,
		// SSE, SQLite, webhook and SOC reports — up to ~1 MiB per
		// alert from a hostile feed.
		return truncateRunes(s, 240)
	}
	if ev.File != nil {
		// Same cap for file paths (previously unbounded).
		return truncateRunes(ev.File.Path, 240)
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
	// Early exit by byte length (sesión 100agentes-2, agente 24):
	// len(s) is an upper bound of the rune count, so a short string
	// never needs the []rune allocation — summarize of an 8 KiB
	// command line used to allocate ~32 KB per alert.
	if len(s) <= max {
		return s
	}
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
