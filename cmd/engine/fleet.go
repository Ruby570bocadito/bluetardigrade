package main

import (
	"fmt"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/alert"
	"github.com/Ruby570bocadito/bluetardigrade/internal/fleet"
)

// silentSensorRuleID identifies the inventory's own detection, so it
// can be suppressed per host like any rule (planned maintenance).
const silentSensorRuleID = "fleet-sensor-silent"

// silentSensorAlert describes a sensor that promised heartbeats and
// stopped sending them: the machine is off or offline, or someone
// stopped the telemetry on purpose (ATT&CK T1562.001, impair defenses).
func silentSensorAlert(h fleet.Host, now time.Time) alert.Alert {
	last := h.LastSeen
	kind := "sensor"
	if h.Sensor != nil {
		last = h.Sensor.LastHeartbeat
		if h.Sensor.Kind != "" {
			kind = "sensor " + h.Sensor.Kind
		}
	}
	from := ""
	if len(h.Peers) > 0 {
		from = " desde " + h.Peers[len(h.Peers)-1]
	}
	return alert.Alert{
		Timestamp: now.UTC().Format(time.RFC3339Nano),
		RuleID:    silentSensorRuleID,
		RuleName:  "Sensor sin señal",
		Severity:  "high",
		Host:      h.Host,
		EventID:   fmt.Sprintf("fleet-%s-%d", h.Host, last.Unix()),
		EventType: fleet.HeartbeatType,
		Source:    "engine",
		Summary: fmt.Sprintf("El %s de %s no envía latido desde %s (último%s, %s sin señal): equipo apagado o sin red, o sensor detenido a propósito",
			kind, h.Host, last.UTC().Format(time.RFC3339), from, now.Sub(last).Round(time.Second)),
		MatchedOn: []string{"heartbeat"},
		Tags:      []string{"attack.defense-evasion", "attack.t1562.001", "fleet"},
	}
}
