package ingest

// Per-sensor ingest identities (-ingest-identities). The shared token
// authenticates "some sensor of this deployment": every endpoint holds
// the same secret, so one compromised host can speak for any other —
// invent alerts for it, inflate its risk score, feed its kill chains.
// An identity is a credential of its own (stored as a SHA-256 digest,
// never in clear) bound to the hosts it may report for. Events whose
// host falls outside that binding are refused at the boundary and
// counted, because a sensor claiming another machine's name is a
// compromise signal in itself, not a parse error.
//
// The file is versioned YAML with the same contract as every config
// surface of the engine: a malformed file, an unknown field or an
// entry over its cap is an error (FATAL at startup, keep-previous-loud
// on hot-reload); a missing file is an error too, because the operator
// asked for identities explicitly and silently falling back to the
// shared token would hide the misconfiguration.

import (
	"bytes"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"fmt"
	"os"
	"strings"
	"unicode"

	"github.com/Ruby570bocadito/bluetardigrade/internal/yamlcheck"

	"gopkg.in/yaml.v3"
)

const (
	// MaxIdentities caps the identities file (the AUTH check walks
	// every entry in constant time, so the cap bounds handshake cost).
	MaxIdentities = 4096
	// MaxIdentityHosts caps the hosts bound to one identity.
	MaxIdentityHosts = 64
	// maxIdentityNameRunes bounds the name stamped into every event.
	maxIdentityNameRunes = 64
	// maxIdentityFileBytes bounds the file before it is read whole.
	maxIdentityFileBytes = 1 << 20

	// AnyHost binds an identity to every host: collectors that import
	// evidence observed about many machines (IDS, mail, firewall).
	AnyHost = "*"

	// IdentityAttribute is the event attribute carrying the name of the
	// identity that delivered the event (stamped by the engine when
	// identities are configured; a feed-supplied value is overwritten).
	IdentityAttribute = "ingest_identity"

	// sharedIdentityName labels events delivered with the shared token
	// while identities are configured (migration period).
	sharedIdentityName = "shared-token"
)

// Identity is one authenticated sensor credential.
type Identity struct {
	Name   string
	digest [sha256.Size]byte
	hosts  map[string]struct{} // lowercased; nil = AnyHost
}

// AllowsHost reports whether the identity may report events for host.
func (id *Identity) AllowsHost(host string) bool {
	if id == nil || id.hosts == nil {
		return true
	}
	_, ok := id.hosts[strings.ToLower(host)]
	return ok
}

// identityFile is the YAML shape of -ingest-identities.
type identityFile struct {
	Version    int             `yaml:"version"`
	Identities []identityEntry `yaml:"identities"`
}

type identityEntry struct {
	Name        string   `yaml:"name"`
	TokenSHA256 string   `yaml:"token_sha256"`
	Hosts       []string `yaml:"hosts"`
}

// LoadIdentities parses and validates an identities file.
func LoadIdentities(path string) ([]Identity, error) {
	info, err := os.Stat(path)
	if err != nil {
		return nil, fmt.Errorf("ingest identities: %w", err)
	}
	if info.Size() > maxIdentityFileBytes {
		return nil, fmt.Errorf("ingest identities: %s is %d bytes, over the %d byte cap", path, info.Size(), maxIdentityFileBytes)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("ingest identities: %w", err)
	}
	if err := yamlcheck.Guard(path, data); err != nil {
		return nil, err
	}
	var f identityFile
	dec := yaml.NewDecoder(bytes.NewReader(data))
	dec.KnownFields(true) // a typo ("token:" with a clear token) must fail, not be ignored
	if err := dec.Decode(&f); err != nil {
		return nil, fmt.Errorf("ingest identities: %s does not parse: %w", path, err)
	}
	if f.Version != 1 {
		return nil, fmt.Errorf("ingest identities: unsupported version %d (want 1)", f.Version)
	}
	if len(f.Identities) == 0 {
		return nil, fmt.Errorf("ingest identities: %s declares no identities", path)
	}
	if len(f.Identities) > MaxIdentities {
		return nil, fmt.Errorf("ingest identities: %d entries exceed the cap of %d", len(f.Identities), MaxIdentities)
	}
	out := make([]Identity, 0, len(f.Identities))
	names := map[string]bool{}
	digests := map[[sha256.Size]byte]string{}
	for i, e := range f.Identities {
		id, err := compileIdentity(e)
		if err != nil {
			return nil, fmt.Errorf("ingest identities: entry %d (%q): %w", i+1, e.Name, err)
		}
		if names[id.Name] {
			return nil, fmt.Errorf("ingest identities: duplicate name %q", id.Name)
		}
		if prev, dup := digests[id.digest]; dup {
			return nil, fmt.Errorf("ingest identities: %q reuses the token of %q (every sensor needs its own)", id.Name, prev)
		}
		names[id.Name] = true
		digests[id.digest] = id.Name
		out = append(out, id)
	}
	return out, nil
}

func compileIdentity(e identityEntry) (Identity, error) {
	name := strings.TrimSpace(e.Name)
	if name == "" {
		return Identity{}, fmt.Errorf("name is required")
	}
	if len([]rune(name)) > maxIdentityNameRunes {
		return Identity{}, fmt.Errorf("name exceeds %d characters", maxIdentityNameRunes)
	}
	if strings.IndexFunc(name, unicode.IsControl) >= 0 || name == sharedIdentityName {
		return Identity{}, fmt.Errorf("name contains control characters or is reserved")
	}
	raw, err := hex.DecodeString(strings.TrimSpace(e.TokenSHA256))
	if err != nil || len(raw) != sha256.Size {
		return Identity{}, fmt.Errorf("token_sha256 must be 64 hex characters (sha256 of the token; see 'engine ingest-identity')")
	}
	id := Identity{Name: name}
	copy(id.digest[:], raw)
	if len(e.Hosts) == 0 {
		return Identity{}, fmt.Errorf("hosts is required (use [\"*\"] for collectors that report many hosts)")
	}
	if len(e.Hosts) > MaxIdentityHosts {
		return Identity{}, fmt.Errorf("%d hosts exceed the cap of %d", len(e.Hosts), MaxIdentityHosts)
	}
	for _, h := range e.Hosts {
		h = strings.TrimSpace(h)
		if h == AnyHost {
			if len(e.Hosts) != 1 {
				return Identity{}, fmt.Errorf("%q must be the only host entry", AnyHost)
			}
			return id, nil
		}
		if h == "" || len([]rune(h)) > maxHostRunes || strings.IndexFunc(h, unicode.IsControl) >= 0 {
			return Identity{}, fmt.Errorf("invalid host entry %q", h)
		}
		if id.hosts == nil {
			id.hosts = map[string]struct{}{}
		}
		id.hosts[strings.ToLower(h)] = struct{}{}
	}
	return id, nil
}

// TokenDigest returns the hex SHA-256 of a token, the form stored in
// the identities file.
func TokenDigest(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// matchIdentity returns the identity whose digest equals the digest of
// supplied, or nil. Every entry is compared, with no early exit, so
// the handshake time does not reveal which entry (if any) matched.
func matchIdentity(ids []Identity, supplied []byte) *Identity {
	sum := sha256.Sum256(supplied)
	match := -1
	for i := range ids {
		eq := subtle.ConstantTimeCompare(sum[:], ids[i].digest[:])
		match = subtle.ConstantTimeSelect(eq, i, match)
	}
	if match < 0 {
		return nil
	}
	return &ids[match]
}
