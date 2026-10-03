package reputation

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

func fakeProviders(t *testing.T) (*httptest.Server, *int64) {
	t.Helper()
	var calls int64
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt64(&calls, 1)
		switch {
		case r.URL.Path == "/api/v3/ip_addresses/185.220.101.47":
			if r.Header.Get("x-apikey") != "vt-key" {
				w.WriteHeader(401)
				return
			}
			_, _ = w.Write([]byte(`{"data":{"attributes":{"last_analysis_stats":{"malicious":12,"suspicious":1,"harmless":60,"undetected":20},"country":"DE","as_owner":"Example AS"}}}`))
		case r.URL.Path == "/api/v3/files/44d88612fea8a8f36de82e1278abb02f":
			_, _ = w.Write([]byte(`{"data":{"attributes":{"last_analysis_stats":{"malicious":60},"meaningful_name":"eicar.com"}}}`))
		case r.URL.Path == "/api/v3/files/0000000000000000000000000000000000000000":
			w.WriteHeader(404)
		case r.URL.Path == "/api/v2/check":
			if r.Header.Get("Key") != "abuse-key" || r.URL.Query().Get("ipAddress") != "185.220.101.47" {
				w.WriteHeader(400)
				return
			}
			_, _ = w.Write([]byte(`{"data":{"abuseConfidenceScore":100,"totalReports":523,"countryCode":"DE","isp":"Example ISP"}}`))
		default:
			w.WriteHeader(500)
		}
	}))
	t.Cleanup(srv.Close)
	return srv, &calls
}

func client(t *testing.T, vt, abuse string) (*Client, *int64) {
	srv, calls := fakeProviders(t)
	c := New(vt, abuse)
	c.VTBase, c.AbuseBase, c.HTTP = srv.URL, srv.URL, srv.Client()
	return c, calls
}

func TestValidation(t *testing.T) {
	for _, bad := range []string{"10.0.0.5", "127.0.0.1", "192.168.1.1", "fe80::1", "::1", "0.0.0.0", "nope"} {
		if _, err := ValidateIP(bad); err == nil {
			t.Errorf("%s must not be sent to third parties", bad)
		}
	}
	if ip, err := ValidateIP(" 185.220.101.47 "); err != nil || ip != "185.220.101.47" {
		t.Fatalf("public IP rejected: %v", err)
	}
	if _, err := ValidateHash("xyz"); err == nil {
		t.Fatal("short hash accepted")
	}
	if _, err := ValidateHash("zz" + "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcd"); err == nil {
		t.Fatal("non-hex hash accepted")
	}
	if h, err := ValidateHash("44D88612FEA8A8F36DE82E1278ABB02F"); err != nil || h != "44d88612fea8a8f36de82e1278abb02f" {
		t.Fatalf("md5 rejected: %v", err)
	}
}

func TestIPLookupBothProvidersAndCache(t *testing.T) {
	c, calls := client(t, "vt-key", "abuse-key")
	r := c.LookupIP(context.Background(), "185.220.101.47")
	if len(r.Results) != 2 || r.Cached {
		t.Fatalf("unexpected report %+v", r)
	}
	abuse, vt := r.Results[0], r.Results[1]
	if abuse.Status != "ok" || abuse.Score != 100 || abuse.Reports != 523 {
		t.Fatalf("abuseipdb parse: %+v", abuse)
	}
	if vt.Status != "ok" || vt.Malicious != 12 || vt.Owner != "Example AS" {
		t.Fatalf("virustotal parse: %+v", vt)
	}
	again := c.LookupIP(context.Background(), "185.220.101.47")
	if !again.Cached || atomic.LoadInt64(calls) != 2 {
		t.Fatalf("second lookup must come from the cache (calls=%d)", *calls)
	}
}

func TestHashLookupAndNotFound(t *testing.T) {
	c, _ := client(t, "vt-key", "abuse-key")
	r := c.LookupHash(context.Background(), "44d88612fea8a8f36de82e1278abb02f")
	if r.Results[0].Malicious != 60 || r.Results[0].Name != "eicar.com" || r.Results[1].Status != "unsupported" {
		t.Fatalf("hash report %+v", r.Results)
	}
	miss := c.LookupHash(context.Background(), "0000000000000000000000000000000000000000")
	if miss.Results[0].Status != "not_found" {
		t.Fatalf("unknown hash: %+v", miss.Results[0])
	}
}

func TestOnlyConfiguredProvidersAndRateLimit(t *testing.T) {
	c, calls := client(t, "vt-key", "")
	if p := c.Providers(); !p["virustotal"] || p["abuseipdb"] {
		t.Fatalf("providers = %v", p)
	}
	clock := time.Date(2026, 10, 4, 10, 0, 0, 0, time.UTC)
	c.now = func() time.Time { return clock }
	ips := []string{"185.220.101.47", "185.220.101.48", "185.220.101.49", "185.220.101.50", "185.220.101.51"}
	var last Report
	for _, ip := range ips {
		last = c.LookupIP(context.Background(), ip)
	}
	if len(last.Results) != 1 || last.Results[0].Status != "rate_limited" {
		t.Fatalf("fifth VirusTotal lookup in a minute must be rate limited: %+v", last.Results)
	}
	if atomic.LoadInt64(calls) != 4 {
		t.Fatalf("calls = %d, want 4", *calls)
	}
	clock = clock.Add(61 * time.Second)
	if r := c.LookupIP(context.Background(), ips[4]); r.Results[0].Status == "rate_limited" {
		t.Fatal("the window must slide")
	}
	if New("", "").Any() {
		t.Fatal("no keys = disabled")
	}
}
