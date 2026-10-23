package notify

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/alert"
)

// The console writes `channels: []` when the last channel goes: that
// must load as zero channels, not stop the engine.
func TestExplicitEmptyChannelListLoads(t *testing.T) {
	s, err := Load(writeCfg(t, "channels: []\n"))
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if len(s.Stats()) != 0 {
		t.Fatalf("channels = %d, want 0", len(s.Stats()))
	}
}

func TestLoadOptionalTreatsAMissingFileAsNoChannels(t *testing.T) {
	s, err := LoadOptional(filepath.Join(t.TempDir(), "notify.yaml"))
	if err != nil || len(s.Stats()) != 0 {
		t.Fatalf("missing file: %v, %d channels", err, len(s.Stats()))
	}
	// a file that exists keeps the fail-loud contract
	if _, err := LoadOptional(writeCfg(t, "channels:\n  - type: pigeon\n")); err == nil {
		t.Fatal("a broken existing file must still fail")
	}
}

func TestConsoleURLIsValidated(t *testing.T) {
	for _, bad := range []string{"not-a-url", "ftp://soc.lab", "https://soc.lab/?x=1", "https://u:p@soc.lab", "https://soc.lab/#a"} {
		if _, err := Load(writeCfg(t, "console_url: "+bad+"\nchannels: []\n")); err == nil {
			t.Fatalf("console_url %q accepted", bad)
		}
	}
	s, err := Load(writeCfg(t, "console_url: https://soc.lab/consola/\nchannels: []\n"))
	if err != nil {
		t.Fatalf("valid console_url: %v", err)
	}
	if s.consoleURL != "https://soc.lab/consola" {
		t.Fatalf("consoleURL = %q, want the trailing slash trimmed", s.consoleURL)
	}
}

func TestAlertLink(t *testing.T) {
	a := alert.Alert{ID: "a b&c"}
	if got := alertLink("https://soc.lab", a); got != "https://soc.lab/?view=alertas&alert=a+b%26c" {
		t.Fatalf("link = %q", got)
	}
	if alertLink("", a) != "" || alertLink("https://soc.lab", alert.Alert{}) != "" {
		t.Fatal("no console_url or no id must give no link")
	}
}

func TestChatMessagesCarryTheAlertLink(t *testing.T) {
	var body atomic.Value
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var doc map[string]any
		_ = json.NewDecoder(r.Body).Decode(&doc)
		body.Store(doc)
	}))
	defer srv.Close()
	cfg := "console_url: https://soc.lab\nchannels:\n  - type: slack\n    url: " + srv.URL + "/hook\n"
	s, err := Load(writeCfg(t, cfg))
	if err != nil {
		t.Fatal(err)
	}
	if err := s.workers[0].ch.Deliver(context.Background(), sampleAlert()); err != nil {
		t.Fatal(err)
	}
	text, _ := body.Load().(map[string]any)["text"].(string)
	if !strings.HasSuffix(text, "\nhttps://soc.lab/?view=alertas&alert=LAB-0001") {
		t.Fatalf("slack text without the link: %q", text)
	}
}

func TestNtfyPublishesPriorityTagsAndClick(t *testing.T) {
	var got map[string]any
	var auth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		auth = r.Header.Get("Authorization")
		if r.URL.Path != "/" || r.Method != http.MethodPost {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		_ = json.NewDecoder(r.Body).Decode(&got)
	}))
	defer srv.Close()
	t.Setenv("SF_TEST_NTFY", "tk_secret")
	cfg := "console_url: https://soc.lab\nchannels:\n  - type: ntfy\n    name: movil\n    url: " + srv.URL + "/\n    topic: soc-alertas\n    token_env: SF_TEST_NTFY\n"
	s, err := Load(writeCfg(t, cfg))
	if err != nil {
		t.Fatal(err)
	}
	if s.Stats()[0].Type != "ntfy" {
		t.Fatalf("type = %q", s.Stats()[0].Type)
	}
	if err := s.workers[0].ch.Deliver(context.Background(), sampleAlert()); err != nil {
		t.Fatal(err)
	}
	if auth != "Bearer tk_secret" {
		t.Fatalf("authorization = %q", auth)
	}
	if got["topic"] != "soc-alertas" || got["priority"] != float64(5) || got["click"] != "https://soc.lab/?view=alertas&alert=LAB-0001" {
		t.Fatalf("payload = %v", got)
	}
	if !strings.HasPrefix(got["title"].(string), "[CRITICAL] LSASS dump via comsvcs @ LAB-WKS-01") {
		t.Fatalf("title = %v", got["title"])
	}
}

