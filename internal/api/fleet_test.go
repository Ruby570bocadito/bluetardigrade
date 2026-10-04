package api

import (
	"fmt"
	"testing"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/fleet"
	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
)

func TestFleetEndpointWithoutInventory(t *testing.T) {
	_, addr := newTestHub(t)
	var out fleetPayload
	getJSON(t, fmt.Sprintf("http://%s/api/fleet", addr), &out)
	if out.Enabled || len(out.Hosts) != 0 || out.GraceMinS != 180 {
		t.Fatalf("payload: %+v", out)
	}
}

func TestFleetEndpointListsHostsWithStatusCounts(t *testing.T) {
	h, addr := newTestHub(t)
	tr := fleet.New()
	now := time.Now()
	tr.Observe(&model.Event{Host: "PC-01", Type: "process.create", Source: "etw"}, "10.0.0.21", now)
	tr.Observe(&model.Event{Host: "PC-02", Type: fleet.HeartbeatType, Attributes: map[string]string{"sensor_kind": "etw", "interval_s": "60"}}, "10.0.0.22", now.Add(-10*time.Minute))
	h.SetFleet(tr)
	var out fleetPayload
	getJSON(t, fmt.Sprintf("http://%s/api/fleet", addr), &out)
	if !out.Enabled || len(out.Hosts) != 2 || out.Online != 1 || out.Silent != 1 || out.Idle != 0 {
		t.Fatalf("payload: %+v", out)
	}
	if out.Hosts[0].Host != "PC-02" || out.Hosts[0].Status != fleet.StatusSilent || out.Hosts[0].Sensor == nil {
		t.Fatalf("silent hosts come first with their sensor: %+v", out.Hosts[0])
	}
	if out.Hosts[1].Peers[0] != "10.0.0.21" {
		t.Fatalf("peers: %+v", out.Hosts[1])
	}
}
