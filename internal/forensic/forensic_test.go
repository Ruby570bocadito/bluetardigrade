package forensic

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/alert"
	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
)

func mkEvent(id, host, typ string, at time.Time) *model.Event {
	return &model.Event{
		ID:        id,
		Timestamp: at,
		Type:      typ,
		Host:      host,
		User:      `CORP\jdoe`,
		Process:   &model.Process{PID: 1, Name: "p.exe", Image: `C:\Windows\p.exe`},
	}
}

func mkAlert(id, host, sev, ts string) alert.Alert {
	return alert.Alert{ID: id, Severity: sev, Host: host,
		Timestamp: ts, EventID: "ev-" + id, RuleName: "rule"}
}

var base = time.Date(2026, 10, 1, 12, 0, 0, 0, time.UTC)

// The core contract: events inside the capture window (plus the
// triggering event, even when it lands outside it) are frozen into a
// bundle that Load reads back identically.
func TestCaptureFreezesWindow(t *testing.T) {
	dir := t.TempDir()
	r := New(dir)
	r.ObserveEvent(mkEvent("e1", "lab-01", model.TypeProcessCreate, base.Add(-6*time.Minute)))  // outside
	r.ObserveEvent(mkEvent("e2", "lab-01", model.TypeNetworkConnect, base.Add(-4*time.Minute))) // inside
	r.ObserveEvent(mkEvent("e3", "lab-01", model.TypeFileWrite, base.Add(-1*time.Minute)))      // inside
	r.ObserveEvent(mkEvent("e4", "lab-02", model.TypeProcessCreate, base.Add(-1*time.Minute)))  // other host

	a := mkAlert("0123456789abcdef", "lab-01", "critical", base.Format(time.RFC3339))
	path, ok, err := r.Capture(a, base)
	if err != nil || !ok {
		t.Fatalf("Capture: ok=%v err=%v", ok, err)
	}
	if filepath.Base(path) != "0123456789abcdef.json" {
		t.Fatalf("bundle path = %q", path)
	}

	b, err := r.Load("0123456789abcdef")
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if b.Host != "lab-01" || b.Alert.ID != "0123456789abcdef" {
		t.Fatalf("bundle identity: host=%q alert=%q", b.Host, b.Alert.ID)
	}
	ids := map[string]bool{}
	for _, ev := range b.Timeline {
		ids[ev.ID] = true
	}
	if ids["e2"] != true || ids["e3"] != true {
		t.Fatal("inside-window events missing from the timeline")
	}
	if ids["e1"] {
		t.Fatal("event older than the window leaked into the timeline")
	}
	if ids["e4"] {
		t.Fatal("event from another host leaked into the timeline")
	}
	if b.Summary.Events != len(b.Timeline) || b.Summary.NetworkConnects != 1 || b.Summary.FileWrites != 1 {
		t.Fatalf("summary mismatch: %+v", b.Summary)
	}
}

// The triggering event rides along even when the ring dropped it out
// of the time window: the alert's own evidence is never absent from
// its bundle.
func TestTriggeringEventAlwaysIncluded(t *testing.T) {
	dir := t.TempDir()
	r := New(dir)
	trigger := mkEvent("ev-0123456789abcdef", "lab-01", model.TypeProcessCreate, base.Add(-9*time.Minute))
	r.ObserveEvent(trigger)
	a := mkAlert("0123456789abcdef", "lab-01", "high", base.Format(time.RFC3339))
	if _, ok, err := r.Capture(a, base); err != nil || !ok {
		t.Fatalf("Capture: ok=%v err=%v", ok, err)
	}
	b, err := r.Load("0123456789abcdef")
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	found := false
	for _, ev := range b.Timeline {
		if ev.ID == "ev-0123456789abcdef" {
			found = true
		}
	}
	if !found {
		t.Fatal("the triggering event is not in its own bundle")
	}
}

