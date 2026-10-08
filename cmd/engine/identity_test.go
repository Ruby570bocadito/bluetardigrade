package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Ruby570bocadito/bluetardigrade/internal/ingest"
	"github.com/Ruby570bocadito/bluetardigrade/internal/respond"
)

// The generated entry must load as a valid identities file and its
// digest must match the printed token. The token is revealed on the
// ERROR writer (audit 5.2: a `> identities.yaml` redirect must capture
// YAML only, never the clear token) — the test captures both streams
// and asserts stdout carries NO token at all.
func TestIngestIdentityRoundTrip(t *testing.T) {
	var out, errOut strings.Builder
	if err := runIngestIdentity(strings.NewReader(""), &out, &errOut, "wks-01", []string{"WKS-01", "wks-01.corp.local"}, false, false); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(out.String(), "Se muestra UNA vez") {
		t.Fatalf("stdout must not carry the token reveal (it would persist in redirected YAML):\n%s", out.String())
	}
	lines := strings.Split(errOut.String(), "\n")
	token := strings.TrimPrefix(lines[1], "# ")
	if len(token) != 64 {
		t.Fatalf("token line = %q, want 64 hex characters", lines[1])
	}
	entry := out.String()[strings.Index(out.String(), "  - name:"):]
	p := filepath.Join(t.TempDir(), "ids.yaml")
	if err := os.WriteFile(p, []byte("version: 1\nidentities:\n"+entry), 0o600); err != nil {
		t.Fatal(err)
	}
	ids, err := ingest.LoadIdentities(p)
	if err != nil {
		t.Fatalf("generated entry does not load: %v\n%s", err, out.String())
	}
	if len(ids) != 1 || ids[0].Name != "wks-01" || !ids[0].AllowsHost("WKS-01.CORP.LOCAL") || ids[0].AllowsHost("DC-01") {
		t.Fatalf("unexpected identity: %+v", ids)
	}
	if !strings.Contains(out.String(), ingest.TokenDigest(token)) {
		t.Fatal("printed digest does not match the printed token")
	}
}

func TestIngestIdentityRejectsBadInput(t *testing.T) {
	cases := []struct {
		name    string
		hosts   []string
		any     bool
		stdin   string
		fromStd bool
	}{
		{name: "", hosts: []string{"A"}},
		{name: "a: b", hosts: []string{"A"}},
		{name: "a"},                                  // no host and no --any-host
		{name: "a", hosts: []string{"A"}, any: true}, // both
		{name: "a", hosts: []string{"A, B"}},         // YAML-breaking host
		{name: "a", any: true, stdin: "short", fromStd: true},
	}
	for i, c := range cases {
		var out, errOut strings.Builder
		if err := runIngestIdentity(strings.NewReader(c.stdin), &out, &errOut, c.name, c.hosts, c.any, c.fromStd); err == nil {
			t.Errorf("case %d accepted: %+v", i, c)
		}
	}
}

// The generated operator entry loads as a version-2 operators file and
// authenticates exactly the printed credential.
func TestOperatorCredentialRoundTrip(t *testing.T) {
	var out strings.Builder
	if err := runOperatorCredential(strings.NewReader(""), &out, "ana", false); err != nil {
		t.Fatal(err)
	}
	token := strings.TrimPrefix(strings.Split(out.String(), "\n")[1], "# ")
	entry := out.String()[strings.Index(out.String(), "  - name:"):]
	p := filepath.Join(t.TempDir(), "ops.yaml")
	if err := os.WriteFile(p, []byte("version: 2\noperators:\n"+entry), 0o600); err != nil {
		t.Fatal(err)
	}
	audit, err := respond.OpenAudit(filepath.Join(t.TempDir(), "audit.jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	defer audit.Close()
	m := respond.NewManager("engine-lab", audit)
	if err := m.LoadOperators(p); err != nil {
		t.Fatalf("generated entry does not load: %v\n%s", err, out.String())
	}
	if m.CredentialedOperators() != 1 || len(token) != 64 {
		t.Fatalf("credentialed=%d token=%q", m.CredentialedOperators(), token)
	}
	if err := runOperatorCredential(strings.NewReader(""), &out, "a: b", false); err == nil {
		t.Fatal("YAML-breaking operator name accepted")
	}
}
