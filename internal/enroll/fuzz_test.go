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
