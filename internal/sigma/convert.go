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
func translateValue(fv fieldValue) (string, any, error) {
	if len(fv.modifiers) > 0 {
		switch fv.modifiers[0] {
		case "re":
			return translateRegex(fv.value)
		case "gt", "lt":
			if fv.value == nil {
				return "", nil, errNullModified
			}
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

// sigmaTok is one character of a Sigma value after escape processing:
// a literal rune or a wildcard (* or ?).
type sigmaTok struct {
	r    rune
	wild bool
}

// tokenize applies the Sigma escaping rules to a raw value: `\\` is one
// literal backslash, `\*` and `\?` are literal characters, and a
// backslash before anything else stands for itself (so the customary
// '\cmd.exe' keeps its backslash). Unescaped * and ? are wildcards.
// Skipping this step emitted '\\\\host\\share' with every backslash
// doubled (a rule that never matches) and turned a literal `\*` into
// backslash + wildcard.
func tokenize(s string) []sigmaTok {
	rs := []rune(s)
	out := make([]sigmaTok, 0, len(rs))
	for i := 0; i < len(rs); i++ {
		c := rs[i]
		switch {
		case c == '\\' && i+1 < len(rs) && (rs[i+1] == '\\' || rs[i+1] == '*' || rs[i+1] == '?'):
			out = append(out, sigmaTok{r: rs[i+1]})
			i++
		case c == '*' || c == '?':
			out = append(out, sigmaTok{r: c, wild: true})
		default:
			out = append(out, sigmaTok{r: c})
		}
	}
	return out
}

// hasWild reports whether any token is a wildcard.
func hasWild(toks []sigmaTok) bool {
	for _, t := range toks {
		if t.wild {
			return true
		}
	}
	return false
}

// literal renders the tokens as the plain string they stand for.
func literal(toks []sigmaTok) string {
	var b strings.Builder
	for _, t := range toks {
		b.WriteRune(t.r)
	}
	return b.String()
}

// isStar reports whether the token is the multi-character wildcard.
func isStar(t sigmaTok) bool { return t.wild && t.r == '*' }

// errNullModified rejects `Field|modifier: null`: only the bare form
// has a meaning (the field is empty) the engine can express.
var errNullModified = fmt.Errorf("valor null con modificador no soportado (solo 'Campo: null' = campo vacio)")

// translateString handles scalar and list values with the optional
// string modifier ("" = plain equality context).
func translateString(v any, modifier string) (string, any, error) {
	if list, ok := v.([]any); ok {
		return translateList(list, modifier)
	}
	if v == nil {
		// Sigma null = the field is absent or empty. The engine reads a
		// missing field as "", so eq "" is the exact translation;
		// fmt.Sprint(nil) would emit the literal "<nil>" and a rule
		// that can never fire.
		if modifier != "" {
			return "", nil, errNullModified
		}
		return "eq", "", nil
	}
	toks := tokenize(fmt.Sprint(v))
	// A modified value keeps its literal meaning; if it carries
	// wildcards the semantics shift to regex so nothing changes
	// silently.
	if modifier != "" {
		if hasWild(toks) {
			return wildcardRegex(toks, modifier)
		}
		s := literal(toks)
		if hasLetters(s) {
			// The Sigma corpus matches strings case-insensitively (it writes
			// 'mimikatz' and expects Invoke-Mimikatz to hit); the i* operators
			// keep that contract without regex overhead.
			return "i" + modifier, s, nil
		}
		return modifier, s, nil
	}
	// Plain value: wildcard -> operator translation.
	n := len(toks)
	fold := func(op string, inner []sigmaTok) (string, any, error) {
		s := literal(inner)
		if hasLetters(s) {
			return "i" + op, s, nil
		}
		return op, s, nil
	}
	switch {
	case !hasWild(toks):
		return fold("eq", toks)
	case n >= 2 && isStar(toks[0]) && isStar(toks[n-1]) && !hasWild(toks[1:n-1]):
		return fold("contains", toks[1:n-1])
	case isStar(toks[n-1]) && !hasWild(toks[:n-1]):
		return fold("startswith", toks[:n-1])
	case isStar(toks[0]) && !hasWild(toks[1:]):
		return fold("endswith", toks[1:])
	default:
		return wildcardRegex(toks, "")
	}
}

// wildcardRegex builds an engine-compatible regex from a tokenized
// Sigma wildcard pattern. modifier narrows the anchoring (contains
// keeps it unanchored, startswith anchors the head, endswith the tail;
// plain values anchor both sides).
func wildcardRegex(toks []sigmaTok, modifier string) (string, any, error) {
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
	for _, t := range toks {
		switch {
		case isStar(t):
			b.WriteString(".*")
		case t.wild:
			b.WriteString(".")
		default:
			b.WriteString(regexp.QuoteMeta(string(t.r)))
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
		return "", nil, fmt.Errorf("patron %q no traducible a regex: %w", literal(toks), err)
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
	toks := make([][]sigmaTok, len(list))
	vals := make([]string, len(list))
	for i, el := range list {
		if el == nil {
			// null in a plain list = "or the field is empty"
			if modifier != "" {
				return "", nil, errNullModified
			}
			continue
		}
		toks[i] = tokenize(fmt.Sprint(el))
		vals[i] = literal(toks[i])
		if hasWild(toks[i]) {
			wildcardFree = false
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
	for i := range list {
		if hasWild(toks[i]) {
			_, pat, err := wildcardRegex(toks[i], modifier)
			if err != nil {
				return "", nil, err
			}
			parts[i] = pat.(string)
			continue
		}
		s := vals[i]
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
