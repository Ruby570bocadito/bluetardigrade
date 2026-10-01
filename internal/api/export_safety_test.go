package api

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/internal/alert"
	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
)

func TestExportsProtectEveryTextColumn(t *testing.T) {
	h, addr := newTestHub(t)
	text := "=1+1"
	ev := sampleEvent(text)
	ev.Type, ev.Source, ev.Host, ev.User = text, text, text, text
	ev.Process = &model.Process{PID: 42, Name: text, CommandLine: text}
	ev.File = &model.File{Path: text}
	ev.Network = &model.Network{DestinationIP: text, DestinationPort: 443}
	ev.Registry = &model.Registry{Key: text}
	if err := ev.Validate(); err != nil {
		t.Fatal(err)
	}
	h.RecordEvent(ev)
	h.RecordAlert(alert.Alert{
		Timestamp: time.Now().UTC().Format(time.RFC3339Nano), Severity: "high",
		RuleID: text, RuleName: text, EventType: text, Host: text, User: text,
		Summary: text, MatchedOn: []string{text}, Tags: []string{text}, Message: text,
	})
	for kind, columns := range map[string][]string{
		"events": {"id", "type", "source", "host", "user", "process_name", "process_command_line", "file_path", "network_destination", "registry_key"},
		"alerts": {"rule_id", "rule_name", "event_type", "host", "user", "summary", "matched_on", "tags", "message"},
	} {
		t.Run(kind, func(t *testing.T) {
			_, body := fetchBody(t, fmt.Sprintf("http://%s/api/%s/export?format=csv", addr, kind))
			rows, err := csv.NewReader(strings.NewReader(body)).ReadAll()
			if err != nil || len(rows) != 2 {
				t.Fatalf("export CSV: rows=%v err=%v", rows, err)
			}
			cells := make(map[string]string)
			for i, name := range rows[0] {
				cells[name] = rows[1][i]
			}
			for _, name := range columns {
				if cells[name] != "'"+text {
					t.Errorf("unprotected %s: %q", name, cells[name])
				}
			}
			if kind == "events" && (cells["process_pid"] != "42" || cells["network_port"] != "443") {
				t.Fatal("typed numeric columns must retain their values")
			}
		})
	}
	// JSONL remains the exact-data format: CSV presentation escaping must
	// not mutate the ring or leak into subsequent evidence exports.
	res, err := http.Get(fmt.Sprintf("http://%s/api/events/export?format=jsonl", addr))
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var original model.Event
	if err := json.NewDecoder(res.Body).Decode(&original); err != nil {
		t.Fatal(err)
	}
	if original.ID != text || original.Network.DestinationIP != text || original.Registry.Key != text {
		t.Fatal("CSV escaping changed the underlying evidence")
	}
}

func TestCSVSafePrefixesAndWhitespace(t *testing.T) {
	for _, prefix := range []string{"=", "+", "-", "@", "\t", "\r", "\n", "＝", "＋", "－", "＠", " =", "\u00a0=", " \n@"} {
		input := prefix + "1+1"
		if got := csvSafe(input); got != "'"+input {
			t.Errorf("csvSafe(%q) = %q", input, got)
		}
	}
	for _, input := range []string{"", "LAB-PC", "C:\\Temp\\demo.txt", "user@example.test", " plain text", "normal,\"quoted\",=1+1"} {
		if got := csvSafe(input); got != input {
			t.Errorf("benign text changed: %q -> %q", input, got)
		}
	}
}
