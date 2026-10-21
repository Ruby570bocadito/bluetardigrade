package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeNotifyConfig(t *testing.T, content string) string {
	t.Helper()
	root := t.TempDir()
	dir := filepath.Join(root, "tools", "config")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatalf("tools/config: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "notify.yaml"), []byte(content), 0o600); err != nil {
		t.Fatalf("notify.yaml: %v", err)
	}
	return root
}

func TestDoctorNotifyMissingFileIsSkipWithRemedy(t *testing.T) {
	checks := doctorNotifyChecks(t.TempDir())
	if len(checks) != 1 {
		t.Fatalf("got %d checks, want 1", len(checks))
	}
	c := checks[0]
	if c.Status != "skip" {
		t.Fatalf("status = %q, want skip (a missing file is a valid off state)", c.Status)
	}
	if !strings.Contains(c.Remedy, "notify.example.yaml") {
		t.Fatalf("remedy %q must point at the example config", c.Remedy)
	}
}

func TestDoctorNotifyUnknownTypeIsError(t *testing.T) {
	root := writeNotifyConfig(t, "channels:\n  - type: pagerduty\n")
	checks := doctorNotifyChecks(root)
	if len(checks) != 1 {
		t.Fatalf("got %d checks, want 1", len(checks))
	}
	c := checks[0]
	if c.Status != "error" {
		t.Fatalf("status = %q, want error (the engine would stop at startup)", c.Status)
	}
	if !strings.Contains(c.Detail, "unknown type") {
		t.Fatalf("detail %q must name the problem the engine would fail with", c.Detail)
	}
}

func TestDoctorNotifyValidConfigIsOkWithoutSending(t *testing.T) {
	root := writeNotifyConfig(t, "channels:\n  - type: slack\n    name: soc\n    url: https://hooks.slack.com/services/T000/B000/XXXX\n")
	checks := doctorNotifyChecks(root)
	c := checks[0]
	if c.Status != "ok" {
		t.Fatalf("status = %q (detail %q), want ok", c.Status, c.Detail)
	}
	if !strings.Contains(c.Detail, "1 canal") {
		t.Fatalf("detail %q must report the channel count", c.Detail)
	}
}

func TestDoctorNotifyErrorDoesNotDiscloseSecrets(t *testing.T) {
	// A webhook URL embeds its own secret and a telegram token is a
	// credential: whatever Load rejects, the doctor report may only name
	// scheme://host (or the <endpoint> placeholder), never the secret.
	root := writeNotifyConfig(t, "channels:\n"+
		"  - type: slack\n    url: ftp://hooks.slack.com/services/T000/B000/SECRETVALUE\n"+
		"  - type: telegram\n    token: TOKENSECRETVALUE\n")
	checks := doctorNotifyChecks(root)
	if len(checks) != 1 {
		t.Fatalf("got %d checks, want 1", len(checks))
	}
	c := checks[0]
	if c.Status != "error" {
		t.Fatalf("status = %q, want error", c.Status)
	}
	for _, secret := range []string{"SECRETVALUE", "TOKENSECRETVALUE", "hooks.slack.com/services"} {
		if strings.Contains(c.Detail, secret) {
			t.Fatalf("detail %q discloses %q", c.Detail, secret)
		}
	}
	if !strings.Contains(c.Detail, "ftp://hooks.slack.com") {
		t.Fatalf("detail %q must keep the scheme://host label to locate the channel", c.Detail)
	}
}
