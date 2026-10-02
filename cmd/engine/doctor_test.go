package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func doctorCheckStatus(checks []doctorCheck, name string) string {
	for _, c := range checks {
		if c.Name == name {
			return c.Status
		}
	}
	return "missing"
}

func doctorFixtureAPI(t *testing.T, source string, token string) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/health" {
			fmt.Fprint(w, `{"status":"ok","mode":"engine"}`)
			return
		}
		if r.Header.Get("Authorization") != "Bearer "+token {
			w.WriteHeader(401)
			fmt.Fprint(w, "FIXTURE_SECRET")
			return
		}
		switch r.URL.Path {
		case "/api/stats":
			fmt.Fprint(w, `{"mode":"engine","events_total":1,"rules_count":69,"store_enabled":true}`)
		case "/api/events":
			_ = json.NewEncoder(w).Encode([]map[string]any{{"timestamp": time.Now().UTC(), "source": source}})
		default:
			http.NotFound(w, r)
		}
	}))
}

func TestDoctorDistinguishesHealthFromCredentials(t *testing.T) {
	srv := doctorFixtureAPI(t, "sysmon", "FIXTURE_SECRET")
	defer srv.Close()
	client := &http.Client{Timeout: time.Second}
	wrong := doctorEngine(context.Background(), client, srv.URL, "wrong", time.Minute)
	if doctorCheckStatus(wrong, "API del motor") != "ok" || doctorCheckStatus(wrong, "Acceso a estadisticas") != "error" {
		t.Fatalf("wrong credential: %+v", wrong)
	}
	data, _ := json.Marshal(wrong)
	if strings.Contains(string(data), "FIXTURE_SECRET") || strings.Contains(string(data), "Bearer") {
		t.Fatalf("credential leaked: %s", data)
	}
	correct := doctorEngine(context.Background(), client, srv.URL, "FIXTURE_SECRET", time.Minute)
	if doctorCheckStatus(correct, "Telemetria") != "ok" || doctorCheckStatus(correct, "Persistencia") != "ok" {
		t.Fatalf("valid engine: %+v", correct)
	}
}

func TestDoctorBenchIsNotProofOfRealTelemetry(t *testing.T) {
	for _, source := range []string{"bench", "simulate", "unknown"} {
		t.Run(source, func(t *testing.T) {
			srv := doctorFixtureAPI(t, source, "fixture")
			defer srv.Close()
			checks := doctorEngine(context.Background(), &http.Client{Timeout: time.Second}, srv.URL, "fixture", time.Minute)
			if doctorCheckStatus(checks, "Telemetria") != "warn" {
				t.Fatalf("generated/unknown source promoted to proof: %+v", checks)
			}
			if source != "unknown" && doctorCheckStatus(checks, "Datos de prueba") != "warn" {
				t.Fatalf("unmarked demo: %+v", checks)
			}
		})
	}
}

func TestDoctorRejectsFakeAPIAndDoesNotInventZeroMetrics(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/health" {
			fmt.Fprint(w, `{"status":"ok","mode":"engine"}`)
		} else {
			fmt.Fprint(w, `{}`)
		}
	}))
	defer srv.Close()
	checks := doctorEngine(context.Background(), &http.Client{Timeout: time.Second}, srv.URL, "", time.Minute)
	if doctorCheckStatus(checks, "Acceso a estadisticas") != "error" {
		t.Fatalf("invented metrics: %+v", checks)
	}
	for _, invalid := range []string{"http://user:secret@localhost", "http://localhost?token=secret", "file:///tmp/x", "http://localhost#secret", "http://localhost?"} {
		if _, err := doctorAPIBase(invalid); err == nil {
			t.Fatalf("accepted %s", invalid)
		}
	}
}

