package main

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/alert"
	"github.com/Ruby570bocadito/bluetardigrade/internal/baseline"
	"github.com/Ruby570bocadito/bluetardigrade/internal/fleet"
	"github.com/Ruby570bocadito/bluetardigrade/internal/store"
	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
)

func learnProcess(t *testing.T, tr *baseline.Tracker, host, name string) {
	t.Helper()
	tr.Observe(&model.Event{
		ID: "ev-" + name, Type: model.TypeProcessCreate, Host: host, Timestamp: time.Now(),
		Process: &model.Process{PID: 1, Name: name},
	}, time.Now())
}

func baselineValues(t *testing.T, st *store.Store) map[string]bool {
	t.Helper()
	entries, _, err := st.LoadBaseline()
	if err != nil {
		t.Fatal(err)
	}
	out := map[string]bool{}
	for _, e := range entries {
		out[e.Value] = true
	}
	return out
}

// What a failed write did not save is retried on the next flush: the
// tracker hands its pending list over only once.
func TestLearnedFlusherKeepsWhatAFailedWriteDidNotSave(t *testing.T) {
	path := filepath.Join(t.TempDir(), "sf.db")
	broken, err := store.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := broken.Close(); err != nil { // every write on it fails now
		t.Fatal(err)
	}
	base := baseline.New(time.Hour)
	f := &learnedFlusher{base: base, fleet: fleet.New(), st: broken}
	learnProcess(t, base, "pc-01", "excel.exe")
	f.flush(time.Now())
	if len(f.rows) != 1 {
		t.Fatalf("rows kept after a failed write = %d, want 1", len(f.rows))
	}
	learnProcess(t, base, "pc-01", "rclone.exe")

	st, err := store.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	f.st = st
	f.flush(time.Now())
	if got := baselineValues(t, st); !got["excel.exe"] || !got["rclone.exe"] {
		t.Fatalf("stored baseline = %v, want both the retried and the new entry", got)
	}
	if len(f.rows) != 0 {
		t.Fatalf("rows kept after a successful write = %d, want 0", len(f.rows))
	}
}

// Cancelling the context saves what was learned since the last tick.
func TestWatchFleetSilenceFlushesOnShutdown(t *testing.T) {
	st, err := store.Open(filepath.Join(t.TempDir(), "sf.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	base := baseline.New(time.Hour)
	ctx, cancel := context.WithCancel(context.Background())
	watchFleetSilence(ctx, fleet.New(), base, st, func(alert.Alert) {})
	learnProcess(t, base, "pc-01", "excel.exe")
	cancel()
	deadline := time.Now().Add(5 * time.Second)
	for !baselineValues(t, st)["excel.exe"] {
		if time.Now().After(deadline) {
			t.Fatal("the baseline learned before shutdown was not saved")
		}
		time.Sleep(20 * time.Millisecond)
	}
}
