package main

// run_background.go starts the long-lived goroutines runEngine used to
// spawn inline: the fleet silence watcher (with its suspension-aware
// wall clock), the enrichment/correlator sweeps, the hot-reload loop,
// the store pruner and the shutdown watcher. Extracted from runEngine
// (POL-1); bodies are the original ones, behavior unchanged — the
// reload loop's mutable counters (supCount, knownCount, intelErr)
// travel in a pointer struct exactly because the original closures
// captured them by reference.

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/alert"
	"github.com/Ruby570bocadito/bluetardigrade/internal/api"
	"github.com/Ruby570bocadito/bluetardigrade/internal/baseline"
	"github.com/Ruby570bocadito/bluetardigrade/internal/beacon"
	"github.com/Ruby570bocadito/bluetardigrade/internal/correlate"
	"github.com/Ruby570bocadito/bluetardigrade/internal/enrich"
	"github.com/Ruby570bocadito/bluetardigrade/internal/fleet"
	"github.com/Ruby570bocadito/bluetardigrade/internal/ingest"
	"github.com/Ruby570bocadito/bluetardigrade/internal/intel"
	"github.com/Ruby570bocadito/bluetardigrade/internal/known"
	"github.com/Ruby570bocadito/bluetardigrade/internal/respond"
	"github.com/Ruby570bocadito/bluetardigrade/internal/rules"
	"github.com/Ruby570bocadito/bluetardigrade/internal/store"
	"github.com/Ruby570bocadito/bluetardigrade/internal/suppress"
	"github.com/Ruby570bocadito/bluetardigrade/internal/threshold"
)

// watchFleetSilence raises one "sensor sin señal" alert per outage of
// a sensor that sends heartbeats; it goes through the same suppression
// gate, so a planned maintenance can be silenced per host.
func watchFleetSilence(ctx context.Context, fleetTracker *fleet.Tracker, baseTracker *baseline.Tracker, st *store.Store, emitAllowlisted func(alert.Alert)) {
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
}

// startSweeps retires idle pid->identity entries (30 min TTL) so a
// long-lived engine's parent map does not leak dead pids, and rides
// the reload cadence; a zero cadence skips the sweep the same way it
// skips reloads (process entries still evict on terminate and on the
// per-host cap). The correlator sweep rides the same cadence.
func startSweeps(ctx context.Context, o *options, enricher *enrich.Enricher, corr *correlate.Manager) {
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
}

// hotReloadDeps is the state the hot-reload loop reads and updates:
// the same locals the inline original closed over. supCount,
// knownCount and intelErr are MUTATED on every tick (announce only
// when the size changes), so start uses a pointer receiver — the
// faithful translation of the original by-reference capture.
type hotReloadDeps struct {
	ctx            context.Context
	o              *options
	tui            bool
	stats          *liveStats
	engine         *rules.Engine
	rulesPath      string
	corr           *correlate.Manager
	seqPath        string
	supMgr         *suppress.Manager
	supPath        string
	supCount       int
	knownMgr       *known.Manager
	knownPath      string
	knownCount     int
	bcn            *beacon.Manager
	bcnPath        string
	thr            *threshold.Detector
	thrPath        string
	intelM         *intel.Matcher
	intelErr       string
	identitiesPath string
	server         *ingest.Server
	respMgr        *respond.Manager
	respOpsPath    string
	respProtPath   string
}

