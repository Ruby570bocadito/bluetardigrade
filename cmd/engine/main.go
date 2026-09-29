// Command engine is the detection engine binary: it ingests NDJSON
// event streams from sensors, enriches them, evaluates YAML rules and
// raises alerts. This is the tracer bullet of the security-framework
// project (see docs/ for the full architecture).
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/Ruby570bocadito/security-framework/internal/actions"
	"github.com/Ruby570bocadito/security-framework/internal/alert"
	"github.com/Ruby570bocadito/security-framework/internal/api"
	"github.com/Ruby570bocadito/security-framework/internal/correlate"
	"github.com/Ruby570bocadito/security-framework/internal/enrich"
	"github.com/Ruby570bocadito/security-framework/internal/ingest"
	"github.com/Ruby570bocadito/security-framework/internal/rules"
	"github.com/Ruby570bocadito/security-framework/internal/suppress"
	"github.com/Ruby570bocadito/security-framework/internal/webhook"
	"github.com/Ruby570bocadito/security-framework/pkg/model"
)

var (
	// Loopback defaults: the bundled sensors (devsensor, sf-sensor, the
	// Rust collector) all dial 127.0.0.1, so exposing the ingest and
	// the read-only API on every interface would hand the whole LAN
	// an unauthenticated event feed and a copy of the alert data.
	// Remote-sensor deployments must opt in explicitly, e.g.
	//   sf-engine -addr 0.0.0.0:7777 -api 0.0.0.0:7778
	// combined with the installer's -Firewall switch.
	addr        = flag.String("addr", "127.0.0.1:7777", "TCP listen address for sensor streams (use 0.0.0.0:7777 to accept remote sensors)")
	apiAddr     = flag.String("api", "127.0.0.1:7778", "local HTTP API for the console (stats/events/alerts/stream); 0 disables")
	rulesDir    = flag.String("rules", "./rules", "directory with YAML rules")
	seqDir      = flag.String("sequences", "./sequences", "directory with YAML kill-chain sequences (correlator)")
	verbose     = flag.Bool("v", false, "print every event received")
	reloadEvery = flag.Duration("reload-every", 15*time.Second,
		"hot-reload interval for the rules directory (0 disables)")
	webhookURL = flag.String("webhook", "",
		"POST every alert as JSON to this URL (SIEM/SOAR connector); empty disables")
	token = flag.String("token", "",
		"shared token sensors must send as 'AUTH <token>' on connect (falls back to SF_INGEST_TOKEN); empty disables auth")
	suppressionsFile = flag.String("suppressions", "./suppressions.yaml",
		"operator allowlist YAML silencing rule/host pairs (expires supported); empty disables")
	pidFile = flag.String("pidfile", "",
		"write the process PID here at startup and remove it on shutdown (lets sf-console -Stop stop an engine it did not start)")
)

