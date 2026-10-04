package main

import (
	"strings"
	"testing"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/baseline"
	"github.com/Ruby570bocadito/bluetardigrade/internal/intel"
	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
)

func TestIntelAlertNamesTheListAndIndicator(t *testing.T) {
	ev := &model.Event{ID: "e1", Host: "PC-01", Type: "network.connect", Source: "etw",
		Process: &model.Process{Name: "rundll32.exe"}, Network: &model.Network{DestinationIP: "203.0.113.7"}}
	a := intelAlert(ev, intel.Hit{List: "bloqueo", Kind: intel.KindIP, Value: "203.0.113.7", Field: "network.destination_ip"}, time.Now())
	if a.RuleID != "intel-match-bloqueo" || a.Severity != "high" || a.Network == nil {
		t.Fatalf("alert: %+v", a)
	}
	if !strings.Contains(a.Summary, "IP 203.0.113.7") || !strings.Contains(a.Summary, "«bloqueo»") || !strings.Contains(a.Summary, "rundll32.exe") {
		t.Fatalf("summary: %s", a.Summary)
	}
	if a.Tags[len(a.Tags)-1] != "intel" || a.Tags[0] != "attack.command-and-control" {
		t.Fatalf("tags: %v", a.Tags)
	}
	odd := intelAlert(ev, intel.Hit{List: "x", Kind: "otro", Value: "v", Field: "f"}, time.Now())
	if !strings.HasPrefix(odd.Summary, "Indicador v") {
		t.Fatalf("unknown kinds still render: %s", odd.Summary)
	}
}

func TestNoveltyAlertIsLowAndExplainsTheBaseline(t *testing.T) {
	learned := time.Date(2026, 10, 1, 8, 0, 0, 0, time.UTC)
	ev := &model.Event{ID: "e2", Host: "PC-CONTA", Type: model.TypeProcessCreate,
		Process: &model.Process{Name: "rclone.exe", Image: `C:\Users\Public\rclone.exe`}}
	a := noveltyAlert(ev, &baseline.Novelty{Host: "PC-CONTA", Kind: baseline.KindProcess, Value: "rclone.exe", LearnedOn: learned}, time.Now())
	if a.RuleID != noveltyRuleID || a.Severity != "low" || a.EventID != "e2" {
		t.Fatalf("alert: %+v", a)
	}
	if !strings.Contains(a.Summary, `C:\Users\Public\rclone.exe`) || !strings.Contains(a.Summary, "2026-10-01 08:00 UTC") {
		t.Fatalf("summary: %s", a.Summary)
	}
}
