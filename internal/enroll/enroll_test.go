package enroll

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type clock struct{ t time.Time }

func (c *clock) now() time.Time { return c.t }

func newRegistry(t *testing.T) (*Registry, *clock) {
	t.Helper()
	r, err := Open(filepath.Join(t.TempDir(), "enrollment.json"))
	if err != nil {
		t.Fatal(err)
	}
	// The injected clock must stay NEAR the real wall clock, never a
	// hardcoded date: the reload path (Open) uses the production
	// time.Now, so a fixed base lets its 24h token TTL drift past the
	// real clock and flip expiry-derived states under the test (the
	// 2026-10-05 12:00 UTC base detonated at 2026-10-06 12:00 UTC:
	// TestPersistenceAndReload reloaded a token as "expired" where it
	// expected "used_up"). One hour back keeps every token inside its
	// TTL for the whole run, on any day, forever.
	c := &clock{t: time.Now().UTC().Add(-time.Hour)}
	r.now = c.now
	return r, c
}

func mustToken(t *testing.T, r *Registry, req TokenRequest) (string, Token) {
	t.Helper()
	secret, tok, err := r.CreateToken(req)
	if err != nil {
		t.Fatal(err)
	}
	return secret, tok
}

func TestEnrollPendingThenApprove(t *testing.T) {
	r, _ := newRegistry(t)
	var withdrawn []string
	r.SetOnWithdraw(func(name string) { withdrawn = append(withdrawn, name) })
	secret, tok := mustToken(t, r, TokenRequest{Label: "aula 3", By: "ana"})
	if !strings.HasPrefix(secret, TokenPrefix) || tok.MaxUses != 1 || tok.Status != "active" || tok.CreatedBy != "ana" {
		t.Fatalf("token = %q %+v", secret, tok)
	}
	got, err := r.Enroll(secret, "PC-AULA3-01", "10.0.0.7")
	if err != nil {
		t.Fatal(err)
	}
	if got.State != Pending || !strings.HasPrefix(got.Credential, CredentialPrefix) || got.Name != "enr-pc-aula3-01-"+got.Name[len(got.Name)-6:] {
		t.Fatalf("enrolled = %+v", got)
	}
	name, host, state, ok := r.Authenticate(got.Credential)
	if !ok || name != got.Name || host != "PC-AULA3-01" || state != Pending {
		t.Fatalf("authenticate = %q %q %q %v", name, host, state, ok)
	}
	if h := r.Hosts()[0]; h.LastAttempt == nil || h.Peer != "10.0.0.7" {
		t.Fatalf("pending host does not record its attempt: %+v", h)
	}
	h, err := r.Decide(got.Name, Approve, "jefa")
	if err != nil || h.State != Active || h.DecidedBy != "jefa" || h.DecidedAt == nil {
		t.Fatalf("approve = %+v, %v", h, err)
	}
	if _, _, state, _ := r.Authenticate(got.Credential); state != Active {
		t.Fatalf("after approval the state is %q", state)
	}
	if len(withdrawn) != 0 {
		t.Fatalf("approval withdrew %v", withdrawn)
	}
	if _, err := r.Decide(got.Name, Revoke, "jefa"); err != nil {
		t.Fatal(err)
	}
	if _, _, state, _ := r.Authenticate(got.Credential); state != Revoked {
		t.Fatalf("after revoke the state is %q", state)
	}
	if len(withdrawn) != 1 || withdrawn[0] != got.Name {
		t.Fatalf("revoke must close the connections of %s, withdrew %v", got.Name, withdrawn)
	}
}

