// AD-7 domain sign-in (M-2, TODO F2): the engine verifies an
// operator's DOMAIN credentials and derives the console role from the
// AD groups the account belongs to. Local console accounts keep
// working as the fallback — this path only ADDS a second way in.
//
// How it works, and what it deliberately does NOT do:
//   - The credential check is a simple bind AS THE USER over the same
//     TLS-protected transport the connector uses (dialTLS: org CA,
//     pinned ServerName, LDAPS or explicit StartTLS, TLS 1.2 floor).
//     The engine never sees whether the password was right any other
//     way, and the password is held in the caller's buffer exactly
//     once (the bind call), never logged, never returned.
//   - No service account is involved in sign-in: the bound-as user
//     reads their OWN entry (a normal AD permission), so the feature
//     needs no new privileged account in the directory.
//   - The search afterwards uses product literals plus the user's
//     own attribute values, always through ldap.EscapeFilter (threat
//     model §3, filter injection). The bind NAME is not a filter, but
//     it is still shape-validated before it ever reaches the wire.
//   - Read-only by construction: bind and search, nothing else — the
//     same absence-of-ability rule the rest of the package follows.
//   - Group matching: the configured group names are matched against
//     the user's memberOf DNs by full DN or by the first RDN's CN,
//     case-insensitively; precedence admin > analyst > viewer. Groups
//     reached only through NESTED membership are not resolved (direct
//     memberOf only) — declared honestly; nested resolution needs the
//     matching-rule OID search and ships separately if the operators
//     ask for it.

package ad

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	ldap "github.com/go-ldap/ldap/v3"
	"gopkg.in/yaml.v3"
)

// Login outcome sentinels: the API layer maps them to one response
// reason each (credenciales / sin_rol / dominio / formato) without
// leaking which one of a bad password and an unknown user happened.
var (
	ErrLoginCredentials   = errors.New("ad: credenciales invalidas o usuario inexistente")
	ErrLoginNoRole        = errors.New("ad: el usuario no pertenece a ningun grupo con rol de consola")
	ErrLoginDomainDown    = errors.New("ad: el controlador de dominio no esta accesible")
	ErrLoginBadUserFormat = errors.New("ad: formato de usuario no valido")
)

// maxLoginUser bounds the login name: UPNs and DOMAIN\sam forms fit
// with room to spare; anything longer is an injection attempt, not a
// name.
const maxLoginUser = 256

// DefaultLoginTimeout bounds one sign-in attempt (dial, TLS, bind and
// the group search) so a slow DC cannot pin API handlers.
const (
	DefaultLoginTimeout = 8 * time.Second
	MinLoginTimeout     = 1 * time.Second
	MaxLoginTimeout     = 20 * time.Second
)

// DomainAuthConfig is the YAML shape of the -domain-auth file: the
// transport (identical policy to the read-only connector) plus the
// AD group -> console role mapping. There is NO bind account here by
// design: sign-in binds as the user (see the file header).
type DomainAuthConfig struct {
	// Server is the AD DS hostname; also the TLS ServerName the
	// controller's certificate is validated against.
	Server string `yaml:"server"`
	// Port defaults to 636 for LDAPS and 389 for StartTLS.
	Port int `yaml:"port"`
	// BaseDN is the subtree the login search walks to find the user.
	BaseDN string `yaml:"base_dn"`
	// CAFile is the PEM bundle of the CA that signed the domain
	// controllers' LDAPS certificates. Required, like everywhere else
	// in this package.
	CAFile string `yaml:"ca_file"`
	// StartTLS upgrades ldap:// (389) before any credential crosses
	// the wire. false (default) means implicit LDAPS.
	StartTLS bool `yaml:"start_tls"`
	// Domain is an optional label (NETBIOS or DNS) echoed in the
	// login response for the console to display; the bind accepts
	// whatever form the user typed.
	Domain string `yaml:"domain"`
	// TimeoutMS bounds the whole sign-in attempt. Default 8000,
	// allowed 1000..20000.
	TimeoutMS int `yaml:"timeout_ms"`
	// Roles maps AD groups to console roles. A group name is the CN
	// ("SOC-Analistas") or the full DN; matching is case-insensitive.
	// At least one group overall; a group may appear in exactly one
	// role (an ambiguous mapping is a config error, fail loud).
	Roles DomainRoles `yaml:"roles"`
}

