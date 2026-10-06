// Package known implements the organization's known-software list
// (PLAN-DETALLADO §2.2): YAML entries naming software the whole
// deployment is expected to run (Lenovo Vantage, the fleet's VPN
// client, ...), matched by executable-image glob and/or SHA-256. A
// match enriches the event with known_software=<name> — the event is
// NEVER deleted or hidden (known software is also compromised
// software; it stays searchable in the flow) — the effects are honest
// downgrades of confidence, not erasure: the baseline stops reporting
// it as a novelty, the noise report stops counting it as noise, and a
// rule may opt out of firing on it with exclude_known_software.
//
// The file is hot-reloaded on the same ticker as rules and
// suppressions, and a malformed file is FATAL at startup (the engine
// must never run with a silently empty list an operator believes is
// armed). Match keys are precompiled at load: image globs are
// lowercased and backslash-normalized once, so the per-event cost is
// one lowercase + one glob per entry.
package known

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/yamlcheck"
	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"

	"gopkg.in/yaml.v3"
)

// Software is one entry of known-software.yaml.
//
// Semantics:
//   - name is the label the enrichment carries (enrichment.known_software)
//     and what the console shows; required.
//   - image is a glob over the executable image path. Matching is
//     case-insensitive (Windows paths) and backslash-normalized: both
//     sides are lowercased and `\` becomes `/` before the glob runs, so
//     the operator writes the path exactly like the sensor reports it.
//     `*` does NOT cross a directory separator — one star per path
//     level.
//   - sha256 is an exact-match list of file hashes (64 hex characters,
//     case-normalized). Entries may carry image, sha256 or both — at
//     least one is required, or the loader rejects the entry (loudly:
//     an entry that could never match would be a silent no-op).
//   - signer is accepted for forward compatibility (v1.2 will match on
//     the sensor's signature field) and is INERT today: documented as
//     metadata, never part of the match.
type Software struct {
	Name   string   `yaml:"name" json:"name"`
	Image  string   `yaml:"image,omitempty" json:"image,omitempty"`
	SHA256 []string `yaml:"sha256,omitempty" json:"sha256,omitempty"`
	Signer string   `yaml:"signer,omitempty" json:"signer,omitempty"`
}

// fileShape is the whole YAML document shape.
type fileShape struct {
	Version  int        `yaml:"version"`
	Software []Software `yaml:"software"`
}

// Load caps: the list is operator config read at startup AND at every
// hot-reload tick, and Match walks it per event. 1000 entries is far
// beyond any legitimate deployment (the plan's example is a handful),
// name/image/signer bounds are the same order as the suppression caps,
// and a file hash is exactly 64 hex characters.
const (
	MaxSoftware      = 1000
	MaxNameLen       = 128
	MaxImageLen      = 512
	MaxSignerLen     = 128
	MaxSHA256Entries = 32
	sha256Len        = 64
)

// SupportedVersion is the only schema version the loader accepts: a
// file written by a newer engine must fail LOUDLY, not partially.
const SupportedVersion = 1

var hexRe = regexp.MustCompile(`^[0-9a-f]{64}$`)

// entry is one parsed entry with its precompiled match keys.
type entry struct {
	sw      Software
	glob    string // lowercased, backslash-normalized image glob
	sha256  map[string]struct{}
	hasGlob bool
}

