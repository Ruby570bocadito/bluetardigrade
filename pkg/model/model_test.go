package model

import (
	"encoding/json"
	"errors"
	"reflect"
	"testing"
	"time"
)

// fullEvent builds an event exercising every nested section of the
// schema so round-trip and wire-shape tests see the whole contract.
func fullEvent() *Event {
	ts := time.Date(2026, 9, 30, 12, 0, 0, 123456789, time.UTC) // no monotonic clock: survives JSON round trip
	return &Event{
		ID:        "evt-42",
		Timestamp: ts,
		Type:      TypeProcessCreate,
		Source:    "test",
		Host:      "LAB-WKS-01",
		User:      `CORP\jdoe`,
		Process: &Process{
			PID: 4104, PPID: 812, Name: "notepad.exe",
			CommandLine: `notepad.exe todo.txt`,
			Image:       `C:\Windows\System32\notepad.exe`,
			Hashes:      Hashes{"sha256": "abc123"},
		},
		Target: &Process{PID: 700, Name: "lsass.exe"},
		Access: &ProcessAccess{GrantedAccess: "0x1010", CallTrace: "ntdll.dll+0x1"},
		File: &File{
			Path: `C:\Users\Public\payload.exe`, Extension: ".exe",
			SizeBytes: 4096, Hashes: Hashes{"md5": "deadbeef"},
		},
		Network: &Network{
			Protocol: "tcp", SourceIP: "10.0.4.42", SourcePort: 51520,
			DestinationIP: "142.250.200.36", DestinationPort: 443,
			Domain: "www.google.com",
		},
		Registry: &Registry{
			Key:       `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`,
			ValueName: "OneDriveSync", Value: `C:\payload.exe`,
			Operation: "SetValue",
		},
		Tags:       []string{"ttp:offensive"},
		Enrichment: map[string]string{"seen_at": "2026-09-30T12:00:00Z"},
	}
}

