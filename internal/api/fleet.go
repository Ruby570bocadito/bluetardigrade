package api

// GET /api/fleet: the inventory of machines reporting to the engine
// (internal/fleet) with each sensor's last health report. Read-only:
// the engine never sends anything to the machines it lists.

import (
	"net/http"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/fleet"
)

// SetFleet points the hub at the engine's machine inventory.
func (h *Hub) SetFleet(t *fleet.Tracker) {
	h.mu.Lock()
	h.fleet = t
	h.mu.Unlock()
}

type fleetPayload struct {
	// Enabled is false when the engine runs without an inventory.
	Enabled bool         `json:"enabled"`
	Hosts   []fleet.Host `json:"hosts"`
	Online  int          `json:"online"`
	Silent  int          `json:"silent"`
	Idle    int          `json:"idle"`
	// GraceMinS is the shortest silence that marks a sensor silent
	// (sensors announcing a longer interval get 3x that interval).
	GraceMinS int `json:"heartbeat_grace_min_s"`
}

func (h *Hub) handleFleet(w http.ResponseWriter, _ *http.Request) {
	h.mu.Lock()
	t := h.fleet
	h.mu.Unlock()
	now := time.Now()
	out := fleetPayload{Hosts: []fleet.Host{}, GraceMinS: int(fleet.Grace(0) / time.Second)}
	if t != nil {
		out.Enabled = true
		// each host carries its groups (host_groups.go)
		set, _ := h.currentHostGroups()
		dnByHost := h.computerDNByHost(now)
		for _, host := range t.Snapshot(now) {
			host.Groups = set.Of(groupMember(host, dnByHost))
			out.Hosts = append(out.Hosts, host)
			switch host.Status {
			case fleet.StatusOnline:
				out.Online++
			case fleet.StatusSilent:
				out.Silent++
			default:
				out.Idle++
			}
		}
	}
	writeJSON(w, out)
}
