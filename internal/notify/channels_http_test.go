package notify

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestSlackDeliversRenderedText(t *testing.T) {
	var got map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		if err := json.Unmarshal(body, &got); err != nil {
			t.Errorf("payload is not JSON: %v", err)
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	ch := NewSlack("soc-slack", srv.URL)
	if err := ch.Deliver(context.Background(), sampleAlert()); err != nil {
		t.Fatalf("Deliver: %v", err)
	}
	text, _ := got["text"].(string)
	if !strings.Contains(text, "[CRITICAL] LSASS dump via comsvcs @ LAB-WKS-01") {
		t.Fatalf("slack text wrong: %q", text)
	}
	if strings.Contains(text, `"rule_id"`) {
		t.Fatal("slack payload must carry the human line, not the raw JSON")
	}
}

func TestSlackClassifiesAnswers(t *testing.T) {
	a := sampleAlert()
	cases := []struct {
		code      int
		retryable bool
	}{
		{429, true}, {500, true}, {503, true},
		{400, false}, {401, false}, {404, false},
	}
	for _, tc := range cases {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(tc.code)
		}))
		ch := NewSlack("s", srv.URL)
		err := ch.Deliver(context.Background(), a)
		srv.Close()
		if err == nil {
			t.Fatalf("code %d: expected error", tc.code)
		}
		if got := ch.Retryable(err); got != tc.retryable {
			t.Fatalf("code %d: retryable = %v, want %v", tc.code, got, tc.retryable)
		}
	}
	// 2xx answers are successes, not errors.
	for _, code := range []int{200, 201, 204} {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(code)
		}))
		ch := NewSlack("s", srv.URL)
		if err := ch.Deliver(context.Background(), a); err != nil {
			t.Fatalf("code %d: unexpected error: %v", code, err)
		}
		srv.Close()
	}
}

func TestSlackRetriesThenSucceeds(t *testing.T) {
	var calls int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls++
		if calls < 3 {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	// Retries live in the worker loop (same contract as the engine
	// webhook): exercise the retry path through a Service.
	s := New(NewSlack("s", srv.URL))
	s.backoff = time.Millisecond
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	s.Run(ctx)
	s.Handle(sampleAlert())
	waitFor(t, func() bool { return s.Stats()[0].Sent == 1 })
	cancel()
	s.Wait()
	if calls != 3 {
		t.Fatalf("calls = %d, want 3 (two retries then success)", calls)
	}
}

func TestTelegramSendsChatIDAndText(t *testing.T) {
	var got map[string]any
	var path string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path = r.URL.Path
		body, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(body, &got)
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"ok":true,"result":{"message_id":7}}`))
	}))
	defer srv.Close()

	ch := NewTelegram("soc-tg", "12345:SECRET", "-100998877", srv.URL)
	if err := ch.Deliver(context.Background(), sampleAlert()); err != nil {
		t.Fatalf("Deliver: %v", err)
	}
	if want := "/bot12345:SECRET/sendMessage"; path != want {
		t.Fatalf("path = %q, want %q", path, want)
	}
	if got["chat_id"] != "-100998877" {
		t.Fatalf("chat_id = %v", got["chat_id"])
	}
	if txt, _ := got["text"].(string); !strings.Contains(txt, "[CRITICAL]") {
		t.Fatalf("text wrong: %q", txt)
	}
	if got["disable_web_page_preview"] != true {
		t.Fatal("disable_web_page_preview must be requested")
	}
}

func TestTelegramDefaultsToOfficialEndpoint(t *testing.T) {
	ch := NewTelegram("tg", "tok", "chat", "")
	if ch.apiURL != "https://api.telegram.org" {
		t.Fatalf("apiURL default = %q", ch.apiURL)
	}
	if ch.apiURL+"/bottok/sendMessage" != "https://api.telegram.org/bottok/sendMessage" {
		t.Fatal("endpoint composition changed")
	}
}

func TestTelegramTruncatesOversizedText(t *testing.T) {
	var got map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(body, &got)
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	a := sampleAlert()
	a.Summary = strings.Repeat("á", 5000) // multi-byte, exercises rune-safety
	ch := NewTelegram("tg", "tok", "chat", srv.URL)
	if err := ch.Deliver(context.Background(), a); err != nil {
		t.Fatalf("Deliver: %v", err)
	}
	txt, _ := got["text"].(string)
	if runes := len([]rune(txt)); runes > maxChatRunes {
		t.Fatalf("text = %d runes, cap %d", runes, maxChatRunes)
	}
	if !strings.HasSuffix(txt, "…") {
		t.Fatalf("truncated text should end with an ellipsis")
	}
}

func TestHTTPChannelsCarryHardTimeout(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		time.Sleep(2 * time.Second)
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	ch := NewSlack("slow", srv.URL)
	ch.hc = newTimeoutClient(100 * time.Millisecond) // shrink the cap for the test
	start := time.Now()
	err := ch.Deliver(context.Background(), sampleAlert())
	elapsed := time.Since(start)
	if err == nil {
		t.Fatal("expected timeout error")
	}
	if elapsed > time.Second {
		t.Fatalf("timeout took %v, the hard cap did not apply", elapsed)
	}
}

// Regression (04-B): transport errors used to carry the *url.Error
// verbatim, and *url.Error echoes the full request URL — for Telegram
// that URL embeds the bot token in its path (Bot API contract) and for
// Slack the hook URL IS the credential. A routine timeout, refused
// connection or DNS failure used to pin that secret to the engine log
// via deliver()'s log.Printf. The redaction must keep the retry
// classification (transport errors stay retryable) and the cause.

func TestPostJSONRedactsCredentialURLFromTransportErrors(t *testing.T) {
	const secret = "123456:ABC-SECRET-TOKEN"
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		time.Sleep(500 * time.Millisecond) // outlast the shrunken client timeout
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	payload := []byte(`{"chat_id":"1","text":"x"}`)
	credentialed := srv.URL + "/bot" + secret + "/sendMessage"
	hc := &http.Client{Timeout: 50 * time.Millisecond}
	err := postJSON(context.Background(), hc, credentialed, payload)
	if err == nil {
		t.Fatal("expected transport error")
	}
	if !isRetryable(err) {
		t.Fatalf("transport error must stay retryable, got: %v", err)
	}
	if strings.Contains(err.Error(), secret) {
		t.Fatalf("transport error leaks the credential-bearing URL: %v", err)
	}
	if !strings.Contains(err.Error(), "Client.Timeout") && !strings.Contains(err.Error(), "deadline") {
		t.Fatalf("redacted error lost the underlying cause: %v", err)
	}
}

func TestPostJSONRedactsCredentialURLFromBuildErrors(t *testing.T) {
	const secret = "123456:ABC-SECRET-TOKEN"
	// Invalid port byte: url.Parse fails while echoing the raw input.
	bad := "http://127.0.0.1:%/bot" + secret + "/sendMessage"
	err := postJSON(context.Background(), &http.Client{}, bad, []byte(`{}`))
	if err == nil {
		t.Fatal("expected build error")
	}
	if isRetryable(err) {
		t.Fatalf("a URL the client cannot build will not heal, must be permanent: %v", err)
	}
	if strings.Contains(err.Error(), secret) {
		t.Fatalf("build error leaks the credential-bearing URL: %v", err)
	}
}