// Below the severity threshold nothing is written: medium alerts are
// too noisy to freeze evidence for, and disk stays empty.
func TestLowSeverityDoesNotCapture(t *testing.T) {
	dir := t.TempDir()
	r := New(dir)
	r.ObserveEvent(mkEvent("e1", "lab-01", model.TypeProcessCreate, base))
	a := mkAlert("0123456789abcdef", "lab-01", "medium", base.Format(time.RFC3339))
	if _, ok, err := r.Capture(a, base); err != nil || ok {
		t.Fatalf("medium alert captured: ok=%v err=%v", ok, err)
	}
	if _, err := r.Load("0123456789abcdef"); err != ErrNotFound {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}

// An empty dir keeps the flight recorder in memory but Load answers
// the distinct "feature off" error.
func TestDisabledRecorder(t *testing.T) {
	r := New("")
	r.ObserveEvent(mkEvent("e1", "lab-01", model.TypeProcessCreate, base))
	if r.TrackedEvents() != 1 {
		t.Fatalf("flight recorder inactive: %d", r.TrackedEvents())
	}
	if _, err := r.Load("0123456789abcdef"); err != ErrDisabled {
		t.Fatalf("expected ErrDisabled, got %v", err)
	}
	if _, ok, err := r.Capture(mkAlert("0123456789abcdef", "lab-01", "critical",
		base.Format(time.RFC3339)), base); err != nil || ok {
		t.Fatalf("disabled recorder wrote a bundle: ok=%v err=%v", ok, err)
	}
}

// Load rejects malformed ids as client errors instead of probing the
// filesystem with them: the id is a 16-hex contract, not a filename
// supplied by the caller.
func TestLoadRejectsMalformedIDs(t *testing.T) {
	r := New(t.TempDir())
	for _, id := range []string{
		"", "short", "0123456789ABCDEF", // uppercase rejected on purpose
		"0123456789abcdeG", "../../etc/passwd", "0123456789abcdef.exe",
	} {
		if _, err := r.Load(id); err == nil || err == ErrNotFound || err == ErrDisabled {
			t.Fatalf("id %q accepted (err=%v)", id, err)
		}
	}
}

// The per-host ring cap holds under a flood: memory does not grow
// without bound, and the newest events are the ones kept.
func TestPerHostRingCap(t *testing.T) {
	r := New("")
	for i := 0; i < maxEventsPerHost*2; i++ {
		r.ObserveEvent(mkEvent(fmt.Sprintf("e%05d", i), "lab-01",
			model.TypeProcessCreate, base.Add(time.Duration(i)*time.Second)))
	}
	if got := r.TrackedEvents(); got != maxEventsPerHost {
		t.Fatalf("ring size = %d, want %d", got, maxEventsPerHost)
	}
}

// Hosts evict LRU-style: the coldest reporting host loses its ring
// when the host cap is crossed, not an arbitrary one.
func TestHostsEvictLRU(t *testing.T) {
	r := New("")
	for i := 0; i <= maxHosts; i++ {
		host := fmt.Sprintf("lab-%03d", i)
		r.ObserveEvent(mkEvent(fmt.Sprintf("e%03d", i), host, model.TypeProcessCreate, base))
	}
	if got := len(r.order); got != maxHosts {
		t.Fatalf("hosts tracked = %d, want %d", got, maxHosts)
	}
}

// Bundle files on disk are evicted oldest-first when the directory
// cap is crossed: retention is bounded by construction.
func TestBundleDirEviction(t *testing.T) {
	if testing.Short() {
		t.Skip("eviction writes 260 bundles")
	}
	dir := t.TempDir()
	r := New(dir)
	old := time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC)
	for i := 0; i < maxBundleFiles+5; i++ {
		id := fmt.Sprintf("%016x", i)
		a := mkAlert(id, "lab-01", "high", old.Format(time.RFC3339))
		if _, ok, err := r.Capture(a, old.Add(time.Duration(i)*time.Second)); err != nil || !ok {
			t.Fatalf("capture %d: ok=%v err=%v", i, ok, err)
		}
		// distinct mtimes: the temp+rename write is fast enough that a
		// plain mtime tie is possible; force ordering explicitly
		os.Chtimes(filepath.Join(dir, id+".json"), old.Add(time.Duration(i)*time.Second), old.Add(time.Duration(i)*time.Second))
	}
	if got := r.CountBundles(); got != maxBundleFiles {
		t.Fatalf("bundles kept = %d, want %d", got, maxBundleFiles)
	}
	// the oldest five are the ones gone
	for i := 0; i < 5; i++ {
		id := fmt.Sprintf("%016x", i)
		if _, err := r.Load(id); err != ErrNotFound {
			t.Fatalf("oldest bundle %d still present (err=%v)", i, err)
		}
	}
}

// A corrupted bundle file is reported as a decode error, not as a
// valid empty bundle: evidence integrity fails loud.
func TestCorruptBundleFailsLoud(t *testing.T) {
	dir := t.TempDir()
	r := New(dir)
	if err := os.WriteFile(filepath.Join(dir, "0123456789abcdef.json"), []byte("{not json"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := r.Load("0123456789abcdef"); err == nil || err == ErrNotFound {
		t.Fatalf("corrupt bundle decoded (err=%v)", err)
	}
}

// The timeline keeps the TAIL when the window overflows the cap: the
// events closest to the alert are the evidence an operator reads.
func TestTimelineKeepsTail(t *testing.T) {
	dir := t.TempDir()
	r := New(dir)
	for i := 0; i < timelineCap+50; i++ {
		r.ObserveEvent(mkEvent(fmt.Sprintf("e%04d", i), "lab-01",
			model.TypeProcessCreate, base.Add(-time.Duration(i)*time.Second)))
	}
	a := mkAlert("0123456789abcdef", "lab-01", "critical", base.Format(time.RFC3339))
	if _, ok, err := r.Capture(a, base); err != nil || !ok {
		t.Fatalf("Capture: ok=%v err=%v", ok, err)
	}
	b, err := r.Load("0123456789abcdef")
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if len(b.Timeline) != timelineCap {
		t.Fatalf("timeline = %d, want capped at %d", len(b.Timeline), timelineCap)
	}
}
