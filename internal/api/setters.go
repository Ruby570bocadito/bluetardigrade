package api

import (
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/ad"
	"github.com/Ruby570bocadito/bluetardigrade/internal/correlate"
	"github.com/Ruby570bocadito/bluetardigrade/internal/forensic"
	"github.com/Ruby570bocadito/bluetardigrade/internal/known"
	"github.com/Ruby570bocadito/bluetardigrade/internal/lifecycle"
	"github.com/Ruby570bocadito/bluetardigrade/internal/notify"
	"github.com/Ruby570bocadito/bluetardigrade/internal/rules"
	"github.com/Ruby570bocadito/bluetardigrade/internal/store"
	"github.com/Ruby570bocadito/bluetardigrade/internal/suppress"
)

// SetAD arms the /api/ad read routes with the connector (nil keeps
// them answering the 501 arming hint). The connector's accessors are
// mutex-guarded and return copies, so handlers never race the sync
// goroutine.
func (h *Hub) SetAD(c *ad.Connector) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.ad = c
}

// SetVersion records the engine's version string for /api/stats
// (SET-3: the platform-status view must not guess it).
func (h *Hub) SetVersion(v string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.version = v
}

// SetAlertLatency wires the ingest→alert latency tracker (SET-3): the
// closure returns the observation count and the p50/p95/max summary in
// milliseconds. It is called after h.mu.Unlock (the uniform rule: no
// other manager's lock under the hub lock).
func (h *Hub) SetAlertLatency(fn func() (count uint64, p50, p95, max float64)) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.alertLatency = fn
}

// SetIngestCertExpiry wires the ingest listener's certificate expiry
// (SET-3): ok=false when the listener runs without TLS. The API
// listener's own expiry comes from its reloader.
func (h *Hub) SetIngestCertExpiry(fn func() (time.Time, string, bool)) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.ingestCert = fn
}

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

// SetKnownSoftware exposes the §2.2 known-software list's live entry
// count in /api/stats. Read-only: the list is an operator config file,
// not API-editable state.
func (h *Hub) SetKnownSoftware(m *known.Manager) {
	h.mu.Lock()
	h.known = m
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

// SetQuotaStats wires the bounded detectors' per-host admission quota
// counters into /api/stats (v1.1 cuotas por equipo). nil = no
// quota-capable detector armed (zeros); the stats contract stays
// stable. The closure is called after h.mu.Unlock like every other
// manager's: the managers' Quota* methods take their own mutexes and
// the fire paths run that lock order the other way round.
func (h *Hub) SetQuotaStats(fn func() QuotaSnapshot) {
	h.mu.Lock()
	h.quotaStats = fn
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
