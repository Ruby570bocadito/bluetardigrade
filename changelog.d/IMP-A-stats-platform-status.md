- **Platform status fields in `/api/stats`**: the engine now publishes its own `version`,
  the ingest→alert latency summary (`alert_latency`: count plus p50/p95/max in
  milliseconds, measured from the event's sensor-side timestamp to the raise; future-dated
  deltas are skipped, never clamped), the durable `store_size_bytes` (SQLite page count ×
  page size, transient `-wal`/`-shm` excluded) and `certificates` with the not-after expiry
  of both TLS listeners — so the console can warn about a lapsing pair instead of
  discovering it on the day sensors fail to reconnect.