// Encode then Unmarshal must reproduce the event exactly: the NDJSON
// feed and the forensic store both rely on this being lossless.
func TestEncodeDecodeRoundTrip(t *testing.T) {
	ev := fullEvent()
	line, err := ev.Encode()
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	var got Event
	if err := json.Unmarshal(line, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if !reflect.DeepEqual(&got, ev) {
		t.Fatalf("round trip lost fidelity:\n got %+v\nwant %+v", &got, ev)
	}
	// and the decoded event re-encodes byte-identically (stable wire form)
	again, err := (&got).Encode()
	if err != nil {
		t.Fatalf("re-encode: %v", err)
	}
	if string(again) != string(line) {
		t.Fatalf("re-encode differs:\n got %s\nwant %s", again, line)
	}
}

func TestValidateMissingID(t *testing.T) {
	ev := &Event{Type: TypeProcessCreate}
	if err := ev.Validate(); !errors.Is(err, ErrMissingID) {
		t.Fatalf("Validate() = %v, want ErrMissingID", err)
	}
}

func TestValidateMissingType(t *testing.T) {
	ev := &Event{ID: "x"}
	if err := ev.Validate(); !errors.Is(err, ErrMissingType) {
		t.Fatalf("Validate() = %v, want ErrMissingType", err)
	}
}

// A zero timestamp must be filled at validation time (UTC), not
// rejected: sensors that cannot know the wall clock still produce
// useful events.
func TestValidateFillsZeroTimestamp(t *testing.T) {
	before := time.Now().UTC()
	ev := &Event{ID: "x", Type: TypeProcessCreate}
	if err := ev.Validate(); err != nil {
		t.Fatalf("Validate() = %v, want nil", err)
	}
	if ev.Timestamp.IsZero() {
		t.Fatal("zero timestamp was not filled")
	}
	if loc := ev.Timestamp.Location(); loc != time.UTC {
		t.Fatalf("filled timestamp location = %v, want UTC", loc)
	}
	after := time.Now().UTC()
	if ev.Timestamp.Before(before) || ev.Timestamp.After(after) {
		t.Fatalf("filled timestamp %v outside [%v, %v]", ev.Timestamp, before, after)
	}
	// a provided timestamp is never overwritten
	kept := time.Date(2001, 1, 1, 0, 0, 0, 0, time.UTC)
	ev2 := &Event{ID: "x", Type: TypeProcessCreate, Timestamp: kept}
	_ = ev2.Validate()
	if !ev2.Timestamp.Equal(kept) {
		t.Fatalf("provided timestamp overwritten: got %v want %v", ev2.Timestamp, kept)
	}
}

// FieldMap is the rule-condition surface: dotted paths must resolve
// into nested maps and numbers must arrive as float64, the shape
// encoding/json produces.
func TestFieldMapDottedPaths(t *testing.T) {
	fm := fullEvent().FieldMap()
	if fm == nil {
		t.Fatal("FieldMap returned nil")
	}

	proc, ok := fm["process"].(map[string]any)
	if !ok {
		t.Fatalf("fm[process] = %T, want map", fm["process"])
	}
	if proc["command_line"] != `notepad.exe todo.txt` {
		t.Fatalf("process.command_line = %v", proc["command_line"])
	}
	if pid, ok := proc["pid"].(float64); !ok || pid != 4104 {
		t.Fatalf("process.pid = %T(%v), want float64(4104)", proc["pid"], proc["pid"])
	}

	net, ok := fm["network"].(map[string]any)
	if !ok {
		t.Fatalf("fm[network] = %T, want map", fm["network"])
	}
	if port, ok := net["destination_port"].(float64); !ok || port != 443 {
		t.Fatalf("network.destination_port = %T(%v), want float64(443)", net["destination_port"], net["destination_port"])
	}

	if fm["id"] != "evt-42" {
		t.Fatalf("fm[id] = %v", fm["id"])
	}
	tags, ok := fm["tags"].([]any)
	if !ok || len(tags) != 1 || tags[0] != "ttp:offensive" {
		t.Fatalf("fm[tags] = %#v, want [ttp:offensive]", fm["tags"])
	}
}

// omitempty keeps the wire (and the forensic rows) clean: absent
// sections must not appear as empty keys on an event that carries none
// of them.
func TestOmitEmptyWireShape(t *testing.T) {
	minimal := &Event{ID: "m-1", Type: TypeProcessTerminate, Source: "test", Host: "h"}
	line, err := minimal.Encode()
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	var m map[string]any
	if err := json.Unmarshal(line, &m); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	for _, absent := range []string{"user", "process", "target", "access", "file",
		"network", "registry", "tags", "enrichment"} {
		if _, ok := m[absent]; ok {
			t.Fatalf("key %q present on a minimal event (omitempty broken)", absent)
		}
	}
	for _, present := range []string{"id", "timestamp", "type", "source", "host"} {
		if _, ok := m[present]; !ok {
			t.Fatalf("key %q missing on a minimal event", present)
		}
	}
	// nested: a zero-valued PPID is omitted, PID is not
	ppidLine, _ := (&Event{ID: "p-1", Type: TypeProcessCreate, Source: "s", Host: "h",
		Process: &Process{PID: 99}}).Encode()
	var pm map[string]any
	_ = json.Unmarshal(ppidLine, &pm)
	proc := pm["process"].(map[string]any)
	if _, ok := proc["ppid"]; ok {
		t.Fatal("process.ppid present although zero (omitempty broken)")
	}
	if proc["pid"].(float64) != 99 {
		t.Fatalf("process.pid = %v, want 99", proc["pid"])
	}
}

// The type constants are the vocabulary every sensor, rule and consumer
// shares; renaming one silently breaks the ecosystem, so they are
// pinned here.
func TestEventTypeConstants(t *testing.T) {
	want := map[string]string{
		"process.create":    TypeProcessCreate,
		"process.terminate": TypeProcessTerminate,
		"process.access":    TypeProcessAccess,
		"file.write":        TypeFileWrite,
		"network.connect":   TypeNetworkConnect,
		"image.load":        TypeImageLoad,
		"registry.set":      TypeRegistrySet,
	}
	for literal, constant := range want {
		if constant != literal {
			t.Fatalf("type constant %q moved to %q", literal, constant)
		}
	}
}
