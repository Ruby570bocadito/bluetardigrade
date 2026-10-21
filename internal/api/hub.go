// Package api exposes the local HTTP API on the engine: recent events
// and alerts as JSON, the live rule set, an SSE stream for real-time
// consumers (the web console bridge) and the write surfaces — the
// operator triage endpoint POST /api/alerts/{id}/status backed by
// internal/lifecycle, and the opt-in suppressions write of
// suppress_write.go. Deliberately dependency-free so the tracer
// bullet stays easy to audit.
package api

import (
	"crypto/sha256"
	"fmt"
	"net"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/ad"
	"github.com/Ruby570bocadito/bluetardigrade/internal/alert"
	"github.com/Ruby570bocadito/bluetardigrade/internal/baseline"
	"github.com/Ruby570bocadito/bluetardigrade/internal/correlate"
	"github.com/Ruby570bocadito/bluetardigrade/internal/enroll"
	"github.com/Ruby570bocadito/bluetardigrade/internal/fleet"
	"github.com/Ruby570bocadito/bluetardigrade/internal/forensic"
	"github.com/Ruby570bocadito/bluetardigrade/internal/hostgroup"
	"github.com/Ruby570bocadito/bluetardigrade/internal/incident"
	"github.com/Ruby570bocadito/bluetardigrade/internal/intel"
	"github.com/Ruby570bocadito/bluetardigrade/internal/known"
	"github.com/Ruby570bocadito/bluetardigrade/internal/lifecycle"
	"github.com/Ruby570bocadito/bluetardigrade/internal/notify"
	"github.com/Ruby570bocadito/bluetardigrade/internal/reputation"
	"github.com/Ruby570bocadito/bluetardigrade/internal/respond"
	"github.com/Ruby570bocadito/bluetardigrade/internal/risk"
	"github.com/Ruby570bocadito/bluetardigrade/internal/rules"
	"github.com/Ruby570bocadito/bluetardigrade/internal/scenrun"
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
	subs        map[chan frame]struct{}
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
	incidents   *incident.Store                 // investigation cases grouping alerts
	fleet       *fleet.Tracker                  // machines reporting to the engine (nil = no inventory)
	intel       *intel.Matcher                  // offline threat-intel lists (nil = none)
	baseline    *baseline.Tracker               // per-host baseline of processes (nil = none)
	reputation  *reputation.Client              // opt-in VirusTotal/AbuseIPDB lookups (nil = off)
	risk        *risk.Tracker                   // per-host decayed risk score (A1)
	beacon      func() (int, int, uint64)       // live beacon keys, cap, fired (A3)
	threshold   func() (int, int, uint64)       // defs, live keys, fired (A2)

	// v1.1 cuotas por equipo: the bounded detectors' per-host
	// admission quota counters (beacon + threshold; the correlator's
	// per-host share is already bounded by maxSequences by
	// construction) and the view rings' rotation tally by host — the
	// visible counterpart of "a noisy host cannot wash out the
	// others". Both are read under mu.
	quotaStats func() QuotaSnapshot
	ringDrops  struct {
		events uint64
		alerts uint64
		hosts  map[string][2]uint64 // lowercased host -> [events, alerts]
	}

	storeFails uint64 // cumulative failed event/alert writes, also throttles logging (atomic)

	// suppression write surface (armed only with -api-write; see
	// suppress_write.go): the file writes are serialized by their own
	// mutex because they read the manager, rewrite the file and load
	// it back as one logical operation.
	supWriteMu   sync.Mutex
	writeEnabled bool
	suppressPath string

	// read-only SQL console over the store (armed only with
	// -api-db-query; see db_query.go): the flag IS the admin gate
	// until the engine has a role model, and the handler refuses
	// everything the store cannot answer read-only.
	dbQueryArmed bool

	// AD-6 settings surface (ad_settings.go): armed only with -ad,
	// handlers additionally demand -api-write. adWriteMu serializes
	// the config-file read-merge-write (and with it the engine's
	// reconfigure callback); adTestMu allows one DC probe at a time.
	// The reload bookkeeping is atomic: GET never blocks on (or
	// races) a PUT's asynchronous connector swap.
	adSettingsPath  string
	adReconfigure   func(*ad.Config) error
	adConfigSum     [sha256.Size]byte
	adWriteMu       sync.Mutex
	adTestMu        sync.Mutex
	adReloadPending atomic.Bool
	adReloadRecord  atomic.Pointer[adReloadRecord]

	// AD-7 domain sign-in (domain_auth.go): armed only with
	// -domain-auth. domainAuthMu guards the per-remote failure
	// boxes of the endpoint, independent from the bearer throttle.
	domainAuth      *ad.DomainAuthConfig
	domainAuthMu    sync.Mutex
	domainAuthFails map[string]*domainFailBox

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

	// sensor enrollment (enroll.go): nil = off; GET /api/enroll then
	// says how to turn it on.
	enroll *enroll.Registry

	// detection-validation battery (scenarios.go): nil = disarmed,
	// the routes answer 501 with the arming hint instead of a
	// misleading 404.
	scenarios *scenrun.Service

	// read-only Active Directory connector (ad.go): nil = disarmed
	// (no -ad flag), the /api/ad routes answer 501 with the arming
	// hint. All connector accessors return copies — the sync goroutine
	// never shares live memory with handlers.
	ad *ad.Connector

	// host groups (host_groups.go): the -host-groups file ("" =
	// disarmed), the validated set, the drift baseline of the file and
	// the AD computer -> DN map OU criteria are matched with (cached).
	// hostGroupsMu serializes the PUT's check-write-swap.
	hostGroupsPath string
	hostGroups     *hostgroup.Set
	hostGroupsSum  [sha256.Size]byte
	hostGroupsMu   sync.Mutex
	computerDN     adDNCache
	// hosts a scoped store query may name (scope.go), cached briefly
	hostsSeen knownHosts

	// known-software list (§2.2, read-only count in /api/stats): nil =
	// off (no -known-software file or an empty one).
	known *known.Manager

	// SET-3 (platform status): the engine's own version string (set at
	// startup), the ingest→alert latency tracker and the ingest
	// listener's certificate expiry closure (returns RFC3339-ready
	// time, configured path, ok). The API listener's own certificate is
	// read from the reloader directly.
	version      string
	alertLatency func() (count uint64, p50, p95, max float64)
	ingestCert   func() (time.Time, string, bool)
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
		listener:        ln,
		subs:            make(map[chan frame]struct{}),
		started:         time.Now(),
		bySeverity:      map[string]int{},
		lifecycle:       mustMemoryLifecycle(),
		incidents:       mustMemoryIncidents(),
		risk:            risk.New(),
		authFails:       map[string]*authFailBox{},
		domainAuthFails: map[string]*domainFailBox{},
		reloader:        reloader,
		tls:             reloader != nil,
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
	mux.HandleFunc("GET /metrics", unscopedOnly("/metrics", h.handleMetrics))
	mux.HandleFunc("GET /api/events", h.handleEvents)
	mux.HandleFunc("GET /api/alerts", h.handleAlerts)
	mux.HandleFunc("GET /api/alerts/search", h.handleAlertSearch)
	mux.HandleFunc("POST /api/alerts/{id}/status", h.handleAlertStatus)
	h.registerAssign(mux)
	mux.HandleFunc("GET /api/alerts/{id}/forensics", h.handleAlertForensics)
	mux.HandleFunc("GET /api/rules", h.handleRules)
	mux.HandleFunc("POST /api/rules/test", h.handleRuleTest)
	h.registerIncidents(mux)
	mux.HandleFunc("GET /api/reputation", h.handleReputation)
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
	// read-only SQL console (M-4): admin surface, armed with
	// -api-db-query; scoped accounts never reach it (a raw SELECT
	// cannot honor host-group scoping)
	mux.HandleFunc("POST /api/db/query", unscopedOnly("La consulta SQL de la base de datos", h.handleDbQuery))
	mux.HandleFunc("GET /api/sequences", h.handleSequences)
	mux.HandleFunc("GET /api/fleet", h.handleFleet)
	mux.HandleFunc("GET /api/groups", h.handleGroups)
	mux.HandleFunc("PUT /api/settings/groups", unscopedOnly("Editar los grupos de equipos", h.handleGroupsPut))
	h.registerEnroll(mux)
	h.registerScenarios(mux)
	h.registerReports(mux)
	h.registerNoise(mux)
	h.registerAD(mux)
	h.registerDomainAuth(mux)
	mux.HandleFunc("GET /api/intel", h.handleIntel)
	mux.HandleFunc("GET /api/baseline", h.handleBaselineHost)
	mux.HandleFunc("GET /api/stream", h.handleStream)
	mux.HandleFunc("GET /api/health", h.handleHealth)
	mux.HandleFunc("GET /api/alerts/export", h.handleAlertsExport)
	mux.HandleFunc("GET /api/events/export", h.handleEventsExport)
	h.srv = &http.Server{
		Handler:           securityHeaders(h.guardRebinding(h.auth(guardWriteOrigin(h.withScope(mux))))),
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
	h.subs = make(map[chan frame]struct{})
	h.mu.Unlock()
	_ = h.srv.Close()
}

func (h *Hub) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, map[string]string{"status": "ok", "mode": "engine"})
}
