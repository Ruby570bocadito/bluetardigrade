// Package rules implements the YAML rule format and the evaluation
// engine. Rules are indexed by event type so each incoming event only
// evaluates candidate rules. The operator set is deliberately minimal;
// every operator here is covered by unit tests.
package rules

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"unicode/utf8"

	"github.com/Ruby570bocadito/security-framework/pkg/model"

	"gopkg.in/yaml.v3"
)

// Severities supported in rule definitions.
const (
	SevInfo     = "info"
	SevLow      = "low"
	SevMedium   = "medium"
	SevHigh     = "high"
	SevCritical = "critical"
)

// Condition is a single field/operator/value predicate.
type Condition struct {
	Field    string `yaml:"field"`
	Operator string `yaml:"operator"`
	Value    any    `yaml:"value"`
}

// Action declares what happens when the rule matches.
type Action struct {
	Type   string            `yaml:"type"`
	Config map[string]string `yaml:"config"`
}

// Rule is the YAML rule definition (see rules/ for examples).
type Rule struct {
	Name        string      `yaml:"name"`
	ID          string      `yaml:"id"`
	Description string      `yaml:"description"`
	Severity    string      `yaml:"severity"`
	EventType   string      `yaml:"event_type"`
	Conditions  []Condition `yaml:"conditions"`
	Actions     []Action    `yaml:"actions"`
	Tags        []string    `yaml:"tags"`
	Enabled     *bool       `yaml:"enabled"`
}

// IsEnabled returns true unless the rule is explicitly disabled.
func (r *Rule) IsEnabled() bool { return r.Enabled == nil || *r.Enabled }

// Load caps (F2, round 12h40): the rule directory is operator
// config, but every other loader in the house bounds its input
// (correlator since 21h29, threshold, beacon, sigma converter) —
// this was the last config surface read without a cap, and load
// runs at startup AND at every hot-reload tick.
const (
	// maxFileBytes caps one rule file. os.ReadFile has no bound of
	// its own: a multi-GB YAML would be read whole into memory
	// before any other check could run (OOM).
	maxFileBytes = 4 << 20 // 4 MiB

	// maxNestingDepth caps flow-style ('[' / '{') nesting, same
	// rationale as the correlator loader: yaml.v3 recurses per
	// nesting level, so a crafted deep list value can exhaust the
	// stack before Unmarshal ever returns.
	maxNestingDepth = 512

	// maxRules caps the loaded ENABLED set: Evaluate walks every
	// rule of the event's type on every event, so an unbounded
	// directory silently degrades the 10 ms p99 contract. 4x the
	// Sigma converter output cap leaves ample room for hand rules.
	maxRules = 2048
)

// Hit records which conditions fired for an event.
type Hit struct {
	Rule      *Rule
	MatchedOn []string
}

// Engine holds the compiled rule index.
type Engine struct {
	mu     sync.RWMutex
	byType map[string][]compiledRule
	count  int
}

type compiledRule struct {
	rule    *Rule
	matcher *Matcher // owns ALL condition evaluation (F2: single path)
}

// LoadDir walks dir and loads every .yaml/.yml rule file.
func LoadDir(dir string) (*Engine, error) {
	e := &Engine{byType: map[string][]compiledRule{}}
	if err := e.load(dir); err != nil {
		return nil, err
	}
	return e, nil
}

