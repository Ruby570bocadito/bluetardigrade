package main

// run_ingest.go boots the telemetry ingest listener: TLS pair
// validation, the NDJSON server itself, its shared-token and
// per-sensor identity credentials, sensor enrollment and the
// machine/baseline trackers that observe every accepted event, plus
// the startup banners the operator reads. Extracted from runEngine
// (POL-1); bodies are the original ones, behavior unchanged.

import (
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/baseline"
	"github.com/Ruby570bocadito/bluetardigrade/internal/enroll"
	"github.com/Ruby570bocadito/bluetardigrade/internal/fleet"
	"github.com/Ruby570bocadito/bluetardigrade/internal/ingest"
	"github.com/Ruby570bocadito/bluetardigrade/internal/store"
	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
)

// validateIngestTLS enforces that both halves of the ingest TLS pair
// are present: a half-set deployment fails at startup instead of
// silently serving the feed in clear text. Validation happens BEFORE
// the bind: a wrong pair must not race with an already-usable
// listener.
func validateIngestTLS(o *options) error {
	if (o.ingestCert == "") != (o.ingestKey == "") {
		if o.ingestCert == "" {
			return fmt.Errorf("ingest TLS requires -ingest-cert too (-ingest-key was set; pass both or neither)")
		}
		return fmt.Errorf("ingest TLS requires -ingest-key too (-ingest-cert was set; pass both or neither)")
	}
	return nil
}

// startIngest builds the ingest server, arms its credentials (shared
// token, previous token for rotation windows, per-sensor identities)
// and opens the enrollment registry. A nil server (with everything
// else nil) means another engine instance already owns the port and
// the graceful "already running" banner was printed; every hard
// config failure is FATAL here, exactly as before. The resolved
// identities path comes back because the hot-reload loop reloads it.
func startIngest(o *options, events chan *model.Event) (*ingest.Server, *enroll.Registry, string, string) {
	var server *ingest.Server
	var err error
	if o.ingestCert != "" {
		server, err = ingest.NewTLS(o.addr, o.ingestCert, o.ingestKey, events)
	} else {
		server, err = ingest.New(o.addr, events)
	}
	if err != nil {
		// A bind failure almost always means another engine
		// instance is already running (e.g. started by
		// sf-sensor or sf-console). Probe the port instead of
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
			return nil, nil, "", ""
		}
		log.Fatalf("[ENGINE] %v", err)
	}
	// shared-token auth: flag wins over the env var, so operators
	// can override SF_INGEST_TOKEN per process without touching the
	// autostart entry. The bundled sensors honor the same env var.
	// Every credential is configured BEFORE Serve starts: a connection
	// accepted earlier would be handled as unauthenticated (and read
	// the token fields while they are being written).
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
	identitiesPath := o.ingestIdentities
	if identitiesPath == "" {
		identitiesPath = os.Getenv("SF_INGEST_IDENTITIES")
	}
	if identitiesPath != "" {
		ids, ierr := ingest.LoadIdentities(identitiesPath)
		if ierr != nil {
			log.Fatalf("[ENGINE] %v", ierr)
		}
		server.SetIdentities(ids)
		fmt.Printf("[ENGINE] ingest identities: %d per-sensor credentials bound to their hosts (%s)\n", len(ids), identitiesPath)
	}
	// sensor enrollment (internal/enroll): tokens from the console,
	// approval by an administrator, credentials bound to their host
	enrollPath := o.enrollFile
	if enrollPath == "" {
		enrollPath = os.Getenv("SF_ENROLL")
	}
	var enrollReg *enroll.Registry
	if enrollPath != "" {
		enrollReg, err = enroll.Open(enrollPath)
		if err != nil {
			log.Fatalf("[ENGINE] %v", err)
		}
		enrollReg.SetBoundElsewhere(server.BoundIdentity)
		enrollReg.SetOnWithdraw(func(name string) {
			if n := server.DropIdentity(name); n > 0 {
				log.Printf("[ENROLL] %s withdrawn: closed %d open connection(s)", name, n)
			}
		})
		server.SetEnroller(enroll.Gate{Registry: enrollReg, Logf: log.Printf})
		pending, active, usable := enrollReg.Counts()
		fmt.Printf("[ENGINE] enrollment: ON (%s): %d active, %d pending, %d usable tokens\n", enrollPath, active, pending, usable)
		if o.ingestCert == "" && !isLoopback(o.addr) {
			fmt.Println("[ENGINE] enrollment: the ingest is plain TCP beyond loopback, so ENROLL is only accepted from this machine until -ingest-cert/-ingest-key are set (the credential must not cross the network in clear)")
		}
	}
	return server, enrollReg, ingestToken, identitiesPath
}

// restoreTrackers rebuilds the per-host process baseline and the
// machine inventory from the store (with -store both survive
// restarts; restored hosts get a full grace before they can be
// declared silent).
func restoreTrackers(o *options, st *store.Store) (*baseline.Tracker, *fleet.Tracker) {
	// machine inventory (internal/fleet): every accepted event and the
	// sensors' heartbeats; read through GET /api/fleet
	// per-host baseline of processes already seen (internal/baseline)
	baseTracker := baseline.New(o.baselineLearn)
	if st != nil {
		if entries, hosts, berr := st.LoadBaseline(); berr != nil {
			log.Printf("[BASELINE] restoring FAILED: %v", berr)
		} else {
			restored := make([]baseline.Entry, 0, len(entries))
			for _, e := range entries {
				restored = append(restored, baseline.Entry{Host: e.Host, Kind: e.Kind, Value: e.Value, FirstSeen: e.FirstSeen})
			}
			baseTracker.Restore(restored, hosts)
		}
	}
	fleetTracker := fleet.New()
	if st != nil {
		// with -store the inventory survives restarts; restored hosts
		// get a full grace before they can be declared silent
		if docs, ferr := st.LoadFleetHosts(); ferr != nil {
			log.Printf("[FLEET] restoring the inventory FAILED: %v", ferr)
		} else if n := fleetTracker.Restore(docs, time.Now()); n > 0 {
			fmt.Printf("[ENGINE] fleet: %d machines restored from the store\n", n)
		}
	}
	return baseTracker, fleetTracker
}

// serveIngest attaches the fleet observer, starts the ingest listener
// and prints the auth/TLS banners the operator reads at startup.
func serveIngest(server *ingest.Server, o *options, ingestToken string, fleetTracker *fleet.Tracker) {
	server.SetObserver(fleetTracker)
	go server.Serve()
	if server.AuthEnabled() {
		fmt.Println(ingestAuthBanner(server.Rotating(), ingestToken, server.Identities()))
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
}
