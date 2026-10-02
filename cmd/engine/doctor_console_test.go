package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func doctorWebCheck(t *testing.T, checks []doctorCheck, name string) doctorCheck {
	t.Helper()
	for _, check := range checks {
		if check.Name == name {
			return check
		}
	}
	t.Fatalf("missing check %q: %+v", name, checks)
	return doctorCheck{}
}

func doctorWebExpect(t *testing.T, checks []doctorCheck, name, status string) {
	t.Helper()
	if check := doctorWebCheck(t, checks, name); check.Status != status {
		t.Errorf("%s status = %q, want %q: %+v", name, check.Status, status, check)
	}
}

func TestDoctorConsoleOptionalAndOffline(t *testing.T) {
	checks := doctorConsoleChecks(context.Background(), "", "", nil)
	for _, name := range []string{"Consola", "CSP del analista", "Hub IA", "Configuracion IA"} {
		doctorWebExpect(t, checks, name, "skip")
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	endpoint := server.URL
	server.Close()
	checks = doctorConsoleChecks(context.Background(), endpoint, endpoint, &http.Client{Timeout: time.Second})
	doctorWebExpect(t, checks, "Consola", "warn")
	doctorWebExpect(t, checks, "CSP del analista", "skip")
	doctorWebExpect(t, checks, "Hub IA", "warn")
	doctorWebExpect(t, checks, "Configuracion IA", "skip")
}

func TestDoctorConsoleIdentityAndCSP(t *testing.T) {
	for _, tc := range []struct {
		name, contentType, body, policy, consoleStatus, cspStatus string
	}{
		{"foreign web", "text/html", "<html>other product</html>", "connect-src *", "warn", "skip"},
		{"wrong media type", "application/json", `{"name":"bluetardigrade"}`, "connect-src *", "warn", "skip"},
		{"no CSP", "text/html; charset=utf-8", "<title>bluetardigrade</title>", "", "ok", "warn"},
		{"denied", "text/html", "<title>bluetardigrade</title>", "default-src 'self'; connect-src 'self'", "ok", "warn"},
		{"HTTP only", "text/html", "<title>bluetardigrade</title>", "connect-src http://hub.example:3003", "ok", "warn"},
		{"allowed explicit", "text/html", "<title>bluetardigrade</title>", "connect-src 'self' http://hub.example:3003 ws://hub.example:3003", "ok", "ok"},
		{"allowed wildcard", "text/html", "<title>bluetardigrade</title>", "connect-src *", "ok", "ok"},
		{"default fallback", "text/html", "<title>bluetardigrade</title>", "default-src 'none'", "ok", "warn"},
		{"multiple policies", "text/html", "<title>bluetardigrade</title>", "connect-src *, connect-src 'self'", "ok", "warn"},
		{"meta restriction", "text/html", `<title>bluetardigrade</title><meta http-equiv="Content-Security-Policy" content="connect-src 'none'">`, "connect-src *", "ok", "warn"},
		{"meta CSP only", "text/html", `<title>bluetardigrade</title><meta content='connect-src *' http-equiv='Content-Security-Policy'>`, "", "ok", "ok"},
		{"path restriction", "text/html", "<title>bluetardigrade</title>", "connect-src http://hub.example:3003/private ws://hub.example:3003/private", "ok", "warn"},
		{"truncated response", "text/html", "<title>bluetardigrade</title>" + strings.Repeat(" ", doctorWebBodyLimit), "connect-src *", "ok", "warn"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", tc.contentType)
				if tc.policy != "" {
					w.Header().Set("Content-Security-Policy", tc.policy)
				}
				fmt.Fprint(w, tc.body)
			}))
			defer server.Close()
			// No hub request is needed to verify the CSP itself.
			console, _ := url.Parse(server.URL)
			hub, _ := url.Parse("http://hub.example:3003")
			body, headers, _, err := doctorPublicGet(context.Background(), server.Client(), console)
			if err != nil {
				t.Fatal(err)
			}
			if tc.consoleStatus == "ok" {
				if check := doctorAnalystCSP(console, hub, headers, body); check.Status != tc.cspStatus {
					t.Errorf("CSP = %+v, want %s", check, tc.cspStatus)
				}
			} else {
				checks := doctorConsoleChecks(context.Background(), server.URL, "", server.Client())
				doctorWebExpect(t, checks, "Consola", tc.consoleStatus)
				doctorWebExpect(t, checks, "CSP del analista", tc.cspStatus)
			}
		})
	}
}

