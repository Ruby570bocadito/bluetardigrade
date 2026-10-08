package main

import (
	"flag"
	"log"
	"os"
	"time"
)

// options carries every runtime knob of the engine. It is shared by
// the legacy single-dash path and the "run" subcommand so both accept
// identical flags with identical defaults.
type options struct {
	addr             string
	apiAddr          string
	scenariosDir     string
	rulesDir         string
	adConfig         string
	seqDir           string
	beaconsFile      string
	thresholdsFile   string
	intelDir         string
	baselineLearn    time.Duration
	verbose          bool
	reloadEvery      time.Duration
	webhookURL       string
	webhookToken     string
	notifyPath       string
	elasticURL       string
	elasticIndex     string
	elasticAPIKey    string
	splunkURL        string
	splunkToken      string
	apiToken         string
	apiCert          string
	apiKey           string
	token            string
	prevToken        string
	ingestIdentities string
	enrollFile       string
	ingestCert       string
	ingestKey        string
	suppressionsFile string
	knownFile        string
	lifecycleFile    string
	incidentsFile    string
	storePath        string
	storeRetention   time.Duration
	forensic         bool
	redactSecrets    bool
	redactMode       string
	forensicDir      string
	pidFile          string
	apiWrite         bool
	apiAllowOpen     bool
	allowKill        bool
	respondOperators string
	respondProtected string
	respondAudit     string
}

