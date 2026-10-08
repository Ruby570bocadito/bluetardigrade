package sigma

import (
	"fmt"
	"regexp"
	"strings"
)

// fieldValue is one Sigma selection entry after splitting the optional
// modifier chain: "CommandLine|contains" -> field "CommandLine",
// modifiers ["contains"], raw value.
type fieldValue struct {
	field     string
	modifiers []string
	value     any
}

// splitModifier splits "Field|mod1|mod2" off a raw selection entry.
func splitModifier(key string, value any) fieldValue {
	parts := strings.Split(key, "|")
	return fieldValue{field: parts[0], modifiers: parts[1:], value: value}
}

// severityOf maps Sigma level -> engine severity. informational folds
// to info; anything else is a skip (no silent defaults).
func severityOf(level string) (string, bool) {
	switch strings.ToLower(strings.TrimSpace(level)) {
	case "informational":
		return "info", true
	case "low":
		return "low", true
	case "medium":
		return "medium", true
	case "high":
		return "high", true
	case "critical":
		return "critical", true
	}
	return "", false
}

// eventTypeOf maps Sigma logsource categories to the v0.1 event
// schema. Categories without a real telemetry equivalent in the
// engine are skipped upstream; services (sysmon, security, ...) are
// deliberately NOT mapped: their selections key on EventID, which the
// normalized schema does not carry.
func eventTypeOf(category string) (string, bool) {
	switch strings.ToLower(strings.TrimSpace(category)) {
	case "process_creation":
		return "process.create", true
	case "file_event":
		return "file.write", true
	case "network_connection":
		return "network.connect", true
	case "image_loaded", "driver_load":
		return "image.load", true
	case "registry_set", "registry_add", "registry_rename", "registry_delete", "registry_event":
		return "registry.set", true
	case "process_access":
		return "process.access", true
	}
	return "", false
}

// fieldMap translates Sigma field names to the engine's dotted paths.
// Only names with a REAL equivalent in the normalized schema are
// mapped; everything else falls through (the rule is skipped naming
// the field) — a wrong mapping would create silent blind spots.
var fieldMap = map[string]string{
	// process creation (Sysmon 1 / Security 4688)
	"Image":              "process.image",
	"NewProcessName":     "process.image",
	"ProcessName":        "process.image",
	"CommandLine":        "process.command_line",
	"ProcessCommandLine": "process.command_line",
	"User":               "user",
	// process access (Sysmon 10)
	"TargetImage":   "target.image",
	"GrantedAccess": "access.granted_access",
	"CallTrace":     "access.call_trace",
	// file events (Sysmon 11/15)
	"TargetFilename": "file.path",
	// image load (Sysmon 7)
	"ImageLoaded": "file.path",
	// network (Sysmon 3 / firewall)
	"SourceIp":            "network.source_ip",
	"DestinationIp":       "network.destination_ip",
	"SourcePort":          "network.source_port",
	"DestinationPort":     "network.destination_port",
	"DestinationHostname": "network.domain",
	"Protocol":            "network.protocol",
	// registry (Sysmon 12/13/14)
	"TargetObject": "registry.key",
	"Details":      "registry.value",
}

// supportedModifiers are the value modifiers the translator understands
// exactly. Anything else (base64*, utf16*, wide, all, exists, ...)
// causes a skip: an approximate translation of an encoding modifier
// would silently change what the rule detects.
var supportedModifiers = map[string]bool{
	"contains":   true,
	"startswith": true,
	"endswith":   true,
	"re":         true,
	"gt":         true,
	"lt":         true,
}

// hasLetters reports whether s contains any letter (ASCII or
// Unicode): letters are exactly the characters whose case can vary
// between the Sigma corpus (conventionally lowercase) and the real
// telemetry, so string comparisons over them must be case-insensitive
// (house finding F1, over da6382c).
func hasLetters(s string) bool {
	return strings.ToLower(s) != strings.ToUpper(s)
}

