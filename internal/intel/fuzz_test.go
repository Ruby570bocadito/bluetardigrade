package intel

// SEC-7 (fuzzing of the input surfaces): fuzz targets for the local
// threat-intelligence file parser. `go test` runs the seed corpus, so
// anything a fuzz run finds is pinned as a seed for the normal suite.
//
// Properties under fuzz:
//   - parseLine never panics and only returns well-formed indicators:
//     IP values parse back, CIDR values parse back, domains survive
//     normalizeDomain (idempotence), hashes are hex of the allowed
//     lengths.
//   - decodeText never panics and never returns a byte-order mark.
//   - a full directory load over fuzz file content either errors or
//     yields a matcher whose Lists/Totals agree with what it loaded.

import (
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func FuzzParseLine(f *testing.F) {
	f.Add("1.2.3.4")
	f.Add("0.0.0.0 evil.example")
	f.Add("127.0.0.1 localhost.evil # comment")
	f.Add("10.0.0.0/8")
	f.Add("10.0.0.1/8") // CIDR no canónico: bits de host puestos, parseLine lo canoniza
	f.Add("::/0")
	f.Add("evil.example")
	f.Add("*.sub.evil.example")
	f.Add("||adblock.example^")
	f.Add("hxxps://bad.example/path")
	f.Add("https://user:pw@bad.example:8080/x?q=1")
	f.Add("bad.example:8080")
	f.Add("[2001:db8::1]:443")
	f.Add("44d88612fea8a8f36de82e1278abb02f")
	f.Add(`"quoted.example"`)
	f.Add("a[.]b[.]c2.example")
	f.Add("# only a comment")
	f.Add("! adblock comment")
	f.Add("0.0.0.0")
	f.Add("::")
	f.Add("")
	f.Add("\xff\xfe\x00evil.example")
	f.Add(strings.Repeat("a.", 200) + "example")

	f.Fuzz(func(t *testing.T, line string) {
		kind, value := parseLine(line)
		switch kind {
		case "":
			return
		case KindIP:
			ip := net.ParseIP(value)
			if ip == nil {
				t.Fatalf("kind ip with unparseable value %q", value)
			}
			if !usableIP(ip) {
				t.Fatalf("kind ip with noise value %q (loopback/unspecified/multicast)", value)
			}
		case KindNet:
			if _, _, err := net.ParseCIDR(value); err != nil {
				t.Fatalf("kind cidr with unparseable value %q", value)
			}
		case KindDomain:
			if normalizeDomain(value) != value {
				t.Fatalf("kind domain %q is not normalizeDomain-idempotent", value)
			}
		case KindHash:
			if !isHex(value) || (len(value) != 32 && len(value) != 40 && len(value) != 64) {
				t.Fatalf("kind hash with invalid value %q", value)
			}
		default:
			t.Fatalf("unknown kind %q returned by parseLine", kind)
		}
	})
}

func FuzzDecodeText(f *testing.F) {
	f.Add([]byte("1.2.3.4\n"))
	f.Add([]byte{0xEF, 0xBB, 0xBF} /* BOM */)
	f.Add([]byte{0xEF, 0xBB, 0xBF, 'e', '.', 'x'})
	f.Add([]byte{0xFF, 0xFE, 'e', 0, 'v', 0, 'i', 0, 'l', 0, '.', 0, 'e', 0})
	f.Add([]byte{0xFE, 0xFF, 0, 'e', 0, 'v', 0, 'i', 0, 'l'})
	f.Add([]byte{0xFF, 0xFE, 'o', 0}) // odd payload, trailing byte dropped
	// Regression (live fuzzing 2026-10-06): files saved twice carry two
	// BOMs; a UTF-16 payload can also start with a U+FEFF of its own.
	f.Add([]byte{0xFF, 0xFE, 0xFF, 0xFE, '0'})
	f.Add([]byte{0xFE, 0xFF, 0xFE, 0xFF, '0'})
	f.Add([]byte{0xEF, 0xBB, 0xBF, 0xEF, 0xBB, 0xBF, 'e', '.', 'x'})
	f.Add([]byte{0xEF, 0xBB, 0xBF, 0xFF, 0xFE, 'e', 0, 'v', 0}) // UTF-8 BOM then UTF-16
	f.Add([]byte{})

	f.Fuzz(func(t *testing.T, raw []byte) {
		out := decodeText(raw)
		if bytesHasBOM(out) {
			t.Fatalf("decodeText returned a byte-order mark for input %x", raw)
		}
	})
}

func bytesHasBOM(b []byte) bool {
	return len(b) >= 3 && b[0] == 0xEF && b[1] == 0xBB && b[2] == 0xBF
}

// FuzzLoadIntelFile loads one fuzz-written list through the full
// directory path (scan → loadFile → Matcher) with the hosts-file and
// comment grammars in play.
func FuzzLoadIntelFile(f *testing.F) {
	f.Add([]byte("0.0.0.0 evil.example\n1.2.3.4 # tag\n"))
	f.Add([]byte("||ad.example^\n*.wild.example\n::1\n"))
	f.Add([]byte(strings.Repeat("10.0.0.0/8\n", 100)))
	f.Add([]byte{0xFF, 0xFE, 'e', 0, 'v', 0, 'i', 0, 'l', 0, '.', 0, 'e', 0, '\n', 0})
	f.Add([]byte("bad.example;semicolon\nbad2.example,tick\n"))

	f.Fuzz(func(t *testing.T, data []byte) {
		dir := t.TempDir()
		path := filepath.Join(dir, "fuzz.list")
		if err := os.WriteFile(path, data, 0o600); err != nil {
			t.Skip()
		}
		m, err := Load(dir)
		if err != nil {
			return
		}
		for _, l := range m.Lists() {
			total := 0
			for _, n := range l.ByKind {
				total += n
			}
			if total != l.Indicators {
				t.Fatalf("list %q: by-kind total %d != indicators %d", l.Name, total, l.Indicators)
			}
		}
		if t.Failed() {
			return
		}
		// A loaded matcher must answer a match request without panic,
		// whatever it loaded.
		m.Match(nil)
	})
}
