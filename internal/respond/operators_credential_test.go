package respond

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func digestHex(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func writeOps(t *testing.T, body string) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "ops.yaml")
	if err := os.WriteFile(p, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	return p
}

// With a version-2 operators file the operator name is no longer
// enough: each one must present their own credential. Denials are
// audited under their own code, and the credential never reaches the
// audit trail.
func TestOperatorCredentialRequired(t *testing.T) {
	m, _, auditPath := newTestManager(t)
	ops := writeOps(t, "version: 2\noperators:\n  - name: ana\n    token_sha256: "+digestHex("ana-secret-credential")+"\n")
	if err := m.LoadOperators(ops); err != nil {
		t.Fatal(err)
	}
	if m.OperatorsCount() != 1 || m.CredentialedOperators() != 1 {
		t.Fatalf("count=%d credentialed=%d", m.OperatorsCount(), m.CredentialedOperators())
	}
	for _, tok := range []string{"", "wrong", "ANA-SECRET-CREDENTIAL"} {
		req := killReq(2147483647, "sleep")
		req.OperatorToken = tok
		if res := m.Kill(req); res.Code != CodeOperatorCredential || res.HTTPStatus != 403 {
			t.Fatalf("token %q: got %+v, want operator_credential_invalid/403", tok, res)
		}
	}
	req := killReq(2147483647, "sleep")
	req.OperatorToken = "ana-secret-credential"
	if res := m.Kill(req); res.Code != CodePIDNotFound {
		t.Fatalf("right credential must reach the process guard, got %+v", res)
	}
	audit, err := os.ReadFile(auditPath)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Count(string(audit), CodeOperatorCredential) != 3 {
		t.Fatalf("credential denials not audited:\n%s", audit)
	}
	if strings.Contains(string(audit), "ana-secret-credential") || strings.Contains(string(audit), "wrong") {
		t.Fatal("the operator credential leaked into the audit trail")
	}
}

// Version 1 (names only) keeps working unchanged.
func TestOperatorNamesOnlyStillAccepted(t *testing.T) {
	m, _, _ := newTestManager(t, "ana")
	if m.CredentialedOperators() != 0 {
		t.Fatal("version 1 entries carry no credential")
	}
	if res := m.Kill(killReq(2147483647, "sleep")); res.Code != CodePIDNotFound {
		t.Fatalf("version 1 operator must reach the guard, got %+v", res)
	}
}

func TestOperatorFileVersion2Validation(t *testing.T) {
	m, _, _ := newTestManager(t)
	d := digestHex("credential-one")
	for name, body := range map[string]string{
		"names in v2":         "version: 2\nnames: [ana]\n",
		"no operators":        "version: 2\noperators: []\n",
		"missing digest":      "version: 2\noperators:\n  - name: ana\n",
		"short digest":        "version: 2\noperators:\n  - name: ana\n    token_sha256: abcd\n",
		"duplicate name":      "version: 2\noperators:\n  - {name: ana, token_sha256: " + d + "}\n  - {name: ana, token_sha256: " + digestHex("x") + "}\n",
		"shared credential":   "version: 2\noperators:\n  - {name: ana, token_sha256: " + d + "}\n  - {name: beto, token_sha256: " + d + "}\n",
		"clear token field":   "version: 2\noperators:\n  - {name: ana, token: secret}\n",
		"operators in v1":     "version: 1\noperators:\n  - {name: ana, token_sha256: " + d + "}\n",
		"unsupported version": "version: 3\nnames: [ana]\n",
	} {
		if err := m.LoadOperators(writeOps(t, body)); err == nil {
			t.Errorf("%s: accepted, want error", name)
		}
	}
	if err := m.LoadOperators(writeOps(t, "version: 2\noperators:\n  - {name: ana, token_sha256: "+d+"}\n  - {name: beto, token_sha256: "+digestHex("credential-two")+"}\n")); err != nil {
		t.Fatalf("valid v2 file rejected: %v", err)
	}
}

func TestOperatorTokenLengthCapped(t *testing.T) {
	req := killReq(4242, "sleep")
	req.OperatorToken = strings.Repeat("x", MaxOperatorTokenLen+1)
	if err := req.Validate(); err == nil {
		t.Fatal("oversized operator token accepted")
	}
}
