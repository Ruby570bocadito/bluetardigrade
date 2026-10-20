// Package hostgroup groups the machines the engine sees (F2 of
// docs/ROADMAP.md): a group names a set of hosts by host-name patterns,
// Active Directory OUs and ingest identities. Groups are the unit of
// operator access (a console account limited to some groups sees and
// acts on their machines only) and, later, of response levels. This
// package only answers "which groups does this host belong to"; the API
// decides what that means for a caller.
//
// The file (-host-groups) is YAML, version 1:
//
//	version: 1
//	groups:
//	  - name: madrid               # [a-z0-9][a-z0-9_-]{0,31}
//	    label: Sede de Madrid      # free text for the console
//	    hosts: ["pc-mad-*", "srv-mad-01"]       # name patterns, any case
//	    ad_ou: ["OU=Madrid,DC=corp,DC=local"]   # computer DN at or under
//	    identities: ["sede-madrid"]             # ingest credential names
//
// A host belongs to a group when any one criterion matches. Validation
// is strict (unknown fields, bad patterns, duplicate names fail the
// whole file): a typo must not silently widen or narrow what an
// operator sees.
package hostgroup

import (
	"bytes"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"
	"unicode"

	"gopkg.in/yaml.v3"

	"github.com/Ruby570bocadito/bluetardigrade/internal/yamlcheck"
)

const (
	// Version is the only file version this engine reads and writes.
	Version = 1
	// MaxGroups caps the groups of one file.
	MaxGroups = 64
	// MaxCriteria caps each criterion list of one group.
	MaxCriteria = 256
	// MaxFileBytes caps the file the engine reads.
	MaxFileBytes = 256 * 1024

	maxPattern  = 128
	maxOU       = 512
	maxLabel    = 64
	maxIdentity = 64
)

