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

	"github.com/Ruby570bocadito/security-framework/internal/actions"
	"github.com/Ruby570bocadito/security-framework/internal/alert"
	"github.com/Ruby570bocadito/security-framework/internal/api"
	"github.com/Ruby570bocadito/security-framework/internal/beacon"
	"github.com/Ruby570bocadito/security-framework/internal/correlate"
	"github.com/Ruby570bocadito/security-framework/internal/enrich"
	"github.com/Ruby570bocadito/security-framework/internal/ingest"
	"github.com/Ruby570bocadito/security-framework/internal/lifecycle"
	"github.com/Ruby570bocadito/security-framework/internal/notify"
	"github.com/Ruby570bocadito/security-framework/internal/redact"
	"github.com/Ruby570bocadito/security-framework/internal/respond"
	"github.com/Ruby570bocadito/security-framework/internal/rules"
	"github.com/Ruby570bocadito/security-framework/internal/siem"
	"github.com/Ruby570bocadito/security-framework/internal/store"
	"github.com/Ruby570bocadito/security-framework/internal/suppress"
	"github.com/Ruby570bocadito/security-framework/internal/threshold"
	"github.com/Ruby570bocadito/security-framework/internal/webhook"
	"github.com/Ruby570bocadito/security-framework/pkg/model"
)

// runEngine boots the whole detection pipeline. It is the exact logic
// the pre-CLI binary executed in main(), with two presentation-level
// additions: the shared liveStats hooks and the optional interactive
// panel (a TUI that renders what the engine is already doing; when
// stdout is not a TTY the request degrades to the classic flat run).
func runEngine(o *options, interactive bool) error {
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
		if err := os.WriteFile(o.pidFile, []byte(fmt.Sprint(os.Getpid())), 0o644); err != nil {
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
	stats.setRules(engine.Count())

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

	var server *ingest.Server
	if o.ingestCert != "" {
		server, err = ingest.NewTLS(o.addr, o.ingestCert, o.ingestKey, events)
	} else {
		server, err = ingest.New(o.addr, events)
	}
	if err != nil {
		// A bind failure almost always means another engine
		// instance is already running (e.g. started by
		// sf-devsensor or sf-console). Probe the port instead of
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
	go server.Serve()
	// shared-token auth: flag wins over the env var, so operators
	// can override SF_INGEST_TOKEN per process without touching the
	// autostart entry. The bundled sensors honor the same env var.
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
	if server.AuthEnabled() {
		if server.Rotating() {
			fmt.Println("[ENGINE] ingest auth: ENABLED, rotation window OPEN (current and previous token both accepted; redeploy sensors, then restart without -token-previous)")
		} else {
			fmt.Println("[ENGINE] ingest auth: ENABLED (sensors must send 'AUTH <token>' first, or -token/SF_INGEST_TOKEN)")
		}
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
	if o.apiAddr != "0" {
		hub, err = api.New(o.apiAddr)
		if err != nil {
			log.Printf("[ENGINE] api disabled: %v", err)
			hub = nil
		} else {
			hub.SetRules(engine)
			hub.SetSuppressions(supMgr)
			if st != nil {
				hub.SetStore(st)
			}
			hub.SetCounters(func() (uint64, uint64, uint64) {
				return server.Received(), server.Dropped(), server.Rejected()
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
		elasticSink = siem.NewElastic(o.elasticURL, o.elasticIndex)
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
		splunkSink = siem.NewSplunk(o.splunkURL)
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

	// emitAllowlisted is the ONE suppression gate every secondary
	// emitter shares: a host with a suppressed rule is in an accepted
	// state, so an alert derived from its silenced evidence never
	// fires — a kill-chain built on suppressed steps, a beacon built
	// on silenced traffic or a volumetric alert fed by silenced
	// events would all be false positives. One closure instead of
	// three identical copies keeps the gate from diverging (any
	// future change to how suppression gates secondary alerts is
	// edited here, once).
	emitAllowlisted := func(a alert.Alert) {
		if suppressed(supMgr, a.RuleID, a.Host, time.Now()) {
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
	if thr != nil {
		// Threshold alerts NEVER feed the correlator (dictamen 04,
		// Q3): one threshold alert already aggregates N events, and
		// chaining it would break the "steps = atomic rules"
		// semantics of the sequencer. The suppression gate itself is
		// the shared one above.
		thr.SetEmit(emitAllowlisted)
	}

	if o.reloadEvery > 0 {
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
					if err := engine.Reload(rulesPath); err == nil {
						stats.setRules(engine.Count())
						if !tui {
							fmt.Printf("[ENGINE] rules reloaded (%d active)\n", engine.Count())
						}
					}
					if corr != nil && dirExists(seqPath) {
						if err := corr.Reload(seqPath); err == nil && !tui {
							fmt.Printf("[ENGINE] sequences reloaded (%d active)\n", corr.Count())
						}
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
					if bcn != nil && fileExists(bcnPath) {
						if err := bcn.Reload(bcnPath); err == nil && !tui {
							fmt.Printf("[ENGINE] beacons reloaded (%d active)\n", bcn.Count())
						}
					}
					if thr != nil && fileExists(thrPath) {
						if err := thr.Reload(thrPath); err == nil && !tui {
							fmt.Printf("[ENGINE] thresholds reloaded (%d active)\n", thr.Count())
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
	loop := func() {
		for ev := range events {
			enricher.Apply(ev)
			switch {
			case hub != nil:
				// the hub persists to the store too when attached
				hub.RecordEvent(ev)
			case st != nil:
				// -api 0 with -store: keep persisting without a hub
				if err := st.InsertEvent(ev); err != nil {
					storeWriteErr(err)
				}
			}
			stats.recordEvent()
			if o.verbose && !tui {
				log.Printf("[EVENT] %-18s %s pid=%d host=%s",
					ev.Type, describe(ev), pidOf(ev), ev.Host)
			}
			for _, hit := range engine.Evaluate(ev) {
				// allowlist first: a suppressed hit raises no alert AND does
				// not feed the correlator (see the Emit wrapper above).
				if suppressed(supMgr, hit.Rule.ID, ev.Host, time.Now()) {
					if !tui {
						log.Printf("[SUPPRESS] rule=%s host=%s", hit.Rule.ID, ev.Host)
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
			processed++
		}
	}

	if tui {
		meta := tuiMeta{
			rulesPath:  rulesPath,
			ruleTypes:  engine.Types(),
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