// translateSelection converts one selection (list of field values) into
// engine conditions. Every field must map, every modifier must be
// supported and every value must translate; otherwise the reason
// string explains exactly what and why.
func translateSelection(fvs []fieldValue) ([]Condition, string) {
	conds := make([]Condition, 0, len(fvs))
	for _, fv := range fvs {
		// A modifier chain applies ONE meaning; "contains|re"
		// used to pass the supported-check and then only apply
		// modifiers[0], silently matching the regex as a literal
		// substring (sesión 100agentes-2, agente 18).
		// Sigma "field|contains|all: [a, b]" requires EVERY listed
		// value to appear; the engine ANDs a rule's conditions, so the
		// exact translation is one contains/icontains condition per
		// element on the SAME field (sesión 100agentes-3, agente 36
		// H5). The multi-modifier rejection below stays for everything
		// else (base64offset|contains, all|contains...).
		if len(fv.modifiers) == 2 && fv.modifiers[0] == "contains" && fv.modifiers[1] == "all" {
			dst, ok := fieldMap[fv.field]
			if !ok {
				return nil, fmt.Sprintf("field %q sin equivalente en el esquema del motor", fv.field)
			}
			acs, err := translateContainsAll(dst, fv.value)
			if err != nil {
				return nil, fmt.Sprintf("field %q: %v", fv.field, err)
			}
			conds = append(conds, acs...)
			continue
		}
		if len(fv.modifiers) > 1 {
			return nil, fmt.Sprintf("field %q: cadenas de modificador multiple no soportadas (%v)", fv.field, fv.modifiers)
		}
		for _, m := range fv.modifiers {
			if !supportedModifiers[m] {
				return nil, fmt.Sprintf("field %q: modificador %q no soportado (soportados: contains, startswith, endswith, re, gt, lt)", fv.field, m)
			}
		}
		dst, ok := fieldMap[fv.field]
		if !ok {
			return nil, fmt.Sprintf("field %q sin equivalente en el esquema del motor", fv.field)
		}
		op, val, err := translateValue(fv)
		if err != nil {
			return nil, fmt.Sprintf("field %q: %v", fv.field, err)
		}
		conds = append(conds, Condition{Field: dst, Operator: op, Value: val})
	}
	return conds, ""
}

// translateValue maps one raw value (+modifiers) to an engine
// operator/value pair:
//
//	no wildcards            -> eq / contains / startswith / endswith / re / gt / lt
//	'*x'                    -> endswith x
//	'x*'                    -> startswith x
//	'*x*'                   -> contains x
//	any other wildcard mix  -> anchored regex (literals escaped, * -> .*, ? -> .)
//	lists                   -> in / contains_any / regex alternation
//
// structured reports whether v is a structured (non-scalar) Sigma
// value: a nested map or a list carrying maps/nested lists. Structured
// values used to reach fmt.Sprint and render as "map[...]" — a
// condition that can never fire while LOOKING armed (sesión
// 100agentes-3, agente 36 H1). Reject loudly instead.
func structured(v any) bool {
	switch t := v.(type) {
	case map[string]any:
		return true
	case []any:
		for _, el := range t {
			switch el.(type) {
			case map[string]any, []any:
				return true
			}
		}
	}
	return false
}

func translateValue(fv fieldValue) (string, any, error) {
	if structured(fv.value) {
		return "", nil, fmt.Errorf("selection anidada (mapa) no traducible a escalar")
	}
	if len(fv.modifiers) > 0 {
		switch fv.modifiers[0] {
		case "re":
			return translateRegex(fv.value)
		case "gt", "lt":
			return fv.modifiers[0], fmt.Sprint(fv.value), nil
		case "contains", "startswith", "endswith":
			return translateString(fv.value, fv.modifiers[0])
		}
	}
	return translateString(fv.value, "")
}

func translateRegex(v any) (string, any, error) {
	s, ok := v.(string)
	if !ok {
		return "", nil, fmt.Errorf("modificador re: el valor debe ser texto")
	}
	if _, err := regexp.Compile(s); err != nil {
		return "", nil, fmt.Errorf("regex invalida para el motor de Go: %w", err)
	}
	return "regex", s, nil
}

