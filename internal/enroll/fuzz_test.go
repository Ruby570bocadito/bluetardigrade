package enroll

// SEC-7: fuzzing the enrollment surface — every "ENROLL <token> <host>"
// first line ends here in Registry.Enroll, and the saved hosts file is
// what Open must accept at every restart. Properties under fuzz:
//   - Enroll never panics on arbitrary host bytes and never accepts a
//     host ValidHost refuses (and always refuses one it would reject);
//   - a granted identity name is well-formed and short enough for the
//     ingest's 64-character identity cap;
//   - the credential it hands out authenticates to the granted name and
//     host, in the state the grant declared;
//   - the file Enroll saves re-opens clean (Open refuses malformed or
//     duplicated records — the SEC-A-1 last line of defense), and
//     re-enrolling the same host name keeps every identity name unique.

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// identity name shape: "enr-" + the (lowercased, truncated) host + the
// random hex suffix. The ingest cap for identity names is 64 runes.
var identityNameRe = regexp.MustCompile(`^enr-[a-z0-9._-]{1,48}-[0-9a-f]{6}$`)

func fuzzRegistry(t *testing.T, maxUses int) (*Registry, string) {
	t.Helper()
	r, err := Open(filepath.Join(t.TempDir(), "hosts.json"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	secret, _, err := r.CreateToken(TokenRequest{Label: "fuzz", MaxUses: maxUses})
	if err != nil {
		t.Fatalf("CreateToken: %v", err)
	}
	return r, secret
}

// TestOpenRefusesDuplicateTokenDigests pins the trust-boundary rule the
// fuzz target explores: a hosts file where two token records share one
// digest must not load. The digest is what findTokenLocked matches, last
// match wins, so an ambiguous file makes a revoke target whichever
// record the operator sees while the credential keeps resolving to the
// other one — the console would show the token dead and the sensor would
// still authenticate.
func TestOpenRefusesDuplicateTokenDigests(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "hosts.json")
	d := digest("btsensor_shared")
	content := fmt.Sprintf(`{"version":1,"tokens":[
  {"id":"tok-a","label":"one","max_uses":1,"uses":0,"created_at":"2026-10-05T10:00:00Z","expires_at":"2026-10-06T10:00:00Z","sha256":%q},
  {"id":"tok-b","label":"two","max_uses":1,"uses":0,"created_at":"2026-10-05T10:00:00Z","expires_at":"2026-10-06T10:00:00Z","sha256":%q}],
  "hosts":[]}`, d, d)
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Open(path); err == nil {
		t.Fatal("Open accepted a file where two tokens share one digest: the credential resolves to whichever record is last, so a revoke can leave it alive while the console shows it dead")
	}
}

// registrySeed builds one saved, fully valid registry file to seed the
// fuzz corpus with the shape the writer really produces.
func registrySeed() []byte {
	dir, err := os.MkdirTemp("", "enroll-seed")
	if err != nil {
		return []byte(`{"version":1,"tokens":[],"hosts":[]}`)
	}
	defer os.RemoveAll(dir)
	r, err := Open(filepath.Join(dir, "hosts.json"))
	if err != nil {
		return nil
	}
	secret, _, err := r.CreateToken(TokenRequest{Label: "seed", MaxUses: 2})
	if err != nil {
		return nil
	}
	if _, err := r.Enroll(secret, "PC-01", "127.0.0.1"); err != nil {
		return nil
	}
	data, err := os.ReadFile(r.Path())
	if err != nil {
		return nil
	}
	return data
}

// FuzzOpenRegistry drives the registry file parser with manipulated
// bytes: the engine trusts this file at every restart, so Open must
// either fail loud or hand back a self-consistent registry — record
// caps, well-formed digests, the closed set of states, unique token
// ids and digests, unique identity names and host digests — and what
// it accepts must survive a write cycle and re-open clean.
func FuzzOpenRegistry(f *testing.F) {
	f.Add([]byte(`{"version":1,"tokens":[],"hosts":[]}`))
	f.Add(registrySeed())
	f.Add([]byte(`{"version":2}`))
	f.Add([]byte(`{"version":1}`))
	f.Add([]byte(`{"version":1,"tokens":[{"id":"a"}],"hosts":[]}`))
	f.Add([]byte(`not json`))
	f.Add([]byte(`{}`))
	f.Add([]byte(`[]`))

	f.Fuzz(func(t *testing.T, data []byte) {
		if len(data) > maxFileBytes {
			return
		}
		dir := t.TempDir()
		path := filepath.Join(dir, "hosts.json")
		if err := os.WriteFile(path, data, 0o600); err != nil {
			t.Fatal(err)
		}
		r, err := Open(path)
		if err != nil {
			return // failing loud is always acceptable
		}
		tokenIDs, tokenDigests := map[string]bool{}, map[string]bool{}
		for _, tok := range r.tokens {
			if tok == nil || tok.ID == "" || tokenIDs[tok.ID] {
				t.Fatalf("Open accepted a file with a malformed or duplicated token id %q", tok.ID)
			}
			tokenIDs[tok.ID] = true
			if !validDigest(tok.Digest) || tokenDigests[tok.Digest] {
				t.Fatalf("Open accepted a file with a malformed or duplicated token digest (%q)", tok.ID)
			}
			tokenDigests[tok.Digest] = true
		}
		names, digests := map[string]bool{}, map[string]bool{}
		pending, active := 0, 0
		for _, h := range r.hosts {
			if h == nil || h.Name == "" || names[h.Name] {
				t.Fatalf("Open accepted a file with a malformed or duplicated identity name %q", h.Name)
			}
			names[h.Name] = true
			if !validDigest(h.Digest) || digests[h.Digest] {
				t.Fatalf("Open accepted a file with a malformed or duplicated credential digest (host %q)", h.Name)
			}
			digests[h.Digest] = true
			switch h.State {
			case Pending:
				pending++
			case Active:
				active++
			case Rejected, Revoked:
			default:
				t.Fatalf("Open accepted a file with unknown state %q (host %q)", h.State, h.Name)
			}
		}
		if p, a, _ := r.Counts(); p != pending || a != active {
			t.Fatalf("Counts() = %d pending / %d active, want %d / %d", p, a, pending, active)
		}
		// What Open accepts must survive the real write cycle: a token
		// creation saves the file (or refuses at the caps) and the saved
		// bytes re-open clean.
		_, _, cerr := r.CreateToken(TokenRequest{Label: "fuzz"})
		if cerr != nil && !strings.Contains(cerr.Error(), "tokens") {
			t.Fatalf("CreateToken on an accepted registry failed for a non-cap reason: %v", cerr)
		}
		if _, err := Open(path); err != nil {
			t.Fatalf("the file Open accepted and the writer saved does not re-open: %v", err)
		}
	})
}

func FuzzEnrollHost(f *testing.F) {
	f.Add("PC-01")
	f.Add("lab-host-9")
	f.Add("PC-01..")
	f.Add("-leading-dash")
	f.Add(strings.Repeat("a", 300))
	f.Add("HOST.with.dots_and-dashes")
	f.Add("a\tb") // never reaches Enroll intact (Fields splits), but must be refused anyway
	f.Add("")
	f.Add(".")
	f.Add("host*star")

	f.Fuzz(func(t *testing.T, host string) {
		if len(host) > 1024 {
			return // ValidHost caps at 253; keep the fuzz cheap
		}
		r, secret := fuzzRegistry(t, 2)
		trimmed := strings.TrimSpace(host)
		g, err := r.Enroll(secret, host, "127.0.0.1")
		if err != nil {
			if ValidHost(trimmed) {
				t.Fatalf("Enroll refused a valid host %q: %v", host, err)
			}
			return
		}
		if !ValidHost(trimmed) {
			t.Fatalf("Enroll accepted an invalid host %q", host)
		}
		if !identityNameRe.MatchString(g.Name) || len(g.Name) > 64 {
			t.Fatalf("granted identity name %q is malformed or too long", g.Name)
		}
		if g.Credential == "" || !strings.HasPrefix(g.Credential, CredentialPrefix) {
			t.Fatalf("grant credential %q is malformed", g.Credential)
		}
		if g.State != Pending && g.State != Active {
			t.Fatalf("grant state %q is neither pending nor active", g.State)
		}
		name, gotHost, state, ok := r.Authenticate(g.Credential)
		if !ok || name != g.Name || gotHost != trimmed || state != g.State {
			t.Fatalf("credential round-trip: name=%q host=%q state=%q ok=%v, want %q/%q/%q", name, gotHost, state, ok, g.Name, trimmed, g.State)
		}
		// The saved file must re-open clean after every grant.
		r2, err := Open(r.Path())
		if err != nil {
			t.Fatalf("re-open after Enroll(%q): %v", host, err)
		}
		// A second enrollment of the SAME host name (the re-image case)
		// must produce a different, equally well-formed identity name —
		// the SEC-A-1 uniqueness discipline — and the file stays clean.
		g2, err := r2.Enroll(secret, host, "127.0.0.2")
		if err != nil {
			t.Fatalf("second Enroll of %q refused: %v", host, err)
		}
		if g2.Name == g.Name {
			t.Fatalf("re-enrollment of %q reused identity name %q", host, g.Name)
		}
		if !identityNameRe.MatchString(g2.Name) || len(g2.Name) > 64 {
			t.Fatalf("second identity name %q is malformed or too long", g2.Name)
		}
		if _, err := Open(r2.Path()); err != nil {
			t.Fatalf("re-open after re-enrollment: %v", err)
		}
	})
}
