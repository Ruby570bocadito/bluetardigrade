package correlate

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/alert"
	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
)

// SimulationTag propagation: a chain completed from simulated events
// is itself simulated; a chain from real events never carries the tag.
func TestChainSimulationTag(t *testing.T) {
	seqs := `- name: "Cadena de prueba"
  id: "sim-seq-tag-0001-4a2b-9c3d-000000000001"
  severity: high
  window: 5m
  steps:
    - rule: "Regla uno"
    - rule: "Regla dos"
`
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "s.yaml"), []byte(seqs), 0o600); err != nil {
		t.Fatalf("write: %v", err)
	}

	newMgr := func(t *testing.T) (*Manager, *[]alert.Alert) {
		var got []alert.Alert
		m, err := LoadDir(dir, func(a alert.Alert) { got = append(got, a) })
		if err != nil {
			t.Fatalf("LoadDir: %v", err)
		}
		return m, &got
	}
	ev := func(typ, host, user string, tags []string) *model.Event {
		return &model.Event{Type: typ, Host: host, User: user, Tags: tags,
			Timestamp: time.Now()}
	}

	// Simulated chain: both steps carry the simulation tag.
	m, got := newMgr(t)
	m.Observe(ev("process.create", "LAB-SIM-T1", "CORP\\a", []string{alert.SimulationTag}), "Regla uno")
	m.Observe(ev("process.create", "LAB-SIM-T1", "CORP\\a", []string{alert.SimulationTag}), "Regla dos")
	if len(*got) != 1 {
		t.Fatalf("chain did not complete: %d alerts", len(*got))
	}
	if !hasTag((*got)[0], alert.SimulationTag) {
		t.Errorf("simulated chain alert tags = %v, want the simulation tag", (*got)[0].Tags)
	}

	// Real chain: same steps without the tag.
	m2, got2 := newMgr(t)
	m2.Observe(ev("process.create", "LAB-SIM-T2", "CORP\\b", nil), "Regla uno")
	m2.Observe(ev("process.create", "LAB-SIM-T2", "CORP\\b", nil), "Regla dos")
	if len(*got2) != 1 {
		t.Fatalf("real chain did not complete: %d alerts", len(*got2))
	}
	if hasTag((*got2)[0], alert.SimulationTag) {
		t.Errorf("real chain alert must not be tagged: %v", (*got2)[0].Tags)
	}

	// Mixed provenance: one simulated step flags the whole chain.
	m3, got3 := newMgr(t)
	m3.Observe(ev("process.create", "LAB-SIM-T3", "CORP\\c", []string{alert.SimulationTag}), "Regla uno")
	m3.Observe(ev("process.create", "LAB-SIM-T3", "CORP\\c", nil), "Regla dos")
	if len(*got3) != 1 || !hasTag((*got3)[0], alert.SimulationTag) {
		t.Errorf("mixed chain must carry the simulation tag: %v", (*got3)[0].Tags)
	}
}

func hasTag(a alert.Alert, tag string) bool {
	for _, t := range a.Tags {
		if t == tag {
			return true
		}
	}
	return false
}
