// Package api exposes a local read-only HTTP API on the engine: recent
// events and alerts as JSON, the live rule set, and an SSE stream for
// real-time consumers (the web console bridge). Deliberately
// dependency-free so the tracer bullet stays easy to audit.
package api

import (
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/Ruby570bocadito/security-framework/internal/alert"
	"github.com/Ruby570bocadito/security-framework/internal/correlate"
	"github.com/Ruby570bocadito/security-framework/internal/rules"
	"github.com/Ruby570bocadito/security-framework/internal/store"
	"github.com/Ruby570bocadito/security-framework/internal/suppress"
	"github.com/Ruby570bocadito/security-framework/pkg/model"
)

const (
	maxEvents      = 1000 // ring of recent events
	maxAlerts      = 256  // ring of recent alerts
	sseBuffer      = 64   // messages per slow subscriber before drops
	heartbeatEvery = 15 * time.Second
)

// Hub serves the local API and fans out live records to SSE clients.
type Hub struct {
	listener net.Listener
	srv      *http.Server
	token    string // bearer token for /api/* (empty = no auth)

	mu          sync.Mutex
	events      []*model.Event // oldest first, trimmed to maxEvents
	alerts      []alert.Alert  // oldest first, trimmed to maxAlerts
	subs        map[chan []byte]struct{}
	started     time.Time
	alertsTotal int
	bySeverity  map[string]int
	rules       *rules.Engine
	suppress    *suppress.Manager               // operator allowlist (read-only view)
	received    func() (uint64, uint64, uint64) // ingested, dropped, rejected
	webhook     func() (uint64, uint64, uint64) // sent, failed, dropped
	correlator  func() (int, int, int)          // in-flight states, loaded sequences, tracking cap
	sequences   *correlate.Manager              // kill-chain sequences (read-only view)
	store       *store.Store                    // optional SQLite persistence (nil = rings only)

	storeFails uint64 // throttles store write-error logging (atomic)
}

// New binds the API listener. Use addr ":0" in tests to pick a free port.
func New(addr string) (*Hub, error) {
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return nil, fmt.Errorf("api: listen %s: %w", addr, err)
	}
	h := &Hub{
		listener:   ln,
		subs:       make(map[chan []byte]struct{}),
		started:    time.Now(),
		bySeverity: map[string]int{},
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/stats", h.handleStats)
	mux.HandleFunc("GET /api/events", h.handleEvents)
	mux.HandleFunc("GET /api/alerts", h.handleAlerts)
	mux.HandleFunc("GET /api/rules", h.handleRules)
	mux.HandleFunc("GET /api/suppressions", h.handleSuppressions)
	mux.HandleFunc("GET /api/sequences", h.handleSequences)
	mux.HandleFunc("GET /api/stream", h.handleStream)
	mux.HandleFunc("GET /api/health", h.handleHealth)
	mux.HandleFunc("GET /api/alerts/export", h.handleAlertsExport)
	mux.HandleFunc("GET /api/events/export", h.handleEventsExport)
	h.srv = &http.Server{Handler: h.auth(mux), ReadHeaderTimeout: 5 * time.Second}
	return h, nil
}

// Addr returns the bound address (useful when listening on :0).
func (h *Hub) Addr() string { return h.listener.Addr().String() }

// SetRules points the hub at the (hot-reloading) rule engine.
func (h *Hub) SetRules(re *rules.Engine) {
	h.mu.Lock()
	h.rules = re
	h.mu.Unlock()
}

// SetSuppressions exposes the operator allowlist (read-only) through
// /api/suppressions and its live count in /api/stats.
func (h *Hub) SetSuppressions(m *suppress.Manager) {
	h.mu.Lock()
	h.suppress = m
	h.mu.Unlock()
}

// SetCounters wires the ingest counters into /api/stats: ingested
// events, dropped (malformed) lines and connections rejected by the
// ingest auth handshake (visible probes against a remote bind).
func (h *Hub) SetCounters(received func() (ingested, dropped, rejected uint64)) {
	h.mu.Lock()
	h.received = received
	h.mu.Unlock()
}

// SetToken requires "Authorization: Bearer <token>" on every /api route
// except /api/health (the liveness probe, which returns nothing but
// {"mode":"engine","status":"ok"}). Call before Run. This keeps the standard set by the
// ingest auth: a listener reachable beyond loopback must demand an
// explicit credential - the API hands out every event and alert, so an
// open port on a shared network is a silent data leak.
func (h *Hub) SetToken(token string) { h.token = token }