// newRunFlagSet builds the flag set for the engine runtime. Every
// runtime flag keeps its name, default and usage string verbatim from
// the pre-CLI binary (the usage strings are part of the classic
// output); -i and --interactive are the only CLI additions and both
// point to the same bool. errMode is ExitOnError for the legacy path
// (so error/exit semantics stay byte-for-byte) and ContinueOnError for
// the run subcommand (which translates errors into its own help).
func newRunFlagSet(name string, o *options, interactive *bool, errMode flag.ErrorHandling) *flag.FlagSet {
	fs := flag.NewFlagSet(name, errMode)
	// Loopback defaults: the bundled sensors (collector, sf-sensor, the
	// Rust collector) all dial 127.0.0.1, so exposing the ingest and
	// the read-only API on every interface would hand the whole LAN
	// an unauthenticated event feed and a copy of the alert data.
	// Remote-sensor deployments must opt in explicitly, e.g.
	//   sf-engine -addr 0.0.0.0:7777 -api 0.0.0.0:7778
	// combined with the installer's -Firewall switch.
	fs.StringVar(&o.addr, "addr", "127.0.0.1:7777", "TCP listen address for sensor streams (use 0.0.0.0:7777 to accept remote sensors)")
	fs.StringVar(&o.apiAddr, "api", "127.0.0.1:7778", "local HTTP API for the console (stats/events/alerts/stream); 0 disables")
	fs.StringVar(&o.scenariosDir, "scenarios", "",
		"directory with the detection-validation scenarios (SIM-4: arms GET/POST /api/scenarios* to replay the inert library against the live rules and keep the run history); empty disables")
	fs.StringVar(&o.adConfig, "ad", "",
		"YAML config for the read-only Active Directory connector (AD-1: LDAPS or explicit StartTLS with a configured CA, a least-privilege service account, RFC 2696 paging and an object cap; the password lives in its own file; requires -store); empty disables")
	fs.StringVar(&o.rulesDir, "rules", "./rules", "directory with YAML rules")
	fs.StringVar(&o.seqDir, "sequences", "./sequences", "directory with YAML kill-chain sequences (correlator)")
	fs.StringVar(&o.intelDir, "intel", "./intel",
		"directory of offline threat-intelligence lists (*.txt/*.list: IPs, CIDRs, domains, URLs, file hashes), re-read when it changes; empty disables")
	fs.DurationVar(&o.baselineLearn, "baseline-learn", envDuration("SF_BASELINE_LEARN", 24*time.Hour),
		"per-host learning period before never-seen processes raise a low alert (0 disables; falls back to SF_BASELINE_LEARN)")
	fs.StringVar(&o.beaconsFile, "beacons", "./beacons.yaml", "YAML file with beacon detector profiles (C2 call-home detection over network.connect); empty disables")
	fs.StringVar(&o.thresholdsFile, "thresholds", "./thresholds.yaml", "YAML file with volumetric threshold definitions (A2: brute force, mass deletion, sprays); empty disables")
	fs.BoolVar(&o.verbose, "v", false, "print every event received")
	fs.DurationVar(&o.reloadEvery, "reload-every", 15*time.Second,
		"hot-reload interval for the rules directory (0 disables)")
	fs.StringVar(&o.webhookURL, "webhook", "",
		"POST every alert as JSON to this URL (SIEM/SOAR connector; falls back to SF_WEBHOOK_URL); empty disables")
	fs.StringVar(&o.webhookToken, "webhook-token", "",
		"Bearer token sent on every webhook delivery as 'Authorization: Bearer' (falls back to SF_WEBHOOK_TOKEN); empty disables the header")
	fs.StringVar(&o.notifyPath, "notify", "",
		"YAML config with external notification channels (slack, telegram, email); loaded fail-loud at startup; empty disables")
	fs.StringVar(&o.elasticURL, "elastic", "",
		"Elasticsearch base URL for SIEM indexing (e.g. http://127.0.0.1:9200); alerts are bulk-indexed into <index>-YYYY.MM.DD with a deterministic _id per alert, so retries never duplicate; empty disables")
	fs.StringVar(&o.elasticIndex, "elastic-index", "sf-alerts",
		"index name prefix used with -elastic (daily suffix YYYY.MM.DD in UTC is appended)")
	fs.StringVar(&o.elasticAPIKey, "elastic-api-key", "",
		"Elasticsearch API key sent as 'Authorization: ApiKey' on every bulk request (falls back to SF_ELASTIC_API_KEY); empty disables the header")
	fs.StringVar(&o.splunkURL, "splunk", "",
		"Splunk HEC collector base URL (e.g. https://splunk.example:8088); alerts are POSTed to /services/collector/event; empty disables")
	fs.StringVar(&o.splunkToken, "splunk-token", "",
		"Splunk HEC ingestion token sent as 'Authorization: Splunk' on every event (falls back to SF_SPLUNK_TOKEN); empty disables the header")
	fs.StringVar(&o.apiToken, "api-token", "",
		"bearer token the local API requires on /api/* (falls back to SF_API_TOKEN); /api/health stays open; empty disables")
	fs.StringVar(&o.apiCert, "api-cert", "",
		"TLS certificate (PEM) for the HTTP API listener; requires -api-key; hot-rotated on file mtime change; empty keeps plain HTTP")
	fs.StringVar(&o.apiKey, "api-key", "",
		"TLS private key (PEM) for the HTTP API listener; requires -api-cert; empty keeps plain HTTP")
	fs.BoolVar(&o.apiWrite, "api-write", false,
		"arm POST/DELETE /api/suppressions (writes land on the -suppressions file; refused at startup when the API has no token beyond loopback; falls back to SF_API_WRITE=1)")
	fs.BoolVar(&o.apiAllowOpen, "api-allow-open", false,
		"explicitly allow the API to bind beyond loopback WITHOUT a token (default is fail-closed: a non-loopback bind with no -api-token/SF_API_TOKEN refuses to start); intended for firewalled lab networks where an unauthenticated read-only console is accepted")
	fs.BoolVar(&o.allowKill, "allow-kill", false,
		"arm POST /api/respond/kill (active response, kill_process, SIGKILL fixed); REQUIRES -api-token/SF_API_TOKEN even on loopback; requires -respond-audit to open, or the surface stays disabled; the process-name check protects against killing the wrong PID, not against malware disguising its identity - the kill decision belongs to a human operator (falls back to SF_ALLOW_KILL=1)")
	fs.StringVar(&o.respondOperators, "respond-operators", "./respond-operators.yaml",
		"YAML allowlist ({version: 1, names: [ana, beto]}, or {version: 2, operators: [{name, token_sha256}]} with per-operator credentials sent as X-SF-Operator-Token) of operators allowed to run active response actions; missing file = empty allowlist = every action denied; malformed file = fatal; hot-reloaded on the -reload-every ticker")
	fs.StringVar(&o.respondProtected, "respond-protected", "",
		"optional YAML ({version: 1, names: [...]}) with extra protected process names, merged with the platform defaults (Windows: csrss/smss/wininit/services/lsass); missing file = defaults only; malformed file = fatal; hot-reloaded")
	fs.StringVar(&o.respondAudit, "respond-audit", "./respond-audit.jsonl",
		"append-only JSONL audit file, one line per attempt (denials included), fsync per line, 64 MiB ceiling (beyond it every action denies with audit_unavailable until the file is rotated)")
	fs.StringVar(&o.token, "token", "",
		"shared token sensors must send as 'AUTH <token>' on connect (falls back to SF_INGEST_TOKEN); empty disables auth")
	fs.StringVar(&o.prevToken, "token-previous", "",
		"previous ingest token, still accepted during a rotation window (falls back to SF_INGEST_TOKEN_PREVIOUS); requires -token")
	fs.StringVar(&o.ingestIdentities, "ingest-identities", "",
		"YAML file of per-sensor ingest identities (own token as sha256 + bound hosts; see 'engine ingest-identity'); events for hosts outside a sensor's binding are refused; hot-reloaded; falls back to SF_INGEST_IDENTITIES; empty disables")
	fs.StringVar(&o.enrollFile, "enroll", "",
		"JSON state file of sensor enrollment: sensors join with a token from the console ('ENROLL <token> <host>'), wait for approval and then connect with a credential of their own; only accepted over TLS or from loopback; every connection must then authenticate; falls back to SF_ENROLL; empty disables")
	fs.StringVar(&o.ingestCert, "ingest-cert", "",
		"TLS certificate (PEM) for the ingest listener; requires -ingest-key; empty keeps plain TCP")
	fs.StringVar(&o.ingestKey, "ingest-key", "",
		"TLS private key (PEM) for the ingest listener; requires -ingest-cert; empty keeps plain TCP")
	fs.StringVar(&o.suppressionsFile, "suppressions", "./suppressions.yaml",
		"operator allowlist YAML silencing rule/host pairs (expires supported); empty disables")
	fs.StringVar(&o.knownFile, "known-software", "./known-software.yaml",
		"known-software YAML (§2.2): events matching an entry carry enrichment.known_software, the baseline stops reporting them as novelties and the noise report stops counting them as noise; hot-reloaded; empty disables")
	fs.StringVar(&o.lifecycleFile, "lifecycle", "./alert-lifecycle.json",
		"JSON file persisting alert triage status (acknowledged/closed + notes); empty keeps statuses in memory only")
	fs.StringVar(&o.incidentsFile, "incidents", "./incidents.json",
		"JSON file persisting incidents (cases grouping alerts, with status, owner and timeline); empty keeps them in memory only")
	fs.StringVar(&o.storePath, "store", "",
		"SQLite file persisting events and alerts beyond the in-memory rings (e.g. ./sf-store.db); empty disables")
	fs.DurationVar(&o.storeRetention, "store-retention", 72*time.Hour,
		"delete stored events/alerts older than this on a 5-minute ticker (0 keeps everything)")
	fs.BoolVar(&o.forensic, "forensic", true,
		"freeze an evidence bundle (alert + 5m host timeline) for every high/critical alert; -forensic=false disables")

	fs.BoolVar(&o.redactSecrets, "redact-secrets", envBool("SF_REDACT_SECRETS", true),
		"scrub credential-shaped values (passwords, tokens, keys) out of alert free text before any surface ships it - console, JSON, API, webhook, SIEM; raw events are never rewritten; -redact-secrets=false keeps raw evidence (laboratory; falls back to SF_REDACT_SECRETS=0)")
	fs.StringVar(&o.redactMode, "redact-mode", envString("SF_REDACT_MODE", "tail4"),
		"how much of a scrubbed secret survives: tail4 keeps the last 4 characters for triage, full removes it entirely (falls back to SF_REDACT_MODE)")
	fs.StringVar(&o.forensicDir, "forensic-dir", "",
		"directory for forensic evidence bundles (default: <forensics> resolved next to the rules directory)")
	fs.StringVar(&o.pidFile, "pidfile", "",
		"write the process PID here at startup and remove it on shutdown (lets sf-console -Stop stop an engine it did not start)")
	// CLI additions: single panel over the running engine.
	fs.BoolVar(interactive, "i", false, "interactive panel (TUI) on top of the running engine; needs a TTY")
	fs.BoolVar(interactive, "interactive", false, "alias of -i")
	return fs
}

// envDuration reads a duration from the environment, or def when unset
// or unparseable (with a warning: a typo must not pass silently).
func envBool(key string, def bool) bool {
	if v := os.Getenv(key); v != "" {
		switch v {
		case "1", "true", "yes":
			return true
		case "0", "false", "no":
			return false
		default:
			log.Printf("[ENGINE] %s=%q is not a valid boolean; using %v", key, v, def)
		}
	}
	return def
}

func envString(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func envDuration(key string, def time.Duration) time.Duration {
	if v := os.Getenv(key); v != "" {
		if d, err := time.ParseDuration(v); err == nil && d >= 0 {
			return d
		}
		log.Printf("[ENGINE] %s=%q is not a valid duration (examples: 30m, 24h, 0); using %s", key, v, def)
	}
	return def
}
