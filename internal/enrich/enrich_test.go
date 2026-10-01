package enrich

import (
	"reflect"
	"testing"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
)

// The DOMINIO\usuario convention is how Windows sensors report
// identity; the split feeds the alert surfaces operators triage by.
func TestUserDomainSplit(t *testing.T) {
	ev := &model.Event{User: `CORP\jdoe`}
	New().Apply(ev)
	if ev.Enrichment["user_domain"] != "CORP" {
		t.Fatalf("user_domain = %q, want CORP", ev.Enrichment["user_domain"])
	}
	if ev.Enrichment["user_name"] != "jdoe" {
		t.Fatalf("user_name = %q, want jdoe", ev.Enrichment["user_name"])
	}
	// the raw evidence field is never rewritten: consumers still see
	// the original string the sensor reported
	if ev.User != `CORP\jdoe` {
		t.Fatalf("raw User mutated: %q", ev.User)
	}
}

// A bare username (no domain) has nothing to split: no keys may appear
// rather than empty-string ones.
func TestUserWithoutDomain(t *testing.T) {
	ev := &model.Event{User: "svc_backup"}
	New().Apply(ev)
	if _, ok := ev.Enrichment["user_domain"]; ok {
		t.Fatalf("user_domain present for a domain-less user: %q", ev.Enrichment["user_domain"])
	}
	if _, ok := ev.Enrichment["user_name"]; ok {
		t.Fatalf("user_name present for a domain-less user: %q", ev.Enrichment["user_name"])
	}
	// and no user field at all: no panic, no keys
	ev2 := &model.Event{}
	New().Apply(ev2)
	if _, ok := ev2.Enrichment["user_name"]; ok {
		t.Fatal("user_name present without any user")
	}
}

// image_origin distinguishes system binaries from everything else —
// the cheapest triage signal there is. The predicate and its cases are
// pinned so a refactor cannot silently reclassify.
func TestImageOrigin(t *testing.T) {
	cases := []struct {
		image, want string
	}{
		{`C:\Windows\System32\cmd.exe`, "system"},
		{`C:\Windows\explorer.exe`, "system"},
		{`c:\windows\system32\WINDOWSPOWERSHELL\v1.0\powershell.exe`, "system"}, // case-insensitive
		{`C:\Users\jdoe\Documents\tool.exe`, "userland"},
		{`C:\Program Files\App\app.exe`, "userland"},
		{`C:\Users\Public\payload.exe`, "userland"}, // the classic staging dir must NOT classify as system
	}
	for _, tc := range cases {
		ev := &model.Event{Process: &model.Process{Image: tc.image}}
		New().Apply(ev)
		if got := ev.Enrichment["image_origin"]; got != tc.want {
			t.Fatalf("image %q: image_origin = %q, want %q", tc.image, got, tc.want)
		}
		dir := ev.Enrichment["image_dir"]
		if dir == "" {
			t.Fatalf("image %q: image_dir empty", tc.image)
		}
	}
}

// An event without a process section (network.connect, registry.set...)
// must enrich without panicking and without image keys.
func TestNoProcessSection(t *testing.T) {
	ev := &model.Event{Type: model.TypeNetworkConnect}
	New().Apply(ev)
	if _, ok := ev.Enrichment["image_origin"]; ok {
		t.Fatal("image_origin present without a process section")
	}
	if _, ok := ev.Enrichment["image_dir"]; ok {
		t.Fatal("image_dir present without a process section")
	}
}

// An event without an image must not classify by origin either (an
// empty Image is not evidence of anything).
func TestProcessWithoutImage(t *testing.T) {
	ev := &model.Event{Process: &model.Process{PID: 1, Name: "x.exe"}}
	New().Apply(ev)
	if _, ok := ev.Enrichment["image_origin"]; ok {
		t.Fatal("image_origin present without an image path")
	}
}

// The enrichment map is created on demand: a nil incoming map must end
// up initialized with the always-on keys.
func TestApplyInitializesMap(t *testing.T) {
	ev := &model.Event{}
	if ev.Enrichment != nil {
		t.Fatal("precondition: enrichment starts nil on a fresh event")
	}
	New().Apply(ev)
	if ev.Enrichment == nil {
		t.Fatal("Apply left a nil enrichment map")
	}
	for _, key := range []string{"seen_at", "engine_uptime"} {
		if _, ok := ev.Enrichment[key]; !ok {
			t.Fatalf("always-on key %q missing after first Apply", key)
		}
	}
	// seen_at parses as RFC3339Nano: the API and the store rely on it
	if _, err := time.Parse(time.RFC3339Nano, ev.Enrichment["seen_at"]); err != nil {
		t.Fatalf("seen_at %q is not RFC3339Nano: %v", ev.Enrichment["seen_at"], err)
	}
}

// Re-applying on the same event (a re-ingested or replayed event) must
// keep the same key set — enrichment is repeatable, never accretive.
func TestApplyRepeatable(t *testing.T) {
	ev := &model.Event{User: `CORP\jdoe`, Process: &model.Process{Image: `C:\Windows\System32\cmd.exe`}}
	en := New()
	en.Apply(ev)
	first := make([]string, 0, len(ev.Enrichment))
	for k := range ev.Enrichment {
		first = append(first, k)
	}
	en.Apply(ev)
	if len(ev.Enrichment) != len(first) {
		t.Fatalf("key set grew on re-apply: %d -> %d", len(first), len(ev.Enrichment))
	}
	// raw evidence untouched after two passes
	if ev.User != `CORP\jdoe` || ev.Process.Image != `C:\Windows\System32\cmd.exe` {
		t.Fatal("raw evidence fields mutated by enrichment")
	}
}

