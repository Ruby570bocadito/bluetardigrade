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
