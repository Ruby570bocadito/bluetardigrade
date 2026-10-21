package main

import (
	"context"
	"fmt"
	"io"
	"log"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/actions"
	"github.com/Ruby570bocadito/bluetardigrade/internal/alert"
	"github.com/Ruby570bocadito/bluetardigrade/internal/enrich"
	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
)

// runEngine boots the whole detection pipeline. It is the exact logic
// the pre-CLI binary executed in main(), with two presentation-level
// additions: the shared liveStats hooks and the optional interactive
// panel (a TUI that renders what the engine is already doing; when
// stdout is not a TTY the request degrades to the classic flat run).
func runEngine(o *options, interactive bool) error {
	// Profiling (POL-3, opt-in via -pprof-dir) is armed before
	// anything else so the CPU profile covers the whole run; the
	// heap/goroutine snapshots land on the deferred stop, after the
	// queue drained. An explicitly requested profile session that
	// cannot start fails the run here, loudly.
	stopProfiles, err := startProfiling(o.pprofDir)
	if err != nil {
		return err
	}
	defer stopProfiles()

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

	// err carries the remaining startup assignments, exactly as the
	// inline original declared it.
	var err error

	// rules dir: explicit flag > rules next to the executable (so
	// the installed sf-engine.exe needs no wrapper); the resolved
	// path is what the hot-reload loop reloads from.
	engine, rulesPath := loadEngineRules(o, stats)

	corr, seqPath := loadSequences(o)
	bcn, bcnPath := loadBeacons(o)

	thr, thrPath := loadThresholds(o)

	intelM, intelErr := loadIntel(o)

	st := openStore(o)
	if st != nil {
		defer st.Close()
	}

	supMgr, supPath, supCount := loadSuppressions(o)

	knownMgr, knownPath, knownCount := loadKnownSoftware(o)

	fore := newForensicRecorder(o)

	events := make(chan *model.Event, 1024)

	if err := validateIngestTLS(o); err != nil {
		return err
	}

	lifeStore := openLifecycle(o)

	incStore := openIncidents(o)

	server, enrollReg, ingestToken, identitiesPath := startIngest(o, events)
	if server == nil {
		// another engine instance already owns the port; the
		// graceful "already running" banner was printed
		return nil
	}
	baseTracker, fleetTracker := restoreTrackers(o, st)
	serveIngest(server, o, ingestToken, fleetTracker)

	// SET-3: ingest→alert latency ring (the API closure reads it; the
	// observer is attached to the alert manager once it exists). It is
	// created even with the API disabled: every raised alert measures
	// the ingest→alert latency.
	latTracker := newAlertLatencyTracker(1024)
	hub, apiAddr, apiTok, stopAD := startAPIHub(apiBoot{
		o: o, ctx: ctx, engine: engine, seqPath: seqPath, server: server,
		st: st, supMgr: supMgr, supPath: supPath, knownMgr: knownMgr,
		corr: corr, bcn: bcn, thr: thr, lifeStore: lifeStore, incStore: incStore,
		fleetTracker: fleetTracker, enrollReg: enrollReg, intelM: intelM,
		baseTracker: baseTracker, fore: fore, latTracker: latTracker,
	})
	if stopAD != nil {
		defer stopAD()
	}

	respMgr, respOpsPath, respProtPath, stopRespondAudit := armActiveResponse(o, hub, apiTok)
	if stopRespondAudit != nil {
		defer stopRespondAudit()
	}

	whCtx, whCancel := context.WithCancel(context.Background())
	wh := startWebhook(o, whCtx, hub)
	nt, nerr := startNotify(o, whCtx, hub)
	if nerr != nil {
		whCancel() // nothing started yet, but the webhook worker may be live
		return nerr
	}
	sinkCtx, sinkCancel := context.WithCancel(context.Background())
	elasticSink := startElastic(o, sinkCtx, hub)
	splunkSink := startSplunk(o, sinkCtx, hub)

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
	watchFleetSilence(ctx, fleetTracker, baseTracker, st, emitAllowlisted)
	if thr != nil {
		// Threshold alerts NEVER feed the correlator (Q3): one
		// threshold alert already aggregates N events, and
		// chaining it would break the "steps = atomic rules"
		// semantics of the sequencer. The suppression gate itself is
		// the shared one above.
		thr.SetEmit(emitAllowlisted)
	}

	startSweeps(ctx, o, enricher, corr)

	hr := hotReloadDeps{
		ctx: ctx, o: o, tui: tui, stats: stats,
		engine: engine, rulesPath: rulesPath,
		corr: corr, seqPath: seqPath,
		supMgr: supMgr, supPath: supPath, supCount: supCount,
		knownMgr: knownMgr, knownPath: knownPath, knownCount: knownCount,
		bcn: bcn, bcnPath: bcnPath,
		thr: thr, thrPath: thrPath,
		intelM: intelM, intelErr: intelErr,
		identitiesPath: identitiesPath, server: server,
		respMgr: respMgr, respOpsPath: respOpsPath, respProtPath: respProtPath,
	}
	hr.start()

	startStorePruner(ctx, st, o.storeRetention)

	startShutdownWatch(ctx, server, hub)

	pipe := &pipeline{
		o: o, tui: tui, stats: stats,
		engine: engine, hub: hub, st: st,
		fore: fore, supMgr: supMgr, alerts: alerts,
		corr: corr, bcn: bcn, thr: thr,
		intelM: intelM, baseTracker: baseTracker, enricher: enricher,
		emitAllowlistedEvent: emitAllowlistedEvent,
	}
	start := time.Now()

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
			pipe.loop(events)
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
		pipe.loop(events)
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
		pipe.processed, time.Since(start).Round(time.Millisecond),
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
