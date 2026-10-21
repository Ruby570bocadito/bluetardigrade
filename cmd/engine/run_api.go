package main

// run_api.go assembles the local read-only API hub: listener (plain
// or TLS with hot rotation), every stats closure, the operator-scoping
// surfaces (host groups, enrollment), the credential-gated write
// surfaces (suppressions write, active response paths, AD settings),
// the detection-validation battery, the read-only AD connector and
// the background serve goroutine. Extracted from runEngine (POL-1);
// bodies are the original ones, behavior unchanged — including the
// defer semantics: the AD connector's Stop that the inline original
// released with `defer` now travels back as a cleanup the caller
// defers at the same point of the startup flow.

import (
	"context"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/ad"
	"github.com/Ruby570bocadito/bluetardigrade/internal/api"
	"github.com/Ruby570bocadito/bluetardigrade/internal/baseline"
	"github.com/Ruby570bocadito/bluetardigrade/internal/beacon"
	"github.com/Ruby570bocadito/bluetardigrade/internal/correlate"
	"github.com/Ruby570bocadito/bluetardigrade/internal/enroll"
	"github.com/Ruby570bocadito/bluetardigrade/internal/fleet"
	"github.com/Ruby570bocadito/bluetardigrade/internal/forensic"
	"github.com/Ruby570bocadito/bluetardigrade/internal/hostgroup"
	"github.com/Ruby570bocadito/bluetardigrade/internal/incident"
	"github.com/Ruby570bocadito/bluetardigrade/internal/ingest"
	"github.com/Ruby570bocadito/bluetardigrade/internal/intel"
	"github.com/Ruby570bocadito/bluetardigrade/internal/known"
	"github.com/Ruby570bocadito/bluetardigrade/internal/lifecycle"
	"github.com/Ruby570bocadito/bluetardigrade/internal/redact"
	"github.com/Ruby570bocadito/bluetardigrade/internal/reputation"
	"github.com/Ruby570bocadito/bluetardigrade/internal/rules"
	"github.com/Ruby570bocadito/bluetardigrade/internal/scenrun"
	"github.com/Ruby570bocadito/bluetardigrade/internal/store"
	"github.com/Ruby570bocadito/bluetardigrade/internal/suppress"
	"github.com/Ruby570bocadito/bluetardigrade/internal/threshold"
)

// apiBoot carries the collaborators the API hub needs at wiring time —
// the same set of runEngine locals the inline original closed over.
type apiBoot struct {
	o            *options
	ctx          context.Context
	engine       *rules.Engine
	seqPath      string
	server       *ingest.Server
	st           *store.Store
	supMgr       *suppress.Manager
	supPath      string
	knownMgr     *known.Manager
	corr         *correlate.Manager
	bcn          *beacon.Manager
	thr          *threshold.Detector
	lifeStore    *lifecycle.Store
	incStore     *incident.Store
	fleetTracker *fleet.Tracker
	enrollReg    *enroll.Registry
	intelM       *intel.Matcher
	baseTracker  *baseline.Tracker
	fore         *forensic.Recorder
	latTracker   *alertLatencyTracker
}

