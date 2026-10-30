package main

// run_load.go gathers the startup loading of every operator-supplied
// input the engine consumes: rules, kill-chain sequences, beacons,
// thresholds, threat intel, the SQLite store, suppressions, the
// known-software list, the forensic recorder, the alert lifecycle and
// the incident store. Each loader keeps the original convention: a
// control the operator believes is armed must not silently stay off,
// so a malformed file is FATAL (log.Fatalf) and a missing optional one
// just means the feature is off. Extracted from runEngine (POL-1);
// bodies are the original ones, behavior unchanged.

import (
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/beacon"
	"github.com/Ruby570bocadito/bluetardigrade/internal/correlate"
	"github.com/Ruby570bocadito/bluetardigrade/internal/forensic"
	"github.com/Ruby570bocadito/bluetardigrade/internal/incident"
	"github.com/Ruby570bocadito/bluetardigrade/internal/intel"
	"github.com/Ruby570bocadito/bluetardigrade/internal/known"
	"github.com/Ruby570bocadito/bluetardigrade/internal/lifecycle"
	"github.com/Ruby570bocadito/bluetardigrade/internal/rules"
	"github.com/Ruby570bocadito/bluetardigrade/internal/store"
	"github.com/Ruby570bocadito/bluetardigrade/internal/suppress"
	"github.com/Ruby570bocadito/bluetardigrade/internal/threshold"
)

// loadEngineRules loads the rule engine and seeds the live stats
// catalog. It returns the resolved rules path because the hot-reload
// loop must reload from the RESOLVED directory (when the flag path
// does not exist in the current working directory, startup fell back
// to the directory next to the executable).
func loadEngineRules(o *options, stats *liveStats) (*rules.Engine, string) {
	rulesPath := resolveDataDir(o.rulesDir, "rules")
	engine, err := rules.LoadDir(rulesPath)
	if err != nil {
		log.Fatalf("[ENGINE] loading rules from %s: %v", rulesPath, err)
	}
	fmt.Printf("[ENGINE] %d rules loaded from %s (types: %v)\n",
		engine.Count(), rulesPath, engine.Types())
	stats.setRuleCatalog(engine.Snapshot())
	return engine, rulesPath
}

// loadSequences loads the kill-chain sequences (same resolution order
// as the rules dir). A missing directory means no correlator.
func loadSequences(o *options) (*correlate.Manager, string) {
	seqPath := resolveDataDir(o.seqDir, "sequences")
	var corr *correlate.Manager
	if dirExists(seqPath) {
		loaded, err := correlate.LoadDir(seqPath, nil)
		if err != nil {
			log.Fatalf("[ENGINE] loading sequences from %s: %v", seqPath, err)
		}
		corr = loaded
		if n := corr.Count(); n > 0 {
			fmt.Printf("[ENGINE] %d sequences loaded from %s (correlator on: %v)\n",
				n, seqPath, corr.Names())
		}
	}
	return corr, seqPath
}

// loadBeacons loads the beaconing detector profiles (A3): one YAML
// file. Missing file = detector off (the sequences-dir convention); a
// file that exists but does not parse is FATAL.
func loadBeacons(o *options) (*beacon.Manager, string) {
	var bcn *beacon.Manager
	bcnPath := ""
	if o.beaconsFile != "" {
		bcnPath = resolveDataFile(o.beaconsFile, "beacons.yaml")
		if fileExists(bcnPath) {
			loaded, err := beacon.LoadFile(bcnPath, nil)
			if err != nil {
				log.Fatalf("[ENGINE] loading beacons from %s: %v", bcnPath, err)
			}
			bcn = loaded
			if n := bcn.Count(); n > 0 {
				fmt.Printf("[ENGINE] %d beacon profiles loaded from %s (beaconing detection on: %v)\n",
					n, bcnPath, bcn.Names())
			}
		}
	}
	return bcn, bcnPath
}

// loadThresholds loads the volumetric threshold detector (A2): same
// file convention as the beacons — missing file = off, malformed file
// = FATAL.
func loadThresholds(o *options) (*threshold.Detector, string) {
	var thr *threshold.Detector
	thrPath := ""
	if o.thresholdsFile != "" {
		thrPath = resolveDataFile(o.thresholdsFile, "thresholds.yaml")
		if fileExists(thrPath) {
			loaded, err := threshold.LoadFile(thrPath)
			if err != nil {
				log.Fatalf("[ENGINE] loading thresholds from %s: %v", thrPath, err)
			}
			thr = loaded
			if n := thr.Count(); n > 0 {
				fmt.Printf("[ENGINE] %d threshold definitions loaded from %s (volumetric detection on: %v)\n",
					n, thrPath, thr.Names())
			}
		}
	}
	return thr, thrPath
}

