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
		return strings.Contains(strings.ToLower(asString(val)), strings.ToLower(asString(c.Value)))
	case "icontains_any":
		needle := strings.ToLower(asString(val))
		for _, v := range toList(c.Value) {
			if strings.Contains(needle, strings.ToLower(asString(v))) {
				return true
			}
		}
		return false
	case "istartswith":
		return strings.HasPrefix(strings.ToLower(asString(val)), strings.ToLower(asString(c.Value)))
	case "iendswith":
		return strings.HasSuffix(strings.ToLower(asString(val)), strings.ToLower(asString(c.Value)))
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
		data, err := os.ReadFile(path)
		if err != nil {
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
