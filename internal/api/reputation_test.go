package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Ruby570bocadito/bluetardigrade/internal/reputation"
)

func TestReputationEndpoint(t *testing.T) {
	h, addr := newTestHub(t)
	base := "http://" + addr + "/api/reputation"

	var p reputationProviders
	getJSON(t, base, &p)
	if p.Providers["virustotal"] || p.Providers["abuseipdb"] {
		t.Fatalf("no keys must report every provider off: %v", p.Providers)
	}
	if res, _ := send(t, "GET", base+"?ip=185.220.101.47", ""); res.StatusCode != http.StatusNotFound {
		t.Fatalf("disabled lookups must answer 404, got %d", res.StatusCode)
	}

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"data":{"abuseConfidenceScore":87,"totalReports":12}}`))
	}))
	defer upstream.Close()
	c := reputation.New("", "abuse-key")
	c.AbuseBase, c.HTTP = upstream.URL, upstream.Client()
	h.SetReputation(c)

	getJSON(t, base, &p)
	if !p.Providers["abuseipdb"] || p.Providers["virustotal"] {
		t.Fatalf("providers = %v", p.Providers)
	}
	res, body := send(t, "GET", base+"?ip=185.220.101.47", "")
	if res.StatusCode != 200 || !strings.Contains(string(body), `"score":87`) {
		t.Fatalf("lookup: %d %s", res.StatusCode, body)
	}
	for q, code := range map[string]int{
		"?ip=10.0.0.5":                   400,
		"?ip=nope":                       400,
		"?hash=xyz":                      400,
		"?ip=185.220.101.47&hash=abcdef": 400,
	} {
		if res, _ := send(t, "GET", base+q, ""); res.StatusCode != code {
			t.Errorf("%s: %d, want %d", q, res.StatusCode, code)
		}
	}
}
