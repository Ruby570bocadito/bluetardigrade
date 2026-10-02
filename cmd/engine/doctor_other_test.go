//go:build !windows

package main

import (
	"context"
	"testing"
)

func TestDoctorWindowsSensorsOnOtherPlatforms(t *testing.T) {
	for _, sensor := range []string{"auto", "providers", "sysmon", "etw"} {
		checks := platformDoctorChecks(context.Background(), t.TempDir(), sensor)
		if len(checks) != 3 {
			t.Fatalf("sensor %s: got %d checks", sensor, len(checks))
		}
		for i, check := range checks {
			want := "skip"
			if sensor == "sysmon" && i == 0 || sensor == "etw" && i == 2 {
				want = "error"
			}
			if check.Status != want {
				t.Errorf("sensor %s: %+v; want status %s", sensor, check, want)
			}
			if check.Status == "error" && check.Remedy == "" {
				t.Errorf("sensor %s: error has no remedy", sensor)
			}
		}
	}
}
