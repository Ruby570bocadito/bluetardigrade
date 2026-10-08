// Package reputation looks up IP addresses and file hashes in
// VirusTotal and AbuseIPDB on behalf of an analyst.
//
// Privacy and cost posture: the engine never calls out on its own.
// Lookups happen only when the API is asked for one indicator (the
// console asks when an analyst presses the button), only for providers
// whose key the operator configured (SF_VT_API_KEY,
// SF_ABUSEIPDB_API_KEY), never for private or loopback addresses, and
// answers are cached so the same indicator is not sent twice. Each
// provider has its own rate limit sized for its free tier; past it the
// lookup answers "rate_limited" instead of queueing.
package reputation

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// Result of one provider for one indicator.
type Result struct {
	Provider   string `json:"provider"`
	Status     string `json:"status"` // ok, not_found, rate_limited, error, unsupported
	Detail     string `json:"detail,omitempty"`
	Link       string `json:"link,omitempty"`
	Malicious  int    `json:"malicious,omitempty"`
	Suspicious int    `json:"suspicious,omitempty"`
	Harmless   int    `json:"harmless,omitempty"`
	Undetected int    `json:"undetected,omitempty"`
	Score      int    `json:"score,omitempty"` // AbuseIPDB confidence 0-100
	Reports    int    `json:"reports,omitempty"`
	Country    string `json:"country,omitempty"`
	Owner      string `json:"owner,omitempty"`
	Name       string `json:"name,omitempty"`
}

// Report is the answer for one indicator across providers.
type Report struct {
	Indicator string    `json:"indicator"`
	Kind      string    `json:"kind"` // ip or hash
	Results   []Result  `json:"results"`
	Cached    bool      `json:"cached"`
	At        time.Time `json:"at"`
}

const (
	cacheTTL       = 6 * time.Hour
	cacheMax       = 2000
	vtPerMinute    = 4  // VirusTotal public API
	abusePerMinute = 30 // AbuseIPDB free tier (1000/day)
)

// Client is safe for concurrent use.
type Client struct {
	vtKey, abuseKey   string
	VTBase, AbuseBase string // overridable for tests
	HTTP              *http.Client
	now               func() time.Time

	mu      sync.Mutex
	cache   map[string]Report
	buckets map[string][]time.Time
}

// New returns a client for the providers whose key is set.
func New(vtKey, abuseKey string) *Client {
	return &Client{
		vtKey: strings.TrimSpace(vtKey), abuseKey: strings.TrimSpace(abuseKey),
		VTBase: "https://www.virustotal.com", AbuseBase: "https://api.abuseipdb.com",
		// Redirects stay on the SAME host (sesión 100agentes-2,
		// agente 5): the API keys travel in headers, which Go already
		// strips cross-host, but a 30x would still turn the engine
		// into a fetcher of arbitrary URLs.
		HTTP: &http.Client{
			Timeout: 8 * time.Second,
			CheckRedirect: func(req *http.Request, via []*http.Request) error {
				if len(via) >= 10 {
					return fmt.Errorf("demasiados redirects")
				}
				if len(via) > 0 && req.URL.Hostname() != via[0].URL.Hostname() {
					return fmt.Errorf("redirect fuera del host del proveedor (%s)", via[0].URL.Hostname())
				}
				return nil
			},
		},
		now: time.Now, cache: map[string]Report{}, buckets: map[string][]time.Time{},
	}
}

// Providers reports which providers are configured.
func (c *Client) Providers() map[string]bool {
	if c == nil {
		return map[string]bool{"virustotal": false, "abuseipdb": false}
	}
	return map[string]bool{"virustotal": c.vtKey != "", "abuseipdb": c.abuseKey != ""}
}

// Any reports whether at least one provider is configured.
func (c *Client) Any() bool { return c != nil && (c.vtKey != "" || c.abuseKey != "") }

// ValidateIP accepts a public unicast address only.
func ValidateIP(raw string) (string, error) {
	ip := net.ParseIP(strings.TrimSpace(raw))
	if ip == nil {
		return "", fmt.Errorf("not an IP address")
	}
	if ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsMulticast() || ip.IsUnspecified() {
		return "", fmt.Errorf("private, loopback or non-routable address: not sent to third parties")
	}
	return ip.String(), nil
}

// ValidateHash accepts MD5, SHA-1 or SHA-256 in hex.
func ValidateHash(raw string) (string, error) {
	h := strings.ToLower(strings.TrimSpace(raw))
	if n := len(h); n != 32 && n != 40 && n != 64 {
		return "", fmt.Errorf("hash must be MD5, SHA-1 or SHA-256 hex")
	}
	if _, err := hex.DecodeString(h); err != nil {
		return "", fmt.Errorf("hash must be hexadecimal")
	}
	return h, nil
}

// LookupIP queries every configured provider for a validated IP.
func (c *Client) LookupIP(ctx context.Context, ip string) Report {
	return c.lookup(ctx, "ip", ip, func(ctx context.Context) []Result {
		var out []Result
		if c.abuseKey != "" {
			out = append(out, c.abuseIP(ctx, ip))
		}
		if c.vtKey != "" {
			out = append(out, c.vt(ctx, "ip_addresses/"+url.PathEscape(ip), "https://www.virustotal.com/gui/ip-address/"+ip))
		}
		return out
	})
}

