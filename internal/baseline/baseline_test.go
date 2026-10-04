package baseline

import (
	"fmt"
	"testing"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
)

var t0 = time.Date(2026, 10, 4, 9, 0, 0, 0, time.UTC)

func proc(host, name string) *model.Event {
	return &model.Event{Host: host, Type: model.TypeProcessCreate, Process: &model.Process{PID: 100, Name: name}}
}

func TestNothingIsNewWhileLearning(t *testing.T) {
	tr := New(24 * time.Hour)
	for i, name := range []string{"explorer.exe", "excel.exe", "outlook.exe"} {
		if n := tr.Observe(proc("PC-CONTA", name), t0.Add(time.Duration(i)*time.Hour)); n != nil {
			t.Fatalf("novelty during learning: %+v", n)
		}
	}
	if hosts, learning := tr.Stats(t0.Add(3 * time.Hour)); hosts != 1 || learning != 1 {
		t.Fatalf("stats: %d %d", hosts, learning)
	}
}

func TestAfterLearningOnlyNeverSeenValuesAreNovel(t *testing.T) {
	tr := New(24 * time.Hour)
	tr.Observe(proc("PC-CONTA", "excel.exe"), t0)
	after := t0.Add(25 * time.Hour)
	if n := tr.Observe(proc("pc-conta", "EXCEL.EXE"), after); n != nil {
		t.Fatalf("a known process (any case) is not new: %+v", n)
	}
	n := tr.Observe(proc("PC-CONTA", `C:\Users\Public\rclone.exe`), after)
	if n == nil || n.Value != "rclone.exe" || n.Kind != KindProcess || !n.LearnedOn.Equal(t0) {
		t.Fatalf("novelty: %+v", n)
	}
	if again := tr.Observe(proc("PC-CONTA", "rclone.exe"), after.Add(time.Minute)); again != nil {
		t.Fatal("a value is novel once")
	}
	// a different host learns on its own clock
	if n := tr.Observe(proc("SRV-NEW", "rclone.exe"), after); n != nil {
		t.Fatal("a host first seen now is still learning")
	}
}

func TestNoveltiesAreRateLimitedPerHost(t *testing.T) {
	tr := New(time.Hour)
	tr.Observe(proc("PC", "a.exe"), t0)
	after := t0.Add(2 * time.Hour)
	got := 0
	for i := 0; i < 30; i++ {
		if tr.Observe(proc("PC", fmt.Sprintf("tool%d.exe", i)), after) != nil {
			got++
		}
	}
	if got != noveltyBurst {
		t.Fatalf("novelties in one hour: %d, want %d", got, noveltyBurst)
	}
	if tr.Observe(proc("PC", "late.exe"), after.Add(61*time.Minute)) == nil {
		t.Fatal("the rate limit window slides")
	}
}

func TestRestoreAndPendingPersistence(t *testing.T) {
	tr := New(24 * time.Hour)
	tr.Observe(proc("PC", "excel.exe"), t0)
	tr.Observe(&model.Event{Host: "PC", Type: "network.connect"}, t0)
	pending := tr.TakePending()
	if len(pending) != 1 || pending[0].Value != "excel.exe" || pending[0].Host != "pc" {
		t.Fatalf("pending: %+v", pending)
	}
	if len(tr.TakePending()) != 0 {
		t.Fatal("pending entries are handed out once")
	}
	restored := New(24 * time.Hour)
	restored.Restore([]Entry{{Host: "pc", Kind: KindProcess, Value: "excel.exe", FirstSeen: t0}}, map[string]time.Time{"pc": t0})
	if restored.Observe(proc("PC", "excel.exe"), t0.Add(30*time.Hour)) != nil {
		t.Fatal("a restored value is known")
	}
	if restored.Observe(proc("PC", "mimi.exe"), t0.Add(30*time.Hour)) == nil {
		t.Fatal("the restored host keeps its learning start: past it, new values are novel")
	}
}

func TestDisabledLearningNeverReports(t *testing.T) {
	tr := New(0)
	tr.Observe(proc("PC", "a.exe"), t0)
	if tr.Observe(proc("PC", "b.exe"), t0.Add(48*time.Hour)) != nil {
		t.Fatal("a zero learning period disables novelties")
	}
}