// startAPIHub builds and wires the API hub and serves it in the
// background. It returns the hub (nil when the API is disabled or its
// listener could not be created — both logged, never fatal), the
// bound address, the resolved bearer token (resolved once so the
// active-response arming below can apply its token layer without
// duplicating the flag>env order) and the AD cleanup: non-nil only
// when the connector was armed, and the caller MUST defer it.
func startAPIHub(b apiBoot) (*api.Hub, string, string, func()) {
	var hub *api.Hub
	apiAddr := ""
	apiTok := ""
	var cleanup func()
	if b.o.apiAddr != "0" {
		// API TLS: symmetric with the ingest listener — the pair
		// is validated up front (cert without key or vice versa
		// is a config error, not a silent plain-text fallback,
		// because the operator asked for encryption and would
		// otherwise believe they have it).
		if (b.o.apiCert == "") != (b.o.apiKey == "") {
			log.Fatalf("[ENGINE] -api-cert and -api-key must be set together (got cert=%q key=%q)", b.o.apiCert, b.o.apiKey)
		}
		var err error
		if b.o.apiCert != "" {
			hub, err = api.NewTLS(b.o.apiAddr, b.o.apiCert, b.o.apiKey)
		} else {
			hub, err = api.New(b.o.apiAddr)
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
			hub.SetRules(b.engine)
			hub.SetSuppressions(b.supMgr)
			hub.SetKnownSoftware(b.knownMgr)
			if b.st != nil {
				hub.SetStore(b.st)
			}
			hub.SetCounters(func() (uint64, uint64, uint64) {
				return b.server.Received(), b.server.Dropped(), b.server.Rejected()
			})
			hub.SetIngestIdentityStats(func() (int, uint64) {
				return b.server.Identities(), b.server.IdentityViolations()
			})
			// kill-chain observability: in-flight states, loaded
			// sequences and the tracking cap, so the correlator's
			// silent failure mode (cap exhausted -> new hosts
			// untracked) is watchable from /api/stats
			hub.SetCorrelatorStats(func() (int, int, int) {
				if b.corr == nil {
					return 0, 0, 0
				}
				return b.corr.States(), b.corr.Count(), correlate.MaxTrackedStates
			})
			// beaconing observability (A3): same contract as the
			// correlator above — live keys holding in-window evidence,
			// the hard cap and fires since startup, so the
			// silent-detection-loss failure mode (cap exhausted) is
			// watchable from /api/stats too.
			hub.SetBeaconStats(func() (int, int, uint64) {
				if b.bcn == nil {
					return 0, 0, 0
				}
				return b.bcn.Tracked(time.Now()), beacon.MaxKeys, b.bcn.Fired()
			})
			// threshold observability (A2): same contract — loaded
			// definitions, live keys and fires, so the detector's
			// failure mode (quota saturated) is watchable from
			// /api/stats.
			hub.SetThresholdStats(func() (int, int, uint64) {
				if b.thr == nil {
					return 0, 0, 0
				}
				return b.thr.Count(), b.thr.KeysTracked(), b.thr.Fired()
			})
			// v1.1 cuotas por equipo: per-host admission refusals of
			// the quota-capable detectors (beacon, threshold), so a
			// noisy host's pressure on the shared tables is watchable
			// from /api/stats. The closures run after the hub lock,
			// like every other stats wiring.
			hub.SetQuotaStats(func() api.QuotaSnapshot {
				qs := api.QuotaSnapshot{
					BeaconHosts:    map[string]uint64{},
					ThresholdHosts: map[string]uint64{},
				}
				if b.bcn != nil {
					qs.BeaconRejected = b.bcn.QuotaRejected()
					qs.BeaconHosts = b.bcn.QuotaHosts()
				}
				if b.thr != nil {
					qs.ThresholdRejected = b.thr.QuotaRejected()
					qs.ThresholdHosts = b.thr.QuotaHosts()
				}
				return qs
			})
			hub.SetSequences(b.corr)
			hub.SetLifecycle(b.lifeStore)
			hub.SetIncidents(b.incStore)
			hub.SetFleet(b.fleetTracker)
			if b.o.hostGroupsFile != "" {
				groups, sum, err := hostgroup.Load(b.o.hostGroupsFile)
				if err != nil {
					// operator access will be scoped by these groups: a
					// broken file stops the engine, it never silently
					// means "no groups"
					log.Fatalf("[ENGINE] %v", err)
				}
				hub.SetHostGroups(b.o.hostGroupsFile, groups, sum)
				fmt.Printf("[ENGINE] host groups: %d (%s)\n", len(groups.Names()), b.o.hostGroupsFile)
			}
			if b.enrollReg != nil {
				hub.SetEnrollment(b.enrollReg)
			}
			if b.intelM != nil {
				hub.SetIntel(b.intelM)
			}
			hub.SetBaseline(b.baseTracker)
			// reputation lookups stay off unless the operator sets a
			// provider key; keys come from the environment only (a flag
			// would show them in the process list)
			if rep := reputation.New(os.Getenv("SF_VT_API_KEY"), os.Getenv("SF_ABUSEIPDB_API_KEY")); rep.Any() {
				hub.SetReputation(rep)
				p := rep.Providers()
				fmt.Printf("[ENGINE] reputation lookups on demand: virustotal=%v abuseipdb=%v\n", p["virustotal"], p["abuseipdb"])
			}
			hub.SetForensic(b.fore)
			// same standard as the ingest token: flag wins, env fallback
			apiTok = b.o.apiToken
			if apiTok == "" {
				apiTok = os.Getenv("SF_API_TOKEN")
			}
			hub.SetToken(apiTok)
			if apiTok != "" {
				fmt.Println("[ENGINE] api auth: ENABLED (Authorization: Bearer required; /api/health stays open for probes)")
			} else if !isLoopback(hub.Addr()) {
				fmt.Println("[ENGINE] WARNING: API bound beyond loopback WITHOUT a token: anything that reaches this port can read every event and alert. Set -api-token or SF_API_TOKEN.")
			}
			// suppression writes (design §6.1): the write
			// surface is opt-in and inherits the bearer gate; a
			// non-loopback bind without a token refuses it at startup
			// because unauthenticated writes could silence detections.
			apiWrite := b.o.apiWrite || os.Getenv("SF_API_WRITE") == "1"
			switch {
			case !apiWrite:
			case b.o.suppressionsFile == "":
				fmt.Println("[ENGINE] api write: -api-write ignored, -suppressions is disabled (no file to write)")
			case apiTok == "" && !isLoopback(hub.Addr()):
				fmt.Println("[ENGINE] WARNING: -api-write refused: the API has no bearer token and is bound beyond loopback - unauthenticated writes could silence detections. Set -api-token or SF_API_TOKEN.")
			default:
				hub.EnableSuppressionsWrite(b.supPath)
				fmt.Printf("[ENGINE] api write: ENABLED (POST/DELETE /api/suppressions -> %s)\n", b.supPath)
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
			if b.o.scenariosDir != "" {
				var sink scenrun.RunSink
				if b.st != nil {
					sink = b.st
				}
				hub.SetScenarios(scenrun.New(b.o.scenariosDir, b.seqPath, scenrun.Deps{
					Rules: func() *rules.Engine { return b.engine },
					Sink:  sink,
					Logf:  log.Printf,
				}))
				history := "in memory"
				if b.st != nil {
					history = "in the store"
				}
				fmt.Printf("[ENGINE] scenarios: detection validation armed from %s (POST /api/scenarios/run; history %s)\n",
					b.o.scenariosDir, history)
			}

			// SET-3 platform status: engine version, ingest→alert
			// latency and both listeners' certificate expiry. The
			// console's view used to mark these "not published";
			// the engine publishes them from now on.
			hub.SetVersion(engineVersion)
			hub.SetAlertLatency(b.latTracker.snapshot)
			hub.SetIngestCertExpiry(b.server.CertExpiry)

			// Read-only Active Directory connector (AD-1/AD-2):
			// armed only with -ad AND a store (the snapshot is
			// persisted, never memory-only). The connector is
			// read-only by construction (bind + search only),
			// speaks LDAPS/StartTLS with the configured CA and a
			// least-privilege account, and pages with an object
			// cap. The posture analysis (AD-2) recomputes with
			// every completed sync.
			if b.o.adConfig != "" {
				if b.st == nil {
					log.Fatalf("[ENGINE] -ad requires -store: the directory snapshot is persisted to SQLite, never held in memory only")
				}
				adCfg, aerr := ad.Load(b.o.adConfig)
				if aerr != nil {
					log.Fatalf("[ENGINE] %v", aerr)
				}
				adLogger := log.New(os.Stderr, "[AD] ", log.LstdFlags)
				sensorHosts := func() []string {
					hosts := b.fleetTracker.Snapshot(time.Now())
					names := make([]string, 0, len(hosts))
					for _, fh := range hosts {
						names = append(names, fh.Host)
					}
					return names
				}
				adConn, aerr := ad.New(adCfg, b.st, adLogger, sensorHosts)
				if aerr != nil {
					log.Fatalf("[ENGINE] %v", aerr)
				}
				if aerr := adConn.Run(b.ctx); aerr != nil {
					log.Printf("[ENGINE] active directory: %v", aerr)
				}
				// the inline original released the connector with a
				// deferred Stop; the caller defers this cleanup at the
				// same point of the startup flow, so the shutdown
				// order is unchanged.
				cleanup = func() { adConn.Stop() }

				// AD-6: the settings surface commits a new config and
				// hot-swaps the connector. The hub invokes this callback
				// SYNCHRONOUSLY inside its adWriteMu critical section: swaps
				// are serialized against each other and against the file
				// commit (publication order == commit order), so the
				// `current` bookkeeping below needs no lock of its own.
				// ad.New is validation only, no I/O; the long-lived work —
				// start the next loop, stop the previous one — still happens
				// in background goroutines. Shutdown relies on ctx
				// cancellation for hot-swapped connectors (their loops
				// select on ctx.Done); the initial connector keeps its
				// explicit Stop above. A late sync of the PREVIOUS
				// connector is discarded at its ctx check; at worst it
				// leaves one stale snapshot that the next tick overwrites.
				current := adConn
				reconfigure := func(cfg *ad.Config) error {
					next, nerr := ad.New(cfg, b.st, adLogger, sensorHosts)
					if nerr != nil {
						return nerr
					}
					prev := current
					current = next
					hub.SetAD(next)
					go func() {
						if rerr := next.Run(b.ctx); rerr != nil {
							adLogger.Printf("[AD] sync after settings change failed: %v", rerr)
						}
					}()
					if prev != nil {
						go prev.Stop()
					}
					return nil
				}
				hub.SetADSettings(b.o.adConfig, reconfigure)
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
	return hub, apiAddr, apiTok, cleanup
}
