// Package socreport renders operator-authored investigation reports with a
// frozen alert snapshot. It never infers a verdict or changes alert lifecycle.
package socreport

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

var alertID = regexp.MustCompile(`^[a-f0-9]{16}$`)

// Fields contains only statements written by an analyst.
type Fields struct {
	Title           string `json:"title"`
	Analyst         string `json:"analyst"`
	Decision        string `json:"decision"`
	Findings        string `json:"findings"`
	Actions         string `json:"actions"`
	Recommendations string `json:"recommendations"`
	References      string `json:"references"`
}

// Report separates imported evidence from human analysis.
type Report struct {
	Version   int             `json:"version"`
	AlertID   string          `json:"alert_id"`
	CreatedAt string          `json:"created_at"`
	Fields    Fields          `json:"fields"`
	Alert     json.RawMessage `json:"alert"`
}

// ValidID accepts the lifecycle key the engine actually assigns.
func ValidID(id string) bool { return alertID.MatchString(id) }

// New validates the evidence identity and copies it without dropping source fields.
func New(id string, raw json.RawMessage, fields Fields, now time.Time) (*Report, error) {
	if !ValidID(id) {
		return nil, errors.New("alert id must contain 16 lowercase hex characters")
	}
	if len(raw) > 64<<10 || !utf8.Valid(raw) {
		return nil, errors.New("alert evidence exceeds 64 KiB or is not UTF-8")
	}
	var evidence map[string]json.RawMessage
	if json.Unmarshal(raw, &evidence) != nil || evidence == nil {
		return nil, errors.New("alert evidence must be a JSON object")
	}
	var evidenceID string
	_ = json.Unmarshal(evidence["id"], &evidenceID)
	if evidenceID != id {
		return nil, errors.New("report evidence does not match the selected alert")
	}
	for _, key := range []string{"timestamp", "rule_id", "rule_name", "severity", "host", "event_id", "event_type", "summary"} {
		var value string
		if json.Unmarshal(evidence[key], &value) != nil {
			return nil, fmt.Errorf("alert evidence missing string field %s", key)
		}
	}
	if fields.Title == "" {
		fields.Title = "Investigacion de alerta " + id
	}
	if fields.Decision == "" {
		fields.Decision = "pending"
	}
	if err := Validate(fields); err != nil {
		return nil, err
	}
	if now.IsZero() {
		return nil, errors.New("report creation time required")
	}
	return &Report{Version: 1, AlertID: id, CreatedAt: now.UTC().Format(time.RFC3339Nano), Fields: fields, Alert: append(json.RawMessage(nil), raw...)}, nil
}

// Validate bounds human fields and rejects terminal and bidi controls.
func Validate(fields Fields) error {
	switch fields.Decision {
	case "pending", "false_positive", "authorized_activity", "confirmed_incident":
	default:
		return errors.New("invalid report decision")
	}
	for key, item := range map[string]struct {
		value string
		max   int
	}{
		"title": {fields.Title, 200}, "analyst": {fields.Analyst, 120},
		"findings": {fields.Findings, 4000}, "actions": {fields.Actions, 4000}, "recommendations": {fields.Recommendations, 4000}, "references": {fields.References, 4000},
	} {
		if !utf8.ValidString(item.value) || utf8.RuneCountInString(item.value) > item.max {
			return fmt.Errorf("report %s exceeds its UTF-8 limit", key)
		}
		for _, r := range item.value {
			if (unicode.IsControl(r) && r != '\n' && r != '\t') || bidi(r) {
				return fmt.Errorf("report %s contains unsupported controls", key)
			}
		}
	}
	return nil
}

