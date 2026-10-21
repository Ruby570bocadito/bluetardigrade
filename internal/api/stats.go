package api

import (
	"net/http"
	"sort"
	"sync/atomic"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/notify"
	"github.com/Ruby570bocadito/bluetardigrade/internal/risk"
)

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
	KnownSoftware      int    `json:"known_software_active"`
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
	// Offline threat intel: indicators and lists loaded, hits that
	// raised an alert since startup (all zero without -intel).
	IntelIndicators int    `json:"intel_indicators"`
	IntelLists      int    `json:"intel_lists"`
	IntelHits       uint64 `json:"intel_hits"`
	// Per-host process baseline: hosts tracked, hosts still inside
	// their learning period, novelties reported since startup.
	BaselineHosts     int    `json:"baseline_hosts"`
	BaselineLearning  int    `json:"baseline_learning"`
	BaselineNovelties uint64 `json:"baseline_novelties"`
	// External notifications (C2): one delivery row per configured
	// channel (Slack, Telegram, email). Empty when the engine runs
	// without -notify.
	NotifyChannels []notify.ChannelStats `json:"notify_channels"`

	// SET-3 (platform status): everything the console's view used to
	// mark "not published" is published here — engine version, the
	// ingest→alert latency summary, the durable store's on-disk size
	// and both listeners' certificate expiry.
	Version        string              `json:"version"`
	AlertLatency   latencyPayload      `json:"alert_latency"`
	StoreSizeBytes int64               `json:"store_size_bytes"`
	Certificates   certificatesPayload `json:"certificates"`

	// v1.1 cuotas por equipo: per-host admission refusals of the
	// bounded detectors and view-ring rotation counted by host — a
	// noisy host cannot wash the others out silently.
	BeaconQuotaRejected    uint64         `json:"beacon_quota_rejected"`
	ThresholdQuotaRejected uint64         `json:"threshold_quota_rejected"`
	RingDroppedEvents      uint64         `json:"ring_dropped_events"`
	RingDroppedAlerts      uint64         `json:"ring_dropped_alerts"`
	QuotaTopHosts          []quotaHostRow `json:"quota_top_hosts"`

	// Scoped is true for a caller limited to host groups (scope.go):
	// events_total, events_per_min, alerts_total, by_severity, the risk
	// fields and quota_top_hosts then count its machines only, over the
	// records the engine keeps in memory; the platform counters stay
	// engine-wide.
	Scoped bool `json:"scoped"`
}

// quotaHostRow is one host's row of the per-host pressure view: how
// many of its records rotated out of the view rings and how many of
// its new detector keys were refused by its own quota. Bounded top
// rows only (8), so /api/stats stays bounded.
type quotaHostRow struct {
	Host       string `json:"host"`
	RingEvents uint64 `json:"ring_events"`
	RingAlerts uint64 `json:"ring_alerts"`
	Beacon     uint64 `json:"beacon"`
	Threshold  uint64 `json:"threshold"`
}

// QuotaSnapshot is one read of the quota-capable detectors' per-host
// admission counters (v1.1 cuotas por equipo). The maps are copies
// served by each manager (capped at 64 hosts each).
type QuotaSnapshot struct {
	BeaconRejected    uint64
	ThresholdRejected uint64
	BeaconHosts       map[string]uint64
	ThresholdHosts    map[string]uint64
}

// latencyPayload summarizes the elapsed time between an event's own
// sensor-side timestamp and the moment its alert was raised (transport
// + queueing + detection). Count is the number of raised alerts
// observed since engine start; a count of zero means "no alerts yet",
// not "no latency".
type latencyPayload struct {
	Count uint64  `json:"count"`
	P50Ms float64 `json:"p50_ms"`
	P95Ms float64 `json:"p95_ms"`
	MaxMs float64 `json:"max_ms"`
}

// certExpiryPayload is one listener's certificate visibility: Present
// false and empty strings when that listener runs without TLS.
type certExpiryPayload struct {
	Present  bool   `json:"present"`
	NotAfter string `json:"not_after"` // RFC 3339, "" when absent
	Path     string `json:"path"`      // configured cert file, "" when absent
}

