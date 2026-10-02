package socreport

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

const evidence = `{"id":"0123456789abcdef","timestamp":"2026-10-02T10:00:00Z","rule_id":"soc-ids-priority-high","rule_name":"IDS","severity":"high","host":"LAB","event_id":"event","event_type":"network.alert","summary":"observed","source":"suricata","attributes":{"ids_action":"allowed","ids_verdict":"drop","note":"raw\u202e\u0060\u0060\u0060"},"status":"closed"}`

func TestReportPreservesEvidenceAndSeparatesHumanClassification(t *testing.T) {
	raw := json.RawMessage(evidence)
	report, err := New("0123456789abcdef", raw, Fields{Decision: "false_positive", Findings: "```\n# untrusted heading\n```", Actions: "No action executed"}, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	raw[0] = 'x'
	encoded, err := report.Render("json")
	if err != nil {
		t.Fatal(err)
	}
	var result struct {
		Alert  map[string]any
		Fields Fields
	}
	if json.Unmarshal(encoded, &result) != nil || result.Alert["source"] != "suricata" || result.Alert["status"] != "closed" || result.Fields.Decision != "false_positive" {
		t.Fatal("report lost evidence or changed lifecycle")
	}
	markdown, _ := report.Render("md")
	if !strings.Contains(string(markdown), "````text\n```\n# untrusted heading") || !strings.Contains(string(markdown), `\u202e`) {
		t.Fatal("unsafe Markdown fence/bidi presentation")
	}
	if _, err := New("fedcba9876543210", json.RawMessage(evidence), Fields{}, time.Now()); err == nil {
		t.Fatal("cross-alert evidence accepted")
	}
}

func TestReportNotesRejectUnknownFieldsControlsAndPartialInput(t *testing.T) {
	for _, raw := range []string{`null`, `{} {}`, `{"decision":"invented"}`, `{"findings":"\u202e"}`, `{"automatic_action":"kill"}`, strings.Repeat("x", 65537)} {
		if _, err := ReadFields(strings.NewReader(raw)); err == nil {
			t.Fatal("invalid notes accepted")
		}
	}
	fields, err := ReadFields(strings.NewReader(`{"findings":"Human analysis","decision":"pending"}`))
	if err != nil || fields.Findings != "Human analysis" {
		t.Fatal("valid human notes failed", err)
	}
}

func TestReportExclusiveOutputPreservesExistingFileAndSymlink(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "report.md")
	if err := WriteNew(path, []byte("first")); err != nil {
		t.Fatal(err)
	}
	if err := WriteNew(path, []byte("replacement")); err == nil {
		t.Fatal("overwrote report")
	}
	raw, _ := os.ReadFile(path)
	if !bytes.Equal(raw, []byte("first")) {
		t.Fatal("existing report modified")
	}
	link := filepath.Join(dir, "alias.md")
	if err := os.Symlink(path, link); err == nil {
		if err := WriteNew(link, []byte("replacement")); err == nil {
			t.Fatal("overwrote symlink destination")
		}
	}
	temps, _ := filepath.Glob(filepath.Join(dir, ".soc-report-*"))
	if len(temps) != 0 {
		t.Fatal("temporary evidence file leaked")
	}
}
