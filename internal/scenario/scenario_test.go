package scenario

import (
	"os"
	"strings"
	"testing"

	"github.com/Ruby570bocadito/bluetardigrade/internal/alert"
	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
)

func TestLoadFileFillsDefaultsAndMarksSimulation(t *testing.T) {
	dir := t.TempDir()
	path := dir + "/one.yaml"
	content := `
- name: "Volcado de prueba"
  id: "sim-test-dump"
  description: "Secuencia sintetica de prueba."
  host: "LAB-SIM-T1"
  user: "CORP\\sim"
  attack: ["T1003.001"]
  expected:
    - rule: "5b7e1f38-2c94-4d0a-b6e7-19a8c3d54f02"
  events:
    - type: process.create
      process:
        pid: 4104
        name: "rundll32.exe"
        command_line: "rundll32.exe comsvcs.dll, MiniDump 744 C:\\Windows\\Temp\\x.dmp full"
    - type: network.connect
      host: "LAB-SIM-T2"
      network:
        protocol: "tcp"
        destination_ip: "203.0.113.9"
        destination_port: 4444
`
	write(t, path, content)
	list, err := LoadFile(path)
	if err != nil {
		t.Fatalf("LoadFile: %v", err)
	}
	if len(list) != 1 {
		t.Fatalf("expected 1 scenario, got %d", len(list))
	}
	sc := list[0]
	if sc.Origin() != path {
		t.Errorf("origin = %q, want %q", sc.Origin(), path)
	}
	if len(sc.Events) != 2 {
		t.Fatalf("expected 2 events, got %d", len(sc.Events))
	}
	first, second := sc.Events[0].Event, sc.Events[1].Event
	// ids: deterministic per scenario
	if first.ID != "sim-test-dump-0000" || second.ID != "sim-test-dump-0001" {
		t.Errorf("event ids = %q, %q", first.ID, second.ID)
	}
	// command_line survives the JSON round-trip (the wire field names)
	if first.Process == nil || first.Process.CommandLine == "" {
		t.Errorf("command_line lost in decoding: %+v", first.Process)
	}
	// timestamps: staggered, zero-time filled
	if first.Timestamp.IsZero() || second.Timestamp.Before(first.Timestamp) {
		t.Errorf("timestamps not filled in order: %v -> %v", first.Timestamp, second.Timestamp)
	}
	// hosts: default from the scenario, per-event override kept
	if first.Host != "LAB-SIM-T1" || second.Host != "LAB-SIM-T2" {
		t.Errorf("hosts = %q, %q", first.Host, second.Host)
	}
	// users: default from the scenario
	if first.User != `CORP\sim` || second.User != `CORP\sim` {
		t.Errorf("users = %q, %q", first.User, second.User)
	}
	// the simulation tag is owned by the loader
	for i, ev := range []*model.Event{first, second} {
		if !alert.EventIsSimulated(ev) {
			t.Errorf("event %d: simulation tag missing", i)
		}
	}
	if sc.Expected[0].MinOrDefault() != 1 {
		t.Errorf("min default = %d, want 1", sc.Expected[0].MinOrDefault())
	}
}

func TestLoadFileValidation(t *testing.T) {
	cases := []struct {
		name    string
		content string
		wantErr string
	}{
		{
			name: "id shape",
			content: `
- name: "x"
  id: "SIM_uppercase"
  description: "d"
  host: "LAB-SIM-T1"
  expected: [{rule: "r1"}]
  events: [{type: process.create, process: {pid: 1, name: "a.exe"}}]
`,
			wantErr: "id",
		},
		{
			name: "host prefix",
			content: `
- name: "x"
  id: "sim-x"
  description: "d"
  host: "WKS-PROD-01"
  expected: [{rule: "r1"}]
  events: [{type: process.create, process: {pid: 1, name: "a.exe"}}]
`,
			wantErr: "LAB-SIM-",
		},
		{
			name: "event host prefix",
			content: `
- name: "x"
  id: "sim-x"
  description: "d"
  host: "LAB-SIM-T1"
  expected: [{rule: "r1"}]
  events: [{type: process.create, host: "WKS-PROD-01", process: {pid: 1, name: "a.exe"}}]
`,
			wantErr: "LAB-SIM-",
		},
		{
			name: "unknown event type",
			content: `
- name: "x"
  id: "sim-x"
  description: "d"
  host: "LAB-SIM-T1"
  expected: [{rule: "r1"}]
  events: [{type: "kernel.something"}]
`,
			wantErr: "fuera del esquema",
		},
		{
			name: "no expectations",
			content: `
- name: "x"
  id: "sim-x"
  description: "d"
  host: "LAB-SIM-T1"
  events: [{type: process.create, process: {pid: 1, name: "a.exe"}}]
`,
			wantErr: "expected",
		},
		{
			name: "no events",
			content: `
- name: "x"
  id: "sim-x"
  description: "d"
  host: "LAB-SIM-T1"
  expected: [{rule: "r1"}]
`,
			wantErr: "events",
		},
		{
			name: "duplicate expectation",
			content: `
- name: "x"
  id: "sim-x"
  description: "d"
  host: "LAB-SIM-T1"
  expected: [{rule: "r1"}, {rule: "r1"}]
  events: [{type: process.create, process: {pid: 1, name: "a.exe"}}]
`,
			wantErr: "duplicado",
		},
		{
			name: "duplicate id in one file",
			content: `
- name: "x"
  id: "sim-x"
  description: "d"
  host: "LAB-SIM-T1"
  expected: [{rule: "r1"}]
  events: [{type: process.create, process: {pid: 1, name: "a.exe"}}]
- name: "y"
  id: "sim-x"
  description: "d"
  host: "LAB-SIM-T1"
  expected: [{rule: "r1"}]
  events: [{type: process.create, process: {pid: 1, name: "a.exe"}}]
`,
			wantErr: "duplicate id",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			path := t.TempDir() + "/s.yaml"
			write(t, path, tc.content)
			_, err := LoadFile(path)
			if err == nil {
				t.Fatalf("expected an error mentioning %q, got none", tc.wantErr)
			}
			if !strings.Contains(err.Error(), tc.wantErr) {
				t.Fatalf("error %q does not mention %q", err.Error(), tc.wantErr)
			}
		})
	}
}

func TestLoadDirDuplicateIDAcrossFiles(t *testing.T) {
	dir := t.TempDir()
	a := `
- name: "x"
  id: "sim-dup"
  description: "d"
  host: "LAB-SIM-T1"
  expected: [{rule: "r1"}]
  events: [{type: process.create, process: {pid: 1, name: "a.exe"}}]
`
	b := strings.ReplaceAll(a, `"x"`, `"y"`)
	write(t, dir+"/a.yaml", a)
	write(t, dir+"/b.yaml", b)
	if _, err := LoadDir(dir); err == nil || !strings.Contains(err.Error(), "duplicate id") {
		t.Fatalf("expected duplicate id error, got %v", err)
	}
}

func TestCatalogMissingExpectations(t *testing.T) {
	cat := NewCatalog([]string{"rule-a"}, []string{"seq-a"})
	sc := &Scenario{Expected: []Expected{
		{RuleID: "rule-a"},
		{RuleID: "seq-a"},
		{RuleID: "retired-rule"},
	}}
	missing := cat.MissingExpectations(sc)
	if len(missing) != 1 || missing[0] != "retired-rule" {
		t.Fatalf("missing = %v, want [retired-rule]", missing)
	}
	var nilCat *Catalog
	if nilCat.Has("rule-a") {
		t.Error("nil catalog must know nothing")
	}
}

func write(t *testing.T, path, content string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}
