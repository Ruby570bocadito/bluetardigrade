package correlate

import (
	"fmt"
	"hash/fnv"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
	"unicode"

	"github.com/Ruby570bocadito/bluetardigrade/internal/rules"
	"github.com/Ruby570bocadito/bluetardigrade/internal/yamlcheck"

	"gopkg.in/yaml.v3"
)

// Step references one contributing rule by its exact name, or several
// alternatives (any of them advances the step).
type Step struct {
	Rule  string   `yaml:"rule"`
	Rules []string `yaml:"rules"`
}

// names returns the rules that advance the step (rule first, deduped).
func (st Step) names() []string {
	out := []string{}
	seen := map[string]bool{}
	for _, n := range append([]string{st.Rule}, st.Rules...) {
		if n != "" && !seen[n] {
			seen[n] = true
			out = append(out, n)
		}
	}
	return out
}

// Scopes: a chain advances per host (default) or per user account,
// across every host the account touches (lateral movement).
const (
	ScopeHost = "host"
	ScopeUser = "user"
)

// maxStepRules bounds the alternatives of one step; maxMinHosts the
// distinct hosts a user-scoped chain may require.
const (
	maxStepRules = 16
	maxMinHosts  = 16
)

// Sequence is the YAML definition of one kill chain.
type Sequence struct {
	Name        string   `yaml:"name"`
	ID          string   `yaml:"id"`
	Description string   `yaml:"description"`
	Severity    string   `yaml:"severity"`
	Window      string   `yaml:"window"`
	Tags        []string `yaml:"tags"`
	Steps       []Step   `yaml:"steps"`
	// Scope is "host" (default) or "user": with "user" the chain follows
	// one account across hosts; MinHosts is how many distinct hosts the
	// completed chain must span (default 1).
	Scope    string `yaml:"scope"`
	MinHosts int    `yaml:"min_hosts"`
}

type compiled struct {
	seq      Sequence
	window   time.Duration
	scope    string
	minHosts int
	steps    [][]string // rule names advancing each step
	// fp is the layout fingerprint of steps (see stepsFingerprint):
	// every in-flight state carries it, and a reload that changes the
	// step order/composition drops the old progress instead of
	// reinterpreting it against the new layout (sesión 100agentes-2,
	// agente 18, P2).
	fp uint64
}

// Load-time hardening: sequences/ is configuration, but configuration
// is an attack surface too — a hostile or hand-edited file must fail
// LOUDLY at load instead of degrading a running engine. Each bound
// names the failure mode it prevents; the exported mirrors let tests
// and operator tooling pin them the way MaxTrackedStates does.
const (
	// maxFileBytes caps one sequence file. os.ReadFile has no bound of
	// its own: a multi-gigabyte file would be read whole into memory
	// before any other check could run. The flow-nesting cap moved to
	// internal/yamlcheck together with the alias-bomb guard.
	maxFileBytes = 4 << 20 // 4 MiB

	// maxSequences caps the loaded set: Observe walks EVERY sequence on
	// each rule hit, so the per-hit cost is bounded by construction at
	// maxSequences × maxStepsPerSequence comparisons.
	maxSequences = 512

	// maxStepsPerSequence caps one chain's step list (same per-hit cost
	// as maxSequences).
	maxStepsPerSequence = 64

	// maxWindow caps the completion window. A chain whose window never
	// expires pins one tracked state per host until the window passes:
	// enough hosts and maxTrackedStates is exhausted, silently stopping
	// correlation for new hosts. Seven days is far beyond any campaign
	// the v0.1 sequences are designed for and still small enough that
	// stuck states recover on their own.
	maxWindow = 7 * 24 * time.Hour

	// maxIDRunes is the identity cap for sequence id/name and for step
	// rule names — the same standard the ingest applies to feed
	// identities (host 255, user 256, id 128 runes). These strings
	// reach logs, the console and webhook consumers through every
	// emitted alert.
	maxIDRunes = 128

	// maxDescriptionRunes keeps one description from pinning kilobytes
	// per sequence for the life of the process. Descriptions never
	// leave the process (alerts do not carry them), so only length is
	// bounded here — control runes are allowed.
	maxDescriptionRunes = 512

	// maxTags / maxTagRunes bound the tag list copied into every
	// emitted alert (tags DO leave the process, so each one is also
	// control-rune checked in compile).
	maxTags     = 16
	maxTagRunes = 64
)