func TestNtfyConfigIsFailLoud(t *testing.T) {
	for name, cfg := range map[string]string{
		"no url":    "channels:\n  - type: ntfy\n    topic: a\n",
		"no topic":  "channels:\n  - type: ntfy\n    url: https://ntfy.lab\n",
		"bad topic": "channels:\n  - type: ntfy\n    url: https://ntfy.lab\n    topic: \"a/b\"\n",
		"env unset": "channels:\n  - type: ntfy\n    url: https://ntfy.lab\n    topic: a\n    token_env: SF_TEST_UNSET_NTFY\n",
	} {
		if _, err := Load(writeCfg(t, cfg)); err == nil {
			t.Fatalf("%s: accepted", name)
		}
	}
}

func TestNtfyPriorityFollowsSeverity(t *testing.T) {
	for sev, want := range map[string]int{"critical": 5, "high": 4, "medium": 3, "low": 2, "info": 1, "": 1} {
		if got := ntfyPriority(sev); got != want {
			t.Fatalf("%q -> %d, want %d", sev, got, want)
		}
	}
}

func TestMarshalRoundTrips(t *testing.T) {
	cfg, err := ParseConfig("x", []byte("console_url: https://soc.lab\nchannels:\n  - type: ntfy\n    url: https://ntfy.lab\n    topic: a\n    min_severity: high\n"))
	if err != nil {
		t.Fatal(err)
	}
	raw, err := cfg.Marshal()
	if err != nil {
		t.Fatal(err)
	}
	back, err := ParseConfig("x", raw)
	if err != nil || back.ConsoleURL != "https://soc.lab" || len(back.Channels) != 1 || back.Channels[0].MinSeverity != "high" {
		t.Fatalf("round trip: %v %+v\n%s", err, back, raw)
	}
	if strings.Contains(string(raw), "token") {
		t.Fatalf("empty fields must be omitted:\n%s", raw)
	}
	empty := &FileConfig{}
	raw, _ = empty.Marshal()
	if _, err := ParseConfig("x", raw); err != nil {
		t.Fatalf("an empty config must marshal to a loadable `channels: []`: %v\n%s", err, raw)
	}
}

type fakeChannel struct {
	name string
	err  error
	got  atomic.Int32
}

func (f *fakeChannel) Name() string { return f.name }
func (f *fakeChannel) Deliver(context.Context, alert.Alert) error {
	f.got.Add(1)
	return f.err
}
func (f *fakeChannel) Retryable(error) bool { return false }

func TestTestReachesTheNamedChannelsWithoutCounting(t *testing.T) {
	ok := &fakeChannel{name: "ok"}
	bad := &fakeChannel{name: "bad", err: errors.New("receiver answered 401")}
	s := New(ok, bad)
	all := s.Test(context.Background(), "")
	if len(all) != 2 || !all[0].OK || all[1].OK || all[1].Error != "receiver answered 401" {
		t.Fatalf("results = %+v", all)
	}
	one := s.Test(context.Background(), "bad")
	if len(one) != 1 || one[0].Name != "bad" {
		t.Fatalf("named = %+v", one)
	}
	if len(s.Test(context.Background(), "nadie")) != 0 {
		t.Fatal("an unknown name must test nothing")
	}
	for _, st := range s.Stats() {
		if st.Sent+st.Failed != 0 {
			t.Fatalf("a test must not count as a delivery: %+v", st)
		}
	}
	if TestAlert(time.Now()).ID != "" {
		t.Fatal("the test message must carry no alert id (no link to nothing)")
	}
}

func TestLiveSwapsWithoutLosingTheQueue(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	first := &fakeChannel{name: "first"}
	second := &fakeChannel{name: "second"}
	l := NewLive(ctx, New(first))
	l.Handle(sampleAlert())
	l.Swap(New(second))
	l.Handle(sampleAlert())
	if got := l.Summary(); len(got) != 1 || !strings.HasPrefix(got[0], "second") {
		t.Fatalf("summary after swap = %v", got)
	}
	cancel()
	l.Wait()
	if first.got.Load() != 1 || second.got.Load() != 1 {
		t.Fatalf("deliveries: first %d, second %d (each must get its own alert)", first.got.Load(), second.got.Load())
	}
}

// The shipped example must load as documented (with its *_env secrets
// set), ntfy channel included.
func TestShippedExampleLoads(t *testing.T) {
	t.Setenv("SF_TELEGRAM_TOKEN", "123:abc")
	t.Setenv("SF_SMTP_USER", "u")
	t.Setenv("SF_SMTP_PASSWORD", "p")
	s, err := Load(filepath.Join("..", "..", "notify.example.yaml"))
	if err != nil {
		t.Fatalf("notify.example.yaml: %v", err)
	}
	types := map[string]bool{}
	for _, st := range s.Stats() {
		types[st.Type] = true
	}
	for _, want := range []string{"slack", "telegram", "email", "ntfy"} {
		if !types[want] {
			t.Fatalf("the example lacks a %s channel: %v", want, s.Summary())
		}
	}
}
