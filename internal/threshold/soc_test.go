package threshold

import (
	"fmt"
	"testing"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/alert"
	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
)

func TestSOCBurstGroupsKeepFinalObservedContext(t *testing.T) {
	d, err := LoadFile("../../thresholds.yaml")
	if err != nil {
		t.Fatal(err)
	}
	var emitted []alert.Alert
	d.SetEmit(func(a alert.Alert) { emitted = append(emitted, a) })
	for i := 0; i < 20; i++ {
		for _, ip := range []string{"10.0.0.1", "10.0.0.2"} {
			ts := t0.Add(time.Duration(i) * time.Second)
			d.Observe(&model.Event{ID: fmt.Sprintf("%s-%d", ip, i), Timestamp: ts, Type: model.TypeHoneypotLogin, Source: "cowrie", Host: "HONEY", Network: &model.Network{SourceIP: ip}, Attributes: map[string]string{"honeypot_event": "cowrie.login.failed", "observer_host": "HONEY", "honeypot_session": fmt.Sprint(i)}}, ts)
		}
	}
	if len(emitted) != 2 || emitted[0].Network.SourceIP == emitted[1].Network.SourceIP || emitted[0].Source != "cowrie" || emitted[0].Attributes["honeypot_session"] != "19" {
		t.Fatalf("burst context/grouping lost: %+v", emitted)
	}
}

// An offline import of a day of honeypot logs reaches the engine in
// seconds. A source that failed 20 logins spread over 24 hours is not
// a 5-minute burst: windows run on event time, not on arrival.
func TestImportedSpreadOutLoginsDoNotFakeABurst(t *testing.T) {
	d, err := LoadFile("../../thresholds.yaml")
	if err != nil {
		t.Fatal(err)
	}
	var emitted int
	d.SetEmit(func(alert.Alert) { emitted++ })
	wall := t0.Add(48 * time.Hour)
	login := func(id string, ts time.Time) *model.Event {
		return &model.Event{ID: id, Timestamp: ts, Type: model.TypeHoneypotLogin, Source: "cowrie", Host: "HONEY",
			Network: &model.Network{SourceIP: "10.0.0.9"}, Attributes: map[string]string{"honeypot_event": "cowrie.login.failed", "observer_host": "HONEY"}}
	}
	for i := 0; i < 40; i++ { // one attempt every 36 minutes
		d.Observe(login(fmt.Sprintf("slow-%d", i), t0.Add(time.Duration(i)*36*time.Minute)), wall)
	}
	if emitted != 0 {
		t.Fatalf("spread-out imported logins fired %d alerts", emitted)
	}
	// a real burst inside the same import still fires
	for i := 0; i < 20; i++ {
		d.Observe(login(fmt.Sprintf("burst-%d", i), t0.Add(30*time.Hour+time.Duration(i)*time.Second)), wall)
	}
	if emitted != 1 {
		t.Fatalf("imported real burst fired %d alerts, want 1", emitted)
	}
}

// A clock stepped back by an hour restarts the key instead of either
// blinding it until the clock catches up or merging two periods.
func TestClockStepBackRestartsWindow(t *testing.T) {
	d := loadForTest(t, defSimple)
	var fired int
	d.SetEmit(func(alert.Alert) { fired++ })
	for i := 0; i < 4; i++ {
		ts := t0.Add(time.Duration(i) * time.Second)
		d.Observe(evFile(fmt.Sprintf("a%d", i), ts), ts)
	}
	back := t0.Add(-time.Hour)
	for i := 0; i < 4; i++ {
		ts := back.Add(time.Duration(i) * time.Second)
		d.Observe(evFile(fmt.Sprintf("b%d", i), ts), t0.Add(time.Minute))
	}
	if fired != 0 {
		t.Fatalf("two half-bursts an hour apart were merged: fired=%d", fired)
	}
	d.Observe(evFile("b4", back.Add(4*time.Second)), t0.Add(time.Minute))
	if fired != 1 {
		t.Fatalf("burst after the clock step did not fire: fired=%d", fired)
	}
}
