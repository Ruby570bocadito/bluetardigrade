package api

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/alert"
	"github.com/Ruby570bocadito/bluetardigrade/internal/forensic"
	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
)

// getForensics hits the endpoint and returns status + body (errors are
// NOT fatal: the assertions below own the expectations).
func getForensics(t *testing.T, url string) (int, string) {
	t.Helper()
	res, err := http.Get(url)
	if err != nil {
		t.Fatalf("GET %s: %v", url, err)
	}
	defer res.Body.Close()
	data, err := io.ReadAll(res.Body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	return res.StatusCode, string(data)
}

// The full round trip: record events, capture a bundle through the
// same recorder the engine wires, read it back through the API.
func TestForensicsEndpointServesBundle(t *testing.T) {
	h, addr := newTestHub(t)
	dir := t.TempDir()
	r := forensic.New(dir)
	h.SetForensic(r)

	now := time.Now().UTC()
	r.ObserveEvent(&model.Event{
		ID: "e1", Timestamp: now.Add(-time.Minute), Type: model.TypeProcessCreate,
		Host: "LAB-TEST", Process: &model.Process{PID: 1, Name: "cmd.exe"},
	})
	a := alert.Alert{
		ID: "0123456789abcdef", Timestamp: now.Format(time.RFC3339),
		RuleID: "r1", RuleName: "test rule", Severity: "critical", Host: "LAB-TEST",
		EventID: "e1", EventType: "process.create", Summary: "s",
	}
	if _, ok, err := r.Capture(a, now); err != nil || !ok {
		t.Fatalf("Capture: ok=%v err=%v", ok, err)
	}

	var b map[string]any
	url := fmt.Sprintf("http://%s/api/alerts/0123456789abcdef/forensics", addr)
	res, err := http.Get(url)
	if err != nil {
		t.Fatalf("GET: %v", err)
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		t.Fatalf("status = %d, want 200", res.StatusCode)
	}
	if err := json.NewDecoder(res.Body).Decode(&b); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if b["host"] != "LAB-TEST" {
		t.Fatalf("host = %v", b["host"])
	}
	alertObj, _ := b["alert"].(map[string]any)
	if alertObj == nil || alertObj["id"] != "0123456789abcdef" {
		t.Fatalf("alert = %v", b["alert"])
	}
	tl, _ := b["timeline"].([]any)
	if len(tl) != 1 {
		t.Fatalf("timeline = %d entries, want 1", len(tl))
	}
	summary, _ := b["summary"].(map[string]any)
	if summary == nil || summary["process_creates"] != float64(1) {
		t.Fatalf("summary = %v", b["summary"])
	}
}

// The distinct failure states are distinct status codes: missing
// bundle is 404, feature off is 501, malformed id is 400.
func TestForensicsEndpointStatusCodes(t *testing.T) {
	h, addr := newTestHub(t)
	base := fmt.Sprintf("http://%s/api/alerts", addr)

	// no recorder wired: feature off -> 501
	code, body := getForensics(t, base+"/0123456789abcdef/forensics")
	if code != 501 || !strings.Contains(body, "disabled") {
		t.Fatalf("no recorder: code=%d body=%s", code, body)
	}

	// recorder with an empty dir answers ErrDisabled -> also 501
	h.SetForensic(forensic.New(""))
	code, _ = getForensics(t, base+"/0123456789abcdef/forensics")
	if code != 501 {
		t.Fatalf("disabled recorder: code=%d, want 501", code)
	}

	// enabled recorder, no bundle for the id -> 404
	dir := t.TempDir()
	h.SetForensic(forensic.New(dir))
	code, body = getForensics(t, base+"/0123456789abcdef/forensics")
	if code != 404 || !strings.Contains(body, "no forensic bundle") {
		t.Fatalf("missing bundle: code=%d body=%s", code, body)
	}

	// malformed ids -> 400 (before any filesystem probing)
	for _, id := range []string{"short", "0123456789ABCDEF", "0123456789abcdeG"} {
		code, _ = getForensics(t, base+"/"+id+"/forensics")
		if code != 400 {
			t.Fatalf("id %q: code=%d, want 400", id, code)
		}
	}
}

// A bundle that exists but cannot be decoded is an integrity failure:
// 500 with a generic body, details only in the engine log.
func TestForensicsEndpointCorruptBundle(t *testing.T) {
	h, addr := newTestHub(t)
	dir := t.TempDir()
	h.SetForensic(forensic.New(dir))

	if err := os.WriteFile(filepath.Join(dir, "0123456789abcdef.json"), []byte(`{nope`), 0o600); err != nil {
		t.Fatal(err)
	}
	code, body := getForensics(t, fmt.Sprintf("http://%s/api/alerts/0123456789abcdef/forensics", addr))
	if code != 500 || strings.Contains(body, dir) {
		t.Fatalf("corrupt bundle: code=%d body=%s (local paths must not leak)", code, body)
	}
}

// The bearer gate covers the forensics route like every protected
// operation: 401 without the token, 200 with it.
func TestForensicsEndpointBearerGate(t *testing.T) {
	h, addr := newTestHub(t)
	h.SetToken("sekrit")
	dir := t.TempDir()
	r := forensic.New(dir)
	h.SetForensic(r)

	now := time.Now().UTC()
	a := alert.Alert{
		ID: "0123456789abcdef", Timestamp: now.Format(time.RFC3339),
		RuleID: "r1", RuleName: "test rule", Severity: "high", Host: "H",
		EventID: "e1", EventType: "process.create", Summary: "s",
	}
	if _, ok, err := r.Capture(a, now); err != nil || !ok {
		t.Fatalf("Capture: ok=%v err=%v", ok, err)
	}

	url := fmt.Sprintf("http://%s/api/alerts/0123456789abcdef/forensics", addr)
	code, _ := getForensics(t, url)
	if code != 401 {
		t.Fatalf("no token: code=%d, want 401", code)
	}

	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer sekrit")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		t.Fatalf("with token: code=%d, want 200", res.StatusCode)
	}
}
