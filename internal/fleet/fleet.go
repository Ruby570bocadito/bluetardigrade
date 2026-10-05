// Package fleet keeps the inventory of the machines reporting to the
// engine: one record per host with when it was first and last seen, the
// telemetry sources and sensor connections behind it, the ingest
// identity it authenticated as, and the health its sensor reports in a
// periodic heartbeat (sensor.heartbeat events, consumed here and never
// fed to rules, rings or storage).
//
// A host whose sensor sent heartbeats and then stops is "silent": the
// sensor was stopped, the machine went offline or someone disabled the
// telemetry on purpose. Check reports each silence once, so the engine
// can raise one alert per outage. Hosts without heartbeats (legacy
// sensors, offline log imports) are tracked but never declared silent:
// the engine cannot tell a quiet machine from a stopped feed without
// the sensor's own promise to report.
//
// State is in memory and covers what the engine saw since it started.
package fleet

import (
	"encoding/json"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
)

// HeartbeatType is the event type sensors use for their health report.
const HeartbeatType = "sensor.heartbeat"

// IdentityAttribute is the event attribute the ingest stamps with the
// identity that delivered it (internal/ingest.IdentityAttribute).
const IdentityAttribute = "ingest_identity"

const (
	// DefaultMaxHosts bounds the inventory; past it the host seen
	// longest ago is forgotten.
	DefaultMaxHosts = 4096
	// minGrace is the shortest silence that counts, whatever interval
	// a sensor announces (a sensor claiming 1 s cannot cause alert
	// storms on a busy network).
	minGrace = 3 * time.Minute
	// activeWindow: a host without heartbeats is "online" while it has
	// sent anything this recently, "idle" afterwards.
	activeWindow = 10 * time.Minute
	// retireAfter: silent or idle hosts are dropped from the inventory
	// after this long (decommissioned machines do not linger forever).
	retireAfter = 7 * 24 * time.Hour
	maxSources  = 8
	maxPeers    = 4
	maxField    = 128
)

// Status of a host in the inventory.
const (
	StatusOnline = "online"
	StatusSilent = "silent"
	StatusIdle   = "idle"
)

// Sensor is the last health report of the sensor on a host.
type Sensor struct {
	Kind          string    `json:"kind,omitempty"`
	Version       string    `json:"version,omitempty"`
	OS            string    `json:"os,omitempty"`
	Capture       string    `json:"capture,omitempty"`
	IntervalS     int       `json:"interval_s"`
	UptimeS       int64     `json:"uptime_s"`
	QueueCap      int64     `json:"queue_cap,omitempty"`
	Spooled       uint64    `json:"spooled"`
	Dropped       uint64    `json:"dropped"`
	LastHeartbeat time.Time `json:"last_heartbeat"`
	// RunMode is how the sensor runs: "service" (Windows service manager,
	// starts with the machine) or "console" (started by hand); empty for
	// sensors that do not say.
	RunMode string `json:"run_mode,omitempty"`
}

// Host is one machine of the inventory.
type Host struct {
	Host          string     `json:"host"`
	Status        string     `json:"status"`
	FirstSeen     time.Time  `json:"first_seen"`
	LastSeen      time.Time  `json:"last_seen"`
	LastEventType string     `json:"last_event_type,omitempty"`
	Events        uint64     `json:"events"`
	EventsLast5m  int        `json:"events_last_5m"`
	Sources       []string   `json:"sources"`
	Peers         []string   `json:"peers"`
	Identity      string     `json:"identity,omitempty"`
	Sensor        *Sensor    `json:"sensor,omitempty"`
	SilentSince   *time.Time `json:"silent_since,omitempty"`
}

type record struct {
	Host
	minutes  [5]int   // events per minute, ring indexed by minute
	minuteAt [5]int64 // unix minute each slot belongs to
	alerted  bool     // the current silence was already reported
	// graceFrom: restored hosts get a full grace from the engine start,
	// so sensors reconnecting after an engine restart are not "silent"
	graceFrom time.Time
	dirty     bool // changed since the last Export
}

// Tracker is safe for concurrent use.
type Tracker struct {
	mu       sync.Mutex
	hosts    map[string]*record // key: lowercase host
	maxHosts int
	retired  []string // keys dropped since the last TakeRetired
}

// New returns an empty inventory.
func New() *Tracker {
	return &Tracker{hosts: map[string]*record{}, maxHosts: DefaultMaxHosts}
}

