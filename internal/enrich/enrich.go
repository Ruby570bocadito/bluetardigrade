// Package enrich adds context to events after ingestion and before
// rule evaluation. Steps are idempotent and never mutate the raw
// evidence fields coming from the sensor.
package enrich

import (
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
)

// Parent-tracking limits: a flight recorder of (host, pid) -> process
// identity used to resolve parent names. Caps bound the worst case on
// an endpoint farm: 256 hosts x 2048 processes x ~64 bytes of map
// entry stays under ~35 MB even with pathological churn, and the
// sweep drops idle entries so a long-lived engine does not leak.
const (
	maxHosts        = 256
	maxProcsPerHost = 2048
	procTTL         = 30 * time.Minute
)

// procEntry is one remembered process identity.
type procEntry struct {
	name     string
	image    string
	lastSeen time.Time
}

// Enricher applies the enrichment pipeline. It is safe for concurrent
// use: Apply runs on the ingest path (single event loop today) but
// tests and future fan-out rely on the mutex.
type Enricher struct {
	startedAt time.Time

	mu    sync.Mutex
	hosts map[string]map[int64]procEntry // host -> pid -> identity
}

// New returns an Enricher ready to use.
func New() *Enricher {
	return &Enricher{
		startedAt: time.Now().UTC(),
		hosts:     make(map[string]map[int64]procEntry),
	}
}

