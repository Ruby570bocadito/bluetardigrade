package enrich

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/Ruby570bocadito/bluetardigrade/internal/known"
	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
)

// TestKnownSoftwareEnrichedAndNotForgeable (§2.2): a match labels the
// event with the engine-owned known_software key, and a replayed or
// sensor-supplied key is wiped first — a forged label would blind
// rules that opted out of firing on known software.
func TestKnownSoftwareEnrichedAndNotForgeable(t *testing.T) {
	doc := "version: 1\nsoftware:\n  - name: Lenovo Vantage\n    image: 'C:\\Program Files (x86)\\Lenovo\\VantageService\\*\\LenovoVantage-*.exe'\n"
	p := filepath.Join(t.TempDir(), "known-software.yaml")
	if err := os.WriteFile(p, []byte(doc), 0o600); err != nil {
		t.Fatal(err)
	}
	m := known.New()
	if err := m.LoadFile(p); err != nil {
		t.Fatal(err)
	}

	en := New()
	en.SetKnownSoftware(m)

	// a matching event gains the label
	ev := &model.Event{
		Type:    model.TypeProcessCreate,
		Host:    "LAB-WKS-01",
		Process: &model.Process{PID: 9, Name: "LenovoVantage-svc.exe", Image: `C:\Program Files (x86)\Lenovo\VantageService\6.1\LenovoVantage-svc.exe`},
	}
	en.Apply(ev)
	if got := ev.Enrichment["known_software"]; got != "Lenovo Vantage" {
		t.Fatalf("known_software = %q, want %q", got, "Lenovo Vantage")
	}

	// a non-matching event does not
	ev2 := &model.Event{
		Type:    model.TypeProcessCreate,
		Host:    "LAB-WKS-01",
		Process: &model.Process{PID: 9, Name: "cmd.exe", Image: `C:\Windows\System32\cmd.exe`},
	}
	en.Apply(ev2)
	if _, ok := ev2.Enrichment["known_software"]; ok {
		t.Fatal("a non-matching event must not carry known_software")
	}

	// a sensor-supplied label is wiped and re-derived from evidence
	ev3 := &model.Event{
		Type:       model.TypeProcessCreate,
		Host:       "LAB-WKS-01",
		Process:    &model.Process{PID: 9, Name: "cmd.exe", Image: `C:\Windows\System32\cmd.exe`},
		Enrichment: map[string]string{"known_software": "Lenovo Vantage"},
	}
	en.Apply(ev3)
	if _, ok := ev3.Enrichment["known_software"]; ok {
		t.Fatal("a forged known_software label must be deleted by Apply")
	}

	// nil manager = off: no label, no crash
	en4 := New()
	ev4 := &model.Event{
		Type:    model.TypeProcessCreate,
		Host:    "LAB-WKS-01",
		Process: &model.Process{PID: 9, Name: "LenovoVantage-svc.exe", Image: `C:\Program Files (x86)\Lenovo\VantageService\6.1\LenovoVantage-svc.exe`},
	}
	en4.Apply(ev4)
	if _, ok := ev4.Enrichment["known_software"]; ok {
		t.Fatal("without a list, no event carries known_software")
	}
}
