package beacon

import (
	"testing"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/alert"
)

// The simulation tag (SIM-1) propagates to beacon alerts: a regular
// cadence of simulated connections yields a tagged beacon alert; the
// same traffic without the tag stays untagged. A feed through a mix of
// simulated and real connections is treated as simulated (the beacon
// itself is contaminated evidence).
func TestBeaconSimulationTag(t *testing.T) {
	m, err := LoadFile(writeProfiles(t, strictProfile), nil)
	if err != nil {
		t.Fatal(err)
	}
	base := time.Date(2026, 9, 30, 12, 0, 0, 0, time.UTC)
	var got []alert.Alert
	m.SetEmit(func(a alert.Alert) { got = append(got, a) })

	// Simulated: every event carries the tag.
	for i := 0; i < 12; i++ {
		ev := netEv("LAB-SIM-T1", "185.220.101.47", "", 443)
		ev.Tags = []string{alert.SimulationTag}
		m.Observe(ev, base.Add(time.Duration(i)*time.Second))
	}
	if len(got) != 1 || !alertHasSim(got[0]) {
		t.Fatalf("simulated beacon alert missing the tag: %v", got)
	}

	// Real: no tag anywhere.
	m2, err := LoadFile(writeProfiles(t, strictProfile), nil)
	if err != nil {
		t.Fatal(err)
	}
	var got2 []alert.Alert
	m2.SetEmit(func(a alert.Alert) { got2 = append(got2, a) })
	feedRegular(m2, 12, time.Second, "LAB-WKS-02", "185.220.101.47", "", 443, base)
	if len(got2) != 1 || alertHasSim(got2[0]) {
		t.Fatalf("real beacon alert must not carry the tag: %v", got2)
	}

	// Mixed: one simulated connection contaminates the whole key.
	m3, err := LoadFile(writeProfiles(t, strictProfile), nil)
	if err != nil {
		t.Fatal(err)
	}
	var got3 []alert.Alert
	m3.SetEmit(func(a alert.Alert) { got3 = append(got3, a) })
	ev0 := netEv("LAB-SIM-T3", "185.220.101.47", "", 443)
	ev0.Tags = []string{alert.SimulationTag}
	m3.Observe(ev0, base)
	feedRegular(m3, 11, time.Second, "LAB-SIM-T3", "185.220.101.47", "", 443, base.Add(time.Second))
	if len(got3) != 1 || !alertHasSim(got3[0]) {
		t.Fatalf("mixed beacon alert must carry the tag: %v", got3)
	}
}

func alertHasSim(a alert.Alert) bool {
	for _, t := range a.Tags {
		if t == alert.SimulationTag {
			return true
		}
	}
	return false
}
