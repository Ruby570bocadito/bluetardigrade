package ad

// AD-6 "Probar conexión" probe and the settings-file writer.
//
// The probe is the primitive behind POST /api/ad/test: it opens the
// SAME TLS-protected transport the connector uses (one code path for
// the handshake, so the test button cannot succeed with a weaker
// connection than the sync would get), performs the authenticated
// bind, and samples each object kind to show what the service
// account can actually read. It stores nothing anywhere: the result
// answers the request and the connection is closed.
//
// WriteFile is the settings API's commit step: the composed config is
// serialized the way humans edit it (duration strings, effective
// defaults explicit) and installed with temp+rename+Sync, so a crash
// never leaves a half-written -ad file behind.

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/store"
	ldap "github.com/go-ldap/ldap/v3"
	"gopkg.in/yaml.v3"
)

// probeSampleCap bounds how many entries one kind contributes to a
// probe: the test button answers "readable, here is a sample and a
// floor for the count", never "the whole directory over HTTP".
const (
	probeSampleCap = 200
	probeSampleDNS = 5
)

// ProbeKind is the per-kind readout of a probe.
type ProbeKind struct {
	Kind      string   `json:"kind"`
	Count     int      `json:"count"`     // entries actually read (a floor when truncated)
	Cap       int      `json:"cap"`       // the per-kind sample ceiling
	Truncated bool     `json:"truncated"` // count hit the ceiling: the directory has at least this many
	SampleDNS []string `json:"sample_dns"`
}

// ProbeResult is the JSON verdict of one test connection. OK=false
// means the probe RAN and the connection did not (a successful test
// of a broken config); it is a 200 for the caller, never an error.
type ProbeResult struct {
	OK          bool        `json:"ok"`
	TLSVersion  string      `json:"tls_version"`
	CipherSuite string      `json:"cipher_suite"`
	BindDN      string      `json:"bind_dn"`
	BaseDN      string      `json:"base_dn"`
	Kinds       []ProbeKind `json:"kinds"`
	DurationMS  int64       `json:"duration_ms"`
	Error       string      `json:"error,omitempty"`
}

// Probe runs one test connection against cfg using password for the
// simple bind. It never returns an error: every outcome — dial
// failure, TLS refusal, bad credential, unreadable kind — is the
// returned verdict, because the caller is the "test" button and a
// failed connection is a SUCCESSFUL test. The password buffer is
// owned by the caller and is zeroed by the caller (the probe copies
// it into the bind call exactly once, like SyncOnce does).
func Probe(ctx context.Context, cfg *Config, password []byte) *ProbeResult {
	start := time.Now()
	res := &ProbeResult{
		OK:     false,
		BindDN: cfg.BindDN,
		BaseDN: cfg.BaseDN,
		Kinds:  []ProbeKind{},
	}
	n := cfg.normalized()
	if err := n.validate(); err != nil {
		res.Error = fmt.Sprintf("configuration invalid: %v", err)
		res.DurationMS = time.Since(start).Milliseconds()
		return res
	}
	conn, tlsState, err := openLDAP(ctx, n, string(password))
	// The TLS state travels even when the bind fails: the handshake
	// completed first, and "which TLS did I negotiate before the
	// credential was refused" is exactly what the test button is for.
	if tlsState != nil {
		res.TLSVersion = tlsVersionName(tlsState.Version)
		res.CipherSuite = tls.CipherSuiteName(tlsState.CipherSuite)
	}
	if err != nil {
		res.Error = err.Error()
		res.DurationMS = time.Since(start).Milliseconds()
		return res
	}
	defer conn.Close()

	// The minimal attribute set: DNs always come back, objectClass is
	// small and present on every object, so the sample reads nothing
	// sensitive from the directory.
	minimal := []string{attrObjectClass}
	for _, k := range []struct {
		kind   string
		filter string
	}{
		{store.ADKindUser, filterUsers},
		{store.ADKindGroup, filterGroups},
		{store.ADKindComputer, filterComputers},
		{store.ADKindOU, filterOUs},
	} {
		req := syncRequest(n.BaseDN, k.filter, minimal, minInt(n.PageSize, 100))
		entries, truncated, err := searchPaged(conn, req, minInt(n.PageSize, 100), probeSampleCap)
		if err != nil {
			res.Error = fmt.Sprintf("search %s failed: %v", k.kind, err)
			res.DurationMS = time.Since(start).Milliseconds()
			return res
		}
		pk := ProbeKind{
			Kind:      k.kind,
			Count:     len(entries),
			Cap:       probeSampleCap,
			Truncated: truncated,
			SampleDNS: []string{},
		}
		for i, e := range entries {
			if i >= probeSampleDNS {
				break
			}
			pk.SampleDNS = append(pk.SampleDNS, e.DN)
		}
		res.Kinds = append(res.Kinds, pk)
	}
	res.OK = true
	res.DurationMS = time.Since(start).Milliseconds()
	return res
}

