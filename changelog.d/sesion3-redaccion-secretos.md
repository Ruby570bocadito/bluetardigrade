- **Secret redaction (outbound surfaces):** alert free text is scrubbed before
  anything leaves the engine — console, JSON log, SSE, SQLite alerts, webhook,
  Elasticsearch/Splunk, notifications, exports and the forensic bundle's alert
  block — masking secret-shaped values (`password=`, provider keys, `Bearer `,
  `user:pass@` URLs, PEM blocks) to a keep-last-4 mask (`-redact-secrets`, on
  by default; `-redact-mode=tail4|full`); raw events are never rewritten, and
  per-pattern counters land in `/metrics` (`sf_redact_hits_total{kind}`).
