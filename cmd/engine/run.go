package main

import (
	"context"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/Ruby570bocadito/security-framework/internal/actions"
	"github.com/Ruby570bocadito/security-framework/internal/alert"
	"github.com/Ruby570bocadito/security-framework/internal/api"
	"github.com/Ruby570bocadito/security-framework/internal/correlate"
	"github.com/Ruby570bocadito/security-framework/internal/enrich"
	"github.com/Ruby570bocadito/security-framework/internal/ingest"
	"github.com/Ruby570bocadito/security-framework/internal/lifecycle"
	"github.com/Ruby570bocadito/security-framework/internal/rules"
	"github.com/Ruby570bocadito/security-framework/internal/store"
	"github.com/Ruby570bocadito/security-framework/internal/suppress"
	"github.com/Ruby570bocadito/security-framework/internal/webhook"
	"github.com/Ruby570bocadito/security-framework/pkg/model"
)

// options carries every runtime knob of the engine. It is shared by
// the legacy single-dash path and the "run" subcommand so both accept
// identical flags with identical defaults.
type options struct {
	addr             string
	apiAddr          string
	rulesDir         string
	seqDir           string
	verbose          bool
	reloadEvery      time.Duration
	webhookURL       string
	webhookToken     string
	apiToken         string
	token            string
	prevToken        string
	suppressionsFile string
	lifecycleFile    string
	storePath        string
	storeRetention   time.Duration
	pidFile          string
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
	// Loopback defaults: the bundled sensors (devsensor, sf-sensor, the
	// Rust collector) all dial 127.0.0.1, so exposing the ingest and
	// the read-only API on every interface would hand the whole LAN
	// an unauthenticated event feed and a copy of the alert data.
	// Remote-sensor deployments must opt in explicitly, e.g.
	//   sf-engine -addr 0.0.0.0:7777 -api 0.0.0.0:7778
	// combined with the installer's -Firewall switch.
	fs.StringVar(&o.addr, "addr", "127.0.0.1:7777", "TCP listen address for sensor streams (use 0.0.0.0:7777 to accept remote sensors)")
	fs.StringVar(&o.apiAddr, "api", "127.0.0.1:7778", "local HTTP API for the console (stats/events/alerts/stream); 0 disables")
	fs.StringVar(&o.rulesDir, "rules", "./rules", "directory with YAML rules")
	fs.StringVar(&o.seqDir, "sequences", "./sequences", "directory with YAML kill-chain sequences (correlator)")
	fs.BoolVar(&o.verbose, "v", false, "print every event received")
	fs.DurationVar(&o.reloadEvery, "reload-every", 15*time.Second,
		"hot-reload interval for the rules directory (0 disables)")
	fs.StringVar(&o.webhookURL, "webhook", "",
		"POST every alert as JSON to this URL (SIEM/SOAR connector); empty disables")
	fs.StringVar(&o.webhookToken, "webhook-token", "",
		"Bearer token sent on every webhook delivery as 'Authorization: Bearer' (falls back to SF_WEBHOOK_TOKEN); empty disables the header")
	fs.StringVar(&o.apiToken, "api-token", "",
		"bearer token the local API requires on /api/* (falls back to SF_API_TOKEN); /api/health stays open; empty disables")
	fs.StringVar(&o.token, "token", "",
		"shared token sensors must send as 'AUTH <token>' on connect (falls back to SF_INGEST_TOKEN); empty disables auth")
	fs.StringVar(&o.prevToken, "token-previous", "",
		"previous ingest token, still accepted during a rotation window (falls back to SF_INGEST_TOKEN_PREVIOUS); requires -token")
	fs.StringVar(&o.suppressionsFile, "suppressions", "./suppressions.yaml",
		"operator allowlist YAML silencing rule/host pairs (expires supported); empty disables")
	fs.StringVar(&o.lifecycleFile, "lifecycle", "./alert-lifecycle.json",
		"JSON file persisting alert triage status (acknowledged/closed + notes); empty keeps statuses in memory only")
	fs.StringVar(&o.storePath, "store", "",
		"SQLite file persisting events and alerts beyond the in-memory rings (e.g. ./sf-store.db); empty disables")
	fs.DurationVar(&o.storeRetention, "store-retention", 72*time.Hour,
		"delete stored events/alerts older than this on a 5-minute ticker (0 keeps everything)")
	fs.StringVar(&o.pidFile, "pidfile", "",
		"write the process PID here at startup and remove it on shutdown (lets sf-console -Stop stop an engine it did not start)")
	// CLI additions: single panel over the running engine.
	fs.BoolVar(interactive, "i", false, "interactive panel (TUI) on top of the running engine; needs a TTY")
	fs.BoolVar(interactive, "interactive", false, "alias of -i")
	return fs
}

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

	server, err := ingest.New(o.addr, events)
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

	// local read-only API: stats, recent events/alerts, rules, SSE
	var hub *api.Hub
	apiAddr := ""
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
			hub.SetSequences(corr)
			hub.SetLifecycle(lifeStore)
			// same standard as the ingest token: flag wins, env fallback
			apiTok := o.apiToken
			if apiTok == "" {
				apiTok = os.Getenv("SF_API_TOKEN")
			}
			hub.SetToken(apiTok)
			if apiTok != "" {
				fmt.Println("[ENGINE] api auth: ENABLED (Authorization: Bearer required; /api/health stays open for probes)")
			} else if !strings.HasPrefix(hub.Addr(), "127.0.0.1:") && !strings.HasPrefix(hub.Addr(), "[::1]:") {
				fmt.Println("[ENGINE] WARNING: API bound beyond loopback WITHOUT a token: anything that reaches this port can read every event and alert. Set -api-token or SF_API_TOKEN.")
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
			fmt.Printf("[ENGINE] webhook on %s (alerts POSTed as JSON, Authorization: Bearer enabled)\n", o.webhookURL)
		} else {
			fmt.Printf("[ENGINE] webhook on %s (alerts POSTed as JSON, no auth header - set -webhook-token or SF_WEBHOOK_TOKEN)\n", o.webhookURL)
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
	})
	// rule actions: rendered messages land inside the alert payload;
	// webhook deliveries run in the background and never stall intake
	dispatcher := actions.New(log.New(os.Stderr, "[ACTIONS] ", 0))
	alerts.SetPreparer(dispatcher.Prepare)
	if corr != nil {
		// sequence completions honor the allowlist too: a host with a
		// suppressed rule is in an accepted state, and a kill-chain
		// built on top of its silenced steps would be a false positive.
		corr.SetEmit(func(a alert.Alert) {
			if suppressed(supMgr, a.RuleID, a.Host, time.Now()) {
				return
			}
			alerts.Emit(a)
		})
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

	whCancel() // stop accepting; drain pending deliveries
	if wh != nil {
		wh.Wait()
	}

	fmt.Printf("[ENGINE] processed %d events in %s (ingested=%d dropped=%d)\n",
		processed, time.Since(start).Round(time.Millisecond),
		server.Received(), server.Dropped())
	return nil
}