// Reload atomically replaces the rule set from dir.
func (e *Engine) Reload(dir string) error {
	fresh := &Engine{byType: map[string][]compiledRule{}}
	if err := fresh.load(dir); err != nil {
		return err
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	e.byType = fresh.byType
	e.count = fresh.count
	return nil
}

// Count returns the number of enabled rules currently loaded.
func (e *Engine) Count() int {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.count
}

// Types returns the sorted list of event types with rules attached.
func (e *Engine) Types() []string {
	e.mu.RLock()
	defer e.mu.RUnlock()
	out := make([]string, 0, e.count)
	for t := range e.byType {
		out = append(out, t)
	}
	sort.Strings(out)
	return out
}

// Snapshot returns copies of all enabled rules (read-only use, e.g. the
// local API), sorted by ID for stable output.
func (e *Engine) Snapshot() []Rule {
	e.mu.RLock()
	defer e.mu.RUnlock()
	out := make([]Rule, 0, e.count)
	for _, crs := range e.byType {
		for _, cr := range crs {
			out = append(out, *cr.rule)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

// Evaluate returns the hits for a single event. Rules are evaluated
// AND-wise: every condition must match.
func (e *Engine) Evaluate(ev *model.Event) []Hit {
	if ev == nil {
		return nil
	}
	fields := ev.FieldMap()
	e.mu.RLock()
	defer e.mu.RUnlock()

	var hits []Hit
	for _, cr := range e.byType[ev.Type] {
		if !cr.rule.IsEnabled() {
			continue
		}
		// F2 (adenda 11h02): ONE evaluation path — the compiled
		// Matcher. A Hit only exists on full match, so MatchedOn is
		// every condition field by construction.
		if cr.matcher.MatchFields(fields) {
			matched := make([]string, 0, len(cr.rule.Conditions))
			for _, cond := range cr.rule.Conditions {
				matched = append(matched, cond.Field)
			}
			hits = append(hits, Hit{Rule: cr.rule, MatchedOn: matched})
		}
	}
	return hits
}

// matchCondition evaluates one condition against a field value. The
// precompiled regex (nil when the operator is not "regex") is passed
// in so rules and the exported Matcher share the exact same operator
// semantics — single source of truth for what an operator means.
func matchCondition(c Condition, val any, re *regexp.Regexp) bool {
	switch c.Operator {
	case "eq":
		return compareEqual(val, c.Value)
	case "neq":
		return !compareEqual(val, c.Value)
	case "contains":
		return strings.Contains(asString(val), asString(c.Value))
	case "contains_any":
		needle := asString(val)
		for _, v := range toList(c.Value) {
			if strings.Contains(needle, asString(v)) {
				return true
			}
		}
		return false
	case "startswith":
		return strings.HasPrefix(asString(val), asString(c.Value))
	case "endswith":
		return strings.HasSuffix(asString(val), asString(c.Value))
	case "regex":
		if re != nil {
			return re.MatchString(asString(val))
		}
		return false
	case "in":
		list := toList(c.Value)
		for _, v := range list {
			if compareEqual(val, v) {
				return true
			}
		}
		return false
	case "not_in":
		list := toList(c.Value)
		for _, v := range list {
			if compareEqual(val, v) {
				return false
			}
		}
		return true
	case "gt":
		return compareNumeric(val, c.Value) > 0
	case "lt":
		return compareNumeric(val, c.Value) < 0
	case "ieq":
		return strings.EqualFold(asString(val), asString(c.Value))
	case "icontains":
		return foldContains(asString(val), asString(c.Value))
	case "icontains_any":
		needle := asString(val)
		for _, v := range toList(c.Value) {
			if foldContains(needle, asString(v)) {
				return true
			}
		}
		return false
	case "istartswith":
		return foldPrefix(asString(val), asString(c.Value))
	case "iendswith":
		return foldSuffix(asString(val), asString(c.Value))
	case "iin":
		for _, v := range toList(c.Value) {
			if strings.EqualFold(asString(val), asString(v)) {
				return true
			}
		}
		return false
	default:
		return false
	}
}

// --- simple case folding: one semantics for the whole i* family ---
//
// strings.EqualFold and RE2's (?i) both apply simple Unicode case
// folding, while a plain strings.ToLower comparison does not (U+017F
// LONG S folds to "s" but lowercases to itself; house finding F1,
// round 12h40 over the A4 i* family). A matcher where ieq accepted
// "ſervice" == "SERVICE" while icontains rejected the same pair was a
// homoglyph bypass waiting for a payload, so every i* operator now
// folds. The ASCII fast path keeps the hot path byte-for-byte as
// cheap as the previous ToLower implementation.

// isASCII reports whether s is pure ASCII (where ToLower is exact
// simple folding).
func isASCII(s string) bool {
	for i := 0; i < len(s); i++ {
		if s[i] >= utf8.RuneSelf {
			return false
		}
	}
	return true
}

// runeOffset returns the byte offset of the n-th rune of s.
func runeOffset(s string, n int) int {
	i := 0
	for j := range s {
		if i == n {
			return j
		}
		i++
	}
	return len(s)
}

// runeWindow returns the substring of s starting at byte offset start
// (a rune boundary) spanning at most max runes.
func runeWindow(s string, start, max int) string {
	end := runeOffset(s[start:], max)
	return s[start : start+end]
}

// foldContains reports whether needle occurs in haystack under simple
// case folding — the exact semantics of strings.EqualFold and RE2 (?i).
func foldContains(haystack, needle string) bool {
	if needle == "" {
		return true
	}
	if isASCII(haystack) && isASCII(needle) {
		return strings.Contains(strings.ToLower(haystack), strings.ToLower(needle))
	}
	return foldSearch(haystack, needle)
}

// foldPrefix reports whether haystack starts with needle under simple
// case folding (strings.HasPrefix semantics, folded).
func foldPrefix(haystack, needle string) bool {
	m := utf8.RuneCountInString(needle)
	if m == 0 {
		return true
	}
	if utf8.RuneCountInString(haystack) < m {
		return false
	}
	return strings.EqualFold(haystack[:runeOffset(haystack, m)], needle)
}

// foldSuffix reports whether haystack ends with needle under simple
// case folding (strings.HasSuffix semantics, folded).
func foldSuffix(haystack, needle string) bool {
	m := utf8.RuneCountInString(needle)
	if m == 0 {
		return true
	}
	n := utf8.RuneCountInString(haystack)
	if n < m {
		return false
	}
	return strings.EqualFold(haystack[runeOffset(haystack, n-m):], needle)
}

// foldSearch scans every rune-aligned window of haystack holding the
// same number of runes as needle and reports whether any folds equal
// to it. O(len(haystack)*len(needle)) worst case — event field values
// are short and the ASCII fast path keeps this off the common path.
func foldSearch(haystack, needle string) bool {
	m := utf8.RuneCountInString(needle)
	if m == 0 {
		return true
	}
	if utf8.RuneCountInString(haystack) < m {
		return false
	}
	for start := range haystack {
		win := runeWindow(haystack, start, m)
		if utf8.RuneCountInString(win) < m {
			return false
		}
		if strings.EqualFold(win, needle) {
			return true
		}
	}
	return false
}

// lookup resolves a dotted path over the flattened event map.
func lookup(m map[string]any, path string) any {
	if m == nil {
		return nil
	}
	parts := strings.Split(path, ".")
	var cur any = m
	for _, p := range parts {
		mp, ok := cur.(map[string]any)
		if !ok {
			return nil
		}
		cur, ok = mp[p]
		if !ok {
			return nil
		}
	}
	return cur
}

func compareEqual(a, b any) bool {
	return asString(a) == asString(b)
}

func compareNumeric(a, b any) int {
	af, aok := toFloat(a)
	bf, bok := toFloat(b)
	if !aok || !bok {
		return strings.Compare(asString(a), asString(b))
	}
	switch {
	case af > bf:
		return 1
	case af < bf:
		return -1
	default:
		return 0
	}
}

func toFloat(v any) (float64, bool) {
	switch n := v.(type) {
	case float64:
		return n, true
	case int:
		return float64(n), true
	case string:
		f, err := strconv.ParseFloat(strings.TrimSpace(n), 64)
		return f, err == nil
	default:
		return 0, false
	}
}

// AsString normalizes any scalar event field value to the string form
// used in keys and comparisons across the framework. It is THE
// canonical normalization — the same one every operator applies when
// matching field values — so consumers that key or compare event
// values (the threshold detector's group_by keys, future detectors)
// must call this instead of keeping their own copy: a value folded by
// an operator and a value keyed by a detector can then never
// disagree. Exported alongside Lookup for exactly the same reason.
func AsString(v any) string { return asString(v) }

// asString normalizes a scalar value for comparison: strings pass
// through, numbers use the shortest round-trip form and bools their
// literal form; composite values fall back to fmt.Sprint.
func asString(v any) string {
	switch s := v.(type) {
	case nil:
		return ""
	case string:
		return s
	case float64:
		return strconv.FormatFloat(s, 'f', -1, 64)
	case bool:
		return strconv.FormatBool(s)
	default:
		return fmt.Sprint(s)
	}
}

func toList(v any) []any {
	switch l := v.(type) {
	case []any:
		return l
	case []string:
		out := make([]any, len(l))
		for i, s := range l {
			out[i] = s
		}
		return out
	case nil:
		return nil
	default:
		return []any{v}
	}
}

// load parses every rule file under dir and indexes enabled rules.
func (e *Engine) load(dir string) error {
	count := 0
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
		// Bound the file BEFORE reading it: os.ReadFile has no limit
		// of its own, so an oversized rule file would be read whole
		// into memory — at startup AND at every hot-reload tick.
		if info.Size() > maxFileBytes {
			return fmt.Errorf("%s: file is %d bytes, over the %d byte cap", path, info.Size(), maxFileBytes)
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		if err := checkNestingDepth(path, data); err != nil {
			return err
		}
		var rules []Rule
		if err := yaml.Unmarshal(data, &rules); err != nil {
			return fmt.Errorf("%s: %w", path, err)
		}
		for i := range rules {
			cr, err := compile(&rules[i])
			if err != nil {
				return fmt.Errorf("%s: rule %q: %w", path, rules[i].Name, err)
			}
			if !cr.rule.IsEnabled() {
				continue
			}
			if count >= maxRules {
				return fmt.Errorf("%s: rule %q: %d enabled rules, over the %d rule cap", path, rules[i].Name, count+1, maxRules)
			}
			e.byType[cr.rule.EventType] = append(e.byType[cr.rule.EventType], cr)
			count++
		}
		return nil
	})
	if err != nil {
		return err
	}
	e.count = count
	return nil
}

// checkNestingDepth scans the raw bytes for flow-style ('[' / '{')
// nesting deeper than maxNestingDepth, the same cheap pre-scan the
// correlator loader runs: yaml.v3 recurses per nesting level, so a
// crafted deep list value could exhaust the stack inside Unmarshal.
// Deliberately naive: it counts structural brackets everywhere —
// quoted strings included — and clamps at zero on unmatched closers.
// Neither shortcut can hide real depth: true nesting needs at least
// as many consecutive opens as its own level count, and the scan
// counts exactly that.
func checkNestingDepth(path string, data []byte) error {
	depth := 0
	for _, b := range data {
		switch b {
		case '[', '{':
			depth++
			if depth > maxNestingDepth {
				return fmt.Errorf("%s: YAML nesting deeper than %d levels (possible resource bomb)", path, maxNestingDepth)
			}
		case ']', '}':
			if depth > 0 {
				depth--
			}
		}
	}
	return nil
}

// validOperators is the closed set of condition operators the engine
// evaluates. Loading a rule with an unknown operator fails LOUD here:
// evalCondition's default branch answers false, so an unvalidated
// operator would load a rule that silently never fires — a mute
// detection is worse than a load error.
var validOperators = map[string]bool{
	"eq": true, "neq": true, "contains": true, "contains_any": true,
	"startswith": true, "endswith": true, "regex": true,
	"in": true, "not_in": true, "gt": true, "lt": true,
	"ieq": true, "icontains": true, "icontains_any": true,
	"istartswith": true, "iendswith": true, "iin": true,
}

func compile(r *Rule) (compiledRule, error) {
	cr := compiledRule{rule: r}
	if r.EventType == "" {
		return cr, fmt.Errorf("missing event_type")
	}
	switch r.Severity {
	case SevInfo, SevLow, SevMedium, SevHigh, SevCritical:
	default:
		return cr, fmt.Errorf("invalid severity %q", r.Severity)
	}
	// F2 (adenda 11h02): the Matcher is built HERE and owns every
	// condition evaluation — the engine and external callers share
	// exactly one evaluation path.
	m, err := NewMatcher(r.Conditions)
	if err != nil {
		return cr, err
	}
	cr.matcher = m
	return cr, nil
}

// Matcher is a precompiled, immutable set of conditions evaluated
// AND-wise against an event — the same operators, regex compilation
// and dotted-path lookup the rule engine uses, exported for callers
// that need per-event predicates with their own state (threshold
// aggregation). Safe for concurrent use: every field is fixed at
// construction and Match only reads.
type Matcher struct {
	conds   []Condition
	regexes []*regexp.Regexp // per condition index (nil when not "regex")
}

// NewMatcher compiles conditions into a Matcher. The same validation
// rules as rule compilation apply: field and operator are required,
// "regex" values must compile with Go's regexp. An empty condition
// list is valid and matches every event (a pure counter).
//
// Inmutabilidad real (F2, adenda 11h02): los values de tipo slice se
// COPIAN defensivamente en la construcción — un caller que mute su
// slice después de construir el Matcher no puede cambiar lo que el
// matcher evalúa (el coste es una copia por carga/hot-reload).
func NewMatcher(conds []Condition) (*Matcher, error) {
	m := &Matcher{
		conds:   make([]Condition, len(conds)),
		regexes: make([]*regexp.Regexp, len(conds)),
	}
	for i, c := range conds {
		m.conds[i] = Condition{Field: c.Field, Operator: c.Operator, Value: copyValue(c.Value)}
		if c.Field == "" || c.Operator == "" {
			return nil, fmt.Errorf("condition %d: field and operator are required", i)
		}
		if !validOperators[c.Operator] {
			return nil, fmt.Errorf("condition %d: operator %q no soportado", i, c.Operator)
		}
		if c.Operator == "regex" {
			re, err := regexp.Compile(asString(c.Value))
			if err != nil {
				return nil, fmt.Errorf("condition %d: bad regex: %w", i, err)
			}
			m.regexes[i] = re
		}
	}
	return m, nil
}

// copyValue clones the slice-shaped condition values so a Matcher
// never shares mutable state with its caller. Scalars are immutable
// values and pass through.
func copyValue(v any) any {
	switch t := v.(type) {
	case []any:
		out := make([]any, len(t))
		copy(out, t)
		return out
	case []string:
		out := make([]string, len(t))
		copy(out, t)
		return out
	default:
		return v
	}
}

// Match reports whether every condition holds for the event. Events
// with missing fields never match a condition on that field (the
// empty Matcher matches everything).
func (m *Matcher) Match(ev *model.Event) bool {
	if m == nil || ev == nil {
		return false
	}
	return m.MatchFields(ev.FieldMap())
}

// MatchFields is Match over a pre-flattened field map (avoids the
// marshal round-trip when the caller already has one).
func (m *Matcher) MatchFields(fields map[string]any) bool {
	for i, c := range m.conds {
		if !matchCondition(c, lookup(fields, c.Field), m.regexes[i]) {
			return false
		}
	}
	return true
}

// Lookup resolves a dotted path (e.g. "process.command_line") over a
// flattened event field map — the same resolution rule conditions use,
// exported for callers that need to read aggregation keys
// (threshold group_by) with identical semantics.
func Lookup(fields map[string]any, path string) any {
	return lookup(fields, path)
}