// ReadFields accepts a strict bounded JSON object from --notes.
func ReadFields(reader io.Reader) (Fields, error) {
	var fields Fields
	raw, err := io.ReadAll(io.LimitReader(reader, (64<<10)+1))
	if err != nil || len(raw) > 64<<10 || !utf8.Valid(raw) {
		return fields, errors.New("invalid or excessive report notes")
	}
	if len(bytes.TrimSpace(raw)) == 0 || bytes.TrimSpace(raw)[0] != '{' {
		return fields, errors.New("report notes must be a JSON object")
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&fields); err != nil {
		return fields, errors.New("invalid report note fields")
	}
	var extra any
	if dec.Decode(&extra) != io.EOF {
		return fields, errors.New("report notes must contain one object")
	}
	if fields.Decision == "" {
		fields.Decision = "pending"
	}
	return fields, Validate(fields)
}

// Render returns JSON or Markdown, with untrusted evidence inside a sized fence.
func (r *Report) Render(format string) ([]byte, error) {
	if format == "json" {
		raw, err := json.MarshalIndent(r, "", "  ")
		return append(raw, '\n'), err
	}
	if format != "md" {
		return nil, errors.New("format must be md or json")
	}
	var out strings.Builder
	out.WriteString("# Informe SOC\n\nAlerta: `" + r.AlertID + "`\n\nCreado: " + r.CreatedAt + "\n\n")
	for _, entry := range [][2]string{{"Titulo", r.Fields.Title}, {"Analista", r.Fields.Analyst}, {"Clasificacion humana", r.Fields.Decision}, {"Hallazgos", r.Fields.Findings}, {"Acciones realizadas", r.Fields.Actions}, {"Recomendaciones", r.Fields.Recommendations}, {"Referencias", r.Fields.References}} {
		value := entry[1]
		if value == "" {
			value = "Sin completar"
		}
		out.WriteString("## " + entry[0] + "\n\n" + fence(value, "text") + "\n\n")
	}
	var evidence bytes.Buffer
	if err := json.Indent(&evidence, r.Alert, "", "  "); err != nil {
		return nil, err
	}
	out.WriteString("## Evidencia recibida\n\nSnapshot de la alerta; la clasificacion anterior pertenece al analista.\n\n" + fence(displayBidi(evidence.String()), "json") + "\n\nEl informe no modifica el estado de la alerta ni ejecuta una respuesta.\n")
	return []byte(out.String()), nil
}

func bidi(r rune) bool {
	return r == 0x061c || r == 0x200e || r == 0x200f || (r >= 0x202a && r <= 0x202e) || (r >= 0x2066 && r <= 0x2069)
}
func displayBidi(value string) string { return valueWithBidiEscaped(value) }
func valueWithBidiEscaped(value string) string {
	var out strings.Builder
	for _, r := range value {
		if bidi(r) {
			fmt.Fprintf(&out, "\\u%04x", r)
		} else {
			out.WriteRune(r)
		}
	}
	return out.String()
}
func fence(value, language string) string {
	maxRun, current := 0, 0
	for _, r := range value {
		if r == '`' {
			current++
			if current > maxRun {
				maxRun = current
			}
		} else {
			current = 0
		}
	}
	marker := strings.Repeat("`", max(3, maxRun+1))
	return marker + language + "\n" + value + "\n" + marker
}

// WriteNew commits a complete mode-0600 report exclusively. Existing files
// and symlinks are never overwritten, including during a concurrent race.
func WriteNew(path string, raw []byte) error {
	parent := filepath.Dir(path)
	if err := os.MkdirAll(parent, 0o700); err != nil {
		return fmt.Errorf("create report dir: %w", err)
	}
	file, err := os.CreateTemp(parent, ".soc-report-*")
	if err != nil {
		return fmt.Errorf("prepare report file: %w", err)
	}
	defer os.Remove(file.Name())
	_, writeErr := file.Write(raw)
	syncErr := file.Sync()
	closeErr := file.Close()
	if writeErr != nil || syncErr != nil || closeErr != nil {
		return fmt.Errorf("complete report file: write=%v sync=%v close=%v", writeErr, syncErr, closeErr)
	}
	if err := os.Link(file.Name(), path); err != nil {
		return errors.New("cannot create report: destination already exists or filesystem does not support exclusive hard links")
	}
	return nil
}