// DomainRoles is the group -> role mapping of the -domain-auth file.
type DomainRoles struct {
	Admin   []string `yaml:"admin"`
	Analyst []string `yaml:"analyst"`
	Viewer  []string `yaml:"viewer"`
}

// DomainIdentity is the verdict of one successful sign-in.
type DomainIdentity struct {
	// User is the canonical sAMAccountName of the bound account.
	User string `json:"user"`
	// DisplayName is the directory's displayName, when set.
	DisplayName string `json:"display_name,omitempty"`
	// Role is the console role: "admin", "analyst" or "viewer".
	Role string `json:"role"`
	// Groups lists the user's direct memberOf groups as CN labels
	// (the directory evidence the role came from).
	Groups []string `json:"groups"`
	// Domain echoes the configured label, when set.
	Domain string `json:"domain,omitempty"`
}

// LoadDomainAuth reads and validates the -domain-auth configuration.
// Errors carry the field name, never file content.
func LoadDomainAuth(path string) (*DomainAuthConfig, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("domain-auth: read config: %w", err)
	}
	var c DomainAuthConfig
	dec := yaml.NewDecoder(strings.NewReader(string(raw)))
	dec.KnownFields(true) // a typo must not silently disable a safeguard
	if err := dec.Decode(&c); err != nil {
		return nil, fmt.Errorf("domain-auth: parse config %s: %w", path, err)
	}
	if err := c.Validate(); err != nil {
		return nil, fmt.Errorf("domain-auth: config %s: %w", path, err)
	}
	return &c, nil
}

// Validate re-checks a programmatically composed config with the same
// rules LoadDomainAuth applies to files.
func (c *DomainAuthConfig) Validate() error {
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
	if c.Port < 0 || c.Port > 65535 {
		return fmt.Errorf("port %d is out of range", c.Port)
	}
	if c.StartTLS && c.Port == 636 {
		return fmt.Errorf("start_tls with port 636 is contradictory: use 389 for StartTLS or drop start_tls")
	}
	if len(c.Domain) > 64 {
		return fmt.Errorf("domain label exceeds 64 characters")
	}
	if c.TimeoutMS < 0 || c.TimeoutMS > int(MaxLoginTimeout.Milliseconds()) {
		return fmt.Errorf("timeout_ms %d is out of range (1000..20000)", c.TimeoutMS)
	}
	if c.TimeoutMS != 0 && c.TimeoutMS < int(MinLoginTimeout.Milliseconds()) {
		return fmt.Errorf("timeout_ms %d is below the %s minimum", c.TimeoutMS, MinLoginTimeout)
	}
	return c.Roles.validate()
}

func (r *DomainRoles) validate() error {
	total := 0
	seen := map[string]string{} // lowercased group -> role it already grants
	for role, groups := range map[string][]string{
		"admin":   r.Admin,
		"analyst": r.Analyst,
		"viewer":  r.Viewer,
	} {
		for _, g := range groups {
			g = strings.TrimSpace(g)
			total++
			if g == "" {
				return fmt.Errorf("roles.%s: empty group name", role)
			}
			if len(g) > 256 {
				return fmt.Errorf("roles.%s: group name exceeds 256 characters", role)
			}
			if strings.ContainsFunc(g, func(r rune) bool { return r < 0x20 || r == 0x7f }) {
				return fmt.Errorf("roles.%s: group name %q holds control characters", role, g)
			}
			if prev, dup := seen[strings.ToLower(g)]; dup {
				return fmt.Errorf("group %q is mapped to both %s and %s: a role would depend on map order", g, prev, role)
			}
			seen[strings.ToLower(g)] = role
		}
	}
	if total == 0 {
		return fmt.Errorf("roles: at least one AD group must be mapped to a role, or every domain login would come back roleless")
	}
	return nil
}

// loginTimeout returns the effective per-attempt timeout.
func (c *DomainAuthConfig) loginTimeout() time.Duration {
	if c.TimeoutMS == 0 {
		return DefaultLoginTimeout
	}
	return time.Duration(c.TimeoutMS) * time.Millisecond
}