// auth wraps the mux with the bearer check. The comparison is
// constant-time and runs on every request (no early exits on the
// header shape), mirroring the ingest token handling. The scheme is
// matched case-insensitively (RFC 7235) and rejections carry a
// WWW-Authenticate challenge plus an actionable error body, so an
// operator hitting the 401 knows exactly which knob to set.
func (h *Hub) auth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if h.token == "" || r.URL.Path == "/api/health" {
			next.ServeHTTP(w, r)
			return
		}
		got := r.Header.Get("Authorization")
		const prefix = "Bearer "
		ok := len(got) > len(prefix) && strings.EqualFold(got[:len(prefix)], prefix) &&
			subtle.ConstantTimeCompare([]byte(got[len(prefix):]), []byte(h.token)) == 1
		if !ok {
			w.Header().Set("WWW-Authenticate", `Bearer realm="security-framework api"`)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnauthorized)
			fmt.Fprintln(w, `{"error":"unauthorized: send 'Authorization: Bearer <token>' (configure it with -api-token/SF_API_TOKEN)"}`)
			log.Printf("[API] 401 unauthorized: %s %s from %s", r.Method, r.URL.Path, r.RemoteAddr)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// SetWebhookStats wires the webhook delivery counters into /api/stats.
func (h *Hub) SetWebhookStats(stats func() (sent, failed, dropped uint64)) {
	h.mu.Lock()
	h.webhook = stats
	h.mu.Unlock()
}

// SetCorrelatorStats wires the kill-chain correlator observability into
// /api/stats: in-flight (sequence, host) states, loaded sequences and
// the tracking cap. A nil closure or no wiring at all means the
// correlator is off (reported as zeros) - the stats contract stays
// stable whether or not the engine found a sequences/ directory.
func (h *Hub) SetCorrelatorStats(fn func() (states, seqs, cap int)) {
	h.mu.Lock()
	h.correlator = fn
	h.mu.Unlock()
}

// SetSequences exposes the loaded kill-chain sequences (read-only)
// through /api/sequences. A nil manager means the correlator is off:
// the endpoint serves an empty list, mirroring the suppressions
// semantics.
func (h *Hub) SetSequences(m *correlate.Manager) {
	h.mu.Lock()
	h.sequences = m
	h.mu.Unlock()
}

// SetStore attaches the optional SQLite persistence. When set, every
// recorded event and alert is written through to the store and the
// telemetry lists and exports read the FULL history (subject to the
// operator's retention) instead of the in-memory rings. Call before Run.
func (h *Hub) SetStore(st *store.Store) {
	h.mu.Lock()
	h.store = st
	h.mu.Unlock()
}

// persistEvent writes one event to the store if attached. Failures are
// logged with a throttle (first, then every 500th) so a full disk does
// not flood the log while detection keeps running.
func (h *Hub) persistEvent(ev *model.Event) {
	h.mu.Lock()
	st := h.store
	h.mu.Unlock()
	if st == nil {
		return
	}
	if err := st.InsertEvent(ev); err != nil {
		n := atomic.AddUint64(&h.storeFails, 1)
		if n == 1 || n%500 == 0 {
			log.Printf("[API] store write FAILED (%d total): %v", n, err)
		}
	}
}

// persistAlert is persistEvent for alerts.
func (h *Hub) persistAlert(a alert.Alert) {
	h.mu.Lock()
	st := h.store
	h.mu.Unlock()
	if st == nil {
		return
	}
	if err := st.InsertAlert(a); err != nil {
		n := atomic.AddUint64(&h.storeFails, 1)
		if n == 1 || n%500 == 0 {
			log.Printf("[API] store write FAILED (%d total): %v", n, err)
		}
	}
}

// Run serves until Shutdown is called.
func (h *Hub) Run() error {
	err := h.srv.Serve(h.listener)
	if err == http.ErrServerClosed {
		return nil
	}
	return err
}

// Shutdown closes every SSE subscriber and the listener immediately.
func (h *Hub) Shutdown() {
	h.mu.Lock()
	for ch := range h.subs {
		close(ch)
	}
	h.subs = make(map[chan []byte]struct{})
	h.mu.Unlock()
	_ = h.srv.Close()
}

