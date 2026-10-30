package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/alert"
	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
)

// RecordEvent stores an event in the ring, persists it (store attached)
// and streams it to subscribers. The store write happens BEFORE the
// fan-out: durable evidence first, live delivery second. The engine
// loop uses the split form (PersistEvents per batch, then PublishEvent
// per event) to amortize the SQLite commit.
func (h *Hub) RecordEvent(ev *model.Event) {
	if ev == nil {
		return
	}
	h.persistEvent(ev)
	h.PublishEvent(ev)
}

// PublishEvent adds an already-persisted event to the ring and streams
// it to subscribers.
func (h *Hub) PublishEvent(ev *model.Event) {
	if ev == nil {
		return
	}
	h.mu.Lock()
	h.events = append(h.events, ev)
	if n := len(h.events) - maxEvents; n > 0 {
		// v1.1 cuotas por equipo: rotation out of the view ring is
		// counted per host — a noisy host filling the ring washes the
		// others' recent records out, and that loss stays visible.
		for i := 0; i < n; i++ {
			h.ringDropLocked(h.events[i].Host, true)
		}
		h.events = h.events[n:]
	}
	h.mu.Unlock()
	h.broadcast("event", ev, ev.Host)
}

// RecordAlert stores an alert in the ring, persists it (store attached)
// and streams it to subscribers. Alerts reaching the ring without an id
// (hand-built by tests or future producers) get one here: every alert
// the API serves must carry the lifecycle key, or
// POST /api/alerts/{id}/status could not reference it.
func (h *Hub) RecordAlert(a alert.Alert) {
	if a.ID == "" {
		a.ID = alert.NewID()
	}
	now := time.Now()
	h.mu.Lock()
	at := h.alertTimeLocked(a, now)
	h.alerts = append(h.alerts, a)
	h.alertsTotal++
	h.bySeverity[a.Severity]++
	if n := len(h.alerts) - maxAlerts; n > 0 {
		// v1.1 cuotas por equipo: same per-host rotation tally as the
		// events ring (see PublishEvent).
		for i := 0; i < n; i++ {
			h.ringDropLocked(h.alerts[i].Host, false)
		}
		h.alerts = h.alerts[n:]
	}
	h.mu.Unlock()
	// The tracker owns its mutex — like every other manager's lock,
	// it is only ever taken after h.mu.Unlock (uniform lock rule).
	h.risk.Observe(a.Host, a.Severity, at)
	h.persistAlert(a)
	h.broadcast("alert", a, a.Host)
}

// alertEventScan bounds how far back RecordAlert looks for the event
// that raised an alert: the engine publishes each event right before
// evaluating it, so the trigger is the newest entry or very close.
const alertEventScan = 64

// alertTimeLocked is the instant the risk score charges an alert to:
// the triggering event's detection time (model.Event.DetectionTime,
// the rule the correlator, beaconing and thresholds already follow),
// never later than now. Without it a sensor replaying the backlog it
// queued while the engine was down turned hours of activity into one
// burst of fresh points on the host. Alerts with no event in the
// recent ring (sensor-silence, synthetic) keep the wall clock.
// Caller holds h.mu.
func (h *Hub) alertTimeLocked(a alert.Alert, now time.Time) time.Time {
	if a.EventID == "" {
		return now
	}
	for i, n := len(h.events)-1, 0; i >= 0 && n < alertEventScan; i, n = i-1, n+1 {
		if ev := h.events[i]; ev.ID == a.EventID {
			if t := ev.DetectionTime(now); t.Before(now) {
				return t
			}
			return now
		}
	}
	return now
}

// frame is one SSE message and the machines it is about: a subscriber
// limited to host groups (scope.go) gets it only when all of them are
// in its groups, so a frame about no machine reaches unrestricted
// subscribers only.
type frame struct {
	msg   []byte
	hosts []string
}

// broadcast marshals once and ships to every subscriber; slow clients
// with a full buffer miss messages instead of blocking the engine.
// hosts are the machines the payload is about.
func (h *Hub) broadcast(topic string, payload any, hosts ...string) {
	// No console subscribed: skip the marshal. It runs for every
	// ingested event, and with nobody listening it was pure waste on
	// the hot path. A client subscribing right after the check only
	// misses this frame, as it would by subscribing a moment later.
	h.mu.Lock()
	idle := len(h.subs) == 0
	h.mu.Unlock()
	if idle {
		return
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return
	}
	f := frame{msg: []byte(fmt.Sprintf("event: %s\ndata: %s\n\n", topic, data)), hosts: hosts}
	h.mu.Lock()
	defer h.mu.Unlock()
	for ch := range h.subs {
		select {
		case ch <- f:
		default: // subscriber too slow: drop the frame
		}
	}
}

// handleStream keeps an SSE connection open pushing live events/alerts.
func (h *Hub) handleStream(w http.ResponseWriter, r *http.Request) {
	fl, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}
	// a scoped subscriber (scope.go) re-reads its scope now and then:
	// groups edited in Ajustes and the AD computers apply without a
	// reconnect
	sc := scopeFrom(r)
	ch := make(chan frame, sseBuffer)
	h.mu.Lock()
	// subscriber cap: every SSE client pins a channel and a goroutine
	// for as long as it stays connected, so an unbounded stream route
	// is a slow-motion resource flood on the same listener that serves
	// the operator console. Over the cap the client gets a 503 with a
	// retry-after hint instead of a silently stalled stream.
	if len(h.subs) >= maxSSEClients {
		h.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Retry-After", "5")
		w.WriteHeader(http.StatusServiceUnavailable)
		fmt.Fprintln(w, `{"error":"stream subscriber limit reached; retry shortly"}`)
		return
	}
	h.subs[ch] = struct{}{}
	h.mu.Unlock()
	defer func() {
		h.mu.Lock()
		if _, ok := h.subs[ch]; ok {
			delete(h.subs, ch)
			close(ch)
		}
		h.mu.Unlock()
	}()

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	fmt.Fprint(w, "retry: 2000\n\n")
	fl.Flush()

	hb := time.NewTicker(heartbeatEvery)
	defer hb.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-hb.C:
			if _, err := fmt.Fprint(w, ": hb\n\n"); err != nil {
				return
			}
			fl.Flush()
		case f, ok := <-ch:
			if !ok {
				return
			}
			if sc != nil {
				if now := time.Now(); now.Sub(sc.built) >= scopeRefresh {
					sc = h.newScope(sc.names, now)
				}
				if !sc.allowsAll(f.hosts) {
					continue
				}
			}
			if _, err := w.Write(f.msg); err != nil {
				return
			}
			fl.Flush()
		}
	}
}