// transportConfig builds the Config shim the shared dialTLS path
// needs (transport fields only; no bind account — sign-in binds as
// the user).
func (c *DomainAuthConfig) transportConfig() *Config {
	port := c.Port
	if port == 0 {
		if c.StartTLS {
			port = 389
		} else {
			port = 636
		}
	}
	return &Config{
		Server:   c.Server,
		Port:     port,
		CAFile:   c.CAFile,
		StartTLS: c.StartTLS,
	}
}

// splitUserLogin validates the login name and splits it into the bind
// name (passed to the bind AS TYPED: AD resolves UPN, DOMAIN\sam and
// bare sam forms server-side, so no form is ever rewritten here) and
// the sAMAccountName candidate the post-bind search matches on.
func splitUserLogin(raw string) (bindName, samPart string, err error) {
	name := strings.TrimSpace(raw)
	if name == "" {
		return "", "", fmt.Errorf("%w: vacio", ErrLoginBadUserFormat)
	}
	if len(name) > maxLoginUser {
		return "", "", fmt.Errorf("%w: excede %d caracteres", ErrLoginBadUserFormat, maxLoginUser)
	}
	if strings.ContainsFunc(name, func(r rune) bool { return r < 0x20 || r == 0x7f }) {
		return "", "", fmt.Errorf("%w: caracteres de control", ErrLoginBadUserFormat)
	}
	hasAt := strings.Contains(name, "@")
	hasSlash := strings.Contains(name, "\\")
	if hasAt && hasSlash {
		// Neither a UPN nor a sam name may hold both separators.
		return "", "", fmt.Errorf("%w: un nombre no lleva @ y \\ a la vez", ErrLoginBadUserFormat)
	}
	if hasSlash {
		if strings.HasPrefix(name, "\\") || strings.HasSuffix(name, "\\") || strings.Contains(name, "\\\\") {
			return "", "", fmt.Errorf("%w: forma DOMINIO\\usuario malformada", ErrLoginBadUserFormat)
		}
	}
	if hasAt && (strings.HasPrefix(name, "@") || strings.HasSuffix(name, "@")) {
		return "", "", fmt.Errorf("%w: forma usuario@dominio malformada", ErrLoginBadUserFormat)
	}
	sam := name
	if i := strings.LastIndex(name, "\\"); i >= 0 {
		sam = name[i+1:]
	} else if i := strings.Index(name, "@"); i >= 0 {
		sam = name[:i]
	}
	if sam == "" {
		return "", "", fmt.Errorf("%w: sin parte de usuario", ErrLoginBadUserFormat)
	}
	return name, sam, nil
}

// loginAttrs is the minimal attribute set the sign-in search reads:
// the identity fields and the direct group membership. Nothing else
// leaves the directory.
var loginAttrs = []string{attrName, attrUPN, attrDisplayName, "memberOf"}

