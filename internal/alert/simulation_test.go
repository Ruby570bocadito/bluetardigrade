package alert

import (
	"io"
	"testing"

	"github.com/Ruby570bocadito/bluetardigrade/internal/rules"
	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
)

func TestEventIsSimulated(t *testing.T) {
	if EventIsSimulated(nil) {
		t.Error("nil event is not simulated")
	}
	if EventIsSimulated(&model.Event{}) {
		t.Error("empty event is not simulated")
	}
	if EventIsSimulated(&model.Event{Tags: []string{"ttp:offensive"}}) {
		t.Error("other tags do not simulate")
	}
	if !EventIsSimulated(&model.Event{Tags: []string{"ttp:offensive", SimulationTag}}) {
		t.Error("simulation tag must be detected")
	}
}

func TestMarkSimulatedDoesNotMutateSharedTags(t *testing.T) {
	// Rule Tags slices are shared, loaded-once catalog data: marking an
	// alert must never append into the shared backing array.
	shared := []string{"attack.t1003"}
	a := Alert{Tags: shared}
	MarkSimulated(&a)
	if len(shared) != 1 {
		t.Fatalf("shared slice mutated: %v", shared)
	}
	if len(a.Tags) != 2 || a.Tags[1] != SimulationTag {
		t.Errorf("tags = %v, want the simulation tag appended", a.Tags)
	}
	// idempotent
	MarkSimulated(&a)
	if len(a.Tags) != 2 {
		t.Errorf("tags after second mark = %v", a.Tags)
	}
}

func TestRaiseTagsSimulatedHit(t *testing.T) {
	hit := rules.Hit{Rule: &rules.Rule{
		ID: "r-sim", Name: "regla de prueba", Severity: rules.SevHigh,
		EventType: model.TypeProcessCreate, Tags: []string{"attack.t1003"},
	}}
	var raised []Alert
	m := New(io.Discard, func(a Alert) { raised = append(raised, a) })
	m.Raise(&model.Event{Type: model.TypeProcessCreate, Host: "LAB-SIM-T1",
		Process: &model.Process{PID: 10}, Tags: []string{SimulationTag}}, hit)
	m.Raise(&model.Event{Type: model.TypeProcessCreate, Host: "REAL-WKS",
		Process: &model.Process{PID: 11}}, hit)
	if len(raised) != 2 {
		t.Fatalf("raised %d alerts, want 2", len(raised))
	}
	if len(raised[0].Tags) != 2 || raised[0].Tags[1] != SimulationTag {
		t.Errorf("simulated alert tags = %v, want rule tags + simulation", raised[0].Tags)
	}
	if len(raised[1].Tags) != 1 {
		t.Errorf("real alert tags = %v, want the rule tags untouched", raised[1].Tags)
	}
}