// suppressed reports whether the allowlist currently silences this
// rule/host pair. nil manager means the feature is off.
func suppressed(m *suppress.Manager, ruleID, host string, now time.Time) bool {
	if m == nil {
		return false
	}
	ok, _ := m.SuppressedAt(ruleID, host, now)
	return ok
}

var storeFails uint64

// storeWriteErr logs store write failures with a throttle (first, then
// every 500th): a full disk must be visible without flooding the log
// or stopping detection.
func storeWriteErr(err error) {
	n := atomic.AddUint64(&storeFails, 1)
	if n == 1 || n%500 == 0 {
		log.Printf("[ENGINE] store write FAILED (%d total): %v", n, err)
	}
}

func dirExists(p string) bool {
	st, err := os.Stat(p)
	return err == nil && st.IsDir()
}

// resolveDataDir picks the directory holding rules or sequences: the
// flag path when it exists, otherwise <exe dir>/../<name> (so the
// installed sf-engine.exe needs no wrapper), otherwise the flag path
// unchanged so LoadDir reports the error against the original path.
// Both consumers must reload from THIS resolved path (the hot-reload
// ticker does) or the reload silently fails every cycle.
func resolveDataDir(flagPath, name string) string {
	if dirExists(flagPath) {
		return flagPath
	}
	if exe, err := os.Executable(); err == nil {
		alt := filepath.Join(filepath.Dir(exe), "..", name)
		if dirExists(alt) {
			return alt
		}
	}
	return flagPath
}

// resolveDataFile is resolveDataDir for a single file: the flag path
// when it exists, otherwise <exe dir>/../<name> (the installed layout),
// otherwise the flag path unchanged so LoadFile reports its error
// against the original path. Missing files are NOT an error for the
// allowlist (feature off) but malformed ones are.
func resolveDataFile(flagPath, name string) string {
	if fileExists(flagPath) {
		return flagPath
	}
	if exe, err := os.Executable(); err == nil {
		alt := filepath.Join(filepath.Dir(exe), "..", name)
		if fileExists(alt) {
			return alt
		}
	}
	return flagPath
}

func fileExists(p string) bool {
	st, err := os.Stat(p)
	return err == nil && !st.IsDir()
}

// listening reports whether something accepts TCP connections on addr
// right now (":7777" dials localhost, same rule as net.Listen).
func listening(addr string) bool {
	c, err := net.DialTimeout("tcp", addr, 500*time.Millisecond)
	if err != nil {
		return false
	}
	c.Close()
	return true
}

// apiHealthy does a one-shot GET /api/health with a short timeout, to
// confirm that whatever occupies the ingest port is really this engine.
func apiHealthy(addr string) bool {
	host := addr
	if strings.HasPrefix(host, ":") {
		host = "127.0.0.1" + host
	}
	cl := &http.Client{Timeout: 700 * time.Millisecond}
	resp, err := cl.Get("http://" + host + "/api/health")
	if err != nil {
		return false
	}
	resp.Body.Close()
	return resp.StatusCode == http.StatusOK
}

func describe(ev *model.Event) string {
	switch {
	case ev.Process != nil:
		return ev.Process.Name
	case ev.File != nil:
		return ev.File.Path
	case ev.Network != nil:
		return fmt.Sprintf("%s:%d", ev.Network.DestinationIP, ev.Network.DestinationPort)
	default:
		return "-"
	}
}

func pidOf(ev *model.Event) int {
	if ev.Process != nil {
		return ev.Process.PID
	}
	return 0
}