func TestDoctorCredentialPrecedenceAndBounds(t *testing.T) {
	root := t.TempDir()
	config := filepath.Join(root, "tools", "config")
	if err := os.MkdirAll(config, 0o700); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(config, "ingest.token")
	if err := os.WriteFile(path, []byte("saved-secret\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("DOCTOR_FIXTURE_TOKEN", "env-secret")
	if token, err := doctorSetting(root, "DOCTOR_FIXTURE_TOKEN", "ingest.token"); err != nil || token != "env-secret" {
		t.Fatal("environment precedence lost")
	}
	t.Setenv("DOCTOR_FIXTURE_TOKEN", "")
	if token, err := doctorSetting(root, "DOCTOR_FIXTURE_TOKEN", "ingest.token"); err != nil || token != "saved-secret" {
		t.Fatal("persisted token not read")
	}
	if err := os.WriteFile(path, []byte(strings.Repeat("x", 4097)), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := doctorSetting(root, "DOCTOR_FIXTURE_TOKEN", "ingest.token"); err == nil {
		t.Fatal("unbounded credential read")
	}
	t.Setenv("DOCTOR_FIXTURE_TOKEN", "secret\ninjection")
	if _, err := doctorSetting(root, "DOCTOR_FIXTURE_TOKEN", "ingest.token"); err == nil {
		t.Fatal("newline accepted in credential")
	}
}

func TestRunDoctorUsesPersistedAPICredentialAndEnvironmentPrecedence(t *testing.T) {
	for _, tc := range []struct {
		name, environment, expectedToken, statsStatus, credentialStatus string
	}{
		{"persisted", "", "saved-api-fixture-secret", "ok", "missing"},
		{"environment", "env-api-fixture-secret", "env-api-fixture-secret", "ok", "missing"},
		{"invalid environment", "invalid-api-fixture-secret\ninjection", "saved-api-fixture-secret", "missing", "error"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			root := t.TempDir()
			config := filepath.Join(root, "tools", "config")
			if err := os.MkdirAll(config, 0o700); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(config, "api.token"), []byte("saved-api-fixture-secret\n"), 0o600); err != nil {
				t.Fatal(err)
			}
			t.Setenv("SF_API_TOKEN", tc.environment)
			t.Setenv("SF_INGEST_TOKEN", "")
			t.Setenv("SF_INGEST_CA", "")
			srv := doctorFixtureAPI(t, "sysmon", tc.expectedToken)
			defer srv.Close()
			report := runDoctor(context.Background(), &doctorOptions{root: root, addr: "127.0.0.1:1", apiURL: srv.URL, sensor: "providers", timeout: time.Second, recent: time.Minute})
			if doctorCheckStatus(report.Checks, "Acceso a estadisticas") != tc.statsStatus || doctorCheckStatus(report.Checks, "Credencial de la API") != tc.credentialStatus {
				t.Fatalf("credential resolution: %+v", report.Checks)
			}
			data, err := json.Marshal(report)
			if err != nil {
				t.Fatal(err)
			}
			for _, secret := range []string{"saved-api-fixture-secret", "env-api-fixture-secret", "invalid-api-fixture-secret"} {
				if strings.Contains(string(data), secret) {
					t.Fatal("doctor exposed an API credential")
				}
			}
		})
	}
}

func TestDoctorIngestAuthSendsNoEvents(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	lines := make(chan string, 2)
	go func() {
		conn, err := ln.Accept()
		if err != nil {
			lines <- "accept failed"
			lines <- "accept failed"
			return
		}
		defer conn.Close()
		_ = conn.SetDeadline(time.Now().Add(time.Second))
		reader := bufio.NewReader(conn)
		line, _ := reader.ReadString('\n')
		lines <- line
		_, _ = conn.Write([]byte("{\"ack\":\"ok\"}\n"))
		rest, _ := io.ReadAll(reader)
		lines <- string(rest)
	}()
	checks := doctorIngest(context.Background(), ln.Addr().String(), "fixture-token", "", time.Second)
	if doctorCheckStatus(checks, "Autenticacion de ingesta") != "ok" {
		t.Fatalf("auth: %+v", checks)
	}
	if line := <-lines; line != "AUTH fixture-token\n" {
		t.Fatalf("sent unexpected data %q", line)
	}
	if rest := <-lines; rest != "" {
		t.Fatalf("diagnostic sent telemetry after AUTH: %q", rest)
	}
}

func TestDoctorRejectsRemotePlaintextBeforeConnection(t *testing.T) {
	for _, input := range []struct{ addr, token, ca string }{
		{"192.0.2.1:7777", "fixture-token", ""},
		{"soc.example.invalid:7777", "", "fixture-ca.pem"},
		{"[2001:db8::1]:7777", "fixture-token", ""},
	} {
		checks := doctorIngest(context.Background(), input.addr, input.token, input.ca, time.Second)
		if len(checks) != 1 || checks[0].Status != "error" || !strings.Contains(checks[0].Detail, "requiere TLS") {
			t.Fatalf("unsafe remote probe not refused before connecting: %+v", checks)
		}
	}
}

func TestDoctorRejectsRemoteAPITokenOverPlaintext(t *testing.T) {
	checks := doctorEngine(context.Background(), &http.Client{Timeout: time.Second}, "http://soc.example.invalid:7778", "fixture-secret", time.Minute)
	if len(checks) != 1 || checks[0].Status != "error" || !strings.Contains(checks[0].Detail, "Bearer por HTTP") {
		t.Fatalf("unsafe API credential probe not refused: %+v", checks)
	}
}

func TestDoctorHTTPSRequiresVerifiedCA(t *testing.T) {
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/health":
			fmt.Fprint(w, `{"status":"ok","mode":"engine"}`)
		case "/api/stats":
			fmt.Fprint(w, `{"mode":"engine","events_total":0,"rules_count":1,"store_enabled":false}`)
		case "/api/events":
			fmt.Fprint(w, `[]`)
		}
	}))
	defer srv.Close()
	srv.Config.ErrorLog = log.New(io.Discard, "", 0)
	ca := filepath.Join(t.TempDir(), "fixture-ca.pem")
	if err := os.WriteFile(ca, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: srv.Certificate().Raw}), 0o600); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct{ ca, expected string }{{"", "error"}, {ca, "ok"}} {
		cfg, err := doctorTLS(tc.ca)
		if err != nil || cfg.InsecureSkipVerify {
			t.Fatalf("unverified TLS configuration: %v", err)
		}
		transport := &http.Transport{TLSClientConfig: cfg}
		checks := doctorEngine(context.Background(), &http.Client{Timeout: time.Second, Transport: transport}, srv.URL, "", time.Minute)
		transport.CloseIdleConnections()
		if doctorCheckStatus(checks, "API del motor") != tc.expected {
			t.Fatalf("CA %q: %+v", tc.ca, checks)
		}
	}
}

func TestDoctorJSONOfflineAndHelp(t *testing.T) {
	root := newRootCmd()
	var out bytes.Buffer
	root.SetOut(&out)
	root.SetArgs([]string{"doctor", "-h"})
	if err := root.Execute(); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out.String(), "-api-url") || !isRoutedSubcommand("doctor") {
		t.Fatal("doctor help/routing missing")
	}
	root = newRootCmd()
	out.Reset()
	root.SetOut(&out)
	root.SetArgs([]string{"doctor", "-root", t.TempDir(), "-addr", "127.0.0.1:1", "-api-url", "http://127.0.0.1:1", "-console-url=", "-hub-url=", "-sensor", "providers", "-timeout", "100ms", "-json"})
	if err := root.Execute(); err == nil {
		t.Fatal("offline doctor must exit nonzero")
	}
	var report doctorReport
	if err := json.Unmarshal(out.Bytes(), &report); err != nil {
		t.Fatalf("non-JSON output: %s, %v", out.String(), err)
	}
	if report.Errors < 2 || report.Checks == nil {
		t.Fatalf("offline report: %+v", report)
	}
}
