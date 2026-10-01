package api

import (
	"fmt"
	"net/http"
	"sort"
	"strings"
)

// /metrics renders the same counters as /api/stats in the Prometheus
// text exposition format (version 0.0.4). Package D1 of the owner's
// roadmap, assigned to Bugs/Seguridad with two hard constraints from
// the original design directive (archived with the 2026-09 round records):
//
//  1. It must not reveal more than /api/stats already does — it does
//     not: the handler renders h.statsSnapshot(), the exact struct the
//     JSON endpoint serves, and TestMetricsParityWithStats pins the
//     numeric fields of both views together so they cannot drift.
//  2. It sits behind the same bearer auth as /api/* — it does: the
//     route is registered on the same mux wrapped by h.auth, and only
//     /api/health is exempt. Prometheus reads the credential from its
//     scrape config (authorization Credentials/BearerTokenFile), so no
//     anonymous exemption is needed; without -api-token the endpoint
//     stays open exactly like the rest of the loopback API.
//
// Non-numeric statsPayload fields (rules_types, mode) are deliberately
// omitted: Prometheus wants counters and gauges, and a label per rule
// type would make the series cardinality operator-controlled (a
// hostile rules/ dir could inflate the TSDB).
func (h *Hub) handleMetrics(w http.ResponseWriter, _ *http.Request) {
	s := h.statsSnapshot()
	var b strings.Builder
	writeMetric(&b, "sf_uptime_seconds", "Seconds since the engine API started.", "gauge", float64(s.UptimeS))
	writeMetric(&b, "sf_events_total", "Events accepted by ingest since engine start.", "counter", float64(s.EventsTotal))
	writeMetric(&b, "sf_events_dropped_total", "Events dropped by ingest as malformed.", "counter", float64(s.Dropped))
	writeMetric(&b, "sf_ingest_rejected_total", "Connections rejected by the ingest auth handshake.", "counter", float64(s.IngestRejected))
	writeMetric(&b, "sf_events_per_minute", "Events ingested in the last 60 seconds.", "gauge", float64(s.EventsPerMin))
	writeMetric(&b, "sf_alerts_total", "Alerts raised since engine start.", "counter", float64(s.AlertsTotal))
	writeMetric(&b, "sf_rules", "Detection rules currently loaded.", "gauge", float64(s.RulesCount))
	writeMetric(&b, "sf_events_buffered", "Events currently held in the in-memory ring.", "gauge", float64(s.EventsBuffered))
	writeMetric(&b, "sf_webhook_sent_total", "Webhook deliveries accepted by the receiver.", "counter", float64(s.WebhookSent))
	writeMetric(&b, "sf_webhook_failed_total", "Webhook deliveries that failed permanently.", "counter", float64(s.WebhookFailed))
	writeMetric(&b, "sf_webhook_dropped_total", "Webhook deliveries dropped (queue full or backpressure).", "counter", float64(s.WebhookDropped))
	writeMetric(&b, "sf_elastic_sent_total", "Elasticsearch sink: alerts indexed (bulk accepted).", "counter", float64(s.ElasticSent))
	writeMetric(&b, "sf_elastic_failed_total", "Elasticsearch sink: alerts failed permanently or rejected.", "counter", float64(s.ElasticFailed))
	writeMetric(&b, "sf_elastic_dropped_total", "Elasticsearch sink: alerts dropped (queue full or backpressure).", "counter", float64(s.ElasticDropped))
	writeMetric(&b, "sf_splunk_sent_total", "Splunk HEC sink: events accepted by the collector.", "counter", float64(s.SplunkSent))
	writeMetric(&b, "sf_splunk_failed_total", "Splunk HEC sink: events failed permanently or rejected.", "counter", float64(s.SplunkFailed))
	writeMetric(&b, "sf_splunk_dropped_total", "Splunk HEC sink: events dropped (queue full or backpressure).", "counter", float64(s.SplunkDropped))
	// External notifications (C2): labeled families, one series per
	// configured channel. Channel names come from the operator's own
	// -notify config (data /api/stats already serves), so the same
	// contract as by_severity applies: escaped labels, sorted order —
	// Stats() already returns rows sorted by name.
	if len(s.NotifyChannels) > 0 {
		b.WriteString("# HELP sf_notify_sent_total Alert deliveries accepted by each external notification channel.\n# TYPE sf_notify_sent_total counter\n")
		b.WriteString("# HELP sf_notify_failed_total Alert deliveries that failed permanently per external notification channel.\n# TYPE sf_notify_failed_total counter\n")
		b.WriteString("# HELP sf_notify_dropped_total Alert deliveries dropped (queue full) per external notification channel.\n# TYPE sf_notify_dropped_total counter\n")
		b.WriteString("# HELP sf_notify_filtered_total Alerts skipped by the channel min_severity floor.\n# TYPE sf_notify_filtered_total counter\n")
		for _, ch := range s.NotifyChannels {
			label := escapeLabelValue(ch.Name)
			fmt.Fprintf(&b, "sf_notify_sent_total{channel=\"%s\"} %s\n", label, formatValue(float64(ch.Sent)))
			fmt.Fprintf(&b, "sf_notify_failed_total{channel=\"%s\"} %s\n", label, formatValue(float64(ch.Failed)))
			fmt.Fprintf(&b, "sf_notify_dropped_total{channel=\"%s\"} %s\n", label, formatValue(float64(ch.Dropped)))
			fmt.Fprintf(&b, "sf_notify_filtered_total{channel=\"%s\"} %s\n", label, formatValue(float64(ch.Filtered)))
		}
	}
	writeMetric(&b, "sf_suppressions_active", "Operator suppressions currently active.", "gauge", float64(s.Suppressions))
	if s.StoreEnabled {
		writeMetric(&b, "sf_store_enabled", "SQLite persistence attached (1 = yes).", "gauge", 1)
		writeMetric(&b, "sf_store_events", "Events persisted in the SQLite store.", "gauge", float64(s.StoreEvents))
		writeMetric(&b, "sf_store_alerts", "Alerts persisted in the SQLite store.", "gauge", float64(s.StoreAlerts))
	} else {
		writeMetric(&b, "sf_store_enabled", "SQLite persistence attached (1 = yes).", "gauge", 0)
	}
	writeMetric(&b, "sf_correlator_states", "In-flight kill-chain (sequence, host) states.", "gauge", float64(s.CorrelatorStates))
	writeMetric(&b, "sf_correlator_sequences", "Kill-chain sequences loaded.", "gauge", float64(s.CorrelatorSeqs))
	writeMetric(&b, "sf_correlator_cap", "Maximum kill-chain states the correlator will track.", "gauge", float64(s.CorrelatorCap))
	// Beaconing detector (A3): totals only — per-profile detail
	// lives in the alert payload (rule_id), keeping series
	// cardinality bounded by construction instead of operator config.
	writeMetric(&b, "sf_beacon_keys_tracked", "Beacon keys currently holding in-window connection evidence.", "gauge", float64(s.BeaconsTracked))
	writeMetric(&b, "sf_beacon_cap", "Maximum beacon keys the detector will track.", "gauge", float64(s.BeaconsCap))
	writeMetric(&b, "sf_beacons_fired_total", "Beacon alerts emitted since engine start.", "counter", float64(s.BeaconsFired))
	// Volumetric detector (A2): totals only — per-definition detail
	// lives in the alert payload (rule_id), keeping series
	// cardinality bounded by construction.
	writeMetric(&b, "sf_threshold_rules", "Threshold definitions currently loaded.", "gauge", float64(s.ThresholdRules))
	writeMetric(&b, "sf_threshold_keys_tracked", "Threshold keys currently holding in-window evidence.", "gauge", float64(s.ThresholdKeys))
	writeMetric(&b, "sf_thresholds_fired_total", "Threshold alerts emitted since engine start.", "counter", float64(s.ThresholdFired))
	// Host risk (A1): the tracked gauge is a plain number; the top-5
	// scores are the second labeled family. Hosts come from telemetry
	// (operator-visible data /api/stats already serves), so the same
	// contract as by_severity applies: escaped labels, sorted output.
	// Sorting s.HotHosts in place is safe: the slice backing array is
	// freshly allocated by the tracker and owned by this handler.
	writeMetric(&b, "sf_risk_hosts_tracked", "Hosts currently carrying a non-cold risk score.", "gauge", float64(s.RiskHostsTracked))
	sort.Slice(s.HotHosts, func(i, j int) bool { return s.HotHosts[i].Host < s.HotHosts[j].Host })
	if len(s.HotHosts) > 0 {
		b.WriteString("# HELP sf_host_risk_score Current decayed risk score per host (top 5).\n# TYPE sf_host_risk_score gauge\n")
		for _, hh := range s.HotHosts {
			fmt.Fprintf(&b, "sf_host_risk_score{host=\"%s\"} %s\n", escapeLabelValue(hh.Host), formatValue(hh.Score))
		}
	}
	// by_severity is the only labeled family. Severity strings come
	// from rule files (operator-controlled): the label value is
	// escaped, and the series are emitted in sorted order so the
	// output is deterministic (scrapers and tests both benefit).
	sevs := make([]string, 0, len(s.BySeverity))
	for sev := range s.BySeverity {
		sevs = append(sevs, sev)
	}
	sort.Strings(sevs)
	b.WriteString("# HELP sf_alerts_by_severity Alerts raised since engine start, by severity.\n# TYPE sf_alerts_by_severity gauge\n")
	for _, sev := range sevs {
		fmt.Fprintf(&b, "sf_alerts_by_severity{severity=\"%s\"} %d\n", escapeLabelValue(sev), s.BySeverity[sev])
	}

	w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(b.String()))
}

// writeMetric emits one HELP/TYPE/sample triplet. Metric names are
// compile-time constants, so only the value needs formatting.
func writeMetric(b *strings.Builder, name, help, typ string, value float64) {
	fmt.Fprintf(b, "# HELP %s %s\n# TYPE %s %s\n%s %s\n", name, help, name, typ, name, formatValue(value))
}

// formatValue renders numbers the way Prometheus parsers expect:
// integers without a decimal point, everything else via strconv.
func formatValue(v float64) string {
	if v == float64(int64(v)) {
		return fmt.Sprintf("%d", int64(v))
	}
	return fmt.Sprintf("%g", v)
}

// escapeLabelValue escapes the three characters the exposition format
// requires inside label values: backslash, double quote and newline.
// fmt's %q is NOT used because it would also escape non-ASCII runes,
// mangling operator-supplied severity strings.
func escapeLabelValue(s string) string {
	r := strings.NewReplacer(
		`\`, `\\`,
		`"`, `\"`,
		"\n", `\n`,
	)
	return r.Replace(s)
}
