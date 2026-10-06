package ad

import (
	"context"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// The probe tests reuse the loopback fixture: no domain, no network
// beyond 127.0.0.1, no third-party binaries (the AD-1 test contract).

func TestProbeReadsFixtureDirectory(t *testing.T) {
	s, caPath, _ := newFixtureServer(t, testEntries(t), true)
	t.Cleanup(s.close)

	cfg := validConfig(t)
	cfg.Server = "localhost"
	cfg.Port = s.listener.Addr().(*net.TCPAddr).Port
	cfg.CAFile = caPath
	cfg.BaseDN = fixtureBase
	cfg.BindDN = s.bindDN
	cfg.PasswordFile = passwordPath(t, syncPW)

	res := Probe(context.Background(), cfg, []byte(syncPW))
	if !res.OK {
		t.Fatalf("probe not ok: %s", res.Error)
	}
	if res.TLSVersion == "" || !strings.HasPrefix(res.TLSVersion, "TLS ") {
		t.Fatalf("tls_version %q, want a TLS 1.x name (LDAPS state must travel)", res.TLSVersion)
	}
	if res.CipherSuite == "" {
		t.Fatalf("cipher_suite empty on an LDAPS probe")
	}
	if res.BindDN != cfg.BindDN || res.BaseDN != fixtureBase {
		t.Fatalf("probe echoed bind/base differently: %+v", res)
	}
	if len(res.Kinds) != 4 {
		t.Fatalf("kinds=%d, want the 4 object kinds", len(res.Kinds))
	}
	seen := map[string]ProbeKind{}
	for _, k := range res.Kinds {
		seen[k.Kind] = k
		if k.Count <= 0 {
			t.Fatalf("kind %s read %d entries, want >0", k.Kind, k.Count)
		}
		if len(k.SampleDNS) == 0 || len(k.SampleDNS) > probeSampleDNS {
			t.Fatalf("kind %s sampled %d DNs, want 1..%d", k.Kind, len(k.SampleDNS), probeSampleDNS)
		}
		for _, dn := range k.SampleDNS {
			if !strings.HasSuffix(dn, fixtureBase) {
				t.Fatalf("sample DN %q outside the fixture base", dn)
			}
		}
	}
	for _, kind := range []string{"user", "group", "computer", "ou"} {
		if _, ok := seen[kind]; !ok {
			t.Fatalf("kind %s missing from the probe result", kind)
		}
	}
	// The probe must have bound as the service account, never anonymous.
	attempts := s.bindAttempts()
	if len(attempts) == 0 {
		t.Fatalf("the fixture saw no bind attempt")
	}
	last := attempts[len(attempts)-1]
	if last[0] != s.bindDN || last[1] != syncPW {
		t.Fatalf("probe bound as %q, want the configured service account (and never anonymous)", last[0])
	}
	if res.DurationMS < 0 {
		t.Fatalf("negative duration")
	}
}

func TestProbeWrongPasswordIsAVerdictNotAnError(t *testing.T) {
	s, caPath, _ := newFixtureServer(t, testEntries(t), true)
	t.Cleanup(s.close)

	cfg := validConfig(t)
	cfg.Server = "localhost"
	cfg.Port = s.listener.Addr().(*net.TCPAddr).Port
	cfg.CAFile = caPath
	cfg.BaseDN = fixtureBase
	cfg.BindDN = s.bindDN
	cfg.PasswordFile = passwordPath(t, syncPW)

	res := Probe(context.Background(), cfg, []byte("totally wrong"))
	if res.OK {
		t.Fatalf("probe ok with a wrong password")
	}
	if res.Error == "" || strings.Contains(res.Error, "totally wrong") {
		t.Fatalf("error %q must be present and credential-free", res.Error)
	}
	if res.TLSVersion == "" {
		t.Fatalf("the LDAPS handshake succeeded before the bind failed; the TLS state must still travel")
	}
}

func TestProbeInvalidConfigIsAVerdict(t *testing.T) {
	cfg := validConfig(t)
	cfg.BaseDN = "not a dn"
	res := Probe(context.Background(), cfg, []byte(syncPW))
	if res.OK {
		t.Fatalf("probe ok with an invalid config")
	}
	if !strings.Contains(res.Error, "configuration invalid") {
		t.Fatalf("error %q, want the configuration-invalid verdict", res.Error)
	}
}

func TestProbeWorksWithoutReadingAnythingSensitive(t *testing.T) {
	// The minimal-attribute search means the probe result never carries
	// directory attribute values: sample DNs only. Assert that shape on
	// the fixture.
	s, caPath, _ := newFixtureServer(t, testEntries(t), true)
	t.Cleanup(s.close)
	cfg := validConfig(t)
	cfg.Server = "localhost"
	cfg.Port = s.listener.Addr().(*net.TCPAddr).Port
	cfg.CAFile = caPath
	cfg.BaseDN = fixtureBase
	cfg.BindDN = s.bindDN
	cfg.PasswordFile = passwordPath(t, syncPW)
	res := Probe(context.Background(), cfg, []byte(syncPW))
	if !res.OK {
		t.Fatalf("probe not ok: %s", res.Error)
	}
	for _, k := range res.Kinds {
		if k.Cap != probeSampleCap {
			t.Fatalf("kind %s cap %d, want %d", k.Kind, k.Cap, probeSampleCap)
		}
	}
}

func TestConfigWriteFileRoundTrip(t *testing.T) {
	cfg := validConfig(t)
	cfg.Interval = 20 * time.Minute
	cfg.InactiveDays = 60
	cfg.KrbtgtMaxAgeDays = 400
	cfg.WorkStart = "08:30"
	cfg.WorkEnd = "17:45"
	cfg.WorkDays = []int{1, 2, 3, 4, 5}

	path := filepath.Join(t.TempDir(), "ad-config.yaml")
	if err := cfg.WriteFile(path); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat: %v", err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("config file mode %o, want 0600", info.Mode().Perm())
	}
	loaded, err := Load(path)
	if err != nil {
		t.Fatalf("the written config must load with the strict loader: %v", err)
	}
	n := loaded.normalized()
	if n.Interval != cfg.Interval {
		t.Fatalf("interval %s, want %s", n.Interval, cfg.Interval)
	}
	if n.InactiveDays != 60 || n.KrbtgtMaxAgeDays != 400 {
		t.Fatalf("thresholds drifted through the file: %+v", n)
	}
	if n.WorkStart != "08:30" || n.WorkEnd != "17:45" {
		t.Fatalf("work window drifted: %+v", n)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read back: %v", err)
	}
	if strings.Contains(string(raw), syncPW) {
		t.Fatalf("the written YAML contains the credential: the secret must never share the config file")
	}
	// The interval renders as a duration string, the way humans edit it.
	if !strings.Contains(string(raw), "20m") {
		t.Fatalf("interval not rendered as a duration string:\n%s", raw)
	}
}

