// Package api exposes the local HTTP API on the engine: recent events
// and alerts as JSON, the live rule set, an SSE stream for real-time
// consumers (the web console bridge) and the write surfaces — the
// operator triage endpoint POST /api/alerts/{id}/status backed by
// internal/lifecycle, and the opt-in suppressions write of
// suppress_write.go. Deliberately dependency-free so the tracer
// bullet stays easy to audit.
package api

import (
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/alert"
	"github.com/Ruby570bocadito/bluetardigrade/internal/correlate"
	"github.com/Ruby570bocadito/bluetardigrade/internal/forensic"
	"github.com/Ruby570bocadito/bluetardigrade/internal/lifecycle"
	"github.com/Ruby570bocadito/bluetardigrade/internal/notify"
	"github.com/Ruby570bocadito/bluetardigrade/internal/respond"
	"github.com/Ruby570bocadito/bluetardigrade/internal/risk"
	"github.com/Ruby570bocadito/bluetardigrade/internal/rules"
	"github.com/Ruby570bocadito/bluetardigrade/internal/store"
	"github.com/Ruby570bocadito/bluetardigrade/internal/suppress"
	"github.com/Ruby570bocadito/bluetardigrade/internal/tlsutil"
	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
)

const (
	maxEvents      = 1000 // ring of recent events
	maxAlerts      = 256  // ring of recent alerts
	sseBuffer      = 64   // messages per slow subscriber before drops
	heartbeatEvery = 15 * time.Second
	maxSSEClients  = 64 // concurrent SSE subscribers before refusal

	// 401 brute-force throttle: failures are counted per remote
	// address in a fixed window; past the budget the address gets
	// 429s for the rest of the window instead of more comparisons.
	authFailBudget = 30
	authFailWindow = time.Minute
	// authFailMaxAddrs hard-caps the throttle map: the stale-entry
	// trim only frees addresses whose window ended, so a client
	// rotating source addresses (an IPv6 /64 is plenty) could grow it
	// without bound inside one window.
	authFailMaxAddrs = 4096
)

// Hub serves the local API and fans out live records to SSE clients.
type Hub struct {
	listener net.Listener
	srv      *http.Server
	token    string            // bearer token for /api/* (empty = no auth)
	tls      bool              // true when the listener is TLS-wrapped
	reloader *tlsutil.Reloader // hot-rotation state; nil on plain listeners

	authMu    sync.Mutex              // guards authFails
	authFails map[string]*authFailBox // per-RemoteAddr 401 throttle

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
	identities  func() (int, uint64)            // per-sensor ingest identities, host-binding violations
	webhook     func() (uint64, uint64, uint64) // sent, failed, dropped
	notify      func() []notify.ChannelStats    // per-channel delivery counters (C2)
	elastic     func() (uint64, uint64, uint64) // Elasticsearch sink: sent, failed, dropped
	splunk      func() (uint64, uint64, uint64) // Splunk HEC sink: sent, failed, dropped
	correlator  func() (int, int, int)          // in-flight states, loaded sequences, tracking cap
	sequences   *correlate.Manager              // kill-chain sequences (read-only view)
	store       *store.Store                    // optional SQLite persistence (nil = rings only)
	lifecycle   *lifecycle.Store                // alert triage state (status overlay)
	risk        *risk.Tracker                   // per-host decayed risk score (A1)
	beacon      func() (int, int, uint64)       // live beacon keys, cap, fired (A3)
	threshold   func() (int, int, uint64)       // defs, live keys, fired (A2)

	storeFails uint64 // cumulative failed event/alert writes, also throttles logging (atomic)

	// suppression write surface (armed only with -api-write; see
	// suppress_write.go): the file writes are serialized by their own
	// mutex because they read the manager, rewrite the file and load
	// it back as one logical operation.
	supWriteMu   sync.Mutex
	writeEnabled bool
	suppressPath string

	// active response (C3, armed only with -allow-kill + token + an
	// open audit file; see respond_write.go). nil = the route answers
	// a real 404: the surface does not exist for probing clients.
	respond *respond.Manager
	// file paths the engine armed at startup (respond_read.go): the
	// read surface reports them verbatim instead of guessing.
	respondOpsPath, respondProtPath, respondAuditPath string

	// forensic evidence bundles (internal/forensic): nil = capture
	// disabled (-forensic=false); the route then answers 501 so the
	// console can render "feature off" instead of a misleading 404.
	forensic *forensic.Recorder
}

// New binds a plain-text API listener. Use addr ":0" in tests to pick
// a free port. For an encrypted listener use NewTLS; when the API is
// reachable beyond loopback and TLS termination happens elsewhere
// (reverse proxy), document it — the bearer token otherwise crosses
// the network in clear text.
func New(addr string) (*Hub, error) {
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return nil, fmt.Errorf("api: listen %s: %w", addr, err)
	}
	return newHub(ln, nil)
}

