// Package baseline learns what is normal on each host and reports what
// was never seen there before: after a learning period (24 h by default,
// counted from the host's first event), a process name that host never
// ran becomes a novelty. Rules catch known techniques; novelties catch
// the tool nobody wrote a rule for (an rclone.exe on the accounting PC).
//
// The state is bounded (hosts and values per host) and, with -store,
// persisted so the learning survives restarts. Novelties are rate-limited
// per host, so a software rollout produces a handful of alerts, not a
// storm.
package baseline

import (
	"path"
	"strings"
	"sync"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
)

// KindProcess is the only value kind learned today: process names.
const KindProcess = "process"

const (
	maxHosts        = 4096
	maxValues       = 4096 // per host and kind
	maxValueRunes   = 128
	noveltyBurst    = 10 // novelties per host...
	noveltyInterval = time.Hour
)

// Entry is one value seen on a host (persisted by internal/store).
type Entry struct {
	Host      string
	Kind      string
	Value     string
	FirstSeen time.Time
}

// Novelty is a value a host had never shown after its learning period.
type Novelty struct {
	Host      string
	Kind      string
	Value     string
	LearnedOn time.Time // when the host's learning started
}

type hostState struct {
	firstSeen time.Time
	values    map[string]struct{} // kind + "\x00" + value
	recent    []time.Time         // novelty times inside noveltyInterval
}

// Tracker is safe for concurrent use.
type Tracker struct {
	mu      sync.Mutex
	learn   time.Duration
	hosts   map[string]*hostState
	pending []Entry
}

// New returns an empty baseline with the given learning period.
func New(learn time.Duration) *Tracker {
	return &Tracker{learn: learn, hosts: map[string]*hostState{}}
}

// Learning returns the learning period.
func (t *Tracker) Learning() time.Duration { return t.learn }

// Restore loads persisted entries and host start times.
func (t *Tracker) Restore(entries []Entry, hosts map[string]time.Time) {
	t.mu.Lock()
	defer t.mu.Unlock()
	for host, first := range hosts {
		if len(t.hosts) >= maxHosts {
			break
		}
		t.hosts[strings.ToLower(host)] = &hostState{firstSeen: first, values: map[string]struct{}{}}
	}
	for _, e := range entries {
		h := t.hosts[strings.ToLower(e.Host)]
		if h == nil || len(h.values) >= maxValues {
			continue
		}
		h.values[e.Kind+"\x00"+e.Value] = struct{}{}
	}
}

// Observe learns from one event and returns a novelty when the event
// shows, after the host's learning period, a value never seen there.
func (t *Tracker) Observe(ev *model.Event, now time.Time) *Novelty {
	kind, value := keyOf(ev)
	if kind == "" {
		return nil
	}
	host := strings.ToLower(strings.TrimSpace(ev.Host))
	if host == "" {
		return nil
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	h := t.hosts[host]
	if h == nil {
		if len(t.hosts) >= maxHosts {
			return nil
		}
		h = &hostState{firstSeen: now, values: map[string]struct{}{}}
		t.hosts[host] = h
	}
	k := kind + "\x00" + value
	if _, seen := h.values[k]; seen {
		return nil
	}
	if len(h.values) >= maxValues {
		return nil // full: stop learning rather than evict history
	}
	h.values[k] = struct{}{}
	t.pending = append(t.pending, Entry{Host: host, Kind: kind, Value: value, FirstSeen: now})
	if t.learn <= 0 || now.Sub(h.firstSeen) < t.learn {
		return nil // still learning
	}
	// rate limit per host
	cut := now.Add(-noveltyInterval)
	kept := h.recent[:0]
	for _, at := range h.recent {
		if at.After(cut) {
			kept = append(kept, at)
		}
	}
	h.recent = kept
	if len(h.recent) >= noveltyBurst {
		return nil
	}
	h.recent = append(h.recent, now)
	return &Novelty{Host: ev.Host, Kind: kind, Value: value, LearnedOn: h.firstSeen}
}

// TakePending returns (and forgets) the entries learned since the last
// call, for persistence.
func (t *Tracker) TakePending() []Entry {
	t.mu.Lock()
	defer t.mu.Unlock()
	out := t.pending
	t.pending = nil
	return out
}

// Stats reports hosts tracked and how many are still learning at now.
func (t *Tracker) Stats(now time.Time) (hosts, learning int) {
	t.mu.Lock()
	defer t.mu.Unlock()
	for _, h := range t.hosts {
		if t.learn > 0 && now.Sub(h.firstSeen) < t.learn {
			learning++
		}
	}
	return len(t.hosts), learning
}

// keyOf extracts the learned value of an event: the lowercase process
// basename of a process start.
func keyOf(ev *model.Event) (string, string) {
	if ev == nil || ev.Type != model.TypeProcessCreate || ev.Process == nil {
		return "", ""
	}
	name := strings.ToLower(strings.TrimSpace(ev.Process.Name))
	name = path.Base(strings.ReplaceAll(name, `\`, "/"))
	if name == "" || name == "." || name == "/" {
		return "", ""
	}
	if r := []rune(name); len(r) > maxValueRunes {
		name = string(r[:maxValueRunes])
	}
	return KindProcess, name
}