// Observe records one accepted event delivered over a connection from
// peer (the sensor's address). Heartbeats update the sensor health.
func (t *Tracker) Observe(ev *model.Event, peer string, now time.Time) {
	if ev == nil || strings.TrimSpace(ev.Host) == "" {
		return
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	key := strings.ToLower(ev.Host)
	r := t.hosts[key]
	if r == nil {
		if len(t.hosts) >= t.maxHosts {
			t.evictOldest()
		}
		r = &record{Host: Host{Host: clip(ev.Host), FirstSeen: now}}
		t.hosts[key] = r
	}
	r.LastSeen = now
	r.SilentSince = nil
	r.alerted = false
	r.dirty = true
	if id := ev.Attributes[IdentityAttribute]; id != "" {
		r.Identity = clip(id)
	}
	if peer != "" {
		r.Peers = addCapped(r.Peers, peer, maxPeers)
	}
	if ev.Type == HeartbeatType {
		r.Sensor = sensorFrom(ev.Attributes, now)
		if r.Sensor.Kind != "" {
			r.Sources = addCapped(r.Sources, clip(r.Sensor.Kind), maxSources)
		}
		return
	}
	r.Events++
	r.LastEventType = clip(ev.Type)
	if ev.Source != "" {
		r.Sources = addCapped(r.Sources, clip(ev.Source), maxSources)
	}
	minute := now.Unix() / 60
	slot := int(minute % 5)
	if r.minuteAt[slot] != minute {
		r.minuteAt[slot] = minute
		r.minutes[slot] = 0
	}
	r.minutes[slot]++
}

// Transition is a host that went silent or came back since the last Check.
type Transition struct {
	Host Host
	// Silent is true when the host just went silent, false when a
	// previously reported silence ended.
	Silent bool
}

// Check updates every host's status at now and returns the silences
// not reported yet (one per outage). Long-gone hosts are retired.
func (t *Tracker) Check(now time.Time) []Transition {
	t.mu.Lock()
	defer t.mu.Unlock()
	var out []Transition
	for key, r := range t.hosts {
		status := statusOf(r, now)
		if (status == StatusSilent || status == StatusIdle) && now.Sub(r.LastSeen) > retireAfter {
			delete(t.hosts, key)
			t.retired = append(t.retired, key)
			continue
		}
		if status == StatusSilent {
			if r.SilentSince == nil {
				since := r.Sensor.LastHeartbeat
				r.SilentSince = &since
			}
			if !r.alerted {
				r.alerted = true
				r.dirty = true
				out = append(out, Transition{Host: snapshot(r, now), Silent: true})
			}
		}
		r.Status = status
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Host.Host < out[j].Host.Host })
	return out
}

// Snapshot returns the inventory at now, silent hosts first, then by name.
func (t *Tracker) Snapshot(now time.Time) []Host {
	t.mu.Lock()
	defer t.mu.Unlock()
	out := make([]Host, 0, len(t.hosts))
	for _, r := range t.hosts {
		out = append(out, snapshot(r, now))
	}
	rank := map[string]int{StatusSilent: 0, StatusOnline: 1, StatusIdle: 2}
	sort.Slice(out, func(i, j int) bool {
		if rank[out[i].Status] != rank[out[j].Status] {
			return rank[out[i].Status] < rank[out[j].Status]
		}
		return strings.ToLower(out[i].Host) < strings.ToLower(out[j].Host)
	})
	return out
}

// Grace is how long a sensor with the given heartbeat interval may stay
// quiet before it counts as silent.
func Grace(intervalS int) time.Duration {
	g := 3 * time.Duration(intervalS) * time.Second
	if g < minGrace {
		return minGrace
	}
	return g
}

func statusOf(r *record, now time.Time) string {
	if r.Sensor != nil {
		last := r.Sensor.LastHeartbeat
		if r.graceFrom.After(last) {
			last = r.graceFrom
		}
		if now.Sub(last) > Grace(r.Sensor.IntervalS) {
			return StatusSilent
		}
		return StatusOnline
	}
	// hosts without heartbeats never alert, so a restart needs no grace
	// for them: their status is what their own data says
	if now.Sub(r.LastSeen) <= activeWindow {
		return StatusOnline
	}
	return StatusIdle
}

// stored is the persisted form of a record (internal/store fleet_hosts).
type stored struct {
	Host    Host `json:"host"`
	Alerted bool `json:"alerted"`
}

// Export returns the JSON documents of the hosts changed since the last
// Export (all of them when all is true), keyed by lowercase host.
func (t *Tracker) Export(all bool, now time.Time) map[string][]byte {
	t.mu.Lock()
	defer t.mu.Unlock()
	out := map[string][]byte{}
	for key, r := range t.hosts {
		if !all && !r.dirty {
			continue
		}
		doc, err := json.Marshal(stored{Host: snapshot(r, now), Alerted: r.alerted})
		if err != nil {
			continue
		}
		out[key] = doc
		r.dirty = false
	}
	return out
}