func TestTokenSingleUseExpiryAndRevoke(t *testing.T) {
	r, c := newRegistry(t)
	one, _ := mustToken(t, r, TokenRequest{})
	if _, err := r.Enroll(one, "PC-1", ""); err != nil {
		t.Fatal(err)
	}
	if _, err := r.Enroll(one, "PC-2", ""); err == nil || !strings.Contains(err.Error(), "no uses left") {
		t.Fatalf("second use of a single-use token: %v", err)
	}

	short, _ := mustToken(t, r, TokenRequest{MaxUses: 5, TTL: time.Hour})
	c.t = c.t.Add(time.Hour)
	if _, err := r.Enroll(short, "PC-3", ""); err == nil || !strings.Contains(err.Error(), "expired") {
		t.Fatalf("expired token: %v", err)
	}

	rev, tok := mustToken(t, r, TokenRequest{MaxUses: 5})
	if _, err := r.RevokeToken(tok.ID, "ana"); err != nil {
		t.Fatal(err)
	}
	if _, err := r.Enroll(rev, "PC-4", ""); err == nil || !strings.Contains(err.Error(), "revoked") {
		t.Fatalf("revoked token: %v", err)
	}
	if _, err := r.Enroll(TokenPrefix+strings.Repeat("0", 64), "PC-5", ""); err == nil || !strings.Contains(err.Error(), "unknown") {
		t.Fatalf("unknown token: %v", err)
	}
	statuses := map[string]bool{}
	for _, tk := range r.Tokens() {
		statuses[tk.Status] = true
	}
	for _, want := range []string{"used_up", "expired", "revoked"} {
		if !statuses[want] {
			t.Fatalf("token statuses %v miss %q", statuses, want)
		}
	}
}

func TestAutoApproveAndConflict(t *testing.T) {
	r, _ := newRegistry(t)
	r.SetBoundElsewhere(func(host string) string {
		if strings.EqualFold(host, "SRV-FILE") {
			return "srv-file"
		}
		return ""
	})
	secret, _ := mustToken(t, r, TokenRequest{MaxUses: 10, AutoApprove: "PC-CONTA-*"})
	a, err := r.Enroll(secret, "pc-conta-01", "")
	if err != nil || a.State != Active {
		t.Fatalf("matching host must be approved by the token: %+v %v", a, err)
	}
	if h := r.Hosts()[0]; !h.AutoApproved || h.DecidedBy == "" {
		t.Fatalf("auto approval is not recorded: %+v", h)
	}
	b, err := r.Enroll(secret, "PC-VENTAS-01", "")
	if err != nil || b.State != Pending {
		t.Fatalf("a host outside the pattern waits for a human: %+v %v", b, err)
	}
	// the same machine again: a reinstall, or someone posing as it
	c, err := r.Enroll(secret, "PC-CONTA-01", "")
	if err != nil || c.State != Pending {
		t.Fatalf("a conflicting host must never approve itself: %+v %v", c, err)
	}
	d, err := r.Enroll(secret, "srv-file", "")
	if err != nil || d.State != Pending {
		t.Fatalf("a host bound in the identities file must wait: %+v %v", d, err)
	}
	conflicts := 0
	for _, h := range r.Hosts() {
		if h.Conflict != "" {
			conflicts++
		}
	}
	if conflicts != 2 {
		t.Fatalf("want 2 conflicts, got %d: %+v", conflicts, r.Hosts())
	}
}

func TestDecideStateMachine(t *testing.T) {
	r, _ := newRegistry(t)
	secret, _ := mustToken(t, r, TokenRequest{MaxUses: 3})
	a, _ := r.Enroll(secret, "PC-A", "")
	if _, err := r.Decide(a.Name, Reject, "ana"); err != nil {
		t.Fatal(err)
	}
	if _, err := r.Decide(a.Name, Approve, "ana"); !errors.Is(err, ErrConflict) {
		t.Fatalf("approving a rejected host: %v", err)
	}
	if _, err := r.Decide(a.Name, Revoke, "ana"); !errors.Is(err, ErrConflict) {
		t.Fatalf("revoking a rejected host: %v", err)
	}
	if _, err := r.Decide("enr-nope-000000", Approve, "ana"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unknown host: %v", err)
	}
	if _, err := r.Decide(a.Name, Action("delete"), "ana"); !errors.Is(err, ErrInvalid) {
		t.Fatalf("unknown action: %v", err)
	}
	if _, _, state, ok := r.Authenticate(a.Credential); !ok || state != Rejected {
		t.Fatalf("a rejected credential must be known as rejected: %q %v", state, ok)
	}
}

