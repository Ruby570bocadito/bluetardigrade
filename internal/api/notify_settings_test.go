package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/notify"
)

// armNotify arms the surface on a fresh -notify path with the engine's
// own Live wrapper, exactly as cmd/engine wires it.
func armNotify(t *testing.T, h *Hub, content string) (string, *notify.Live) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "config", "notify.yaml")
	if content != "" {
		if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	svc, err := notify.LoadOptional(path)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	live := notify.NewLive(ctx, svc)
	t.Cleanup(func() { cancel(); live.Wait() })
	h.SetNotifyStats(live.Stats)
	h.SetNotifySettings(path, live)
	return path, live
}

// chatReceiver is a stand-in Slack/ntfy endpoint recording what it got.
type chatReceiver struct {
	mu     sync.Mutex
	bodies []map[string]any
	status int
}

func (c *chatReceiver) server(t *testing.T) *httptest.Server {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var doc map[string]any
		_ = json.NewDecoder(r.Body).Decode(&doc)
		c.mu.Lock()
		c.bodies = append(c.bodies, doc)
		status := c.status
		c.mu.Unlock()
		if status != 0 {
			w.WriteHeader(status)
		}
	}))
	t.Cleanup(srv.Close)
	return srv
}

func TestNotifySettingsGates(t *testing.T) {
	h, addr := newTestHub(t)
	for _, tc := range []struct{ method, path string }{
		{"GET", "/api/settings/notify"}, {"PUT", "/api/settings/notify"}, {"POST", "/api/notify/test"},
	} {
		res, _ := doJSON(t, tc.method, "http://"+addr+tc.path, "{}")
		if res.StatusCode != http.StatusForbidden {
			t.Fatalf("%s %s without -api-write: %d, want 403", tc.method, tc.path, res.StatusCode)
		}
	}
	armWrites(h)
	res, raw := doJSON(t, "GET", "http://"+addr+"/api/settings/notify", "")
	if res.StatusCode != http.StatusNotImplemented || !strings.Contains(raw, "-notify") {
		t.Fatalf("without -notify: %d %s, want 501 with the arming hint", res.StatusCode, raw)
	}
}

func TestNotifySettingsGetNeverServesSecrets(t *testing.T) {
	h, addr := newTestHub(t)
	armWrites(h)
	armNotify(t, h, `console_url: https://soc.lab
channels:
  - type: slack
    name: soc
    url: https://hooks.slack.com/services/T0/B0/SECRETPATH
  - type: telegram
    name: guardia
    token: "123:SECRETTOKEN"
    chat_id: "-100"
  - type: email
    name: correo
    server: relay.lab:587
    from: sf@lab
    to: [soc@lab]
    username: sf
    password: SECRETPASS
`)
	res, raw := doJSON(t, "GET", "http://"+addr+"/api/settings/notify", "")
	if res.StatusCode != http.StatusOK {
		t.Fatalf("GET: %d %s", res.StatusCode, raw)
	}
	for _, secret := range []string{"SECRETPATH", "SECRETTOKEN", "SECRETPASS"} {
		if strings.Contains(raw, secret) {
			t.Fatalf("GET leaked %s: %s", secret, raw)
		}
	}
	var doc notifySettingsWire
	if err := json.Unmarshal([]byte(raw), &doc); err != nil {
		t.Fatal(err)
	}
	if doc.ConsoleURL != "https://soc.lab" || len(doc.Channels) != 3 || len(doc.Stats) != 3 {
		t.Fatalf("doc = %+v", doc)
	}
	slack, tg, mail := doc.Channels[0], doc.Channels[1], doc.Channels[2]
	if !slack.URLSet || slack.URL != "" || slack.URLLabel != "https://hooks.slack.com" {
		t.Fatalf("slack = %+v", slack)
	}
	if !tg.TokenSet || tg.Token != "" || tg.ChatID != "-100" {
		t.Fatalf("telegram = %+v", tg)
	}
	if !mail.PasswordSet || mail.Password != "" || mail.Username != "sf" {
		t.Fatalf("email = %+v", mail)
	}
}

func TestNotifySettingsPutCreatesTheFileAndSwapsLive(t *testing.T) {
	recv := &chatReceiver{}
	srv := recv.server(t)
	h, addr := newTestHub(t)
	armWrites(h)
	path, live := armNotify(t, h, "") // no file yet: the console creates it
	if len(live.Summary()) != 0 {
		t.Fatal("a missing file must start with no channels")
	}
	body := `{"console_url":"https://soc.lab","channels":[{"type":"ntfy","name":"movil","min_severity":"high","url":"` + srv.URL + `","topic":"soc"}]}`
	res, raw := doJSON(t, "PUT", "http://"+addr+"/api/settings/notify", body)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("PUT: %d %s", res.StatusCode, raw)
	}
	// Windows has no POSIX mode bits: Go reports 0666 for any writable file
	// (the ACL comes from the directory), so the mode is asserted elsewhere only.
	if info, err := os.Stat(path); err != nil || (runtime.GOOS != "windows" && info.Mode().Perm() != 0o600) {
		t.Fatalf("file not committed 0600: %v %v", err, info)
	}
	if got := live.Summary(); len(got) != 1 || got[0] != "movil (ntfy)" {
		t.Fatalf("live channels after PUT = %v", got)
	}
	// the swapped-in channel is the one alerts reach
	a := notify.TestAlert(timeNowForTest())
	a.ID, a.Severity = "abc", "critical"
	live.Handle(a)
	waitFor(t, func() bool { recv.mu.Lock(); defer recv.mu.Unlock(); return len(recv.bodies) == 1 })
	if recv.bodies[0]["click"] != "https://soc.lab/?view=alertas&alert=abc" {
		t.Fatalf("ntfy payload = %v", recv.bodies[0])
	}
}

