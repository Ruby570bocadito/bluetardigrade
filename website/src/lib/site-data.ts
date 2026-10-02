export type View = "home";

export const REPO_URL = "https://github.com/Ruby570bocadito/bluetardigrade";
// El repositorio se renombró desde security-framework; GitHub redirige las
// URLs antiguas, pero los enlaces canónicos apuntan al nombre nuevo.
export const REPO_LEGACY_URL = "https://github.com/Ruby570bocadito/security-framework";
export const PROJECT_NAME = "bluetardigrade";
export const TAGLINE = "Real-time threat detection for Windows endpoints";

/** One-command Windows install: download + run the installer (no admin). */
export const WIN_INSTALL_CMD =
  "irm https://raw.githubusercontent.com/Ruby570bocadito/bluetardigrade/main/install.ps1 | iex";

export const NAV_LINKS: { label: string; anchor: string }[] = [
  { label: "Live", anchor: "live" },
  { label: "Why", anchor: "why" },
  { label: "Architecture", anchor: "architecture" },
  { label: "Features", anchor: "features" },
  { label: "Quickstart", anchor: "quickstart" },
  { label: "Roadmap", anchor: "roadmap" },
];

export interface Stat {
  value: number;
  decimals?: string; // rendered as-is instead of the number
  prefix?: string;
  suffix: string;
  label: string;
  desc: string;
}

export const STATS: Stat[] = [
  {
    value: 0.4,
    decimals: "0.4",
    prefix: "≈",
    suffix: " ms",
    label: "p99 ingest → alert",
    desc: "Measured on loopback with the full pipeline active — not assumed.",
  },
  {
    value: 17,
    label: "YAML rule operators",
    suffix: "",
    desc: "11 case-sensitive + 6 case-insensitive, hot-reloaded every 15 s.",
  },
  {
    value: 4,
    label: "Detection layers",
    suffix: "",
    desc: "Rules, kill-chain correlation, beaconing and volumetric thresholds.",
  },
  {
    value: 0,
    label: "Simulated events",
    suffix: "",
    desc: "In the product path. The console shows only what the engine delivers.",
  },
];

export const LIVE_DEMO = {
  gif: "/console-live.gif",
  poster: "/console-panel.png",
  caption:
    "Archived console capture with generated test inputs. Product installations collect observed telemetry; this capture does not certify a live endpoint deployment.",
  badges: [
    "411 events · 18 detections",
    "SSE live stream",
    "kill-chain correlation",
    "MITRE ATT&CK mapped",
  ],
};

export const WHY_CARDS = [
  {
    num: "01",
    title: "Behavior over signatures",
    desc: "IOCs expire; TTPs persist. Rules model process trees, command lines and handle access — the noise an attacker actually makes on a Windows host.",
  },
  {
    num: "02",
    title: "Offensive provenance",
    desc: "Rules document explicit detection conditions and ATT&CK mappings. Validate them with observed activity and tune false positives in your own environment.",
  },
  {
    num: "03",
    title: "Usability is a security feature",
    desc: "A detection engine nobody wants to operate detects nothing. NDJSON debugging with netcat, hot-reloaded YAML rules and an OpenAPI-first API come first.",
  },
];

export const GOLDEN_RULE =
  "The console never invents events or fills outages with synthetic telemetry. Demo records are explicitly labeled; fixture data belongs to development and tests.";