// Two events enriched by the same Enricher keep independent maps:
// mutating one must not leak into the other.
func TestEventsEnrichedIndependently(t *testing.T) {
	en := New()
	ev1 := &model.Event{User: `CORP\a`}
	ev2 := &model.Event{User: `CORP\b`}
	en.Apply(ev1)
	en.Apply(ev2)
	if ev1.Enrichment["user_name"] != "a" || ev2.Enrichment["user_name"] != "b" {
		t.Fatalf("enrichment leaked between events: %q vs %q",
			ev1.Enrichment["user_name"], ev2.Enrichment["user_name"])
	}
	if !reflect.DeepEqual(ev1.Enrichment, ev2.Enrichment) && len(ev1.Enrichment) != len(ev2.Enrichment) {
		t.Fatal("map sizes diverged unexpectedly")
	}
}

// --- parent tracking (flight recorder of pid -> identity) ---

// The canonical case: explorer.exe (pid 100) spawns cmd.exe (ppid 100)
// and the child's enrichment resolves the parent's name and image.
func TestParentNameResolution(t *testing.T) {
	en := New()
	en.Apply(&model.Event{
		Type: model.TypeProcessCreate,
		Host: "lab-01",
		Process: &model.Process{PID: 100, Name: "explorer.exe",
			Image: `C:\Windows\explorer.exe`},
	})
	child := &model.Event{
		Type: model.TypeProcessCreate,
		Host: "lab-01",
		Process: &model.Process{PID: 101, PPID: 100, Name: "cmd.exe",
			Image: `C:\Windows\System32\cmd.exe`},
	}
	en.Apply(child)
	if got := child.Enrichment["parent_name"]; got != "explorer.exe" {
		t.Fatalf("parent_name = %q, want explorer.exe", got)
	}
	if got := child.Enrichment["parent_image"]; got != `C:\Windows\explorer.exe` {
		t.Fatalf("parent_image = %q, want the explorer image", got)
	}
}

// Parent identity is per host: pid 200 on another endpoint must not
// answer for lab-01's pid 200.
func TestParentIsHostScoped(t *testing.T) {
	en := New()
	en.Apply(&model.Event{
		Type:    model.TypeProcessCreate,
		Host:    "lab-01",
		Process: &model.Process{PID: 200, Name: "winword.exe"},
	})
	other := &model.Event{
		Type:    model.TypeProcessCreate,
		Host:    "lab-02",
		Process: &model.Process{PID: 201, PPID: 200, Name: "cmd.exe"},
	}
	en.Apply(other)
	if _, ok := other.Enrichment["parent_name"]; ok {
		t.Fatalf("parent leaked across hosts: %q", other.Enrichment["parent_name"])
	}
}

// A process.terminate evicts the identity immediately: pid reuse must
// never misattribute a parent after the original exited.
func TestTerminateEvictsEntry(t *testing.T) {
	en := New()
	en.Apply(&model.Event{
		Type:    model.TypeProcessCreate,
		Host:    "lab-01",
		Process: &model.Process{PID: 300, Name: "old.exe"},
	})
	en.Apply(&model.Event{
		Type:    model.TypeProcessTerminate,
		Host:    "lab-01",
		Process: &model.Process{PID: 300, Name: "old.exe"},
	})
	next := &model.Event{
		Type:    model.TypeProcessCreate,
		Host:    "lab-01",
		Process: &model.Process{PID: 301, PPID: 300, Name: "new.exe"},
	}
	en.Apply(next)
	if got, ok := next.Enrichment["parent_name"]; ok {
		t.Fatalf("stale parent resolved after terminate: %q", got)
	}
}

// Non-create events carrying the acting process resolve their parent
// too (the sensor may batch the create with the follow-up event).
func TestParentResolvedOnNonCreateEvent(t *testing.T) {
	en := New()
	en.Apply(&model.Event{
		Type:    model.TypeProcessCreate,
		Host:    "lab-01",
		Process: &model.Process{PID: 400, Name: "word.exe"},
	})
	ev := &model.Event{
		Type: model.TypeFileWrite,
		Host: "lab-01",
		Process: &model.Process{PID: 401, PPID: 400, Name: "wscript.exe",
			Image: `C:\Windows\System32\wscript.exe`},
	}
	en.Apply(ev)
	if got := ev.Enrichment["parent_name"]; got != "word.exe" {
		t.Fatalf("parent_name on file.write = %q, want word.exe", got)
	}
}

// The TTL sweep retires idle identities; Sweep is exported so this
// does not need a wall-clock sleep.
func TestSweepRetiresIdleEntries(t *testing.T) {
	en := New()
	now := time.Now()
	en.Apply(&model.Event{
		Type:    model.TypeProcessCreate,
		Host:    "lab-01",
		Process: &model.Process{PID: 500, Name: "idle.exe"},
	})
	if en.Tracked() != 1 {
		t.Fatalf("tracked = %d, want 1", en.Tracked())
	}
	en.Sweep(now.Add(procTTL + time.Minute))
	if got := en.Tracked(); got != 0 {
		t.Fatalf("tracked after sweep = %d, want 0", got)
	}
}

// The per-host cap holds under churn: a storm of unique pids must not
// grow the map without bound.
func TestPerHostCapBoundsChurn(t *testing.T) {
	en := New()
	for i := 1; i <= maxProcsPerHost*2; i++ {
		en.Apply(&model.Event{
			Type:    model.TypeProcessCreate,
			Host:    "lab-01",
			Process: &model.Process{PID: i, Name: "p.exe"},
		})
	}
	if got := en.Tracked(); got > maxProcsPerHost+maxProcsPerHost/2 {
		t.Fatalf("tracked = %d exceeds the cap + trim slack (%d)", got,
			maxProcsPerHost+maxProcsPerHost/2)
	}
}
