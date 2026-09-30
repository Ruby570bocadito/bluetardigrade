package api

import (
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"testing"

	"github.com/Ruby570bocadito/security-framework/internal/respond"
)

// armedRespondReadHub builds a hub with the kill surface armed AND the
// file paths registered (SetRespondPaths), returning the base URL and
// the audit path so tests can append records with the real writer.
func armedRespondReadHub(t *testing.T) (string, string) {
	t.Helper()
	h, base := newTestHub(t)
	dir := t.TempDir()
	auditPath := filepath.Join(dir, "audit.jsonl")
	a, err := respond.OpenAudit(auditPath)
	if err != nil {
		t.Fatalf("OpenAudit: %v", err)
	}
	t.Cleanup(func() { _ = a.Close() })
	m := respond.NewManager(respondHostNameForTest(), a)
	opsPath := filepath.Join(dir, "ops.yaml")
	if err := os.WriteFile(opsPath, []byte("version: 1\nnames:\n  - ana\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := m.LoadOperators(opsPath); err != nil {
		t.Fatalf("LoadOperators: %v", err)
	}
	h.EnableRespondKill(m)
	h.SetRespondPaths(opsPath, "", auditPath)
	return base, auditPath
}

func getRespondJSON(t *testing.T, url string) (int, map[string]any, string) {
	t.Helper()
	res, err := http.Get(url)
	if err != nil {
		t.Fatalf("GET: %v", err)
	}
	defer res.Body.Close()
	data, err := io.ReadAll(res.Body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	var out map[string]any
	if len(data) > 0 {
		_ = json.Unmarshal(data, &out)
	}
	return res.StatusCode, out, string(data)
}

// disarmed: both read routes answer a REAL 404, byte-identical to any
// unknown path — the §2.1 contract extends to the read surface (a
// probe must not learn the engine has a respond subsystem at all).
func TestRespondReadDisarmedIsReal404(t *testing.T) {
	h, base := newTestHub(t)
	_ = h
	for _, path := range []string{"/api/respond/state", "/api/respond/audit"} {
		st, _, body := getRespondJSON(t, "http://"+base+path)
		if st != http.StatusNotFound {
			t.Fatalf("%s disarmed: status %d, want 404", path, st)
		}
		_, _, unknown := getRespondJSON(t, "http://"+base+"/api/definitely-not-a-route")
		if body != unknown {
			t.Fatalf("%s disarmed body differs from an unknown path:\n%s\n---\n%s", path, body, unknown)
		}
	}
}

// armed state: the flags state travels verbatim — live counts, paths,
// signal and the audit file health against its ceiling.
func TestRespondStateArmedShape(t *testing.T) {
	base, auditPath := armedRespondReadHub(t)
	st, out, _ := getRespondJSON(t, "http://"+base+"/api/respond/state")
	if st != http.StatusOK {
		t.Fatalf("status %d, want 200", st)
	}
	if out["armed"] != true {
		t.Fatalf("armed=%v, want true", out["armed"])
	}
	if out["signal"] != "SIGKILL" {
		t.Fatalf("signal=%v, want SIGKILL (Q1: fixed)", out["signal"])
	}
	if out["operators_count"].(float64) != 1 {
		t.Fatalf("operators_count=%v, want 1", out["operators_count"])
	}
	if out["protected_count"].(float64) != 0 {
		t.Fatalf("protected_count=%v, want 0", out["protected_count"])
	}
	if out["operators_path"] == "" {
		t.Fatalf("operators_path empty, want the armed path")
	}
	// protected_path is omitempty: an optional file the operator never
	// configured simply does not travel in the payload
	if pp, ok := out["protected_path"]; ok && pp != "" {
		t.Fatalf("protected_path=%q, want absent/empty (optional file not configured)", pp)
	}
	if out["audit_path"] != auditPath {
		t.Fatalf("audit_path=%v, want %s", out["audit_path"], auditPath)
	}
	if out["audit_ceiling"].(float64) != float64(respond.MaxAuditBytes) {
		t.Fatalf("audit_ceiling=%v, want %d", out["audit_ceiling"], respond.MaxAuditBytes)
	}
	if size, ok := out["audit_size"].(float64); !ok || size < 0 {
		t.Fatalf("audit_size=%v, want a non-negative number", out["audit_size"])
	}
}

// audit tail: records written through the real writer come back newest
// first with the scan bookkeeping honest.
func TestRespondAuditTailRecords(t *testing.T) {
	base, auditPath := armedRespondReadHub(t)

	// empty file first: no records, nothing skipped, nothing truncated
	st, out, _ := getRespondJSON(t, "http://"+base+"/api/respond/audit")
	if st != http.StatusOK {
		t.Fatalf("empty audit: status %d, want 200", st)
	}
	if len(out["records"].([]any)) != 0 || out["skipped"].(float64) != 0 || out["truncated"] != false {
		t.Fatalf("empty audit payload: %v", out)
	}

	// two records through the real append+fsync path
	a, err := respond.OpenAudit(auditPath)
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	for i, dec := range []string{"executed", "denied"} {
		if werr := a.Write(respond.Record{
			TS: "2026-09-30T18:00:0" + string(rune('1'+i)) + "Z", ActionID: "aa" + string(rune('1'+i)),
			Decision: dec, PID: 4242, Process: "evil.exe", Operator: "ana",
			Reason: "triage", Host: "lab", Signal: "SIGKILL", Source: "127.0.0.1:5000",
		}); werr != nil {
			t.Fatalf("write %d: %v", i, werr)
		}
	}
	_ = a.Close()

	st, out, _ = getRespondJSON(t, "http://"+base+"/api/respond/audit?limit=1")
	if st != http.StatusOK {
		t.Fatalf("tail: status %d, want 200", st)
	}
	recs := out["records"].([]any)
	if len(recs) != 1 {
		t.Fatalf("limit=1 returned %d records, want 1", len(recs))
	}
	first := recs[0].(map[string]any)
	if first["action_id"] != "aa2" || first["decision"] != "denied" {
		t.Fatalf("newest first broken: %v", first)
	}
	if first["signal"] != "SIGKILL" || first["process_name"] != "evil.exe" {
		t.Fatalf("record schema lost fields: %v", first)
	}

	// the default limit (no query) serves every record a small file has
	st, out, _ = getRespondJSON(t, "http://"+base+"/api/respond/audit")
	if st != http.StatusOK || len(out["records"].([]any)) != 2 {
		t.Fatalf("default limit: status %d records %v, want 200 and 2", st, out["records"])
	}
}

// the audit route never serves a file it was not armed with: the path
// travels from the engine wiring, and a wiring gap must fail loud
// rather than invent an empty feed.
func TestRespondAuditPathWiringIsHonest(t *testing.T) {
	h, base := newTestHub(t)
	_ = h
	a, err := respond.OpenAudit(filepath.Join(t.TempDir(), "audit.jsonl"))
	if err != nil {
		t.Fatalf("OpenAudit: %v", err)
	}
	t.Cleanup(func() { _ = a.Close() })
	m := respond.NewManager(respondHostNameForTest(), a)
	h.EnableRespondKill(m)
	// SetRespondPaths NOT called: defensive branch, unreachable in the
	// real wiring (armed implies an opened file) — the handler answers
	// 500 instead of a fabricated empty state.
	st, _, _ := getRespondJSON(t, "http://"+base+"/api/respond/audit")
	if st != http.StatusInternalServerError {
		t.Fatalf("wiring gap: status %d, want 500 (fail loud)", st)
	}
}
