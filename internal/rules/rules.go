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
        rule  *Rule
        regex map[int]*regexp.Regexp // precompiled regex per condition index
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
                matched := make([]string, 0, len(cr.rule.Conditions))
                ok := true
                for i, cond := range cr.rule.Conditions {
                        val := lookup(fields, cond.Field)
                        if !evalCondition(cr, i, cond, val) {
                                ok = false
                                break
                        }
                        matched = append(matched, cond.Field)
                }
                if ok {
                        hits = append(hits, Hit{Rule: cr.rule, MatchedOn: matched})
                }
        }
        return hits
}

func evalCondition(cr compiledRule, idx int, c Condition, val any) bool {
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
                if re := cr.regex[idx]; re != nil {
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

func compile(r *Rule) (compiledRule, error) {
        cr := compiledRule{rule: r, regex: map[int]*regexp.Regexp{}}
        if r.EventType == "" {
                return cr, fmt.Errorf("missing event_type")
        }
        switch r.Severity {
        case SevInfo, SevLow, SevMedium, SevHigh, SevCritical:
        default:
                return cr, fmt.Errorf("invalid severity %q", r.Severity)
        }
        for i, c := range r.Conditions {
                if c.Field == "" || c.Operator == "" {
                        return cr, fmt.Errorf("condition %d: field and operator are required", i)
                }
                if c.Operator == "regex" {
                        re, err := regexp.Compile(asString(c.Value))
                        if err != nil {
                                return cr, fmt.Errorf("condition %d: bad regex: %w", i, err)
                        }
                        cr.regex[i] = re
                }
        }
        return cr, nil
}