var nameRE = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,31}$`)

// Group is one group as the file and the API carry it.
type Group struct {
	Name       string   `yaml:"name" json:"name"`
	Label      string   `yaml:"label,omitempty" json:"label"`
	Hosts      []string `yaml:"hosts,omitempty" json:"hosts"`
	OUs        []string `yaml:"ad_ou,omitempty" json:"ad_ou"`
	Identities []string `yaml:"identities,omitempty" json:"identities"`
}

type file struct {
	Version int     `yaml:"version"`
	Groups  []Group `yaml:"groups"`
}

// Set is a validated, immutable list of groups. The zero value and nil
// are empty sets.
type Set struct {
	groups []Group
}

// Groups returns a copy of the groups in file order.
func (s *Set) Groups() []Group {
	if s == nil {
		return []Group{}
	}
	out := make([]Group, len(s.groups))
	for i, g := range s.groups {
		out[i] = Group{
			Name:       g.Name,
			Label:      g.Label,
			Hosts:      append([]string{}, g.Hosts...),
			OUs:        append([]string{}, g.OUs...),
			Identities: append([]string{}, g.Identities...),
		}
	}
	return out
}

// Names returns the group names in file order.
func (s *Set) Names() []string {
	if s == nil {
		return []string{}
	}
	out := make([]string, len(s.groups))
	for i, g := range s.groups {
		out[i] = g.Name
	}
	return out
}

// Host is what membership is decided on: the host name the sensors
// report, the ingest identity that delivered it (if any) and its
// computer DN in Active Directory (if the connector knows it).
type Host struct {
	Name     string
	Identity string
	DN       string
}

// Of returns the names of the groups host belongs to, in file order.
func (s *Set) Of(h Host) []string {
	out := []string{}
	if s == nil {
		return out
	}
	name := strings.ToLower(strings.TrimSpace(h.Name))
	identity := strings.ToLower(strings.TrimSpace(h.Identity))
	dn := CanonicalDN(h.DN)
	for _, g := range s.groups {
		if member(g, name, identity, dn) {
			out = append(out, g.Name)
		}
	}
	return out
}

// member reads normalized (lowercased) criteria.
func member(g Group, name, identity, dn string) bool {
	if name != "" {
		for _, p := range g.Hosts {
			// patterns were validated: Match cannot fail here
			if ok, _ := path.Match(p, name); ok {
				return true
			}
		}
	}
	if identity != "" {
		for _, id := range g.Identities {
			if id == identity {
				return true
			}
		}
	}
	if dn != "" {
		for _, ou := range g.OUs {
			// at the OU or under it, on a component boundary
			if dn == ou || strings.HasSuffix(dn, ","+ou) {
				return true
			}
		}
	}
	return false
}

// Normalize validates groups and returns them normalized: names checked,
// criteria trimmed, lowercased and deduplicated. The first problem is
// reported with the group it is in.
func Normalize(groups []Group) ([]Group, error) {
	if len(groups) > MaxGroups {
		return nil, fmt.Errorf("hay %d grupos; el máximo es %d", len(groups), MaxGroups)
	}
	out := make([]Group, 0, len(groups))
	seen := map[string]bool{}
	for i, g := range groups {
		name := strings.TrimSpace(g.Name)
		if !nameRE.MatchString(name) {
			return nil, fmt.Errorf("grupo %d: nombre %q inválido (minúsculas, cifras, - y _, hasta 32, empezando por letra o cifra)", i+1, name)
		}
		if seen[name] {
			return nil, fmt.Errorf("grupo %s: repetido", name)
		}
		seen[name] = true
		label := strings.TrimSpace(g.Label)
		if len([]rune(label)) > maxLabel || hasControl(label) {
			return nil, fmt.Errorf("grupo %s: la etiqueta admite %d caracteres sin saltos de línea", name, maxLabel)
		}
		hosts, err := list(name, "hosts", g.Hosts, maxPattern, func(p string) error {
			if strings.ContainsAny(p, " \t/\\") {
				return errors.New("sin espacios ni barras")
			}
			if _, err := path.Match(p, ""); err != nil {
				return errors.New("patrón mal formado")
			}
			return nil
		})
		if err != nil {
			return nil, err
		}
		ous, err := list(name, "ad_ou", g.OUs, maxOU, func(ou string) error {
			if !strings.Contains(ou, "=") {
				return errors.New("no parece un DN (OU=...,DC=...)")
			}
			return nil
		})
		if err != nil {
			return nil, err
		}
		identities, err := list(name, "identities", g.Identities, maxIdentity, func(id string) error {
			if strings.ContainsAny(id, " \t") {
				return errors.New("sin espacios")
			}
			return nil
		})
		if err != nil {
			return nil, err
		}
		out = append(out, Group{Name: name, Label: label, Hosts: hosts, OUs: ous, Identities: identities})
	}
	return out, nil
}

// list normalizes one criterion list: trimmed, lowercased (DNs, host
// names and identity names compare without case), empty entries
// refused, duplicates dropped.
func list(group, field string, in []string, maxLen int, check func(string) error) ([]string, error) {
	if len(in) > MaxCriteria {
		return nil, fmt.Errorf("grupo %s: %s tiene %d entradas; el máximo es %d", group, field, len(in), MaxCriteria)
	}
	out := []string{}
	seen := map[string]bool{}
	for _, raw := range in {
		v := strings.ToLower(strings.TrimSpace(raw))
		if field == "ad_ou" {
			v = canonicalDN(v)
		}
		if v == "" || len(v) > maxLen || hasControl(v) {
			return nil, fmt.Errorf("grupo %s: %s %q vacío, demasiado largo (%d) o con caracteres de control", group, field, raw, maxLen)
		}
		if err := check(v); err != nil {
			return nil, fmt.Errorf("grupo %s: %s %q: %v", group, field, raw, err)
		}
		if !seen[v] {
			seen[v] = true
			out = append(out, v)
		}
	}
	return out, nil
}

// canonicalDN drops the spaces around the commas and equal signs of a
// DN ("OU=Madrid, DC=corp" and "ou=madrid,dc=corp" are the same OU).
func canonicalDN(dn string) string {
	parts := strings.Split(dn, ",")
	for i, p := range parts {
		k, v, ok := strings.Cut(p, "=")
		if ok {
			parts[i] = strings.TrimSpace(k) + "=" + strings.TrimSpace(v)
		} else {
			parts[i] = strings.TrimSpace(p)
		}
	}
	return strings.Join(parts, ",")
}

// CanonicalDN is the form DNs are compared in (lowercased, canonical).
func CanonicalDN(dn string) string {
	return canonicalDN(strings.ToLower(strings.TrimSpace(dn)))
}

func hasControl(s string) bool {
	return strings.IndexFunc(s, unicode.IsControl) >= 0
}

// New validates groups into a Set.
func New(groups []Group) (*Set, error) {
	n, err := Normalize(groups)
	if err != nil {
		return nil, err
	}
	return &Set{groups: n}, nil
}

// Parse reads a file's contents. An empty document is an empty set.
func Parse(data []byte) (*Set, error) {
	if len(bytes.TrimSpace(data)) == 0 {
		return &Set{}, nil
	}
	if len(data) > MaxFileBytes {
		return nil, fmt.Errorf("el fichero de grupos ocupa %d bytes; el máximo es %d", len(data), MaxFileBytes)
	}
	if err := yamlcheck.Guard("host-groups", data); err != nil {
		return nil, err
	}
	dec := yaml.NewDecoder(bytes.NewReader(data))
	dec.KnownFields(true)
	var f file
	if err := dec.Decode(&f); err != nil && !errors.Is(err, io.EOF) {
		return nil, fmt.Errorf("el fichero de grupos no es YAML válido: %v", err)
	}
	if f.Version != Version {
		return nil, fmt.Errorf("versión %d del fichero de grupos; esta versión del motor lee la %d", f.Version, Version)
	}
	return New(f.Groups)
}

// Load reads path. A missing file is an empty set (groups not defined
// yet), not an error; sum is the sha256 of the bytes read (zero when
// the file is missing), the drift baseline of a later write.
func Load(path string) (*Set, [sha256.Size]byte, error) {
	var sum [sha256.Size]byte
	info, err := os.Stat(path)
	if errors.Is(err, os.ErrNotExist) {
		return &Set{}, sum, nil
	}
	if err != nil {
		return nil, sum, fmt.Errorf("grupos de equipos: %w", err)
	}
	if info.Size() > MaxFileBytes {
		return nil, sum, fmt.Errorf("grupos de equipos: %s ocupa %d bytes; el máximo es %d", path, info.Size(), MaxFileBytes)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, sum, fmt.Errorf("grupos de equipos: %w", err)
	}
	set, err := Parse(data)
	if err != nil {
		return nil, sum, fmt.Errorf("grupos de equipos (%s): %w", path, err)
	}
	return set, sha256.Sum256(data), nil
}

// Marshal is the file form of the set.
func (s *Set) Marshal() ([]byte, error) {
	header := []byte("# Grupos de equipos (bluetardigrade). La consola los edita en\n# Ajustes -> Grupos; docs/OPERATIONS.md explica cada campo.\n")
	body, err := yaml.Marshal(file{Version: Version, Groups: s.Groups()})
	if err != nil {
		return nil, fmt.Errorf("grupos de equipos: %w", err)
	}
	return append(header, body...), nil
}

// WriteFile replaces path with data in one rename (mode 0600), so the
// engine never reads a half-written file. It returns the sha256 of what
// it wrote.
func WriteFile(path string, data []byte) ([sha256.Size]byte, error) {
	var sum [sha256.Size]byte
	tmp, err := os.CreateTemp(filepath.Dir(path), ".host-groups-*")
	if err != nil {
		return sum, fmt.Errorf("grupos de equipos: fichero temporal: %w", err)
	}
	name := tmp.Name()
	defer os.Remove(name) // no-op after the rename
	if err := tmp.Chmod(0o600); err != nil {
		tmp.Close()
		return sum, fmt.Errorf("grupos de equipos: permisos: %w", err)
	}
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return sum, fmt.Errorf("grupos de equipos: escritura: %w", err)
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return sum, fmt.Errorf("grupos de equipos: sync: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return sum, fmt.Errorf("grupos de equipos: cierre: %w", err)
	}
	if err := os.Rename(name, path); err != nil {
		return sum, fmt.Errorf("grupos de equipos: instalación: %w", err)
	}
	return sha256.Sum256(data), nil
}
