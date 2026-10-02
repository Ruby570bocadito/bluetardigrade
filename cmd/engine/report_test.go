package main

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Ruby570bocadito/bluetardigrade/internal/socreport"
)

func TestReportFetchExactAlertIdentityAndAuthorization(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" || r.URL.Path != "/api/alerts/search" || r.URL.Query().Get("q") != "0123456789abcdef" || r.Header.Get("Authorization") != "Bearer fixture-token" {
			t.Error("incorrect real API lookup")
		}
		_, _ = io.WriteString(w, `{"items":[{"id":"fedcba9876543210"},{"id":"0123456789abcdef","source":"suricata"}]}`)
	}))
	defer server.Close()
	raw, err := fetchReportAlert(context.Background(), server.URL, "0123456789abcdef", "fixture-token")
	if err != nil {
		t.Fatal(err)
	}
	var selected map[string]any
	_ = json.Unmarshal(raw, &selected)
	if selected["source"] != "suricata" {
		t.Fatal("selected wrong alert")
	}
	for _, endpoint := range []string{"http://remote.example", "https://user:secret@remote.example", "http://127.0.0.1:7778?token=secret"} {
		if _, err := reportEndpoint(endpoint, ""); err == nil {
			t.Fatal("unsafe endpoint accepted")
		}
	}
}

func TestReportFetchRefusesRedirectsAndIncompleteHistory(t *testing.T) {
	targetHits := 0
	target := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { targetHits++ }))
	defer target.Close()
	redirect := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, target.URL, http.StatusFound) }))
	defer redirect.Close()
	if _, err := fetchReportAlert(context.Background(), redirect.URL, "0123456789abcdef", "fixture-token"); err == nil || targetHits != 0 {
		t.Fatal("followed report redirect")
	}
	incomplete := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, `{"items":[],"scan_limited":true}`)
	}))
	defer incomplete.Close()
	if _, err := fetchReportAlert(context.Background(), incomplete.URL, "0123456789abcdef", ""); err == nil || !strings.Contains(err.Error(), "incompleta") {
		t.Fatal("incomplete scan called not-found")
	}
}

func TestReportInterviewRequiresCompleteHumanInput(t *testing.T) {
	fields, err := interviewReport(strings.NewReader("Analista\n\n2\nHallazgo\n.\nNinguna\n.\nRevisar\n.\nTicket 1\n.\n"), io.Discard, socreport.Fields{Title: "Initial", Decision: "pending"})
	if err != nil || fields.Title != "Initial" || fields.Decision != "false_positive" || fields.Actions != "Ninguna" {
		t.Fatal("valid interview failed", err)
	}
	if _, err := interviewReport(strings.NewReader("Analista\n"), io.Discard, socreport.Fields{}); err == nil {
		t.Fatal("partial interview accepted")
	}
}
