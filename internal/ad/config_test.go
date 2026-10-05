package ad

import (
	"encoding/binary"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// validConfig is a minimal configuration every test mutates.
func validConfig(t *testing.T) *Config {
	t.Helper()
	dir := t.TempDir()
	caPath := filepath.Join(dir, "ca.pem")
	if err := os.WriteFile(caPath, []byte("fixture"), 0o600); err != nil {
		t.Fatalf("write ca: %v", err)
	}
	pwPath := filepath.Join(dir, "pwd")
	if err := os.WriteFile(pwPath, []byte("secret\n"), 0o600); err != nil {
		t.Fatalf("write pwd: %v", err)
	}
	return &Config{
		Server:       "dc01.testdom.example.com",
		BaseDN:       "DC=testdom,DC=example,DC=com",
		CAFile:       caPath,
		BindDN:       "CN=soc-reader,OU=Service Accounts,DC=testdom,DC=example,DC=com",
		PasswordFile: pwPath,
	}
}

func TestConfigValidation(t *testing.T) {
	tests := []struct {
		name    string
		mutate  func(*Config)
		wantErr string // empty = must pass
	}{
		{"valid", func(*Config) {}, ""},
		{"no server", func(c *Config) { c.Server = "" }, "server"},
		{"server as URL", func(c *Config) { c.Server = "ldaps://dc01" }, "bare hostname"},
		{"no base dn", func(c *Config) { c.BaseDN = "" }, "base_dn"},
		{"no ca", func(c *Config) { c.CAFile = "" }, "ca_file"},
		{"no bind dn", func(c *Config) { c.BindDN = "" }, "bind_dn"},
		{"bind dn not a dn", func(c *Config) { c.BindDN = "soc-reader" }, "distinguished name"},
		{"no password file", func(c *Config) { c.PasswordFile = "" }, "password_file"},
		{"starttls on 636", func(c *Config) { c.StartTLS, c.Port = true, 636 }, "contradictory"},
		{"starttls on 389", func(c *Config) { c.StartTLS, c.Port = true, 389 }, ""},
		{"interval below minimum", func(c *Config) { c.Interval = time.Minute }, "minimum"},
		{"interval at minimum", func(c *Config) { c.Interval = MinInterval }, ""},
		{"negative interval", func(c *Config) { c.Interval = -time.Minute }, "negative"},
		{"max objects over ceiling", func(c *Config) { c.MaxObjects = DefaultMaxObjects + 1 }, "ceiling"},
		{"page size over ceiling", func(c *Config) { c.PageSize = 1001 }, "ceiling"},
		{"include outside base", func(c *Config) { c.IncludeOUs = []string{"OU=Other,DC=nope,DC=com"} }, "outside base_dn"},
		{"include inside base", func(c *Config) { c.IncludeOUs = []string{"OU=Users,DC=testdom,DC=example,DC=com"} }, ""},
		{"exclude inside base", func(c *Config) { c.ExcludeOUs = []string{"OU=Stale,DC=testdom,DC=example,DC=com"} }, ""},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			c := validConfig(t)
			tc.mutate(c)
			err := c.validate()
			switch {
			case tc.wantErr == "" && err != nil:
				t.Fatalf("expected OK, got: %v", err)
			case tc.wantErr != "" && err == nil:
				t.Fatalf("expected error containing %q, got nil", tc.wantErr)
			case tc.wantErr != "" && !strings.Contains(err.Error(), tc.wantErr):
				t.Fatalf("expected error containing %q, got: %v", tc.wantErr, err)
			}
		})
	}
}

func TestConfigDefaultsAndNormalized(t *testing.T) {
	c := validConfig(t)
	if err := c.validate(); err != nil {
		t.Fatalf("validate: %v", err)
	}
	n := c.normalized()
	if n.Port != 636 {
		t.Errorf("implicit LDAPS default port = %d, want 636", n.Port)
	}
	if n.Interval != 15*time.Minute {
		t.Errorf("interval default = %s, want 15m", n.Interval)
	}
	if n.MaxObjects != DefaultMaxObjects {
		t.Errorf("max objects default = %d, want %d", n.MaxObjects, DefaultMaxObjects)
	}
	if n.PageSize != 500 || n.InactiveDays != 90 || n.KrbtgtMaxAgeDays != 365 {
		t.Errorf("defaults wrong: page=%d inactive=%d krbtgt=%d", n.PageSize, n.InactiveDays, n.KrbtgtMaxAgeDays)
	}
	tlsConfig := validConfig(t)
	tlsConfig.StartTLS = true
	if got := tlsConfig.normalized().Port; got != 389 {
		t.Errorf("StartTLS default port = %d, want 389", got)
	}
}

