// Package ad implements the read-only Active Directory connector
// (TODO AD-1) and the domain posture analysis (TODO AD-2).
//
// Hard boundaries, enforced by construction:
//   - The connector ONLY performs LDAP bind and search operations.
//     There is no add/modify/delete code path on the ldap.Conn, so
//     "read-only" is not a policy, it is the absence of the ability.
//   - LDAPS (implicit TLS) is the only transport; ldap:// is accepted
//     solely together with an explicit StartTLS upgrade. Both demand a
//     configured CA file: the connector speaks to the organization's
//     own AD CS certificate chain, never to whatever the network
//     offers, and never in clear text (threat model §3: impostor DC).
//   - The bind is always an authenticated service account (a plain
//     domain user). Anonymous binds are refused by the connector
//     before they can even be attempted.
//   - The service-account password lives in its own file, is read at
//     sync time, held only in memory and never logged, returned by
//     the API, or interpolated into filters or error strings.
package ad

import (
	"fmt"
	"os"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

// Config is the YAML shape of the `-ad` configuration file. Every
// field is required except the ones with documented defaults; Load
// fails loud on anything ambiguous (a connector that guesses is a
// connector that silently reads the wrong directory).
type Config struct {
	// Server is the AD DS hostname (bare host or FQDN). It is also the
	// TLS ServerName the certificate is validated against.
	Server string `yaml:"server"`
	// Port defaults to 636 for LDAPS and 389 for StartTLS.
	Port int `yaml:"port"`
	// BaseDN is the subtree the connector reads (e.g.
	// "DC=corp,DC=example,DC=com"). Objects outside it are refused.
	BaseDN string `yaml:"base_dn"`
	// CAFile is the PEM bundle of the CA that signed the domain
	// controllers' LDAPS certificates. Required in every mode.
	CAFile string `yaml:"ca_file"`
	// BindDN is the read-only service account
	// ("CN=soc-reader,OU=Service,DC=...").
	BindDN string `yaml:"bind_dn"`
	// PasswordFile holds ONLY the service account password (UTF-8,
	// trailing newline tolerated). Kept out of the YAML so the two
	// secrets never share a file and the password can carry its own
	// filesystem ACL.
	PasswordFile string `yaml:"password_file"`
	// StartTLS upgrades an ldap:// connection (port 389) with TLS
	// before any credential crosses the wire. false (default) means
	// implicit LDAPS. There is no third mode: plain LDAP does not
	// exist in this connector.
	StartTLS bool `yaml:"start_tls"`
	// Interval between syncs. Default 15m, minimum 5m.
	Interval time.Duration `yaml:"interval"`
	// IncludeOUs limits the sync to objects under these OUs (DN
	// prefixes inside BaseDN). Empty = the whole BaseDN.
	IncludeOUs []string `yaml:"include_ous"`
	// ExcludeOUs prunes these subtrees (applied after IncludeOUs).
	ExcludeOUs []string `yaml:"exclude_ous"`
	// MaxObjects caps the total number of objects one sync may pull
	// (RFC 2696 pages are fetched one at a time and the fetch STOPS at
	// the cap, it does not read everything and trim). Default and
	// ceiling: 100000. A sync that hits the cap reports truncated.
	MaxObjects int `yaml:"max_objects"`
	// PageSize is the RFC 2696 page size (entries per round trip).
	// Default 500, ceiling 1000 (a larger page is how a runaway sync
	// hammers the DC).
	PageSize int `yaml:"page_size"`
	// InactiveDays is the AD-2 stale-account threshold. Default 90.
	InactiveDays int `yaml:"inactive_days"`
	// KrbtgtMaxAgeDays is the AD-2 krbtgt-password-age threshold.
	// Default 365 (the twice-rotated-after-compromise guidance).
	KrbtgtMaxAgeDays int `yaml:"krbtgt_max_age_days"`
}

// DefaultMaxObjects bounds a sync when the config does not say.
const DefaultMaxObjects = 100000

// MinInterval keeps an eager config from hammering the domain
// controllers: the connector reads the whole subtree every cycle.
const MinInterval = 5 * time.Minute

// Load reads and validates the connector configuration. Errors carry
// the field name and never any file content.
func Load(path string) (*Config, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("ad: read config: %w", err)
	}
	var c Config
	dec := yaml.NewDecoder(strings.NewReader(string(raw)))
	dec.KnownFields(true) // a typo in the YAML must not silently disable a safeguard
	if err := dec.Decode(&c); err != nil {
		return nil, fmt.Errorf("ad: parse config %s: %w", path, err)
	}
	if err := c.validate(); err != nil {
		return nil, fmt.Errorf("ad: config %s: %w", path, err)
	}
	return &c, nil
}

