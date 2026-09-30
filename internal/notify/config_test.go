package notify

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeCfg(t *testing.T, content string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "notify.yaml")
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}
	return path
}

func TestLoadBuildsAllChannelTypes(t *testing.T) {
	path := writeCfg(t, `
channels:
  - type: slack
    name: soc
    url: https://hooks.slack.com/services/T000/B000/XXXX
  - type: telegram
    token: "12345:ABCDE"
    chat_id: "-100123"
  - type: email
    server: relay.lab.test:2525
    from: sf@lab.test
    to: ["soc@lab.test"]
    starttls: false
`)
	s, err := Load(path)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	stats := s.Stats()
	if len(stats) != 3 {
		t.Fatalf("channels = %d, want 3", len(stats))
	}
	// Stats are sorted by name: email < soc < telegram.
	if stats[0].Name != "email" || stats[1].Name != "soc" || stats[2].Name != "telegram" {
		t.Fatalf("names/sort wrong: %v", stats)
	}
	if stats[0].Type != "email" || stats[1].Type != "slack" || stats[2].Type != "telegram" {
		t.Fatalf("types wrong: %v", stats)
	}
}

func TestLoadFailsLoudOnBrokenConfigs(t *testing.T) {
	cases := map[string]string{
		"no channels":        "channels: []\n",
		"empty file":         "",
		"unknown type":       "channels:\n  - type: pigeon\n    url: http://x\n",
		"bad slack url":      "channels:\n  - type: slack\n    url: not-a-url\n",
		"slack missing url":  "channels:\n  - type: slack\n    name: s\n",
		"tg missing chat":    "channels:\n  - type: telegram\n    token: t\n",
		"tg missing token":   "channels:\n  - type: telegram\n    chat_id: \"1\"\n",
		"tg token_env unset": "channels:\n  - type: telegram\n    token_env: SF_TEST_MISSING_ENV\n    chat_id: \"1\"\n",
		"tg token both":      "channels:\n  - type: telegram\n    token: t\n    token_env: SF_TEST_ANY\n    chat_id: \"1\"\n",
		"email bad server":   "channels:\n  - type: email\n    server: no-port\n    from: a@b\n    to: [c@d]\n",
		"email no to":        "channels:\n  - type: email\n    server: h:25\n    from: a@b\n",
		"email user alone":   "channels:\n  - type: email\n    server: h:25\n    from: a@b\n    to: [c@d]\n    username: u\n",
		"email from newline": "channels:\n  - type: email\n    server: h:25\n    from: \"a@b\\r\\nX: y\"\n    to: [c@d]\n",
		"bad min_severity":   "channels:\n  - type: slack\n    url: https://h/x\n    min_severity: extreme\n",
		"duplicate name":     "channels:\n  - type: slack\n    url: https://h/a\n  - type: slack\n    url: https://h/b\n",
	}
	for name, cfg := range cases {
		path := writeCfg(t, cfg)
		if _, err := Load(path); err == nil {
			t.Fatalf("%s: Load succeeded, want fail-loud", name)
		}
	}
}

func TestLoadRejectsOversizedFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "big.yaml")
	big := make([]byte, maxFileBytes+1)
	if err := os.WriteFile(path, big, 0o600); err != nil {
		t.Fatalf("write: %v", err)
	}
	_, err := Load(path)
	if err == nil || !strings.Contains(err.Error(), "cap") {
		t.Fatalf("oversized config must be refused with the cap named, got: %v", err)
	}
}

func TestLoadResolvesSecretsFromEnvironment(t *testing.T) {
	t.Setenv("SF_NOTIFY_TEST_TOKEN", "env-token-value")
	path := writeCfg(t, `
channels:
  - type: telegram
    token_env: SF_NOTIFY_TEST_TOKEN
    chat_id: "-1"
`)
	s, err := Load(path)
	if err != nil {
		t.Fatalf("Load with token_env: %v", err)
	}
	tg := s.workers[0].ch.(*Telegram)
	if tg.token != "env-token-value" {
		t.Fatalf("token not resolved from environment: %q", tg.token)
	}
}

func TestLoadCapsChannelCount(t *testing.T) {
	var b strings.Builder
	b.WriteString("channels:\n")
	for i := 0; i <= MaxChannels; i++ {
		b.WriteString("  - type: slack\n    name: ch" + string(rune('a'+i)) + "\n    url: https://h/x\n")
	}
	path := writeCfg(t, b.String())
	_, err := Load(path)
	if err == nil || !strings.Contains(err.Error(), "cap") {
		t.Fatalf("cap must fail loud, got: %v", err)
	}
}

func TestLoadMinSeverityFloors(t *testing.T) {
	path := writeCfg(t, `
channels:
  - type: slack
    name: only-critical
    url: https://h/x
    min_severity: critical
`)
	s, err := Load(path)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if s.workers[0].minSev != rankCritical {
		t.Fatalf("minSev = %d, want %d", s.workers[0].minSev, rankCritical)
	}
	if s.workers[0].typ != "slack" {
		t.Fatalf("typ = %q", s.workers[0].typ)
	}
}