// Exported mirrors of the load-time caps (precedent: MaxTrackedStates).
const (
	MaxSequences        = maxSequences
	MaxStepsPerSequence = maxStepsPerSequence
	MaxWindow           = maxWindow
	MaxFileBytes        = maxFileBytes
)

// references reports whether any step of the sequence names rule.
func (c *compiled) references(rule string) bool {
	for _, names := range c.steps {
		if contains(names, rule) {
			return true
		}
	}
	return false
}

func contains(list []string, v string) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

// stepLabel is the display form of a step: its rule, or its alternatives.
func stepLabel(names []string) string {
	return strings.Join(names, " | ")
}

// load parses every .yaml/.yml file under dir into compiled sequences.
func (m *Manager) load(dir string) error {
	seqs := []*compiled{}
	seen := map[string]string{} // sequence id -> origin file
	err := filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			return nil
		}
		ext := strings.ToLower(filepath.Ext(path))
		if ext != ".yaml" && ext != ".yml" {
			return nil
		}
		// Bound the file BEFORE reading it: os.ReadFile has no limit of
		// its own, so an oversized sequence file would be read whole
		// into memory before any other check could run.
		if info.Size() > maxFileBytes {
			return fmt.Errorf("%s: file is %d bytes, over the %d byte cap", path, info.Size(), maxFileBytes)
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		// resource-bomb guard (alias expansion + flow nesting), shared
		// with every other YAML loader through internal/yamlcheck.
		if err := yamlcheck.Guard(path, data); err != nil {
			return err
		}
		var list []Sequence
		if err := yaml.Unmarshal(data, &list); err != nil {
			return fmt.Errorf("%s: %w", path, err)
		}
		for _, s := range list {
			c, err := compile(s)
			if err != nil {
				return fmt.Errorf("%s: sequence %q: %w", path, s.Name, err)
			}
			// Duplicate ids are always a config bug: both sequences
			// would silently share one progress entry (steps of one
			// advance the other) and every completion would fire twice.
			if prev, dup := seen[s.ID]; dup {
				return fmt.Errorf("%s: sequence %q: duplicate id %q (already loaded from %s)", path, s.Name, s.ID, prev)
			}
			seen[s.ID] = path
			if len(seqs) >= maxSequences {
				return fmt.Errorf("%s: sequence %q: %d sequences is over the load cap (%d)", path, s.Name, len(seqs)+1, maxSequences)
			}
			seqs = append(seqs, c)
		}
		return nil
	})
	if err != nil {
		return err
	}
	m.seqs = seqs
	return nil
}

