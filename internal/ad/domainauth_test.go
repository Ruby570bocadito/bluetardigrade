// AD-7 domain sign-in tests against the in-process LDAP fixture: real
// bind + search over loopback TLS, no network beyond 127.0.0.1 and no
// third-party binaries — the same inert-spirit rules as the connector
// tests. The fixture accepts the user binds the domain login performs
// (allowBind) and serves canned entries, so every branch (forms of the
// login name, role precedence, credential refusal, no-role, injection
// attempts, DC down) is exercised against the real client code path.

package ad

import (
	"context"
	"errors"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// loginFixture starts the fixture with a small directory of console
// groups and users, allows their binds and returns the config ready
// for DomainLogin plus the server handle.
func loginFixture(t *testing.T) (*fixtureServer, *DomainAuthConfig) {
	t.Helper()
	entries := []fixtureEntry{
		{
			dn: "CN=SOC-Admins,OU=Grupos," + fixtureBase,
			attrs: map[string][]string{
				"objectCategory": {"group"}, "objectClass": {"group"},
				"sAMAccountName": {"SOC-Admins"},
			},
		},
		{
			dn: "CN=SOC-Analistas,OU=Grupos," + fixtureBase,
			attrs: map[string][]string{
				"objectCategory": {"group"}, "objectClass": {"group"},
				"sAMAccountName": {"SOC-Analistas"},
			},
		},
		{
			dn: "CN=SOC-Lectores,OU=Grupos," + fixtureBase,
			attrs: map[string][]string{
				"objectCategory": {"group"}, "objectClass": {"group"},
				"sAMAccountName": {"SOC-Lectores"},
			},
		},
		fixtureUser("CN=Juan Ruiz,OU=Usuarios,"+fixtureBase, "jruiz", 512, map[string][]string{
			"userPrincipalName": {"jruiz@testdom.example.com"},
			"displayName":       {"Juan Ruiz"},
			"memberOf":          {"CN=SOC-Analistas,OU=Grupos," + fixtureBase},
		}),
		fixtureUser("CN=Sofia Alta,OU=Usuarios,"+fixtureBase, "salta", 512, map[string][]string{
			"displayName": {"Sofia Alta"},
			// memberOf grants TWO roles: admin must win over viewer.
			"memberOf": {
				"CN=SOC-Admins,OU=Grupos," + fixtureBase,
				"CN=SOC-Lectores,OU=Grupos," + fixtureBase,
			},
		}),
		fixtureUser("CN=Nadie Sinrol,OU=Usuarios,"+fixtureBase, "sinrol", 512, map[string][]string{
			"memberOf": {"CN=Imprenta,OU=Grupos," + fixtureBase},
		}),
	}
	s, caPath, _ := newFixtureServer(t, entries, true)
	t.Cleanup(s.close)

	cfg := &DomainAuthConfig{
		Server: "localhost",
		Port:   s.listener.Addr().(*net.TCPAddr).Port,
		BaseDN: fixtureBase,
		CAFile: caPath,
		Domain: "TESTDOM",
		Roles: DomainRoles{
			Admin:   []string{"SOC-Admins"},
			Analyst: []string{"SOC-Analistas"},
			Viewer:  []string{"SOC-Lectores"},
		},
	}
	if err := cfg.Validate(); err != nil {
		t.Fatalf("config: %v", err)
	}
	return s, cfg
}

func TestDomainLoginBySam(t *testing.T) {
	s, cfg := loginFixture(t)
	s.allowBind("jruiz", "pw-analista")

	id, err := DomainLogin(context.Background(), cfg, "jruiz", []byte("pw-analista"))
	if err != nil {
		t.Fatalf("DomainLogin: %v", err)
	}
	if id.User != "jruiz" || id.DisplayName != "Juan Ruiz" {
		t.Errorf("identity = %+v", id)
	}
	if id.Role != "analyst" {
		t.Errorf("Role = %q, want analyst", id.Role)
	}
	if id.Domain != "TESTDOM" {
		t.Errorf("Domain = %q, want TESTDOM", id.Domain)
	}
	if len(id.Groups) != 1 || id.Groups[0] != "SOC-Analistas" {
		t.Errorf("Groups = %v, want [SOC-Analistas]", id.Groups)
	}
}

func TestDomainLoginByUPN(t *testing.T) {
	s, cfg := loginFixture(t)
	s.allowBind("jruiz@testdom.example.com", "pw-analista")

	id, err := DomainLogin(context.Background(), cfg, "jruiz@testdom.example.com", []byte("pw-analista"))
	if err != nil {
		t.Fatalf("DomainLogin: %v", err)
	}
	if id.User != "jruiz" || id.Role != "analyst" {
		t.Errorf("identity = %+v", id)
	}
}

func TestDomainLoginByNetBIOSForm(t *testing.T) {
	s, cfg := loginFixture(t)
	s.allowBind("TESTDOM\\jruiz", "pw-analista")

	id, err := DomainLogin(context.Background(), cfg, "TESTDOM\\jruiz", []byte("pw-analista"))
	if err != nil {
		t.Fatalf("DomainLogin: %v", err)
	}
	if id.User != "jruiz" || id.Role != "analyst" {
		t.Errorf("identity = %+v", id)
	}
}

func TestDomainLoginRolePrecedenceAdminWins(t *testing.T) {
	s, cfg := loginFixture(t)
	s.allowBind("salta", "pw-admin")

	id, err := DomainLogin(context.Background(), cfg, "salta", []byte("pw-admin"))
	if err != nil {
		t.Fatalf("DomainLogin: %v", err)
	}
	if id.Role != "admin" {
		t.Errorf("Role = %q, want admin (precedence over viewer)", id.Role)
	}
}

func TestDomainLoginBadPasswordAndUnknownUserSameVerdict(t *testing.T) {
	s, cfg := loginFixture(t)
	s.allowBind("jruiz", "pw-analista")

	for _, user := range []string{"jruiz", "fantasma"} {
		_, err := DomainLogin(context.Background(), cfg, user, []byte("contrasena-equivocada"))
		if !errors.Is(err, ErrLoginCredentials) {
			t.Errorf("user %q: err = %v, want ErrLoginCredentials (same verdict, no existence leak)", user, err)
		}
	}
}

func TestDomainLoginNoRole(t *testing.T) {
	s, cfg := loginFixture(t)
	s.allowBind("sinrol", "pw-sinrol")

	_, err := DomainLogin(context.Background(), cfg, "sinrol", []byte("pw-sinrol"))
	if !errors.Is(err, ErrLoginNoRole) {
		t.Errorf("err = %v, want ErrLoginNoRole", err)
	}
}

func TestDomainLoginRefusesInjectionShapes(t *testing.T) {
	s, cfg := loginFixture(t)
	s.allowBind("jruiz", "pw-analista")

	// A crafted name must either be refused by the shape check or
	// come back as plain invalid credentials: the bind name is not a
	// filter and the search value is escaped, so nothing extra can
	// match.
	for _, user := range []string{
		"jruiz)(objectClass=*",
		"jruiz)(|(sAMAccountName=*",
		"*",
		"jruiz@x@y",
		"DOM\\DOM\\jruiz",
		"   ",
	} {
		_, err := DomainLogin(context.Background(), cfg, user, []byte("pw-analista"))
		if err != nil && !errors.Is(err, ErrLoginCredentials) && !errors.Is(err, ErrLoginBadUserFormat) {
			t.Errorf("user %q: err = %v, want ErrLoginCredentials or ErrLoginBadUserFormat", user, err)
		}
	}
}

func TestDomainLoginEmptyPasswordRefused(t *testing.T) {
	_, cfg := loginFixture(t)
	if _, err := DomainLogin(context.Background(), cfg, "jruiz", nil); !errors.Is(err, ErrLoginCredentials) {
		t.Errorf("err = %v, want ErrLoginCredentials for an empty password", err)
	}
}

func TestDomainLoginDomainDown(t *testing.T) {
	_, cfg := loginFixture(t)
	// A port nobody listens on: the dial must surface as
	// ErrLoginDomainDown, never as credentials.
	cfg.Port = 1 // reserved port on localhost, nothing listens
	if _, err := DomainLogin(context.Background(), cfg, "jruiz", []byte("pw")); !errors.Is(err, ErrLoginDomainDown) {
		t.Errorf("err = %v, want ErrLoginDomainDown", err)
	}
}

func TestDomainLoginConfigValidation(t *testing.T) {
	base := DomainAuthConfig{
		Server: "dc01.corp.example",
		BaseDN: "DC=corp,DC=example,DC=com",
		CAFile: "/etc/sf/dc-ca.pem",
		Roles:  DomainRoles{Analyst: []string{"SOC-Analistas"}},
	}
	if err := base.Validate(); err != nil {
		t.Fatalf("base config: %v", err)
	}
	cases := map[string]func(*DomainAuthConfig){
		"sin servidor": func(c *DomainAuthConfig) { c.Server = "" },
		"servidor URL": func(c *DomainAuthConfig) { c.Server = "ldaps://dc01" },
		"sin base_dn":  func(c *DomainAuthConfig) { c.BaseDN = "" },
		"sin ca_file":  func(c *DomainAuthConfig) { c.CAFile = "" },
		"starttls 636": func(c *DomainAuthConfig) { c.StartTLS, c.Port = true, 636 },
		"timeout alto": func(c *DomainAuthConfig) { c.TimeoutMS = 30000 },
		"timeout bajo": func(c *DomainAuthConfig) { c.TimeoutMS = 200 },
		"sin roles":    func(c *DomainAuthConfig) { c.Roles = DomainRoles{} },
		"grupo en dos roles": func(c *DomainAuthConfig) {
			c.Roles = DomainRoles{Admin: []string{"SOC"}, Analyst: []string{"soc"}}
		},
	}
	for name, mutate := range cases {
		c := base
		mutate(&c)
		if err := c.Validate(); err == nil {
			t.Errorf("%s: Validate() = nil, want error", name)
		}
	}
}

func TestDomainLoginLoadsYAML(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "domain-auth.yaml")
	yaml := `server: dc01.corp.example
port: 636
base_dn: DC=corp,DC=example,DC=com
ca_file: /etc/sf/dc-ca.pem
domain: CORP
roles:
  admin: ["SOC-Admins"]
  analyst: ["SOC-Analistas"]
  viewer: ["SOC-Lectores"]
`
	if err := os.WriteFile(path, []byte(yaml), 0o600); err != nil {
		t.Fatalf("write: %v", err)
	}
	cfg, err := LoadDomainAuth(path)
	if err != nil {
		t.Fatalf("LoadDomainAuth: %v", err)
	}
	if cfg.Roles.Admin[0] != "SOC-Admins" || cfg.Domain != "CORP" {
		t.Errorf("cfg = %+v", cfg)
	}

	// Un campo desconocido falla alto: un typo no puede desactivar
	// una salvaguarda en silencio.
	if err := os.WriteFile(path, []byte(yaml+"timeout: 5\n"), 0o600); err != nil {
		t.Fatalf("write: %v", err)
	}
	if _, err := LoadDomainAuth(path); err == nil {
		t.Error("LoadDomainAuth con campo desconocido = nil, want error")
	}
}