// DomainLogin verifies one user's domain credentials and returns the
// console identity their AD groups grant. The outcome is one of: the
// identity, ErrLoginCredentials (bad password OR unknown user — the
// response does not distinguish them), ErrLoginNoRole (valid user,
// no mapped group), ErrLoginDomainDown (transport/TLS/DC error) or
// ErrLoginBadUserFormat. The password buffer is owned by the CALLER
// and must be zeroed by the caller after the call (secretfile.Zero);
// it is copied into the bind call exactly once here.
func DomainLogin(ctx context.Context, cfg *DomainAuthConfig, username string, password []byte) (*DomainIdentity, error) {
	if cfg == nil {
		return nil, fmt.Errorf("domain-auth: sin configuracion")
	}
	bindName, samPart, err := splitUserLogin(username)
	if err != nil {
		return nil, err
	}
	if len(password) == 0 {
		return nil, fmt.Errorf("%w: sin contrasena", ErrLoginCredentials)
	}
	ctx, cancel := context.WithTimeout(ctx, cfg.loginTimeout())
	defer cancel()

	conn, _, err := dialTLS(ctx, cfg.transportConfig())
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrLoginDomainDown, err)
	}
	defer conn.Close()

	if err := conn.Bind(bindName, string(password)); err != nil {
		var lerr *ldap.Error
		if errors.As(err, &lerr) && lerr.ResultCode == ldap.LDAPResultInvalidCredentials {
			return nil, ErrLoginCredentials
		}
		return nil, fmt.Errorf("%w: bind: %v", ErrLoginDomainDown, err)
	}

	// Product literals + escaped user values (threat model §3): the
	// only variable parts are the escaped sam candidate and the
	// escaped login as typed (the UPN branch).
	upnCandidate := samPart
	if strings.Contains(bindName, "@") {
		upnCandidate = bindName
	}
	filter := fmt.Sprintf("(&(objectCategory=person)(|(sAMAccountName=%s)(userPrincipalName=%s)))",
		ldap.EscapeFilter(samPart), ldap.EscapeFilter(upnCandidate))
	req := ldap.NewSearchRequest(
		cfg.BaseDN,
		ldap.ScopeWholeSubtree,
		ldap.NeverDerefAliases,
		5,  // at most a handful of candidates; exact match picks below
		10, // seconds per the search, inside the per-attempt timeout
		false,
		filter,
		loginAttrs,
		[]ldap.Control{},
	)
	result, err := conn.Search(req)
	if err != nil {
		return nil, fmt.Errorf("%w: search: %v", ErrLoginDomainDown, err)
	}

	var entry *ldap.Entry
	for _, e := range result.Entries {
		sam := e.GetAttributeValue(attrName)
		upn := e.GetAttributeValue(attrUPN)
		if strings.EqualFold(sam, samPart) || strings.EqualFold(upn, upnCandidate) {
			if entry == nil || e.DN < entry.DN { // deterministic pick on ambiguity
				entry = e
			}
		}
	}
	if entry == nil {
		// Same verdict as a bad password: the response must not tell
		// the network whether the account exists.
		return nil, ErrLoginCredentials
	}

	role, _ := cfg.Roles.resolve(entry.GetAttributeValues("memberOf"))
	if role == "" {
		return nil, fmt.Errorf("%w: %s", ErrLoginNoRole, entry.GetAttributeValue(attrName))
	}

	groups := make([]string, 0, len(entry.GetAttributeValues("memberOf")))
	for _, dn := range entry.GetAttributeValues("memberOf") {
		if cn := cnOfDN(dn); cn != "" {
			groups = append(groups, cn)
		}
	}
	return &DomainIdentity{
		User:        entry.GetAttributeValue(attrName),
		DisplayName: entry.GetAttributeValue(attrDisplayName),
		Role:        role,
		Groups:      groups,
		Domain:      cfg.Domain,
	}, nil
}

// resolve maps memberOf DNs to the console role with the precedence
// admin > analyst > viewer. Empty role means "no mapped group"; the
// second return lists the configured group names that matched.
func (r *DomainRoles) resolve(memberOf []string) (string, []string) {
	for _, role := range []string{"admin", "analyst", "viewer"} {
		var groups []string
		switch role {
		case "admin":
			groups = r.Admin
		case "analyst":
			groups = r.Analyst
		case "viewer":
			groups = r.Viewer
		}
		var matched []string
		for _, g := range groups {
			g = strings.TrimSpace(g)
			for _, dn := range memberOf {
				if dnMatchesGroup(dn, g) {
					matched = append(matched, g)
					break
				}
			}
		}
		if len(matched) > 0 {
			return role, matched
		}
	}
	return "", nil
}

// dnMatchesGroup reports whether a memberOf DN is (or lives under CN
// of) the configured group name, case-insensitively the way AD DNs
// behave.
func dnMatchesGroup(dn, group string) bool {
	if strings.EqualFold(strings.TrimSpace(dn), group) {
		return true // the operator configured the full DN
	}
	cn := cnOfDN(dn)
	return cn != "" && strings.EqualFold(cn, group)
}

// cnOfDN extracts the first RDN's value when it is a CN ("CN=SOC,
// OU=..." -> "SOC"); "" otherwise. Deliberately light: the mapping is
// operator-configured, not a directory parser.
func cnOfDN(dn string) string {
	rdn := strings.SplitN(strings.TrimSpace(dn), ",", 2)[0]
	if rest, ok := strings.CutPrefix(strings.TrimSpace(rdn), "CN="); ok {
		return strings.TrimSpace(rest)
	}
	return ""
}
