package fleet

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
)

var t0 = time.Date(2026, 10, 4, 12, 0, 0, 0, time.UTC)

func ev(host, typ, source string) *model.Event {
	return &model.Event{Host: host, Type: typ, Source: source}
}

func heartbeat(host string, interval int) *model.Event {
	return &model.Event{Host: host, Type: HeartbeatType, Source: "etw", Attributes: map[string]string{
		"sensor_kind": "etw", "sensor_version": "0.3.0", "os": "Windows 11 Pro 24H2 (26100)",
		"capture": "process+network+registry", "interval_s": fmt.Sprint(interval),
		"uptime_s": "3600", "queue_cap": "50000", "spooled": "12", "dropped": "0",
	}}
}

func find(t *testing.T, hosts []Host, name string) Host {
	t.Helper()
	for _, h := range hosts {
		if h.Host == name {
			return h
		}
	}
	t.Fatalf("host %s not in inventory: %+v", name, hosts)
	return Host{}
}

func TestInventoryRecordsSourcesPeersIdentityAndRate(t *testing.T) {
	tr := New()
	e := ev("PC-CONTA-01", "process.create", "etw")
	e.Attributes = map[string]string{IdentityAttribute: "contabilidad"}
	tr.Observe(e, "10.0.0.21", t0)
	tr.Observe(ev("pc-conta-01", "network.connect", "etw"), "10.0.0.21", t0.Add(30*time.Second))
	tr.Observe(ev("PC-CONTA-01", "registry.set", "sysmon"), "10.0.0.22", t0.Add(70*time.Second))
	h := find(t, tr.Snapshot(t0.Add(2*time.Minute)), "PC-CONTA-01")
	if h.Events != 3 || h.EventsLast5m != 3 || h.LastEventType != "registry.set" {
		t.Fatalf("counters: %+v", h)
	}
	if strings.Join(h.Sources, ",") != "etw,sysmon" || strings.Join(h.Peers, ",") != "10.0.0.21,10.0.0.22" {
		t.Fatalf("sources/peers: %v %v", h.Sources, h.Peers)
	}
	if h.Identity != "contabilidad" || h.Status != StatusOnline || h.Sensor != nil {
		t.Fatalf("identity/status: %+v", h)
	}
	if got := find(t, tr.Snapshot(t0.Add(7*time.Minute)), "PC-CONTA-01").EventsLast5m; got != 0 {
		t.Fatalf("the 5-minute rate must age out, got %d", got)
	}
}

func TestHeartbeatsCarryHealthAndAreNotCountedAsEvents(t *testing.T) {
	tr := New()
	tr.Observe(heartbeat("SRV-FILES", 60), "10.0.0.5", t0)
	h := find(t, tr.Snapshot(t0), "SRV-FILES")
	if h.Events != 0 || h.Sensor == nil {
		t.Fatalf("heartbeat handling: %+v", h)
	}
	s := h.Sensor
	if s.Kind != "etw" || s.Version != "0.3.0" || s.IntervalS != 60 || s.Spooled != 12 || s.QueueCap != 50000 || !s.LastHeartbeat.Equal(t0) {
		t.Fatalf("sensor: %+v", s)
	}
	if strings.Join(h.Sources, ",") != "etw" {
		t.Fatalf("the sensor kind counts as a source: %v", h.Sources)
	}
}

func TestSilenceIsReportedOncePerOutageAndClearsOnReturn(t *testing.T) {
	tr := New()
	tr.Observe(heartbeat("PC-RRHH", 60), "10.0.0.30", t0)
	if got := tr.Check(t0.Add(2 * time.Minute)); len(got) != 0 {
		t.Fatalf("inside the grace no silence: %+v", got)
	}
	got := tr.Check(t0.Add(3*time.Minute + time.Second))
	if len(got) != 1 || !got[0].Silent || got[0].Host.Host != "PC-RRHH" {
		t.Fatalf("silence not reported: %+v", got)
	}
	if got[0].Host.SilentSince == nil || !got[0].Host.SilentSince.Equal(t0) {
		t.Fatalf("silent_since must be the last heartbeat: %+v", got[0].Host.SilentSince)
	}
	if again := tr.Check(t0.Add(10 * time.Minute)); len(again) != 0 {
		t.Fatalf("one report per outage: %+v", again)
	}
	if h := find(t, tr.Snapshot(t0.Add(10*time.Minute)), "PC-RRHH"); h.Status != StatusSilent {
		t.Fatalf("status: %s", h.Status)
	}
	tr.Observe(heartbeat("PC-RRHH", 60), "10.0.0.30", t0.Add(11*time.Minute))
	if h := find(t, tr.Snapshot(t0.Add(11*time.Minute)), "PC-RRHH"); h.Status != StatusOnline || h.SilentSince != nil {
		t.Fatalf("recovery: %+v", h)
	}
	if next := tr.Check(t0.Add(20 * time.Minute)); len(next) != 1 {
		t.Fatalf("a new outage is reported again: %+v", next)
	}
}