// Apply annotates the event in place. The raw evidence fields from the
// sensor are never mutated: enrichment lives in ev.Enrichment only.
//
// Steps: seen_at / engine_uptime stamps, user split, image directory
// classification (system vs userland), parent resolution and process
// registration. Parent resolution answers "which process name spawned
// me" for rule conditions (enrichment.parent_name) and for SOC
// context, using the pid->identity map filled by earlier
// process.create events on the same host.
func (en *Enricher) Apply(ev *model.Event) {
	if ev.Enrichment == nil {
		ev.Enrichment = make(map[string]string, 6)
	}
	ev.Enrichment["seen_at"] = time.Now().UTC().Format(time.RFC3339Nano)
	ev.Enrichment["engine_uptime"] = time.Since(en.startedAt).Round(time.Second).String()

	if ev.User != "" {
		domain, user, ok := strings.Cut(ev.User, `\`)
		if ok {
			ev.Enrichment["user_domain"] = domain
			ev.Enrichment["user_name"] = user
		}
	}

	if ev.Process != nil && ev.Process.Image != "" {
		dir := imageDir(ev.Process.Image)
		ev.Enrichment["image_dir"] = dir
		if isSystemPath(dir) {
			ev.Enrichment["image_origin"] = "system"
		} else {
			ev.Enrichment["image_origin"] = "userland"
		}
	}

	if ev.Process != nil {
		en.trackProcess(ev)
	}
}

// trackProcess resolves the event's parent (PPID -> identity recorded
// from an earlier process.create on the same host) and registers the
// event's own process identity for future children. A process
// termination evicts the entry immediately: pid reuse on Windows is
// aggressive and a stale name would misattribute the next parent.
func (en *Enricher) trackProcess(ev *model.Event) {
	p := ev.Process
	if p.PID == 0 {
		return
	}
	host := ev.Host
	now := time.Now()

	en.mu.Lock()
	defer en.mu.Unlock()

	switch ev.Type {
	case model.TypeProcessTerminate:
		if m := en.hosts[host]; m != nil {
			delete(m, int64(p.PID))
		}
		return
	case model.TypeProcessCreate:
		if p.PPID != 0 {
			if parent, ok := en.hosts[host][int64(p.PPID)]; ok {
				ev.Enrichment["parent_name"] = parent.name
				if parent.image != "" {
					ev.Enrichment["parent_image"] = parent.image
				}
			}
		}
	default:
		// non-create events still resolve their parent when the
		// process is already known (file.write, network.connect and
		// registry.set all carry the acting process): the sensor may
		// have shipped the create event in the same batch.
		if p.PPID != 0 {
			if parent, ok := en.hosts[host][int64(p.PPID)]; ok {
				ev.Enrichment["parent_name"] = parent.name
				if parent.image != "" {
					ev.Enrichment["parent_image"] = parent.image
				}
			}
		}
	}

	m := en.hosts[host]
	if m == nil {
		if len(en.hosts) >= maxHosts {
			en.evictOldestHost(now)
		}
		m = make(map[int64]procEntry)
		en.hosts[host] = m
	}
	m[int64(p.PID)] = procEntry{name: p.Name, image: p.Image, lastSeen: now}
	if len(m) > maxProcsPerHost {
		en.trimHost(m, now)
	}
}

// evictOldestHost removes the host whose most recent activity is the
// oldest — an endpoint that stopped reporting should not displace a
// live farm. Called with the lock held.
func (en *Enricher) evictOldestHost(now time.Time) {
	oldest := ""
	var oldestSeen time.Time
	for h, m := range en.hosts {
		latest := en.latestActivity(m)
		if oldest == "" || latest.Before(oldestSeen) {
			oldest, oldestSeen = h, latest
		}
	}
	if oldest != "" {
		delete(en.hosts, oldest)
	}
}

// latestActivity walks one host's map for its newest entry. Called
// with the lock held; maxProcsPerHost bounds the walk.
func (en *Enricher) latestActivity(m map[int64]procEntry) time.Time {
	var latest time.Time
	for _, e := range m {
		if e.lastSeen.After(latest) {
			latest = e.lastSeen
		}
	}
	return latest
}

// trimHost enforces the per-host cap by dropping the idle half of the
// map. A full map means pid churn (crash loops, script storms); the
// idling entries are the stale ones, so eviction by lastSeen is both
// bounded (one pass) and correct (recent parents survive).
func (en *Enricher) trimHost(m map[int64]procEntry, now time.Time) {
	type aged struct {
		pid int64
		at  time.Time
	}
	entries := make([]aged, 0, len(m))
	for pid, e := range m {
		entries = append(entries, aged{pid, e.lastSeen})
	}
	// selection by recency: drop the oldest half up to the cap
	target := len(m) - maxProcsPerHost/2
	if target <= 0 {
		return
	}
	// simple insertion sort on time (target <= 1024, entries <= 2049)
	for i := 1; i < len(entries); i++ {
		for j := i; j > 0 && entries[j].at.Before(entries[j-1].at); j-- {
			entries[j], entries[j-1] = entries[j-1], entries[j]
		}
	}
	for i := 0; i < target && i < len(entries); i++ {
		delete(m, entries[i].pid)
	}
}

// Sweep drops process entries idle beyond procTTL. The engine calls
// it from a low-frequency ticker; it is exported so tests can drive
// aging without sleeping.
func (en *Enricher) Sweep(now time.Time) {
	en.mu.Lock()
	defer en.mu.Unlock()
	for h, m := range en.hosts {
		for pid, e := range m {
			if now.Sub(e.lastSeen) > procTTL {
				delete(m, pid)
			}
		}
		if len(m) == 0 {
			delete(en.hosts, h)
		}
	}
}

// Tracked reports the number of remembered processes (all hosts). It
// exists for tests and for a future /api/stats gauge.
func (en *Enricher) Tracked() int {
	en.mu.Lock()
	defer en.mu.Unlock()
	n := 0
	for _, m := range en.hosts {
		n += len(m)
	}
	return n
}

// imageDir splits the executable's directory from an image path on any
// host OS: sensors report Windows paths and the engine also runs on
// Linux, where filepath.Dir alone answers "." for every C:\... image
// and reclassifies system binaries as userland. The backslash branch
// reproduces filepath.Dir's Windows semantics byte-identically (no
// behavior change on a Windows host); the forward-slash branch stays
// with the standard library (including the /system32/ form
// isSystemPath knows).
func imageDir(image string) string {
	if strings.ContainsRune(image, '\\') {
		if i := strings.LastIndexByte(image, '\\'); i >= 0 {
			return image[:i]
		}
		return image // a lone backslash leaves no directory part
	}
	return filepath.Dir(image)
}

// isSystemPath reports whether an image directory is OS-owned: the
// Windows system root (c:\windows, case-insensitive) or the Unix-form
// /system32/ prefix.
func isSystemPath(dir string) bool {
	d := strings.ToLower(dir)
	return strings.HasPrefix(d, `c:\windows`) || strings.HasPrefix(d, `/system32/`)
}