// openLDAP is the connector's ONLY transport path: TLS (implicit for
// LDAPS, explicit via StartTLS) with the config's CA pool and pinned
// ServerName, then the authenticated simple bind. The TLS connection
// state is returned for the probe (nil for StartTLS, whose handshake
// the LDAP client library performs internally without exposing it).
// Both Connector.connect and the AD-6 probe go through here: one
// handshake policy, audited once.
func openLDAP(ctx context.Context, cfg *Config, password string) (*ldap.Conn, *tls.ConnectionState, error) {
	tlsCfg, err := tlsConfigFor(cfg)
	if err != nil {
		return nil, nil, err
	}
	scheme := "ldaps"
	if cfg.StartTLS {
		scheme = "ldap"
	}
	addr := net.JoinHostPort(cfg.Server, fmt.Sprintf("%d", cfg.Port))
	raw, err := net.DialTimeout("tcp", addr, 10*time.Second)
	if err != nil {
		return nil, nil, fmt.Errorf("dial %s://%s: %w", scheme, addr, err)
	}
	if cfg.StartTLS {
		// The upgrade happens inside the client library (RFC 4511
		// §4.14): the handshake there is the same tls.Config, but its
		// state is not exposed, so the probe reports no TLS version.
		conn := ldap.NewConn(raw, false)
		conn.Start() // the background reader DialURL would have started
		if err := conn.StartTLS(tlsCfg); err != nil {
			conn.Close()
			return nil, nil, fmt.Errorf("start TLS on %s: %w", addr, err)
		}
		conn.SetTimeout(30 * time.Second)
		if err := conn.Bind(cfg.BindDN, password); err != nil {
			conn.Close()
			return nil, nil, fmt.Errorf("bind as the configured service account failed: %w", err)
		}
		return conn, nil, nil
	}
	tc := tls.Client(raw, tlsCfg)
	if err := tc.HandshakeContext(ctx); err != nil {
		raw.Close()
		return nil, nil, fmt.Errorf("TLS handshake with %s: %w", addr, err)
	}
	state := tc.ConnectionState()
	conn := ldap.NewConn(tc, true)
	conn.Start() // the background reader DialURL would have started
	conn.SetTimeout(30 * time.Second)
	if err := conn.Bind(cfg.BindDN, password); err != nil {
		conn.Close()
		return nil, &state, fmt.Errorf("bind as the configured service account failed: %w", err)
	}
	return conn, &state, nil
}

// tlsConfigFor builds the handshake policy the connector always uses:
// ONLY the organization's CA (never the system pool), the pinned
// ServerName and a TLS 1.2 floor.
func tlsConfigFor(cfg *Config) (*tls.Config, error) {
	pool := x509.NewCertPool()
	pem, err := os.ReadFile(cfg.CAFile)
	if err != nil {
		return nil, fmt.Errorf("read CA file: %w", err)
	}
	if !pool.AppendCertsFromPEM(pem) {
		return nil, fmt.Errorf("CA file %s holds no usable PEM certificate", cfg.CAFile)
	}
	return &tls.Config{
		RootCAs:    pool,
		ServerName: cfg.Server,
		MinVersion: tls.VersionTLS12,
	}, nil
}

