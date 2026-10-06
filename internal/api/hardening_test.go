// Adversarial round (agent 04): store-backed errors answer 500 with a
// generic body and leave the internals (paths, SQL state) in the
// engine log only.
package api

import (
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestStoreQueryErrorHidesInternals(t *testing.T) {
	h, err := New(":0")
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	defer func() {
		h.mu.Lock()
		h.subs = map[chan []byte]struct{}{}
		h.mu.Unlock()
		_ = h.srv.Close()
	}()

	rr := httptest.NewRecorder()
	sentinel := errors.New("store: query events: /srv/secret-path/sf-store.db: SQL logic error: no such table")
	h.storeQueryError(rr, sentinel)

	if rr.Code != 500 {
		t.Fatalf("status = %d, want 500", rr.Code)
	}
	body := rr.Body.String()
	if !strings.Contains(body, "store query failed") {
		t.Fatalf("body lost the fact: %q", body)
	}
	for _, leak := range []string{"/srv/secret-path", "sf-store.db", "SQL logic error", "no such table"} {
		if strings.Contains(body, leak) {
			t.Fatalf("body leaks internal detail %q: %q", leak, body)
		}
	}
}

// The 401 throttle map stays bounded even when every failing request
// comes from a new address inside one window.
func TestAuthFailMapIsBounded(t *testing.T) {
	h, _ := newTestHub(t)
	for i := 0; i < authFailMaxAddrs*2; i++ {
		h.tooManyAuthFails(fmt.Sprintf("[2001:db8::%x]:4242", i))
	}
	h.authMu.Lock()
	n := len(h.authFails)
	h.authMu.Unlock()
	if n > authFailMaxAddrs {
		t.Fatalf("auth-failure map grew to %d entries, cap %d", n, authFailMaxAddrs)
	}
	// a known address keeps its budget accounting under the cap
	for i := 0; i < authFailBudget; i++ {
		h.tooManyAuthFails("192.0.2.7:1")
	}
	if !h.tooManyAuthFails("192.0.2.7:1") {
		t.Fatal("an address over its budget was not throttled")
	}
}

// Every engine API response carries the two browser-confusion headers:
// nosniff (telemetry strings are attacker-influenced text the routes
// echo back) and no-referrer (operators paste API URLs). The check runs
// through the full handler chain — headers, rebinding guard, auth and
// the mux — on a route with and without a token configured.
func TestAPIResponsesCarrySecurityHeaders(t *testing.T) {
	for _, tt := range []struct {
		name  string
		token string
	}{
		{name: "tokenless loopback"},
		{name: "token-protected", token: "secret-token"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			h, addr := newTestHub(t)
			h.SetToken(tt.token)
			url := "http://" + addr + "/api/health"
			req, err := http.NewRequest(http.MethodGet, url, nil)
			if err != nil {
				t.Fatalf("request: %v", err)
			}
			if tt.token != "" {
				req.Header.Set("Authorization", "Bearer "+tt.token)
			}
			res, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Fatalf("GET %s: %v", url, err)
			}
			defer res.Body.Close()
			if res.StatusCode != http.StatusOK {
				t.Fatalf("status = %d, want 200", res.StatusCode)
			}
			if got := res.Header.Get("X-Content-Type-Options"); got != "nosniff" {
				t.Fatalf("X-Content-Type-Options = %q, want nosniff", got)
			}
			if got := res.Header.Get("Referrer-Policy"); got != "no-referrer" {
				t.Fatalf("Referrer-Policy = %q, want no-referrer", got)
			}
		})
	}
}
