package api

// Integration tests for the suppression write surface (Director
// decision 6.1): opt-in via EnableSuppressionsWrite, 403 without it,
// file as source of truth, upsert by (rule_id, host) identity, exact
// pair semantics on DELETE, and the auth middleware still in front.

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/suppress"
	"gopkg.in/yaml.v3"
)

func newWriteHub(t *testing.T, path string, arm bool) (*Hub, string) {
	t.Helper()
	m := suppress.New()
	if err := m.LoadFile(path); err != nil {
		t.Fatalf("LoadFile: %v", err)
	}
	h, addr := newTestHub(t)
	h.SetSuppressions(m)
	if arm {
		h.EnableSuppressionsWrite(path)
	}
	return h, addr
}

// seedFile writes a suppressions YAML with the given raw content so a
// test can preload hand-written entries (expired ones included).
func seedFile(t *testing.T, content string) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "suppressions.yaml")
	if err := os.WriteFile(p, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	return p
}

func postJSON(t *testing.T, url, body string) *http.Response {
	t.Helper()
	res, err := http.Post(url, "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatalf("POST %s: %v", url, err)
	}
	return res
}

// delReq issues a DELETE (net/http ships no one-liner for it).
func delReq(t *testing.T, url string) *http.Response {
	t.Helper()
	req, err := http.NewRequest(http.MethodDelete, url, nil)
	if err != nil {
		t.Fatal(err)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("DELETE %s: %v", url, err)
	}
	return res
}

func decodeSuppressions(t *testing.T, res *http.Response) suppressPayload {
	t.Helper()
	defer res.Body.Close()
	if ct := res.Header.Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
		t.Fatalf("Content-Type = %q, want application/json", ct)
	}
	var p suppressPayload
	if err := json.NewDecoder(res.Body).Decode(&p); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	return p
}

func bodyString(res *http.Response) string {
	b, _ := io.ReadAll(res.Body)
	res.Body.Close()
	return string(b)
}

func TestSuppressionWriteForbiddenWithoutFlag(t *testing.T) {
	_, addr := newWriteHub(t, filepath.Join(t.TempDir(), "suppressions.yaml"), false)

	res := postJSON(t, fmt.Sprintf("http://%s/api/suppressions", addr), `{"rule_id":"r1"}`)
	if res.StatusCode != http.StatusForbidden {
		t.Fatalf("POST status = %d, want 403", res.StatusCode)
	}
	body := bodyString(res)
	want := `"error":"api writes are disabled: restart the engine with -api-write (or SF_API_WRITE=1) to allow suppression writes"`
	if !strings.Contains(body, want) {
		t.Fatalf("403 body = %s, want it to name the flag (%q)", body, want)
	}

	del := delReq(t, fmt.Sprintf("http://%s/api/suppressions?rule_id=r1", addr))
	if del.StatusCode != http.StatusForbidden {
		t.Fatalf("DELETE status = %d, want 403", del.StatusCode)
	}
}

func TestSuppressionCreateWritesFileAndManager(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "suppressions.yaml")
	h, addr := newWriteHub(t, p, true)

	res := postJSON(t, fmt.Sprintf("http://%s/api/suppressions", addr),
		`{"rule_id":"vss-delete","host":"LAB-WKS-01","reason":"change window"}`)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("POST status = %d, body %s", res.StatusCode, bodyString(res))
	}
	payload := decodeSuppressions(t, res)
	if payload.Active != 1 || len(payload.Entries) != 1 {
		t.Fatalf("payload = %+v, want one active entry", payload)
	}
	if payload.Entries[0].RuleID != "vss-delete" || payload.Entries[0].Host != "lab-wks-01" {
		t.Errorf("entry = %+v, want normalized rule/host", payload.Entries[0])
	}

	// the file is the source of truth: the entry must be on disk and the
	// manager must silence the pair immediately (no reload tick needed)
	data, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), "rule_id: vss-delete") {
		t.Errorf("file =\n%s, want the entry persisted", data)
	}
	if ok, _ := h.suppress.SuppressedAt("vss-delete", "LAB-WKS-01", time.Now()); !ok {
		t.Error("manager must suppress the pair right after the POST")
	}
}

