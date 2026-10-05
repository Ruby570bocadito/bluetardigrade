package main

import (
	"strings"
	"testing"

	"github.com/Ruby570bocadito/bluetardigrade/internal/scenario"
)

func TestLoopbackGuardsRejectRemoteTargets(t *testing.T) {
	if err := loopbackIngest("10.0.0.5:7777"); err == nil {
		t.Error("remote ingest address must be rejected")
	}
	if err := loopbackIngest("lab.internal:7777"); err == nil {
		t.Error("DNS ingest address must be rejected (loopback literal only)")
	}
	if err := loopbackIngest("127.0.0.1:0"); err == nil {
		t.Error("port 0 must be rejected")
	}
	if err := loopbackIngest("127.0.0.1:17777"); err != nil {
		t.Errorf("loopback ingest rejected: %v", err)
	}
	if err := loopbackAPI("http://10.0.0.5:17778"); err == nil {
		t.Error("remote API base must be rejected")
	}
	if err := loopbackAPI("http://localhost:17778"); err == nil {
		t.Error("DNS API base must be rejected (loopback literal only)")
	}
	if err := loopbackAPI("http://127.0.0.1:17778"); err != nil {
		t.Errorf("loopback API rejected: %v", err)
	}
}

func TestFilterScenarios(t *testing.T) {
	list := []*scenario.Scenario{
		{ID: "sim-a"}, {ID: "sim-b"}, {ID: "sim-c"},
	}
	all, err := filterScenarios(list, "")
	if err != nil || len(all) != 3 {
		t.Fatalf("empty filter must select everything: %v %v", len(all), err)
	}
	sel, err := filterScenarios(list, " sim-c ,sim-a")
	if err != nil || len(sel) != 2 || sel[0].ID != "sim-a" || sel[1].ID != "sim-c" {
		t.Fatalf("filter = %v (err %v), want sorted [sim-a sim-c]", sel, err)
	}
	if _, err := filterScenarios(list, "sim-z"); err == nil ||
		!strings.Contains(err.Error(), "ningun escenario") {
		t.Fatalf("unknown id must fail loud, got %v", err)
	}
}

func TestSatisfiedUsesEffectiveMinimums(t *testing.T) {
	sc := &scenario.Scenario{Expected: []scenario.Expected{
		{RuleID: "r1"},         // min default 1
		{RuleID: "r2", Min: 2}, // min 2
	}}
	if !satisfied(sc, map[string]int{"r1": 1, "r2": 2}) {
		t.Error("fired counts above minimums must satisfy")
	}
	if satisfied(sc, map[string]int{"r1": 1}) {
		t.Error("missing expectation must not satisfy")
	}
	if satisfied(sc, map[string]int{"r1": 1, "r2": 1}) {
		t.Error("count below an explicit minimum must not satisfy")
	}
}

func TestScenariosReplayRejectsNonLoopbackBeforeAnythingElse(t *testing.T) {
	// The lab-only guard must fire before any file or network access.
	o := replayOptions{dir: "/tmp/definitivamente-inexistente",
		ingest: "192.168.1.10:7777", api: "http://192.168.1.10:7778"}
	if err := runScenariosReplay(nil, o); err == nil {
		t.Fatal("non-loopback replay must fail")
	} else if !strings.Contains(err.Error(), "loopback") {
		t.Fatalf("error must name the loopback rule: %v", err)
	}
}