// normalize lowercases and backslash-normalizes a path (Windows paths
// are case-insensitive and backslash-separated; the glob then sees
// forward slashes on every platform).
func normalize(p string) string {
	return strings.ToLower(strings.ReplaceAll(strings.TrimSpace(p), `\`, `/`))
}

// Validate applies the acceptance rules the loader enforces, with
// path-free messages: name required and capped, at least one match
// key, caps everywhere, sha256 exactly 64 hex characters, image a
// compilable glob.
func Validate(sw Software) error {
	if strings.TrimSpace(sw.Name) == "" {
		return fmt.Errorf("name is required")
	}
	if len(sw.Name) > MaxNameLen {
		return fmt.Errorf("name longer than %d characters", MaxNameLen)
	}
	if len(sw.Signer) > MaxSignerLen {
		return fmt.Errorf("signer longer than %d characters", MaxSignerLen)
	}
	if sw.Image == "" && len(sw.SHA256) == 0 {
		return fmt.Errorf("entry %q: image and sha256 are both empty (nothing would match)", sw.Name)
	}
	if len(sw.Image) > MaxImageLen {
		return fmt.Errorf("entry %q: image longer than %d characters", sw.Name, MaxImageLen)
	}
	if len(sw.SHA256) > MaxSHA256Entries {
		return fmt.Errorf("entry %q: %d sha256 entries, over the %d cap", sw.Name, len(sw.SHA256), MaxSHA256Entries)
	}
	for i, h := range sw.SHA256 {
		if !hexRe.MatchString(h) {
			return fmt.Errorf("entry %q: sha256 #%d is not %d hex characters", sw.Name, i+1, sha256Len)
		}
	}
	if sw.Image != "" {
		if _, err := filepath.Match(normalize(sw.Image), ""); err != nil {
			return fmt.Errorf("entry %q: bad image glob: %w", sw.Name, err)
		}
	}
	return nil
}

// Parse validates the whole document and returns the entries in file
// order (the example file shipped with the engine loads with this
// function, so the documented schema cannot drift from the loader).
func Parse(data []byte) ([]Software, error) {
	if err := yamlcheck.Guard("known-software", data); err != nil {
		return nil, err
	}
	var f fileShape
	if err := yaml.Unmarshal(data, &f); err != nil {
		return nil, fmt.Errorf("known: parse: %w", err)
	}
	if f.Version != SupportedVersion {
		return nil, fmt.Errorf("known: version %d not supported (this engine reads version %d)", f.Version, SupportedVersion)
	}
	if len(f.Software) > MaxSoftware {
		return nil, fmt.Errorf("known: %d software entries, over the %d cap", len(f.Software), MaxSoftware)
	}
	out := make([]Software, 0, len(f.Software))
	for i, raw := range f.Software {
		sw := Software{
			Name:   strings.TrimSpace(raw.Name),
			Image:  strings.TrimSpace(raw.Image),
			Signer: strings.TrimSpace(raw.Signer),
		}
		for _, h := range raw.SHA256 {
			sw.SHA256 = append(sw.SHA256, strings.ToLower(strings.TrimSpace(h)))
		}
		if err := Validate(sw); err != nil {
			return nil, fmt.Errorf("known: entry #%d: %w", i+1, err)
		}
		out = append(out, sw)
	}
	return out, nil
}

// Manager holds the active set. LoadFile swaps it atomically (hot
// reload); Match is the only lookup the engine needs. Safe for
// concurrent use.
type Manager struct {
	mu        sync.RWMutex
	entries   []entry
	path      string
	loadedMod time.Time // mtime at the last successful load (zero = loaded with no file)
}

// New returns an empty manager (the feature is off until LoadFile).
func New() *Manager { return &Manager{} }

// Count returns the loaded entry count.
func (m *Manager) Count() int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return len(m.entries)
}

// Snapshot returns the loaded entries (read-only use, e.g. the API).
func (m *Manager) Snapshot() []Software {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make([]Software, 0, len(m.entries))
	for _, e := range m.entries {
		out = append(out, e.sw)
	}
	return out
}

// Match returns the name of the first entry matching the event's
// process image or sha256. Events without a process are never known
// software (the list describes executables). The first match wins in
// file order — keep the most specific entries first.
func (m *Manager) Match(ev *model.Event) (string, bool) {
	if ev == nil || ev.Process == nil {
		return "", false
	}
	var image string
	if ev.Process.Image != "" {
		image = normalize(ev.Process.Image)
	}
	var hash string
	if ev.Process.Hashes != nil {
		hash = strings.ToLower(ev.Process.Hashes["sha256"])
	}
	if image == "" && hash == "" {
		return "", false
	}
	m.mu.RLock()
	defer m.mu.RUnlock()
	for _, e := range m.entries {
		if e.hasGlob && image != "" {
			if ok, err := filepath.Match(e.glob, image); err == nil && ok {
				return e.sw.Name, true
			}
		}
		if hash != "" && len(e.sha256) > 0 {
			if _, ok := e.sha256[hash]; ok {
				return e.sw.Name, true
			}
		}
	}
	return "", false
}

// LoadFile parses path and swaps it in as the active set. A missing
// file is not an error (the feature is simply off) and yields an empty
// set; a malformed one IS an error so a typo cannot silently disable a
// list the operator believes is armed.
func (m *Manager) LoadFile(path string) error {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			m.mu.Lock()
			m.entries = nil
			m.path = path
			m.loadedMod = time.Time{}
			m.mu.Unlock()
			return nil
		}
		return fmt.Errorf("known: read %s: %w", path, err)
	}
	sws, err := Parse(data)
	if err != nil {
		return err
	}
	entries := make([]entry, 0, len(sws))
	for _, sw := range sws {
		e := entry{sw: sw, sha256: map[string]struct{}{}}
		if sw.Image != "" {
			e.glob = normalize(sw.Image)
			e.hasGlob = true
		}
		for _, h := range sw.SHA256 {
			e.sha256[h] = struct{}{}
		}
		entries = append(entries, e)
	}
	var mod time.Time
	if st, err := os.Stat(path); err == nil {
		mod = st.ModTime()
	}
	m.mu.Lock()
	m.entries = entries
	m.path = path
	m.loadedMod = mod
	m.mu.Unlock()
	return nil
}

// ReloadIfChanged re-reads path when the file on disk changed since
// the last load — the write-before-read discipline shared with the
// suppression manager so a hand edit between ticks is never clobbered
// by a full rewrite. Returns true when the set was reloaded.
func (m *Manager) ReloadIfChanged(path string) (bool, error) {
	st, err := os.Stat(path)
	if err != nil && !os.IsNotExist(err) {
		return false, fmt.Errorf("known: stat %s: %w", path, err)
	}
	var mod time.Time
	if st != nil {
		mod = st.ModTime()
	}
	m.mu.RLock()
	sameState := path == m.path && mod.Equal(m.loadedMod)
	m.mu.RUnlock()
	if sameState {
		return false, nil
	}
	if err := m.LoadFile(path); err != nil {
		return false, err
	}
	return true, nil
}

// Path returns the file the current set was loaded from.
func (m *Manager) Path() string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.path
}
