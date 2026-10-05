```markdown
### Documentation accuracy (Pulimiento A, round 5)

- `docs/ARCHITECTURE.md` System overview diagram had drifted in
  several places and no longer matched the code or the feature
  inventory below it:
  - The endpoint subgraph said "ETW Kernel-Process providers" but
    the Rust sensor has collected from four providers since commit
    `0a4a8aa` (Kernel-Process, Kernel-Network, Kernel-Registry,
    DNS-Client). Same drift the Telemetry inventory row had before
    round 3 — reading the diagram and the row together was
    contradictory. Now lists all four.
  - The engine pipeline omitted components the operator actually
    sees: `intel` (offline threat lists), `baseline` (per-host
    novelty) and `fleet` (machine inventory + heartbeats) on the
    enrichment side; `forensic` (evidence bundles), `lifecycle`
    (alert triage) and `suppressions` (operator allowlist) on the
    alert side; `notify` (Slack/Telegram/email) and the SIEM sinks
    (Elastic/Splunk) as alert sinks alongside the webhook; and
    `respond` (active response, kill_process) as an action sink.
    All are first-class packages in `internal/` and are wired in
    `cmd/engine/run.go`. The diagram now shows them.
  - The webhook node was relabelled "SIEM/SOAR collector" but the
    engine has separate webhook, notify and SIEM sink paths; the
    relabelling hid that. Split back into three nodes.
- The paragraph under the diagram was a one-liner that named only
  "sensors" and "interfaces". Expanded to name the actual producers
  (Rust ETW sensor, Go SOC collector, external producers) and
  consumers (local API, web console, SIEM/notification sinks) of
  the unified event schema, and to state the contract explicitly:
  a new telemetry source is a new producer of the same events, not
  a new wire format.
```
