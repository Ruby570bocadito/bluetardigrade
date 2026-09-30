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
	"fmt"
	"os"
	"strings"

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
