package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Ruby570bocadito/bluetardigrade/internal/ingest"
)

// The generated entry must load as a valid identities file and its
// digest must match the printed token.
func TestIngestIdentityRoundTrip(t *testing.T) {
	var out strings.Builder
	if err := runIngestIdentity(strings.NewReader(""), &out, "wks-01", []string{"WKS-01", "wks-01.corp.local"}, false, false); err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(out.String(), "\n")
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
		var out strings.Builder
		if err := runIngestIdentity(strings.NewReader(c.stdin), &out, c.name, c.hosts, c.any, c.fromStd); err == nil {
			t.Errorf("case %d accepted: %+v", i, c)
		}
	}
}
