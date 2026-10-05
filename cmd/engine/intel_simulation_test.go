package main

import (
	"testing"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/alert"
	"github.com/Ruby570bocadito/bluetardigrade/internal/baseline"
	"github.com/Ruby570bocadito/bluetardigrade/internal/intel"
	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
)

// The simulation tag (SIM-1) reaches the engine-side emitters too:
// intel matches and baseline novelties raised from simulated events
// carry the tag, so a lab replay is never mixed with real evidence.
func TestIntelAndNoveltySimulationTag(t *testing.T) {
	sim := []string{alert.SimulationTag}

	intelEv := &model.Event{ID: "e1", Host: "LAB-SIM-T1", Type: "network.connect",
		Tags: sim, Process: &model.Process{Name: "rundll32.exe"},
		Network: &model.Network{DestinationIP: "203.0.113.7"}}
	a := intelAlert(intelEv, intel.Hit{List: "bloqueo", Kind: intel.KindIP,
		Value: "203.0.113.7", Field: "network.destination_ip"}, time.Now())
	if !simTaggedInt(a) {
		t.Errorf("simulated intel alert tags = %v, want the simulation tag", a.Tags)
	}
	real := intelAlert(&model.Event{ID: "e2", Host: "REAL-01", Type: "network.connect",
		Process: &model.Process{Name: "rundll32.exe"},
		Network: &model.Network{DestinationIP: "203.0.113.7"}},
		intel.Hit{List: "bloqueo", Kind: intel.KindIP, Value: "203.0.113.7",
			Field: "network.destination_ip"}, time.Now())
	if simTaggedInt(real) {
		t.Errorf("real intel alert must not carry the tag: %v", real.Tags)
	}

	novEv := &model.Event{ID: "e3", Host: "LAB-SIM-T2", Type: model.TypeProcessCreate,
		Tags: sim, Process: &model.Process{Name: "rclone.exe", Image: `C:\Users\Public\rclone.exe`}}
	n := noveltyAlert(novEv, &baseline.Novelty{Host: "LAB-SIM-T2", Kind: baseline.KindProcess,
		Value: "rclone.exe", LearnedOn: time.Now()}, time.Now())
	if !simTaggedInt(n) || n.Severity != "low" {
		t.Errorf("simulated novelty alert tags = %v severity = %s", n.Tags, n.Severity)
	}
}

func simTaggedInt(a alert.Alert) bool {
	for _, t := range a.Tags {
		if t == alert.SimulationTag {
			return true
		}
	}
	return false
}
