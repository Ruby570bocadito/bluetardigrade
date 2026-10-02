// Loader for the two operator-owned name lists of active response:
// -respond-operators (layer 3, who may act) and -respond-protected
// (R6, what may never be killed). Both are versioned YAML files with
// the same contract as every config surface of the house: a missing
// file is a documented degradation (empty allowlist / defaults only),
// a malformed file or one over its cap is an error the caller turns
// FATAL at startup and keep-previous-loud on hot-reload, and every
// entry is capped and non-empty — a hostile file cannot smuggle
// control characters into audit lines or logs.

package respond

import (
	"bytes"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"fmt"
	"os"
	"strings"

	"github.com/Ruby570bocadito/bluetardigrade/internal/yamlcheck"

	"gopkg.in/yaml.v3"
)

// nameFile is the shared YAML shape: {"version": 1, "operators":
// [...]} / {"version": 1, "protected": [...]}. The version field is
// required: a future format change must be detectable, not guessed.
type nameFile struct {
	Version int      `yaml:"version"`
	Names   []string `yaml:"names"`
}

// loadNameFile parses path as a versioned name list and returns the
// trimmed, validated set. max caps the ENTRY COUNT (design §4: same
// cap house as the rules loader); each name is capped at MaxNameLen
// runes and must be non-empty after trimming.
func loadNameFile(path, field string, max int) (map[string]struct{}, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			// documented degradation, not an error: the caller
			// started the surface knowing the file is optional
			return map[string]struct{}{}, nil
		}
		return nil, fmt.Errorf("respond %s: read %s: %w", field, path, err)
	}
	if err := yamlcheck.Guard(path, data); err != nil {
		return nil, err
	}
	var nf nameFile
	if err := yaml.Unmarshal(data, &nf); err != nil {
		return nil, fmt.Errorf("respond %s: %s does not parse: %w", field, path, err)
	}
	if nf.Version != 1 {
		return nil, fmt.Errorf("respond %s: unsupported version %d (want 1)", field, nf.Version)
	}
	if len(nf.Names) > max {
		return nil, fmt.Errorf("respond %s: %d entries exceed the cap of %d", field, len(nf.Names), max)
	}
	set := make(map[string]struct{}, len(nf.Names))
	for _, n := range nf.Names {
		n = strings.TrimSpace(n)
		if n == "" {
			return nil, fmt.Errorf("respond %s: empty entry", field)
		}
		if len([]rune(n)) > MaxNameLen {
			return nil, fmt.Errorf("respond %s: entry exceeds %d characters", field, MaxNameLen)
		}
		set[n] = struct{}{}
	}
	return set, nil
}

// operatorFile is the -respond-operators shape. Version 1 lists names
// only ({version: 1, names: [ana]}): any holder of the API token can
// claim any listed name, so the operator field is attribution, not
// authentication. Version 2 binds every operator to a credential of
// their own ({version: 2, operators: [{name: ana, token_sha256: ...}]}),
// presented in the X-SF-Operator-Token header of every kill request.
type operatorFile struct {
	Version   int             `yaml:"version"`
	Names     []string        `yaml:"names"`
	Operators []operatorEntry `yaml:"operators"`
}

type operatorEntry struct {
	Name        string `yaml:"name"`
	TokenSHA256 string `yaml:"token_sha256"`
}

// operatorDigest is the SHA-256 of an operator credential; nil means a
// version-1 entry (name only).
type operatorDigest = *[sha256.Size]byte

// loadOperatorFile parses -respond-operators in either version. A
// missing file is the documented empty allowlist.
func loadOperatorFile(path string) (map[string]operatorDigest, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return map[string]operatorDigest{}, nil
		}
		return nil, fmt.Errorf("respond operators: read %s: %w", path, err)
	}
	if err := yamlcheck.Guard(path, data); err != nil {
		return nil, err
	}
	var f operatorFile
	dec := yaml.NewDecoder(bytes.NewReader(data))
	dec.KnownFields(true)
	if err := dec.Decode(&f); err != nil {
		return nil, fmt.Errorf("respond operators: %s does not parse: %w", path, err)
	}
	switch f.Version {
	case 1:
		if len(f.Operators) > 0 {
			return nil, fmt.Errorf("respond operators: version 1 lists names; use version 2 for operators with credentials")
		}
		if len(f.Names) > MaxOperators {
			return nil, fmt.Errorf("respond operators: %d entries exceed the cap of %d", len(f.Names), MaxOperators)
		}
		set := make(map[string]operatorDigest, len(f.Names))
		for _, n := range f.Names {
			n, err := validName(n)
			if err != nil {
				return nil, fmt.Errorf("respond operators: %w", err)
			}
			set[n] = nil
		}
		return set, nil
	case 2:
		if len(f.Names) > 0 {
			return nil, fmt.Errorf("respond operators: version 2 lists operators with token_sha256, not names")
		}
		if len(f.Operators) == 0 {
			return nil, fmt.Errorf("respond operators: version 2 file lists no operators")
		}
		if len(f.Operators) > MaxOperators {
			return nil, fmt.Errorf("respond operators: %d entries exceed the cap of %d", len(f.Operators), MaxOperators)
		}
		set := make(map[string]operatorDigest, len(f.Operators))
		seen := map[[sha256.Size]byte]string{}
		for _, e := range f.Operators {
			n, err := validName(e.Name)
			if err != nil {
				return nil, fmt.Errorf("respond operators: %w", err)
			}
			if _, dup := set[n]; dup {
				return nil, fmt.Errorf("respond operators: duplicate operator %q", n)
			}
			raw, err := hex.DecodeString(strings.TrimSpace(e.TokenSHA256))
			if err != nil || len(raw) != sha256.Size {
				return nil, fmt.Errorf("respond operators: %q needs token_sha256 (64 hex characters; see 'engine operator-credential')", n)
			}
			var d [sha256.Size]byte
			copy(d[:], raw)
			if prev, dup := seen[d]; dup {
				return nil, fmt.Errorf("respond operators: %q reuses the credential of %q", n, prev)
			}
			seen[d] = n
			set[n] = &d
		}
		return set, nil
	default:
		return nil, fmt.Errorf("respond operators: unsupported version %d (want 1 or 2)", f.Version)
	}
}

func validName(n string) (string, error) {
	n = strings.TrimSpace(n)
	if n == "" {
		return "", fmt.Errorf("empty entry")
	}
	if len([]rune(n)) > MaxNameLen {
		return "", fmt.Errorf("entry exceeds %d characters", MaxNameLen)
	}
	return n, nil
}

// credentialMatches compares the digest of supplied with want in
// constant time.
func credentialMatches(supplied string, want operatorDigest) bool {
	sum := sha256.Sum256([]byte(supplied))
	return supplied != "" && subtle.ConstantTimeCompare(sum[:], want[:]) == 1
}
