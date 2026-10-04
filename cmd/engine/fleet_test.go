package main

import (
	"strings"
	"testing"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/fleet"
)

func TestSilentSensorAlertNamesTheHostTheGapAndTheTechnique(t *testing.T) {
	last := time.Date(2026, 10, 4, 12, 0, 0, 0, time.UTC)
	h := fleet.Host{Host: "PC-RRHH", Peers: []string{"10.0.0.30"}, Sensor: &fleet.Sensor{Kind: "etw", LastHeartbeat: last}}
	a := silentSensorAlert(h, last.Add(4*time.Minute))
	if a.RuleID != silentSensorRuleID || a.Severity != "high" || a.Host != "PC-RRHH" || a.EventType != fleet.HeartbeatType {
		t.Fatalf("alert: %+v", a)
	}
	for _, want := range []string{"sensor etw", "PC-RRHH", "2026-10-04T12:00:00Z", "10.0.0.30", "4m0s"} {
		if !strings.Contains(a.Summary, want) {
			t.Fatalf("summary %q lacks %q", a.Summary, want)
		}
	}
	if strings.Join(a.Tags, ",") != "attack.defense-evasion,attack.t1562.001,fleet" {
		t.Fatalf("tags: %v", a.Tags)
	}
	if a.EventID == "" {
		t.Fatal("event id required")
	}
}