// translateString handles scalar and list values with the optional
// string modifier ("" = plain equality context).
func translateString(v any, modifier string) (string, any, error) {
	// A null value ("User: null") used to become ieq "<nil>" via
	// fmt.Sprint — a condition that can never fire while looking
	// armed (sesión 100agentes-2, agente 18). Skip loudly instead.
	if v == nil {
		return "", nil, fmt.Errorf("valor null no traducible (campo vacio en Sigma)")
	}
	if list, ok := v.([]any); ok {
		return translateList(list, modifier)
	}
	s := fmt.Sprint(v)
	// A pattern of ONLY wildcards ("*", "?", "**") carries zero
	// information: '*' used to fall into the startswith branch and
	// emit startswith "" — true for every event INCLUDING ones
	// without the field (sesión 100agentes-2, agente 18, P1).
	if strings.Trim(s, "*?") == "" {
		return "", nil, fmt.Errorf("patron solo-wildcard %q no traducible (matchearia todo)", s)
	}
	// A modified value keeps its literal meaning; if it carries
	// wildcards the semantics shift to regex so nothing changes
	// silently.
	if modifier != "" {
		if strings.ContainsAny(s, "*?") {
			return wildcardRegex(s, modifier)
		}
		if hasLetters(s) {
			// The Sigma corpus matches strings case-insensitively (it writes
			// 'mimikatz' and expects Invoke-Mimikatz to hit); the i* operators
			// keep that contract without regex overhead.
			return "i" + modifier, s, nil
		}
		return modifier, s, nil
	}
	// Plain value: wildcard -> operator translation.
	switch {
	case !strings.ContainsAny(s, "*?"):
		if hasLetters(s) {
			return "ieq", s, nil
		}
		return "eq", s, nil
	case strings.HasPrefix(s, "*") && strings.HasSuffix(s, "*") && len(s) >= 2 &&
		!strings.ContainsAny(s[1:len(s)-1], "*?"):
		if hasLetters(s[1 : len(s)-1]) {
			return "icontains", s[1 : len(s)-1], nil
		}
		return "contains", s[1 : len(s)-1], nil
	case strings.HasSuffix(s, "*") && !strings.ContainsAny(s[:len(s)-1], "*?"):
		if hasLetters(s[:len(s)-1]) {
			return "istartswith", s[:len(s)-1], nil
		}
		return "startswith", s[:len(s)-1], nil
	case strings.HasPrefix(s, "*") && !strings.ContainsAny(s[1:], "*?"):
		if hasLetters(s[1:]) {
			return "iendswith", s[1:], nil
		}
		return "endswith", s[1:], nil
	default:
		return wildcardRegex(s, "")
	}
}

// wildcardRegex builds an engine-compatible regex from a Sigma
// wildcard pattern. modifier narrows the anchoring (contains keeps it
// unanchored, startswith anchors the head, endswith the tail; plain
// values anchor both sides).
func wildcardRegex(pattern, modifier string) (string, any, error) {
	var b strings.Builder
	// Wildcard matching in Sigma is case-insensitive by corpus
	// convention (house finding F1, over da6382c).
	b.WriteString("(?i)")
	switch modifier {
	case "contains", "endswith":
		// unanchored head
	default:
		b.WriteString("^")
	}
	for _, c := range pattern {
		switch c {
		case '*':
			b.WriteString(".*")
		case '?':
			b.WriteString(".")
		default:
			b.WriteString(regexp.QuoteMeta(string(c)))
		}
	}
	switch modifier {
	case "contains", "startswith":
		// unanchored tail (a trailing $ on startswith would be redundant
		// but keeping it off makes the emitted patterns minimal)
	default:
		b.WriteString("$")
	}
	re := b.String()
	if _, err := regexp.Compile(re); err != nil {
		return "", nil, fmt.Errorf("patron %q no traducible a regex: %w", pattern, err)
	}
	return "regex", re, nil
}