func TestInvalidRequests(t *testing.T) {
	r, _ := newRegistry(t)
	bad := []TokenRequest{
		{MaxUses: -1},
		{MaxUses: MaxUses + 1},
		{TTL: time.Minute},
		{TTL: MaxTTL + time.Hour},
		{AutoApprove: "pc-["},
		{Label: strings.Repeat("x", 65)},
		{Label: "bad\nlabel"},
	}
	for _, req := range bad {
		if _, _, err := r.CreateToken(req); !errors.Is(err, ErrInvalid) {
			t.Errorf("CreateToken(%+v) = %v, want ErrInvalid", req, err)
		}
	}
	secret, _ := mustToken(t, r, TokenRequest{MaxUses: 5})
	for _, host := range []string{"", "pc 1", "pc\n1", "pc;rm", strings.Repeat("a", 254)} {
		if _, err := r.Enroll(secret, host, ""); !errors.Is(err, ErrInvalid) {
			t.Errorf("Enroll(host %q) = %v, want ErrInvalid", host, err)
		}
	}
	if _, err := r.Enroll(CredentialPrefix+strings.Repeat("a", 64), "PC-1", ""); err == nil || !strings.Contains(err.Error(), "AUTH") {
		t.Fatalf("a credential used as a token must say so: %v", err)
	}
	if _, _, _, ok := r.Authenticate(secret); ok {
		t.Fatal("an enrollment token must not authenticate as a credential")
	}
	if tk := r.Tokens()[0]; tk.Uses != 0 {
		t.Fatalf("failed enrollments consumed uses: %+v", tk)
	}
}

func TestPersistenceAndReload(t *testing.T) {
	r, _ := newRegistry(t)
	secret, tok := mustToken(t, r, TokenRequest{MaxUses: 2, By: "ana"})
	a, _ := r.Enroll(secret, "PC-A", "10.0.0.1")
	if _, err := r.Decide(a.Name, Approve, "ana"); err != nil {
		t.Fatal(err)
	}
	b, _ := r.Enroll(secret, "PC-B", "10.0.0.2")

	data, err := os.ReadFile(r.Path())
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(data), secret) || strings.Contains(string(data), a.Credential) {
		t.Fatal("the state file must hold digests, never the secrets")
	}
	if st, _ := os.Stat(r.Path()); st.Mode().Perm()&0o077 != 0 && os.PathSeparator == '/' {
		t.Fatalf("state file mode %v: must be private", st.Mode().Perm())
	}

	re, err := Open(r.Path())
	if err != nil {
		t.Fatal(err)
	}
	if _, _, state, ok := re.Authenticate(a.Credential); !ok || state != Active {
		t.Fatalf("reloaded active credential: %q %v", state, ok)
	}
	if _, _, state, ok := re.Authenticate(b.Credential); !ok || state != Pending {
		t.Fatalf("reloaded pending credential: %q %v", state, ok)
	}
	if got := re.Tokens(); len(got) != 1 || got[0].ID != tok.ID || got[0].Uses != 2 || got[0].Status != "used_up" {
		t.Fatalf("reloaded tokens = %+v", got)
	}
	pending, active, usable := re.Counts()
	if pending != 1 || active != 1 || usable != 0 {
		t.Fatalf("counts = %d %d %d", pending, active, usable)
	}
}