func TestSuppressionCreateUpsertsOnSamePair(t *testing.T) {
	p := filepath.Join(t.TempDir(), "suppressions.yaml")
	_, addr := newWriteHub(t, p, true)
	url := fmt.Sprintf("http://%s/api/suppressions", addr)

	postJSON(t, url, `{"rule_id":"r1","host":"wks","reason":"first"}`)
	res := postJSON(t, url, `{"rule_id":"r1","host":"WKS","reason":"second"}`)
	payload := decodeSuppressions(t, res)
	if payload.Active != 1 || len(payload.Entries) != 1 {
		t.Fatalf("payload = %+v, want a single upserted entry", payload)
	}
	if payload.Entries[0].Reason != "second" {
		t.Errorf("reason = %q, want the second write to win", payload.Entries[0].Reason)
	}
}

func TestSuppressionCreateRejectsBadInput(t *testing.T) {
	p := filepath.Join(t.TempDir(), "suppressions.yaml")
	_, addr := newWriteHub(t, p, true)
	url := fmt.Sprintf("http://%s/api/suppressions", addr)

	cases := []struct {
		name   string
		body   string
		status int
		want   string
	}{
		{"vacuous entry", `{}`, 400, "both empty"},
		{"bad expires", `{"rule_id":"r1","expires":"tomorrow"}`, 400, "not RFC 3339"},
		{"malformed json", `{"rule_id":`, 400, "invalid JSON body"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			res := postJSON(t, url, c.body)
			defer res.Body.Close()
			if res.StatusCode != c.status {
				t.Fatalf("status = %d, want %d (body %s)", res.StatusCode, c.status, bodyString(res))
			}
			if b := bodyString(res); !strings.Contains(b, c.want) {
				t.Fatalf("body = %s, want it to contain %q", b, c.want)
			}
		})
	}
}

func TestSuppressionDeleteExactPair(t *testing.T) {
	p := seedFile(t, "- rule_id: r1\n- rule_id: r1\n  host: wks-a\n")
	_, addr := newWriteHub(t, p, true)
	base := fmt.Sprintf("http://%s/api/suppressions", addr)

	// host-less entry r1 must NOT be removed by a host-qualified query
	res := delReq(t, base+"?rule_id=r1&host=wks-a")
	payload := decodeSuppressions(t, res)
	if payload.Active != 1 || len(payload.Entries) != 1 {
		t.Fatalf("payload = %+v, want only the host-less r1 left", payload)
	}
	if payload.Entries[0].Host != "" {
		t.Errorf("remaining entry = %+v, want the host-less one", payload.Entries[0])
	}

	// removing it needs the host-less query; deleting again is 404
	res2 := delReq(t, base+"?rule_id=r1")
	if payload2 := decodeSuppressions(t, res2); payload2.Active != 0 {
		t.Fatalf("payload = %+v, want empty set", payload2)
	}
	res3 := delReq(t, base+"?rule_id=r1")
	if res3.StatusCode != http.StatusNotFound {
		t.Fatalf("second delete status = %d, want 404 (body %s)", res3.StatusCode, bodyString(res3))
	}

	// both params empty is a 400, not a wipe of the file
	del4 := delReq(t, base)
	defer del4.Body.Close()
	if del4.StatusCode != http.StatusBadRequest {
		t.Fatalf("delete without params status = %d, want 400", del4.StatusCode)
	}
}

func TestSuppressionWriteKeepsExpiredEntries(t *testing.T) {
	p := seedFile(t, "- rule_id: r-expired\n  expires: 2020-01-01T00:00:00Z\n")
	_, addr := newWriteHub(t, p, true)
	res := postJSON(t, fmt.Sprintf("http://%s/api/suppressions", addr), `{"rule_id":"r-new"}`)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("POST status = %d", res.StatusCode)
	}
	res.Body.Close()
	data, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), "rule_id: r-expired") {
		t.Errorf("expired entry was dropped from the file:\n%s", data)
	}
	if !strings.Contains(string(data), "rule_id: r-new") {
		t.Errorf("new entry missing from the file:\n%s", data)
	}
}

func TestSuppressionWriteStillBehindBearer(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "suppressions.yaml")
	h, addr := newWriteHub(t, p, true)
	h.SetToken("secret")

	res := postJSON(t, fmt.Sprintf("http://%s/api/suppressions", addr), `{"rule_id":"r1"}`)
	if res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("POST without bearer status = %d, want 401", res.StatusCode)
	}
	res.Body.Close()
	req, _ := http.NewRequest(http.MethodDelete,
		fmt.Sprintf("http://%s/api/suppressions?%s", addr, url.Values{"rule_id": {"r1"}}.Encode()), nil)
	res2, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res2.Body.Close()
	if res2.StatusCode != http.StatusUnauthorized {
		t.Fatalf("DELETE without bearer status = %d, want 401", res2.StatusCode)
	}
}