func TestWorkHoursValidation(t *testing.T) {
	cases := []struct {
		name    string
		start   string
		end     string
		days    []int
		wantErr string
	}{
		{"unset", "", "", nil, ""},
		{"window only", "08:00", "18:00", nil, ""},
		{"window and days", "08:00", "18:00", []int{1, 2, 3, 4, 5}, ""},
		{"half window", "08:00", "", nil, "configured together"},
		{"half window 2", "", "18:00", nil, "configured together"},
		{"start after end", "19:00", "08:00", nil, "not before"},
		{"equal", "08:00", "08:00", nil, "not before"},
		{"bad format", "8:5", "18:00", nil, "HH:MM"},
		{"hour out of range", "25:00", "26:00", nil, "HH:MM"},
		{"day out of range", "08:00", "18:00", []int{7}, "out of range"},
		{"negative day", "08:00", "18:00", []int{-1}, "out of range"},
		{"repeated day", "08:00", "18:00", []int{1, 1}, "repeated"},
		{"days without window", "", "", []int{1}, "configure the window first"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			cfg := validConfig(t)
			cfg.WorkStart, cfg.WorkEnd, cfg.WorkDays = tc.start, tc.end, tc.days
			err := cfg.Validate()
			if tc.wantErr == "" {
				if err != nil {
					t.Fatalf("unexpected error: %v", err)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), tc.wantErr) {
				t.Fatalf("error %v, want it to contain %q", err, tc.wantErr)
			}
		})
	}
}

// TestNormalizedWorkDaysDefault pins the Monday-Friday default: a
// window without an explicit weekday list is Mon-Fri, never "every
// day" (a default that flags night logins on Saturdays is a default
// that cries wolf).
func TestNormalizedWorkDaysDefault(t *testing.T) {
	cfg := validConfig(t)
	cfg.WorkStart, cfg.WorkEnd, cfg.WorkDays = "08:00", "18:00", nil
	n := cfg.normalized()
	if len(n.WorkDays) != 5 || n.WorkDays[0] != 1 || n.WorkDays[4] != 5 {
		t.Fatalf("work_days default %v, want Mon-Fri", n.WorkDays)
	}
	if err := n.validateWorkHours(); err != nil {
		t.Fatalf("the normalized config must pass its own validation: %v", err)
	}
}
