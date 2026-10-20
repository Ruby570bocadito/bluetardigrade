package hostgroup

import (
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

const sample = `version: 1
groups:
  - name: madrid
    label: Sede de Madrid
    hosts: ["PC-MAD-*", "srv-mad-01"]
    ad_ou: ["OU=Madrid, DC=corp,DC=local"]
  - name: servidores
    hosts: ["srv-*"]
    identities: ["Sede-Servidores"]
`

func TestMembershipByNameOUAndIdentity(t *testing.T) {
	set, err := Parse([]byte(sample))
	if err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		host Host
		want []string
	}{
		{Host{Name: "pc-mad-07"}, []string{"madrid"}},
		{Host{Name: "PC-MAD-07.corp.local"}, []string{"madrid"}},
		{Host{Name: "SRV-MAD-01"}, []string{"madrid", "servidores"}},
		{Host{Name: "srv-bcn-02"}, []string{"servidores"}},
		// OU: at the OU or under it, any case and spacing
		{Host{Name: "portatil-9", DN: "CN=PORTATIL-9,OU=Portatiles, OU=Madrid,DC=corp,DC=local"}, []string{"madrid"}},
		{Host{Name: "x", DN: "OU=Madrid,DC=corp,DC=local"}, []string{"madrid"}},
		// a component boundary: OU=OtroMadrid is not under OU=Madrid
		{Host{Name: "x", DN: "CN=X,OU=OtroMadrid,DC=corp,DC=local"}, []string{}},
		{Host{Name: "pc-bcn-01", Identity: "sede-servidores"}, []string{"servidores"}},
		{Host{Name: "pc-bcn-01"}, []string{}},
		{Host{}, []string{}},
	}
	for _, c := range cases {
		if got := set.Of(c.host); !reflect.DeepEqual(got, c.want) {
			t.Errorf("Of(%+v) = %v, want %v", c.host, got, c.want)
		}
	}
	if got := set.Names(); !reflect.DeepEqual(got, []string{"madrid", "servidores"}) {
		t.Errorf("Names = %v", got)
	}
}

func TestCriteriaAreNormalized(t *testing.T) {
	set, err := New([]Group{{Name: "a", Hosts: []string{" PC-1 ", "pc-1", "PC-*"}, OUs: []string{"OU=X , DC=Y"}, Identities: []string{"Id"}}})
	if err != nil {
		t.Fatal(err)
	}
	g := set.Groups()[0]
	if !reflect.DeepEqual(g.Hosts, []string{"pc-1", "pc-*"}) || !reflect.DeepEqual(g.OUs, []string{"ou=x,dc=y"}) || !reflect.DeepEqual(g.Identities, []string{"id"}) {
		t.Errorf("normalized group = %+v", g)
	}
	// Groups hands out copies
	g.Hosts[0] = "changed"
	if set.Groups()[0].Hosts[0] != "pc-1" {
		t.Error("Groups() exposed the set's own slices")
	}
}

func TestStrictValidation(t *testing.T) {
	for name, doc := range map[string]string{
		"unknown field":     "version: 1\ngroups:\n  - name: a\n    hostz: [x]\n",
		"version":           "version: 2\ngroups: []\n",
		"no version":        "groups: []\n",
		"upper-case name":   "version: 1\ngroups:\n  - name: Madrid\n",
		"long name":         "version: 1\ngroups:\n  - name: " + strings.Repeat("a", 33) + "\n",
		"duplicate":         "version: 1\ngroups:\n  - name: a\n  - name: a\n",
		"bad pattern":       "version: 1\ngroups:\n  - name: a\n    hosts: ['pc-[']\n",
		"space in pattern":  "version: 1\ngroups:\n  - name: a\n    hosts: ['pc 1']\n",
		"slash in pattern":  "version: 1\ngroups:\n  - name: a\n    hosts: ['a/b']\n",
		"empty pattern":     "version: 1\ngroups:\n  - name: a\n    hosts: ['  ']\n",
		"ou without =":      "version: 1\ngroups:\n  - name: a\n    ad_ou: ['Madrid']\n",
		"label with break":  "version: 1\ngroups:\n  - name: a\n    label: \"a\\nb\"\n",
		"identity w/ space": "version: 1\ngroups:\n  - name: a\n    identities: ['a b']\n",
		"not yaml":          "version: 1\ngroups: [\n",
	} {
		if _, err := Parse([]byte(doc)); err == nil {
			t.Errorf("%s: accepted %q", name, doc)
		}
	}
	many := make([]Group, MaxGroups+1)
	for i := range many {
		many[i] = Group{Name: fmt.Sprintf("g%d", i)}
	}
	if _, err := New(many); err == nil || !strings.Contains(err.Error(), "máximo") {
		t.Errorf("more than MaxGroups groups: %v", err)
	}
	if _, err := New(many[:MaxGroups]); err != nil {
		t.Errorf("MaxGroups groups refused: %v", err)
	}
	if set, err := Parse([]byte("  \n")); err != nil || len(set.Groups()) != 0 {
		t.Errorf("empty document: %v, %v", set, err)
	}
}

func TestLoadWriteRoundTrip(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "host-groups.yaml")
	set, sum, err := Load(path)
	if err != nil || len(set.Groups()) != 0 || sum != [32]byte{} {
		t.Fatalf("missing file: %v %v %v", set, sum, err)
	}
	orig, err := Parse([]byte(sample))
	if err != nil {
		t.Fatal(err)
	}
	data, err := orig.Marshal()
	if err != nil {
		t.Fatal(err)
	}
	written, err := WriteFile(path, data)
	if err != nil {
		t.Fatal(err)
	}
	again, sum, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if sum != written {
		t.Error("Load sum differs from the one WriteFile returned")
	}
	if !reflect.DeepEqual(again.Groups(), orig.Groups()) {
		t.Errorf("round trip changed the groups:\n%+v\n%+v", again.Groups(), orig.Groups())
	}
	if info, err := os.Stat(path); err != nil || info.Mode().Perm()&0o077 != 0 {
		t.Errorf("file mode = %v, %v", info.Mode(), err)
	}
	if err := os.WriteFile(path, []byte("version: 1\ngroups:\n  - name: Bad\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, _, err := Load(path); err == nil || !strings.Contains(err.Error(), "host-groups.yaml") {
		t.Errorf("a broken file must fail naming it: %v", err)
	}
}

func TestNilSetIsEmpty(t *testing.T) {
	var s *Set
	if len(s.Groups()) != 0 || len(s.Names()) != 0 || len(s.Of(Host{Name: "x"})) != 0 {
		t.Error("nil set is not empty")
	}
}

// The example shipped at the repository root must keep loading: it is
// what operators copy.
func TestShippedExampleLoads(t *testing.T) {
	set, _, err := Load(filepath.Join("..", "..", "host-groups.example.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	if got := set.Names(); !reflect.DeepEqual(got, []string{"madrid", "servidores"}) {
		t.Fatalf("example groups = %v", got)
	}
	if got := set.Of(Host{Name: "SRV-MAD-01"}); !reflect.DeepEqual(got, []string{"madrid", "servidores"}) {
		t.Fatalf("SRV-MAD-01 in %v", got)
	}
}