func TestSuppressionWriteServerErrorOnUnwritablePath(t *testing.T) {
	p := filepath.Join(t.TempDir(), "no", "such", "dir", "suppressions.yaml")
	_, addr := newWriteHub(t, p, true)
	res := postJSON(t, fmt.Sprintf("http://%s/api/suppressions", addr), `{"rule_id":"r1"}`)
	defer res.Body.Close()
	if res.StatusCode != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500 on an unwritable path", res.StatusCode)
	}
	// loud on the log, no internals in the body
	if b := bodyString(res); strings.Contains(b, "no such dir") {
		t.Errorf("500 body leaks the path: %s", b)
	}
}

// --- auditoría del agente-04 sobre el aterrizaje 6.1 (Director, informe
// 2026-09-30 04h53, asignación (i)): fichero como fuente única ante edits
// manuales concurrentes, cuerpo acotado como el otro write surface, y
// cuerpos de error JSON válidos ante query hostil. ---

// futureMtime forces a deterministic mtime delta so the drift check
// does not depend on the filesystem timestamp granularity (a manual
// edit landing within the same clock tick as the last load would
// otherwise flake the test, not the engine).
func futureMtime(t *testing.T, p string) {
	t.Helper()
	fut := time.Now().Add(2 * time.Second)
	if err := os.Chtimes(p, fut, fut); err != nil {
		t.Fatal(err)
	}
}

// The file is the source of truth and a hand edit made between two
// hot-reload ticks (up to the full 15s interval) must never be
// silently clobbered by an API write: the write picks it up before the
// read-modify-write. Pre-fix this test loses the manual entry.
func TestSuppressionWritePicksUpManualEdit(t *testing.T) {
	p := seedFile(t, "- rule_id: aaa\n  reason: manual base\n")
	_, addr := newWriteHub(t, p, true)

	// the operator edits the file by hand after the engine loaded it
	manual := "- rule_id: aaa\n  reason: manual base\n- rule_id: bbb\n  host: lab-wks-01\n  reason: hand added\n"
	if err := os.WriteFile(p, []byte(manual), 0o600); err != nil {
		t.Fatal(err)
	}
	futureMtime(t, p)

	res := postJSON(t, fmt.Sprintf("http://%s/api/suppressions", addr),
		`{"rule_id":"ccc","reason":"via api"}`)
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("POST: status %d, body %s", res.StatusCode, bodyString(res))
	}

	data, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	var onDisk []suppress.Entry
	if err := yaml.Unmarshal(data, &onDisk); err != nil {
		t.Fatalf("saved file does not parse: %v", err)
	}
	var ids []string
	for _, e := range onDisk {
		ids = append(ids, e.RuleID)
	}
	if len(ids) != 3 || ids[0] != "aaa" || ids[1] != "bbb" || ids[2] != "ccc" {
		t.Fatalf("manual edit lost by the API write: file has rule ids %v, want [aaa bbb ccc]", ids)
	}
}

// A drifted file that does not parse is most likely an operator edit in
// progress: overwriting it would destroy their work mid-flight. The
// write refuses with 409 and the file stays byte-identical; the manager
// keeps serving the last good set (same fail-loudly semantics as the
// hot-reload tick).
func TestSuppressionWriteRefusesBrokenDriftedFile(t *testing.T) {
	p := seedFile(t, "- rule_id: aaa\n")
	_, addr := newWriteHub(t, p, true)

	broken := "rule_id: [broken\n  reason: operator mid-edit"
	if err := os.WriteFile(p, []byte(broken), 0o600); err != nil {
		t.Fatal(err)
	}
	futureMtime(t, p)

	res := postJSON(t, fmt.Sprintf("http://%s/api/suppressions", addr),
		`{"rule_id":"ccc","reason":"via api"}`)
	defer res.Body.Close()
	if res.StatusCode != http.StatusConflict {
		t.Fatalf("POST on broken drifted file: status %d, want 409 (body %s)", res.StatusCode, bodyString(res))
	}

	data, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != broken {
		t.Fatalf("the broken manual edit was clobbered by the API write:\n%s", data)
	}
	// the manager keeps the last good set (GET still serves it)
	get, err := http.Get(fmt.Sprintf("http://%s/api/suppressions", addr))
	if err != nil {
		t.Fatal(err)
	}
	payload := decodeSuppressions(t, get)
	if payload.Active != 1 || len(payload.Entries) != 1 || payload.Entries[0].RuleID != "aaa" {
		t.Fatalf("manager lost the last good set after refusing the write: %+v", payload)
	}
}