// loadIntel loads the offline threat-intelligence lists: a missing
// directory means no lists; an unreadable list is logged and retried
// on every reload (the operator fixes the file, the engine picks it
// up). It also returns the initial error text because the hot-reload
// loop only announces a reload failure when its wording changes.
func loadIntel(o *options) (*intel.Matcher, string) {
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
	return intelM, intelErr
}

// openStore opens the optional SQLite persistence (phase 2 storage
// stone): when the operator asks for a store, a failure to open it is
// a config error and FATAL. The first prune runs right away, then the
// periodic one lives in run_background.go; the caller owns the Close.
func openStore(o *options) *store.Store {
	if o.storePath == "" {
		return nil
	}
	st, err := store.Open(o.storePath)
	if err != nil {
		log.Fatalf("[ENGINE] %v%s", err, storeOpenHint(err))
	}
	if o.storeRetention > 0 {
		fmt.Printf("[ENGINE] store on %s (retention %s)\n", o.storePath, o.storeRetention)
	} else {
		fmt.Printf("[ENGINE] store on %s (retention: keep forever)\n", o.storePath)
	}
	// first prune right away, then on a ticker; only loud
	// when something was actually removed
	if o.storeRetention > 0 {
		if dEv, dAl, dAu, perr := st.Prune(o.storeRetention); perr == nil && dEv+dAl+dAu > 0 {
			fmt.Printf("[ENGINE] store pruned %d events / %d alerts / %d audit rows older than %s\n", dEv, dAl, dAu, o.storeRetention)
		}
	}
	return st
}

// loadSuppressions loads the operator allowlist (alert suppressions:
// rule + host, optional expiration), hot-reloaded on the same ticker
// as rules. A malformed file is FATAL at startup: failing open would
// silently disable a control the operator believes is armed. It
// returns the resolved path (the write surface needs it) and the
// active count (the reload loop announces changes).
func loadSuppressions(o *options) (*suppress.Manager, string, int) {
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
	return supMgr, supPath, supCount
}

// loadKnownSoftware loads the §2.2 known-software list: events
// matching an entry carry enrichment.known_software (the event is
// never deleted or hidden). Hot-reloaded on the same ticker as rules;
// a malformed file is FATAL at startup, like the suppressions file.
func loadKnownSoftware(o *options) (*known.Manager, string, int) {
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
	return knownMgr, knownPath, knownCount
}

// newForensicRecorder builds the forensic flight recorder + evidence
// bundles when armed. Off is off: -forensic=false keeps nothing (nil).
func newForensicRecorder(o *options) *forensic.Recorder {
	var fore *forensic.Recorder
	if o.forensic {
		if o.forensicRetain < 1 {
			log.Fatalf("[ENGINE] -forensic-retention=%d must be >= 1: there is no unbounded evidence mode (an ever-growing bundle directory fills the disk); use -forensic=false to turn capture off", o.forensicRetain)
		}
		foreDir := o.forensicDir
		if foreDir == "" {
			// same resolution order as rules/sequences: the installed
			// engine finds <forensics> next to its own tree
			foreDir = resolveDataDir("./forensics", "forensics")
		}
		fore = forensic.NewWithRetention(foreDir, o.forensicRetain)
		fmt.Printf("[ENGINE] forensic: evidence bundles for high/critical alerts -> %s (window %s, keeping %d, oldest evicted)\n",
			foreDir, forensic.CaptureWindow, o.forensicRetain)
	}
	return fore
}

// openLifecycle opens the alert lifecycle store (r6): operator triage
// state (acknowledged/closed + notes) served by
// POST /api/alerts/{id}/status. A malformed file is FATAL, same
// standard as suppressions: silently starting with every alert back
// in "new" would undo triage work the operator believes is recorded.
func openLifecycle(o *options) *lifecycle.Store {
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
	return lifeStore
}

// openIncidents opens the incident store: cases grouping alerts
// (internal/incident). Same fatal standard as the lifecycle file: a
// malformed file would silently drop the cases the operators believe
// are recorded.
func openIncidents(o *options) *incident.Store {
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
	return incStore
}

// storeOpenHint adds the way out when the store file itself is unusable:
// SQLite names the problem ("file is not a database"), not what to do.
func storeOpenHint(err error) string {
	msg := err.Error()
	if strings.Contains(msg, "file is not a database") || strings.Contains(msg, "database disk image is malformed") {
		return "\n[ENGINE] the store file is damaged or is not a bluetardigrade database: move it aside so the engine starts a new store, or restore it from a backup"
	}
	return ""
}