func (c *Config) validate() error {
	if strings.TrimSpace(c.Server) == "" {
		return fmt.Errorf("server is required")
	}
	if strings.Contains(c.Server, "/") || strings.Contains(c.Server, "\\") {
		return fmt.Errorf("server must be a bare hostname, not a URL")
	}
	if strings.TrimSpace(c.BaseDN) == "" {
		return fmt.Errorf("base_dn is required")
	}
	if !validDN(c.BaseDN) {
		return fmt.Errorf("base_dn %q does not look like a distinguished name", c.BaseDN)
	}
	if strings.TrimSpace(c.CAFile) == "" {
		return fmt.Errorf("ca_file is required: the domain controller's certificate is always validated against the organization's own CA")
	}
	if strings.TrimSpace(c.BindDN) == "" {
		return fmt.Errorf("bind_dn is required: anonymous binds are never used")
	}
	if !validDN(c.BindDN) {
		return fmt.Errorf("bind_dn %q does not look like a distinguished name", c.BindDN)
	}
	if strings.TrimSpace(c.PasswordFile) == "" {
		return fmt.Errorf("password_file is required (the service account password lives in its own file, never in this YAML)")
	}
	if c.Port < 0 || c.Port > 65535 {
		return fmt.Errorf("port %d is out of range", c.Port)
	}
	if c.StartTLS && c.Port == 636 {
		return fmt.Errorf("start_tls with port 636 is contradictory: 636 is the implicit-LDAPS port, use 389 for StartTLS or drop start_tls")
	}
	if c.Interval < 0 {
		return fmt.Errorf("interval must not be negative")
	}
	if c.Interval != 0 && c.Interval < MinInterval {
		return fmt.Errorf("interval %s is below the %s minimum: the connector reads the whole subtree every cycle", c.Interval, MinInterval)
	}
	if c.MaxObjects < 0 {
		return fmt.Errorf("max_objects must not be negative")
	}
	if c.MaxObjects > DefaultMaxObjects {
		return fmt.Errorf("max_objects %d exceeds the %d ceiling", c.MaxObjects, DefaultMaxObjects)
	}
	if c.PageSize < 0 {
		return fmt.Errorf("page_size must not be negative")
	}
	if c.PageSize > 1000 {
		return fmt.Errorf("page_size %d exceeds the 1000 ceiling", c.PageSize)
	}
	for _, dn := range append(append([]string{}, c.IncludeOUs...), c.ExcludeOUs...) {
		if !validDN(dn) {
			return fmt.Errorf("include/exclude OU entry %q is not a distinguished name", dn)
		}
		if !underBase(dn, c.BaseDN) {
			return fmt.Errorf("OU filter %q is outside base_dn %q", dn, c.BaseDN)
		}
	}
	return nil
}

// normalized returns the config with defaults applied.
func (c *Config) normalized() *Config {
	n := *c
	if n.Port == 0 {
		if n.StartTLS {
			n.Port = 389
		} else {
			n.Port = 636
		}
	}
	if n.Interval == 0 {
		n.Interval = 15 * time.Minute
	}
	if n.MaxObjects == 0 {
		n.MaxObjects = DefaultMaxObjects
	}
	if n.PageSize == 0 {
		n.PageSize = 500
	}
	if n.InactiveDays == 0 {
		n.InactiveDays = 90
	}
	if n.KrbtgtMaxAgeDays == 0 {
		n.KrbtgtMaxAgeDays = 365
	}
	return &n
}

// Password reads the service-account password from its dedicated
// file. The caller is responsible for never logging or serializing the
// result; this function exists so the ONLY code that touches the
// secret is the bind step.
func (c *Config) Password() (string, error) {
	raw, err := os.ReadFile(c.PasswordFile)
	if err != nil {
		return "", fmt.Errorf("ad: read password file: %w", err)
	}
	pw := strings.Trim(string(raw), "\r\n")
	if pw == "" {
		return "", fmt.Errorf("ad: password file %s is empty", c.PasswordFile)
	}
	return pw, nil
}

// validDN is a deliberately light structural check (attribute=value
// pairs separated by commas). It catches swapped fields (a password
// path in the DN box) without pretending to be an RFC 4514 parser.
func validDN(dn string) bool {
	dn = strings.TrimSpace(dn)
	if dn == "" {
		return false
	}
	for _, rdn := range strings.Split(dn, ",") {
		rdn = strings.TrimSpace(rdn)
		if !strings.Contains(rdn, "=") {
			return false
		}
	}
	return true
}

// underBase reports whether dn is (or lives under) base, comparing
// case-insensitively the way AD DNs behave.
func underBase(dn, base string) bool {
	dn, base = strings.ToLower(strings.TrimSpace(dn)), strings.ToLower(strings.TrimSpace(base))
	if dn == base {
		return true
	}
	return strings.HasSuffix(dn, ","+base)
}
