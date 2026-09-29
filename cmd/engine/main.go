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
        "os"
        "os/signal"
        "syscall"
        "time"

        "github.com/Ruby570bocadito/security-framework/internal/alert"
        "github.com/Ruby570bocadito/security-framework/internal/enrich"
        "github.com/Ruby570bocadito/security-framework/internal/ingest"
        "github.com/Ruby570bocadito/security-framework/internal/rules"
        "github.com/Ruby570bocadito/security-framework/pkg/model"
)

var (
        addr      = flag.String("addr", ":7777", "TCP listen address for sensor streams")
        rulesDir  = flag.String("rules", "./rules", "directory with YAML rules")
        verbose   = flag.Bool("v", false, "print every event received")
        reloadEvery = flag.Duration("reload-every", 15*time.Second,
                "hot-reload interval for the rules directory (0 disables)")
)

func main() {
        flag.Parse()
        log.SetFlags(0)

        ctx, stop := signal.NotifyContext(context.Background(),
                os.Interrupt, syscall.SIGTERM)
        defer stop()

        engine, err := rules.LoadDir(*rulesDir)
        if err != nil {
                log.Fatalf("[ENGINE] loading rules from %s: %v", *rulesDir, err)
        }
        fmt.Printf("[ENGINE] %d rules loaded from %s (types: %v)\n",
                engine.Count(), *rulesDir, engine.Types())

        events := make(chan *model.Event, 1024)
        server, err := ingest.New(*addr, events)
        if err != nil {
                log.Fatalf("[ENGINE] %v", err)
        }
        go server.Serve()
        fmt.Printf("[ENGINE] listening on %s (NDJSON, 1 event per line)\n", server.Addr())

        enricher := enrich.New()
        alerts := alert.New(os.Stdout)

        if *reloadEvery > 0 {
                go func() {
                        t := time.NewTicker(*reloadEvery)
                        defer t.Stop()
                        for {
                                select {
                                case <-ctx.Done():
                                        return
                                case <-t.C:
                                        if err := engine.Reload(*rulesDir); err == nil {
                                                fmt.Printf("[ENGINE] rules reloaded (%d active)\n", engine.Count())
                                        }
                                }
                        }
                }()
        }

        go func() {
                <-ctx.Done()
                fmt.Println("\n[ENGINE] shutting down...")
                server.Shutdown()
        }()

        processed := 0
        start := time.Now()
        for ev := range events {
                enricher.Apply(ev)
                if *verbose {
                        log.Printf("[EVENT] %-18s %s pid=%d host=%s",
                                ev.Type, describe(ev), pidOf(ev), ev.Host)
                }
                for _, hit := range engine.Evaluate(ev) {
                        alerts.Raise(ev, hit)
                }
                processed++
        }

        fmt.Printf("[ENGINE] processed %d events in %s (ingested=%d dropped=%d)\n",
                processed, time.Since(start).Round(time.Millisecond),
                server.Received(), server.Dropped())
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
