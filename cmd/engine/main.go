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
)

func main() {
	flag.Parse()
	log.SetFlags(0)

	ctx, stop := signal.NotifyContext(context.Background(),
		os.Interrupt, syscall.SIGTERM)
	defer stop()

	// rules dir: explicit flag > ./rules in CWD > rules next to the
	// executable (so the installed sf-engine.exe needs no wrapper)
	rulesPath := *rulesDir
	if !dirExists(rulesPath) {
		if exe, err := os.Executable(); err == nil {
			alt := filepath.Join(filepath.Dir(exe), "..", "rules")
			if dirExists(alt) {
				rulesPath = alt
			}
		}
	}
	engine, err := rules.LoadDir(rulesPath)
	if err != nil {
		log.Fatalf("[ENGINE] loading rules from %s: %v", rulesPath, err)
	}
	fmt.Printf("[ENGINE] %d rules loaded from %s (types: %v)\n",
		engine.Count(), rulesPath, engine.Types())

	// kill-chain sequences: same resolution order as the rules dir
	seqPath := *seqDir
	if !dirExists(seqPath) {
		if exe, err := os.Executable(); err == nil {
			alt := filepath.Join(filepath.Dir(exe), "..", "sequences")
			if dirExists(alt) {
				seqPath = alt
			}
		}
	}
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
			hub.SetCounters(func() (uint64, uint64) { return server.Received(), server.Dropped() })
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
		corr.SetEmit(alerts.Emit)
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

func dirExists(p string) bool {
	st, err := os.Stat(p)
	return err == nil && st.IsDir()
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