func TestDoctorHubHealthIsHonestAndRedactsPayload(t *testing.T) {
	for _, tc := range []struct {
		name, body, hubStatus, configStatus string
	}{
		{"configured and attached", `{"service":"console-service","status":"ok","mode":"engine","engine":{"connected":true},"analyst":{"configured":true,"model":"SECRET_MODEL","base_url":"https://secret.example/?key=SECRET","missing":["SECRET_VARIABLE"]},"events":["SECRET_TELEMETRY"]}`, "ok", "ok"},
		{"unconfigured offline", `{"service":"console-service","status":"degraded","mode":"sin-motor","engine":{"connected":false},"analyst":{"configured":false}}`, "warn", "warn"},
		{"configured without engine", `{"service":"console-service","status":"degraded","mode":"sin-motor","engine":{"connected":false},"analyst":{"configured":true}}`, "warn", "ok"},
		{"missing state", `{"service":"console-service"}`, "warn", "warn"},
		{"contradictory state", `{"service":"console-service","status":"ok","mode":"sin-motor","engine":{"connected":true},"analyst":{"configured":false}}`, "warn", "warn"},
		{"foreign service", `{"service":"some-other-service","status":"ok","analyst":{"configured":true}}`, "warn", "skip"},
		{"invalid JSON", `{"service":`, "warn", "skip"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != http.MethodGet || r.URL.Path != "/hub/health" {
					t.Errorf("unexpected probe %s %s", r.Method, r.URL.Path)
				}
				if r.Header.Get("Authorization") != "" || r.Header.Get("Cookie") != "" {
					t.Error("public status probe included credentials")
				}
				fmt.Fprint(w, tc.body)
			}))
			defer server.Close()
			checks := doctorConsoleChecks(context.Background(), "", server.URL+"/hub/", server.Client())
			doctorWebExpect(t, checks, "Hub IA", tc.hubStatus)
			doctorWebExpect(t, checks, "Configuracion IA", tc.configStatus)
			encoded, _ := json.Marshal(checks)
			if strings.Contains(string(encoded), "SECRET") {
				t.Errorf("payload leaked: %s", encoded)
			}
		})
	}
}

func TestDoctorWebRejectsUnsafeURLsWithoutRequests(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { requests.Add(1) }))
	defer server.Close()
	for _, raw := range []string{
		strings.Replace(server.URL, "://", "://user:SECRET@", 1),
		server.URL + "?key=SECRET", server.URL + "#SECRET", server.URL + "?",
		"ftp://localhost/SECRET", "/relative/SECRET", "http://",
	} {
		checks := doctorConsoleChecks(context.Background(), raw, raw, server.Client())
		doctorWebExpect(t, checks, "Consola", "warn")
		doctorWebExpect(t, checks, "Hub IA", "warn")
		encoded, _ := json.Marshal(checks)
		if strings.Contains(string(encoded), "SECRET") {
			t.Errorf("URL leaked: %s", encoded)
		}
	}
	if requests.Load() != 0 {
		t.Errorf("unsafe URLs made %d requests", requests.Load())
	}
}

func TestDoctorWebDoesNotFollowRedirects(t *testing.T) {
	var destinationRequests atomic.Int32
	destination := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		destinationRequests.Add(1)
		w.Header().Set("Content-Type", "text/html")
		fmt.Fprint(w, "<title>bluetardigrade</title>")
	}))
	defer destination.Close()
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, destination.URL, http.StatusFound) }))
	defer source.Close()
	checks := doctorConsoleChecks(context.Background(), source.URL, source.URL, source.Client())
	doctorWebExpect(t, checks, "Consola", "warn")
	doctorWebExpect(t, checks, "Hub IA", "warn")
	if destinationRequests.Load() != 0 {
		t.Fatal("doctor followed a redirect")
	}
}

func TestDoctorWebHonorsCanceledContext(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { requests.Add(1) }))
	defer server.Close()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	checks := doctorConsoleChecks(ctx, server.URL, server.URL, server.Client())
	doctorWebExpect(t, checks, "Consola", "warn")
	doctorWebExpect(t, checks, "Hub IA", "warn")
	if requests.Load() != 0 {
		t.Fatal("canceled context made a request")
	}
}
