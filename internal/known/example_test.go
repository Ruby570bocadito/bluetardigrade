package known

import (
	"os"
	"testing"
)

// TestExampleFileLoads pins the shipped known-software.example.yaml to
// the real loader (same guard as ad's TestExampleConfigLoads): the
// documented schema cannot drift from what the engine accepts.
func TestExampleFileLoads(t *testing.T) {
	data, err := os.ReadFile("../../known-software.example.yaml")
	if err != nil {
		t.Fatalf("read example: %v", err)
	}
	sws, err := Parse(data)
	if err != nil {
		t.Fatalf("the shipped known-software.example.yaml must always Parse: %v", err)
	}
	if len(sws) < 3 {
		t.Fatalf("example carries %d entries, want at least 3 (glob, path, hash examples)", len(sws))
	}
	for _, sw := range sws {
		if sw.Image == "" && len(sw.SHA256) == 0 {
			t.Errorf("example entry %q would never match", sw.Name)
		}
	}
}