// Resume gives every sensor not already reported silent a full grace
// from now. The engine calls it after it was itself suspended (a laptop
// closed with engine and sensor on it): it could not receive heartbeats
// either, so the gap is not the sensors' silence.
func (t *Tracker) Resume(now time.Time) {
	t.mu.Lock()
	defer t.mu.Unlock()
	for _, r := range t.hosts {
		if r.Sensor != nil && !r.alerted {
			r.graceFrom = now
		}
	}
}

// TakeRetired returns (and forgets) the hosts retired since the last call.
func (t *Tracker) TakeRetired() []string {
	t.mu.Lock()
	defer t.mu.Unlock()
	out := t.retired
	t.retired = nil
	return out
}

// Restore loads persisted hosts at engine start. A sensor that was
// healthy when the engine stopped gets a full grace from now before it
// can be declared silent (the engine's own downtime is not its
// silence); one already reported silent stays silent, without a second
// alert, until it sends a heartbeat again.
func (t *Tracker) Restore(docs map[string][]byte, now time.Time) int {
	t.mu.Lock()
	defer t.mu.Unlock()
	n := 0
	for key, doc := range docs {
		var st stored
		if err := json.Unmarshal(doc, &st); err != nil || strings.TrimSpace(st.Host.Host) == "" {
			continue
		}
		if len(t.hosts) >= t.maxHosts {
			break
		}
		h := st.Host
		h.Host = clip(h.Host)
		h.EventsLast5m = 0
		r := &record{Host: h, alerted: st.Alerted}
		if !st.Alerted {
			r.graceFrom = now
		}
		t.hosts[strings.ToLower(key)] = r
		n++
	}
	return n
}

func snapshot(r *record, now time.Time) Host {
	h := r.Host
	h.Status = statusOf(r, now)
	h.Sources = append([]string{}, r.Sources...)
	h.Peers = append([]string{}, r.Peers...)
	if r.Sensor != nil {
		s := *r.Sensor
		h.Sensor = &s
	}
	if h.Status == StatusSilent && h.SilentSince == nil && r.Sensor != nil {
		since := r.Sensor.LastHeartbeat
		h.SilentSince = &since
	}
	if h.Status != StatusSilent {
		h.SilentSince = nil
	}
	minute := now.Unix() / 60
	for i, at := range r.minuteAt {
		if at > minute-5 && at <= minute {
			h.EventsLast5m += r.minutes[i]
		}
	}
	return h
}

func (t *Tracker) evictOldest() {
	var oldestKey string
	var oldest time.Time
	for key, r := range t.hosts {
		if oldestKey == "" || r.LastSeen.Before(oldest) {
			oldestKey, oldest = key, r.LastSeen
		}
	}
	delete(t.hosts, oldestKey)
}

func sensorFrom(attrs map[string]string, now time.Time) *Sensor {
	s := &Sensor{
		Kind:          clip(attrs["sensor_kind"]),
		Version:       clip(attrs["sensor_version"]),
		OS:            clip(attrs["os"]),
		Capture:       clip(attrs["capture"]),
		IntervalS:     int(parseInt(attrs["interval_s"], 60)),
		UptimeS:       parseInt(attrs["uptime_s"], 0),
		QueueCap:      parseInt(attrs["queue_cap"], 0),
		Spooled:       uint64(parseInt(attrs["spooled"], 0)),
		Dropped:       uint64(parseInt(attrs["dropped"], 0)),
		LastHeartbeat: now,
	}
	if mode := attrs["run_mode"]; mode == "service" || mode == "console" {
		s.RunMode = mode
	}
	if s.IntervalS <= 0 || s.IntervalS > 3600 {
		s.IntervalS = 60
	}
	return s
}

func parseInt(s string, def int64) int64 {
	v, err := strconv.ParseInt(strings.TrimSpace(s), 10, 64)
	if err != nil || v < 0 {
		return def
	}
	return v
}

func addCapped(list []string, v string, max int) []string {
	for _, x := range list {
		if strings.EqualFold(x, v) {
			return list
		}
	}
	if len(list) >= max {
		list = list[1:]
	}
	return append(list, v)
}

func clip(s string) string {
	s = strings.TrimSpace(s)
	if len(s) <= maxField {
		return s
	}
	// cut on a rune boundary
	cut := maxField
	for cut > 0 && !utf8Start(s[cut]) {
		cut--
	}
	return s[:cut]
}

func utf8Start(b byte) bool { return b&0xC0 != 0x80 }