// certificatesPayload covers both TLS listeners the engine can serve.
type certificatesPayload struct {
	API    certExpiryPayload `json:"api"`
	Ingest certExpiryPayload `json:"ingest"`
}

// mergeQuotaRows folds the ring-rotation tally and the detectors'
// per-host refusal tallies into one bounded top list (8 rows, worst
// first by the row's counter sum, host name as tie-break).
func mergeQuotaRows(ringHosts map[string][2]uint64, quota QuotaSnapshot) []quotaHostRow {
	rows := map[string]*quotaHostRow{}
	row := func(host string) *quotaHostRow {
		if r, ok := rows[host]; ok {
			return r
		}
		r := &quotaHostRow{Host: host}
		rows[host] = r
		return r
	}
	for host, v := range ringHosts {
		r := row(host)
		r.RingEvents, r.RingAlerts = v[0], v[1]
	}
	for host, n := range quota.BeaconHosts {
		row(host).Beacon = n
	}
	for host, n := range quota.ThresholdHosts {
		row(host).Threshold = n
	}
	out := make([]quotaHostRow, 0, len(rows))
	for _, r := range rows {
		out = append(out, *r)
	}
	sort.Slice(out, func(i, j int) bool {
		si := out[i].RingEvents + out[i].RingAlerts + out[i].Beacon + out[i].Threshold
		sj := out[j].RingEvents + out[j].RingAlerts + out[j].Beacon + out[j].Threshold
		if si != sj {
			return si > sj
		}
		return out[i].Host < out[j].Host
	})
	if len(out) > 8 {
		out = out[:8]
	}
	return out
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
	// Every remaining hub field statsSnapshot reads is captured HERE,
	// under the lock (SEG-A ronda 11): the setters write these under
	// h.mu, so a raw read after Unlock is a data race the moment any
	// of them is ever re-armed hot. The captured closures stay UNCALLED
	// until after Unlock — the uniform no-other-manager's-lock rule
	// below is untouched.
	latFn := h.alertLatency
	ingCertFn := h.ingestCert
	rel := h.reloader
	riskM := h.risk
	tFn := h.threshold
	quotaFn := h.quotaStats
	version := h.version
	rulesCount, rulesTypes := 0, []string{}
	if h.rules != nil {
		rulesCount = h.rules.Count()
		rulesTypes = h.rules.Types()
	}
	sup := h.suppress
	knownM := h.known
	intelM, base := h.intel, h.baseline
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
	knownActive := 0
	if knownM != nil {
		knownActive = knownM.Count()
	}

	// Risk tracker has its own mutex: read after h.mu.Unlock, the same
	// uniform rule as the correlator/store/suppress managers above.
	// Top-5 is what the console renders; tracked is the width of the
	// signal (how many hosts carry non-cold risk right now).
	now := time.Now()
	riskHosts, hotHosts := 0, []risk.HostRisk{}
	if riskM != nil {
		riskHosts = riskM.Tracked(now)
		hotHosts = riskM.Snapshot(now, 5)
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

	// Threshold detector closure (A2): captured under the lock above,
	// called after Unlock (fire path runs the lock order the other way
	// round: Observe holds its mutex across fire -> RecordAlert, which
	// takes h.mu).
	var tDefs, tKeys int
	var tFired uint64
	if tFn != nil {
		tDefs, tKeys, tFired = tFn()
	}

	// Intel matcher and baseline tracker have their own mutexes: read
	// after h.mu.Unlock like every other manager.
	var intelIndicators, intelLists, baseHosts, baseLearning int
	var intelHits, baseNovel uint64
	if intelM != nil {
		intelIndicators, intelLists, intelHits = intelM.Total(), len(intelM.Lists()), intelM.Hits()
	}
	if base != nil {
		baseHosts, baseLearning = base.Stats(now)
		baseNovel = base.Novelties()
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

	// SET-3 fields: version is captured under the lock at the top of
	// this function; latency and the ingest certificate closures were
	// captured there too and are only CALLED here — after h.mu.Unlock,
	// like every other manager.
	var lat latencyPayload
	if latFn != nil {
		lat.Count, lat.P50Ms, lat.P95Ms, lat.MaxMs = latFn()
	}
	ingestCert := certExpiryPayload{}
	if ingCertFn != nil {
		if na, path, ok := ingCertFn(); ok {
			ingestCert = certExpiryPayload{
				Present:  true,
				NotAfter: na.UTC().Format(time.RFC3339),
				Path:     path,
			}
		}
	}
	apiCert := certExpiryPayload{}
	if rel != nil {
		if na, ok := rel.NotAfter(); ok {
			apiCert = certExpiryPayload{
				Present:  true,
				NotAfter: na.UTC().Format(time.RFC3339),
				Path:     rel.CertFile(),
			}
		}
	}
	var storeSize int64
	if st != nil {
		storeSize, _ = st.SizeBytes() // a transient pragma failure reports 0: the store stays enabled
	}

	// v1.1 cuotas por equipo: the detectors' quota counters (their
	// own mutexes) and the ring-rotation tally (a second, flat
	// h.mu acquisition, never nested) are read after the main
	// Unlock, like every other manager read in this function.
	ringEvents, ringAlerts, ringHosts := h.ringDropsCopy()
	var quota QuotaSnapshot
	if quotaFn != nil {
		quota = quotaFn()
	}
	quotaTop := mergeQuotaRows(ringHosts, quota)

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
		KnownSoftware:            knownActive,
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
		IntelIndicators:          intelIndicators,
		IntelLists:               intelLists,
		IntelHits:                intelHits,
		BaselineHosts:            baseHosts,
		BaselineLearning:         baseLearning,
		BaselineNovelties:        baseNovel,
		NotifyChannels:           notifyRows,
		BeaconQuotaRejected:      quota.BeaconRejected,
		ThresholdQuotaRejected:   quota.ThresholdRejected,
		RingDroppedEvents:        ringEvents,
		RingDroppedAlerts:        ringAlerts,
		QuotaTopHosts:            quotaTop,
		Version:                  version,
		AlertLatency:             lat,
		StoreSizeBytes:           storeSize,
		Certificates: certificatesPayload{
			API:    apiCert,
			Ingest: ingestCert,
		},
	}
}

func (h *Hub) handleStats(w http.ResponseWriter, r *http.Request) {
	s := h.statsSnapshot()
	if sc := scopeFrom(r); sc != nil {
		s = h.scopedStats(s, sc, time.Now())
	}
	writeJSON(w, s)
}

// scopedStats recounts the per-machine fields of s for a caller limited
// to host groups, from the in-memory rings and the risk tracker.
func (h *Hub) scopedStats(s statsPayload, sc *scope, now time.Time) statsPayload {
	h.mu.Lock()
	events, alerts := h.events, h.alerts
	h.mu.Unlock()
	s.Scoped = true
	s.EventsTotal, s.EventsPerMin = 0, 0
	for i := len(events) - 1; i >= 0; i-- {
		if !sc.allows(events[i].Host) {
			continue
		}
		s.EventsTotal++
		if now.Sub(events[i].Timestamp) <= time.Minute {
			s.EventsPerMin++
		}
	}
	s.AlertsTotal, s.BySeverity = 0, map[string]int{}
	for _, a := range alerts {
		if sc.allows(a.Host) {
			s.AlertsTotal++
			s.BySeverity[a.Severity]++
		}
	}
	hot := []risk.HostRisk{}
	for _, hr := range h.risk.Snapshot(now, -1) {
		if sc.allows(hr.Host) {
			hot = append(hot, hr)
		}
	}
	s.RiskHostsTracked = len(hot)
	if len(hot) > 5 {
		hot = hot[:5]
	}
	s.HotHosts = hot
	quota := []quotaHostRow{}
	for _, row := range s.QuotaTopHosts {
		if sc.allows(row.Host) {
			quota = append(quota, row)
		}
	}
	s.QuotaTopHosts = quota
	return s
}