func TestHostsWithoutHeartbeatsAreNeverSilent(t *testing.T) {
	tr := New()
	tr.Observe(ev("IDS-01", "network.alert", "suricata"), "", t0)
	if got := tr.Check(t0.Add(time.Hour)); len(got) != 0 {
		t.Fatalf("a feed without heartbeats cannot be declared silent: %+v", got)
	}
	if h := find(t, tr.Snapshot(t0.Add(time.Hour)), "IDS-01"); h.Status != StatusIdle {
		t.Fatalf("status: %s", h.Status)
	}
}

func TestGraceHasAFloorAndScalesWithTheInterval(t *testing.T) {
	if Grace(1) != 3*time.Minute || Grace(60) != 3*time.Minute || Grace(300) != 15*time.Minute {
		t.Fatalf("grace: %v %v %v", Grace(1), Grace(60), Grace(300))
	}
	tr := New()
	bad := heartbeat("X", 0)
	bad.Attributes["interval_s"] = "999999"
	tr.Observe(bad, "", t0)
	if s := find(t, tr.Snapshot(t0), "X").Sensor; s.IntervalS != 60 {
		t.Fatalf("an absurd interval falls back to 60 s: %d", s.IntervalS)
	}
}

func TestSnapshotOrderRetirementAndBounds(t *testing.T) {
	tr := New()
	tr.maxHosts = 3
	tr.Observe(heartbeat("b-silent", 60), "", t0)
	tr.Observe(ev("c-online", "process.create", "etw"), "", t0.Add(9*time.Minute))
	tr.Observe(ev("a-idle", "process.create", "etw"), "", t0)
	tr.Check(t0.Add(9 * time.Minute))
	snap := tr.Snapshot(t0.Add(9 * time.Minute))
	order := []string{snap[0].Host, snap[1].Host, snap[2].Host}
	if strings.Join(order, ",") != "b-silent,a-idle,c-online" && strings.Join(order, ",") != "b-silent,c-online,a-idle" {
		t.Fatalf("silent first: %v", order)
	}
	if snap[0].Status != StatusSilent {
		t.Fatalf("first is silent: %+v", snap[0])
	}
	tr.Observe(ev("d-new", "process.create", "etw"), "", t0.Add(10*time.Minute))
	if len(tr.Snapshot(t0.Add(10*time.Minute))) != 3 {
		t.Fatal("the inventory must stay bounded")
	}
	tr.Check(t0.Add(8 * 24 * time.Hour))
	for _, h := range tr.Snapshot(t0.Add(8 * 24 * time.Hour)) {
		t.Fatalf("hosts gone for a week are retired, %s kept", h.Host)
	}
}

func TestFieldsAreBounded(t *testing.T) {
	tr := New()
	long := strings.Repeat("ñ", 200)
	e := heartbeat(long, 60)
	e.Attributes["os"] = long
	tr.Observe(e, "", t0)
	h := tr.Snapshot(t0)[0]
	if len(h.Host) > maxField || len(h.Sensor.OS) > maxField || !strings.HasPrefix(long, h.Host) {
		t.Fatalf("clip: %d %d", len(h.Host), len(h.Sensor.OS))
	}
	tr.Observe(&model.Event{Host: "  ", Type: "process.create"}, "", t0)
	if len(tr.Snapshot(t0)) != 1 {
		t.Fatal("events without host are ignored")
	}
}
