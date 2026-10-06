package intel

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
)

func writeList(t *testing.T, dir, name, body string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestParseLineUnderstandsCommonFeedFormats(t *testing.T) {
	cases := map[string][2]string{
		"185.220.101.47":                       {KindIP, "185.220.101.47"},
		"  185.220.101.0/24 # tor exit range":  {KindNet, "185.220.101.0/24"},
		"0.0.0.0 evil-cdn.example.com":         {KindDomain, "evil-cdn.example.com"},
		"127.0.0.1\tbad.example.org":           {KindDomain, "bad.example.org"},
		"https://Mal.Example.net:8443/x/p.exe": {KindDomain, "mal.example.net"},
		"http://203.0.113.9/payload":           {KindIP, "203.0.113.9"},
		strings.Repeat("A", 64):                {KindHash, strings.Repeat("a", 64)},
		"d41d8cd98f00b204e9800998ecf8427e":     {KindHash, "d41d8cd98f00b204e9800998ecf8427e"},
		"Evil.Example.COM.":                    {KindDomain, "evil.example.com"},
		"203.0.113.9:443":                      {KindIP, "203.0.113.9"},
		"[2001:db8::7]:8443":                   {KindIP, "2001:db8::7"},
		"c2.example.net:8080":                  {KindDomain, "c2.example.net"},
		"evil[.]example[.]com":                 {KindDomain, "evil.example.com"},
		"hxxps://bad[.]example.org/drop.exe":   {KindDomain, "bad.example.org"},
		"198.51.100[.]14":                      {KindIP, "198.51.100.14"},
		"||ads.example.com^":                   {KindDomain, "ads.example.com"},
		"||tracker.example.com^$third-party":   {KindDomain, "tracker.example.com"},
		"*.wild.example.com":                   {KindDomain, "wild.example.com"},
	}
	for line, want := range cases {
		kind, value := parseLine(line)
		if kind != want[0] || value != want[1] {
			t.Fatalf("%q -> %s %s, want %v", line, kind, value, want)
		}
	}
	for _, noise := range []string{"", "# comment", "; comment", "127.0.0.1", "0.0.0.0", "localhost", "not a domain", "169.254.1.1", "ff02::1", "127.0.0.1:80", "||^", "! Title: lista", "@@||allowed.example.com^"} {
		if kind, _ := parseLine(noise); kind != "" {
			t.Fatalf("%q must be skipped, got %s", noise, kind)
		}
	}
}

func TestMatchIPsNetsDomainsAndHashes(t *testing.T) {
	dir := t.TempDir()
	writeList(t, dir, "feodo.txt", "# Feodo\n185.220.101.47\n198.51.100.0/24\n")
	writeList(t, dir, "urlhaus.txt", "0.0.0.0 evil.example.com\n")
	writeList(t, dir, "bazaar.list", strings.Repeat("b", 64)+"\n")
	writeList(t, dir, "ignored.csv", "203.0.113.1\n")
	m, err := Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	if m.Total() != 4 || len(m.Lists()) != 3 {
		t.Fatalf("loaded %d indicators in %d lists", m.Total(), len(m.Lists()))
	}
	ev := &model.Event{Host: "PC", Type: "network.connect", Network: &model.Network{DestinationIP: "185.220.101.47", Domain: "cdn.evil.example.com"}}
	hits := m.Match(ev)
	if len(hits) != 2 || hits[0].List != "feodo" || hits[0].Field != "network.destination_ip" || hits[1].List != "urlhaus" || hits[1].Value != "evil.example.com" {
		t.Fatalf("hits: %+v", hits)
	}
	inNet := m.Match(&model.Event{Network: &model.Network{DestinationIP: "198.51.100.77"}})
	if len(inNet) != 1 || inNet[0].Kind != KindNet {
		t.Fatalf("cidr: %+v", inNet)
	}
	hash := m.Match(&model.Event{Type: "process.create", Process: &model.Process{Name: "x.exe", Hashes: model.Hashes{"sha256": strings.Repeat("B", 64)}}})
	if len(hash) != 1 || hash[0].Kind != KindHash || hash[0].Field != "process.hashes" {
		t.Fatalf("hash: %+v", hash)
	}
	if len(m.Match(&model.Event{Network: &model.Network{DestinationIP: "8.8.8.8", Domain: "example.com"}})) != 0 {
		t.Fatal("clean traffic must not match")
	}
}

func TestReloadOnlyWhenFilesChange(t *testing.T) {
	dir := t.TempDir()
	writeList(t, dir, "a.txt", "203.0.113.5\n")
	m, err := Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	if changed, _ := m.Reload(); changed {
		t.Fatal("nothing changed")
	}
	writeList(t, dir, "b.txt", "203.0.113.6\n")
	if changed, err := m.Reload(); !changed || err != nil || m.Total() != 2 {
		t.Fatalf("new file not loaded: %v %v %d", changed, err, m.Total())
	}
	missing, err := Load(filepath.Join(dir, "nope"))
	if err != nil || missing.Total() != 0 {
		t.Fatalf("a missing directory is an empty matcher: %v", err)
	}
}

func TestAllowAppliesACooldownPerIndicatorAndHost(t *testing.T) {
	m := &Matcher{lastSeen: map[string]time.Time{}}
	h := Hit{List: "feodo", Value: "185.220.101.47"}
	t0 := time.Now()
	if !m.Allow(h, "PC-01", t0) || m.Allow(h, "pc-01", t0.Add(time.Minute)) {
		t.Fatal("the same indicator on the same host alerts once per cooldown")
	}
	if !m.Allow(h, "PC-02", t0.Add(time.Minute)) {
		t.Fatal("another host is another alert")
	}
	if !m.Allow(h, "PC-01", t0.Add(cooldown+time.Second)) {
		t.Fatal("after the cooldown it alerts again")
	}
}

func TestABadListLeavesAnEmptyMatcherThatRetries(t *testing.T) {
	dir := t.TempDir()
	writeList(t, dir, "bad.txt", strings.Repeat("x", maxLineBytes+10)+"\n")
	m, err := Load(dir)
	if err == nil || m == nil || m.Total() != 0 {
		t.Fatalf("a bad list is an error with a usable empty matcher: %v %v", err, m)
	}
	writeList(t, dir, "bad.txt", "203.0.113.9\n")
	if changed, err := m.Reload(); !changed || err != nil || m.Total() != 1 {
		t.Fatalf("the fixed list loads on the next reload: %v %v %d", changed, err, m.Total())
	}
}

func TestWindowsEncodingsAreRead(t *testing.T) {
	dir := t.TempDir()
	// UTF-8 with BOM (PowerShell 5 Set-Content -Encoding UTF8)
	writeList(t, dir, "bom.txt", "\xEF\xBB\xBF203.0.113.21\r\nmal.example.com\r\n")
	// UTF-16 LE with BOM (PowerShell 5 '>' redirection)
	utf16le := []byte{0xFF, 0xFE}
	for _, r := range "203.0.113.22\r\nc2.example.net\r\n" {
		utf16le = append(utf16le, byte(r), 0)
	}
	if err := os.WriteFile(filepath.Join(dir, "utf16.txt"), utf16le, 0o600); err != nil {
		t.Fatal(err)
	}
	m, err := Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	for _, l := range m.Lists() {
		if l.Indicators != 2 || l.Skipped != 0 {
			t.Fatalf("%s: %d indicators, %d skipped", l.File, l.Indicators, l.Skipped)
		}
	}
	if len(m.Match(&model.Event{Network: &model.Network{DestinationIP: "203.0.113.21"}})) != 1 ||
		len(m.Match(&model.Event{Network: &model.Network{Domain: "www.c2.example.net"}})) != 1 {
		t.Fatal("indicators from BOM and UTF-16 files must match")
	}
}

// Regression (SEC-7 fuzzing): a lone trailing dot was
// stripped with TrimSuffix, so malformed input like "000.." normalized
// to the degenerate domain "000." — non-idempotent, and a list entry
// "abc.." became a loadable indicator that a hostile event domain
// "x.abc.." (same normalization hole) could reach through the suffix
// walk in Match and forge an intel hit. Normalization now strips every
// trailing dot on BOTH sides (list lines and event domains), so parsing
// is idempotent and consistent: legitimate root-dot FQDNs load, dot-only
// junk is rejected.
func TestNormalizeDomainStripsEveryTrailingDot(t *testing.T) {
	if d := normalizeDomain("evil.example.com."); d != "evil.example.com" {
		t.Fatalf("root-dot FQDN must normalize to itself without the dot, got %q", d)
	}
	// Idempotence: normalizing twice changes nothing.
	for _, in := range []string{"evil.example.com.", "x.abc..", "000..", "...."} {
		once := normalizeDomain(in)
		if once != "" && normalizeDomain(once) != once {
			t.Fatalf("normalizeDomain(%q) = %q is not idempotent", in, once)
		}
	}
	for _, junk := range []string{"000..", "abc..", "...."} {
		if kind, value := parseLine(junk); kind != "" {
			t.Fatalf("parseLine(%q) = (%q, %q): degenerate dot-only input must not load", junk, kind, value)
		}
	}
	// End to end: the junk list entry must not be loadable, so no
	// hostile event domain can walk its suffixes onto it.
	dir := t.TempDir()
	writeList(t, dir, "junk.txt", "abc..\n")
	m, err := Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	if m.Total() != 0 {
		t.Fatalf("junk domain entry loaded as an indicator (total %d)", m.Total())
	}
	if hits := m.Match(&model.Event{Network: &model.Network{Domain: "x.abc.."}}); len(hits) != 0 {
		t.Fatalf("hostile event domain forged an intel hit: %+v", hits)
	}
}