func TestNotifySettingsPutKeepsSecretsLeftEmpty(t *testing.T) {
	h, addr := newTestHub(t)
	armWrites(h)
	path, _ := armNotify(t, h, `channels:
  - type: slack
    name: soc
    url: https://hooks.slack.com/services/T0/B0/KEEPME
  - type: telegram
    name: guardia
    token: "123:KEEPTOKEN"
    chat_id: "-100"
`)
	// the console sends back what GET gave it, editing a floor only
	body := `{"console_url":"","channels":[
	  {"type":"slack","name":"soc","min_severity":"critical"},
	  {"type":"telegram","name":"guardia","chat_id":"-200"}]}`
	if res, raw := doJSON(t, "PUT", "http://"+addr+"/api/settings/notify", body); res.StatusCode != http.StatusOK {
		t.Fatalf("PUT: %d %s", res.StatusCode, raw)
	}
	cfg, _, _, err := notify.ReadFileConfig(path)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Channels[0].URL != "https://hooks.slack.com/services/T0/B0/KEEPME" || cfg.Channels[0].MinSeverity != "critical" {
		t.Fatalf("slack = %+v", cfg.Channels[0])
	}
	if cfg.Channels[1].Token != "123:KEEPTOKEN" || cfg.Channels[1].ChatID != "-200" {
		t.Fatalf("telegram = %+v", cfg.Channels[1])
	}
	// clear_secret drops the literal: a telegram without token is refused
	res, _ := doJSON(t, "PUT", "http://"+addr+"/api/settings/notify",
		`{"channels":[{"type":"telegram","name":"guardia","chat_id":"-200","clear_secret":true}]}`)
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("clearing the only credential: %d, want 400", res.StatusCode)
	}
	// a renamed channel is a new channel: it inherits nothing
	res, _ = doJSON(t, "PUT", "http://"+addr+"/api/settings/notify",
		`{"channels":[{"type":"telegram","name":"otro","chat_id":"-200"}]}`)
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("a new channel without its token: %d, want 400", res.StatusCode)
	}
}

func TestNotifySettingsPutRejectsAndRefusesDrift(t *testing.T) {
	h, addr := newTestHub(t)
	armWrites(h)
	path, live := armNotify(t, h, "channels: []\n")
	for name, body := range map[string]string{
		"unknown type":  `{"channels":[{"type":"pigeon"}]}`,
		"bad console":   `{"console_url":"ftp://x","channels":[]}`,
		"unknown field": `{"channels":[],"extra":1}`,
		"no channels":   `{"console_url":""}`,
	} {
		if res, _ := doJSON(t, "PUT", "http://"+addr+"/api/settings/notify", body); res.StatusCode != http.StatusBadRequest {
			t.Fatalf("%s: %d, want 400", name, res.StatusCode)
		}
	}
	if len(live.Summary()) != 0 {
		t.Fatal("a rejected PUT must not swap anything")
	}
	if err := os.WriteFile(path, []byte("channels: []\n# hand edit\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if res, _ := doJSON(t, "PUT", "http://"+addr+"/api/settings/notify", `{"channels":[]}`); res.StatusCode != http.StatusConflict {
		t.Fatalf("drifted file: %d, want 409", res.StatusCode)
	}
}

func TestNotifyTestAnswersPerChannel(t *testing.T) {
	good := &chatReceiver{}
	bad := &chatReceiver{status: http.StatusUnauthorized}
	h, addr := newTestHub(t)
	armWrites(h)
	armNotify(t, h, `channels:
  - type: slack
    name: bien
    url: `+good.server(t).URL+`/hook
  - type: slack
    name: mal
    url: `+bad.server(t).URL+`/hook
`)
	res, raw := doJSON(t, "POST", "http://"+addr+"/api/notify/test", `{}`)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("test all: %d %s", res.StatusCode, raw)
	}
	var doc struct{ Results []notify.TestResult }
	_ = json.Unmarshal([]byte(raw), &doc)
	if len(doc.Results) != 2 || !doc.Results[0].OK || doc.Results[1].OK || !strings.Contains(doc.Results[1].Error, "401") {
		t.Fatalf("results = %+v", doc.Results)
	}
	if strings.Contains(raw, "/hook") {
		t.Fatalf("a test answer must not echo the endpoint: %s", raw)
	}
	res, _ = doJSON(t, "POST", "http://"+addr+"/api/notify/test", `{"name":"bien"}`)
	if res.StatusCode != http.StatusOK || len(good.bodies) != 2 {
		t.Fatalf("named test: %d, good got %d", res.StatusCode, len(good.bodies))
	}
	if res, _ := doJSON(t, "POST", "http://"+addr+"/api/notify/test", `{"name":"nadie"}`); res.StatusCode != http.StatusNotFound {
		t.Fatalf("unknown channel: %d, want 404", res.StatusCode)
	}
}

func timeNowForTest() time.Time { return time.Now() }

// waitFor polls cond for up to two seconds (asynchronous delivery).
func waitFor(t *testing.T, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatal("condition not reached within 2s")
		}
		time.Sleep(10 * time.Millisecond)
	}
}