// RecordEvent stores an event in the ring, persists it (store attached)
// and streams it to subscribers. The store write happens BEFORE the
// fan-out: durable evidence first, live delivery second.
func (h *Hub) RecordEvent(ev *model.Event) {
	if ev == nil {
		return
	}
	h.mu.Lock()
	h.events = append(h.events, ev)
	if len(h.events) > maxEvents {
		h.events = h.events[len(h.events)-maxEvents:]
	}
	h.mu.Unlock()
	h.persistEvent(ev)
	h.broadcast("event", ev)
}

// RecordAlert stores an alert in the ring, persists it (store attached)
// and streams it to subscribers.
func (h *Hub) RecordAlert(a alert.Alert) {
	h.mu.Lock()
	h.alerts = append(h.alerts, a)
	h.alertsTotal++
	h.bySeverity[a.Severity]++
	if len(h.alerts) > maxAlerts {
		h.alerts = h.alerts[len(h.alerts)-maxAlerts:]
	}
	h.mu.Unlock()
	h.persistAlert(a)
	h.broadcast("alert", a)
}

// broadcast marshals once and ships to every subscriber; slow clients
// with a full buffer miss messages instead of blocking the engine.
func (h *Hub) broadcast(topic string, payload any) {
	data, err := json.Marshal(payload)
	if err != nil {
		return
	}
	msg := fmt.Sprintf("event: %s\ndata: %s\n\n", topic, data)
	h.mu.Lock()
	defer h.mu.Unlock()
	for ch := range h.subs {
		select {
		case ch <- []byte(msg):
		default: // subscriber too slow: drop the frame
		}
	}
}

// ------------------------------------------------------------- handlers

type statsPayload struct {
	UptimeS          int64          `json:"uptime_s"`
	EventsTotal      uint64         `json:"events_total"`
	Dropped          uint64         `json:"dropped"`
	IngestRejected   uint64         `json:"ingest_rejected"`
	EventsPerMin     int            `json:"events_per_min"`
	AlertsTotal      int            `json:"alerts_total"`
	BySeverity       map[string]int `json:"by_severity"`
	RulesCount       int            `json:"rules_count"`
	RulesTypes       []string       `json:"rules_types"`
	EventsBuffered   int            `json:"events_buffered"`
	WebhookSent      uint64         `json:"webhook_sent"`
	WebhookFailed    uint64         `json:"webhook_failed"`
	WebhookDropped   uint64         `json:"webhook_dropped"`
	Suppressions     int            `json:"suppressions_active"`
	StoreEnabled     bool           `json:"store_enabled"`
	StoreEvents      int64          `json:"store_events"`
	StoreAlerts      int64          `json:"store_alerts"`
	CorrelatorStates int            `json:"correlator_states"`
	CorrelatorSeqs   int            `json:"correlator_sequences"`
	CorrelatorCap    int            `json:"correlator_cap"`
	Mode             string         `json:"mode"`
}

func (h *Hub) handleStats(w http.ResponseWriter, _ *http.Request) {
	h.mu.Lock()
	evCount := len(h.events)
	last60 := 0
	alTotal := h.alertsTotal
	bySev := make(map[string]int, len(h.bySeverity))
	for k, v := range h.bySeverity {
		bySev[k] = v
	}
	if evCount > 0 {
		for i := evCount - 1; i >= 0; i-- {
			if time.Since(h.events[i].Timestamp) <= time.Minute {
				last60++
			} else {
				break
			}
		}
	}
	var ingested, dropped, rejected uint64
	if h.received != nil {
		ingested, dropped, rejected = h.received()
	}
	var whSent, whFailed, whDropped uint64
	if h.webhook != nil {
		whSent, whFailed, whDropped = h.webhook()
	}
	var corrStates, corrSeqs, corrCap int
	if h.correlator != nil {
		corrStates, corrSeqs, corrCap = h.correlator()
	}
	st := h.store
	storeEnabled, storeEvents, storeAlerts := false, int64(0), int64(0)
	if st != nil {
		storeEnabled = true
		storeEvents, storeAlerts = st.Counts()
	}
	rulesCount, rulesTypes := 0, []string{}
	if h.rules != nil {
		rulesCount = h.rules.Count()
		rulesTypes = h.rules.Types()
	}
	sup := h.suppress
	h.mu.Unlock()
	supActive := 0
	if sup != nil {
		supActive = sup.Count(time.Now())
	}

	writeJSON(w, statsPayload{
		UptimeS:          int64(time.Since(h.started) / time.Second),
		EventsTotal:      ingested,
		Dropped:          dropped,
		IngestRejected:   rejected,
		EventsPerMin:     last60,
		AlertsTotal:      alTotal,
		BySeverity:       bySev,
		RulesCount:       rulesCount,
		RulesTypes:       rulesTypes,
		EventsBuffered:   evCount,
		WebhookSent:      whSent,
		WebhookFailed:    whFailed,
		WebhookDropped:   whDropped,
		Suppressions:     supActive,
		StoreEnabled:     storeEnabled,
		StoreEvents:      storeEvents,
		StoreAlerts:      storeAlerts,
		CorrelatorStates: corrStates,
		CorrelatorSeqs:   corrSeqs,
		CorrelatorCap:    corrCap,
		Mode:             "engine",
	})
}

