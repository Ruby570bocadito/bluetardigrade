package api

import (
	"encoding/json"
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Ruby570bocadito/bluetardigrade/internal/enroll"
)

const enrollAPIToken = "api-secret"

func newEnrollHub(t *testing.T, token string, on bool) (*enroll.Registry, string) {
	t.Helper()
	h, err := New("127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	h.SetToken(token)
	var reg *enroll.Registry
	if on {
		reg, err = enroll.Open(filepath.Join(t.TempDir(), "enrollment.json"))
		if err != nil {
			t.Fatal(err)
		}
		h.SetEnrollment(reg)
	}
	go func() { _ = h.Run() }()
	t.Cleanup(h.Shutdown)
	return reg, "http://" + h.Addr()
}

func enrollReq(t *testing.T, method, url, token, body string) (*http.Response, string) {
	t.Helper()
	req, err := http.NewRequest(method, url, strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	return res, string(b)
}

func TestEnrollOffSaysHowToTurnItOn(t *testing.T) {
	_, base := newEnrollHub(t, enrollAPIToken, false)
	res, body := enrollReq(t, "GET", base+"/api/enroll", enrollAPIToken, "")
	if res.StatusCode != 200 || !strings.Contains(body, `"enabled":false`) || !strings.Contains(body, "-enroll") {
		t.Fatalf("GET off = %d %s", res.StatusCode, body)
	}
	res, body = enrollReq(t, "POST", base+"/api/enroll/tokens", enrollAPIToken, `{}`)
	if res.StatusCode != http.StatusNotFound || !strings.Contains(body, "-enroll") {
		t.Fatalf("POST off = %d %s", res.StatusCode, body)
	}
}

func TestEnrollWritesNeedAnAPIToken(t *testing.T) {
	_, base := newEnrollHub(t, "", true)
	res, body := enrollReq(t, "POST", base+"/api/enroll/tokens", "", `{}`)
	if res.StatusCode != http.StatusForbidden || !strings.Contains(body, "API token") {
		t.Fatalf("tokenless write = %d %s", res.StatusCode, body)
	}
	res, body = enrollReq(t, "GET", base+"/api/enroll", "", "")
	if res.StatusCode != 200 || !strings.Contains(body, `"writes":false`) {
		t.Fatalf("tokenless read = %d %s", res.StatusCode, body)
	}
}

func TestEnrollTokenAndDecisions(t *testing.T) {
	reg, base := newEnrollHub(t, enrollAPIToken, true)
	res, body := enrollReq(t, "POST", base+"/api/enroll/tokens", enrollAPIToken,
		`{"label":"aula 3","max_uses":5,"ttl_hours":48,"auto_approve":"","by":"ana"}`)
	if res.StatusCode != http.StatusCreated || res.Header.Get("Cache-Control") != "no-store" {
		t.Fatalf("create = %d %s", res.StatusCode, body)
	}
	var created struct {
		Token  enroll.Token `json:"token"`
		Secret string       `json:"secret"`
	}
	if err := json.Unmarshal([]byte(body), &created); err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(created.Secret, enroll.TokenPrefix) || created.Token.MaxUses != 5 || created.Token.CreatedBy != "ana" {
		t.Fatalf("created = %+v", created)
	}

	got, err := reg.Enroll(created.Secret, "PC-AULA3-01", "127.0.0.1")
	if err != nil {
		t.Fatal(err)
	}
	res, body = enrollReq(t, "GET", base+"/api/enroll", enrollAPIToken, "")
	if res.StatusCode != 200 || !strings.Contains(body, `"pending":1`) || !strings.Contains(body, "PC-AULA3-01") {
		t.Fatalf("state = %d %s", res.StatusCode, body)
	}
	if strings.Contains(body, created.Secret) || strings.Contains(body, got.Credential) || strings.Contains(body, "sha256") {
		t.Fatalf("the state must never carry secrets or their digests: %s", body)
	}

	res, body = enrollReq(t, "POST", base+"/api/enroll/hosts/"+got.Name+"/approve", enrollAPIToken, `{"by":"jefa"}`)
	if res.StatusCode != 200 || !strings.Contains(body, `"state":"active"`) || !strings.Contains(body, `"decided_by":"jefa"`) {
		t.Fatalf("approve = %d %s", res.StatusCode, body)
	}
	if res, body = enrollReq(t, "POST", base+"/api/enroll/hosts/"+got.Name+"/approve", enrollAPIToken, ""); res.StatusCode != http.StatusConflict {
		t.Fatalf("approve twice = %d %s", res.StatusCode, body)
	}
	if res, body = enrollReq(t, "POST", base+"/api/enroll/hosts/enr-nope-000000/approve", enrollAPIToken, ""); res.StatusCode != http.StatusNotFound {
		t.Fatalf("unknown host = %d %s", res.StatusCode, body)
	}
	if res, body = enrollReq(t, "POST", base+"/api/enroll/hosts/"+got.Name+"/delete", enrollAPIToken, ""); res.StatusCode != http.StatusBadRequest {
		t.Fatalf("unknown action = %d %s", res.StatusCode, body)
	}
	res, body = enrollReq(t, "POST", base+"/api/enroll/hosts/"+got.Name+"/revoke", enrollAPIToken, `{"by":"jefa"}`)
	if res.StatusCode != 200 || !strings.Contains(body, `"state":"revoked"`) {
		t.Fatalf("revoke = %d %s", res.StatusCode, body)
	}

	res, body = enrollReq(t, "POST", base+"/api/enroll/tokens/"+created.Token.ID+"/revoke", enrollAPIToken, `{"by":"ana"}`)
	if res.StatusCode != 200 || !strings.Contains(body, `"status":"revoked"`) {
		t.Fatalf("revoke token = %d %s", res.StatusCode, body)
	}
}

func TestEnrollRejectsBadBodies(t *testing.T) {
	_, base := newEnrollHub(t, enrollAPIToken, true)
	for _, body := range []string{
		`{"ttl_hours":1000}`,
		`{"max_uses":-3}`,
		`{"auto_approve":"pc-["}`,
		`{"secret":"mine"}`,
		`not json`,
	} {
		if res, out := enrollReq(t, "POST", base+"/api/enroll/tokens", enrollAPIToken, body); res.StatusCode != http.StatusBadRequest {
			t.Errorf("body %s = %d %s", body, res.StatusCode, out)
		}
	}
	big := `{"label":"` + strings.Repeat("x", enrollMaxBodyBytes) + `"}`
	if res, out := enrollReq(t, "POST", base+"/api/enroll/tokens", enrollAPIToken, big); res.StatusCode != http.StatusRequestEntityTooLarge {
		t.Errorf("oversized body = %d %s", res.StatusCode, out)
	}
}