func compile(s Sequence) (*compiled, error) {
	if s.Name == "" || s.ID == "" {
		return nil, fmt.Errorf("name and id are required")
	}
	// Identity sanity: id, name, tags and step rules reach logs, the
	// console and webhook consumers on every alert, so they get the
	// same treatment the ingest applies to feed identities — a bounded
	// length and zero control runes. A \x1b in an id would be terminal
	// injection into the engine's own log output; a \n would forge log
	// lines. Descriptions never leave the process (the alert does not
	// carry them), so only their length is bounded.
	for _, f := range []struct{ label, val string }{{"id", s.ID}, {"name", s.Name}} {
		if n := len([]rune(f.val)); n > maxIDRunes {
			return nil, fmt.Errorf("%s is %d runes, over the %d rune cap", f.label, n, maxIDRunes)
		}
		if r, ok := firstControlRune(f.val); ok {
			return nil, fmt.Errorf("%s contains control rune %q (U+%04X)", f.label, r, r)
		}
	}
	if n := len([]rune(s.Description)); n > maxDescriptionRunes {
		return nil, fmt.Errorf("description is %d runes, over the %d rune cap", n, maxDescriptionRunes)
	}
	if len(s.Tags) > maxTags {
		return nil, fmt.Errorf("%d tags is over the %d tag cap", len(s.Tags), maxTags)
	}
	for _, tg := range s.Tags {
		if n := len([]rune(tg)); n > maxTagRunes {
			return nil, fmt.Errorf("tag %q is %d runes, over the %d rune cap", tg, n, maxTagRunes)
		}
		if r, ok := firstControlRune(tg); ok {
			return nil, fmt.Errorf("tag contains control rune %q (U+%04X)", r, r)
		}
	}
	switch s.Severity {
	case rules.SevLow, rules.SevMedium, rules.SevHigh, rules.SevCritical:
	default:
		return nil, fmt.Errorf("invalid severity %q", s.Severity)
	}
	scope := s.Scope
	if scope == "" {
		scope = ScopeHost
	}
	if scope != ScopeHost && scope != ScopeUser {
		return nil, fmt.Errorf("invalid scope %q (host or user)", s.Scope)
	}
	minHosts := s.MinHosts
	if minHosts == 0 {
		minHosts = 1
	}
	if minHosts < 1 || minHosts > maxMinHosts {
		return nil, fmt.Errorf("min_hosts %d out of range 1..%d", s.MinHosts, maxMinHosts)
	}
	if minHosts > 1 && scope != ScopeUser {
		return nil, fmt.Errorf("min_hosts > 1 needs scope: user (a host-scoped chain spans one host)")
	}
	// one step is a chain only when it must repeat across hosts
	if len(s.Steps) < 2 && !(len(s.Steps) == 1 && minHosts > 1) {
		return nil, fmt.Errorf("at least 2 steps are required, got %d", len(s.Steps))
	}
	if len(s.Steps) > maxStepsPerSequence {
		return nil, fmt.Errorf("%d steps is over the %d step cap", len(s.Steps), maxStepsPerSequence)
	}
	steps := make([][]string, 0, len(s.Steps))
	for i, st := range s.Steps {
		names := st.names()
		if len(names) == 0 {
			return nil, fmt.Errorf("step %d: rule name is required", i)
		}
		if len(names) > maxStepRules {
			return nil, fmt.Errorf("step %d: %d alternative rules is over the %d cap", i, len(names), maxStepRules)
		}
		for _, name := range names {
			if n := len([]rune(name)); n > maxIDRunes {
				return nil, fmt.Errorf("step %d: rule name is %d runes, over the %d rune cap", i, n, maxIDRunes)
			}
			if r, ok := firstControlRune(name); ok {
				return nil, fmt.Errorf("step %d: rule name contains control rune %q (U+%04X)", i, r, r)
			}
		}
		steps = append(steps, names)
	}
	w := 5 * time.Minute
	if s.Window != "" {
		d, err := time.ParseDuration(s.Window)
		if err != nil || d <= 0 {
			return nil, fmt.Errorf("invalid window %q", s.Window)
		}
		// A chain whose window never expires pins one tracked state per
		// host until the window passes: enough hosts and the
		// maxTrackedStates cap is exhausted, silently stopping
		// correlation for new hosts. Window abuse is config-side, so the
		// load names it instead of absorbing it.
		if d > maxWindow {
			return nil, fmt.Errorf("window %q is over the %s cap (chains that never expire pin tracked states until maxTrackedStates is exhausted)", s.Window, maxWindow)
		}
		w = d
	}
	return &compiled{seq: s, window: w, scope: scope, minHosts: minHosts, steps: steps, fp: stepsFingerprint(steps)}, nil
}

// stepsFingerprint hashes the step layout (rule names, order kept —
// progress is stored per step INDEX). A reordering or recomposition of
// the steps of a live sequence would otherwise reinterpret old
// progress against the new layout and complete a chain where a step
// never fired (reproduced: pasos [A,B] → hit A → reload [B,A] → hit A
// ⇒ cadena completa con 0 pasos esperados).
func stepsFingerprint(steps [][]string) uint64 {
	h := fnv.New64a()
	for _, names := range steps {
		s := append([]string(nil), names...)
		sort.Strings(s)
		h.Write([]byte(strings.Join(s, "\x00")))
		h.Write([]byte{0xff})
	}
	return h.Sum64()
}

// firstControlRune returns the first Unicode control rune (Cc: NUL,
// newlines, TAB, ESC/ANSI, DEL...) found in s, if any. Config strings
// that leave the process must not be able to forge log lines or
// inject terminal escapes.
func firstControlRune(s string) (rune, bool) {
	for _, r := range s {
		if unicode.IsControl(r) {
			return r, true
		}
	}
	return 0, false
}

// The YAML resource-bomb pre-scan (nesting depth + alias expansion)
// lives in internal/yamlcheck: one guard for every loader instead of
// the inline copies this package and the rules loader used to carry.
