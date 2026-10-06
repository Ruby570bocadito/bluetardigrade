package main

import (
	"context"
	"fmt"
	"io"
	"log"
	"os"
	"os/signal"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/actions"
	"github.com/Ruby570bocadito/bluetardigrade/internal/ad"
	"github.com/Ruby570bocadito/bluetardigrade/internal/alert"
	"github.com/Ruby570bocadito/bluetardigrade/internal/api"
	"github.com/Ruby570bocadito/bluetardigrade/internal/baseline"
	"github.com/Ruby570bocadito/bluetardigrade/internal/beacon"
	"github.com/Ruby570bocadito/bluetardigrade/internal/correlate"
	"github.com/Ruby570bocadito/bluetardigrade/internal/enrich"
	"github.com/Ruby570bocadito/bluetardigrade/internal/enroll"
	"github.com/Ruby570bocadito/bluetardigrade/internal/fleet"
	"github.com/Ruby570bocadito/bluetardigrade/internal/forensic"
	"github.com/Ruby570bocadito/bluetardigrade/internal/incident"
	"github.com/Ruby570bocadito/bluetardigrade/internal/ingest"
	"github.com/Ruby570bocadito/bluetardigrade/internal/intel"
	"github.com/Ruby570bocadito/bluetardigrade/internal/known"
	"github.com/Ruby570bocadito/bluetardigrade/internal/lifecycle"
	"github.com/Ruby570bocadito/bluetardigrade/internal/notify"
	"github.com/Ruby570bocadito/bluetardigrade/internal/redact"
	"github.com/Ruby570bocadito/bluetardigrade/internal/reputation"
	"github.com/Ruby570bocadito/bluetardigrade/internal/respond"
	"github.com/Ruby570bocadito/bluetardigrade/internal/rules"
	"github.com/Ruby570bocadito/bluetardigrade/internal/scenrun"
	"github.com/Ruby570bocadito/bluetardigrade/internal/siem"
	"github.com/Ruby570bocadito/bluetardigrade/internal/store"
	"github.com/Ruby570bocadito/bluetardigrade/internal/suppress"
	"github.com/Ruby570bocadito/bluetardigrade/internal/threshold"
	"github.com/Ruby570bocadito/bluetardigrade/internal/webhook"
	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
)

