// Package sigma converts Sigma detection rules (https://sigma.is YAML
// format) into the engine's native rule format, so the community rule
// corpus can feed rules/ without hand-transcription.
//
// Design notes (house standard, same as every detector):
//
//   - Fail loud per rule, never per run: a rule that uses a construct
//     the converter does not support is SKIPPED with an explicit,
//     actionable reason in the report; the rest of the directory still
//     converts. A broken FILE (invalid YAML, oversized) is a hard
//     error and aborts the run — silent partial input is how mock
//     data sneaks in.
//   - Deterministic output: files are walked in sorted order,
//     selections are evaluated in sorted name order and OR-splits are
//     emitted sorted, so the same input always yields byte-identical
//     output (diff-friendly, testable).
//   - Bounded input: per-file size cap, per-rule caps on selections,
//     fields and condition length, and a global cap on emitted rules
//     (an OR over N selections splits into N rules; a hostile corpus
//     must not OOM the run).
//   - Translation is 1:1 where semantics allow: Sigma wildcards map to
//     eq/contains/startswith/endswith/regex; the engine evaluates the
//     result with the SAME operator set internal/rules exports. No
//     approximation is made silently: if the mapped rule would not
//     mean the same thing, the rule is skipped instead.
//
// Scope (v1, documented in README): logsources mapped by CATEGORY
// against the v0.1 event schema (process.create, file.write,
// network.connect, registry.set, image.load, process.access); windows
// product only. Unsupported modifiers (base64*, utf16*, wide, all,
// exists), keyword selections, negations and parenthesised boolean
// expressions are skipped with a reason.
package sigma

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"gopkg.in/yaml.v3"
)

// Input/output bounds. Generous for real corpora, tight enough that a
// hostile tree cannot make the run allocate without end.
const (
	MaxFileSize       = 4 << 20 // 4 MiB per Sigma file
	MaxRulesOut       = 512     // emitted rules per run (OR-split can multiply)
	MaxSelections     = 64      // selections per rule
	MaxFields         = 32      // fields per selection
	MaxConditionLen   = 512     // condition expression length
	MaxTitleLen       = 256
	MaxIDLen          = 128 // mirrors the API's MaxRuleIDLen cap
	MaxDescriptionLen = 8000
)

// ConvertDir walks root (a file or a directory) and converts every
// .yml/.yaml Sigma rule found. Files are processed in sorted order;
// the result lists converted rules and every skip with its reason.
func ConvertDir(root string) (*Result, error) {
	files, err := collectFiles(root)
	if err != nil {
		return nil, err
	}
	res := &Result{}
	for _, f := range files {
		if err := convertFile(f, res); err != nil {
			return nil, err // hard error: broken file, never silently skipped
		}
	}
	return res, nil
}

// Result carries the conversion outcome.
type Result struct {
	Converted []Rule
	Skipped   []Skip
	Files     int // files scanned
}

// Emit renders the converted rules as an engine-loadable YAML list
// with a generation header. The output is deterministic: the same
// input directory always produces byte-identical files.
func (r *Result) Emit() ([]byte, error) {
	var b bytes.Buffer
	fmt.Fprintf(&b, "# Generado por 'engine sigma' desde %d fichero(s) Sigma: %d reglas convertidas, %d omitidas.\n",
		r.Files, len(r.Converted), len(r.Skipped))
	b.WriteString("# No editar a mano: regenerar con 'engine sigma -dir <corpus-sigma>'.\n")
	if len(r.Converted) == 0 {
		b.WriteString("[]\n")
		return b.Bytes(), nil
	}
	enc := yaml.NewEncoder(&b)
	enc.SetIndent(2)
	if err := enc.Encode(r.Converted); err != nil {
		return nil, fmt.Errorf("sigma: emitir YAML: %w", err)
	}
	if err := enc.Close(); err != nil {
		return nil, fmt.Errorf("sigma: cerrar encoder: %w", err)
	}
	return b.Bytes(), nil
}

// Skip records one Sigma rule that was not converted and why.
type Skip struct {
	Title  string
	ID     string
	Reason string
}

// Rule is the converter's output shape: the engine's native rule
// (internal/rules) with the provenance fields folded into the
// description so the emitted YAML stays schema-clean.
type Rule struct {
	Name        string      `yaml:"name"`
	ID          string      `yaml:"id"`
	Description string      `yaml:"description"`
	Severity    string      `yaml:"severity"`
	EventType   string      `yaml:"event_type"`
	Conditions  []Condition `yaml:"conditions"`
	Actions     []Action    `yaml:"actions"`
	Tags        []string    `yaml:"tags"`
	Enabled     bool        `yaml:"enabled"`
}

