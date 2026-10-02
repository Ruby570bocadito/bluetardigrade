package api

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/suppress"
)

func TestCrossOriginSuppressionWriteCannotMutateState(t *testing.T) {
	for _, token := range []string{"", "fixture-token"} {
		t.Run(fmt.Sprintf("bearer=%t", token != ""), func(t *testing.T) {
			h, addr := newTestHub(t)
			h.SetToken(token)
			path := filepath.Join(t.TempDir(), "suppressions.yaml")
			manager := suppress.New()
			if err := manager.LoadFile(path); err != nil {
				t.Fatal(err)
			}
			h.SetSuppressions(manager)
			h.EnableSuppressionsWrite(path)
			request := httptest.NewRequest(http.MethodPost, "http://"+addr+"/api/suppressions", strings.NewReader(`{"rule_id":"vss-delete","host":"LAB","reason":"foreign origin"}`))
			request.Header.Set("Content-Type", "text/plain") // CORS simple request, no JSON preflight.
			request.Header.Set("Origin", "https://untrusted.example")
			request.Header.Set("Sec-Fetch-Site", "cross-site")
			if token != "" {
				request.Header.Set("Authorization", "Bearer "+token)
			}
			response := httptest.NewRecorder()
			h.srv.Handler.ServeHTTP(response, request)
			if response.Code != http.StatusForbidden {
				t.Fatalf("foreign-origin write: HTTP %d, want 403; body=%s", response.Code, response.Body.String())
			}
			if silenced, _ := manager.SuppressedAt("vss-delete", "LAB", time.Now()); silenced {
				t.Fatal("rejected browser request changed live suppressions")
			}
			if _, err := os.Stat(path); !os.IsNotExist(err) {
				t.Fatalf("rejected browser request wrote the suppressions file: %v", err)
			}
		})
	}
}

func TestLifecycleWritesValidateBrowserOriginAndKeepCLICompatibility(t *testing.T) {
	h, addr := newTestHub(t)
	h.SetToken("fixture-token")
	for index, tc := range []struct {
		name, origin, fetchSite string
		want                    int
	}{
		{"originless CLI", "", "", http.StatusOK},
		{"same origin browser", "http://" + addr, "same-origin", http.StatusOK},
		{"cross-site even with matching Origin", "http://" + addr, "cross-site", http.StatusForbidden},
		{"cross-site without Origin", "", "cross-site", http.StatusForbidden},
		{"foreign origin without Fetch Metadata", "https://untrusted.example", "", http.StatusForbidden},
		{"opaque origin", "null", "", http.StatusForbidden},
		{"userinfo origin", "http://user:secret@" + addr, "same-origin", http.StatusForbidden},
		{"query origin", "http://" + addr + "?token=secret", "same-origin", http.StatusForbidden},
		{"path origin", "http://" + addr + "/forged", "same-origin", http.StatusForbidden},
		{"fragment origin", "http://" + addr + "#forged", "same-origin", http.StatusForbidden},
		{"scheme mismatch", "https://" + addr, "same-origin", http.StatusForbidden},
		{"malformed origin", "://invalid", "", http.StatusForbidden},
	} {
		t.Run(tc.name, func(t *testing.T) {
			id := fmt.Sprintf("%016x", index+1)
			request := httptest.NewRequest(http.MethodPost, "http://"+addr+"/api/alerts/"+id+"/status", strings.NewReader(`{"status":"closed","by":"operator"}`))
			request.Header.Set("Authorization", "Bearer fixture-token")
			if tc.origin != "" {
				request.Header.Set("Origin", tc.origin)
			}
			if tc.fetchSite != "" {
				request.Header.Set("Sec-Fetch-Site", tc.fetchSite)
			}
			response := httptest.NewRecorder()
			h.srv.Handler.ServeHTTP(response, request)
			if response.Code != tc.want {
				t.Fatalf("HTTP %d, want %d; body=%s", response.Code, tc.want, response.Body.String())
			}
			_, exists := h.lifecycle.Get(id)
			if exists != (tc.want == http.StatusOK) {
				t.Fatalf("lifecycle changed=%t after HTTP %d", exists, response.Code)
			}
		})
	}
	// Read-only liveness remains available to probes from any origin.
	request := httptest.NewRequest(http.MethodGet, "http://"+addr+"/api/health", nil)
	request.Header.Set("Origin", "https://untrusted.example")
	request.Header.Set("Sec-Fetch-Site", "cross-site")
	response := httptest.NewRecorder()
	h.srv.Handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("read-only liveness changed: HTTP %d", response.Code)
	}
}

func TestWriteOriginMatchesListenerAuthority(t *testing.T) {
	for _, tc := range []struct {
		name, target, origin string
		want                 bool
	}{
		{"default HTTP port", "http://localhost:80/api/alerts/id/status", "http://LOCALHOST", true},
		{"default HTTPS port", "https://localhost/api/alerts/id/status", "https://localhost:443", true},
		{"IPv6 listener", "http://[::1]:7778/api/alerts/id/status", "http://[::1]:7778", true},
		{"different port", "http://localhost:7778/api/alerts/id/status", "http://localhost:3000", false},
		{"lookalike domain", "http://localhost/api/alerts/id/status", "http://localhost.untrusted.example", false},
		{"TLS downgrade", "https://localhost/api/alerts/id/status", "http://localhost", false},
		{"empty query marker", "http://localhost/api/alerts/id/status", "http://localhost?", false},
		{"empty fragment marker", "http://localhost/api/alerts/id/status", "http://localhost#", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodPost, tc.target, nil)
			request.Header.Set("X-Forwarded-Host", "untrusted.example")
			request.Header.Set("X-Forwarded-Proto", "https")
			if got := sameWriteOrigin(tc.origin, request); got != tc.want {
				t.Fatalf("sameWriteOrigin(%q, %q)=%t, want %t", tc.origin, tc.target, got, tc.want)
			}
		})
	}
}