func TestConfigPasswordRead(t *testing.T) {
	c := validConfig(t)
	pw, err := c.Password()
	if err != nil {
		t.Fatalf("password: %v", err)
	}
	if pw != "secret" {
		t.Errorf("password = %q, want trailing newline trimmed to %q", pw, "secret")
	}
	c.PasswordFile = filepath.Join(t.TempDir(), "missing")
	if _, err := c.Password(); err == nil {
		t.Error("missing password file must fail")
	}
	empty := filepath.Join(t.TempDir(), "empty")
	os.WriteFile(empty, []byte("\n"), 0o600)
	c.PasswordFile = empty
	if _, err := c.Password(); err == nil || !strings.Contains(err.Error(), "empty") {
		t.Errorf("empty password file must fail loudly, got %v", err)
	}
}

func TestSIDString(t *testing.T) {
	// S-1-5-21-100-200-300-512 (Domain Admins of a test domain)
	sid := testSIDText(21, 100, 200, 300, 512)
	if sid != "S-1-5-21-100-200-300-512" {
		t.Fatalf("sidString = %q", sid)
	}
	if rid, ok := ridOf(sid); !ok || rid != 512 {
		t.Errorf("ridOf = %d (%v), want 512", rid, ok)
	}
	if got := domainPrefix(sid); got != "S-1-5-21-100-200-300" {
		t.Errorf("domainPrefix = %q", got)
	}
	if got := sidString([]byte{9, 9}); got != "" {
		t.Errorf("garbage sid must render empty, got %q", got)
	}
}

// testSID builds a Windows SID from its subauthorities and returns
// its BINARY encoding (the form a real directory serves on the wire;
// the connector renders it through sidString at ingest).
func testSID(subs ...uint32) string {
	b := make([]byte, 8)
	b[0] = 1 // revision
	b[1] = byte(len(subs))
	// identifier authority: 48-bit big-endian in the 6 remaining header
	// bytes (S-1-5: decimal 5)
	var auth [8]byte
	binary.BigEndian.PutUint64(auth[:], 5)
	copy(b[2:8], auth[2:8])
	for _, s := range subs {
		var le [4]byte
		binary.LittleEndian.PutUint32(le[:], s)
		b = append(b, le[:]...)
	}
	return string(b)
}

// testSIDText is the canonical text form of the same SID, for
// assertions that want to name a well-known identity.
func testSIDText(subs ...uint32) string {
	return sidString([]byte(testSID(subs...)))
}

func TestFileTime(t *testing.T) {
	at := time.Date(2026, 5, 4, 12, 0, 0, 0, time.UTC)
	ft := (at.Unix() + 11644473600) * 10_000_000
	if got := fileTime(ft); got != at.Unix() {
		t.Errorf("fileTime = %d, want %d", got, at.Unix())
	}
	if got := fileTime(0); got != 0 {
		t.Errorf("fileTime(0) = %d, want 0 (never)", got)
	}
	if got := fileTime(9223372036854775807); got != 0 {
		t.Errorf("fileTime(never sentinel) = %d, want 0", got)
	}
	if got := fileTime(-5); got != 0 {
		t.Errorf("fileTime(negative) = %d, want 0", got)
	}
}

// TestExampleConfigLoads parses the shipped ad.example.yaml with the
// real loader (strict KnownFields on): the documented example can
// never drift from the schema the connector enforces — a key renamed
// in code breaks this test the same day it breaks every operator who
// copied the file.
func TestExampleConfigLoads(t *testing.T) {
	const example = "../../ad.example.yaml"
	c, err := Load(example)
	if err != nil {
		t.Fatalf("the shipped ad.example.yaml must always Load: %v", err)
	}
	n := c.normalized()
	if n.Port != 636 || n.Interval != 15*time.Minute || n.MaxObjects != DefaultMaxObjects || n.PageSize != 500 {
		t.Errorf("example defaults unexpected: port=%d interval=%s max=%d page=%d",
			n.Port, n.Interval, n.MaxObjects, n.PageSize)
	}
	if n.StartTLS {
		t.Error("the example documents implicit LDAPS: start_tls must be false")
	}
}

func TestUnderBase(t *testing.T) {
	base := "DC=corp,DC=example,DC=com"
	cases := []struct {
		dn   string
		want bool
	}{
		{"DC=corp,DC=example,DC=com", true},
		{"CN=ana,OU=Users,DC=corp,DC=example,DC=com", true},
		{"dc=CORP,dc=Example,dc=com", true}, // case-insensitive
		{"DC=corp,DC=example,DC=comX", false},
		{"DC=other,DC=com", false},
	}
	for _, c := range cases {
		if got := underBase(c.dn, base); got != c.want {
			t.Errorf("underBase(%q) = %v, want %v", c.dn, got, c.want)
		}
	}
}