// Condition mirrors internal/rules.Condition (kept local so the
// package controls its own YAML output shape).
type Condition struct {
	Field    string `yaml:"field"`
	Operator string `yaml:"operator"`
	Value    any    `yaml:"value"`
}

// Action mirrors internal/rules.Action.
type Action struct {
	Type   string            `yaml:"type"`
	Config map[string]string `yaml:"config"`
}

// collectFiles resolves root to the sorted list of Sigma files.
func collectFiles(root string) ([]string, error) {
	st, err := os.Stat(root)
	if err != nil {
		return nil, fmt.Errorf("sigma: %w", err)
	}
	if !st.IsDir() {
		return []string{root}, nil
	}
	var files []string
	err = filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			return nil
		}
		switch strings.ToLower(filepath.Ext(path)) {
		case ".yaml", ".yml":
			files = append(files, path)
		}
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("sigma: walk %s: %w", root, err)
	}
	sort.Strings(files)
	return files, nil
}

// sigmaRule is the parsed subset of the Sigma YAML format.
type sigmaRule struct {
	Title       string   `yaml:"title"`
	ID          string   `yaml:"id"`
	Status      string   `yaml:"status"`
	Description string   `yaml:"description"`
	Author      string   `yaml:"author"`
	Date        string   `yaml:"date"`
	References  []string `yaml:"references"`
	Logsource   struct {
		Category string `yaml:"category"`
		Product  string `yaml:"product"`
		Service  string `yaml:"service"`
	} `yaml:"logsource"`
	Detection struct {
		Selections map[string]any `yaml:",inline"`
		Condition  string         `yaml:"condition"`
	} `yaml:"detection"`
	FalsePositives []string `yaml:"falsepositives"`
	Level          string   `yaml:"level"`
	Tags           []string `yaml:"tags"`
}

// convertFile parses one Sigma file (single-document YAML; the corpus
// convention is one rule per file) and appends to the result. An error
// returned here is ALWAYS fatal for the run: invalid YAML or an
// oversized file means the input is not what the operator thinks it is.
func convertFile(path string, res *Result) error {
	res.Files++
	info, err := os.Stat(path)
	if err != nil {
		return fmt.Errorf("sigma: stat %s: %w", path, err)
	}
	if info.Size() > MaxFileSize {
		return fmt.Errorf("sigma: %s: fichero mayor de %d bytes", path, MaxFileSize)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("sigma: read %s: %w", path, err)
	}
	var sr sigmaRule
	if err := yaml.Unmarshal(data, &sr); err != nil {
		return fmt.Errorf("sigma: %s: YAML invalido: %w", path, err)
	}
	convertRule(&sr, res)
	return nil
}

// skip appends a skip record with the precise, actionable reason.
func (r *Result) skip(sr *sigmaRule, format string, args ...any) {
	r.Skipped = append(r.Skipped, Skip{
		Title:  sr.Title,
		ID:     sr.ID,
		Reason: fmt.Sprintf(format, args...),
	})
}