func TestOpenRejectsBrokenState(t *testing.T) {
	dir := t.TempDir()
	cases := map[string]string{
		"garbage":       "{not json",
		"version":       `{"version":2,"tokens":[],"hosts":[]}`,
		"unknown field": `{"version":1,"tokens":[],"hosts":[],"extra":1}`,
		"bad digest":    `{"version":1,"tokens":[{"id":"a","sha256":"zz"}],"hosts":[]}`,
		"bad state":     `{"version":1,"tokens":[],"hosts":[{"name":"x","state":"maybe","sha256":"` + strings.Repeat("a", 64) + `"}]}`,
	}
	for name, body := range cases {
		p := filepath.Join(dir, strings.ReplaceAll(name, " ", "-")+".json")
		if err := os.WriteFile(p, []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
		if _, err := Open(p); err == nil {
			t.Errorf("%s: Open accepted a broken state file", name)
		}
	}
	if r, err := Open(filepath.Join(dir, "missing.json")); err != nil || len(r.Hosts()) != 0 {
		t.Fatalf("a missing file starts an empty registry: %v", err)
	}
}

func TestFailedWriteLeavesStateUnchanged(t *testing.T) {
	dir := t.TempDir()
	r, err := Open(filepath.Join(dir, "sub", "enrollment.json"))
	if err != nil {
		t.Fatal(err)
	}
	secret, _, err := r.CreateToken(TokenRequest{MaxUses: 3})
	if err != nil {
		t.Fatal(err)
	}
	// make the directory unwritable: the next change cannot be saved
	if err := os.Chmod(filepath.Join(dir, "sub"), 0o500); err != nil {
		t.Fatal(err)
	}
	defer os.Chmod(filepath.Join(dir, "sub"), 0o700)
	if probe, err := os.CreateTemp(filepath.Join(dir, "sub"), "probe"); err == nil {
		probe.Close()
		t.Skip("directory still writable (running as root or on Windows)")
	}
	if _, err := r.Enroll(secret, "PC-A", ""); err == nil {
		t.Fatal("an enrollment that could not be saved must fail")
	}
	if len(r.Hosts()) != 0 || r.Tokens()[0].Uses != 0 {
		t.Fatalf("memory diverged from disk after a failed write: hosts %v tokens %+v", r.Hosts(), r.Tokens())
	}
}

// SEC-A-1 (Seguridad A, ronda 2026-10-05 13h34): the identity suffix is
// only 6 hex digits and host records are never purged, so across enough
// re-enrollments of the same host a birthday collision is possible; one
// duplicate name would save fine and then Open() (and the engine with
// it) would refuse to start at the next restart.

func TestUniqueIdentityNameRerollsOnCollision(t *testing.T) {
	takenNames := map[string]bool{"enr-pc-a-ffffff": true, "enr-pc-a-000000": true}
	taken := func(name string) bool { return takenNames[name] }
	rolls := []string{"ffffff", "000000", "123456"}
	i := 0
	roll := func(int) (string, error) {
		if i >= len(rolls) {
			t.Fatalf("unexpected extra suffix draw #%d", i+1)
		}
		s := rolls[i]
		i++
		return s, nil
	}
	name, err := uniqueIdentityName("PC-A", "ffffff", taken, roll)
	if err != nil {
		t.Fatal(err)
	}
	if name != "enr-pc-a-123456" {
		t.Fatalf("name = %q, want the first unused suffix enr-pc-a-123456", name)
	}
	if i != 3 {
		t.Fatalf("draws = %d, want 3 (two collisions, one hit)", i)
	}
}

func TestUniqueIdentityNameExhaustionIsAnError(t *testing.T) {
	taken := func(string) bool { return true } // pathological registry
	roll := func(int) (string, error) { return "abcdef", nil }
	if _, err := uniqueIdentityName("PC-A", "abcdef", taken, roll); err == nil {
		t.Fatal("an exhausted suffix space must return an error, not a duplicate name")
	}
	rollErr := errors.New("entropy drained")
	if _, err := uniqueIdentityName("PC-A", "abcdef", taken, func(int) (string, error) { return "", rollErr }); !errors.Is(err, rollErr) {
		t.Fatalf("err = %v, want the roll error wrapped", err)
	}
}

func TestEnrollProducesUniqueNamesAcrossReEnrollments(t *testing.T) {
	r, _ := newRegistry(t)
	secret, _ := mustToken(t, r, TokenRequest{Label: "lab", By: "ana", MaxUses: 50})
	seen := map[string]bool{}
	for i := 0; i < 25; i++ {
		got, err := r.Enroll(secret, "PC-AULA", "")
		if err != nil {
			t.Fatal(err)
		}
		if seen[got.Name] {
			t.Fatalf("enrollment #%d reused identity name %q", i+1, got.Name)
		}
		seen[got.Name] = true
	}
	// The persisted file must reload without the duplicate-name
	// rejection: that is exactly how a collision used to brick the
	// engine at restart.
	if _, err := Open(r.Path()); err != nil {
		t.Fatalf("the registry file with %d same-host identities must reload: %v", len(seen), err)
	}
}