func main() {
	flag.Parse()
	log.SetFlags(0)

	ctx, stop := signal.NotifyContext(context.Background(),
		os.Interrupt, syscall.SIGTERM)
	defer stop()

	// PID file: lets sf-console -Stop (and operators) stop this engine
	// even when it was launched by the autostart entry, not by sf-console.
	if *pidFile != "" {
		if err := os.WriteFile(*pidFile, []byte(fmt.Sprint(os.Getpid())), 0o644); err != nil {
			log.Printf("[ENGINE] pidfile %s: %v", *pidFile, err)
		} else {
			defer func() { _ = os.Remove(*pidFile) }() // best effort on graceful paths
		}
	}

	// rules dir: explicit flag > rules next to the executable (so
	// the installed sf-engine.exe needs no wrapper)
	rulesPath := resolveDataDir(*rulesDir, "rules")
	engine, err := rules.LoadDir(rulesPath)
	if err != nil {
		log.Fatalf("[ENGINE] loading rules from %s: %v", rulesPath, err)
	}
	fmt.Printf("[ENGINE] %d rules loaded from %s (types: %v)\n",
		engine.Count(), rulesPath, engine.Types())

	// kill-chain sequences: same resolution order as the rules dir
	seqPath := resolveDataDir(*seqDir, "sequences")
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

	// operator allowlist: alert suppressions (rule + host, optional
	// expiration), hot-reloaded on the same ticker as rules. A malformed
	// file is FATAL at startup: failing open would silently disable a
	// control the operator believes is armed.
	supMgr := suppress.New()
	supPath := resolveDataFile(*suppressionsFile, "suppressions.yaml")
	supCount := 0
	if *suppressionsFile != "" {
		if err := supMgr.LoadFile(supPath); err != nil {
			log.Fatalf("[ENGINE] %v", err)
		}
		supCount = supMgr.Count(time.Now())
		if supCount > 0 {
			fmt.Printf("[ENGINE] %d suppressions active from %s\n", supCount, supPath)
		}
	}

	events := make(chan *model.Event, 1024)
	server, err := ingest.New(*addr, events)
	if err != nil {
		// A bind failure almost always means another engine
		// instance is already running (e.g. started by
		// sf-devsensor or sf-console). Probe the port instead of
		// comparing errno: bind error text is locale-dependent
		// on Windows ("Solo se permite un uso de cada...").
		if listening(*addr) {
			if *apiAddr != "0" && apiHealthy(*apiAddr) {
				fmt.Printf("[ENGINE] another engine instance is already running (ingest %s, api %s)\n",
					*addr, *apiAddr)
			} else {
				fmt.Printf("[ENGINE] cannot bind %s: another process is already listening on it\n", *addr)
			}
			fmt.Println("[ENGINE]   view alerts:  sf-console   (web UI)")
			fmt.Println("[ENGINE]   stop it:      sf-console -Stop")
			return
		}
		log.Fatalf("[ENGINE] %v", err)
	}
	go server.Serve()
	// shared-token auth: flag wins over the env var, so operators
	// can override SF_INGEST_TOKEN per process without touching the
	// autostart entry. The bundled sensors honor the same env var.
	ingestToken := *token
	if ingestToken == "" {
		ingestToken = os.Getenv("SF_INGEST_TOKEN")
	}
	server.SetToken(ingestToken)
	if server.AuthEnabled() {
		fmt.Println("[ENGINE] ingest auth: ENABLED (sensors must send 'AUTH <token>' first, or -token/SF_INGEST_TOKEN)")
	} else if strings.HasPrefix(server.Addr(), "127.0.0.1:") || strings.HasPrefix(server.Addr(), "[::1]:") {
		fmt.Println("[ENGINE] ingest auth: disabled (loopback bind only - fine for local demos)")
	} else {
		fmt.Println("[ENGINE] WARNING: non-loopback ingest WITHOUT a token: any host that reaches this port can inject events. Set -token or SF_INGEST_TOKEN.")
	}
	fmt.Printf("[ENGINE] listening on %s (NDJSON, 1 event per line)\n", server.Addr())

	// local read-only API: stats, recent events/alerts, rules, SSE
	var hub *api.Hub
	if *apiAddr != "0" {
		hub, err = api.New(*apiAddr)
		if err != nil {
			log.Printf("[ENGINE] api disabled: %v", err)
			hub = nil
		} else {
			hub.SetRules(engine)
			hub.SetSuppressions(supMgr)
			hub.SetCounters(func() (uint64, uint64, uint64) {
				return server.Received(), server.Dropped(), server.Rejected()
			})
			go func() {
				if err := hub.Run(); err != nil {
					log.Printf("[ENGINE] api: %v", err)
				}
			}()
			fmt.Printf("[ENGINE] api on %s (stats / events / alerts / rules / stream)\n", hub.Addr())
		}
	}

	// outbound connector: alerts POSTed as JSON to a SIEM/SOAR
	// endpoint; delivery is async, bounded and never blocks the loop
	whCtx, whCancel := context.WithCancel(context.Background())
	var wh *webhook.Client
	if *webhookURL != "" {
		wh = webhook.New(*webhookURL)
		go wh.Run(whCtx)
		if hub != nil {
			hub.SetWebhookStats(wh.Stats)
		}
		fmt.Printf("[ENGINE] webhook on %s (alerts POSTed as JSON)\n", *webhookURL)
	}

	enricher := enrich.New()
	alerts := alert.New(os.Stdout, func(a alert.Alert) {
		if hub != nil {
			hub.RecordAlert(a)
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

	if *reloadEvery > 0 {
		go func() {
			t := time.NewTicker(*reloadEvery)
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
						fmt.Printf("[ENGINE] rules reloaded (%d active)\n", engine.Count())
					}
					if corr != nil && dirExists(seqPath) {
						if err := corr.Reload(seqPath); err == nil {
							fmt.Printf("[ENGINE] sequences reloaded (%d active)\n", corr.Count())
						}
					}
					if *suppressionsFile != "" {
						// reload errors are LOUD here: keeping the previous set is the
						// right fallback, but the operator must know the edit was
						// rejected (otherwise an expiring entry silently lingers).
						if err := supMgr.LoadFile(supPath); err != nil {
							log.Printf("[ENGINE] suppressions reload FAILED, keeping previous set: %v", err)
						} else if n := supMgr.Count(time.Now()); n != supCount {
							fmt.Printf("[ENGINE] suppressions reloaded (%d active)\n", n)
							supCount = n
						}
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
		server.Shutdown() // closes the events channel: main loop drains and exits
		if hub != nil {
			hub.Shutdown()
		}
	}()

	processed := 0
	start := time.Now()
	for ev := range events {
		enricher.Apply(ev)
		if hub != nil {
			hub.RecordEvent(ev)
		}
		if *verbose {
			log.Printf("[EVENT] %-18s %s pid=%d host=%s",
				ev.Type, describe(ev), pidOf(ev), ev.Host)
		}
		for _, hit := range engine.Evaluate(ev) {
			// allowlist first: a suppressed hit raises no alert AND does
			// not feed the correlator (see the Emit wrapper above).
			if suppressed(supMgr, hit.Rule.ID, ev.Host, time.Now()) {
				log.Printf("[SUPPRESS] rule=%s host=%s", hit.Rule.ID, ev.Host)
				continue
			}
			alerts.Raise(ev, hit)
			if corr != nil {
				corr.Observe(ev, hit.Rule.Name)
			}
		}
		processed++
	}

	if wh != nil {
		whCancel() // stop accepting; drain pending deliveries
		wh.Wait()
	}

	fmt.Printf("[ENGINE] processed %d events in %s (ingested=%d dropped=%d)\n",
		processed, time.Since(start).Round(time.Millisecond),
		server.Received(), server.Dropped())
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