export const PIPELINE = [
  {
    num: "01",
    name: "sf-sensor",
    stack: "Rust",
    icon: "cpu",
    desc: "A Windows ETW kernel-process collector plus a Sysmon ingestion path. They send observed host activity as NDJSON/TCP; no demo generator is installed.",
    tags: ["ETW", "Sysmon", "NDJSON/TCP"],
  },
  {
    num: "02",
    name: "sf-engine",
    stack: "Go · single binary",
    icon: "engine",
    desc: "Ingest → enrich → rules → correlate → alert → respond. Four behavioral detection packages, YAML rules hot-reloaded every 15 s, per-host risk scoring with time decay.",
    tags: ["Rules", "Kill-chain", "Beaconing", "Thresholds", "Risk"],
  },
  {
    num: "03",
    name: "Console",
    stack: "Next.js + socket.io",
    icon: "monitor",
    desc: "Live triage with KPIs, severity filters, rule browser, kill-chain chains view, operator suppressions, a read-only active-response view with its forensic audit trail and a bring-your-own AI analyst — any OpenAI-compatible endpoint.",
    tags: ["Live feed", "Response audit", "AI triage"],
  },
  {
    num: "04",
    name: "Outputs",
    stack: "REST · SSE · SIEM · Webhooks",
    icon: "output",
    desc: "REST + SSE on :7778 with native TLS, opt-in SQLite persistence with retention pruner, alert webhooks with Bearer auth, native Elasticsearch / Splunk SIEM sinks, Slack / Telegram / email notifications and Prometheus metrics.",
    tags: ["OpenAPI 3.0", "Elastic / Splunk", "Prometheus"],
  },
];

export const FEATURES = [
  {
    icon: "radio",
    title: "Real telemetry",
    desc: "Rust ETW sensor (kernel-process) + Sysmon path. Schema validation and enrichment: user, command line, network context.",
  },
  {
    icon: "scan",
    title: "Behavioral rules",
    desc: "Plain YAML with 17 operators, per-rule MITRE ATT&CK tags and actions, hot-reload every 15 seconds. Readable in an afternoon.",
  },
  {
    icon: "import",
    title: "Sigma import",
    desc: "`engine sigma` converts community Sigma rules to the native format — deterministic, fail-loud per rule, provenance preserved.",
  },
  {
    icon: "link",
    title: "Kill-chain correlator",
    desc: "Named steps across the same host within a time window raise one high-signal campaign alert, with a hard state cap.",
  },
  {
    icon: "gauge",
    title: "Risk scoring",
    desc: "Severity-weighted per-host score with 30-min half-life. Hot-hosts KPI in stats, Prometheus metric and a console panel.",
  },
  {
    icon: "radar",
    title: "Beaconing detection",
    desc: "C2 call-home detector over connection timing (coefficient of variation), conservative profiles, cooldown and bounded state.",
  },
  {
    icon: "layers",
    title: "Volumetric thresholds",
    desc: "The fourth detection layer (A2): alert when N matching events pile up in one window, optionally grouped by a field — hot-reloaded, bounded state.",
  },
  {
    icon: "shield",
    title: "Response built in",
    desc: "Opt-in active response (kill_process) with five permission layers and an append-only audit written before every signal, triage lifecycle (ack / close / reopen with notes), operator suppressions with expiry, alert webhook with bounded retries.",
  },
  {
    icon: "server",
    title: "SIEM delivery",
    desc: "Native Elasticsearch (Bulk API, idempotent retries) and Splunk HEC sinks with bounded queues and per-platform counters — plus Slack / Telegram / email notifications.",
  },
  {
    icon: "database",
    title: "Storage & API",
    desc: "Opt-in SQLite (pure-Go driver, WAL) with a retention pruner. OpenAPI 3.0 spec drift-guarded in CI; JSONL/CSV export.",
  },
];

export const QUICKSTART = {
  windows: {
    label: "Windows · one command",
    lines: [
      { text: "# download and install (user-level, no admin required)", dim: true },
      { text: WIN_INSTALL_CMD, cmd: true, copy: true },
      { text: "", dim: false },
      { text: "sf-console     # engine + SOC console + browser", ok: true },
      { text: "sf-sensor -SetupSysmon # one-time setup, elevation required", cmd: true },
      { text: "sf-sensor # observe host activity", cmd: true },
    ],
  },
  terminals: [
    {
      title: "terminal 1 — engine",
      lines: [
        { text: "# start the detection engine", dim: true },
        { text: "make run-engine", cmd: true },
        { text: "", dim: false },
      ],
    },
    {
      title: "terminal 2 — observed provider log",
      lines: [
        { text: "# configure Suricata to produce EVE logs first", dim: true },
        { text: "./bin/collector -source suricata -observer IDS-01 -file /path/to/eve.json", cmd: true },
        { text: "", dim: false },
      ],
    },
  ],
  note: "Requirements: Go 1.26+ for the engine, Bun for the console. Hosts stream through sf-sensor; external providers must be configured before importing their logs. No events are generated when sensors are absent.",
};