// Both write surfaces cap the request body at 8 KiB: one suppression
// entry is a few hundred bytes, and an unbounded body would let a
// single authenticated request pin arbitrary memory.
func TestSuppressionCreateLimitsBodySize(t *testing.T) {
	p := seedFile(t, "")
	_, addr := newWriteHub(t, p, true)

	big := fmt.Sprintf(`{"rule_id":"r1","reason":"%s"}`, strings.Repeat("a", 9000))
	res := postJSON(t, fmt.Sprintf("http://%s/api/suppressions", addr), big)
	defer res.Body.Close()
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("oversized body: status %d, want 400", res.StatusCode)
	}
	if b := bodyString(res); !strings.Contains(b, "8 KiB") {
		t.Fatalf("oversized body message not actionable: %s", b)
	}
}

// The DELETE 404 echoes query values: those come from the request line,
// so a control character in rule_id must not break the JSON body (Go's
// %q emits \xNN, which JSON does not define - encoding/json emits \u0001).
func TestSuppressionDelete404BodyIsValidJSON(t *testing.T) {
	p := seedFile(t, "- rule_id: aaa\n")
	_, addr := newWriteHub(t, p, true)

	res := delReq(t, fmt.Sprintf("http://%s/api/suppressions?rule_id=x%%01y&host=h", addr))
	defer res.Body.Close()
	if res.StatusCode != http.StatusNotFound {
		t.Fatalf("DELETE unknown pair: status %d, want 404", res.StatusCode)
	}
	raw := bodyString(res)
	if !json.Valid([]byte(raw)) {
		t.Fatalf("404 body is not valid JSON: %q", raw)
	}
}

// Hostile strings in the API fields must round-trip as FIELD VALUES,
// never forge extra YAML entries (the same invariant the \\x1f hardening
// enforces for the store channel, now pinned for the suppression file):
// yaml.v3 quotes/block-scales the values, so the saved file holds
// exactly one entry and parses back to the very same strings.
func TestSuppressionsFieldsRoundTripWithoutForging(t *testing.T) {
	p := seedFile(t, "")
	_, addr := newWriteHub(t, p, true)

	hostile := map[string]string{
		"rule_id": "r1",
		"host":    "lab\nwks\"x---\ny",
		"reason":  "a\"b\\c\n---\n- rule_id: forged\n  host: evil",
	}
	raw, _ := json.Marshal(hostile)
	res := postJSON(t, fmt.Sprintf("http://%s/api/suppressions", addr), string(raw))
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("POST hostile fields: status %d, body %s", res.StatusCode, bodyString(res))
	}

	data, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	var onDisk []suppress.Entry
	if err := yaml.Unmarshal(data, &onDisk); err != nil {
		t.Fatalf("saved file does not parse: %v", err)
	}
	if len(onDisk) != 1 {
		t.Fatalf("hostile field values forged %d entries on disk, want exactly 1:\n%s", len(onDisk), data)
	}
	if onDisk[0].RuleID != hostile["rule_id"] || onDisk[0].Host != hostile["host"] || onDisk[0].Reason != hostile["reason"] {
		t.Fatalf("hostile fields did not round-trip verbatim: %+v", onDisk[0])
	}
}

// rule_id/host are client-controlled and echoed into the audit log:
// an embedded newline must not be able to forge log lines.
func TestSuppressWriteLogsSingleLine(t *testing.T) {
	p := seedFile(t, "")
	_, addr := newWriteHub(t, p, true)
	logs := captureLogs(t, func() {
		res := postJSON(t, fmt.Sprintf("http://%s/api/suppressions", addr),
			`{"rule_id":"r1\nFORGED [API] boot: auth DISABLED","host":"lab-wks-01","reason":"probe"}`)
		defer res.Body.Close()
		body, err := io.ReadAll(res.Body)
		if err != nil {
			t.Fatal(err)
		}
		if res.StatusCode != http.StatusOK {
			t.Fatalf("status = %d, want 200: %s", res.StatusCode, body)
		}
	})
	if strings.Contains(logs, "\nFORGED") {
		t.Fatalf("suppression audit log forged by an embedded newline in rule_id:\n%s", logs)
	}
	if !strings.Contains(logs, "rule=r1") {
		t.Fatalf("audit log lost the rule_id:\n%s", logs)
	}
}
