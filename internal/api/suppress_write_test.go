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

	"github.com/Ruby570bocadito/security-framework/internal/suppress"
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
