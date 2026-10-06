package report

import (
	"testing"

	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
)

// TestBuildNoiseExcludesKnownSoftware (§2.2): process boots enriched
// with known_software disappear from the noise aggregate (that is the
// list's whole purpose) but the disappearance stays explainable via
// scanned.known_software_events, and DNS/rule aggregates are untouched.
func TestBuildNoiseExcludesKnownSoftware(t *testing.T) {
	w := testWindow()
	knownBoot := procEvent("PC-1", `C:\Program Files\Lenovo\vantage.exe`, "2026-10-05T10:00:00Z", "")
	knownBoot.Enrichment = map[string]string{"known_software": "Lenovo Vantage"}
	otherBoot := procEvent("PC-2", `C:\Windows\System32\cmd.exe`, "2026-10-05T10:01:00Z", "")

	n := BuildNoise(NoiseInputs{
		Source: SourceStore,
		Events: []*model.Event{
			knownBoot,
			procEvent("PC-1", `c:\PROGRAM FILES\Lenovo\VANTAGE.EXE`, "2026-10-05T10:02:00Z", ""), // not labelled
			otherBoot,
			dnsEvent("PC-1", "update.lenovo.com", "2026-10-05T10:03:30Z"),
		},
	}, w, w.Until)

	if len(n.Processes) != 2 {
		t.Fatalf("processes = %+v, want 2 (only the labelled boot disappears)", n.Processes)
	}
	for _, p := range n.Processes {
		if p.Image == `c:\program files\lenovo\vantage.exe` && p.Count != 1 {
			t.Fatalf("unlabelled vantage boots must still count: %+v", p)
		}
	}
	if n.Scanned.KnownSoftwareEvents != 1 {
		t.Fatalf("known_software_events = %d, want 1", n.Scanned.KnownSoftwareEvents)
	}
	if n.Scanned.Events != 4 {
		t.Fatalf("scanned.events = %d, want 4 (the raw input count; the labelled subset is named separately)", n.Scanned.Events)
	}
	// DNS aggregates ignore the process-level label entirely
	if len(n.Domains) != 1 || n.Domains[0].Count != 1 {
		t.Fatalf("domains must be unaffected: %+v", n.Domains)
	}
}

// TestBuildNoiseEmptyLabelCounts: an empty known_software label is the
// engine's "no match" representation and must never exclude an event.
func TestBuildNoiseEmptyLabelCounts(t *testing.T) {
	w := testWindow()
	ev := procEvent("PC-1", `C:\Windows\System32\notepad.exe`, "2026-10-05T10:00:00Z", "")
	ev.Enrichment = map[string]string{"known_software": ""}
	n := BuildNoise(NoiseInputs{Source: SourceStore, Events: []*model.Event{ev}}, w, w.Until)
	if len(n.Processes) != 1 {
		t.Fatalf("an empty label must not exclude the event: %+v", n.Processes)
	}
}
