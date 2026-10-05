package api

import (
	"net/http"
	"strings"
	"testing"
)

func requestWithHost(t *testing.T, method, url, host, origin, body string) *http.Response {
	t.Helper()
	req, err := http.NewRequest(method, url, strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	req.Host = host
	if origin != "" {
		req.Header.Set("Origin", origin)
		req.Header.Set("Sec-Fetch-Site", "same-origin")
	}
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", method, url, err)
	}
	t.Cleanup(func() { _ = res.Body.Close() })
	return res
}

// A rebinding page reaches the tokenless loopback API as a same-origin
// client of its own DNS name: both the read and the write must be refused.
func TestRebindingHostRefusedOnTokenlessLoopback(t *testing.T) {
	_, addr := newTestHub(t)
	_, port, _ := strings.Cut(addr, ":")
	evil := "rebind.attacker.example:" + port
	if res := requestWithHost(t, http.MethodGet, "http://"+addr+"/api/alerts", evil, "", ""); res.StatusCode != http.StatusMisdirectedRequest {
		t.Fatalf("GET via rebinding host = %d, want 421", res.StatusCode)
	}
	res := requestWithHost(t, http.MethodPost, "http://"+addr+"/api/alerts/0123456789abcdef/status",
		evil, "http://"+evil, `{"status":"closed","note":"n","by":"b"}`)
	if res.StatusCode != http.StatusMisdirectedRequest {
		t.Fatalf("POST via rebinding host = %d, want 421", res.StatusCode)
	}
}

func TestLocalHostsStillServedOnTokenlessLoopback(t *testing.T) {
	_, addr := newTestHub(t)
	_, port, _ := strings.Cut(addr, ":")
	for _, host := range []string{addr, "localhost:" + port, "LOCALHOST.:" + port, "[::1]:" + port, "127.0.0.1"} {
		if res := requestWithHost(t, http.MethodGet, "http://"+addr+"/api/alerts", host, "", ""); res.StatusCode != http.StatusOK {
			t.Errorf("GET with Host %q = %d, want 200", host, res.StatusCode)
		}
	}
}

// With a token the browser cannot authenticate anyway, so names are
// allowed (reverse proxies, TLS certificates issued for a hostname).
func TestNamedHostAllowedWhenTokenSet(t *testing.T) {
	h, addr := newTestHub(t)
	h.SetToken("s3cret")
	req, err := http.NewRequest(http.MethodGet, "http://"+addr+"/api/alerts", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Host = "engine.lab.example"
	req.Header.Set("Authorization", "Bearer s3cret")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("named host with token = %d, want 200", res.StatusCode)
	}
}
