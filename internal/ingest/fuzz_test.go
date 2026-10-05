package ingest

// SEC-7 (fuzzing of the input surfaces): native Go fuzz targets for
// the ingest boundary. Every target doubles as a unit test: `go test`
// runs the seed corpus, so a regression found by a fuzz run is pinned
// as a seed and fails the ordinary suite afterwards.
//
// Properties under fuzz:
//   - decode() never panics on arbitrary bytes; when it succeeds the
//     event passes Validate and the boundary invariants hold (field
//     separator stripped from every haystack field, identity fields
//     within their rune caps).
//   - LoadIdentities never panics on arbitrary file content; when it
//     succeeds the identities are self-consistent (non-empty reserved-
//     name-free names, digest lookup round-trips through
//     matchIdentity).

import (
	"encoding/json"
	"errors"
	"io"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func FuzzDecode(f *testing.F) {
	// Happy paths: every subsystem of the event schema.
	f.Add([]byte(`{"id":"a1","timestamp":"2026-01-02T03:04:05Z","type":"process.create","source":"etw","host":"WS01","user":"alice","process":{"pid":100,"ppid":50,"name":"cmd.exe","command_line":"cmd /c dir","image":"C:\\Windows\\cmd.exe","hashes":{"sha256":"aa"}}}`))
	f.Add([]byte(`{"id":"a2","timestamp":"2026-01-02T03:04:05.123456789+02:00","type":"network.connect","source":"sensor","host":"WS01","network":{"protocol":"tcp","source_ip":"10.0.0.1","source_port":1234,"destination_ip":"93.184.216.34","destination_port":443,"domain":"example.com"}}`))
	f.Add([]byte(`{"id":"a3","type":"file.write","source":"sensor","host":"WS01","file":{"path":"C:\\Temp\\x.dll","extension":".dll","size_bytes":10,"hashes":{"md5":"bb"}},"tags":["t1","t2"],"attributes":{"k":"v"}}`))
	f.Add([]byte(`{"id":"a4","type":"process.access","source":"sysmon","host":"WS01","target":{"pid":700,"name":"lsass.exe"},"access":{"granted_access":"0x1010","call_trace":"a|b"}}`))
	f.Add([]byte(`{"id":"a5","type":"registry.set","source":"sysmon","host":"WS01","registry":{"key":"HKCU\\...\\Run","value_name":"evil","value":"powershell","operation":"SetValue"}}`))
	// Malformed and hostile inputs seen in review.
	f.Add([]byte(``))
	f.Add([]byte(`not json`))
	f.Add([]byte(`{}`))
	f.Add([]byte(`{"id":"a6","type":"process.create","timestamp":"not-a-time"}`))
	f.Add([]byte(`{"id":"a7","type":"process.create","timestamp":"9999-12-31T23:59:59Z"}`))
	f.Add([]byte(`{"id":"a8","type":"process.create","host":"\x1f-forge"}`))
	f.Add([]byte(`{"id":"","type":""}`))
	f.Add([]byte(`{"id":"a9","type":"process.create","process":{"pid":99999999999999999999}}`))
	f.Add([]byte(`{"id":"a10","type":"process.create","process":{"pid":1.5}}`))
	f.Add([]byte("{\"id\":\"a11\",\"type\":\"process.create\",\"user\":\"\xff\xfe\"}"))
	f.Add([]byte(`{"id":"a12","type":"process.create","tags":[1,2,3]}`))
	f.Add([]byte(`{"id":"a13","type":"process.create","process":null,"file":null,"network":null}`))

	f.Fuzz(func(t *testing.T, line []byte) {
		ev, err := decode(line)
		if err != nil {
			return
		}
		if err := ev.Validate(); err != nil {
			t.Fatalf("decode accepted an event Validate refuses: %v", err)
		}
		// Boundary invariant 1: the field separator never survives in
		// a haystack field (a forged separator would alias fields in
		// cross-field search).
		sepFields := []string{ev.ID, ev.Type, ev.Source, ev.Host, ev.User}
		if ev.Process != nil {
			sepFields = append(sepFields, ev.Process.Name, ev.Process.CommandLine, ev.Process.Image)
			for _, d := range ev.Process.Hashes {
				sepFields = append(sepFields, d)
			}
		}
		if ev.Target != nil {
			sepFields = append(sepFields, ev.Target.Name, ev.Target.CommandLine, ev.Target.Image)
		}
		if ev.File != nil {
			sepFields = append(sepFields, ev.File.Path, ev.File.Extension)
		}
		if ev.Network != nil {
			sepFields = append(sepFields, ev.Network.Protocol, ev.Network.SourceIP, ev.Network.DestinationIP, ev.Network.Domain)
		}
		if ev.Registry != nil {
			sepFields = append(sepFields, ev.Registry.Key, ev.Registry.ValueName, ev.Registry.Value, ev.Registry.Operation)
		}
		for i, s := range sepFields {
			if strings.Contains(s, fieldSep) {
				t.Fatalf("field separator survived in haystack field %d: %q", i, s)
			}
		}
		// Boundary invariant 2: identity fields stay within their caps.
		if len([]rune(ev.Host)) > maxHostRunes || len([]rune(ev.User)) > maxUserRunes || len([]rune(ev.ID)) > maxIDRunes {
			t.Fatalf("identity field over cap: host=%d user=%d id=%d", len([]rune(ev.Host)), len([]rune(ev.User)), len([]rune(ev.ID)))
		}
		if ev.Network != nil && (len([]rune(ev.Network.DestinationIP)) > maxDestRunes || len([]rune(ev.Network.Domain)) > maxDestRunes) {
			t.Fatalf("destination over cap: ip=%d domain=%d", len([]rune(ev.Network.DestinationIP)), len([]rune(ev.Network.Domain)))
		}
		// Boundary invariant 3: the accepted event re-encodes to one
		// NDJSON line without error (every downstream consumer of the
		// store/export path depends on this).
		if _, err := ev.Encode(); err != nil {
			t.Fatalf("accepted event does not re-encode: %v", err)
		}
	})
}

func FuzzLoadIdentities(f *testing.F) {
	f.Add([]byte("version: 1\nidentities:\n  - name: s1\n    token_sha256: " + strings.Repeat("ab", 32) + "\n    hosts: [\"*\"]\n"))
	f.Add([]byte("version: 1\nidentities:\n  - name: s1\n    token_sha256: " + strings.Repeat("ab", 32) + "\n    hosts: [\"WS01\",\"ws02\"]\n"))
	f.Add([]byte("version: 1\nidentities: []\n"))
	f.Add([]byte("version: 2\nidentities: []\n"))
	f.Add([]byte("not yaml: ["))
	f.Add([]byte(""))
	f.Add([]byte("version: 1\nidentities:\n  - name: shared-token\n    token_sha256: " + strings.Repeat("cd", 32) + "\n    hosts: [\"*\"]\n"))
	f.Add([]byte("version: 1\nidentities:\n  - name: x\n    token_sha256: zz\n    hosts: [\"a\"]\n  - name: x\n    token_sha256: " + strings.Repeat("ee", 32) + "\n    hosts: [\"a\"]\n"))
	f.Add([]byte("version: 1\nidentities:\n  - {name: a, token_sha256: " + strings.Repeat("01", 32) + ", hosts: [\"*\", \"WS1\"]}\n"))
	f.Add([]byte("version: 1\nidentities:\n  - name: \"a\\nb\"\n    token_sha256: " + strings.Repeat("02", 32) + "\n    hosts: [\"a\"]\nunknown_field: true\n"))

	f.Fuzz(func(t *testing.T, data []byte) {
		dir := t.TempDir()
		path := filepath.Join(dir, "identities.yaml")
		if err := os.WriteFile(path, data, 0o600); err != nil {
			t.Skip()
		}
		ids, err := LoadIdentities(path)
		if err != nil {
			// A rejected file must leave nothing usable behind.
			if ids != nil {
				t.Fatalf("LoadIdentities returned identities alongside an error: %v", err)
			}
			return
		}
		if len(ids) == 0 {
			t.Fatal("LoadIdentities succeeded with zero identities")
		}
		seen := map[[32]byte]bool{}
		for _, id := range ids {
			if id.Name == "" || id.Name == "shared-token" {
				t.Fatalf("loaded identity with reserved name %q", id.Name)
			}
			if strings.ContainsFunc(id.Name, func(r rune) bool { return r < 0x20 || r == 0x7f }) {
				t.Fatalf("loaded identity name with control characters: %q", id.Name)
			}
			if seen[id.digest] {
				t.Fatalf("loaded duplicate token digest for %q", id.Name)
			}
			seen[id.digest] = true
		}
	})
}

// FuzzMatchIdentity builds identities from fuzz-chosen tokens and
// checks the lookup: the identity whose digest is sha256(token) is
// found by matchIdentity for exactly that token, any other token of
// the set matches its own entry, and a token of neither set matches
// nothing (a SHA-256 second preimage in 32 bytes would fail this).
func FuzzMatchIdentity(f *testing.F) {
	f.Add("sensor-one-token", "sensor-two-token", "guest-token")
	f.Add("", "x", "")
	f.Add(strings.Repeat("t", 4096), strings.Repeat("u", 4097), strings.Repeat("t", 4096))
	f.Add("\x00\x01\x02", "token", "\x00\x01\x03")

	f.Fuzz(func(t *testing.T, tok1, tok2, guest string) {
		if tok1 == "" || tok2 == "" {
			t.Skip()
		}
		if tok1 == tok2 {
			// Equal tokens mean equal digests; LoadIdentities rejects
			// duplicate digests (unit-tested), so the set below cannot
			// occur in production. Skip instead of asserting which of
			// two indistinguishable entries matchIdentity picks.
			t.Skip()
		}
		mk := func(name, token string) (Identity, error) {
			return compileIdentity(identityEntry{
				Name:        name,
				TokenSHA256: TokenDigest(token),
				Hosts:       []string{AnyHost},
			})
		}
		id1, err := mk("s1", tok1)
		if err != nil {
			t.Fatal(err)
		}
		id2, err := mk("s2", tok2)
		if err != nil {
			t.Fatal(err)
		}
		ids := []Identity{id1, id2}
		if got := matchIdentity(ids, []byte(tok1)); got == nil || got.Name != "s1" {
			t.Fatalf("token of s1 matched %v, want s1", got)
		}
		if got := matchIdentity(ids, []byte(tok2)); got == nil || got.Name != "s2" {
			t.Fatalf("token of s2 matched %v, want s2", got)
		}
		if guest != tok1 && guest != tok2 {
			if got := matchIdentity(ids, []byte(guest)); got != nil {
				t.Fatalf("unknown token matched identity %q", got.Name)
			}
		}
	})
}

// fuzzEnrollRegistry mimics the enrollment registry contract the
// handshake codes against: an unknown token is an error, a known one
// grants a credential bound to the requested host (SEC-7).
type fuzzEnrollRegistry struct{}

func (fuzzEnrollRegistry) Enroll(token, host, peer string) (EnrollGrant, error) {
	if token != "tok-1" {
		return EnrollGrant{}, errors.New("unknown enrollment token")
	}
	return EnrollGrant{Name: "enr-" + strings.ToLower(host), Credential: "btsensor_fuzz", Active: true}, nil
}

func (fuzzEnrollRegistry) Authenticate(string) (EnrollCheck, bool) { return EnrollCheck{}, false }

// FuzzEnrollLine drives the ENROLL first line end to end over an
// in-process pipe: isEnrollLine's prefix test, handleEnroll's field
// splitting and loopback guard, the registry call and the single-line
// answer. Properties:
//   - the handshake never panics, never blocks beyond the ack deadline
//     and always answers exactly one line of valid JSON;
//   - exactly one of the rejected/enrolled counters advances, matching
//     the answer (error ack <=> rejected, enrolled ack <=> enrolled);
//   - an enrolled answer carries the identity, the credential and the
//     state the enroller returned; an error answer names a reason.
func FuzzEnrollLine(f *testing.F) {
	f.Add("ENROLL tok-1 PC-01", true)
	f.Add("ENROLL tok-1 lab-host-9", true)
	f.Add("ENROLL tok-1", true)
	f.Add("ENROLL tok-1 PC-01 extra", true)
	f.Add("ENROLL  PC-01", true) // empty token field
	f.Add("ENROLL tok-1 PC-01 BAD", true)
	f.Add("ENROLL btsensor_abc PC-01", true) // credential past as token
	f.Add("ENROLL tok-1 PC-01", false)       // enrollment off
	f.Add("ENROLL tok-1 PC-01\x00\x01", true)
	f.Add("ENROLL tok-1 PC-01", true)

	f.Fuzz(func(t *testing.T, line string, enrollerOn bool) {
		if len(line) > maxLineSize || strings.ContainsAny(line, "\r\n\x00") {
			return // ScanLines splits on these; the fuzz models one line
		}
		if !isEnrollLine([]byte(line)) {
			return // the fuzz exercises the ENROLL dispatch specifically
		}
		var s Server // zero value: no listener, no goroutines, plain-text mode
		if enrollerOn {
			s.SetEnroller(fuzzEnrollRegistry{})
		}
		client, server := net.Pipe()
		defer client.Close()
		deadline := time.Now().Add(10 * time.Second)
		_ = client.SetDeadline(deadline)
		_ = server.SetDeadline(deadline)
		var answer []byte
		readDone := make(chan struct{})
		go func() {
			defer close(readDone)
			b, _ := io.ReadAll(client)
			answer = b
		}()
		served := make(chan struct{})
		go func() {
			defer close(served)
			defer server.Close()
			s.handleEnroll(server, []byte(line), "127.0.0.1")
		}()
		<-served
		<-readDone

		text := string(answer)
		if !strings.HasSuffix(text, "\n") || strings.Count(text, "\n") != 1 {
			t.Fatalf("ENROLL %q: handshake must answer exactly one line, got %q", line, text)
		}
		oneLine := strings.TrimSuffix(text, "\n")
		var ack struct {
			Ack        string `json:"ack"`
			Identity   string `json:"identity"`
			Credential string `json:"credential"`
			State      string `json:"state"`
			Error      string `json:"error"`
		}
		if err := json.Unmarshal([]byte(oneLine), &ack); err != nil {
			t.Fatalf("ENROLL %q: ack is not valid JSON: %v (%q)", line, err, oneLine)
		}
		rejected, enrolled := s.rejected.Load(), s.enrolledN.Load()
		switch ack.Ack {
		case "enrolled":
			if !enrollerOn {
				t.Fatalf("ENROLL %q: enrolled without an enroller", line)
			}
			if ack.Identity == "" || ack.Credential == "" || (ack.State != EnrollActive && ack.State != EnrollPending) {
				t.Fatalf("ENROLL %q: enrolled ack missing fields: %+v", line, ack)
			}
			if enrolled != 1 || rejected != 0 {
				t.Fatalf("ENROLL %q: counters rejected=%d enrolled=%d, want 0/1", line, rejected, enrolled)
			}
		case "error":
			if ack.Error == "" {
				t.Fatalf("ENROLL %q: error ack without a reason", line)
			}
			if rejected != 1 || enrolled != 0 {
				t.Fatalf("ENROLL %q: counters rejected=%d enrolled=%d, want 1/0", line, rejected, enrolled)
			}
		default:
			t.Fatalf("ENROLL %q: ack must be enrolled or error, got %q", line, ack.Ack)
		}
	})
}
