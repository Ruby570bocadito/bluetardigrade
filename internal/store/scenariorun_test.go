package store

// Tests for the scenario-run history (SIM-4): the sink survives an
// Open/Close cycle (that is its whole point — the trend outlives the
// engine), orders newest first, serves the detail document and prunes
// beyond the retention cap.

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/scenrun"
)

func scenarioRunFixture(id string, started time.Time) *scenrun.Run {
	finished := started.Add(1500 * time.Millisecond)
	return &scenrun.Run{
		ID:         id,
		StartedAt:  started,
		FinishedAt: &finished,
		Status:     scenrun.StatusCompleted,
		Total:      3,
		Detected:   2,
		Missing:    1,
		DurationMS: 1500,
		PassRate:   2.0 / 3.0,
		Results: []scenrun.ScenarioResult{
			{ScenarioID: "sim-a", Name: "A", Status: scenrun.StatusDetected, Host: "LAB-SIM-A",
				EventsSent: 4, DurationMS: 3, Missing: nil},
			{ScenarioID: "sim-b", Name: "B", Status: scenrun.StatusMissing, Host: "LAB-SIM-B",
				EventsSent: 2, DurationMS: 5,
				Missing: []scenrun.MissingExpectation{{Rule: "r1", Expected: 1, Fired: 0}}},
			{ScenarioID: "sim-c", Name: "C", Status: scenrun.StatusDetected, Host: "LAB-SIM-C",
				EventsSent: 9, DurationMS: 4},
		},
	}
}

func TestScenarioRunSinkRoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "store.db")
	st, err := Open(path)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	started := time.Date(2026, 10, 5, 12, 0, 0, 0, time.UTC)
	if err := st.SaveScenarioRun(scenarioRunFixture("run-1", started)); err != nil {
		t.Fatalf("save: %v", err)
	}
	if err := st.SaveScenarioRun(scenarioRunFixture("run-2", started.Add(time.Minute))); err != nil {
		t.Fatalf("save 2: %v", err)
	}
	st.Close()

	// reopen: the history must survive the restart
	st2, err := Open(path)
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	defer st2.Close()

	runs, err := st2.LoadScenarioRuns(10)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if len(runs) != 2 {
		t.Fatalf("runs: got %d", len(runs))
	}
	if runs[0].ID != "run-2" || runs[1].ID != "run-1" {
		t.Fatalf("order: %+v", runs)
	}
	if runs[0].Results != nil {
		t.Fatalf("summary must not carry results: %+v", runs[0].Results)
	}
	if runs[1].Detected != 2 || runs[1].Missing != 1 || runs[1].Total != 3 {
		t.Fatalf("summary columns: %+v", runs[1])
	}

	detail, err := st2.LoadScenarioRun("run-1")
	if err != nil {
		t.Fatalf("detail: %v", err)
	}
	if detail == nil {
		t.Fatalf("run-1 not found")
	}
	if len(detail.Results) != 3 {
		t.Fatalf("results: %+v", detail.Results)
	}
	if detail.Results[1].Status != scenrun.StatusMissing || len(detail.Results[1].Missing) != 1 ||
		detail.Results[1].Missing[0].Rule != "r1" {
		t.Fatalf("missing document: %+v", detail.Results[1])
	}
	if detail.StartedAt != started {
		t.Fatalf("started_at: got %v want %v", detail.StartedAt, started)
	}
	if detail.FinishedAt == nil || !detail.FinishedAt.Equal(started.Add(1500*time.Millisecond)) {
		t.Fatalf("finished_at: %+v", detail.FinishedAt)
	}

	unknown, err := st2.LoadScenarioRun("run-nope")
	if err != nil || unknown != nil {
		t.Fatalf("unknown run: (%v, %+v)", err, unknown)
	}
}

func TestScenarioRunSinkPrunesHistory(t *testing.T) {
	st, err := Open(filepath.Join(t.TempDir(), "store.db"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer st.Close()
	base := time.Date(2026, 10, 5, 12, 0, 0, 0, time.UTC)
	for i := 0; i < scenarioRunsKept+10; i++ {
		r := scenarioRunFixture("run-"+string(rune('a'+i%26))+string(rune('0'+i/26)), base.Add(time.Duration(i)*time.Second))
		if err := st.SaveScenarioRun(r); err != nil {
			t.Fatalf("save %d: %v", i, err)
		}
	}
	runs, err := st.LoadScenarioRuns(1000)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if len(runs) != scenarioRunsKept {
		t.Fatalf("kept %d runs, want %d", len(runs), scenarioRunsKept)
	}
	// the oldest rows are the pruned ones
	oldest := runs[len(runs)-1]
	if oldest.StartedAt.Before(base.Add(10 * time.Second)) {
		t.Fatalf("pruned the wrong end: oldest is %v", oldest.StartedAt)
	}
}
