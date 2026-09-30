package sigma

import (
	"fmt"
	"sort"
	"strings"
)

// condKind is the boolean shape of a parsed condition expression.
type condKind int

const (
	condSingle condKind = iota
	condAnd
	condOr
)

// condPlan is the resolved execution plan: which selections participate
// and how they combine. The engine ANDs conditions within one rule, so
// OR plans either merge into one condition (same field, same family) or
// split into one rule per selection upstream.
type condPlan struct {
	kind       condKind
	selections []string
}

// selOut pairs a selection name with its translated engine conditions.
type selOut struct {
	name  string
	conds []Condition
}

// parseCondition understands the supported subset of the Sigma
// condition grammar:
//
//	SELECTION
//	A and B [and C ...]
//	A or B [or C ...]
//	1 of them            / all of them
//	1 of PREFIX*         / all of PREFIX*
//	1 of A,B,C           / all of A,B,C
//
// Everything else — negations, parentheses, mixed and/or, arithmetic,
// pipe filters — is rejected with an explicit reason instead of being
// translated approximately.
func parseCondition(expr string, sels map[string][]fieldValue) (condPlan, error) {
	if len(expr) > MaxConditionLen {
		return condPlan{}, fmt.Errorf("condition mayor de %d caracteres", MaxConditionLen)
	}
	tokens := strings.Fields(expr)
	if len(tokens) == 0 {
		return condPlan{}, fmt.Errorf("condition vacia")
	}

	// "1 of X" / "all of X" family
	if len(tokens) == 3 && tokens[1] == "of" && (tokens[0] == "1" || tokens[0] == "all") {
		names, err := expandOf(tokens[2], sels)
		if err != nil {
			return condPlan{}, err
		}
		if tokens[0] == "1" {
			return condPlan{kind: condOr, selections: names}, nil
		}
		return condPlan{kind: condAnd, selections: names}, nil
	}

	for _, t := range tokens {
		switch t {
		case "(", ")":
			return condPlan{}, fmt.Errorf("parentesis en la condition no soportado (v1: cadenas and/or planas, 1 of, all of)")
		case "not":
			return condPlan{}, fmt.Errorf("negacion (not) no soportada en la condition")
		}
	}

	hasAnd, hasOr := false, false
	for _, t := range tokens {
		switch t {
		case "and":
			hasAnd = true
		case "or":
			hasOr = true
		}
	}
	if hasAnd && hasOr {
		return condPlan{}, fmt.Errorf("mezcla de and/or en la condition no soportada (v1: una sola operacion)")
	}

	op := ""
	if hasAnd {
		op = "and"
	}
	if hasOr {
		op = "or"
	}

	var names []string
	if op == "" {
		if len(tokens) != 1 {
			return condPlan{}, fmt.Errorf("condition no reconocida: %q", expr)
		}
		names = []string{tokens[0]}
	} else {
		for _, t := range tokens {
			if t == op {
				continue
			}
			names = append(names, strings.Split(t, ",")...)
		}
		// `A or B,C` style mixes collapse to the same operator; the
		// comma form is accepted as a list shorthand of that operator.
	}
	for _, n := range names {
		if _, ok := sels[n]; !ok {
			return condPlan{}, fmt.Errorf("la condition referencia la selection %q que no existe", n)
		}
	}
	kind := condSingle
	if op == "and" {
		kind = condAnd
	}
	if op == "or" {
		kind = condOr
	}
	return condPlan{kind: kind, selections: names}, nil
}

// expandOf resolves the right-hand side of "1 of X" / "all of X":
// "them" is every selection (sorted), "PREFIX*" every selection whose
// name starts with PREFIX (sorted), "A,B,C" an explicit list.
func expandOf(spec string, sels map[string][]fieldValue) ([]string, error) {
	available := make([]string, 0, len(sels))
	for name := range sels {
		available = append(available, name)
	}
	sort.Strings(available)

	switch {
	case spec == "them":
		if len(available) == 0 {
			return nil, fmt.Errorf("condition usa 'them' pero no hay selections")
		}
		return available, nil
	case strings.HasSuffix(spec, "*"):
		prefix := strings.TrimSuffix(spec, "*")
		var names []string
		for _, n := range available {
			if strings.HasPrefix(n, prefix) {
				names = append(names, n)
			}
		}
		if len(names) == 0 {
			return nil, fmt.Errorf("el patron %q de la condition no coincide con ninguna selection", spec)
		}
		return names, nil
	default:
		var names []string
		for _, n := range strings.Split(spec, ",") {
			n = strings.TrimSpace(n)
			if _, ok := sels[n]; !ok {
				return nil, fmt.Errorf("la condition referencia la selection %q que no existe", n)
			}
			names = append(names, n)
		}
		return names, nil
	}
}

// mergeOR tries to fold an OR plan into ONE engine condition: it only
// works when every selection is a single-field condition on the same
// mapped field with the same operator family. Returns ok=false when
// the caller must split into one rule per selection.
func mergeOR(outs []selOut) ([]Condition, bool) {
	if len(outs) == 0 {
		return nil, false
	}
	field := ""
	op := ""
	vals := make([]any, 0, len(outs))
	for _, o := range outs {
		if len(o.conds) != 1 {
			return nil, false
		}
		c := o.conds[0]
		if field == "" {
			field, op = c.Field, c.Operator
		}
		if c.Field != field || c.Operator != op {
			return nil, false
		}
		switch c.Operator {
		case "eq", "contains", "in", "contains_any", "ieq", "icontains", "iin", "icontains_any":
			vals = append(vals, listValues(c.Value)...)
		default:
			// startswith/endswith/regex across selections: each element
			// already carries its own anchors, so a shared operator list
			// would change semantics — split instead.
			return nil, false
		}
	}
	if len(vals) == 0 {
		return nil, false
	}
	switch op {
	case "eq":
		return []Condition{{Field: field, Operator: "in", Value: vals}}, true
	case "in":
		return []Condition{{Field: field, Operator: "in", Value: vals}}, true
	case "contains":
		return []Condition{{Field: field, Operator: "contains_any", Value: vals}}, true
	case "contains_any":
		return []Condition{{Field: field, Operator: "contains_any", Value: vals}}, true
	case "ieq":
		return []Condition{{Field: field, Operator: "iin", Value: vals}}, true
	case "iin":
		return []Condition{{Field: field, Operator: "iin", Value: vals}}, true
	case "icontains":
		return []Condition{{Field: field, Operator: "icontains_any", Value: vals}}, true
	case "icontains_any":
		return []Condition{{Field: field, Operator: "icontains_any", Value: vals}}, true
	}
	return nil, false
}

// listValues flattens an operator value into its element list (a scalar
// is a one-element list).
func listValues(v any) []any {
	switch t := v.(type) {
	case []any:
		return t
	case nil:
		return nil
	default:
		return []any{t}
	}
}
