package api

import "strings"

// maxRingHostEntries caps the ring-rotation tally by host: honesty
// about WHICH host is rotating out cannot itself become an unbounded
// map. Past the cap the totals keep counting every rotation; only the
// per-host attribution stops growing (threshold's convention).
const maxRingHostEntries = 64

// ringDropLocked counts one record rotated out of a view ring: the
// total always, and the per-host tally while it fits. Caller holds mu.
func (h *Hub) ringDropLocked(host string, isEvent bool) {
	host = strings.ToLower(host)
	if host == "" {
		return
	}
	if h.ringDrops.hosts == nil {
		h.ringDrops.hosts = map[string][2]uint64{}
	}
	if _, ok := h.ringDrops.hosts[host]; !ok && len(h.ringDrops.hosts) >= maxRingHostEntries {
		if isEvent {
			h.ringDrops.events++
		} else {
			h.ringDrops.alerts++
		}
		return
	}
	row := h.ringDrops.hosts[host]
	if isEvent {
		row[0]++
		h.ringDrops.events++
	} else {
		row[1]++
		h.ringDrops.alerts++
	}
	h.ringDrops.hosts[host] = row
}

// ringDropsCopy snapshots the rotation tally as a copy. Never call it
// while holding mu (it takes mu itself).
func (h *Hub) ringDropsCopy() (events, alerts uint64, hosts map[string][2]uint64) {
	h.mu.Lock()
	events, alerts = h.ringDrops.events, h.ringDrops.alerts
	hosts = make(map[string][2]uint64, len(h.ringDrops.hosts))
	for k, v := range h.ringDrops.hosts {
		hosts[k] = v
	}
	h.mu.Unlock()
	return events, alerts, hosts
}