// translateList converts a Sigma value list. Elements are translated
// individually and combined:
//
//	all plain, wildcard-free       -> in           (engine fast path)
//	all contains, wildcard-free    -> contains_any
//	anything else                  -> single regex alternation where
//	                                  every element keeps its own anchors
//
// Mixed semantic families (e.g. contains vs eq in the same list) are
// NOT merged into list operators — they become alternation only when
// every element can be expressed as regex; a truly untranslatable
// element (bad re, numeric list) rejects the selection.
func translateList(list []any, modifier string) (string, any, error) {
	if len(list) == 0 {
		return "", nil, fmt.Errorf("lista de valores vacia")
	}
	if modifier == "re" {
		parts := make([]string, len(list))
		for i, el := range list {
			s, ok := el.(string)
			if !ok {
				return "", nil, fmt.Errorf("modificador re con lista: todos los valores deben ser texto")
			}
			if _, err := regexp.Compile(s); err != nil {
				return "", nil, fmt.Errorf("regex invalida para el motor de Go: %w", err)
			}
			parts[i] = s
		}
		return "regex", "(?:" + strings.Join(parts, "|") + ")", nil
	}
	if modifier == "gt" || modifier == "lt" {
		return "", nil, fmt.Errorf("modificador %q con lista de valores no tiene sentido (aplica el mismo limite a valores distintos)", modifier)
	}

	wildcardFree := true
	vals := make([]string, len(list))
	for i, el := range list {
		if structured(el) {
			return "", nil, fmt.Errorf("valor estructurado (mapa/lista) en lista no traducible")
		}
		s := fmt.Sprint(el)
		vals[i] = s
		if strings.ContainsAny(s, "*?") {
			wildcardFree = false
		}
		// An only-wildcards element would compile to an always-true
		// regex alternative ("(?i)^.*$") that matches every event
		// with the field — and every one without it (sesión
		// 100agentes-2, agente 18). Reject the selection loudly.
		if el != nil && strings.Trim(s, "*?") == "" {
			return "", nil, fmt.Errorf("elemento solo-wildcard %q en lista no traducible", s)
		}
		if el == nil {
			return "", nil, fmt.Errorf("valor null en lista no traducible")
		}
	}
	if wildcardFree {
		switch modifier {
		case "":
			if hasLetters(strings.Join(vals, "\x00")) {
				return "iin", anySlice(vals), nil
			}
			return "in", anySlice(vals), nil
		case "contains":
			if hasLetters(strings.Join(vals, "\x00")) {
				return "icontains_any", anySlice(vals), nil
			}
			return "contains_any", anySlice(vals), nil
		}
		// startswith/endswith wildcard-free lists fall through to the
		// alternation below (the engine has no startswith_any).
	}

	// Regex alternation: every element gets a pattern with the exact
	// semantics of (value, modifier), joined so each alternative keeps
	// its own anchors.
	parts := make([]string, len(list))
	for i, el := range list {
		s := fmt.Sprint(el)
		if strings.ContainsAny(s, "*?") {
			_, pat, err := wildcardRegex(s, modifier)
			if err != nil {
				return "", nil, err
			}
			parts[i] = pat.(string)
			continue
		}
		switch modifier {
		case "contains":
			parts[i] = regexp.QuoteMeta(s)
		case "startswith":
			parts[i] = "^" + regexp.QuoteMeta(s) + ".*"
		case "endswith":
			parts[i] = ".*" + regexp.QuoteMeta(s) + "$"
		default:
			parts[i] = "^" + regexp.QuoteMeta(s) + "$"
		}
	}
	// Alternations carry a global (?i): wildcard/list matching in the
	// Sigma corpus is case-insensitive (unlike |re, which stays
	// case-sensitive above).
	return "regex", "(?i)(?:" + strings.Join(parts, "|") + ")", nil
}

func anySlice(ss []string) []any {
	out := make([]any, len(ss))
	for i, s := range ss {
		out[i] = s
	}
	return out
}

// translateContainsAll expands the contains|all pair into one
// condition per element. Elements must be strings; a wildcard element
// keeps its exact meaning (same machinery as translateString). The
// engine ANDs conditions inside a rule, which is exactly the |all
// contract.
func translateContainsAll(dst string, v any) ([]Condition, error) {
	list, ok := v.([]any)
	if !ok {
		return nil, fmt.Errorf("modificador all: el valor debe ser una lista de textos")
	}
	if len(list) == 0 {
		return nil, fmt.Errorf("lista de valores vacia")
	}
	out := make([]Condition, 0, len(list))
	for _, el := range list {
		if structured(el) {
			return nil, fmt.Errorf("valor estructurado (mapa/lista) en lista no traducible")
		}
		if el == nil {
			return nil, fmt.Errorf("valor null en lista no traducible")
		}
		s, ok := el.(string)
		if !ok {
			return nil, fmt.Errorf("modificador all: los valores deben ser texto")
		}
		op, val, err := translateString(s, "contains")
		if err != nil {
			return nil, err
		}
		out = append(out, Condition{Field: dst, Operator: op, Value: val})
	}
	return out, nil
}