// convertRule translates one parsed Sigma rule. Unsupported constructs
// produce a Skip with the precise reason; the run continues.
func convertRule(sr *sigmaRule, res *Result) {
	if len(res.Converted) >= MaxRulesOut {
		res.skip(sr, "tope de salida alcanzado (%d reglas)", MaxRulesOut)
		return
	}
	// ---- field caps (fail loud on absurd input, never truncate) ----
	switch {
	case strings.TrimSpace(sr.Title) == "":
		res.skip(sr, "sin title")
		return
	case len(sr.Title) > MaxTitleLen:
		res.skip(sr, "title mayor de %d caracteres", MaxTitleLen)
		return
	case strings.TrimSpace(sr.ID) == "":
		res.skip(sr, "%q: sin id", sr.Title)
		return
	case len(sr.ID) > MaxIDLen:
		res.skip(sr, "%q: id mayor de %d caracteres", sr.Title, MaxIDLen)
		return
	case len(sr.Description) > MaxDescriptionLen:
		res.skip(sr, "%q: description mayor de %d caracteres", sr.Title, MaxDescriptionLen)
		return
	}
	for _, c := range res.Converted {
		if c.ID == sr.ID {
			res.skip(sr, "id duplicado %q (ya convertido como %q)", sr.ID, c.Name)
			return
		}
	}

	// ---- status: deprecated rules must not resurrect ----
	if sr.Status == "deprecated" {
		res.skip(sr, "%q: status deprecated", sr.Title)
		return
	}

	// ---- level -> severity ----
	sev, ok := severityOf(sr.Level)
	if !ok {
		res.skip(sr, "%q: level %q no mapeable (informational|low|medium|high|critical)", sr.Title, sr.Level)
		return
	}

	// ---- logsource -> event_type (category table, windows only) ----
	if sr.Logsource.Product != "" && sr.Logsource.Product != "windows" {
		res.skip(sr, "%q: logsource product %q fuera de alcance (solo windows)", sr.Title, sr.Logsource.Product)
		return
	}
	et, ok := eventTypeOf(sr.Logsource.Category)
	if !ok {
		res.skip(sr, "%q: categoria de logsource %q sin equivalente en el esquema v0.1 (service=%q)",
			sr.Title, sr.Logsource.Category, sr.Logsource.Service)
		return
	}

	// ---- selections: map form only, bounded, deterministic order ----
	if len(sr.Detection.Selections) > MaxSelections {
		res.skip(sr, "%q: mas de %d selections", sr.Title, MaxSelections)
		return
	}
	sels := map[string][]fieldValue{}
	for name, raw := range sr.Detection.Selections {
		if _, isList := raw.([]any); isList {
			res.skip(sr, "%q: selection %q en forma de lista (keyword/OR implicito) no soportada",
				sr.Title, name)
			return
		}
		m, ok := raw.(map[string]any)
		if !ok {
			res.skip(sr, "%q: selection %q no es un mapa de campos", sr.Title, name)
			return
		}
		if len(m) > MaxFields {
			res.skip(sr, "%q: selection %q con mas de %d campos", sr.Title, name, MaxFields)
			return
		}
		keys := make([]string, 0, len(m))
		for k := range m {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		fvs := make([]fieldValue, 0, len(m))
		for _, k := range keys {
			fvs = append(fvs, splitModifier(k, m[k]))
		}
		sels[name] = fvs
	}

	// ---- condition grammar ----
	plan, err := parseCondition(sr.Detection.Condition, sels)
	if err != nil {
		res.skip(sr, "%q: %v", sr.Title, err)
		return
	}

	// ---- translate each requested selection into engine conditions ----
	outs := make([]selOut, 0, len(plan.selections))
	for _, name := range plan.selections {
		conds, reason := translateSelection(sels[name])
		if reason != "" {
			res.skip(sr, "%q: %s", sr.Title, reason)
			return
		}
		outs = append(outs, selOut{name: name, conds: conds})
	}

	// ---- build the emitted rules ----
	if plan.kind != condOr {
		conds := []Condition{}
		for _, o := range outs {
			conds = append(conds, o.conds...)
		}
		res.Converted = append(res.Converted, buildRule(sr, sev, et, conds, ""))
		return
	}

	// OR family: try the same-field merge first (keeps `1 of them` with
	// three CommandLine selections as ONE rule); otherwise split into
	// one rule per selection (semantically identical: any branch fires).
	if merged, ok := mergeOR(outs); ok {
		res.Converted = append(res.Converted, buildRule(sr, sev, et, merged, ""))
		return
	}
	sort.Slice(outs, func(i, j int) bool { return outs[i].name < outs[j].name })
	for i, o := range outs {
		if len(res.Converted) >= MaxRulesOut {
			res.skip(sr, "tope de salida alcanzado (%d reglas) durante la division OR", MaxRulesOut)
			return
		}
		suffix := fmt.Sprintf(" (or %d/%d)", i+1, len(outs))
		res.Converted = append(res.Converted, buildRule(sr, sev, et, o.conds, suffix))
	}
}

// buildRule assembles the native rule with provenance folded into the
// description and a deterministic alert action (the Sigma title as
// message: no invented content, rendered by the engine's templates).
func buildRule(sr *sigmaRule, sev, et string, conds []Condition, nameSuffix string) Rule {
	desc := strings.TrimSpace(sr.Description)
	if desc == "" {
		desc = sr.Title
	}
	var prov []string
	if sr.Author != "" {
		prov = append(prov, "autor: "+sr.Author)
	}
	if sr.Status != "" {
		prov = append(prov, "estado: "+sr.Status)
	}
	if sr.Date != "" {
		prov = append(prov, "fecha: "+sr.Date)
	}
	if len(sr.References) > 0 {
		prov = append(prov, "refs: "+strings.Join(sr.References, " "))
	}
	if len(sr.FalsePositives) > 0 {
		prov = append(prov, "falsos positivos declarados: "+strings.Join(sr.FalsePositives, "; "))
	}
	if len(prov) > 0 {
		desc += "\n[Sigma] " + strings.Join(prov, " | ")
	}
	tags := append([]string{"sigma"}, sr.Tags...)
	return Rule{
		Name:        sr.Title + nameSuffix,
		ID:          sr.ID,
		Description: desc,
		Severity:    sev,
		EventType:   et,
		Conditions:  conds,
		Actions:     []Action{{Type: "alert", Config: map[string]string{"message": sr.Title}}},
		Tags:        tags,
		Enabled:     true,
	}
}
