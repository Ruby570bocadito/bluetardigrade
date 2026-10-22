package threshold

import (
	"fmt"
	"testing"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/alert"
	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
)

// The AD spray entry (thr-ad-spray, M-7): 4625 failures are grouped
// per source IP, so one noisy workstation cannot mask another's
// burst, and two IPs bursting in the same window emit separately.
func TestADSprayGroupsPerSourceIP(t *testing.T) {
	d, err := LoadFile("../../thresholds.yaml")
	if err != nil {
		t.Fatal(err)
	}
	var emitted []string
	d.SetEmit(func(a alert.Alert) { emitted = append(emitted, a.Host) })
	fail := func(ip, user string, i int) *model.Event {
		return &model.Event{
			ID:        fmt.Sprintf("wef-%s-%d", ip, i),
			Timestamp: t0.Add(time.Duration(i) * time.Second),
			Type:      model.TypeWindowsEvent,
			Source:    "wef",
			Host:      "LAB-DC-01",
			User:      user,
			Attributes: map[string]string{
				"win_channel":  "Security",
				"win_event_id": "4625",
				"win_ip":       ip,
			},
		}
	}
	// 30 failures per IP from two sources: both groups cross the 25
	// threshold within the same window and emit independently.
	for i := 0; i < 30; i++ {
		d.Observe(fail("10.0.0.10", `CORP\jsmith`, i), t0.Add(time.Minute))
		d.Observe(fail("10.0.0.11", `CORP\amartin`, i), t0.Add(time.Minute))
	}
	if len(emitted) != 2 {
		t.Fatalf("two spraying sources must emit two alerts, got %d", len(emitted))
	}
}

func TestADSprayNeedsTheBurst(t *testing.T) {
	d, err := LoadFile("../../thresholds.yaml")
	if err != nil {
		t.Fatal(err)
	}
	var emitted int
	d.SetEmit(func(alert.Alert) { emitted++ })
	// a chatty but legitimate source: one failure every 30s for an
	// hour (120 events) never crosses a 5-minute window
	for i := 0; i < 120; i++ {
		d.Observe(&model.Event{
			ID:        fmt.Sprintf("slow-%d", i),
			Timestamp: t0.Add(time.Duration(i) * 30 * time.Second),
			Type:      model.TypeWindowsEvent,
			Source:    "wef",
			Host:      "LAB-DC-01",
			Attributes: map[string]string{
				"win_channel":  "Security",
				"win_event_id": "4625",
				"win_ip":       "10.0.0.99",
			},
		}, t0.Add(time.Hour))
	}
	if emitted != 0 {
		t.Fatalf("spread-out failures fired %d alerts, want 0", emitted)
	}
	// a single failure must never fire either (4625 happens on typos)
	d2, err := LoadFile("../../thresholds.yaml")
	if err != nil {
		t.Fatal(err)
	}
	d2.SetEmit(func(alert.Alert) { emitted++ })
	d2.Observe(&model.Event{
		ID:        "one-failure",
		Timestamp: t0,
		Type:      model.TypeWindowsEvent,
		Source:    "wef",
		Host:      "LAB-DC-01",
		Attributes: map[string]string{
			"win_channel":  "Security",
			"win_event_id": "4625",
			"win_ip":       "10.0.0.98",
		},
	}, t0)
	if emitted != 0 {
		t.Fatalf("a single 4625 fired an alert, want 0 (got %d)", emitted)
	}
}
