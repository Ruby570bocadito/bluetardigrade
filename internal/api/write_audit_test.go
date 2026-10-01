// Adversarial round (agent 04): the two WRITE surfaces answer bounded,
// path-free, log-safe errors. Regression tests for the findings fixed
// in this round:
//   - F1  POST /api/suppressions read the body without a cap
//   - F2  entry fields had no length caps (file fattening)
//   - F3  client-supplied strings reached the audit log raw (log forging)
//   - F4  the triage persist 500 echoed server paths to the client
//   - F5  the DELETE 404 body was hand-built JSON (%q breaks it)
//   - F6  no entry-count cap on the API-written suppressions file
package api

import (
	"bytes"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/Ruby570bocadito/bluetardigrade/internal/lifecycle"
	"github.com/Ruby570bocadito/bluetardigrade/internal/suppress"
)

// captureLog swaps the standard logger for a buffer; the returned
// func restores stderr and yields what was logged.
func captureLog(t *testing.T) func() string {
	t.Helper()
	var buf bytes.Buffer
	log.SetOutput(&buf)
	return func() string {
		log.SetOutput(os.Stderr)
		return buf.String()
	}
}

func TestOneLineSanitizer(t *testing.T) {
	cases := []struct{ in, want string }{
		{"", ""},
		{"plain analyst", "plain analyst"},
		{"line1\nline2", "line1%0Aline2"},
		{"cr\rreturn", "cr%0Dreturn"},
		{"tab\there", "tab%09here"},
		{"del\x7fchar", "del%7Fchar"},
		{"ansi\x1b[31mred", "ansi%1B[31mred"},
		{"csi\u009bdanger", "csi%C2%9Bdanger"}, // C1 (8-bit CSI) encodes its UTF-8 bytes
		{"ñandú 日本", "ñandú 日本"},               // printable non-ASCII survives verbatim
	}
	for _, c := range cases {
		if got := oneLine(c.in); got != c.want {
			t.Errorf("oneLine(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestAuditLogLinesResistForgery(t *testing.T) {
	p := filepath.Join(t.TempDir(), "suppressions.yaml")
	_, addr := newWriteHub(t, p, true)

	read := captureLog(t)

	// triage: the author field carries a forged line
	res := postJSON(t, fmt.Sprintf("http://%s/api/alerts/0123456789abcdef/status", addr),
		`{"status":"acknowledged","note":"","by":"analyst\n[ALERT] FAKE CRITICAL"}`)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("triage status = %d, want 200", res.StatusCode)
	}

	// suppression write: the rule id carries a forged line
	res2 := postJSON(t, fmt.Sprintf("http://%s/api/suppressions", addr),
		`{"rule_id":"r1\n[ALERT] FAKE SILENCE","reason":"x"}`)
	if res2.StatusCode != http.StatusOK {
		t.Fatalf("suppression status = %d, want 200: %s", res2.StatusCode, bodyString(res2))
	}

	out := read()
	if strings.Contains(out, "\n[ALERT] FAKE") {
		t.Fatalf("a forged log line survived verbatim:\n%s", out)
	}
	for _, want := range []string{"%0A[ALERT] FAKE CRITICAL", "%0A[ALERT] FAKE SILENCE"} {
		if !strings.Contains(out, want) {
			t.Errorf("audit log lost the sanitized form %q:\n%s", want, out)
		}
	}
}

func TestAlertStatusPersistErrorHidesPath(t *testing.T) {
	if runtime.GOOS == "windows" {
		// os.Chmod on a directory is a no-op on Windows: the write into
		// ro/ succeeds and the API returns 200, so the 500-path exercised
		// below only exists on POSIX filesystems.
		t.Skip("POSIX file permission semantics not enforceable on Windows")
	}
	h, addr := newTestHub(t)
	ro := filepath.Join(t.TempDir(), "readonly")
	if err := os.MkdirAll(ro, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(ro, 0o555); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(ro, 0o755) })
	st, err := lifecycle.New(filepath.Join(ro, "lc.json"))
	if err != nil {
		t.Fatalf("lifecycle.New: %v", err)
	}
	h.SetLifecycle(st)

	read := captureLog(t)
	res := postJSON(t, fmt.Sprintf("http://%s/api/alerts/0123456789abcdef/status", addr),
		`{"status":"closed","note":"n","by":"b"}`)
	out := read()

	if res.StatusCode != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", res.StatusCode)
	}
	body := bodyString(res)
	if !strings.Contains(body, "persistence failed (see engine log)") {
		t.Fatalf("body lost the fact: %q", body)
	}
	if strings.Contains(body, ".tmp") || strings.Contains(body, ro) {
		t.Fatalf("body leaks server paths: %q", body)
	}
	if !strings.Contains(out, "persist FAILED") || !strings.Contains(out, ".tmp") {
		t.Errorf("engine log must keep the full detail for the operator:\n%s", out)
	}
}

// NOTE: the oversized-body case and the 404-JSON case are covered by
// 99875e2's TestSuppressionCreateLimitsBodySize and
// TestSuppressionDelete404BodyIsValidJSON in suppress_write_test.go —
// this file keeps only the deltas this round owns.

func TestSuppressionCreateEnforcesEntryCap(t *testing.T) {
	var sb strings.Builder
	for i := 0; i < suppress.MaxEntries; i++ {
		fmt.Fprintf(&sb, "- rule_id: r%04d\n  host: wks\n", i)
	}
	p := seedFile(t, sb.String())
	_, addr := newWriteHub(t, p, true)
	url := fmt.Sprintf("http://%s/api/suppressions", addr)

	res := postJSON(t, url, `{"rule_id":"brand-new","reason":"one too many"}`)
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 at the cap", res.StatusCode)
	}
	if body := bodyString(res); !strings.Contains(body, "entry cap") {
		t.Errorf("body should name the cap: %q", body)
	}

	// updates to an EXISTING pair do not grow the file: still allowed
	upd := postJSON(t, url, `{"rule_id":"r0000","host":"wks","reason":"refreshed"}`)
	if upd.StatusCode != http.StatusOK {
		t.Fatalf("update at the cap status = %d, want 200: %s", upd.StatusCode, bodyString(upd))
	}
}