// NewTLS binds the API listener wrapped in TLS with hot certificate
// rotation: the pair is loaded eagerly (a wrong path or mismatched
// pair fails at startup — a half-encrypted API never serves traffic)
// and re-read on mtime change, the same semantics the ingest listener
// has had since the beginning (see internal/tlsutil). Typical
// deployment:   sf-engine -api 0.0.0.0:7778 -api-cert c.pem -api-key
// k.pem -api-token ...  so the bearer token, the telemetry the read
// routes hand out and the kill_process request body all travel
// encrypted.
func NewTLS(addr, certFile, keyFile string) (*Hub, error) {
	reloader, err := tlsutil.NewReloader(certFile, keyFile)
	if err != nil {
		return nil, fmt.Errorf("api: %w", err)
	}
	ln, err := reloader.Listen(addr)
	if err != nil {
		return nil, fmt.Errorf("api: listen %s: %w", addr, err)
	}
	return newHub(ln, reloader)
}

// newHub assembles the routes and the server around an already-bound
// listener; reloader nil means plain text.
func newHub(ln net.Listener, reloader *tlsutil.Reloader) (*Hub, error) {
	h := &Hub{
		listener:   ln,
		subs:       make(map[chan []byte]struct{}),
		started:    time.Now(),
		bySeverity: map[string]int{},
		lifecycle:  mustMemoryLifecycle(),
		risk:       risk.New(),
		authFails:  map[string]*authFailBox{},
		reloader:   reloader,
		tls:        reloader != nil,
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/stats", h.handleStats)
	// Prometheus scrape endpoint (package D1 of the owner's roadmap):
	// same counters as /api/stats in text exposition format. It sits
	// under the same h.auth wrapper as every /api route — only
	// /api/health is exempt — so a token-protected engine demands the
	// Bearer credential here too (Prometheus sends `authorization` from
	// its scrape config). Registered OUTSIDE the /api/ prefix on
	// purpose: scrapers look for /metrics by convention.
	mux.HandleFunc("GET /metrics", h.handleMetrics)
	mux.HandleFunc("GET /api/events", h.handleEvents)
	mux.HandleFunc("GET /api/alerts", h.handleAlerts)
	mux.HandleFunc("GET /api/alerts/search", h.handleAlertSearch)
	mux.HandleFunc("POST /api/alerts/{id}/status", h.handleAlertStatus)
	mux.HandleFunc("GET /api/alerts/{id}/forensics", h.handleAlertForensics)
	mux.HandleFunc("GET /api/rules", h.handleRules)
	mux.HandleFunc("GET /api/suppressions", h.handleSuppressions)
	h.registerSuppressionsWrite(mux)
	// active response (C3): registered unconditionally, answers a
	// real 404 while the engine runs without -allow-kill + token +
	// open audit (respond_write.go documents why a probe must not
	// distinguish "disarmed" from "does not exist"). The read surface
	// (respond_read.go) follows the same contract: an unarmed engine
	// exposes no state and no audit tail either.
	mux.HandleFunc("POST /api/respond/kill", h.handleRespondKill)
	mux.HandleFunc("GET /api/respond/state", h.handleRespondState)
	mux.HandleFunc("GET /api/respond/audit", h.handleRespondAudit)
	mux.HandleFunc("GET /api/sequences", h.handleSequences)
	mux.HandleFunc("GET /api/stream", h.handleStream)
	mux.HandleFunc("GET /api/health", h.handleHealth)
	mux.HandleFunc("GET /api/alerts/export", h.handleAlertsExport)
	mux.HandleFunc("GET /api/events/export", h.handleEventsExport)
	h.srv = &http.Server{
		Handler:           h.auth(guardWriteOrigin(mux)),
		ReadHeaderTimeout: 5 * time.Second,
		// idle keep-alive connections are reclaimed instead of pinning
		// a goroutine and a socket each for as long as a client likes;
		// no ReadTimeout/WriteTimeout on purpose: the SSE stream is a
		// long-lived response, and Go cancels a request context when
		// its read deadline expires
		IdleTimeout:    2 * time.Minute,
		MaxHeaderBytes: 64 << 10,
	}
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
// /api/suppressions and its live count in /api/stats. Write access is
// a separate, opt-in step: EnableSuppressionsWrite.
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

// SetIngestIdentityStats wires the per-sensor ingest identities into
// /api/stats: how many are configured and how many events were refused
// because a sensor reported a host outside its binding (a compromise
// signal). No wiring means identities are off (reported as zeros).
func (h *Hub) SetIngestIdentityStats(fn func() (identities int, violations uint64)) {
	h.mu.Lock()
	h.identities = fn
	h.mu.Unlock()
}

// SetToken requires "Authorization: Bearer <token>" on every /api route
// except /api/health (the liveness probe, which returns nothing but
// {"mode":"engine","status":"ok"}). Call before Run. This keeps the standard set by the
// ingest auth: a listener reachable beyond loopback must demand an
// explicit credential - the API hands out every event and alert, so an
// open port on a shared network is a silent data leak.
func (h *Hub) SetToken(token string) { h.token = token }

// TLS reports whether the API listener is TLS-wrapped (startup
// banners and tests).
func (h *Hub) TLS() bool { return h.tls }

// CertReloads returns how many times the API certificate was rotated
// in place (file mtime change); 0 on plain listeners.
func (h *Hub) CertReloads() uint64 {
	if h.reloader == nil {
		return 0
	}
	return h.reloader.Reloads()
}

// CertReloadErrors returns how many API certificate reload attempts
// were refused; the current certificate kept serving in every case.
func (h *Hub) CertReloadErrors() uint64 {
	if h.reloader == nil {
		return 0
	}
	return h.reloader.Errors()
}

// SetReloadNotify wires the engine's voice into API certificate
// rotation events. Call before Run; nil keeps the API silent.
func (h *Hub) SetReloadNotify(fn func(event string, reloads, reloadErrs uint64)) {
	if h.reloader != nil {
		h.reloader.SetReloadNotify(fn)
	}
}

// authFailBox counts unauthorized attempts from one remote address
// inside a rolling window. The map that holds the boxes is guarded by
// authMu; past authFailBudget failures in a window the address is
// answered with 429 for the remainder of the window, so a brute-force
// attempt cannot run comparisons (and fill the log) at line rate.
type authFailBox struct {
	windowStart time.Time
	failures    int
}

// tooManyAuthFails records a 401 from addr and reports whether the
// address has exhausted its budget for the current window. The map
// grows one entry per offending address: it is trimmed opportunisti-
// cally on each window rollover, and an address that stops failing
// costs nothing after its window expires.
func (h *Hub) tooManyAuthFails(addr string) bool {
	key := remoteIP(addr)
	now := time.Now()
	h.authMu.Lock()
	defer h.authMu.Unlock()
	if len(h.authFails) > 1024 { // opportunistic trim of stale boxes
		for k, box := range h.authFails {
			if now.Sub(box.windowStart) > authFailWindow {
				delete(h.authFails, k)
			}
		}
	}
	if _, known := h.authFails[key]; !known && len(h.authFails) >= authFailMaxAddrs {
		// still full of live boxes: forget an arbitrary one (map order
		// is randomized) — the memory bound wins over perfect
		// attribution against an attacker who owns thousands of IPs
		for k := range h.authFails {
			delete(h.authFails, k)
			break
		}
	}
	box := h.authFails[key]
	if box == nil || now.Sub(box.windowStart) > authFailWindow {
		box = &authFailBox{windowStart: now}
		h.authFails[key] = box
	}
	box.failures++
	return box.failures > authFailBudget
}

// remoteIP strips the port from a RemoteAddr ("host:port" for TCP).
func remoteIP(addr string) string {
	if host, _, err := net.SplitHostPort(addr); err == nil {
		return host
	}
	return addr
}

// auth wraps the mux with the bearer check. The comparison is
// constant-time and runs on every request (no early exits on the
// header shape), mirroring the ingest token handling. The scheme is
// matched case-insensitively (RFC 7235) and rejections carry a
// WWW-Authenticate challenge plus an actionable error body, so an
// operator hitting the 401 knows exactly which knob to set. Addresses
// that burn the failure budget get a 429 for the rest of the window:
// the constant-time compare removes timing as an oracle, this removes
// volume as one.
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
			if h.tooManyAuthFails(r.RemoteAddr) {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusTooManyRequests)
				fmt.Fprintln(w, `{"error":"too many unauthorized requests from this address; retry after the window"}`)
				return
			}
			w.Header().Set("WWW-Authenticate", `Bearer realm="bluetardigrade api"`)
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

// SetNotifyStats wires the external notification channels (C2) into
// /api/stats: one sent/failed/dropped/filtered row per configured
// channel. No wiring at all means the engine runs without -notify
// (reported as an empty list) — the stats contract stays stable
// whether or not external notifications are configured.
func (h *Hub) SetNotifyStats(fn func() []notify.ChannelStats) {
	h.mu.Lock()
	h.notify = fn
	h.mu.Unlock()
}

// SetElasticStats wires the Elasticsearch sink counters into
// /api/stats (same triple as the webhook: alerts indexed, alerts
// failed/dropped by the bounded spool).
func (h *Hub) SetElasticStats(stats func() (sent, failed, dropped uint64)) {
	h.mu.Lock()
	h.elastic = stats
	h.mu.Unlock()
}

// SetSplunkStats wires the Splunk HEC sink counters into /api/stats.
func (h *Hub) SetSplunkStats(stats func() (sent, failed, dropped uint64)) {
	h.mu.Lock()
	h.splunk = stats
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

// SetBeaconStats wires the beaconing detector observability into
// /api/stats: keys currently holding in-window evidence, the hard
// state cap and beacons fired since startup. A nil closure or no
// wiring at all means the detector is off (reported as zeros) - the
// stats contract stays stable whether or not the engine loaded a
// beacons file.
func (h *Hub) SetBeaconStats(fn func() (tracked, cap int, fired uint64)) {
	h.mu.Lock()
	h.beacon = fn
	h.mu.Unlock()
}

// SetThresholdStats wires the volumetric detector (A2) into /api/stats:
// loaded definitions, keys currently holding in-window evidence and
// fires since startup. A nil closure or no wiring at all means the
// detector is off (reported as zeros) — the stats contract stays
// stable whether or not the engine loaded a thresholds file.
func (h *Hub) SetThresholdStats(fn func() (defs, keys int, fired uint64)) {
	h.mu.Lock()
	h.threshold = fn
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

// persistEvent writes one event to the store if attached.
func (h *Hub) persistEvent(ev *model.Event) { h.PersistEvents([]*model.Event{ev}) }

// PersistEvents writes a batch of events to the store (one SQLite
// transaction) when one is attached. Failures are logged with a
// throttle (first, then every 500th) so a full disk does not flood the
// log while detection keeps running; id conflicts are not failures —
// the first copy is safe on disk — and are logged on their own
// throttle. The engine loop calls it once per drained batch, BEFORE
// PublishEvent fans each event out: durable evidence first, live
// delivery second.
func (h *Hub) PersistEvents(evs []*model.Event) {
	h.mu.Lock()
	st := h.store
	h.mu.Unlock()
	if st == nil || len(evs) == 0 {
		return
	}
	res := st.InsertEvents(evs)
	for _, err := range res.Failed {
		n := atomic.AddUint64(&h.storeFails, 1)
		if n == 1 || n%500 == 0 {
			log.Printf("[API] store write FAILED (%d total): %v", n, err)
		}
	}
	if len(res.Conflicts) > 0 {
		total := st.IDConflicts()
		prev := total - int64(len(res.Conflicts))
		// log when the running total crosses 1 or a multiple of 500
		if prev == 0 || prev/500 != total/500 {
			log.Printf("[API] event id conflict, stored evidence kept (%d total, last id %s)", total, oneLine(res.Conflicts[len(res.Conflicts)-1]))
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

// SetForensic wires the evidence-bundle recorder. nil is a valid
// state (-forensic=false): the route exists and answers 501 so the
// console can distinguish "feature off" from "no bundle for this
// id".
func (h *Hub) SetForensic(r *forensic.Recorder) {
	h.mu.Lock()
	h.forensic = r
	h.mu.Unlock()
}

// SetLifecycle wires the alert triage store. When no store is set the
// hub keeps the private memory-only one created in New, so the write
// endpoint always answers consistently (statuses live for the process
// lifetime); the engine swaps in the file-backed store at startup via
// this setter. A nil argument keeps the current store (wiring code
// should just skip the call instead of trying to "disable" the
// endpoint: a console button that 500s is worse than a status that
// resets on restart).
func (h *Hub) SetLifecycle(s *lifecycle.Store) {
	if s == nil {
		return
	}
	h.mu.Lock()
	h.lifecycle = s
	h.mu.Unlock()
}

// mustMemoryLifecycle gives every hub a working default store so the
// POST endpoint never dereferences nil. lifecycle.New("") cannot fail
// (no file to read); the panic guard is for future refactors only.
func mustMemoryLifecycle() *lifecycle.Store {
	s, err := lifecycle.New("")
	if err != nil {
		panic(fmt.Sprintf("api: memory lifecycle store: %v", err))
	}
	return s
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
// fan-out: durable evidence first, live delivery second. The engine
// loop uses the split form (PersistEvents per batch, then PublishEvent
// per event) to amortize the SQLite commit.
func (h *Hub) RecordEvent(ev *model.Event) {
	if ev == nil {
		return
	}
	h.persistEvent(ev)
	h.PublishEvent(ev)
}

// PublishEvent adds an already-persisted event to the ring and streams
// it to subscribers.
func (h *Hub) PublishEvent(ev *model.Event) {
	if ev == nil {
		return
	}
	h.mu.Lock()
	h.events = append(h.events, ev)
	if len(h.events) > maxEvents {
		h.events = h.events[len(h.events)-maxEvents:]
	}
	h.mu.Unlock()
	h.broadcast("event", ev)
}

// RecordAlert stores an alert in the ring, persists it (store attached)
// and streams it to subscribers. Alerts reaching the ring without an id
// (hand-built by tests or future producers) get one here: every alert
// the API serves must carry the lifecycle key, or
// POST /api/alerts/{id}/status could not reference it.
func (h *Hub) RecordAlert(a alert.Alert) {
	if a.ID == "" {
		a.ID = alert.NewID()
	}
	h.mu.Lock()
	h.alerts = append(h.alerts, a)
	h.alertsTotal++
	h.bySeverity[a.Severity]++
	if len(h.alerts) > maxAlerts {
		h.alerts = h.alerts[len(h.alerts)-maxAlerts:]
	}
	h.mu.Unlock()
	// The tracker owns its mutex — like every other manager's lock,
	// it is only ever taken after h.mu.Unlock (uniform lock rule).
	h.risk.Observe(a.Host, a.Severity, time.Now())
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
	UptimeS        int64  `json:"uptime_s"`
	EventsTotal    uint64 `json:"events_total"`
	Dropped        uint64 `json:"dropped"`
	IngestRejected uint64 `json:"ingest_rejected"`
	// Per-sensor ingest identities: configured credentials and events
	// refused for claiming a host outside the sender's binding.
	IngestIdentities         int            `json:"ingest_identities"`
	IngestIdentityViolations uint64         `json:"ingest_identity_violations"`
	EventsPerMin             int            `json:"events_per_min"`
	AlertsTotal              int            `json:"alerts_total"`
	BySeverity               map[string]int `json:"by_severity"`
	RulesCount               int            `json:"rules_count"`
	RulesTypes               []string       `json:"rules_types"`
	EventsBuffered           int            `json:"events_buffered"`
	WebhookSent              uint64         `json:"webhook_sent"`
	WebhookFailed            uint64         `json:"webhook_failed"`
	WebhookDropped           uint64         `json:"webhook_dropped"`
	// SIEM sinks (Elasticsearch bulk / Splunk HEC): same delivery
	// triple as the webhook, per platform.
	ElasticSent        uint64 `json:"elastic_sent"`
	ElasticFailed      uint64 `json:"elastic_failed"`
	ElasticDropped     uint64 `json:"elastic_dropped"`
	SplunkSent         uint64 `json:"splunk_sent"`
	SplunkFailed       uint64 `json:"splunk_failed"`
	SplunkDropped      uint64 `json:"splunk_dropped"`
	Suppressions       int    `json:"suppressions_active"`
	StoreEnabled       bool   `json:"store_enabled"`
	StoreWriteFailures uint64 `json:"store_write_failures"`
	StoreEvents        int64  `json:"store_events"`
	StoreAlerts        int64  `json:"store_alerts"`
	// StoreIDConflicts counts event writes refused because the id was
	// already stored with a different payload (first copy kept):
	// possible evidence forgery by a feed, or an id collision.
	StoreIDConflicts int64  `json:"store_id_conflicts"`
	CorrelatorStates int    `json:"correlator_states"`
	CorrelatorSeqs   int    `json:"correlator_sequences"`
	CorrelatorCap    int    `json:"correlator_cap"`
	Mode             string `json:"mode"`

	// Host risk scoring (A1): how many hosts currently carry non-cold
	// risk, and the top-5 list the console dashboard renders.
	RiskHostsTracked int             `json:"risk_hosts_tracked"`
	HotHosts         []risk.HostRisk `json:"hot_hosts"`
	// Beaconing detector (A3): the width of the live signal, the
	// hard cap and the total fires since startup.
	BeaconsTracked int    `json:"beacons_tracked"`
	BeaconsCap     int    `json:"beacons_cap"`
	BeaconsFired   uint64 `json:"beacons_fired"`
	// Volumetric detector (A2): loaded definitions, live aggregation
	// keys and total fires since startup.
	ThresholdRules int    `json:"threshold_rules"`
	ThresholdKeys  int    `json:"threshold_keys"`
	ThresholdFired uint64 `json:"threshold_fired"`
	// External notifications (C2): one delivery row per configured
	// channel (Slack, Telegram, email). Empty when the engine runs
	// without -notify.
	NotifyChannels []notify.ChannelStats `json:"notify_channels"`
}

// statsSnapshot collects every counter /api/stats and /metrics serve.
// It is the ONE place where the hub lock meets the other managers'
// closures — both handlers render from the same struct, so the two
// views can never drift apart (enforced by TestMetricsParityWithStats).
func (h *Hub) statsSnapshot() statsPayload {
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
	idFn := h.identities
	var whSent, whFailed, whDropped uint64
	if h.webhook != nil {
		whSent, whFailed, whDropped = h.webhook()
	}
	var esSent, esFailed, esDropped uint64
	if h.elastic != nil {
		esSent, esFailed, esDropped = h.elastic()
	}
	var spSent, spFailed, spDropped uint64
	if h.splunk != nil {
		spSent, spFailed, spDropped = h.splunk()
	}
	corrFn := h.correlator
	notifyFn := h.notify
	bFn := h.beacon
	st := h.store
	rulesCount, rulesTypes := 0, []string{}
	if h.rules != nil {
		rulesCount = h.rules.Count()
		rulesTypes = h.rules.Types()
	}
	sup := h.suppress
	h.mu.Unlock()
	// The correlator closure is called AFTER h.mu.Unlock, never under
	// it: the real closure enters correlate.Manager's mutex (States,
	// Count), and the chain-completion path runs the lock order the
	// other way round — Observe holds the correlator mutex across
	// fire() -> alert emit -> RecordAlert, which takes h.mu. Calling
	// the closure under h.mu lets the two orders meet: one /api/stats
	// request interleaved with one completing chain and both goroutines
	// block forever — the API handler AND every subsequent Observe
	// (detection loss, not just a hung stats endpoint). The suppress
	// manager is snapshotted-then-called for the same reason, and so is
	// the store pointer: Counts() takes the store mutex while a write
	// may be mid-flight (SQLite), and no path from the store ever needs
	// h.mu back — calling under the hub lock would only risk stalls,
	// never deadlock, but the idiom costs nothing and keeps
	// statsSnapshot's rule uniform: closures and other managers' locks
	// are only ever taken after Unlock.
	var idCount int
	var idViolations uint64
	if idFn != nil {
		idCount, idViolations = idFn()
	}
	var corrStates, corrSeqs, corrCap int
	if corrFn != nil {
		corrStates, corrSeqs, corrCap = corrFn()
	}
	storeEnabled, storeEvents, storeAlerts, storeConflicts := false, int64(0), int64(0), int64(0)
	if st != nil {
		storeEnabled = true
		storeEvents, storeAlerts = st.Counts()
		storeConflicts = st.IDConflicts()
	}
	supActive := 0
	if sup != nil {
		supActive = sup.Count(time.Now())
	}

	// Risk tracker has its own mutex: read after h.mu.Unlock, the same
	// uniform rule as the correlator/store/suppress managers above.
	// Top-5 is what the console renders; tracked is the width of the
	// signal (how many hosts carry non-cold risk right now).
	now := time.Now()
	riskHosts, hotHosts := 0, []risk.HostRisk{}
	if h.risk != nil {
		riskHosts = h.risk.Tracked(now)
		hotHosts = h.risk.Snapshot(now, 5)
	}

	// Beacon detector closure: same uniform rule — called after
	// h.mu.Unlock. Tracked/Fired take the beacon manager's mutex, and
	// the fire path runs the lock order the other way round: Observe
	// holds it across fire -> RecordAlert, which takes h.mu.
	var bTracked, bCap int
	var bFired uint64
	if bFn != nil {
		bTracked, bCap, bFired = bFn()
	}

	// Threshold detector closure (A2): same uniform rule — called
	// after h.mu.Unlock (fire path runs the lock order the other way
	// round: Observe holds its mutex across fire -> RecordAlert, which
	// takes h.mu).
	var tDefs, tKeys int
	var tFired uint64
	if tFn := h.threshold; tFn != nil {
		tDefs, tKeys, tFired = tFn()
	}

	// Notify channels closure (C2): same uniform rule — called after
	// h.mu.Unlock. Stats() only reads atomics and copies a small slice,
	// but the idiom stays uniform: no other manager's state under h.mu.
	notifyRows := []notify.ChannelStats{}
	if notifyFn != nil {
		if rows := notifyFn(); rows != nil {
			notifyRows = rows
		}
	}

	return statsPayload{
		UptimeS:                  int64(time.Since(h.started) / time.Second),
		EventsTotal:              ingested,
		Dropped:                  dropped,
		IngestRejected:           rejected,
		IngestIdentities:         idCount,
		IngestIdentityViolations: idViolations,
		EventsPerMin:             last60,
		AlertsTotal:              alTotal,
		BySeverity:               bySev,
		RulesCount:               rulesCount,
		RulesTypes:               rulesTypes,
		EventsBuffered:           evCount,
		WebhookSent:              whSent,
		WebhookFailed:            whFailed,
		WebhookDropped:           whDropped,
		ElasticSent:              esSent,
		ElasticFailed:            esFailed,
		ElasticDropped:           esDropped,
		SplunkSent:               spSent,
		SplunkFailed:             spFailed,
		SplunkDropped:            spDropped,
		Suppressions:             supActive,
		StoreEnabled:             storeEnabled,
		StoreWriteFailures:       atomic.LoadUint64(&h.storeFails),
		StoreEvents:              storeEvents,
		StoreAlerts:              storeAlerts,
		StoreIDConflicts:         storeConflicts,
		CorrelatorStates:         corrStates,
		CorrelatorSeqs:           corrSeqs,
		CorrelatorCap:            corrCap,
		Mode:                     "engine",
		RiskHostsTracked:         riskHosts,
		HotHosts:                 hotHosts,
		BeaconsTracked:           bTracked,
		BeaconsCap:               bCap,
		BeaconsFired:             bFired,
		ThresholdRules:           tDefs,
		ThresholdKeys:            tKeys,
		ThresholdFired:           tFired,
		NotifyChannels:           notifyRows,
	}
}

func (h *Hub) handleStats(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, h.statsSnapshot())
}

func (h *Hub) handleEvents(w http.ResponseWriter, r *http.Request) {
	limit := limitFrom(r, 200)
	f, ok := parseRecordFilter(w, r)
	if !ok {
		return // 400 already written
	}
	h.mu.Lock()
	st := h.store
	// Snapshot the ring under the same lock RecordEvent appends and
	// trims with: reading the slice header unlocked races the
	// append/trim (torn header -> out-of-range or garbage reads).
	// Elements are immutable once inserted, so the header snapshot
	// is sufficient (export.go already used this same pattern).
	ring := h.events
	h.mu.Unlock()
	if st != nil {
		// store attached: serve the FULL history (retention
		// applies), same filters, newest first
		out, err := st.QueryEvents(store.EventQuery{
			Host: f.host, Type: f.evType, Q: f.q,
			Since: f.since, Until: f.until, Limit: limit,
		})
		if err != nil {
			h.storeQueryError(w, err)
			return
		}
		if out == nil {
			out = []*model.Event{}
		}
		writeJSON(w, out)
		return
	}
	out := make([]*model.Event, 0, limit)
	for i := len(ring) - 1; i >= 0 && len(out) < limit; i-- {
		if f.matchEvent(ring[i]) {
			out = append(out, ring[i])
		}
	}
	writeJSON(w, out)
}

// alertView is the wire form of an alert with the lifecycle overlay
// applied. Embedding flattens the JSON, so the shape is the Alert
// payload plus the four optional status fields — downstream consumers
// keep parsing the same fields they already know.
type alertView struct {
	alert.Alert
	Status     string `json:"status,omitempty"`      // new (implicit), acknowledged, closed
	StatusNote string `json:"status_note,omitempty"` // operator free-text triage note
	StatusBy   string `json:"status_by,omitempty"`   // who set it (unauthenticated free text)
	StatusAt   string `json:"status_at,omitempty"`   // RFC 3339 when the status was set
}

// withLifecycle merges the store's entry (when any) into an alert.
func (h *Hub) withLifecycle(a alert.Alert) alertView {
	v := alertView{Alert: a}
	v.Status = "new" // explicit default: readers never special-case missing fields
	if e, ok := h.lifecycle.Get(a.ID); ok {
		v.Status = string(e.Status)
		v.StatusNote = e.Note
		v.StatusBy = e.By
		v.StatusAt = e.At
	}
	return v
}

func (h *Hub) handleAlerts(w http.ResponseWriter, r *http.Request) {
	limit := limitFrom(r, 100)
	f, ok := parseRecordFilter(w, r)
	if !ok {
		return // 400 already written
	}
	h.mu.Lock()
	st := h.store
	// Snapshot under the lock: same ring-race argument as
	// handleEvents (RecordAlert appends+trims under h.mu; elements
	// are immutable value copies once inserted).
	ring := h.alerts
	h.mu.Unlock()
	if st != nil {
		out, err := st.QueryAlerts(store.AlertQuery{
			Host: f.host, Severities: f.sevs, RuleID: f.ruleID, Q: f.q,
			Since: f.since, Until: f.until, Limit: limit,
		})
		if err != nil {
			h.storeQueryError(w, err)
			return
		}
		if out == nil {
			out = []alert.Alert{}
		}
		// store mode serves the same lifecycle overlay as ring mode:
		// triage state must not depend on which backend answered
		views := make([]alertView, 0, len(out))
		for _, a := range out {
			views = append(views, h.withLifecycle(a))
		}
		writeJSON(w, views)
		return
	}
	out := make([]alertView, 0, limit)
	for i := len(ring) - 1; i >= 0 && len(out) < limit; i-- {
		a := ring[i]
		// alertTime decides whether the record can be evaluated against
		// the requested time bounds (see its doc): the parse is only a
		// prerequisite when the query actually filters by time.
		if ts, ok := f.alertTime(a); ok && f.matchAlert(a, ts) {
			out = append(out, h.withLifecycle(a))
		}
	}
	writeJSON(w, out)
}

// ------------------------------------------------------- alert status

// alertIDPattern is the shape alert.NewID generates (16 lowercase hex
// characters). Validating the path parameter keeps arbitrary strings
// out of the store keys and the log lines.
var alertIDPattern = regexp.MustCompile(`^[0-9a-f]{16}$`)

// statusRequest is the POST /api/alerts/{id}/status body.
type statusRequest struct {
	Status string `json:"status"`
	Note   string `json:"note"`
	By     string `json:"by"`
}

// handleAlertStatus records the operator triage decision for one
// alert. The lifecycle store is the source of truth for STATUS: the
// target alert does NOT need to be in the 256-entry ring (an alert
// evicted from the ring can legitimately be closed). Success
// broadcasts an `alert_lifecycle` SSE frame so live consumers update
// without polling.
func (h *Hub) handleAlertStatus(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !alertIDPattern.MatchString(id) {
		writeErr(w, http.StatusBadRequest,
			fmt.Sprintf("malformed alert id %q: want 16 lowercase hex characters (the id field of the alert)", id))
		return
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 8192))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "unreadable or oversized request body (8 KiB limit)")
		return
	}
	var req statusRequest
	if err := json.Unmarshal(body, &req); err != nil {
		writeErr(w, http.StatusBadRequest,
			`invalid JSON body: want {"status":"acknowledged|closed|new","note":"...","by":"..."}`)
		return
	}
	st := lifecycle.Status(req.Status)
	if !lifecycle.Valid(st) {
		writeErr(w, http.StatusBadRequest,
			fmt.Sprintf("invalid status %q: valid values are new, acknowledged, closed", req.Status))
		return
	}
	e, err := h.lifecycle.Set(id, st, req.Note, req.By)
	if err != nil {
		// Persistence failures are the server's fault: 500 with a
		// GENERIC body — the wrapped error names local paths that must
		// not reach the wire (details go to the engine log). Validation
		// failures are the client's: 400 with the actionable message.
		// Classification is structural (sentinel + errors.Is), never
		// message matching: error wording must not decide status codes.
		if errors.Is(err, lifecycle.ErrPersistFailed) {
			log.Printf("[API] alert lifecycle persist FAILED for %s: %v", id, err)
			writeErr(w, http.StatusInternalServerError, "status recorded in memory but persistence failed (see engine log)")
			return
		}
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	// by is client-controlled free text: keep it single-line so the
	// audit log cannot be forged with embedded newlines.
	log.Printf("[API] alert %s -> %s (by=%s)", id, e.Status, oneLine(e.By))
	h.broadcast("alert_lifecycle", e)
	writeJSON(w, e)
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

// oneLine renders a client-supplied string safe for ONE log line:
// every control character becomes %XX, so a hostile note/author/rule
// id cannot forge extra log lines, fake severities or smuggle escape
// sequences into the file the operator reads after an incident. C0,
// DEL and the C1 range (U+0080..U+009F, incl. the 8-bit CSI) encode
// their UTF-8 bytes; printable runes - including non-ASCII ones - pass
// through verbatim, so the log stays forensically useful. Same threat
// model as the feed-hostile field caps on the ingest path; the triage
// audit line and the suppression write audit lines funnel through it.
func oneLine(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	for _, r := range s {
		if r < 0x20 || r == 0x7f || (r >= 0x80 && r <= 0x9f) {
			for _, c := range []byte(string(r)) {
				fmt.Fprintf(&b, "%%%02X", c)
			}
			continue
		}
		b.WriteRune(r)
	}
	return b.String()
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
	// subscriber cap: every SSE client pins a channel and a goroutine
	// for as long as it stays connected, so an unbounded stream route
	// is a slow-motion resource flood on the same listener that serves
	// the operator console. Over the cap the client gets a 503 with a
	// retry-after hint instead of a silently stalled stream.
	if len(h.subs) >= maxSSEClients {
		h.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Retry-After", "5")
		w.WriteHeader(http.StatusServiceUnavailable)
		fmt.Fprintln(w, `{"error":"stream subscriber limit reached; retry shortly"}`)
		return
	}
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

// storeQueryError answers a telemetry read backed by the SQLite store:
// the operator gets the detail in the engine log (with paths and SQL
// state that help debugging), the API client only gets the fact —
// mirroring how the ingest side never echoes internals back.
func (h *Hub) storeQueryError(w http.ResponseWriter, err error) {
	log.Printf("[API] store query failed: %v", err)
	http.Error(w, "store query failed (see engine log)", http.StatusInternalServerError)
}