// runEngine boots the whole detection pipeline. It is the exact logic
// the pre-CLI binary executed in main(), with two presentation-level
// additions: the shared liveStats hooks and the optional interactive
// panel (a TUI that renders what the engine is already doing; when
// stdout is not a TTY the request degrades to the classic flat run).
func runEngine(o *options, interactive bool) error {
	if o.webhookURL == "" {
		o.webhookURL = os.Getenv("SF_WEBHOOK_URL")
	}
	ctx, stop := signal.NotifyContext(context.Background(),
		os.Interrupt, syscall.SIGTERM)
	defer stop()

	tui := interactive && stdoutIsTTY()
	if interactive && !tui {
		fmt.Println("[ENGINE] interactive requested but stdout is not a TTY; running in plain mode")
	}
	stats := newLiveStats()

	// PID file: lets sf-console -Stop (and operators) stop this engine
	// even when it was launched by the autostart entry, not by sf-console.
	if o.pidFile != "" {
		if err := os.WriteFile(o.pidFile, []byte(fmt.Sprint(os.Getpid())), 0o600); err != nil {
			log.Printf("[ENGINE] pidfile %s: %v", o.pidFile, err)
		} else {
			defer func() { _ = os.Remove(o.pidFile) }() // best effort on graceful paths
		}
	}

	// rules dir: explicit flag > rules next to the executable (so
	// the installed sf-engine.exe needs no wrapper)
	rulesPath := resolveDataDir(o.rulesDir, "rules")
	engine, err := rules.LoadDir(rulesPath)
	if err != nil {
		log.Fatalf("[ENGINE] loading rules from %s: %v", rulesPath, err)
	}
	fmt.Printf("[ENGINE] %d rules loaded from %s (types: %v)\n",
		engine.Count(), rulesPath, engine.Types())
	stats.setRuleCatalog(engine.Snapshot())

	// kill-chain sequences: same resolution order as the rules dir
	seqPath := resolveDataDir(o.seqDir, "sequences")
	var corr *correlate.Manager
	if dirExists(seqPath) {
		if corr, err = correlate.LoadDir(seqPath, nil); err != nil {
			log.Fatalf("[ENGINE] loading sequences from %s: %v", seqPath, err)
		}
		if n := corr.Count(); n > 0 {
			fmt.Printf("[ENGINE] %d sequences loaded from %s (correlator on: %v)\n",
				n, seqPath, corr.Names())
		}
	}
	// beaconing detector (A3): one YAML file of profiles. Missing
	// file = detector off (the sequences-dir convention); a file that
	// exists but does not parse is FATAL (the suppressions standard:
	// a control the operator believes is armed must not silently stay
	// off).
	var bcn *beacon.Manager
	bcnPath := ""
	if o.beaconsFile != "" {
		bcnPath = resolveDataFile(o.beaconsFile, "beacons.yaml")
		if fileExists(bcnPath) {
			if bcn, err = beacon.LoadFile(bcnPath, nil); err != nil {
				log.Fatalf("[ENGINE] loading beacons from %s: %v", bcnPath, err)
			}
			if n := bcn.Count(); n > 0 {
				fmt.Printf("[ENGINE] %d beacon profiles loaded from %s (beaconing detection on: %v)\n",
					n, bcnPath, bcn.Names())
			}
		}
	}

	// volumetric threshold detector (A2): same file convention as the
	// beacons — missing file = detector off, malformed file = FATAL.
	var thr *threshold.Detector
	thrPath := ""
	if o.thresholdsFile != "" {
		thrPath = resolveDataFile(o.thresholdsFile, "thresholds.yaml")
		if fileExists(thrPath) {
			if thr, err = threshold.LoadFile(thrPath); err != nil {
				log.Fatalf("[ENGINE] loading thresholds from %s: %v", thrPath, err)
			}
			if n := thr.Count(); n > 0 {
				fmt.Printf("[ENGINE] %d threshold definitions loaded from %s (volumetric detection on: %v)\n",
					n, thrPath, thr.Names())
			}
		}
	}

	// offline threat-intelligence lists: a missing directory means no
	// lists; an unreadable list is logged and retried on every reload
	// (the operator fixes the file, the engine picks it up)
	var intelM *intel.Matcher
	intelErr := ""
	if o.intelDir != "" {
		intelPath := resolveDataDir(o.intelDir, "intel")
		var ierr error
		if intelM, ierr = intel.Load(intelPath); ierr != nil {
			intelErr = ierr.Error()
			log.Printf("[ENGINE] threat-intel lists from %s NOT loaded: %v", intelPath, ierr)
		}
		if n := intelM.Total(); n > 0 {
			fmt.Printf("[ENGINE] threat intel: %d indicators in %d lists from %s\n", n, len(intelM.Lists()), intelPath)
		}
	}

	// optional SQLite persistence (phase 2 storage stone): when the
	// operator asks for a store, a failure to open it is a config
	// error and FATAL, by the same standard as a malformed
	// suppressions file — a control the operator believes is armed
	// must not silently stay off.
	var st *store.Store
	if o.storePath != "" {
		st, err = store.Open(o.storePath)
		if err != nil {
			log.Fatalf("[ENGINE] %v", err)
		}
		defer st.Close()
		if o.storeRetention > 0 {
			fmt.Printf("[ENGINE] store on %s (retention %s)\n", o.storePath, o.storeRetention)
		} else {
			fmt.Printf("[ENGINE] store on %s (retention: keep forever)\n", o.storePath)
		}
		// first prune right away, then on a ticker; only loud
		// when something was actually removed
		if o.storeRetention > 0 {
			if dEv, dAl, perr := st.Prune(o.storeRetention); perr == nil && dEv+dAl > 0 {
				fmt.Printf("[ENGINE] store pruned %d events / %d alerts older than %s\n", dEv, dAl, o.storeRetention)
			}
		}
	}

	// operator allowlist: alert suppressions (rule + host, optional
	// expiration), hot-reloaded on the same ticker as rules. A malformed
	// file is FATAL at startup: failing open would silently disable a
	// control the operator believes is armed.
	supMgr := suppress.New()
	supPath := resolveDataFile(o.suppressionsFile, "suppressions.yaml")
	supCount := 0
	if o.suppressionsFile != "" {
		if err := supMgr.LoadFile(supPath); err != nil {
			log.Fatalf("[ENGINE] %v", err)
		}
		supCount = supMgr.Count(time.Now())
		if supCount > 0 {
			fmt.Printf("[ENGINE] %d suppressions active from %s\n", supCount, supPath)
		}
	}

	// §2.2 known-software list: events matching an entry carry
	// enrichment.known_software (the event is never deleted or hidden).
	// Hot-reloaded on the same ticker as rules; a malformed file is
	// FATAL at startup, like the suppressions file — failing open would
	// silently disarm a list the operator believes is armed.
	knownMgr := known.New()
	knownPath := ""
	knownCount := 0
	if o.knownFile != "" {
		knownPath = resolveDataFile(o.knownFile, "known-software.yaml")
		if err := knownMgr.LoadFile(knownPath); err != nil {
			log.Fatalf("[ENGINE] %v", err)
		}
		knownCount = knownMgr.Count()
		if knownCount > 0 {
			fmt.Printf("[ENGINE] %d known-software entries from %s\n", knownCount, knownPath)
		}
	}

	// forensic flight recorder + evidence bundles: every high/critical
	// alert freezes the host's surrounding timeline to disk so an
	// investigation never depends on the ring not having rotated or on
	// SQLite being enabled. Off is off: -forensic=false keeps nothing.
	var fore *forensic.Recorder
	if o.forensic {
		foreDir := o.forensicDir
		if foreDir == "" {
			// same resolution order as rules/sequences: the installed
			// engine finds <forensics> next to its own tree
			foreDir = resolveDataDir("./forensics", "forensics")
		}
		fore = forensic.New(foreDir)
		fmt.Printf("[ENGINE] forensic: evidence bundles for high/critical alerts -> %s (window %s, disk-capped)\n",
			foreDir, forensic.CaptureWindow)
	}

	events := make(chan *model.Event, 1024)

	// ingest TLS: both flag halves are required so a half-set deployment
	// fails at startup instead of silently serving the feed in clear
	// text. Validation happens BEFORE the bind: a wrong pair must not
	// race with an already-usable listener.
	if (o.ingestCert == "") != (o.ingestKey == "") {
		if o.ingestCert == "" {
			return fmt.Errorf("ingest TLS requires -ingest-cert too (-ingest-key was set; pass both or neither)")
		}
		return fmt.Errorf("ingest TLS requires -ingest-key too (-ingest-cert was set; pass both or neither)")
	}

	// alert lifecycle (r6): operator triage state (acknowledged/closed +
	// notes) served by POST /api/alerts/{id}/status. A malformed file
	// is FATAL, same standard as suppressions: silently starting with
	// every alert back in "new" would undo triage work the operator
	// believes is recorded.
	lifePath := ""
	if o.lifecycleFile != "" {
		lifePath = resolveDataFile(o.lifecycleFile, "alert-lifecycle.json")
	}
	lifeStore, err := lifecycle.New(lifePath)
	if err != nil {
		log.Fatalf("[ENGINE] %v", err)
	}
	if lifePath != "" {
		if n := lifeStore.Count(); n > 0 {
			fmt.Printf("[ENGINE] alert lifecycle: %d triage states loaded from %s\n", n, lifePath)
		}
	} else {
		fmt.Println("[ENGINE] alert lifecycle: in-memory only (-lifecycle unset: statuses reset on restart)")
	}

	// incidents: cases grouping alerts (internal/incident). Same fatal
	// standard as the lifecycle file: a malformed file would silently
	// drop the cases the operators believe are recorded.
	incPath := ""
	if o.incidentsFile != "" {
		incPath = resolveDataFile(o.incidentsFile, "incidents.json")
	}
	incStore, err := incident.New(incPath)
	if err != nil {
		log.Fatalf("[ENGINE] %v", err)
	}
	if incPath == "" {
		fmt.Println("[ENGINE] incidents: in-memory only (-incidents unset: cases reset on restart)")
	} else if open, total := incStore.Counts(); total > 0 {
		fmt.Printf("[ENGINE] incidents: %d loaded (%d open) from %s\n", total, open, incPath)
	}

	var server *ingest.Server
	if o.ingestCert != "" {
		server, err = ingest.NewTLS(o.addr, o.ingestCert, o.ingestKey, events)
	} else {
		server, err = ingest.New(o.addr, events)
	}
	if err != nil {
		// A bind failure almost always means another engine
		// instance is already running (e.g. started by
		// sf-sensor or sf-console). Probe the port instead of
		// comparing errno: bind error text is locale-dependent
		// on Windows ("Solo se permite un uso de cada...").
		if listening(o.addr) {
			if o.apiAddr != "0" && apiHealthy(o.apiAddr) {
				fmt.Printf("[ENGINE] another engine instance is already running (ingest %s, api %s)\n",
					o.addr, o.apiAddr)
			} else {
				fmt.Printf("[ENGINE] cannot bind %s: another process is already listening on it\n", o.addr)
			}
			fmt.Println("[ENGINE]   view alerts:  sf-console   (web UI)")
			fmt.Println("[ENGINE]   stop it:      sf-console -Stop")
			return nil
		}
		log.Fatalf("[ENGINE] %v", err)
	}
	// shared-token auth: flag wins over the env var, so operators
	// can override SF_INGEST_TOKEN per process without touching the
	// autostart entry. The bundled sensors honor the same env var.
	// Every credential is configured BEFORE Serve starts: a connection
	// accepted earlier would be handled as unauthenticated (and read
	// the token fields while they are being written).
	ingestToken := o.token
	if ingestToken == "" {
		ingestToken = os.Getenv("SF_INGEST_TOKEN")
	}
	server.SetToken(ingestToken)
	if server.AuthEnabled() {
		// rotation window: flag wins over the env var, mirroring
		// the primary token resolution order
		prev := o.prevToken
		if prev == "" {
			prev = os.Getenv("SF_INGEST_TOKEN_PREVIOUS")
		}
		server.SetPreviousToken(prev)
	}
	identitiesPath := o.ingestIdentities
	if identitiesPath == "" {
		identitiesPath = os.Getenv("SF_INGEST_IDENTITIES")
	}
	if identitiesPath != "" {
		ids, ierr := ingest.LoadIdentities(identitiesPath)
		if ierr != nil {
			log.Fatalf("[ENGINE] %v", ierr)
		}
		server.SetIdentities(ids)
		fmt.Printf("[ENGINE] ingest identities: %d per-sensor credentials bound to their hosts (%s)\n", len(ids), identitiesPath)
	}
	// sensor enrollment (internal/enroll): tokens from the console,
	// approval by an administrator, credentials bound to their host
	enrollPath := o.enrollFile
	if enrollPath == "" {
		enrollPath = os.Getenv("SF_ENROLL")
	}
	var enrollReg *enroll.Registry
	if enrollPath != "" {
		enrollReg, err = enroll.Open(enrollPath)
		if err != nil {
			log.Fatalf("[ENGINE] %v", err)
		}
		enrollReg.SetBoundElsewhere(server.BoundIdentity)
		enrollReg.SetOnWithdraw(func(name string) {
			if n := server.DropIdentity(name); n > 0 {
				log.Printf("[ENROLL] %s withdrawn: closed %d open connection(s)", name, n)
			}
		})
		server.SetEnroller(enroll.Gate{Registry: enrollReg, Logf: log.Printf})
		pending, active, usable := enrollReg.Counts()
		fmt.Printf("[ENGINE] enrollment: ON (%s): %d active, %d pending, %d usable tokens\n", enrollPath, active, pending, usable)
		if o.ingestCert == "" && !isLoopback(o.addr) {
			fmt.Println("[ENGINE] enrollment: the ingest is plain TCP beyond loopback, so ENROLL is only accepted from this machine until -ingest-cert/-ingest-key are set (the credential must not cross the network in clear)")
		}
	}
	// machine inventory (internal/fleet): every accepted event and the
	// sensors' heartbeats; read through GET /api/fleet
	// per-host baseline of processes already seen (internal/baseline)
	baseTracker := baseline.New(o.baselineLearn)
	if st != nil {
		if entries, hosts, berr := st.LoadBaseline(); berr != nil {
			log.Printf("[BASELINE] restoring FAILED: %v", berr)
		} else {
			restored := make([]baseline.Entry, 0, len(entries))
			for _, e := range entries {
				restored = append(restored, baseline.Entry{Host: e.Host, Kind: e.Kind, Value: e.Value, FirstSeen: e.FirstSeen})
			}
			baseTracker.Restore(restored, hosts)
		}
	}
	fleetTracker := fleet.New()
	if st != nil {
		// with -store the inventory survives restarts; restored hosts
		// get a full grace before they can be declared silent
		if docs, ferr := st.LoadFleetHosts(); ferr != nil {
			log.Printf("[FLEET] restoring the inventory FAILED: %v", ferr)
		} else if n := fleetTracker.Restore(docs, time.Now()); n > 0 {
			fmt.Printf("[ENGINE] fleet: %d machines restored from the store\n", n)
		}
	}
	server.SetObserver(fleetTracker)
	go server.Serve()
	if server.AuthEnabled() {
		fmt.Println(ingestAuthBanner(server.Rotating(), ingestToken, server.Identities()))
	} else if strings.HasPrefix(server.Addr(), "127.0.0.1:") || strings.HasPrefix(server.Addr(), "[::1]:") {
		fmt.Println("[ENGINE] ingest auth: disabled (loopback bind only - fine for local demos)")
	} else {
		fmt.Println("[ENGINE] WARNING: non-loopback ingest WITHOUT a token: any host that reaches this port can inject events. Set -token or SF_INGEST_TOKEN.")
	}
	fmt.Printf("[ENGINE] listening on %s (NDJSON, 1 event per line)\n", server.Addr())
	if server.TLS() {
		fmt.Printf("[ENGINE] ingest TLS: ENABLED (cert %s; sensors connect with -tls -ca <ca.pem>; certificate hot-reload on file change)\n", o.ingestCert)
		// rotation events go out in the engine's own voice: the
		// ingest package stays silent, the operator sees a line
		// per reload outcome with the running counters
		server.SetReloadNotify(func(event string, reloads, reloadErrs uint64) {
			fmt.Printf("[ENGINE] ingest TLS: %s (reloads=%d, reload_errors=%d)\n", event, reloads, reloadErrs)
		})
	}

	// local read-only API: stats, recent events/alerts, rules, SSE
	var hub *api.Hub
	apiAddr := ""
	// resolved once here so the active-response arming below can
	// apply its token layer without duplicating the flag>env order
	apiTok := ""
	// SET-3: ingest→alert latency ring (the API closure reads it; the
	// observer is attached to the alert manager once it exists).
	latTracker := newAlertLatencyTracker(1024)
	if o.apiAddr != "0" {
		// API TLS: symmetric with the ingest listener — the pair
		// is validated up front (cert without key or vice versa
		// is a config error, not a silent plain-text fallback,
		// because the operator asked for encryption and would
		// otherwise believe they have it).
		if (o.apiCert == "") != (o.apiKey == "") {
			log.Fatalf("[ENGINE] -api-cert and -api-key must be set together (got cert=%q key=%q)", o.apiCert, o.apiKey)
		}
		if o.apiCert != "" {
			hub, err = api.NewTLS(o.apiAddr, o.apiCert, o.apiKey)
		} else {
			hub, err = api.New(o.apiAddr)
		}
		if err != nil {
			log.Printf("[ENGINE] api disabled: %v", err)
			hub = nil
		} else {
			if hub.TLS() {
				// rotation events go out in the engine's own voice,
				// the same contract as the ingest TLS banner.
				hub.SetReloadNotify(func(event string, reloads, reloadErrs uint64) {
					fmt.Printf("[ENGINE] api TLS: %s (reloads=%d, reload_errors=%d)\n", event, reloads, reloadErrs)
				})
				fmt.Println("[ENGINE] api TLS: ENABLED (hot-rotated on cert/key mtime change)")
			}
			hub.SetRules(engine)
			hub.SetSuppressions(supMgr)
			hub.SetKnownSoftware(knownMgr)
			if st != nil {
				hub.SetStore(st)
			}
			hub.SetCounters(func() (uint64, uint64, uint64) {
				return server.Received(), server.Dropped(), server.Rejected()
			})
			hub.SetIngestIdentityStats(func() (int, uint64) {
				return server.Identities(), server.IdentityViolations()
			})
			// kill-chain observability: in-flight states, loaded
			// sequences and the tracking cap, so the correlator's
			// silent failure mode (cap exhausted -> new hosts
			// untracked) is watchable from /api/stats
			hub.SetCorrelatorStats(func() (int, int, int) {
				if corr == nil {
					return 0, 0, 0
				}
				return corr.States(), corr.Count(), correlate.MaxTrackedStates
			})
			// beaconing observability (A3): same contract as the
			// correlator above — live keys holding in-window evidence,
			// the hard cap and fires since startup, so the
			// silent-detection-loss failure mode (cap exhausted) is
			// watchable from /api/stats too.
			hub.SetBeaconStats(func() (int, int, uint64) {
				if bcn == nil {
					return 0, 0, 0
				}
				return bcn.Tracked(time.Now()), beacon.MaxKeys, bcn.Fired()
			})
			// threshold observability (A2): same contract — loaded
			// definitions, live keys and fires, so the detector's
			// failure mode (quota saturated) is watchable from
			// /api/stats.
			hub.SetThresholdStats(func() (int, int, uint64) {
				if thr == nil {
					return 0, 0, 0
				}
				return thr.Count(), thr.KeysTracked(), thr.Fired()
			})
			hub.SetSequences(corr)
			hub.SetLifecycle(lifeStore)
			hub.SetIncidents(incStore)
			hub.SetFleet(fleetTracker)
			if enrollReg != nil {
				hub.SetEnrollment(enrollReg)
			}
			if intelM != nil {
				hub.SetIntel(intelM)
			}
			hub.SetBaseline(baseTracker)
			// reputation lookups stay off unless the operator sets a
			// provider key; keys come from the environment only (a flag
			// would show them in the process list)
			if rep := reputation.New(os.Getenv("SF_VT_API_KEY"), os.Getenv("SF_ABUSEIPDB_API_KEY")); rep.Any() {
				hub.SetReputation(rep)
				p := rep.Providers()
				fmt.Printf("[ENGINE] reputation lookups on demand: virustotal=%v abuseipdb=%v\n", p["virustotal"], p["abuseipdb"])
			}
			hub.SetForensic(fore)
			// same standard as the ingest token: flag wins, env fallback
			apiTok = o.apiToken
			if apiTok == "" {
				apiTok = os.Getenv("SF_API_TOKEN")
			}
			hub.SetToken(apiTok)
			if apiTok != "" {
				fmt.Println("[ENGINE] api auth: ENABLED (Authorization: Bearer required; /api/health stays open for probes)")
			} else if !isLoopback(hub.Addr()) {
				fmt.Println("[ENGINE] WARNING: API bound beyond loopback WITHOUT a token: anything that reaches this port can read every event and alert. Set -api-token or SF_API_TOKEN.")
			}
			// suppression writes (Director decision 6.1): the write
			// surface is opt-in and inherits the bearer gate; a
			// non-loopback bind without a token refuses it at startup
			// because unauthenticated writes could silence detections.
			apiWrite := o.apiWrite || os.Getenv("SF_API_WRITE") == "1"
			switch {
			case !apiWrite:
			case o.suppressionsFile == "":
				fmt.Println("[ENGINE] api write: -api-write ignored, -suppressions is disabled (no file to write)")
			case apiTok == "" && !isLoopback(hub.Addr()):
				fmt.Println("[ENGINE] WARNING: -api-write refused: the API has no bearer token and is bound beyond loopback - unauthenticated writes could silence detections. Set -api-token or SF_API_TOKEN.")
			default:
				hub.EnableSuppressionsWrite(supPath)
				fmt.Printf("[ENGINE] api write: ENABLED (POST/DELETE /api/suppressions -> %s)\n", supPath)
			}
			// detection-validation battery (SIM-4): armed only
			// with -scenarios. The battery replays the inert
			// library against the LIVE rule set through the
			// isolated in-process runner (internal/scenario —
			// the same machinery the CI regression net uses),
			// so a validation run never touches the real
			// rings, store, webhook or stream. Meant for a
			// laboratory engine; the surface stays off unless
			// the operator asks for it.
			if o.scenariosDir != "" {
				var sink scenrun.RunSink
				if st != nil {
					sink = st
				}
				hub.SetScenarios(scenrun.New(o.scenariosDir, seqPath, scenrun.Deps{
					Rules: func() *rules.Engine { return engine },
					Sink:  sink,
					Logf:  log.Printf,
				}))
				history := "in memory"
				if st != nil {
					history = "in the store"
				}
				fmt.Printf("[ENGINE] scenarios: detection validation armed from %s (POST /api/scenarios/run; history %s)\n",
					o.scenariosDir, history)
			}

			// SET-3 platform status: engine version, ingest→alert
			// latency and both listeners' certificate expiry. The
			// console's view used to mark these "not published";
			// the engine publishes them from now on.
			hub.SetVersion(engineVersion)
			hub.SetAlertLatency(latTracker.snapshot)
			hub.SetIngestCertExpiry(server.CertExpiry)

			// Read-only Active Directory connector (AD-1/AD-2):
			// armed only with -ad AND a store (the snapshot is
			// persisted, never memory-only). The connector is
			// read-only by construction (bind + search only),
			// speaks LDAPS/StartTLS with the configured CA and a
			// least-privilege account, and pages with an object
			// cap. The posture analysis (AD-2) recomputes with
			// every completed sync.
			if o.adConfig != "" {
				if st == nil {
					log.Fatalf("[ENGINE] -ad requires -store: the directory snapshot is persisted to SQLite, never held in memory only")
				}
				adCfg, aerr := ad.Load(o.adConfig)
				if aerr != nil {
					log.Fatalf("[ENGINE] %v", aerr)
				}
				adConn, aerr := ad.New(adCfg, st, log.New(os.Stderr, "[AD] ", log.LstdFlags),
					func() []string {
						hosts := fleetTracker.Snapshot(time.Now())
						names := make([]string, 0, len(hosts))
						for _, fh := range hosts {
							names = append(names, fh.Host)
						}
						return names
					})
				if aerr != nil {
					log.Fatalf("[ENGINE] %v", aerr)
				}
				if aerr := adConn.Run(ctx); aerr != nil {
					log.Printf("[ENGINE] active directory: %v", aerr)
				}
				defer adConn.Stop()
				hub.SetAD(adConn)
				mode := "LDAPS"
				if adCfg.StartTLS {
					mode = "StartTLS"
				}
				fmt.Printf("[ENGINE] active directory: read-only connector armed (%s://%s:%d, interval %s; GET /api/ad/*)\n",
					mode, redact.EndpointLabel(adCfg.Server), adCfg.Port, adCfg.Interval)
			}
			go func() {
				if err := hub.Run(); err != nil {
					log.Printf("[ENGINE] api: %v", err)
				}
			}()
			apiAddr = hub.Addr()
			fmt.Printf("[ENGINE] api on %s (stats / events / alerts / rules / stream)\n", hub.Addr())
		}
	}

	// active response (C3, roadmap): the destructive surface is
	// opt-in by layers — flag AND bearer token AND an open audit
	// file — and its state is announced at startup, never guessed.
	// The token layer is stricter than the suppression writes it
	// replicates: kill requires a token EVEN on loopback (dictamen
	// 04-B: kill ≠ suppress). An audit open failure disables the
	// surface loudly and keeps detection alive (R5b: NOT fatal —
	// taking down the whole engine over a respond misconfig would
	// be the expensive failure direction).
	var respMgr *respond.Manager
	respOpsPath := ""
	respProtPath := ""
	if o.allowKill || os.Getenv("SF_ALLOW_KILL") == "1" {
		switch {
		case hub == nil:
			fmt.Println("[ENGINE] active response: kill_process disabled (-allow-kill set but the API is disabled)")
		case apiTok == "":
			fmt.Println("[ENGINE] active response: kill_process disabled (-allow-kill requires -api-token/SF_API_TOKEN: the token is mandatory even on loopback)")
		default:
			auditPath := resolveDataFile(o.respondAudit, "respond-audit.jsonl")
			audit, aerr := respond.OpenAudit(auditPath)
			if aerr != nil {
				fmt.Printf("[ENGINE] active response: kill_process disabled (the audit file could not be opened: %v)\n", aerr)
			} else {
				defer audit.Close()
				hostName := ""
				if hn, herr := os.Hostname(); herr == nil {
					hostName = hn
				}
				respMgr = respond.NewManager(hostName, audit)
				respOpsPath = resolveDataFile(o.respondOperators, "respond-operators.yaml")
				if fileExists(respOpsPath) {
					if err := respMgr.LoadOperators(respOpsPath); err != nil {
						log.Fatalf("[ENGINE] %v", err)
					}
				} else {
					fmt.Printf("[ENGINE] active response: WARNING -respond-operators %s not found: the allowlist is EMPTY and every action will be denied until the file lists operators\n", respOpsPath)
				}
				if o.respondProtected != "" {
					respProtPath = resolveDataFile(o.respondProtected, "respond-protected.yaml")
					if fileExists(respProtPath) {
						if err := respMgr.LoadProtected(respProtPath); err != nil {
							log.Fatalf("[ENGINE] %v", err)
						}
					}
				}
				hub.EnableRespondKill(respMgr)
				hub.SetRespondPaths(respOpsPath, respProtPath, auditPath)
				if audit.Size() >= respond.MaxAuditBytes {
					fmt.Println("[ENGINE] active response: WARNING the audit file is already at its 64 MiB ceiling: every action will deny with audit_unavailable until the file is rotated")
				}
				fmt.Printf("[ENGINE] active response: kill_process ENABLED (operators: %d, protected: %d, audit: %s, signal: SIGKILL fixed)\n",
					respMgr.OperatorsCount(), respMgr.ProtectedCount(), auditPath)
				if n := respMgr.OperatorsCount(); n > 0 && respMgr.CredentialedOperators() == 0 {
					fmt.Println("[ENGINE] active response: WARNING operators are listed by name only (version 1): anyone holding the API token can act as any of them; move to version 2 with per-operator credentials ('engine operator-credential --name <op>')")
				}
			}
		}
	} else {
		fmt.Println("[ENGINE] active response: kill_process disabled (-allow-kill not set)")
	}

	// outbound connector: alerts POSTed as JSON to a SIEM/SOAR
	// endpoint; delivery is async, bounded and never blocks the loop
	whCtx, whCancel := context.WithCancel(context.Background())
	var wh *webhook.Client
	if o.webhookURL != "" {
		wh = webhook.New(o.webhookURL)
		// outbound auth: flag wins over the env var, mirroring the
		// ingest token resolution order
		whToken := o.webhookToken
		if whToken == "" {
			whToken = os.Getenv("SF_WEBHOOK_TOKEN")
		}
		wh.SetToken(whToken)
		go wh.Run(whCtx)
		if hub != nil {
			hub.SetWebhookStats(wh.Stats)
		}
		if wh.TokenConfigured() {
			fmt.Printf("[ENGINE] webhook on %s (alerts POSTed as JSON, Authorization: Bearer enabled)\n", redact.EndpointLabel(o.webhookURL))
		} else {
			fmt.Printf("[ENGINE] webhook on %s (alerts POSTed as JSON, no auth header - set -webhook-token or SF_WEBHOOK_TOKEN)\n", redact.EndpointLabel(o.webhookURL))
		}
	}

	// external notifications (C2, roadmap): chat + mail channels fed
	// with the same alert stream the webhook sees. Fail loud: a
	// config that cannot be honored exactly stops the engine here,
	// because a channel that silently never fires is a silent control.
	var nt *notify.Service
	if o.notifyPath != "" {
		svc, err := notify.Load(o.notifyPath)
		if err != nil {
			// Same contract as every config surface: name the problem in
			// the log (legacyMain exits 1 silently), then stop the engine.
			log.Printf("[ENGINE] notify config rejected: %v", err)
			whCancel() // nothing started yet, but the webhook worker may be live
			return err
		}
		nt = svc
		go nt.Run(whCtx)
		if hub != nil {
			hub.SetNotifyStats(nt.Stats)
		}
		fmt.Printf("[ENGINE] notify: %d channel(s): %s\n", len(nt.Summary()), strings.Join(nt.Summary(), ", "))
	}

	// siem sinks: alerts indexed to Elasticsearch (_bulk, daily index,
	// deterministic _id) and/or POSTed to Splunk HEC. Same delivery
	// discipline as the webhook: async, bounded, never stalls the loop.
	sinkCtx, sinkCancel := context.WithCancel(context.Background())
	var elasticSink *siem.Elastic
	if o.elasticURL != "" {
		elasticSink, err = siem.NewElastic(o.elasticURL, o.elasticIndex)
		if err != nil {
			log.Fatalf("[ENGINE] %v", err)
		}
		// credential resolution: flag wins over the environment,
		// mirroring the ingest and webhook token order
		elasticKey := o.elasticAPIKey
		if elasticKey == "" {
			elasticKey = os.Getenv("SF_ELASTIC_API_KEY")
		}
		elasticSink.SetAPIKey(elasticKey)
		go elasticSink.Run(sinkCtx)
		if hub != nil {
			hub.SetElasticStats(elasticSink.Stats)
		}
		if elasticSink.APIKeyConfigured() {
			fmt.Printf("[ENGINE] elasticsearch on %s (alerts bulk-indexed as %s-YYYY.MM.DD, ApiKey auth enabled)\n", redact.EndpointLabel(o.elasticURL), o.elasticIndex)
		} else {
			fmt.Printf("[ENGINE] elasticsearch on %s (alerts bulk-indexed as %s-YYYY.MM.DD, no auth header - set -elastic-api-key or SF_ELASTIC_API_KEY)\n", redact.EndpointLabel(o.elasticURL), o.elasticIndex)
		}
	}
	var splunkSink *siem.Splunk
	if o.splunkURL != "" {
		splunkSink, err = siem.NewSplunk(o.splunkURL)
		if err != nil {
			log.Fatalf("[ENGINE] %v", err)
		}
		splunkTok := o.splunkToken
		if splunkTok == "" {
			splunkTok = os.Getenv("SF_SPLUNK_TOKEN")
		}
		splunkSink.SetToken(splunkTok)
		go splunkSink.Run(sinkCtx)
		if hub != nil {
			hub.SetSplunkStats(splunkSink.Stats)
		}
		if splunkSink.TokenConfigured() {
			fmt.Printf("[ENGINE] splunk hec on %s (alerts POSTed as events, Splunk token enabled)\n", redact.EndpointLabel(o.splunkURL))
		} else {
			fmt.Printf("[ENGINE] splunk hec on %s (alerts POSTed as events, no token - set -splunk-token or SF_SPLUNK_TOKEN)\n", redact.EndpointLabel(o.splunkURL))
		}
	}

	enricher := enrich.New()
	enricher.SetKnownSoftware(knownMgr) // empty manager = off

	// In TUI mode the panel owns the screen: raw alert lines would
	// corrupt the alt-buffer, so the console/JSON writer is muted and
	// the panel presents the alerts (the API hub and the webhook still
	// receive every one of them; the JSON stream is untouched in the
	// classic path and in the no-TTY degradation).
	alertOut := io.Writer(os.Stdout)
	if tui {
		alertOut = io.Discard
	}
	alerts := alert.New(alertOut, func(a alert.Alert) {
		stats.recordAlert(a)
		if fore != nil {
			// evidence first: the bundle freezes the timeline BEFORE
			// any downstream consumer can act on the alert (an active
			// response that kills the process tree must not erase the
			// record of what happened). Capture is a bounded write
			// (one JSON file, capped directory); failures are loud and
			// never stop the alert itself.
			if path, ok, ferr := fore.Capture(a, time.Now()); ferr != nil {
				log.Printf("[FORENSIC] bundle for alert %s FAILED: %v", a.ID, ferr)
			} else if ok && !tui {
				fmt.Printf("[FORENSIC] evidence bundle frozen for alert %s -> %s\n", a.ID, path)
			}
		}
		if hub != nil {
			hub.RecordAlert(a)
		} else if st != nil {
			// no API hub: persist directly so -store works
			// even with the API disabled
			if err := st.InsertAlert(a); err != nil {
				storeWriteErr(err)
			}
		}
		if wh != nil {
			wh.Handle(a)
		}
		if nt != nil {
			nt.Handle(a)
		}
		// siem sinks get every alert too; Handle never blocks (drops
		// are counted in the sink, surfaced via /api/stats)
		if elasticSink != nil {
			elasticSink.Handle(a)
		}
		if splunkSink != nil {
			splunkSink.Handle(a)
		}
	})
	// rule actions: rendered messages land inside the alert payload;
	// webhook deliveries run in the background and never stall intake
	dispatcher := actions.New(log.New(os.Stderr, "[ACTIONS] ", 0))
	alerts.SetPreparer(dispatcher.Prepare)
	// SET-3: every raised alert measures the ingest→alert latency.
	alerts.SetLatencyObserver(latTracker.Observe)

	// emitAllowlisted is the ONE suppression gate every secondary
	// emitter shares. Two thin forms over the same helper:
	//   - emitAllowlisted(a): aggregated emitters (kill-chains,
	//     beaconing, volumetric) pass no event, so a CONDITIONAL
	//     entry never silences them (§2.3: fail toward alerting).
	//   - emitAllowlistedEvent(ev, a): per-event emitters (intel,
	//     baseline novelty) pass the triggering event, so a
	//     conditional entry suppresses exactly the invocation shape
	//     it names.
	// In both forms a host with a suppressed rule is in an accepted
	// state, so an alert derived from its silenced evidence never
	// fires — a kill-chain built on suppressed steps, a beacon built
	// on silenced traffic or a volumetric alert fed by silenced
	// events would all be false positives.
	emitAllowlisted := func(a alert.Alert) {
		if suppressed(supMgr, a.RuleID, a.Host, nil, time.Now()) {
			return
		}
		alerts.Emit(a)
	}
	emitAllowlistedEvent := func(ev *model.Event, a alert.Alert) {
		if suppressed(supMgr, a.RuleID, a.Host, ev, time.Now()) {
			return
		}
		alerts.Emit(a)
	}
	if corr != nil {
		corr.SetEmit(emitAllowlisted)
	}
	if bcn != nil {
		bcn.SetEmit(emitAllowlisted)
	}
	// one "sensor sin señal" alert per outage of a sensor that sends
	// heartbeats; it goes through the same suppression gate, so a
	// planned maintenance can be silenced per host
	go func() {
		const every = 30 * time.Second
		t := time.NewTicker(every)
		defer t.Stop()
		last := time.Now()
		for {
			select {
			case <-ctx.Done():
				return
			case now := <-t.C:
				// wall clock (Round(0) drops the monotonic reading, which may
				// not count a system sleep): a gap far beyond the tick means
				// the engine itself was suspended, and its sensors with it
				if gap := now.Round(0).Sub(last.Round(0)); gap > 3*every {
					fleetTracker.Resume(now)
					log.Printf("[FLEET] engine was suspended for %s: sensors get a fresh grace", gap.Round(time.Second))
				}
				last = now
				for _, tr := range fleetTracker.Check(now) {
					if tr.Silent {
						emitAllowlisted(silentSensorAlert(tr.Host, now))
					}
				}
				// drained on every tick, with or without a store: without
				// one the pending lists would only grow
				learned := baseTracker.TakePending()
				retired := fleetTracker.TakeRetired()
				if st != nil {
					rows := make([]store.BaselineEntry, 0, len(learned))
					for _, e := range learned {
						rows = append(rows, store.BaselineEntry{Host: e.Host, Kind: e.Kind, Value: e.Value, FirstSeen: e.FirstSeen})
					}
					if err := st.AddBaseline(rows); err != nil {
						log.Printf("[BASELINE] saving FAILED: %v", err)
					}
					if err := st.SaveFleetHosts(fleetTracker.Export(false, now)); err != nil {
						log.Printf("[FLEET] saving the inventory FAILED: %v", err)
					}
					if err := st.DeleteFleetHosts(retired); err != nil {
						log.Printf("[FLEET] retiring hosts FAILED: %v", err)
					}
				}
			}
		}
	}()
	if thr != nil {
		// Threshold alerts NEVER feed the correlator (dictamen 04,
		// Q3): one threshold alert already aggregates N events, and
		// chaining it would break the "steps = atomic rules"
		// semantics of the sequencer. The suppression gate itself is
		// the shared one above.
		thr.SetEmit(emitAllowlisted)
	}

	// enrichment flight-recorder sweep: retire idle pid->identity
	// entries (30 min TTL) so a long-lived engine's parent map does
	// not leak dead pids. Reuses the reload cadence; a zero cadence
	// skips the sweep the same way it skips reloads (process entries
	// still evict on terminate and on the per-host cap). The correlator
	// sweep rides the same cadence.
	if o.reloadEvery > 0 {
		go func() {
			t := time.NewTicker(o.reloadEvery)
			defer t.Stop()
			for {
				select {
				case <-ctx.Done():
					return
				case <-t.C:
					now := time.Now()
					enricher.Sweep(now)
					// correlator: retire chains whose window elapsed
					// without progress, so correlator_states reports
					// live chains and the cap never fills with dead ones
					if corr != nil {
						corr.Sweep(now)
					}
				}
			}
		}()
	}

	if o.reloadEvery > 0 {
		// Hot-reload runs every -reload-every (15 s by default): announce
		// a set only when its size changes, and a failed reload when the
		// error first appears or changes. Printing every cycle buried the
		// engine window in identical "reloaded" lines, while a broken
		// edit to rules or sequences used to be silently ignored.
		rulesRep := reloadReporter{name: "rules", count: engine.Count(), quiet: tui}
		seqRep := reloadReporter{name: "sequences", count: -1, quiet: tui}
		if corr != nil {
			seqRep.count = corr.Count()
		}
		bcnRep := reloadReporter{name: "beacons", count: -1, quiet: tui}
		if bcn != nil {
			bcnRep.count = bcn.Count()
		}
		thrRep := reloadReporter{name: "thresholds", count: -1, quiet: tui}
		if thr != nil {
			thrRep.count = thr.Count()
		}
		go func() {
			t := time.NewTicker(o.reloadEvery)
			defer t.Stop()
			for {
				select {
				case <-ctx.Done():
					return
				case <-t.C:
					// Reload from the RESOLVED rules path: when the
					// flag path does not exist in the current working
					// directory, startup fell back to the directory
					// next to the executable, and reloading from the
					// raw flag would fail (silently) every cycle.
					err := engine.Reload(rulesPath)
					if err == nil {
						stats.setRuleCatalog(engine.Snapshot())
					}
					rulesRep.report(engine.Count(), err)
					if corr != nil && dirExists(seqPath) {
						err := corr.Reload(seqPath)
						seqRep.report(corr.Count(), err)
					}
					if o.suppressionsFile != "" {
						// reload errors are LOUD here: keeping the previous set is the
						// right fallback, but the operator must know the edit was
						// rejected (otherwise an expiring entry silently lingers).
						if err := supMgr.LoadFile(supPath); err != nil {
							log.Printf("[ENGINE] suppressions reload FAILED, keeping previous set: %v", err)
						} else if n := supMgr.Count(time.Now()); n != supCount {
							if !tui {
								fmt.Printf("[ENGINE] suppressions reloaded (%d active)\n", n)
							}
							supCount = n
						}
					}
					if o.knownFile != "" {
						if err := knownMgr.LoadFile(knownPath); err != nil {
							log.Printf("[ENGINE] known-software reload FAILED, keeping previous list: %v", err)
						} else if n := knownMgr.Count(); n != knownCount {
							if !tui {
								fmt.Printf("[ENGINE] known-software reloaded (%d entries)\n", n)
							}
							knownCount = n
						}
					}
					if bcn != nil && fileExists(bcnPath) {
						err := bcn.Reload(bcnPath)
						bcnRep.report(bcn.Count(), err)
					}
					if thr != nil && fileExists(thrPath) {
						err := thr.Reload(thrPath)
						thrRep.report(thr.Count(), err)
					}
					if intelM != nil {
						if changed, err := intelM.Reload(); err != nil {
							if err.Error() != intelErr {
								intelErr = err.Error()
								log.Printf("[ENGINE] threat-intel reload FAILED, keeping previous lists: %v", err)
							}
						} else if intelErr = ""; changed && !tui {
							fmt.Printf("[ENGINE] threat intel reloaded (%d indicators)\n", intelM.Total())
						}
					}
					// per-sensor identities: a failed reload keeps the
					// previous set (a half-edited file must not lock
					// every sensor out) and says so
					if identitiesPath != "" {
						if ids, ierr := ingest.LoadIdentities(identitiesPath); ierr != nil {
							log.Printf("[ENGINE] ingest identities reload FAILED, keeping previous set: %v", ierr)
						} else {
							server.SetIdentities(ids)
						}
					}
					// active response lists (C3): a missing file on
					// reload keeps the previous set (an edit in
					// progress must not empty the allowlist);
					// malformed entries stay loud and are ignored.
					if respMgr != nil {
						if fileExists(respOpsPath) {
							if err := respMgr.LoadOperators(respOpsPath); err != nil {
								log.Printf("[ENGINE] respond operators reload FAILED, keeping previous set: %v", err)
							}
						}
						if respProtPath != "" && fileExists(respProtPath) {
							if err := respMgr.LoadProtected(respProtPath); err != nil {
								log.Printf("[ENGINE] respond protected reload FAILED, keeping previous set: %v", err)
							}
						}
					}
				}
			}
		}()
	}

	if st != nil && o.storeRetention > 0 {
		go func() {
			t := time.NewTicker(5 * time.Minute)
			defer t.Stop()
			for {
				select {
				case <-ctx.Done():
					return
				case <-t.C:
					if dEv, dAl, perr := st.Prune(o.storeRetention); perr == nil && dEv+dAl > 0 {
						fmt.Printf("[ENGINE] store pruned %d events / %d alerts older than %s\n", dEv, dAl, o.storeRetention)
					}
				}
			}
		}()
	}

	go func() {
		<-ctx.Done()
		fmt.Println("\n[ENGINE] shutting down... (Ctrl+C again to force quit)")
		// second signal = hard exit, whatever the graceful path does
		go func() {
			second := make(chan os.Signal, 1)
			signal.Notify(second, os.Interrupt, syscall.SIGTERM)
			<-second
			os.Exit(130)
		}()
		server.Shutdown() // closes the events channel: the loop drains and exits
		if hub != nil {
			hub.Shutdown()
		}
	}()

	processed := 0
	start := time.Now()
	// process runs one event through detection after it was persisted.
	process := func(ev *model.Event) {
		// flight recorder: before evaluation, so the event that
		// triggers an alert is guaranteed to be in the ring when
		// the alert's bundle is captured in the same iteration.
		if fore != nil {
			fore.ObserveEvent(ev)
		}
		if hub != nil {
			hub.PublishEvent(ev)
		}
		stats.recordEvent()
		if o.verbose && !tui {
			log.Printf("[EVENT] %-18s %s pid=%d host=%s",
				redact.TerminalText(ev.Type), redact.TerminalText(describe(ev)), pidOf(ev), redact.TerminalText(ev.Host))
		}
		for _, hit := range engine.Evaluate(ev) {
			// allowlist first: a suppressed hit raises no alert AND does
			// not feed the correlator (see the Emit wrapper above). The
			// event rides along so a CONDITIONAL entry (§2.3 when)
			// suppresses only the invocation shape it names.
			if suppressed(supMgr, hit.Rule.ID, ev.Host, ev, time.Now()) {
				if !tui {
					log.Printf("[SUPPRESS] rule=%s host=%s", redact.TerminalText(hit.Rule.ID), redact.TerminalText(ev.Host))
				}
				continue
			}
			alerts.Raise(ev, hit)
			if corr != nil {
				corr.Observe(ev, hit.Rule.Name)
			}
		}
		// behavioral detector (A3): consumes raw network.connect
		// events regardless of rule hits — beaconing is a
		// property of event timing, not of any single event.
		if bcn != nil {
			bcn.Observe(ev, time.Now())
		}
		// volumetric detector (A2): consumes raw events that pass
		// each definition's predicate — the signal is the COUNT
		// within a window, orthogonal to rules and beaconing.
		if thr != nil {
			thr.Observe(ev, time.Now())
		}
		// offline threat intel: indicators in the event, one alert per
		// indicator and host per cooldown
		if intelM != nil {
			now := time.Now()
			for _, hit := range intelM.Match(ev) {
				if intelM.Allow(hit, ev.Host, now) {
					emitAllowlistedEvent(ev, intelAlert(ev, hit, now))
				}
			}
		}
		// baseline: a process this host never ran after its learning period.
		// Known software (§2.2) is LEARNED but never reported as a novelty:
		// the whole point of the list is that its boots are expected, and
		// learning keeps the baseline honest for the day the entry is
		// removed (the host has demonstrably run it for months).
		if nov := baseTracker.Observe(ev, time.Now()); nov != nil && ev.Enrichment["known_software"] == "" {
			emitAllowlistedEvent(ev, noveltyAlert(ev, nov, time.Now()))
		}
		processed++
	}

	// The loop drains whatever the ingest has already queued (up to
	// maxEventBatch) and persists it in ONE store transaction before
	// any of those events is published or evaluated: durable evidence
	// first, live delivery second, as before, but SQLite's commit is
	// paid once per batch. Idle traffic yields batches of one, so no
	// event ever waits for company.
	const maxEventBatch = 256
	loop := func() {
		batch := make([]*model.Event, 0, maxEventBatch)
		for ev := range events {
			batch = append(batch[:0], ev)
		drain:
			for len(batch) < maxEventBatch {
				select {
				case more, ok := <-events:
					if !ok {
						break drain // closed: the range ends after this batch
					}
					batch = append(batch, more)
				default:
					break drain
				}
			}
			// enrichment is part of the stored record, so it runs
			// before persistence (sequentially: the process map
			// follows the stream order exactly as before)
			for _, e := range batch {
				enricher.Apply(e)
			}
			switch {
			case hub != nil:
				// the hub persists to the store when attached
				hub.PersistEvents(batch)
			case st != nil:
				// -api 0 with -store: keep persisting without a hub
				res := st.InsertEvents(batch)
				for _, err := range res.Failed {
					storeWriteErr(err)
				}
				for _, id := range res.Conflicts {
					storeWriteErr(fmt.Errorf("%w (id %s)", store.ErrIDConflict, id))
				}
			}
			for _, e := range batch {
				process(e)
			}
		}
	}

	if tui {
		meta := tuiMeta{
			rulesPath:  rulesPath,
			ingestAddr: server.Addr(),
			apiAddr:    apiAddr,
			webhookURL: o.webhookURL,
		}
		if corr != nil {
			meta.seqCount = corr.Count()
		}
		var wg sync.WaitGroup
		wg.Add(1)
		go func() {
			defer wg.Done()
			loop()
		}()
		err = runInteractive(ctx, meta, stats)
		if err != nil {
			log.Printf("[ENGINE] interactive panel: %v", err)
		}
		// the panel quit (q/Ctrl+C/SIGTERM): cancel the context so the
		// shutdown goroutine closes the event channel and the loop drains
		stop()
		wg.Wait()
	} else {
		loop()
	}

	whCancel() // stop accepting; drain pending deliveries (webhook + notify share the context)
	if wh != nil {
		wh.Wait()
	}
	if nt != nil {
		nt.Wait()
	}
	sinkCancel() // siem sinks: stop accepting; drain pending frames
	if elasticSink != nil {
		elasticSink.Wait()
	}
	if splunkSink != nil {
		splunkSink.Wait()
	}

	fmt.Printf("[ENGINE] processed %d events in %s (ingested=%d dropped=%d)\n",
		processed, time.Since(start).Round(time.Millisecond),
		server.Received(), server.Dropped())
	return nil
}

// ingestAuthBanner renders the startup auth line the operator sees.
// The message must name HOW sensors are expected to authenticate: an
// identities-only deployment (no shared token) previously printed the
// -token/SF_INGEST_TOKEN hint, which sent the operator arming a
// credential the engine does not use (SEC-8, TODO list item on the
// known confusing banner).
func ingestAuthBanner(rotating bool, token string, identities int) string {
	switch {
	case rotating:
		return "[ENGINE] ingest auth: ENABLED, rotation window OPEN (current and previous token both accepted; redeploy sensors, then restart without -token-previous)"
	case identities > 0 && token != "":
		return "[ENGINE] ingest auth: ENABLED (sensors must send 'AUTH <token>' first: their per-sensor identity token or the shared -token/SF_INGEST_TOKEN)"
	case identities > 0:
		return "[ENGINE] ingest auth: ENABLED (sensors must send 'AUTH <token>' first with their per-sensor identity token; no shared token is configured)"
	default:
		return "[ENGINE] ingest auth: ENABLED (sensors must send 'AUTH <token>' first, or -token/SF_INGEST_TOKEN)"
	}
}