func (h *Hub) handleEvents(w http.ResponseWriter, r *http.Request) {
	limit := limitFrom(r, 200)
	f, ok := parseRecordFilter(w, r)
	if !ok {
		return // 400 already written
	}
	h.mu.Lock()
	st := h.store
	h.mu.Unlock()
	if st != nil {
		// store attached: serve the FULL history (retention
		// applies), same filters, newest first
		out, err := st.QueryEvents(store.EventQuery{
			Host: f.host, Type: f.evType, Q: f.q,
			Since: f.since, Until: f.until, Limit: limit,
		})
		if err != nil {
			http.Error(w, "store query failed: "+err.Error(), http.StatusInternalServerError)
			return
		}
		if out == nil {
			out = []*model.Event{}
		}
		writeJSON(w, out)
		return
	}
	out := make([]*model.Event, 0, limit)
	for i := len(h.events) - 1; i >= 0 && len(out) < limit; i-- {
		if f.matchEvent(h.events[i]) {
			out = append(out, h.events[i])
		}
	}
	writeJSON(w, out)
}

func (h *Hub) handleAlerts(w http.ResponseWriter, r *http.Request) {
	limit := limitFrom(r, 100)
	f, ok := parseRecordFilter(w, r)
	if !ok {
		return // 400 already written
	}
	h.mu.Lock()
	st := h.store
	h.mu.Unlock()
	if st != nil {
		out, err := st.QueryAlerts(store.AlertQuery{
			Host: f.host, Severities: f.sevs, RuleID: f.ruleID, Q: f.q,
			Since: f.since, Until: f.until, Limit: limit,
		})
		if err != nil {
			http.Error(w, "store query failed: "+err.Error(), http.StatusInternalServerError)
			return
		}
		if out == nil {
			out = []alert.Alert{}
		}
		writeJSON(w, out)
		return
	}
	out := make([]alert.Alert, 0, limit)
	for i := len(h.alerts) - 1; i >= 0 && len(out) < limit; i-- {
		a := h.alerts[i]
		if ts, err := time.Parse(time.RFC3339Nano, a.Timestamp); err == nil && f.matchAlert(a, ts) {
			out = append(out, a)
		}
	}
	writeJSON(w, out)
}

type conditionPayload struct {
	Field    string `json:"field"`
	Operator string `json:"operator"`
	Value    any    `json:"value"`
}

type rulePayload struct {
	ID          string             `json:"id"`
	Name        string             `json:"name"`
	Description string             `json:"description"`
	Severity    string             `json:"severity"`
	EventType   string             `json:"event_type"`
	Mitre       string             `json:"mitre"`
	Tactic      string             `json:"tactic"`
	Tags        []string           `json:"tags"`
	Conditions  []conditionPayload `json:"conditions"`
}