func TestSplitUserLoginForms(t *testing.T) {
	cases := []struct {
		in   string
		bind string
		sam  string
		ok   bool
	}{
		{"jruiz", "jruiz", "jruiz", true},
		{"jruiz@corp.example", "jruiz@corp.example", "jruiz", true},
		{"CORP\\jruiz", "CORP\\jruiz", "jruiz", true},
		{"", "", "", false},
		{" jruiz ", "jruiz", "jruiz", true}, // el trim es deliberado
		{"a@b\\c", "", "", false},
		{"\\jruiz", "", "", false},
		{"CORP\\", "", "", false},
		{"@corp.example", "", "", false},
		{strings.Repeat("a", 257), "", "", false}, // demasiado largo
	}
	for _, c := range cases {
		bind, sam, err := splitUserLogin(c.in)
		if c.ok && err != nil {
			t.Errorf("%q: err = %v, want ok", c.in, err)
			continue
		}
		if !c.ok {
			if err == nil {
				t.Errorf("%q: err = nil, want error", c.in)
			}
			continue
		}
		if bind != c.bind || sam != c.sam {
			t.Errorf("%q: got (%q, %q), want (%q, %q)", c.in, bind, sam, c.bind, c.sam)
		}
	}
}

func TestResolvePrecedenceAndCNMatch(t *testing.T) {
	r := &DomainRoles{
		Admin:   []string{"CN=Equipos Admin,OU=G,DC=x"},
		Analyst: []string{"soc-analistas"},
		Viewer:  []string{"Lectores"},
	}
	if role, matched := r.resolve([]string{"CN=soc-analistas,OU=G,DC=x"}); role != "analyst" || len(matched) != 1 {
		t.Errorf("analyst por CN: role=%q matched=%v", role, matched)
	}
	if role, _ := r.resolve([]string{"CN=Equipos Admin,OU=G,DC=x", "CN=Lectores,OU=G,DC=x"}); role != "admin" {
		t.Errorf("precedencia: role=%q, want admin", role)
	}
	if role, _ := r.resolve([]string{"CN=Otro,OU=G,DC=x"}); role != "" {
		t.Errorf("sin mapeo: role=%q, want vacio", role)
	}
}
