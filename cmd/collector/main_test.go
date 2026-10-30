package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/Ruby570bocadito/bluetardigrade/pkg/model"
)

func TestCollectorOfflineOutputAndMalformedInput(t *testing.T) {
	var output, diagnostics bytes.Buffer
	input := strings.NewReader("{\"event_type\":\"dns\"}\n{\"timestamp\":\"2026-10-02T10:00:00Z\",\"event_type\":\"flow\",\"src_ip\":\"10.0.0.1\",\"dest_ip\":\"8.8.8.8\",\"proto\":\"TCP\"}\n")
	if err := run(context.Background(), options{source: "suricata", observer: "LAB", stdout: true}, input, &output, &diagnostics); err != nil {
		t.Fatal(err)
	}
	var event model.Event
	if json.Unmarshal(bytes.TrimSpace(output.Bytes()), &event) != nil || event.Source != "suricata" || event.Attributes["observer_host"] != "LAB" {
		t.Fatal("normalization output is not pure JSONL")
	}
	if !strings.Contains(diagnostics.String(), "1 records written, 1 ignored") {
		t.Fatal("incorrect source counters")
	}
	output.Reset()
	err := run(context.Background(), options{source: "suricata", observer: "LAB", stdout: true}, strings.NewReader("invalid fixture-password\n"), &output, &diagnostics)
	if err == nil || strings.Contains(err.Error(), "fixture-password") || output.Len() != 0 {
		t.Fatal("malformed input accepted or exposed")
	}
}

// Files exported with Windows PowerShell 5.1 start with a UTF-8 BOM
// (Set-Content -Encoding UTF8) or are UTF-16 (Out-File, '>'): the first
// imports whole, the second is refused with the fix, not "line 1:
// expected a JSON object".
func TestCollectorWindowsExportEncodings(t *testing.T) {
	row := `{"timestamp":"2026-10-02T10:00:00Z","event_type":"flow","src_ip":"10.0.0.1","dest_ip":"8.8.8.8","proto":"TCP"}`
	bom := "\xEF\xBB\xBF" + row + "\r\n" + row + "\r\n"
	var output bytes.Buffer
	if err := run(context.Background(), options{source: "suricata", observer: "LAB", stdout: true}, strings.NewReader(bom), &output, io.Discard); err != nil {
		t.Fatalf("UTF-8 file with BOM refused: %v", err)
	}
	if n := strings.Count(strings.TrimSpace(output.String()), "\n") + 1; n != 2 {
		t.Fatalf("UTF-8 BOM file: %d events, want 2", n)
	}
	utf16 := "\xFF\xFE{\x00\"\x00"
	output.Reset()
	err := run(context.Background(), options{source: "suricata", observer: "LAB", stdout: true}, strings.NewReader(utf16), &output, io.Discard)
	if err == nil || !strings.Contains(err.Error(), "UTF-16") || output.Len() != 0 {
		t.Fatalf("UTF-16 input not refused with an actionable error: %v", err)
	}
}

// One corrupt record (a truncated last line, a rotated log) stops the
// import by default and the error points at -skip-invalid; with it the
// valid records go through, the skipped line is reported by number and
// never by content, and input with no valid record at all still fails.
func TestCollectorSkipInvalid(t *testing.T) {
	row := `{"timestamp":"2026-10-02T10:00:00Z","event_type":"flow","src_ip":"10.0.0.1","dest_ip":"8.8.8.8","proto":"TCP"}`
	mixed := row + "\n{\"truncated\": fixture-password\n" + row + "\n"
	strict := options{source: "suricata", observer: "LAB", stdout: true}
	err := run(context.Background(), strict, strings.NewReader(mixed), io.Discard, io.Discard)
	if err == nil || !strings.Contains(err.Error(), "line 2") || !strings.Contains(err.Error(), "-skip-invalid") {
		t.Fatalf("default mode must stop at line 2 and name -skip-invalid: %v", err)
	}
	lenient := strict
	lenient.skipInvalid = true
	var output, diagnostics bytes.Buffer
	if err := run(context.Background(), lenient, strings.NewReader(mixed), &output, &diagnostics); err != nil {
		t.Fatalf("-skip-invalid must import the valid records: %v", err)
	}
	if n := strings.Count(strings.TrimSpace(output.String()), "\n") + 1; n != 2 {
		t.Fatalf("%d events written, want 2", n)
	}
	diag := diagnostics.String()
	if !strings.Contains(diag, "line 2 skipped") || !strings.Contains(diag, "1 invalid skipped") {
		t.Fatalf("skipped line not reported or counted:\n%s", diag)
	}
	if strings.Contains(diag, "fixture-password") {
		t.Fatalf("the skipped record content leaked into the diagnostics:\n%s", diag)
	}
	if err := run(context.Background(), lenient, strings.NewReader("nope\nstill nope\n"), io.Discard, io.Discard); err == nil || !strings.Contains(err.Error(), "check -source") {
		t.Fatalf("input without any valid record must fail: %v", err)
	}
}

func TestCollectorCancellationUnblocksInputPipe(t *testing.T) {
	reader, writer := io.Pipe()
	defer writer.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() {
		done <- run(ctx, options{source: "suricata", observer: "LAB", stdout: true}, reader, io.Discard, io.Discard)
	}()
	cancel()
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatal("cancellation lost", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("collector stayed blocked on pipe after cancellation")
	}
}