// start launches the hot-reload goroutine when -reload-every is set:
// announce a set only when its size changes, and a failed reload when
// the error first appears or changes. Printing every cycle buried the
// engine window in identical "reloaded" lines, while a broken edit to
// rules or sequences used to be silently ignored.
func (d *hotReloadDeps) start() {
	if d.o.reloadEvery > 0 {
		rulesRep := reloadReporter{name: "rules", count: d.engine.Count(), quiet: d.tui}
		seqRep := reloadReporter{name: "sequences", count: -1, quiet: d.tui}
		if d.corr != nil {
			seqRep.count = d.corr.Count()
		}
		bcnRep := reloadReporter{name: "beacons", count: -1, quiet: d.tui}
		if d.bcn != nil {
			bcnRep.count = d.bcn.Count()
		}
		thrRep := reloadReporter{name: "thresholds", count: -1, quiet: d.tui}
		if d.thr != nil {
			thrRep.count = d.thr.Count()
		}
		go func() {
			t := time.NewTicker(d.o.reloadEvery)
			defer t.Stop()
			for {
				select {
				case <-d.ctx.Done():
					return
				case <-t.C:
					// Reload from the RESOLVED rules path: when the
					// flag path does not exist in the current working
					// directory, startup fell back to the directory
					// next to the executable, and reloading from the
					// raw flag would fail (silently) every cycle.
					err := d.engine.Reload(d.rulesPath)
					if err == nil {
						d.stats.setRuleCatalog(d.engine.Snapshot())
					}
					rulesRep.report(d.engine.Count(), err)
					if d.corr != nil && dirExists(d.seqPath) {
						err := d.corr.Reload(d.seqPath)
						seqRep.report(d.corr.Count(), err)
					}
					if d.o.suppressionsFile != "" {
						// reload errors are LOUD here: keeping the previous set is the
						// right fallback, but the operator must know the edit was
						// rejected (otherwise an expiring entry silently lingers).
						if err := d.supMgr.LoadFile(d.supPath); err != nil {
							log.Printf("[ENGINE] suppressions reload FAILED, keeping previous set: %v", err)
						} else if n := d.supMgr.Count(time.Now()); n != d.supCount {
							if !d.tui {
								fmt.Printf("[ENGINE] suppressions reloaded (%d active)\n", n)
							}
							d.supCount = n
						}
					}
					if d.o.knownFile != "" {
						if err := d.knownMgr.LoadFile(d.knownPath); err != nil {
							log.Printf("[ENGINE] known-software reload FAILED, keeping previous list: %v", err)
						} else if n := d.knownMgr.Count(); n != d.knownCount {
							if !d.tui {
								fmt.Printf("[ENGINE] known-software reloaded (%d entries)\n", n)
							}
							d.knownCount = n
						}
					}
					if d.bcn != nil && fileExists(d.bcnPath) {
						err := d.bcn.Reload(d.bcnPath)
						bcnRep.report(d.bcn.Count(), err)
					}
					if d.thr != nil && fileExists(d.thrPath) {
						err := d.thr.Reload(d.thrPath)
						thrRep.report(d.thr.Count(), err)
					}
					if d.intelM != nil {
						if changed, err := d.intelM.Reload(); err != nil {
							if err.Error() != d.intelErr {
								d.intelErr = err.Error()
								log.Printf("[ENGINE] threat-intel reload FAILED, keeping previous lists: %v", err)
							}
						} else if d.intelErr = ""; changed && !d.tui {
							fmt.Printf("[ENGINE] threat intel reloaded (%d indicators)\n", d.intelM.Total())
						}
					}
					// per-sensor identities: a failed reload keeps the
					// previous set (a half-edited file must not lock
					// every sensor out) and says so
					if d.identitiesPath != "" {
						if ids, ierr := ingest.LoadIdentities(d.identitiesPath); ierr != nil {
							log.Printf("[ENGINE] ingest identities reload FAILED, keeping previous set: %v", ierr)
						} else {
							d.server.SetIdentities(ids)
						}
					}
					// active response lists (C3): a missing file on
					// reload keeps the previous set (an edit in
					// progress must not empty the allowlist);
					// malformed entries stay loud and are ignored.
					if d.respMgr != nil {
						if fileExists(d.respOpsPath) {
							if err := d.respMgr.LoadOperators(d.respOpsPath); err != nil {
								log.Printf("[ENGINE] respond operators reload FAILED, keeping previous set: %v", err)
							}
						}
						if d.respProtPath != "" && fileExists(d.respProtPath) {
							if err := d.respMgr.LoadProtected(d.respProtPath); err != nil {
								log.Printf("[ENGINE] respond protected reload FAILED, keeping previous set: %v", err)
							}
						}
					}
				}
			}
		}()
	}
}

// startStorePruner prunes the store on a 5-minute ticker when
// retention is set; only loud when something was actually removed.
func startStorePruner(ctx context.Context, st *store.Store, retention time.Duration) {
	if st != nil && retention > 0 {
		go func() {
			t := time.NewTicker(5 * time.Minute)
			defer t.Stop()
			for {
				select {
				case <-ctx.Done():
					return
				case <-t.C:
					if dEv, dAl, dAu, perr := st.Prune(retention); perr == nil && dEv+dAl+dAu > 0 {
						fmt.Printf("[ENGINE] store pruned %d events / %d alerts / %d audit rows older than %s\n", dEv, dAl, dAu, retention)
					}
				}
			}
		}()
	}
}

// startShutdownWatch closes the ingest server (which closes the
// events channel: the loop drains and exits) and the API hub when the
// context is cancelled. A second signal hard-exits, whatever the
// graceful path does.
func startShutdownWatch(ctx context.Context, server *ingest.Server, hub *api.Hub) {
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
}
