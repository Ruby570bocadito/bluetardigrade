package threshold

import (
	"testing"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/alert"
)

// The simulation tag (SIM-1) propagates to volumetric alerts: a burst
// of simulated events yields a tagged threshold alert; the same burst
// of real events never does. A key touched by ANY simulated event is
// tagged on fire (the burst is contaminated evidence).
func TestThresholdSimulationTag(t *testing.T) {
	newDet := func() (*Detector, *[]alert.Alert) {
		d := loadForTest(t, defSimple)
		var got []alert.Alert
		d.SetEmit(func(a alert.Alert) { got = append(got, a) })
		return d, &got
	}

	// Simulated burst.
	d, got := newDet()
	for i := 1; i <= 5; i++ {
		ev := evFile("s", t0.Add(time.Duration(i)*time.Second))
		ev.Tags = []string{alert.SimulationTag}
		d.Observe(ev, t0.Add(time.Duration(i)*time.Second))
	}
	if len(*got) != 1 || !simTagged((*got)[0]) {
		t.Fatalf("simulated threshold alert missing the tag: %v", *got)
	}

	// Real burst.
	d2, got2 := newDet()
	for i := 1; i <= 5; i++ {
		d2.Observe(evFile("r", t0.Add(time.Duration(i)*time.Second)), t0.Add(time.Duration(i)*time.Second))
	}
	if len(*got2) != 1 || simTagged((*got2)[0]) {
		t.Fatalf("real threshold alert must not carry the tag: %v", *got2)
	}

	// Mixed: one simulated event contaminates the key.
	d3, got3 := newDet()
	first := evFile("m0", t0)
	first.Tags = []string{alert.SimulationTag}
	d3.Observe(first, t0)
	for i := 1; i <= 4; i++ {
		d3.Observe(evFile("m", t0.Add(time.Duration(i)*time.Second)), t0.Add(time.Duration(i)*time.Second))
	}
	if len(*got3) != 1 || !simTagged((*got3)[0]) {
		t.Fatalf("mixed threshold alert must carry the tag: %v", *got3)
	}
}

func simTagged(a alert.Alert) bool {
	for _, t := range a.Tags {
		if t == alert.SimulationTag {
			return true
		}
	}
	return false
}
