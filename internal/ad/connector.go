package ad

import (
	"context"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/store"
)

// ObjectsCounts is the per-kind size of the current snapshot.
type ObjectsCounts struct {
	Users     int64 `json:"users"`
	Groups    int64 `json:"groups"`
	Computers int64 `json:"computers"`
	OUs       int64 `json:"ous"`
}

// Status is the connector state the API serves. Handlers receive VALUE
// copies (Snapshot), never a pointer to the live struct: the sync
// goroutine and the HTTP handlers never share mutable memory (the
// round-1 lesson from the scenario runner, applied by construction).
type Status struct {
	Connected     bool          `json:"connected"`       // the last sync attempt reached the server and bound
	LastSyncAt    *time.Time    `json:"last_sync_at"`    // last attempt, success or failure
	LastSuccessAt *time.Time    `json:"last_success_at"` // last completed snapshot
	NextSyncAt    *time.Time    `json:"next_sync_at"`    // scheduled attempt (nil while stopped)
	LastError     string        `json:"last_error"`      // human-readable, credential-free
	Truncated     bool          `json:"truncated"`       // the object cap stopped the last sync
	Syncs         uint64        `json:"syncs"`           // attempts since start
	Objects       ObjectsCounts `json:"objects"`         // counts of the last completed snapshot
	Warnings      []string      `json:"warnings"`        // connector-level observations (e.g. privileged bind account)
}

// Connector runs the periodic directory sync against one SQLite
// store. It owns the ONLY pointer to the live status; everyone else
// reads copies.
type Connector struct {
	cfg   *Config
	store *store.Store
	log   *log.Logger

	// sensorHosts, when set, lists the hostnames that currently report
	// to the engine (the fleet tracker): the coverage finding compares
	// the directory's computers against it.
	sensorHosts func() []string

	mu     sync.Mutex
	status Status

	cancel context.CancelFunc
	// started closes once Run has fully stopped (tests wait on it).
	done chan struct{}
}

// New validates the config (applying defaults) and returns a
// connector bound to the store. It performs NO network I/O: use Run or
// SyncOnce for that.
func New(cfg *Config, st *store.Store, logger *log.Logger, sensorHosts func() []string) (*Connector, error) {
	if st == nil {
		return nil, fmt.Errorf("ad: the connector requires -store: the directory snapshot is persisted, never held in memory only")
	}
	if cfg == nil {
		return nil, fmt.Errorf("ad: config is required")
	}
	if logger == nil {
		logger = log.Default()
	}
	n := cfg.normalized()
	if err := n.validate(); err != nil {
		return nil, fmt.Errorf("ad: %w", err)
	}
	return &Connector{
		cfg:         n,
		store:       st,
		log:         logger,
		sensorHosts: sensorHosts,
		status:      Status{Warnings: []string{}},
		done:        make(chan struct{}),
	}, nil
}

// Snapshot returns a copy of the current connector status. The
// warnings slice is copied too: a handler that sorts or appends to it
// must never mutate connector state.
func (c *Connector) Snapshot() Status {
	c.mu.Lock()
	defer c.mu.Unlock()
	s := c.status
	if s.Warnings != nil {
		s.Warnings = append([]string{}, s.Warnings...)
	}
	return s
}

func (c *Connector) setStatus(fn func(*Status)) {
	c.mu.Lock()
	defer c.mu.Unlock()
	fn(&c.status)
}

// Run starts the periodic sync (one immediate, then every interval)
// until ctx is cancelled. It returns after the FIRST sync completes,
// so callers can log the initial state; later syncs run in the
// background. Calling Run twice is a programming error (use one
// connector per engine).
func (c *Connector) Run(ctx context.Context) error {
	ctx, c.cancel = context.WithCancel(ctx)
	if err := c.SyncOnce(ctx); err != nil {
		// The first failure is logged and surfaced in the status, not
		// fatal: a domain controller briefly offline at engine start
		// must not take the engine down. The loop keeps retrying.
		c.log.Printf("[AD] initial sync failed: %v", err)
	}
	// Scheduled synchronously so callers that inspect the status right
	// after Run see the next sync already promised (no startup race).
	next := time.Now().Add(c.cfg.Interval)
	c.setStatus(func(s *Status) { s.NextSyncAt = &next })
	go func() {
		defer close(c.done)
		ticker := time.NewTicker(c.cfg.Interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if err := c.SyncOnce(ctx); err != nil {
					c.log.Printf("[AD] sync failed: %v", err)
				}
				n := time.Now().Add(c.cfg.Interval)
				c.setStatus(func(s *Status) { s.NextSyncAt = &n })
			}
		}
	}()
	return nil
}

