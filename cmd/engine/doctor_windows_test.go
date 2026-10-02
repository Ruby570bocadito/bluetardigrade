//go:build windows

package main

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDoctorSysmonStates(t *testing.T) {
	tests := []struct {
		name     string
		sensor   string
		response string
		log      string
		access   string
	}{
		{"readable", "sysmon", `{"exists":"present","access":"readable","enabled":true}`, "ok", "ok"},
		{"empty permits access", "sysmon", `{"exists":"present","access":"empty","enabled":true}`, "ok", "ok"},
		{"disabled", "sysmon", `{"exists":"present","access":"readable","enabled":false}`, "error", "ok"},
		{"auto disabled", "auto", `{"exists":"present","access":"readable","enabled":false}`, "warn", "ok"},
		{"missing required", "sysmon", `{"exists":"missing","access":"unknown","enabled":null}`, "error", "skip"},
		{"missing auto", "auto", `{"exists":"missing","access":"unknown","enabled":null}`, "warn", "skip"},
		{"record access denied", "sysmon", `{"exists":"present","access":"denied","enabled":true}`, "ok", "error"},
		{"auto access denied", "auto", `{"exists":"present","access":"denied","enabled":true}`, "ok", "warn"},
		{"metadata access denied", "sysmon", `{"exists":"unknown","access":"denied","enabled":null}`, "error", "error"},
		{"unknown record access", "sysmon", `{"exists":"present","access":"unknown","enabled":true}`, "ok", "error"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			probe := func(context.Context) (doctorSysmonState, error) {
				return parseDoctorSysmonState([]byte(tt.response))
			}
			checks := platformDoctorChecksWithProbe(context.Background(), t.TempDir(), tt.sensor, probe)
			if len(checks) != 3 || checks[0].Status != tt.log || checks[1].Status != tt.access {
				t.Fatalf("checks = %+v; want log %s, access %s", checks, tt.log, tt.access)
			}
			for _, check := range checks {
				if check.Status == "error" && check.Remedy == "" {
					t.Fatalf("missing remedy for %+v", check)
				}
			}
		})
	}
}

func TestDoctorSysmonProbeFailures(t *testing.T) {
	for _, sensor := range []string{"auto", "sysmon"} {
		for _, err := range []error{context.DeadlineExceeded, context.Canceled, errors.New("private native error content")} {
			probe := func(context.Context) (doctorSysmonState, error) { return doctorSysmonState{}, err }
			checks := platformDoctorChecksWithProbe(context.Background(), t.TempDir(), sensor, probe)
			want := "warn"
			if sensor == "sysmon" {
				want = "error"
			}
			if checks[0].Status != want || checks[1].Status != "skip" {
				t.Fatalf("sensor %s: unexpected checks %+v", sensor, checks)
			}
			if strings.Contains(checks[0].Detail, "private") {
				t.Fatal("native errors must not expose raw diagnostic output")
			}
		}
	}
}

func TestDoctorETWInstallationAndProviderModes(t *testing.T) {
	probe := func(context.Context) (doctorSysmonState, error) {
		t.Fatal("Sysmon must not be probed when selecting another sensor")
		return doctorSysmonState{}, nil
	}
	root := t.TempDir()
	checks := platformDoctorChecksWithProbe(context.Background(), root, "etw", probe)
	if checks[0].Status != "skip" || checks[1].Status != "skip" || checks[2].Status != "error" {
		t.Fatalf("missing ETW binary: %+v", checks)
	}
	bin := filepath.Join(root, "bin")
	if err := os.Mkdir(bin, 0o755); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(bin, "security-sensor.exe")
	if err := os.Mkdir(path, 0o755); err != nil {
		t.Fatal(err)
	}
	if checks := platformDoctorChecksWithProbe(context.Background(), root, "etw", probe); checks[2].Status != "error" {
		t.Fatalf("directory cannot satisfy a binary check: %+v", checks)
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	// A file proves installation only. No fixture executable is launched.
	if err := os.WriteFile(path, []byte("fixture"), 0o600); err != nil {
		t.Fatal(err)
	}
	checks = platformDoctorChecksWithProbe(context.Background(), root, "etw", probe)
	if checks[2].Status != "ok" || !strings.Contains(checks[2].Detail, "Solo se comprueba la instalacion") {
		t.Fatalf("ETW binary result must explain its limits: %+v", checks)
	}
	for _, check := range platformDoctorChecksWithProbe(context.Background(), root, "providers", probe) {
		if check.Status != "skip" {
			t.Fatalf("provider mode: unexpected local sensor check %+v", check)
		}
	}
}

func TestParseDoctorSysmonRejectsMalformedOutput(t *testing.T) {
	invalid := []string{
		``,
		`native warning {"exists":"missing","access":"unknown","enabled":null}`,
		`{"exists":"missing","access":"unknown","enabled":null} {}`,
		`{"exists":"present","access":"readable"}`,
		`{"exists":"present","access":"invented","enabled":true}`,
		`{"exists":"unknown","access":"readable","enabled":null}`,
		`{"exists":"missing","access":"denied","enabled":null}`,
		`{"exists":"missing","access":"unknown","enabled":false}`,
		`{"exists":"missing","access":"unknown","enabled":null,"event":"private"}`,
		strings.Repeat("x", doctorSysmonProbeLimit+1),
	}
	for _, input := range invalid {
		if _, err := parseDoctorSysmonState([]byte(input)); err == nil {
			t.Errorf("accepted malformed probe output (length %d)", len(input))
		}
	}
	if _, err := parseDoctorSysmonState([]byte("\xef\xbb\xbf" + `{"exists":"present","access":"empty","enabled":true}`)); err != nil {
		t.Fatalf("PowerShell BOM: %v", err)
	}
}

func TestDoctorProbeOutputIsBounded(t *testing.T) {
	buffer := &doctorProbeBuffer{}
	written, err := io.Copy(buffer, strings.NewReader(strings.Repeat("x", doctorSysmonProbeLimit*3)))
	if err != nil || written != doctorSysmonProbeLimit*3 {
		t.Fatalf("probe output must continue draining: n=%d, err=%v", written, err)
	}
	if buffer.buffer.Len() != doctorSysmonProbeLimit || !buffer.truncated {
		t.Fatalf("probe buffer length=%d, truncated=%v", buffer.buffer.Len(), buffer.truncated)
	}
}

func TestDoctorSysmonCanceledContext(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := probeDoctorSysmon(ctx); !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled context should not launch PowerShell: %v", err)
	}
}