// LookupHash queries VirusTotal for a validated hash (AbuseIPDB has no
// file reputation and is reported as unsupported).
func (c *Client) LookupHash(ctx context.Context, hash string) Report {
	return c.lookup(ctx, "hash", hash, func(ctx context.Context) []Result {
		var out []Result
		if c.vtKey != "" {
			out = append(out, c.vt(ctx, "files/"+hash, "https://www.virustotal.com/gui/file/"+hash))
		}
		if c.abuseKey != "" {
			out = append(out, Result{Provider: "abuseipdb", Status: "unsupported", Detail: "AbuseIPDB only rates IP addresses"})
		}
		return out
	})
}

func (c *Client) lookup(ctx context.Context, kind, indicator string, fetch func(context.Context) []Result) Report {
	key := kind + ":" + indicator
	now := c.now()
	c.mu.Lock()
	if r, ok := c.cache[key]; ok && now.Sub(r.At) < cacheTTL {
		c.mu.Unlock()
		r.Cached = true
		return r
	}
	c.mu.Unlock()
	r := Report{Indicator: indicator, Kind: kind, Results: fetch(ctx), At: now}
	cacheable := true
	for _, res := range r.Results {
		if res.Status == "rate_limited" || res.Status == "error" {
			cacheable = false
		}
	}
	if cacheable {
		c.mu.Lock()
		if len(c.cache) >= cacheMax {
			for k, v := range c.cache {
				if now.Sub(v.At) >= cacheTTL {
					delete(c.cache, k)
				}
			}
			for k := range c.cache {
				if len(c.cache) < cacheMax {
					break
				}
				delete(c.cache, k) // still full: drop arbitrary entries
			}
		}
		c.cache[key] = r
		c.mu.Unlock()
	}
	return r
}

// allow implements a sliding one-minute window per provider.
func (c *Client) allow(provider string, perMinute int) bool {
	now := c.now()
	c.mu.Lock()
	defer c.mu.Unlock()
	kept := c.buckets[provider][:0]
	for _, t := range c.buckets[provider] {
		if now.Sub(t) < time.Minute {
			kept = append(kept, t)
		}
	}
	if len(kept) >= perMinute {
		c.buckets[provider] = kept
		return false
	}
	c.buckets[provider] = append(kept, now)
	return true
}

func (c *Client) get(ctx context.Context, u string, headers map[string]string, into any) (int, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return 0, err
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	res, err := c.HTTP.Do(req)
	if err != nil {
		return 0, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		_, _ = io.Copy(io.Discard, io.LimitReader(res.Body, 64<<10))
		return res.StatusCode, nil
	}
	return res.StatusCode, json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(into)
}

func (c *Client) vt(ctx context.Context, path, link string) Result {
	r := Result{Provider: "virustotal", Link: link}
	if !c.allow("virustotal", vtPerMinute) {
		r.Status, r.Detail = "rate_limited", "VirusTotal: limite de 4 consultas por minuto"
		return r
	}
	var body struct {
		Data struct {
			Attributes struct {
				Stats struct {
					Malicious  int `json:"malicious"`
					Suspicious int `json:"suspicious"`
					Harmless   int `json:"harmless"`
					Undetected int `json:"undetected"`
				} `json:"last_analysis_stats"`
				Country string `json:"country"`
				Owner   string `json:"as_owner"`
				Name    string `json:"meaningful_name"`
			} `json:"attributes"`
		} `json:"data"`
	}
	code, err := c.get(ctx, strings.TrimRight(c.VTBase, "/")+"/api/v3/"+path, map[string]string{"x-apikey": c.vtKey, "accept": "application/json"}, &body)
	switch {
	case err != nil:
		r.Status, r.Detail = "error", "VirusTotal no respondio"
	case code == http.StatusNotFound:
		r.Status = "not_found"
	case code == http.StatusTooManyRequests:
		r.Status, r.Detail = "rate_limited", "VirusTotal: cuota agotada"
	case code != http.StatusOK:
		r.Status, r.Detail = "error", fmt.Sprintf("VirusTotal respondio %d", code)
	default:
		a := body.Data.Attributes
		r.Status = "ok"
		r.Malicious, r.Suspicious, r.Harmless, r.Undetected = a.Stats.Malicious, a.Stats.Suspicious, a.Stats.Harmless, a.Stats.Undetected
		r.Country, r.Owner, r.Name = a.Country, a.Owner, a.Name
	}
	return r
}

func (c *Client) abuseIP(ctx context.Context, ip string) Result {
	r := Result{Provider: "abuseipdb", Link: "https://www.abuseipdb.com/check/" + ip}
	if !c.allow("abuseipdb", abusePerMinute) {
		r.Status, r.Detail = "rate_limited", "AbuseIPDB: limite por minuto alcanzado"
		return r
	}
	var body struct {
		Data struct {
			Score   int    `json:"abuseConfidenceScore"`
			Reports int    `json:"totalReports"`
			Country string `json:"countryCode"`
			ISP     string `json:"isp"`
		} `json:"data"`
	}
	u := strings.TrimRight(c.AbuseBase, "/") + "/api/v2/check?maxAgeInDays=90&ipAddress=" + url.QueryEscape(ip)
	code, err := c.get(ctx, u, map[string]string{"Key": c.abuseKey, "Accept": "application/json"}, &body)
	switch {
	case err != nil:
		r.Status, r.Detail = "error", "AbuseIPDB no respondio"
	case code == http.StatusTooManyRequests:
		r.Status, r.Detail = "rate_limited", "AbuseIPDB: cuota agotada"
	case code != http.StatusOK:
		r.Status, r.Detail = "error", fmt.Sprintf("AbuseIPDB respondio %d", code)
	default:
		r.Status = "ok"
		r.Score, r.Reports, r.Country, r.Owner = body.Data.Score, body.Data.Reports, body.Data.Country, body.Data.ISP
	}
	return r
}