// Stop cancels the loop and waits for it (used on shutdown paths and
// by tests). Safe to call once; Run must have been called.
func (c *Connector) Stop() {
	if c.cancel != nil {
		c.cancel()
	}
	<-c.done
}

// SyncOnce performs one full directory read and installs the
// snapshot. This is the ONLY method that talks LDAP, and it does so
// exclusively through connect (bind) and searchPaged (searches):
// the package has no write primitive to reach for.
func (c *Connector) SyncOnce(ctx context.Context) error {
	now := time.Now()
	c.setStatus(func(s *Status) { s.Syncs++; s.LastSyncAt = &now; s.LastError = "" })

	// The password is re-read every sync: rotating the credential file
	// does not require an engine restart. It lives in a local variable
	// that never leaves the call stack.
	password, err := c.cfg.Password()
	if err != nil {
		c.failSync(err)
		return err
	}
	conn, err := c.connect(password)
	if err != nil {
		c.failSync(err)
		return err
	}
	defer conn.Close()

	res, truncated, err := c.fetchAll(conn)
	if err != nil {
		c.failSync(err)
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := c.store.ReplaceADSnapshot(res.objects, res.edges); err != nil {
		c.failSync(err)
		return err
	}

	users, groups, computers, ous, err := c.store.ADCounts()
	if err != nil {
		c.failSync(err)
		return err
	}
	warnings := c.privilegedAccountWarnings(res)
	c.setStatus(func(s *Status) {
		s.Connected = true
		s.Truncated = truncated
		s.Objects = ObjectsCounts{Users: users, Groups: groups, Computers: computers, OUs: ous}
		s.Warnings = warnings
		if s.LastSuccessAt == nil {
			ts := now
			s.LastSuccessAt = &ts
		} else {
			ts := time.Now()
			s.LastSuccessAt = &ts
		}
	})
	c.log.Printf("[AD] snapshot installed: %d users, %d groups, %d computers, %d OUs%s",
		users, groups, computers, ous, truncatedSuffix(truncated))

	// Posture (AD-2) recomputes with every snapshot so the console
	// always reads a score consistent with the objects it serves.
	if err := c.computePosture(); err != nil {
		c.log.Printf("[AD] posture computation failed: %v", err)
	}
	return nil
}

func truncatedSuffix(truncated bool) string {
	if truncated {
		return " (TRUNCATED at max_objects: the snapshot is partial)"
	}
	return ""
}

// failSync records one failed attempt (status copy under the mutex;
// the error string is already credential-free by construction).
func (c *Connector) failSync(err error) {
	msg := err.Error()
	c.setStatus(func(s *Status) { s.Connected = false; s.LastError = msg })
}

// Posture returns the latest computed posture document (the one the
// last completed sync froze), or nil when no sync has completed.
func (c *Connector) Posture() (at time.Time, score int, p *Posture, err error) {
	ats, s, doc, ok, err := c.store.LatestADPosture()
	if err != nil || !ok {
		return time.Time{}, 0, nil, err
	}
	p, err = decodePosture(doc)
	if err != nil {
		return time.Time{}, 0, nil, err
	}
	return time.Unix(ats, 0), s, p, nil
}

// PostureHistory returns the latest scores (oldest first).
func (c *Connector) PostureHistory(limit int) ([]store.ADPosturePoint, error) {
	return c.store.ADPostureHistory(limit)
}

// Objects serves one page of the snapshot for the API.
func (c *Connector) Objects(kind, q string, limit, offset int) (*store.ADObjectsPage, error) {
	switch kind {
	case store.ADKindUser, store.ADKindGroup, store.ADKindComputer, store.ADKindOU:
	default:
		return nil, fmt.Errorf("unknown object kind %q", kind)
	}
	return c.store.QueryADObjects(kind, q, limit, offset)
}

// InactiveDays is the configured AD-2 stale-account threshold (the
// posture response serves it so the console can label the finding
// with the actual number instead of guessing).
func (c *Connector) InactiveDays() int { return c.cfg.InactiveDays }

// KrbtgtMaxAgeDays is the configured AD-2 krbtgt threshold.
func (c *Connector) KrbtgtMaxAgeDays() int { return c.cfg.KrbtgtMaxAgeDays }