export const COMPARISON = {
  is: [
    "One Go binary you can read end to end",
    "YAML rules mapped to MITRE ATT&CK",
    "Always-on behavioral detection",
    "Measured p99 latency, published openly",
    "OpenAPI-first REST, drift-guarded in CI",
  ],
  isNot: [
    "A production SIEM or managed EDR",
    "A fleet agent with compliance packs",
    "A replacement for your SOC stack",
    "A black-box rule format",
    "Synthetic telemetry hidden as real activity",
  ],
};

export const ROADMAP = [
  {
    phase: "Phase 1",
    window: "weeks 1–6 · 2026",
    title: "Tracer bullet",
    desc: "ETW sensor, rule index and the end-to-end pipeline — p99 under 10 ms. Shipped.",
    done: true,
  },
  {
    phase: "Phase 2",
    window: "weeks 7–14 · 2026",
    title: "Deep telemetry",
    desc: "YARA memory scanning and an eBPF collector. SQLite persistence already shipped with -store (Sept 2026).",
    done: false,
  },
  {
    phase: "Phase 3",
    window: "weeks 15–20",
    title: "Ecosystem hooks",
    desc: "Shipped ahead of window: OpenAPI-first REST, alert webhook, Slack / Telegram / email notifications and native Elasticsearch / Splunk SIEM sinks.",
    done: true,
  },
  {
    phase: "Phase 4",
    window: "weeks 21–26",
    title: "Extensibility",
    desc: "Python filaments (sandboxed), plugin system and public benchmarks.",
    done: false,
  },
];

export const FAQS = [
  {
    q: "Is this a production EDR?",
    a: "No — and it says so up front. It is a small, readable detection stack for lab and educational use: one Go binary, YAML rules you can read in an afternoon, and a kill-chain correlator you can audit line by line.",
  },
  {
    q: "Does it depend on Sysmon?",
    a: "No. The Rust sensor collects ETW kernel-process providers on Windows and refuses unsupported platforms. The Sysmon path is an alternative. The engine accepts received records, from configured sensors and log providers; it does not manufacture telemetry when sensors are absent.",
  },
  {
    q: "Why the name bluetardigrade?",
    a: "Tardigrades are the most resilient animal we know of — surviving vacuum, radiation and starvation — and this project aims at the same trait: a single static binary, zero external dependencies at runtime, fail-loud degradation instead of silent rot.",
  },
  {
    q: "How do rules work?",
    a: "Plain YAML with 17 operators, per-rule MITRE ATT&CK tags and actions, hot-reloaded every 15 seconds. Community Sigma rules can be imported deterministically with `engine sigma`, provenance preserved.",
  },
  {
    q: "What does the console show?",
    a: "Only what the engine really delivers: live event feed, KPI dashboard, severity triage with free-text search, rule browser, kill-chain chains view, suppressions, a read-only active-response view with its forensic audit trail — plus an AI analyst you plug into your own OpenAI-compatible endpoint.",
  },
  {
    q: "Can the engine kill processes on its own?",
    a: "No. There is no automation path — rules, sequences and the correlator cannot reach the response surface. A named human operator calls one verified local kill through the API, behind an operator allowlist, protected-process names, per-host budgets and an append-only audit written before the signal. The console shows the audit read-only; it has no kill trigger.",
  },
  {
    q: "How fast is the pipeline?",
    a: "Measured, not assumed: ingest→alert p99 ≈ 0.4 ms on loopback with rules, correlation, beaconing and risk tracking active. The numbers and methodology are published in the README.",
  },
  {
    q: "Can I contribute?",
    a: "Yes — PRs are welcome. The roadmap is public, CI is SHA-pinned, and the OpenAPI spec is drift-guarded so integrations stay honest. Start with the docs map and the rule format reference.",
  },
];

export const TECH_STRIP = [
  "Rust",
  "Go 1.26",
  "ETW",
  "MITRE ATT&CK",
  "Sigma",
  "Next.js",
  "SQLite",
  "Elasticsearch",
  "Splunk",
  "Prometheus",
];