func (h *Hub) handleRules(w http.ResponseWriter, _ *http.Request) {
	h.mu.Lock()
	re := h.rules
	h.mu.Unlock()
	out := []rulePayload{}
	if re != nil {
		for _, r := range re.Snapshot() {
			mitre, tactic := mitreAndTactic(r.Tags)
			conds := make([]conditionPayload, 0, len(r.Conditions))
			for _, c := range r.Conditions {
				conds = append(conds, conditionPayload{Field: c.Field, Operator: c.Operator, Value: c.Value})
			}
			out = append(out, rulePayload{
				ID: r.ID, Name: r.Name, Description: r.Description,
				Severity: r.Severity, EventType: r.EventType,
				Mitre: mitre, Tactic: tactic, Tags: r.Tags, Conditions: conds,
			})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	writeJSON(w, out)
}

// handleSuppressions lists the operator allowlist as it stands right
// now (expired entries excluded). Read-only: entries are edited in the
// suppressions.yaml file and hot-reloaded by the engine.
func (h *Hub) handleSuppressions(w http.ResponseWriter, _ *http.Request) {
	h.mu.Lock()
	sup := h.suppress
	h.mu.Unlock()
	if sup == nil {
		writeJSON(w, suppressPayload{Entries: []suppress.Entry{}})
		return
	}
	now := time.Now()
	writeJSON(w, suppressPayload{
		Active:  sup.Count(now),
		Entries: sup.Snapshot(now),
	})
}

type suppressPayload struct {
	Active  int              `json:"active"`
	Entries []suppress.Entry `json:"entries"`
}

type sequencePayload struct {
	ID            string   `json:"id"`
	Name          string   `json:"name"`
	Description   string   `json:"description"`
	Severity      string   `json:"severity"`
	WindowSeconds int      `json:"window_seconds"`
	Tags          []string `json:"tags"`
	Steps         []string `json:"steps"`
}

// handleSequences lists the kill-chain sequences as loaded right now
// (hot-reload aware, sorted by id). Read-only: sequences are edited in
// the sequences/ YAML files the engine hot-reloads every 15 s. A nil
// manager (no sequences/ directory) yields an empty list so consumers
// see "correlator off" instead of a 404.
func (h *Hub) handleSequences(w http.ResponseWriter, _ *http.Request) {
	h.mu.Lock()
	m := h.sequences
	h.mu.Unlock()
	out := []sequencePayload{}
	if m != nil {
		for _, s := range m.Snapshot() {
			out = append(out, sequencePayload{
				ID: s.ID, Name: s.Name, Description: s.Description,
				Severity: s.Severity, WindowSeconds: s.WindowSeconds,
				Tags: s.Tags, Steps: s.Steps,
			})
		}
	}
	writeJSON(w, out)
}

func (h *Hub) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, map[string]string{"status": "ok", "mode": "engine"})
}

// handleStream keeps an SSE connection open pushing live events/alerts.
func (h *Hub) handleStream(w http.ResponseWriter, r *http.Request) {
	fl, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}
	ch := make(chan []byte, sseBuffer)
	h.mu.Lock()
	h.subs[ch] = struct{}{}
	h.mu.Unlock()
	defer func() {
		h.mu.Lock()
		if _, ok := h.subs[ch]; ok {
			delete(h.subs, ch)
			close(ch)
		}
		h.mu.Unlock()
	}()

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	fmt.Fprint(w, "retry: 2000\n\n")
	fl.Flush()

	hb := time.NewTicker(heartbeatEvery)
	defer hb.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-hb.C:
			if _, err := fmt.Fprint(w, ": hb\n\n"); err != nil {
				return
			}
			fl.Flush()
		case msg, ok := <-ch:
			if !ok {
				return
			}
			if _, err := w.Write(msg); err != nil {
				return
			}
			fl.Flush()
		}
	}
}

// ------------------------------------------------------------- helpers

func limitFrom(r *http.Request, def int) int {
	q := r.URL.Query().Get("limit")
	if q == "" {
		return def
	}
	n := 0
	for _, c := range q {
		if c < '0' || c > '9' {
			return def
		}
		n = n*10 + int(c-'0')
		if n > maxEvents {
			return maxEvents
		}
	}
	if n <= 0 {
		return def
	}
	return n
}

// mitreAndTactic derives the console fields from the rule tags:
// "attack.t1003.001" -> "T1003.001", "attack.credential-access" ->
// "Credential Access".
func mitreAndTactic(tags []string) (string, string) {
	mitre, tactic := "", ""
	for _, t := range tags {
		if strings.HasPrefix(t, "attack.t") {
			mitre = strings.ToUpper(t[len("attack."):len("attack.")+1]) + t[len("attack.")+1:]
			continue
		}
		if tactic == "" && strings.HasPrefix(t, "attack.") {
			parts := strings.Split(strings.TrimPrefix(t, "attack."), "-")
			for i, p := range parts {
				if p != "" {
					parts[i] = strings.ToUpper(p[:1]) + p[1:]
				}
			}
			tactic = strings.Join(parts, " ")
		}
	}
	return mitre, tactic
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	enc := json.NewEncoder(w)
	if err := enc.Encode(v); err != nil {
		log.Printf("api: encode: %v", err)
	}
}
