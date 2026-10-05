### Documentation accuracy (Pulimiento A, round 6)

- The "Prometheus metrics" section of `docs/OPERATIONS.md` listed
  roughly half of the `sf_*` families the `/metrics` endpoint
  actually serves (`internal/api/metrics.go` emits 47). The master
  enumeration now covers every family, grouped by concern: engine
  lifetime and throughput (`sf_uptime_seconds`,
  `sf_events_per_minute`, `sf_events_buffered`), ingest auth
  (`sf_ingest_identities`, `sf_ingest_identity_violations_total`),
  detection content (`sf_rules`), the behavioral detectors
  (`sf_beacon_keys_tracked` / `sf_beacon_cap` /
  `sf_beacons_fired_total`, `sf_threshold_rules` /
  `sf_threshold_keys_tracked` / `sf_thresholds_fired_total`,
  `sf_intel_*`, `sf_baseline_*`), noise control and storage, sinks,
  kill-chain correlation and host risk.
- The section also documents which families are conditionally
  emitted — `sf_notify_*_total{channel=...}` only when channels are
  configured, `sf_store_events` / `sf_store_alerts` /
  `sf_store_id_conflicts_total` only when the store is attached,
  `sf_store_enabled` always — and warns that the plural in
  `sf_thresholds_fired_total` breaks `sf_threshold_*` globs, the
  kind of detail a scrape config or alert rule silently depends on.
- The "worth alerting on" list gained the missing persistence
  signal: `sf_store_write_failures_total` climbing means event or
  alert writes to SQLite are failing and affected records may exist
  only in memory until a restart loses them.
- Verified mechanically: a cross-check of every `sf_` family name in
  `internal/api/metrics.go` against the section text reports 47/47
  covered with no unknown names.