// Connector.connect keeps its signature and now shares the one
// transport path with the probe.
func (c *Connector) connect(password string) (*ldap.Conn, error) {
	conn, _, err := openLDAP(context.Background(), c.cfg, password)
	return conn, err
}

// tlsVersionName renders a TLS version constant the way the API
// surfaces it (the probe result is read by humans in the console).
func tlsVersionName(v uint16) string {
	switch v {
	case tls.VersionTLS10:
		return "TLS 1.0"
	case tls.VersionTLS11:
		return "TLS 1.1"
	case tls.VersionTLS12:
		return "TLS 1.2"
	case tls.VersionTLS13:
		return "TLS 1.3"
	default:
		return fmt.Sprintf("TLS 0x%04x", v)
	}
}

// WriteFile serializes the config (normalized: effective defaults
// explicit, the interval as a duration string) and installs it
// atomically: temp file in the same directory, 0600, Sync, rename.
// The secret is NEVER in this file — it lives in its own envelope
// (secretfile), so the YAML can stay world-unreadable and boring.
func (c *Config) WriteFile(path string) error {
	n := c.normalized()
	data, err := yaml.Marshal(n)
	if err != nil {
		return fmt.Errorf("ad: serialize config: %w", err)
	}
	dir := filepath.Dir(path)
	tmp, err := os.CreateTemp(dir, ".ad-config-*")
	if err != nil {
		return fmt.Errorf("ad: temp file for config: %w", err)
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName) // no-op after a successful rename
	if err := tmp.Chmod(0o600); err != nil {
		tmp.Close()
		return fmt.Errorf("ad: chmod config: %w", err)
	}
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return fmt.Errorf("ad: write config: %w", err)
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return fmt.Errorf("ad: sync config: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("ad: close config: %w", err)
	}
	if err := os.Rename(tmpName, path); err != nil {
		return fmt.Errorf("ad: install config: %w", err)
	}
	return nil
}

// MarshalYAML renders the config the way humans edit it: interval as
// a duration string ("15m"), never raw nanoseconds.
func (c *Config) MarshalYAML() (any, error) {
	type configYAML struct {
		Server           string   `yaml:"server"`
		Port             int      `yaml:"port"`
		BaseDN           string   `yaml:"base_dn"`
		CAFile           string   `yaml:"ca_file"`
		BindDN           string   `yaml:"bind_dn"`
		PasswordFile     string   `yaml:"password_file"`
		StartTLS         bool     `yaml:"start_tls"`
		Interval         string   `yaml:"interval"`
		IncludeOUs       []string `yaml:"include_ous"`
		ExcludeOUs       []string `yaml:"exclude_ous"`
		MaxObjects       int      `yaml:"max_objects"`
		PageSize         int      `yaml:"page_size"`
		InactiveDays     int      `yaml:"inactive_days"`
		KrbtgtMaxAgeDays int      `yaml:"krbtgt_max_age_days"`
		WorkStart        string   `yaml:"work_start,omitempty"`
		WorkEnd          string   `yaml:"work_end,omitempty"`
		WorkDays         []int    `yaml:"work_days,omitempty"`
	}
	out := configYAML{
		Server:           c.Server,
		Port:             c.Port,
		BaseDN:           c.BaseDN,
		CAFile:           c.CAFile,
		BindDN:           c.BindDN,
		PasswordFile:     c.PasswordFile,
		StartTLS:         c.StartTLS,
		Interval:         c.Interval.String(),
		IncludeOUs:       c.IncludeOUs,
		ExcludeOUs:       c.ExcludeOUs,
		MaxObjects:       c.MaxObjects,
		PageSize:         c.PageSize,
		InactiveDays:     c.InactiveDays,
		KrbtgtMaxAgeDays: c.KrbtgtMaxAgeDays,
		WorkStart:        c.WorkStart,
		WorkEnd:          c.WorkEnd,
		WorkDays:         c.WorkDays,
	}
	if out.IncludeOUs == nil {
		out.IncludeOUs = []string{}
	}
	if out.ExcludeOUs == nil {
		out.ExcludeOUs = []string{}
	}
	if out.WorkDays == nil {
		out.WorkDays = []int{}
	}
	return out, nil
}
