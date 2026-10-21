package main

// run_pipeline.go is the detection pipeline: the per-event process
// step (flight recorder, publish, rule evaluation, the behavioral and
// volumetric detectors, threat intel and the baseline novelty) and
// the batched drain loop (enrich once, persist in ONE store
// transaction, then process). Extracted from runEngine (POL-1); the
// closures became methods on pipeline, which is the faithful
// translation of the original by-reference captures — behavior
// unchanged, including `processed` living on the struct so the final
// startup summary reads the same counter the loop incremented.

import (
	"fmt"
	"log"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/alert"
	"github.com/Ruby570bocadito/bluetardigrade/internal/api"
	"github.com/Ruby570bocadito/bluetardigrade/internal/baseline"
	"github.com/Ruby570bocadito/bluetardigrade/internal/beacon"
	"github.com/Ruby570bocadito/bluetardigrade/internal/correlate"
	"github.com/Ruby570bocadito/bluetardigrade/internal/enrich"
	"github.com/Ruby570bocadito/bluetardigrade/internal/forensic"
	"github.com/Ruby570bocadito/bluetardigrade/internal/intel"
	"github.com/Ruby570bocadito/bluetardigrade/internal/redact"
	"github.com/Ruby570bocadito/bluetardigrade/internal/rules"
	"github.com/Ruby570bocadito/bluetardigrade/internal/store"
	"github.com/Ruby570bocadito/bluetardigrade/internal/suppress"
	"github.com/Ruby570bocadito/bluetardigrade/internal/threshold"
	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
)

// pipeline carries the collaborators the per-event processing needs —
// the same runEngine locals the original process/loop closures
// captured. processed is the event counter the drain loop increments
// and the final summary prints.
type pipeline struct {
	o                    *options
	tui                  bool
	stats                *liveStats
	engine               *rules.Engine
	hub                  *api.Hub
	st                   *store.Store
	fore                 *forensic.Recorder
	supMgr               *suppress.Manager
	alerts               *alert.Manager
	corr                 *correlate.Manager
	bcn                  *beacon.Manager
	thr                  *threshold.Detector
	intelM               *intel.Matcher
	baseTracker          *baseline.Tracker
	enricher             *enrich.Enricher
	emitAllowlistedEvent func(ev *model.Event, a alert.Alert)
	processed            int
}

// process runs one event through detection after it was persisted.
func (p *pipeline) process(ev *model.Event) {
	// flight recorder: before evaluation, so the event that
	// triggers an alert is guaranteed to be in the ring when
	// the alert's bundle is captured in the same iteration.
	if p.fore != nil {
		p.fore.ObserveEvent(ev)
	}
	if p.hub != nil {
		p.hub.PublishEvent(ev)
	}
	p.stats.recordEvent()
	if p.o.verbose && !p.tui {
		log.Printf("[EVENT] %-18s %s pid=%d host=%s",
			redact.TerminalText(ev.Type), redact.TerminalText(describe(ev)), pidOf(ev), redact.TerminalText(ev.Host))
	}
	for _, hit := range p.engine.Evaluate(ev) {
		// allowlist first: a suppressed hit raises no alert AND does
		// not feed the correlator (see the Emit wrapper above). The
		// event rides along so a CONDITIONAL entry (§2.3 when)
		// suppresses only the invocation shape it names.
		if suppressed(p.supMgr, hit.Rule.ID, ev.Host, ev, time.Now()) {
			if !p.tui {
				log.Printf("[SUPPRESS] rule=%s host=%s", redact.TerminalText(hit.Rule.ID), redact.TerminalText(ev.Host))
			}
			continue
		}
		p.alerts.Raise(ev, hit)
		if p.corr != nil {
			p.corr.Observe(ev, hit.Rule.Name)
		}
	}
	// behavioral detector (A3): consumes raw network.connect
	// events regardless of rule hits — beaconing is a
	// property of event timing, not of any single event.
	if p.bcn != nil {
		p.bcn.Observe(ev, time.Now())
	}
	// volumetric detector (A2): consumes raw events that pass
	// each definition's predicate — the signal is the COUNT
	// within a window, orthogonal to rules and beaconing.
	if p.thr != nil {
		p.thr.Observe(ev, time.Now())
	}
	// offline threat intel: indicators in the event, one alert per
	// indicator and host per cooldown
	if p.intelM != nil {
		now := time.Now()
		for _, hit := range p.intelM.Match(ev) {
			if p.intelM.Allow(hit, ev.Host, now) {
				p.emitAllowlistedEvent(ev, intelAlert(ev, hit, now))
			}
		}
	}
	// baseline: a process this host never ran after its learning period.
	// Known software (§2.2) is LEARNED but never reported as a novelty:
	// the whole point of the list is that its boots are expected, and
	// learning keeps the baseline honest for the day the entry is
	// removed (the host has demonstrably run it for months).
	if nov := p.baseTracker.Observe(ev, time.Now()); nov != nil && ev.Enrichment["known_software"] == "" {
		p.emitAllowlistedEvent(ev, noveltyAlert(ev, nov, time.Now()))
	}
	p.processed++
}

// loop drains whatever the ingest has already queued (up to
// maxEventBatch) and persists it in ONE store transaction before
// any of those events is published or evaluated: durable evidence
// first, live delivery second, as before, but SQLite's commit is
// paid once per batch. Idle traffic yields batches of one, so no
// event ever waits for company.
func (p *pipeline) loop(events chan *model.Event) {
	const maxEventBatch = 256
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
			p.enricher.Apply(e)
		}
		switch {
		case p.hub != nil:
			// the hub persists to the store when attached
			p.hub.PersistEvents(batch)
		case p.st != nil:
			// -api 0 with -store: keep persisting without a hub
			res := p.st.InsertEvents(batch)
			for _, err := range res.Failed {
				storeWriteErr(err)
			}
			for _, id := range res.Conflicts {
				storeWriteErr(fmt.Errorf("%w (id %s)", store.ErrIDConflict, id))
			}
		}
		for _, e := range batch {
			p.process(e)
		}
	}
}
